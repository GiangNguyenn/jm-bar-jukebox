"use client";
import { useCreateNewDailyPlaylist } from "@/hooks/useCreateNewDailyPlayList";
import { useGetPlaylist } from "@/hooks/useGetPlaylist";
import { useEffect, useState } from "react";
import useSearchTracks from "../hooks/useSearchTracks";
import { TrackDetails } from "@/shared/types";
import Playlist from "@/components/Playlist/Playlist";
import Loading from "./loading";
import SearchInput from "@/components/SearchInput";
import { useDebounce } from "use-debounce";
import { cleanupOldPlaylists } from "@/services/playlist";
import { useMyPlaylists } from "@/hooks/useMyPlaylists";

interface PlaylistRefreshEvent extends CustomEvent {
  detail: {
    timestamp: number;
  };
}

declare global {
  interface WindowEventMap {
    'playlistRefresh': PlaylistRefreshEvent;
  }
}

export default function Home() {
  const { createPlaylist, todayPlaylistId, isLoading: isCreatingPlaylist, isInitialFetchComplete } = useCreateNewDailyPlaylist();
  const { data: todayPlaylist, isLoading: isLoadingPlaylist, refetchPlaylist } = useGetPlaylist(
    todayPlaylistId ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TrackDetails[]>([]);
  const { searchTracks } = useSearchTracks();
  const { data: playlists } = useMyPlaylists();
  
  // Handle cleanup of old playlists
  useEffect(() => {
    if (playlists?.items) {
      cleanupOldPlaylists(playlists.items).catch(console.error);
    }
  }, [playlists?.items]);

  useEffect(() => {
    (async () => {
      if (!todayPlaylistId && !isCreatingPlaylist && isInitialFetchComplete) {
        console.log('[Page] Creating new playlist - conditions:', {
          noPlaylistId: !todayPlaylistId,
          notCreating: !isCreatingPlaylist,
          initialFetchComplete: isInitialFetchComplete
        });
        await createPlaylist();
      }
    })();
  }, [createPlaylist, todayPlaylistId, isCreatingPlaylist, isInitialFetchComplete]);

  // Listen for playlist refresh events
  useEffect(() => {
    const handlePlaylistRefresh = (event: Event) => {
      const customEvent = event as PlaylistRefreshEvent;
      console.log('Received playlist refresh event:', {
        timestamp: customEvent.detail.timestamp,
        source: event.target instanceof Window ? 'window' : 
                event.target instanceof Document ? 'document' : 
                'element'
      });
      
      // Add a small delay to ensure the track is added to Spotify
      setTimeout(() => {
        console.log('Refreshing playlist after delay...');
        refetchPlaylist().catch(error => {
          console.error('Error refreshing playlist:', error);
        });
      }, 1000);
    };

    // Add listeners to multiple targets for better reliability
    window.addEventListener('playlistRefresh', handlePlaylistRefresh);
    document.addEventListener('playlistRefresh', handlePlaylistRefresh);
    
    return () => {
      window.removeEventListener('playlistRefresh', handlePlaylistRefresh);
      document.removeEventListener('playlistRefresh', handlePlaylistRefresh);
    };
  }, [refetchPlaylist]);

  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);

  useEffect(() => {
    const searchTrackDebounce = async () => {
      if (debouncedSearchQuery !== "") {
        const tracks = await searchTracks(debouncedSearchQuery);
        setSearchResults(tracks);
      } else {
        setSearchResults([]);
      }
    };

    searchTrackDebounce();
  }, [debouncedSearchQuery, searchTracks]);

  if (isLoadingPlaylist || !todayPlaylist || !todayPlaylistId) {
    return <Loading />;
  }

  const { tracks, name } = todayPlaylist!;

  console.log('[Page] Playlist data:', {
    playlistName: name,
    totalTracks: tracks.total,
    tracksItems: tracks.items,
    tracksItemsLength: tracks.items.length
  });

  return (
    <div className="items-center justify-items-center space-y-3 p-4 pt-10 font-mono">
      <SearchInput
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
      />
      <h1 className="lg:text-3xl md:text-2xl sm:text-base text-center text-primary-200 font-[family-name:var(--font-parklane)] break-words">
        {name}
      </h1>
      <Playlist tracks={tracks.items} />
    </div>
  );
}
