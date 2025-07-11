import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Database } from '@/types/supabase'

// Configure the route to be dynamic
export const dynamic = 'force-dynamic'

interface UserMetadata {
  name?: string
  avatar_url?: string | null
}

interface SessionResponse {
  user: {
    id: string
    email: string | undefined
    name: string
    image: string | null
  }
  expires: number | undefined
}

interface ErrorResponse {
  error: string
  code: string
  status: number
}

export async function GET(): Promise<
  NextResponse<SessionResponse | ErrorResponse>
> {
  try {
    const cookieStore = cookies()

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          }
        }
      }
    )

    const {
      data: { session },
      error
    } = await supabase.auth.getSession()

    if (error) {
      console.error('Error getting session:', error)
      return NextResponse.json(
        {
          error: 'Not authenticated',
          code: 'UNAUTHENTICATED',
          status: 401
        },
        { status: 401 }
      )
    }

    if (!session) {
      return NextResponse.json(
        {
          error: 'Not authenticated',
          code: 'UNAUTHENTICATED',
          status: 401
        },
        { status: 401 }
      )
    }

    const user = session.user
    const userMetadata = user.user_metadata as UserMetadata

    const response: SessionResponse = {
      user: {
        id: user.id,
        email: user.email,
        name: userMetadata.name ?? '',
        image: userMetadata.avatar_url ?? null
      },
      expires: session.expires_at
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in session route:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        status: 500
      },
      { status: 500 }
    )
  }
}
