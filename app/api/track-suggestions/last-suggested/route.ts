import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'

export async function GET(): Promise<NextResponse> {
  try {
    const service = PlaylistRefreshServiceImpl.getInstance()
    console.log('[API Last Suggested Track] Service instance:', service)

    const lastSuggestedTrack = await Promise.resolve(
      service.getLastSuggestedTrack()
    )

    console.log('[API Last Suggested Track] Fetched track:', {
      timestamp: new Date().toISOString(),
      track: lastSuggestedTrack,
      serviceInstance: service
    })

    return NextResponse.json({ track: lastSuggestedTrack })
  } catch (error) {
    console.error('[API Last Suggested Track] Error:', error)
    return NextResponse.json(
      { error: 'Failed to get last suggested track' },
      { status: 500 }
    )
  }
}
