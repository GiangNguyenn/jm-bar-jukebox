'use client'

import { ALL_SPOTIFY_GENRES } from '@/shared/constants/trackSuggestion'
import { useState, useMemo, useCallback } from 'react'
import { Combobox } from '@headlessui/react'
import { ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { useDebounce } from 'use-debounce'
import { FixedSizeList as List, ListChildComponentProps } from 'react-window'
import { Check } from 'lucide-react'
import { type Genre } from '@/shared/constants/trackSuggestion'

interface GenresSelectorProps {
  selectedGenres: Genre[]
  onGenresChange: (genres: Genre[]) => void
}

// Convert readonly tuple to mutable array
const SPOTIFY_GENRES: string[] = [...ALL_SPOTIFY_GENRES]

// Pre-compute lowercase versions of all genres
const LOWER_CASE_GENRES: string[] = SPOTIFY_GENRES.map((genre) =>
  genre.toLowerCase()
)

export function GenresSelector({
  selectedGenres,
  onGenresChange
}: GenresSelectorProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [debouncedQuery] = useDebounce(query, 300)

  const filteredGenres = useMemo(() => {
    if (!Array.isArray(SPOTIFY_GENRES)) return []
    if (debouncedQuery === '') return SPOTIFY_GENRES

    const lowerQuery = debouncedQuery.toLowerCase()
    const results: string[] = []

    // Use a more efficient search by checking if the query is a substring
    for (let i = 0; i < SPOTIFY_GENRES.length; i++) {
      if (LOWER_CASE_GENRES[i].includes(lowerQuery)) {
        results.push(SPOTIFY_GENRES[i])
      }
    }

    return results
  }, [debouncedQuery])

  const handleGenreToggle = useCallback(
    (genres: Genre[]): void => {
      if (genres.length === 0) {
        onGenresChange([])
        return
      }

      const lastGenre = genres[genres.length - 1]
      const isSelected = selectedGenres.includes(lastGenre)

      const newGenres = isSelected
        ? selectedGenres.filter((g) => g !== lastGenre)
        : [...selectedGenres, lastGenre]

      onGenresChange(newGenres)
    },
    [selectedGenres, onGenresChange]
  )

  const GenreRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const genre = filteredGenres[index] as Genre
      const isSelected = selectedGenres.includes(genre)

      return (
        <Combobox.Option
          key={genre}
          value={genre}
          className={({ active }) =>
            `relative cursor-default select-none py-2 pl-10 pr-4 ${isSelected ? 'bg-primary text-primary-foreground' : 'text-foreground'} ${active ? 'bg-accent text-accent-foreground' : ''} `
          }
          style={style}
        >
          {({ selected }) => (
            <>
              <span
                className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}
              >
                {genre}
              </span>
              {selected && (
                <span className='text-primary-foreground absolute inset-y-0 left-0 flex items-center pl-3'>
                  <Check className='h-5 w-5' aria-hidden='true' />
                </span>
              )}
            </>
          )}
        </Combobox.Option>
      )
    },
    [filteredGenres, selectedGenres]
  )

  if (!Array.isArray(SPOTIFY_GENRES)) {
    console.error(
      '[GenresSelector] SPOTIFY_GENRES is not defined or not an array'
    )
    return (
      <div className='space-y-4'>
        <h3 className='text-lg font-medium'>Genres</h3>
        <div className='text-sm text-destructive'>
          Error: Unable to load genres. Please try refreshing the page.
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <h3 className='text-lg font-medium'>Genres</h3>
      <Combobox value={selectedGenres} onChange={handleGenreToggle} multiple>
        <div className='relative'>
          <Combobox.Input
            className='w-full rounded-lg border-0 bg-transparent px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0'
            placeholder='Search genres...'
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            value={query}
            displayValue={(genres: Genre[]) => genres.join(', ')}
          />
          <Combobox.Button className='absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 focus:outline-none'>
            <ChevronUpDownIcon
              className='h-5 w-5 text-muted-foreground'
              aria-hidden='true'
            />
          </Combobox.Button>
        </div>

        <Combobox.Options className='bg-white absolute z-10 mt-1 max-h-60 w-full overflow-hidden rounded-lg py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm'>
          {filteredGenres.length === 0 && query !== '' ? (
            <div className='relative cursor-default select-none px-4 py-2 text-gray-500'>
              No genres found.
            </div>
          ) : (
            <List
              height={Math.min(filteredGenres.length * 36, 240)}
              itemCount={filteredGenres.length}
              itemSize={36}
              width='100%'
            >
              {GenreRow}
            </List>
          )}
        </Combobox.Options>
      </Combobox>

      {selectedGenres.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {selectedGenres.map((genre) => (
            <span
              key={genre}
              className='bg-primary/10 text-primary inline-flex items-center rounded-full px-3 py-1 text-sm font-medium'
            >
              {genre}
              <button
                type='button'
                onClick={() => handleGenreToggle([genre])}
                className='hover:bg-primary/20 focus:ring-primary ml-2 rounded-full p-1 focus:outline-none focus:ring-2 focus:ring-offset-2'
                aria-label={`Remove ${genre}`}
              >
                <svg
                  className='h-3 w-3'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M6 18L18 6M6 6l12 12'
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
