import {
  SpotifyPlaylistItem,
  TrackItem,
  SpotifyPlaybackState
} from '@/shared/types/spotify'
import { SpotifyApiClient, SpotifyApiService } from './spotifyApi'
import {
  MAX_PLAYLIST_LENGTH,
  FALLBACK_GENRES,
  type Genre,
  DEFAULT_MAX_OFFSET
} from '@/shared/constants/trackSuggestion'
import { findSuggestedTrack } from '@/services/trackSuggestion'
import { filterUpcomingTracks } from '@/lib/utils'
import { autoRemoveTrack } from '@/shared/utils/autoRemoveTrack'
import { handleOperationError } from '@/shared/utils/errorHandling'
import { DEFAULT_MARKET } from '@/shared/constants/trackSuggestion'
import { sendApiRequest } from '@/shared/api'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'
import * as Sentry from '@sentry/nextjs'
import { createModuleLogger } from '@/shared/utils/logger'

const LAST_SUGGESTED_TRACK_KEY = 'last-suggested-track'

// Set up logger for this module
const logger = createModuleLogger('PlaylistRefresh')

export interface PlaylistRefreshService {
  refreshPlaylist(
    force?: boolean,
    params?: TrackSuggestionsState,
    onSnapshotMismatch?: () => void
  ): Promise<{
    success: boolean
    message: string
    timestamp: string
    diagnosticInfo?: Record<string, unknown>
    forceRefresh?: boolean
    playerStateRefresh?: boolean
  }>
  getUpcomingTracks(
    playlist: SpotifyPlaylistItem,
    currentTrackId: string | null
  ): TrackItem[]
  autoRemoveFinishedTrack(params: {
    playlistId: string
    currentTrackId: string | null
    playlistTracks: TrackItem[]
    playbackState: SpotifyPlaybackState | null
    songsBetweenRepeats: number
  }): Promise<boolean>
  getLastSuggestedTrack(): {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
    genres: string[]
  } | null
}

