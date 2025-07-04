import { sendApiRequest } from '@/shared/api'
import {
  validateDevice,
  transferPlaybackToDevice,
  cleanupOtherDevices,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'
import {
  SpotifySDKPlaybackState,
  SpotifyPlayerInstance,
  SpotifySDK
} from '@/shared/types/spotify'
import { tokenManager } from '@/shared/token/tokenManager'

type SpotifySDKEventTypes =
  | 'ready'
  | 'not_ready'
  | 'player_state_changed'
  | 'initialization_error'
  | 'authentication_error'
  | 'account_error'
  | 'playback_error'

type SpotifySDKEventCallbacks = {
  ready: (event: { device_id: string }) => void
  not_ready: (event: { device_id: string }) => void
  player_state_changed: (state: SpotifySDKPlaybackState) => void
  initialization_error: (event: { message: string }) => void
  authentication_error: (event: { message: string }) => void
  account_error: (event: { message: string }) => void
  playback_error: (event: { message: string }) => void
}

// @ts-ignore - Spotify SDK type definitions are incomplete
declare global {
  interface Window {
    Spotify: typeof Spotify
    spotifyPlayerInstance: any // Use any to avoid type conflicts
    onSpotifyWebPlaybackSDKError?: (error: any) => void // Added for local error handler
  }
}

// Player lifecycle management service
class PlayerLifecycleService {
  private playerRef: Spotify.Player | null = null
  private cleanupTimeoutRef: NodeJS.Timeout | null = null
  private notReadyTimeoutRef: NodeJS.Timeout | null = null
  private reconnectionTimeoutRef: NodeJS.Timeout | null = null
  private verificationTimeoutRef: NodeJS.Timeout | null = null
  private addLog:
    | ((
        level: LogLevel,
        message: string,
        context?: string,
        error?: Error
      ) => void)
    | null = null

  // State machine configuration
  private readonly STATE_MACHINE_CONFIG = {
    GRACE_PERIODS: {
      notReadyToReconnecting: 3000, // 3 seconds before considering device lost
      reconnectingToError: 15000, // 15 seconds before giving up on reconnection
      verificationTimeout: 5000 // 5 seconds for device verification (reduced from 10)
    },
    MAX_CONSECUTIVE_FAILURES: 3,
    MAX_RECONNECTION_ATTEMPTS: 5,
    STATUS_DEBOUNCE: 1000 // 1 second debounce for status changes
  } as const

  setLogger(
    logger: (
      level: LogLevel,
      message: string,
      context?: string,
      error?: Error
    ) => void
  ) {
    this.addLog = logger
  }

  private log(level: LogLevel, message: string, error?: unknown) {
    if (this.addLog) {
      this.addLog(
        level,
        message,
        'PlayerLifecycle',
        error instanceof Error ? error : undefined
      )
    } else {
      // Fallback logging when logger is not set up
      const logMessage = `[PlayerLifecycle] ${level}: ${message}`
      if (error) {
        console.error(logMessage, error)
      } else {
        console.log(logMessage)
      }
    }
  }

  // Robust device verification with timeout
  private async verifyDeviceWithTimeout(deviceId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.log('WARN', 'Device verification timed out')
        resolve(false)
      }, this.STATE_MACHINE_CONFIG.GRACE_PERIODS.verificationTimeout)

      this.verificationTimeoutRef = timeout

      validateDevice(deviceId)
        .then((result) => {
          clearTimeout(timeout)
          resolve(result.isValid && !(result.device?.isRestricted ?? false))
        })
        .catch((error) => {
          clearTimeout(timeout)
          this.log('ERROR', 'Device verification failed', error)
          resolve(false)
        })
    })
  }

  // Handle 'not_ready' with grace period
  private async handleNotReady(
    deviceId: string,
    onStatusChange: (status: string, error?: string) => void
  ) {
    this.log('WARN', `Device ${deviceId} reported as not ready`)

    // Clear any existing not-ready timeout
    if (this.notReadyTimeoutRef) {
      clearTimeout(this.notReadyTimeoutRef)
    }

    // Set a grace period before transitioning to reconnecting
    this.notReadyTimeoutRef = setTimeout(async () => {
      onStatusChange('reconnecting')

      // Try to recover by checking for alternative devices
      try {
        const devicesResponse = await sendApiRequest<{
          devices: Array<{
            id: string
            is_active: boolean
            name: string
          }>
        }>({
          path: 'me/player/devices',
          method: 'GET'
        })

        if (devicesResponse?.devices) {
          const availableDevice = devicesResponse.devices.find(
            (d) => d.id !== deviceId && d.is_active
          )

          if (availableDevice) {
            this.log('INFO', 'Found alternative device, attempting transfer')
            const transferSuccess = await transferPlaybackToDevice(
              availableDevice.id
            )
            if (transferSuccess) {
              onStatusChange('ready')
              return
            }
          }
        }
      } catch (error) {
        this.log('ERROR', 'Failed to find alternative device', error)
      }

      // If recovery failed, transition to error
      onStatusChange('error', 'Device recovery failed')
    }, this.STATE_MACHINE_CONFIG.GRACE_PERIODS.notReadyToReconnecting)
  }

  createPlayer(
    onStatusChange: (status: string, error?: string) => void,
    onDeviceIdChange: (deviceId: string) => void,
    onPlaybackStateChange: (state: any) => void
  ): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      if (this.playerRef) {
        this.log('INFO', 'Player already exists, returning current device ID')
        reject(new Error('Player already exists'))
        return
      }

      this.log('INFO', 'Creating new Spotify player instance')

      if (typeof window.Spotify === 'undefined') {
        this.log('ERROR', 'Spotify SDK not loaded')
        onStatusChange('error', 'Spotify SDK not loaded')
        reject(new Error('Spotify SDK not loaded'))
        return
      }

      try {
        // Set up device management logger
        setDeviceManagementLogger(this.addLog || console.log)

        // Clear any existing cleanup timeout
        if (this.cleanupTimeoutRef) {
          clearTimeout(this.cleanupTimeoutRef)
        }

        // Set status to initializing (the state machine will handle duplicate transitions)
        onStatusChange('initializing')

        const player = new window.Spotify.Player({
          name: 'Jukebox Player',
          getOAuthToken: async (cb) => {
            try {
              this.log('INFO', 'Requesting token from token manager')
              const token = await tokenManager.getToken()
              this.log('INFO', 'Token received from token manager')
              cb(token)
            } catch (error) {
              this.log('ERROR', 'Error getting token from token manager', error)
              throw error
            }
          },
          volume: 0.5
        })

        // Set up event listeners
        player.addListener('ready', async ({ device_id }) => {
          this.log('INFO', `Ready with device ID: ${device_id}`)

          // Clear any not-ready timeout since we're ready
          if (this.notReadyTimeoutRef) {
            clearTimeout(this.notReadyTimeoutRef)
          }

          this.log('INFO', 'Setting status to verifying')
          onStatusChange('verifying')

          // Use robust device verification with timeout
          const deviceVerified = await this.verifyDeviceWithTimeout(device_id)
          if (!deviceVerified) {
            this.log(
              'WARN',
              'Device setup verification failed, but proceeding anyway'
            )
            // Don't fail the initialization, just warn and proceed
          } else {
            this.log('INFO', 'Device setup verification successful')
          }

          this.log('INFO', 'Setting device as ready')
          onDeviceIdChange(device_id)

          // Automatically transfer playback to the new device
          this.log(
            'INFO',
            `Transferring playback to new device ID: ${device_id}`
          )
          const transferSuccess = await transferPlaybackToDevice(device_id)
          if (transferSuccess) {
            this.log('INFO', 'Playback transferred successfully')
            onStatusChange('ready')
          } else {
            this.log('ERROR', 'Failed to transfer playback to new device')
            onStatusChange('error', 'Failed to transfer playback')
          }

          this.log('INFO', 'Setting status to ready')
          onStatusChange('ready')
          resolve(device_id)
        })

        player.addListener('not_ready', (event) => {
          this.handleNotReady(event.device_id, onStatusChange)
        })

        player.addListener('initialization_error', ({ message }) => {
          this.log('ERROR', `Failed to initialize: ${message}`)
          onStatusChange('error', `Initialization error: ${message}`)
          reject(new Error(message))
        })

        player.addListener('authentication_error', async ({ message }) => {
          this.log('ERROR', `Failed to authenticate: ${message}`)

          // Try to refresh token and recreate player
          try {
            this.log(
              'INFO',
              'Attempting automatic token refresh and player recovery'
            )

            // Clear token cache to force refresh
            tokenManager.clearCache()

            // Attempt to get fresh token
            await tokenManager.getToken()

            // Recreate player with fresh token
            this.log('INFO', 'Token refreshed, recreating player')
            onStatusChange('initializing', 'Refreshing authentication')

            // Destroy current player and recreate
            this.destroyPlayer()
            await this.createPlayer(
              onStatusChange,
              onDeviceIdChange,
              onPlaybackStateChange
            )
          } catch (error) {
            this.log(
              'ERROR',
              'Failed to recover from authentication error',
              error
            )
            onStatusChange('error', `Authentication error: ${message}`)
          }
        })

        player.addListener('account_error', ({ message }) => {
          this.log('ERROR', `Account error: ${message}`)
          onStatusChange('error', `Account error: ${message}`)
        })

        player.addListener('playback_error', ({ message }) => {
          this.log('ERROR', `Playback error: ${message}`)
          // Don't change status for playback errors, let health monitor handle recovery
          this.log(
            'WARN',
            'Playback error occurred, but recovery is handled by health monitor'
          )
        })

        player.addListener('player_state_changed', (state) => {
          if (!state) {
            this.log(
              'WARN',
              'Received null state in player_state_changed event. Device is likely inactive. Triggering recovery.'
            )
            onStatusChange('reconnecting', 'Device became inactive')
            return
          }

          this.log(
            'INFO',
            `player_state_changed event: paused=${state.paused}, loading=${state.loading}, position=${state.position}`
          )

          // Transform SDK state to our internal format
          const transformedState = {
            item: state.track_window?.current_track
              ? {
                  id: state.track_window.current_track.id,
                  name: state.track_window.current_track.name,
                  uri: state.track_window.current_track.uri,
                  duration_ms: state.track_window.current_track.duration_ms,
                  artists: state.track_window.current_track.artists.map(
                    (artist) => ({
                      name: artist.name,
                      id: artist.uri.split(':').pop() || ''
                    })
                  ),
                  album: {
                    name: state.track_window.current_track.album.name,
                    id:
                      state.track_window.current_track.album.uri
                        .split(':')
                        .pop() || ''
                  }
                }
              : null,
            is_playing: !state.paused,
            progress_ms: state.position,
            duration_ms: state.duration
          }

          onPlaybackStateChange(transformedState)
        })

        // Connect to Spotify
        const connected = await player.connect()
        if (!connected) {
          throw new Error('Failed to connect to Spotify')
        }

        // Store player instance
        this.playerRef = player
        window.spotifyPlayerInstance = player

        // Set up cleanup timeout
        this.cleanupTimeoutRef = setTimeout(
          () => {
            if (this.playerRef === player) {
              this.log(
                'INFO',
                'Cleanup timeout reached, player may need recovery'
              )
            }
          },
          5 * 60 * 1000
        ) // 5 minutes

        // The promise will be resolved by the 'ready' event
      } catch (error) {
        this.log('ERROR', 'Error creating player', error)
        reject(error)
      }
    })
  }

  destroyPlayer(): void {
    // Clear all timeouts
    if (this.cleanupTimeoutRef) {
      clearTimeout(this.cleanupTimeoutRef)
      this.cleanupTimeoutRef = null
    }
    if (this.notReadyTimeoutRef) {
      clearTimeout(this.notReadyTimeoutRef)
      this.notReadyTimeoutRef = null
    }
    if (this.reconnectionTimeoutRef) {
      clearTimeout(this.reconnectionTimeoutRef)
      this.reconnectionTimeoutRef = null
    }
    if (this.verificationTimeoutRef) {
      clearTimeout(this.verificationTimeoutRef)
      this.verificationTimeoutRef = null
    }

    if (this.playerRef) {
      this.playerRef.disconnect()
      this.playerRef = null
    }

    this.log('INFO', 'Player destroyed')
  }

  getPlayer(): Spotify.Player | null {
    return this.playerRef
  }

  async reloadSDK(): Promise<void> {
    this.log('INFO', 'Reloading Spotify SDK...')

    // Clear existing player reference
    this.playerRef = null

    // Clear global references
    if (typeof window !== 'undefined') {
      window.spotifyPlayerInstance = null
      delete (window as any).Spotify
    }

    // Remove existing SDK script if present
    const existingScript = document.querySelector(
      'script[src*="spotify-player.js"]'
    )
    if (existingScript) {
      existingScript.remove()
      this.log('INFO', 'Removed existing Spotify SDK script')
    }

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Reload the SDK script
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Window not available'))
        return
      }

      // Set up the ready callback
      const originalReady = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = () => {
        this.log('INFO', 'Spotify SDK reloaded successfully')
        if (originalReady) {
          originalReady()
        }
        resolve()
      }

      // Set up error callback
      const originalError = window.onSpotifyWebPlaybackSDKError
      window.onSpotifyWebPlaybackSDKError = (error: any) => {
        this.log('ERROR', 'Failed to reload Spotify SDK', error)
        if (originalError) {
          originalError(error)
        }
        reject(new Error(`SDK reload failed: ${error}`))
      }

      // Load the SDK script
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.onerror = () => {
        this.log('ERROR', 'Failed to load Spotify SDK script')
        reject(new Error('Failed to load Spotify SDK script'))
      }

      document.body.appendChild(script)

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('SDK reload timeout'))
      }, 10000)
    })
  }
}

// Export singleton instance
export const playerLifecycleService = new PlayerLifecycleService()
