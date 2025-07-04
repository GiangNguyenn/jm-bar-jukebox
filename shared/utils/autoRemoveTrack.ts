import { TrackItem, SpotifyPlaybackState } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from './errorHandling'

interface AutoRemoveTrackParams {
  playlistId: string
  currentTrackId: string | null
  playlistTracks: TrackItem[]
  playbackState: SpotifyPlaybackState | null
  songsBetweenRepeats: number
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export async function autoRemoveTrack({
  playlistId,
  currentTrackId,
  playlistTracks,
  playbackState,
  songsBetweenRepeats,
  onSuccess,
  onError
}: AutoRemoveTrackParams): Promise<boolean> {
  if (!playlistTracks.length) return false

  // If playlist is not longer than songsBetweenRepeats, don't remove anything
  if (playlistTracks.length <= songsBetweenRepeats) {
    return false
  }

  // Get the first track to potentially remove
  const trackToRemove = playlistTracks[0]
  if (!trackToRemove) {
    console.error('[Auto Remove] No tracks to remove')
    return false
  }

  // Don't remove the track if it's currently playing
  if (currentTrackId && trackToRemove.track.id === currentTrackId) {
    console.log(
      '[Auto Remove] First track is currently playing, skipping removal'
    )
    return false
  }

  try {
    await handleOperationError(
      async () => {
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: 'DELETE',
          body: {
            tracks: [{ uri: trackToRemove.track.uri }]
          }
        })
        console.log(
          `[Auto Remove] Successfully removed track: ${trackToRemove.track.name}`
        )
        onSuccess?.()
      },
      'AutoRemoveTrack',
      (error) => {
        console.error('[Auto Remove] Error removing track:', error)
        onError?.(error)
      }
    )
    return true
  } catch (error) {
    return false
  }
}
