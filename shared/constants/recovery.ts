import { RecoveryStep } from '../types/recovery'

export const MAX_RECOVERY_ATTEMPTS = 5
export const BASE_DELAY = 2000 // 2 seconds
export const VERIFICATION_TIMEOUT = 2000 // 2 seconds
export const RECOVERY_COOLDOWN = 5000 // 5 seconds
export const STATE_UPDATE_TIMEOUT = 5000 // 5 seconds
export const PLAYBACK_VERIFICATION_TIMEOUT = 15000 // 15 seconds
export const PLAYBACK_CHECK_INTERVAL = 1000 // 1 second
export const RECOVERY_STATUS_CLEAR_DELAY = 3000 // 3 seconds
export const STORED_STATE_MAX_AGE = 300000 // 5 minutes

export const RECOVERY_STEPS: RecoveryStep[] = [
  { message: 'Verifying device state...', weight: 0.3 },
  { message: 'Ensuring active device...', weight: 0.3 },
  { message: 'Restoring playback...', weight: 0.4 }
]

export const ERROR_MESSAGES = {
  INVALID_PLAYLIST_ID: 'Invalid playlist ID',
  DEVICE_TRANSFER_FAILED: 'Device transfer failed after multiple attempts',
  NO_DEVICE_ID: 'No device ID available',
  DEVICE_VERIFICATION_FAILED: 'Device verification failed after transfer',
  INVALID_PLAYBACK_STATE: 'Invalid playback state',
  RECOVERY_VERIFICATION_FAILED: 'Recovery verification failed',
  ALL_RECOVERY_ATTEMPTS_FAILED:
    'All recovery attempts failed. Reloading page...'
} as const

export const TOKEN_RECOVERY_CONFIG = {
  MAX_RETRY_ATTEMPTS: 2,
  RETRY_DELAYS: [1000, 3000], // Exponential backoff
  OFFLINE_THRESHOLD: 3 // Max consecutive failures before showing offline
} as const
