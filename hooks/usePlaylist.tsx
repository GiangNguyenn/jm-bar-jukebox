import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  SpotifyPlaylistItem,
  TrackItem,
  SpotifyPlaybackState
} from '@/shared/types'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { filterUpcomingTracks } from '@/lib/utils'
import useSWR from 'swr'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'
import { Genre } from '@/services/trackSuggestion'

interface SpotifyPlaylistObjectFull {
  tracks: {
    items: TrackItem[]
  }
}

interface CurrentlyPlayingResponse {
  item: {
    id: string
  }
}

interface TrackSuggestionsState {
  genres: Genre[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
}

const fetcher = async (playlistId: string) => {
  return handleOperationError(
    async () => {
      const response = await sendApiRequest<SpotifyPlaylistObjectFull>({
        path: `playlists/${playlistId}`,
        method: 'GET'
      })
      return response
    },
    'PlaylistFetcher',
    (error) => {
      console.error(`[Playlist] Error fetching playlist ${playlistId}:`, error)
    }
  )
}

const currentlyPlayingFetcher = async () => {
  return handleOperationError(
    async () => {
      const response = await sendApiRequest<CurrentlyPlayingResponse>({
        path: 'me/player/currently-playing',
        method: 'GET'
      })
      return response
    },
    'CurrentlyPlayingFetcher',
    (error) => {
      console.error('[Playlist] Error fetching currently playing track:', error)
    }
  )
}

export const usePlaylist = (
  playlistId: string,
  trackSuggestionsState?: TrackSuggestionsState
) => {
  const {
    data: playlist,
    error: playlistError,
    mutate: refreshPlaylist
  } = useSWR(
    playlistId ? ['playlist', playlistId] : null,
    () => fetcher(playlistId),
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  )

  const { data: currentlyPlaying, error: currentlyPlayingError } = useSWR(
    'currently-playing',
    currentlyPlayingFetcher,
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false
    }
  )

  // Filter upcoming tracks
  const upcomingTracks = useMemo(() => {
    if (!playlist || !currentlyPlaying?.item?.id) return []
    return filterUpcomingTracks(playlist.tracks.items, currentlyPlaying.item.id)
  }, [playlist, currentlyPlaying?.item?.id])

  const handleRefresh = async (
    trackSuggestionsState?: TrackSuggestionsState
  ) => {
    try {
      if (trackSuggestionsState) {
        await sendApiRequest({
          path: 'track-suggestions/refresh',
          method: 'POST',
          body: trackSuggestionsState
        })
      }
      // Force a revalidation with fresh data
      await refreshPlaylist(
        async () => {
          const response = await sendApiRequest<SpotifyPlaylistObjectFull>({
            path: `playlists/${playlistId}`,
            method: 'GET'
          })
          return response
        },
        {
          revalidate: true,
          populateCache: true,
          rollbackOnError: true
        }
      )
    } catch (error) {
      console.error(
        `[Playlist] Error refreshing playlist ${playlistId}:`,
        error
      )
    }
  }

  return {
    playlist,
    upcomingTracks,
    currentlyPlaying,
    error: playlistError || currentlyPlayingError,
    refreshPlaylist: handleRefresh
  }
}
