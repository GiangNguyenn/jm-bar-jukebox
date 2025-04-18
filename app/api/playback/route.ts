import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

interface PlaybackRequest {
  action: 'play' | 'skip'
  contextUri?: string
  deviceId?: string
  position_ms?: number
}

async function verifyDeviceActive(deviceId: string): Promise<boolean> {
  try {
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    console.log('[API Playback] Device verification state:', {
      deviceId,
      activeDeviceId: state?.device?.id,
      isActive: state?.device?.id === deviceId,
      deviceType: state?.device?.type,
      deviceName: state?.device?.name,
      isPlaying: state?.is_playing,
      timestamp: new Date().toISOString()
    })

    return state?.device?.id === deviceId
  } catch (error) {
    console.error('[API Playback] Error verifying device:', {
      error,
      deviceId,
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })
    return false
  }
}

async function transferPlaybackToDevice(
  deviceId: string,
  retryCount = 0
): Promise<void> {
  try {
    // First verify the device is still active
    const isDeviceActive = await verifyDeviceActive(deviceId)
    if (!isDeviceActive) {
      throw new Error('Device is no longer active')
    }

    console.log('[API Playback] Transferring playback to device:', {
      deviceId,
      retryCount,
      timestamp: new Date().toISOString()
    })

    await sendApiRequest({
      path: 'me/player',
      method: 'PUT',
      body: {
        device_ids: [deviceId],
        play: false
      }
    })

    // Verify the transfer was successful
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    console.log('[API Playback] Transfer verification state:', {
      deviceId,
      activeDeviceId: state?.device?.id,
      isActive: state?.device?.id === deviceId,
      timestamp: new Date().toISOString()
    })

    if (state?.device?.id !== deviceId) {
      throw new Error('Device transfer verification failed')
    }
  } catch (error) {
    console.error(`[API Playback] Transfer attempt ${retryCount + 1} failed:`, {
      error,
      deviceId,
      retryCount,
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    })

    if (retryCount < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
      return transferPlaybackToDevice(deviceId, retryCount + 1)
    }

    throw error
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { action, contextUri, deviceId, position_ms } =
      (await request.json()) as PlaybackRequest

    console.log('[API Playback] Received request:', {
      action,
      contextUri,
      deviceId,
      position_ms,
      timestamp: new Date().toISOString()
    })

    if (!deviceId) {
      return NextResponse.json(
        {
          error:
            'No active Spotify device found. Please wait for the player to initialize.'
        },
        { status: 400 }
      )
    }

    // Verify the device is still active before proceeding
    const isDeviceActive = await verifyDeviceActive(deviceId)
    if (!isDeviceActive) {
      return NextResponse.json(
        {
          error:
            'The Spotify player is no longer active. Please refresh the page and try again.'
        },
        { status: 400 }
      )
    }

    if (action === 'play') {
      try {
        // Get current playback state to check if another device is playing
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        console.log('[API Playback] Current playback state:', {
          isPlaying: currentState?.is_playing,
          currentDeviceId: currentState?.device?.id,
          currentDeviceName: currentState?.device?.name,
          currentTrack: currentState?.item?.name,
          timestamp: new Date().toISOString()
        })

        // If music is already playing on another device, don't take over
        if (currentState?.is_playing && currentState?.device?.id !== deviceId) {
          return NextResponse.json(
            {
              error: 'Music is already playing on another device',
              details: {
                currentDevice: currentState.device?.name,
                currentTrack: currentState.item?.name
              }
            },
            { status: 409 } // Conflict status code
          )
        }

        // Transfer playback to our web player with retries
        await transferPlaybackToDevice(deviceId)

        // Wait a bit for the device transfer to take effect
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Get the current state again to ensure we have the latest track info
        const latestState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        console.log('[API Playback] Latest state before playback:', {
          deviceId,
          contextUri,
          position_ms,
          currentTrack: latestState?.item?.name,
          timestamp: new Date().toISOString()
        })

        // Then start playback with the playlist and position
        await sendApiRequest({
          path: 'me/player/play',
          method: 'PUT',
          body: {
            context_uri: contextUri,
            position_ms: position_ms,
            offset: latestState?.item?.uri
              ? { uri: latestState.item.uri }
              : undefined
          }
        })
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        console.error('[API Playback] Detailed playback error:', {
          message: errorMessage,
          error,
          deviceId,
          contextUri,
          position_ms,
          timestamp: new Date().toISOString()
        })

        // Return a more specific error message
        return NextResponse.json(
          {
            error: `Failed to control playback: ${errorMessage}`,
            details: error
          },
          { status: 500 }
        )
      }
    } else if (action === 'skip') {
      try {
        console.log('[API Playback] Attempting to skip track:', {
          deviceId,
          timestamp: new Date().toISOString()
        })

        // The skip endpoint returns 204 No Content, so we don't need to parse the response
        await sendApiRequest({
          path: 'me/player/next',
          method: 'POST'
        })
      } catch (error: unknown) {
        console.error('[API Playback] Skip error:', {
          error,
          deviceId,
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        })
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error'
        return NextResponse.json(
          {
            error: `Failed to skip track: ${errorMessage}`,
            details: error
          },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API Playback] Top level error:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString()
    })
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        error: `Playback control failed: ${errorMessage}`,
        details: error
      },
      { status: 500 }
    )
  }
}
