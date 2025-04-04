import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { TrackItem } from "@/shared/types"
import { SpotifyPlaybackState } from "@/shared/types"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const filterUpcomingTracks = (
  playlistTracks: TrackItem[],
  currentTrackId: string | null,
  _nowPlaying?: SpotifyPlaybackState
): TrackItem[] => {
  if (!currentTrackId) {
    console.log('[Filter Upcoming] No track currently playing, returning all tracks');
    return playlistTracks; // If no track is playing, return all tracks
  }

  // Find all occurrences of the current track
  const indices = playlistTracks
    .map((track, index) => track.track.id === currentTrackId ? index : -1)
    .filter(index => index !== -1);

  if (indices.length === 0) {
    console.log('[Filter Upcoming] Current track not found in playlist, returning all tracks');
    return playlistTracks; // If current track isn't found, return all tracks
  }

  // Always use the last instance of the track
  const lastIndex = indices[indices.length - 1];
  const upcomingTracks = playlistTracks.slice(lastIndex + 1);
  
  console.log('[Filter Upcoming] Result:', {
    lastIndex,
    upcomingTracksCount: upcomingTracks.length,
    upcomingTrackIds: upcomingTracks.map(t => t.track.id),
    hasDuplicates: new Set(upcomingTracks.map(t => t.track.id)).size !== upcomingTracks.length
  });

  return upcomingTracks;
};
