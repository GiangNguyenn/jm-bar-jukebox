import { useState, useRef, useCallback, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import type { SpotifyPlayerInstance } from '@/types/spotify'
import { debounce } from '@/lib/utils'

// Singleton to track initialization state
let isInitialized = false
let initializationPromise: Promise<void> | null = null
let playerInstance: SpotifyPlayerInstance | null = null

interface UseSpotifyPlayerStateReturn {
  error: string | null
  setError: (error: string | null) => void
  setDeviceId: (deviceId: string | null) => void
  setIsReady: (isReady: boolean) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
  deviceId: string | null
  isMounted: React.RefObject<boolean>
  reconnectAttempts: React.RefObject<number>
  MAX_RECONNECT_ATTEMPTS: number
  initializationCheckInterval: React.RefObject<NodeJS.Timeout | null>
  playlistRefreshInterval: React.RefObject<NodeJS.Timeout | null>
  checkPlayerReady: () => Promise<boolean>
  initializePlayer: () => Promise<void>
  reconnectPlayer: () => Promise<void>
  refreshPlayerState: () => Promise<void>
  refreshPlaylistState: () => Promise<void>
}

export function useSpotifyPlayerState(): UseSpotifyPlayerStateReturn {
  const [error, setError] = useState<string | null>(null)
  const setDeviceId = useSpotifyPlayer((state) => state.setDeviceId)
  const setIsReady = useSpotifyPlayer((state) => state.setIsReady)
  const setPlaybackState = useSpotifyPlayer((state) => state.setPlaybackState)
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isMounted = useRef(true)
  const reconnectAttempts = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 3
  const initializationCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const playlistRefreshInterval = useRef<NodeJS.Timeout | null>(null)

  const checkPlayerReady = useCallback(async (): Promise<boolean> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID in state, checking player state')
      return false
    }

    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state?.device?.id) {
        try {
          await sendApiRequest({
            path: 'me/player',
            method: 'PUT',
            body: {
              device_ids: [currentDeviceId],
              play: false
            }
          })
          await new Promise((resolve) => setTimeout(resolve, 2000))
          const newState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })
          const isReady = newState?.device?.id === currentDeviceId
          if (isReady) {
            console.log('[SpotifyPlayer] Player verified as ready after transfer')
            setIsReady(true)
          }
          return isReady
        } catch (_error) {
          console.error('[SpotifyPlayer] Error transferring playback:', _error)
          return false
        }
      }

      const isReady = state.device.id === currentDeviceId
      if (isReady) {
        console.log('[SpotifyPlayer] Player verified as ready')
        setIsReady(true)
      }
      return isReady
    } catch (_error) {
      console.error('[SpotifyPlayer] Error checking player ready:', _error)
      return false
    }
  }, [setIsReady])

  const initializePlayer = useCallback(async (): Promise<void> => {
    if (isInitialized && playerInstance) {
      return
    }

    if (initializationPromise) {
      await initializationPromise
      return
    }

    initializationPromise = (async () => {
      try {
        const response = await fetch('/api/token')
        if (!response.ok) {
          throw new Error('Failed to get Spotify token')
        }
        const { access_token } = await response.json()

        if (!window.Spotify) {
          throw new Error('Spotify SDK not loaded')
        }

        if (playerInstance) {
          return
        }

        const player = new window.Spotify.Player({
          name: 'JM Bar Jukebox',
          getOAuthToken: (cb: (token: string) => void) => {
            cb(access_token)
          },
          volume: 0.5
        })

        player.addListener('ready', async ({ device_id }: { device_id: string }) => {
          if (!isMounted.current) return
          console.log('[SpotifyPlayer] Player ready event received, device_id:', device_id)
          setDeviceId(device_id)

          try {
            const isReady = await checkPlayerReady()
            if (isReady) {
              console.log('[SpotifyPlayer] Player verified as ready')
              setIsReady(true)
              setError(null)
              reconnectAttempts.current = 0
              await refreshPlayerState()
              const finalCheck = await checkPlayerReady()
              if (finalCheck) {
                console.log('[SpotifyPlayer] Final ready check passed')
                setIsReady(true)
              } else {
                console.log('[SpotifyPlayer] Final ready check failed, attempting reconnect')
                await reconnectPlayer()
              }
            } else {
              console.log('[SpotifyPlayer] Initial ready check failed, attempting reconnect')
              await reconnectPlayer()
            }
          } catch (error) {
            console.error('[SpotifyPlayer] Error during ready handler:', error)
            await reconnectPlayer()
          }
        })

        player.addListener('not_ready', (_device_id: string) => {
          if (!isMounted.current) return
          setDeviceId(null)
          setIsReady(false)
          void reconnectPlayer()
        })

        player.addListener('player_state_changed', (state: SpotifyPlaybackState) => {
          if (!isMounted.current) return
          try {
            console.log('[SpotifyPlayer] State changed:', state)
            setPlaybackState(state)
            if (state?.device?.id === deviceId) {
              setIsReady(true)
            }
          } catch (error) {
            console.error('[SpotifyPlayer] Error handling state change:', error)
          }
        })

        player.addListener('initialization_error', ({ message }: { message: string }) => {
          if (!isMounted.current) return
          setError(`Failed to initialize: ${message}`)
          setIsReady(false)
        })

        player.addListener('authentication_error', ({ message }: { message: string }) => {
          if (!isMounted.current) return
          setError(`Failed to authenticate: ${message}`)
          setIsReady(false)
        })

        player.addListener('account_error', ({ message }: { message: string }) => {
          if (!isMounted.current) return
          setError(`Failed to validate Spotify account: ${message}`)
          setIsReady(false)
        })

        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify player')
        }

        playerInstance = player
        window.spotifyPlayerInstance = player
        isInitialized = true

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Player ready timeout'))
          }, 10000)

          const readyHandler = async ({ device_id }: { device_id: string }) => {
            try {
              setDeviceId(device_id)
              await new Promise((resolve) => setTimeout(resolve, 1000))
              const currentDeviceId = useSpotifyPlayer.getState().deviceId

              if (!currentDeviceId) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
                const retryDeviceId = useSpotifyPlayer.getState().deviceId
                if (!retryDeviceId) {
                  throw new Error('Device ID not set in state after retry')
                }
              }

              let isReady = false
              let attempts = 0
              const maxAttempts = 3

              while (!isReady && attempts < maxAttempts) {
                isReady = await checkPlayerReady()
                if (!isReady) {
                  attempts++
                  if (attempts < maxAttempts) {
                    await new Promise((resolve) => setTimeout(resolve, 2000))
                  }
                }
              }

              if (isReady) {
                clearTimeout(timeout)
                player.removeListener('ready', readyHandler)
                resolve()
              } else {
                reject(new Error('Player verification failed after all attempts'))
              }
            } catch (error) {
              reject(error)
            }
          }

          player.addListener('ready', readyHandler)
        }).catch((error) => {
          throw error
        })

        try {
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })
          if (state?.device?.id) {
            setDeviceId(state.device.id)
            setIsReady(true)
          }
        } catch (error) {
          // Ignore error in immediate check
        }

        if (initializationCheckInterval.current) {
          clearInterval(initializationCheckInterval.current)
        }
        initializationCheckInterval.current = setInterval(async () => {
          if (deviceId) {
            const isReady = await checkPlayerReady()
            if (!isReady) {
              await reconnectPlayer()
            } else {
              setIsReady(true)
            }
          }
        }, 10000)
      } catch (_error) {
        if (!isMounted.current) return
        setError(_error instanceof Error ? _error.message : 'Failed to initialize Spotify player')
        setIsReady(false)
      } finally {
        initializationPromise = null
      }
    })()

    await initializationPromise
  }, [isInitialized, playerInstance, isMounted, setError, setIsReady, checkPlayerReady, deviceId, setDeviceId, setPlaybackState])

  const reconnectPlayer = useCallback(async (): Promise<void> => {
    if (!isMounted.current || reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return

    reconnectAttempts.current++

    try {
      if (playerInstance) {
        await playerInstance.disconnect()
        playerInstance = null
      }

      isInitialized = false
      initializationPromise = null

      await initializePlayer()
      reconnectAttempts.current = 0
    } catch (_error) {
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(reconnectPlayer, 2000)
      } else {
        setError('Failed to reconnect to Spotify player after multiple attempts')
      }
    }
  }, [isMounted, playerInstance, initializePlayer, setError])

  const refreshPlayerState = useCallback(async (): Promise<void> => {
    if (!deviceId) {
      return
    }

    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id === deviceId) {
        setPlaybackState(state)
        setIsReady(true)
      } else {
        await reconnectPlayer()
      }
    } catch (_error) {
      if (_error instanceof Error && 'status' in _error && _error.status === 404) {
        await reconnectPlayer()
      }
    }
  }, [deviceId, setPlaybackState, setIsReady, reconnectPlayer])

  const refreshPlaylistState = useCallback(async (): Promise<void> => {
    const currentDeviceId = useSpotifyPlayer.getState().deviceId
    if (!currentDeviceId) {
      console.log('[SpotifyPlayer] No device ID, attempting to reconnect')
      await reconnectPlayer()
      return
    }

    try {
      console.log('[SpotifyPlayer] Starting playlist state refresh')
      console.log('[SpotifyPlayer] Dispatching playlistChecked event')
      window.dispatchEvent(
        new CustomEvent('playlistChecked', {
          detail: {
            timestamp: Date.now(),
            hasChanges: false
          }
        })
      )

      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (state?.device?.id === currentDeviceId) {
        console.log('[SpotifyPlayer] Device is active, updating state:', {
          isPlaying: state.is_playing,
          currentTrack: state.item?.name,
          progress: state.progress_ms
        })

        if (state.is_playing && state.context?.uri) {
          console.log('[SpotifyPlayer] Setting up playlist change status handler')

          const hasChanges = await new Promise<boolean>((resolve) => {
            const handler = (e: CustomEvent) => {
              console.log('[SpotifyPlayer] Received playlistChangeStatus response:', e.detail)
              window.removeEventListener('playlistChangeStatus', handler as EventListener)
              resolve(e.detail.hasChanges)
            }
            window.addEventListener('playlistChangeStatus', handler as EventListener)

            console.log('[SpotifyPlayer] Dispatching getPlaylistChangeStatus event')
            const statusEvent = new CustomEvent('getPlaylistChangeStatus')
            window.dispatchEvent(statusEvent)
          })

          if (hasChanges) {
            console.log('[SpotifyPlayer] Reinitializing playback with updated playlist')
            try {
              const currentTrackUri = state.item?.uri
              const currentPosition = state.progress_ms
              const isPlaying = state.is_playing

              await sendApiRequest({
                path: 'me/player/pause',
                method: 'PUT'
              })

              await sendApiRequest({
                path: 'me/player/play',
                method: 'PUT',
                body: {
                  context_uri: state.context.uri,
                  position_ms: currentPosition,
                  offset: { uri: currentTrackUri }
                }
              })

              if (!isPlaying) {
                await sendApiRequest({
                  path: 'me/player/pause',
                  method: 'PUT'
                })
              }

              console.log('[SpotifyPlayer] Playback reinitialized successfully')
            } catch (error) {
              console.error('[SpotifyPlayer] Error reinitializing playback:', error)
            }
          }
        }
      }
    } catch (_error) {
      console.error('[SpotifyPlayer] Error refreshing playlist state:', _error)
      if (_error instanceof Error && 'status' in _error && _error.status === 404) {
        await reconnectPlayer()
      }
    }
  }, [reconnectPlayer])

  const debouncedRefreshPlaylistState = useCallback(
    debounce(async () => {
      await refreshPlaylistState()
    }, 60000), // 1 minute
    [refreshPlaylistState]
  )

  useEffect(() => {
    if (playlistRefreshInterval.current) {
      clearInterval(playlistRefreshInterval.current)
    }

    // Set up the debounced refresh interval
    playlistRefreshInterval.current = setInterval(() => {
      debouncedRefreshPlaylistState()
    }, 10000) // Check every 10 seconds, but actual refresh will be debounced to 1 minute

    return () => {
      if (playlistRefreshInterval.current) {
        clearInterval(playlistRefreshInterval.current)
      }
    }
  }, [debouncedRefreshPlaylistState])

  return {
    error,
    setError,
    setDeviceId,
    setIsReady,
    setPlaybackState,
    deviceId,
    isMounted,
    reconnectAttempts,
    MAX_RECONNECT_ATTEMPTS,
    initializationCheckInterval,
    playlistRefreshInterval,
    checkPlayerReady,
    initializePlayer,
    reconnectPlayer,
    refreshPlayerState,
    refreshPlaylistState
  }
} 