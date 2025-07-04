import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { TrackItem } from '@/shared/types/spotify'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const filterUpcomingTracks = (
  playlistTracks: TrackItem[],
  currentTrackId: string | null
): TrackItem[] => {
  if (!currentTrackId) {
    return playlistTracks // If no track is playing, return all tracks
  }

  // Find all occurrences of the current track
  const indices = playlistTracks
    .map((track, index) => (track.track.id === currentTrackId ? index : -1))
    .filter((index) => index !== -1)

  if (indices.length === 0) {
    return playlistTracks // If current track isn't found, return all tracks
  }

  // Always use the last instance of the track
  const lastIndex = indices[indices.length - 1]
  const upcomingTracks = playlistTracks.slice(lastIndex + 1)

  return upcomingTracks
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function formatDate(timestamp: number): string {
  if (!timestamp || timestamp === 0) return 'Not available'
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return 'Invalid date'
  }
}
