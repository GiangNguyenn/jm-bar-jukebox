'use client'
import { useFixedPlaylist } from '@/hooks/useFixedPlaylist'
import { usePlaylist } from '@/hooks/usePlaylist'
import { useEffect, useState, useMemo, memo, useCallback } from 'react'
import useSearchTracks from '../hooks/useSearchTracks'
import { TrackDetails } from '@/shared/types'
import Playlist from '@/components/Playlist/Playlist'
import Loading from './loading'
import SearchInput from '@/components/SearchInput'
import { useDebounce } from 'use-debounce'
import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'

const STORAGE_KEY = 'track-suggestions-state'

interface PlaylistRefreshEvent extends CustomEvent {
  detail: {
    timestamp: number
  }
}

declare global {
  interface WindowEventMap {
    playlistRefresh: PlaylistRefreshEvent
  }
}

interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
}

const getTrackSuggestionsState = (): TrackSuggestionsState => {
  if (typeof window === 'undefined') {
    return {
      genres: Array.from(FALLBACK_GENRES),
      yearRange: [1950, new Date().getFullYear()],
      popularity: 50,
      allowExplicit: false,
      maxSongLength: 300,
      songsBetweenRepeats: 5
    }
  }

  const savedState = localStorage.getItem(STORAGE_KEY)

  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as Partial<TrackSuggestionsState>
      return {
        genres:
          Array.isArray(parsed.genres) && parsed.genres.length > 0
            ? parsed.genres
            : Array.from(FALLBACK_GENRES),
        yearRange: parsed.yearRange ?? [1950, new Date().getFullYear()],
        popularity: parsed.popularity ?? 50,
        allowExplicit: parsed.allowExplicit ?? false,
        maxSongLength: parsed.maxSongLength ?? 300,
        songsBetweenRepeats: parsed.songsBetweenRepeats ?? 5
      }
    } catch (error) {
      console.error(
        '[PARAM CHAIN] Failed to parse localStorage in getTrackSuggestionsState (page.tsx):',
        error
      )
      // If parsing fails, return default state
    }
  }

  return {
    genres: Array.from(FALLBACK_GENRES),
    yearRange: [1950, new Date().getFullYear()],
    popularity: 50,
    allowExplicit: false,
    maxSongLength: 300,
    songsBetweenRepeats: 5
  }
}

const Home = memo((): JSX.Element => {
  const {
    createPlaylist,
    fixedPlaylistId,
    isLoading: isCreatingPlaylist,
    isInitialFetchComplete
  } = useFixedPlaylist()
  const { playlist, refreshPlaylist } = usePlaylist(fixedPlaylistId ?? '')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([])
  const { searchTracks } = useSearchTracks()

  useEffect(() => {
    const initPlaylist = async (): Promise<void> => {
      if (!fixedPlaylistId && !isCreatingPlaylist && isInitialFetchComplete) {
        console.log('[Fixed Playlist] Created new playlist')
        try {
          await createPlaylist()
        } catch (error) {
          console.error('[Fixed Playlist] Error creating playlist:', error)
        }
      }
    }

    void initPlaylist()
  }, [
    createPlaylist,
    fixedPlaylistId,
    isCreatingPlaylist,
    isInitialFetchComplete
  ])

  const handleTrackAdded = useCallback(async (): Promise<void> => {
    const trackSuggestionsState = getTrackSuggestionsState()
    await refreshPlaylist(trackSuggestionsState)
  }, [refreshPlaylist])

  const [debouncedSearchQuery] = useDebounce(searchQuery, 300)

  useEffect(() => {
    const searchTrackDebounce = async (): Promise<void> => {
      try {
        if (debouncedSearchQuery !== '') {
          const tracks = await searchTracks(debouncedSearchQuery)
          setSearchResults(tracks)
        } else {
          setSearchResults([])
        }
      } catch (error) {
        console.error('[Search] Error searching tracks:', error)
        setSearchResults([])
      }
    }

    void searchTrackDebounce()
  }, [debouncedSearchQuery, searchTracks])

  const searchInputProps = useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      searchResults,
      setSearchResults,
      playlistId: fixedPlaylistId ?? '',
      onTrackAdded: handleTrackAdded
    }),
    [searchQuery, searchResults, fixedPlaylistId, handleTrackAdded]
  )

  if (isCreatingPlaylist || !playlist || !fixedPlaylistId) {
    return <Loading />
  }

  const { tracks } = playlist

  return (
    <div className='items-center justify-items-center space-y-3 p-4 pt-10 font-mono'>
      <SearchInput {...searchInputProps} />
      <Playlist tracks={tracks.items} />
    </div>
  )
})

Home.displayName = 'Home'

export default Home