export class PlaylistRefreshServiceImpl implements PlaylistRefreshService {
  private static instance: PlaylistRefreshServiceImpl
  private lastAddTime: number = 0
  private readonly retryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000
  }
  private readonly FIXED_PLAYLIST_NAME = '3B Saigon'
  private readonly spotifyApi: SpotifyApiClient
  private lastSuggestedTrack: {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
    genres: string[]
  } | null = null
  private isRefreshing = false
  private readonly TIMEOUT_MS = 45000 // 45 seconds timeout
  private lastSnapshotId: string | null = null

  private constructor() {
    this.spotifyApi = SpotifyApiService.getInstance()
    this.loadLastSuggestedTrack()
  }

  private loadLastSuggestedTrack(): void {
    try {
      if (typeof window !== 'undefined') {
        const savedTrack = localStorage.getItem(LAST_SUGGESTED_TRACK_KEY)
        if (savedTrack) {
          this.lastSuggestedTrack = JSON.parse(savedTrack)
        }
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error loading last suggested track:',
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  private async updateServerCache(track: {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
    genres: string[]
  }): Promise<void> {
    try {
      await fetch('/api/track-suggestions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(track)
      })
    } catch (error) {
      logger(
        'ERROR',
        'Error updating server cache:',
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  private saveLastSuggestedTrack(): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          LAST_SUGGESTED_TRACK_KEY,
          JSON.stringify(this.lastSuggestedTrack)
        )
        // Also update the server cache
        if (this.lastSuggestedTrack) {
          void this.updateServerCache(this.lastSuggestedTrack)
        }
      }
    } catch (error) {
      logger(
        'ERROR',
        'Error saving last suggested track:',
        undefined,
        error instanceof Error ? error : undefined
      )
    }
  }

  public static getInstance(): PlaylistRefreshServiceImpl {
    if (!PlaylistRefreshServiceImpl.instance) {
      PlaylistRefreshServiceImpl.instance = new PlaylistRefreshServiceImpl()
    } else {
      // Ensure the track is loaded from localStorage
      if (typeof window !== 'undefined') {
        try {
          const savedTrack = localStorage.getItem(LAST_SUGGESTED_TRACK_KEY)
          if (savedTrack) {
            PlaylistRefreshServiceImpl.instance.lastSuggestedTrack =
              JSON.parse(savedTrack)
          }
        } catch (error) {
          logger(
            'ERROR',
            'Error loading from localStorage in getInstance:',
            undefined,
            error instanceof Error ? error : undefined
          )
        }
      }
    }
    return PlaylistRefreshServiceImpl.instance
  }

  // For testing purposes only
  public static resetInstance(): void {
    PlaylistRefreshServiceImpl.instance = undefined as any
  }

  private async getFixedPlaylist(): Promise<{
    playlist: SpotifyPlaylistItem | null
    snapshotId: string | null
  }> {
    const playlists = await this.spotifyApi.getPlaylists()
    const fixedPlaylist = playlists.items.find(
      (playlist) => playlist.name === this.FIXED_PLAYLIST_NAME
    )

    if (!fixedPlaylist) {
      return { playlist: null, snapshotId: null }
    }

    const playlist = await this.spotifyApi.getPlaylist(fixedPlaylist.id)
    return { playlist, snapshotId: playlist.snapshot_id }
  }

  private async getCurrentlyPlaying(): Promise<{
    id: string | null
    error?: string
  }> {
    try {
      const response = await this.spotifyApi.getCurrentlyPlaying()
      return { id: response.item?.id ?? null }
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        return {
          id: null,
          error:
            'Spotify authentication failed. Please check your access token.'
        }
      }
      return { id: null }
    }
  }

  private async tryAddTrack(
    trackUri: string,
    playlistId: string
  ): Promise<boolean> {
    try {
      await this.spotifyApi.addTrackToPlaylist(playlistId, trackUri)
      return true
    } catch (error) {
      if (error instanceof Error) {
        console.error('Error adding track to playlist:', {
          error: error.message,
          trackUri,
          playlistId,
          timestamp: new Date().toISOString()
        })
      }
      throw error
    }
  }

  private async addSuggestedTrackToPlaylist(
    upcomingTracks: TrackItem[],
    playlistId: string,
    currentTrackId: string | null,
    allPlaylistTracks: TrackItem[],
    params?: TrackSuggestionsState
  ): Promise<{ success: boolean; error?: string; searchDetails?: unknown }> {
    // Get saved params from localStorage
    const savedParams =
      typeof window !== 'undefined'
        ? (JSON.parse(
            localStorage.getItem('track-suggestions-state') ?? '{}'
          ) as {
            genres: Genre[]
            yearRange: [number, number]
            popularity: number
            allowExplicit: boolean
            maxSongLength: number
            songsBetweenRepeats: number
            maxOffset: number
          })
        : null

    const mergedParams = {
      genres:
        params?.genres ??
        savedParams?.genres ??
        (Array.from(FALLBACK_GENRES) as Genre[]),
      yearRange: params?.yearRange ??
        savedParams?.yearRange ?? [1950, new Date().getFullYear()],
      popularity: params?.popularity ?? savedParams?.popularity ?? 50,
      allowExplicit:
        params?.allowExplicit ?? savedParams?.allowExplicit ?? false,
      maxSongLength: params?.maxSongLength ?? savedParams?.maxSongLength ?? 3,
      songsBetweenRepeats:
        params?.songsBetweenRepeats ?? savedParams?.songsBetweenRepeats ?? 5,
      maxOffset:
        params?.maxOffset ?? savedParams?.maxOffset ?? DEFAULT_MAX_OFFSET
    }

    // Add logging to show parameter sources
    logger(
      'INFO',
      `Track suggestion parameters - provided: ${params ? 'yes' : 'no'}, saved: ${savedParams ? 'yes' : 'no'}, final: genres=${mergedParams.genres.length}, popularity=${mergedParams.popularity}, maxOffset=${mergedParams.maxOffset}`
    )

    // Check if we have 3 or fewer upcoming tracks (need to add more)
    if (upcomingTracks.length > 3) {
      return {
        success: false,
        error: 'Enough tracks remaining'
      }
    }

    const existingTrackIds = Array.from(
      new Set(allPlaylistTracks.map((track) => track.track.id))
    )

    try {
      const result = await findSuggestedTrack(
        existingTrackIds,
        currentTrackId,
        DEFAULT_MARKET,
        mergedParams
      )

      if (!result.track) {
        return {
          success: false,
          error: 'No suitable track found after trying all genres'
        }
      }

      const success = await this.tryAddTrack(result.track.uri, playlistId)
      const searchDetails = {
        ...result.searchDetails,
        trackDetails: result.searchDetails.trackDetails
      }

      if (success) {
        this.lastSuggestedTrack = {
          name: result.track.name,
          artist: result.track.artists[0].name,
          album: result.track.album.name,
          uri: result.track.uri,
          popularity: result.track.popularity,
          duration_ms: result.track.duration_ms,
          preview_url: result.track.preview_url ?? null,
          genres: [
            result.searchDetails.genresTried[
              result.searchDetails.genresTried.length - 1
            ]
          ]
        }

        // Save to localStorage if in browser
        if (typeof window !== 'undefined') {
          this.saveLastSuggestedTrack()
        }

        return {
          success: true,
          searchDetails
        }
      } else {
        return {
          success: false,
          error: 'Failed to add track to playlist',
          searchDetails
        }
      }
    } catch (error) {
      Sentry.logger.error('Error in addSuggestedTrackToPlaylist', {
        error: error instanceof Error ? error.message : 'Unknown error',
        playlistId,
        currentTrackId,
        params,
        timestamp: new Date().toISOString()
      })
      console.error('Error in addSuggestedTrackToPlaylist:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        playlistId,
        currentTrackId,
        params,
        timestamp: new Date().toISOString()
      })
      return {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        searchDetails: undefined
      }
    }
  }

  getUpcomingTracks(
    playlist: SpotifyPlaylistItem,
    currentTrackId: string | null
  ): TrackItem[] {
    return filterUpcomingTracks(playlist.tracks.items, currentTrackId)
  }

  async autoRemoveFinishedTrack(params: {
    playlistId: string
    currentTrackId: string | null
    playlistTracks: TrackItem[]
    playbackState: SpotifyPlaybackState | null
    songsBetweenRepeats: number
  }): Promise<boolean> {
    return handleOperationError(
      async () =>
        autoRemoveTrack({
          ...params,
          onSuccess: () => {
            // Remove console.log
          },
          onError: (error) => {
            console.error(
              '[PlaylistRefresh] Error removing finished track:',
              error
            )
          }
        }),
      'PlaylistRefresh.autoRemoveFinishedTrack'
    )
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Operation timed out'))
      }, timeoutMs)
    })

    return Promise.race([promise, timeoutPromise])
  }

  async refreshPlaylist(
    force = false,
    params?: TrackSuggestionsState,
    onSnapshotMismatch?: () => void
  ): Promise<{
    success: boolean
    message: string
    timestamp: string
    diagnosticInfo?: Record<string, unknown>
    forceRefresh?: boolean
    playerStateRefresh?: boolean
  }> {
    if (this.isRefreshing) {
      return {
        success: false,
        message: 'Refresh operation already in progress',
        timestamp: new Date().toISOString()
      }
    }

    try {
      this.isRefreshing = true

      const { playlist, snapshotId } = await this.withTimeout(
        this.getFixedPlaylist(),
        this.TIMEOUT_MS
      )

      if (!playlist) {
        return {
          success: false,
          message: `No playlist found with name: ${this.FIXED_PLAYLIST_NAME}`,
          timestamp: new Date().toISOString()
        }
      }

      // Check if the snapshot_id has changed
      const hasPlaylistChanged = this.lastSnapshotId !== snapshotId
      logger(
        'INFO',
        `Playlist snapshot changed: ${hasPlaylistChanged ? 'Yes' : 'No'}`
      )

      // Update the lastSnapshotId
      this.lastSnapshotId = snapshotId

      if (hasPlaylistChanged && onSnapshotMismatch) {
        onSnapshotMismatch()
      }

      const { id: currentTrackId, error: playbackError } =
        await this.withTimeout(this.getCurrentlyPlaying(), this.TIMEOUT_MS)

      if (playbackError) {
        return {
          success: false,
          message: playbackError,
          timestamp: new Date().toISOString()
        }
      }

      const upcomingTracks = this.getUpcomingTracks(playlist, currentTrackId)

      const playbackState = await this.withTimeout(
        this.spotifyApi.getPlaybackState(),
        this.TIMEOUT_MS
      )

      const removedTrack = await this.withTimeout(
        this.autoRemoveFinishedTrack({
          playlistId: playlist.id,
          currentTrackId,
          playlistTracks: playlist.tracks.items,
          playbackState,
          songsBetweenRepeats: params?.songsBetweenRepeats || 5
        }),
        this.TIMEOUT_MS
      )

      // Track whether we need to resume playback
      let shouldResumePlayback =
        hasPlaylistChanged &&
        playbackState?.is_playing &&
        upcomingTracks.length <= 2

      const diagnosticInfo = {
        currentTrackId,
        totalTracks: playlist.tracks.items.length,
        upcomingTracksCount: upcomingTracks.length,
        playlistTrackIds: playlist.tracks.items.map((t) => t.track.id),
        upcomingTrackIds: upcomingTracks.map((t) => t.track.id),
        removedTrack,
        addedTrack: false
      }

      const result = await this.withTimeout(
        this.addSuggestedTrackToPlaylist(
          upcomingTracks,
          playlist.id,
          currentTrackId,
          playlist.tracks.items,
          params
        ),
        this.TIMEOUT_MS
      )

      if (!result.success) {
        if (result.error === 'Enough tracks remaining') {
          Sentry.logger.info(
            '[PlaylistRefresh] Enough tracks remaining, no action needed',
            {
              error: result.error,
              diagnosticInfo,
              params,
              timestamp: new Date().toISOString()
            }
          )
          // Don't return here yet. Fall through to the playback check.
        } else {
          Sentry.logger.error('[PlaylistRefresh] Failed to add track', {
            error: result.error,
            diagnosticInfo,
            params,
            timestamp: new Date().toISOString()
          })
          console.error('[PlaylistRefresh] Failed to add track:', {
            error: result.error,
            diagnosticInfo,
            params,
            timestamp: new Date().toISOString()
          })
          // For actual errors, we return.
          return {
            success: false,
            message: result.error || 'Failed to add track',
            timestamp: new Date().toISOString(),
            diagnosticInfo,
            forceRefresh: force
          }
        }
      }

      diagnosticInfo.addedTrack = result.success

      // Resume playback if playlist changed OR track was successfully added
      if (
        shouldResumePlayback ||
        (result.success && playbackState?.is_playing)
      ) {
        logger('INFO', 'Calling resume playback endpoint')
        await this.spotifyApi.resumePlayback()
      }

      // Now, construct the final return object
      if (result.success) {
        return {
          success: true,
          message: 'Track added successfully',
          timestamp: new Date().toISOString(),
          diagnosticInfo,
          forceRefresh: force,
          playerStateRefresh: true
        }
      } else {
        // This will be for "Enough tracks remaining"
        return {
          success: false, // It wasn't a "success" in terms of adding a track
          message: result.error || 'No track added',
          timestamp: new Date().toISOString(),
          diagnosticInfo,
          forceRefresh: force,
          // We might have refreshed the player state by resuming
          playerStateRefresh: shouldResumePlayback
        }
      }
    } catch (error) {
      Sentry.logger.error('[PlaylistRefresh] Error in refreshPlaylist', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        params,
        timestamp: new Date().toISOString()
      })
      console.error('[PlaylistRefresh] Error in refreshPlaylist:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        params,
        timestamp: new Date().toISOString()
      })
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to refresh playlist',
        timestamp: new Date().toISOString()
      }
    } finally {
      this.isRefreshing = false
    }
  }

  getLastSuggestedTrack(): {
    name: string
    artist: string
    album: string
    uri: string
    popularity: number
    duration_ms: number
    preview_url: string | null
    genres: string[]
  } | null {
    // If we don't have a track in memory, try to load from localStorage
    if (!this.lastSuggestedTrack && typeof window !== 'undefined') {
      try {
        const savedTrack = localStorage.getItem(LAST_SUGGESTED_TRACK_KEY)
        if (savedTrack) {
          this.lastSuggestedTrack = JSON.parse(savedTrack)
        }
      } catch (error) {
        console.error(
          '[PlaylistRefresh] Error loading from localStorage in getLastSuggestedTrack:',
          error
        )
      }
    }

    return this.lastSuggestedTrack
  }
}
