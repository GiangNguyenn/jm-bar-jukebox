import { SpotifyPlaylistItem } from "@/shared/types";
import { sendApiRequest } from "../shared/api";
import { useMyPlaylists } from "./useMyPlaylists";
import { useEffect, useState } from "react";

export const useCreateNewDailyPlaylist = () => {
  const today= new Date();
  const todayString = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;

  
  const name = `Daily Mix - ${todayString}`;
  const description = `A daily mix of your favorite songs on ${todayString}`;
  const [todayPlaylistId, setTodayPlaylistId] = useState<string | null>(null);

  const {
    data: playlists,
    isError,
    isLoading,
    refetchPlaylists,
  } = useMyPlaylists();

  if (isError) {
    throw new Error("Error loading playlists");
  }

  useEffect(() => {
    refetchPlaylists();
  }, []);

  useEffect(() => {
    if (playlists?.items) {
      const existingPlaylist = playlists.items.find(
        (playlist) => playlist.name === name
      );
      if (existingPlaylist) {
        setTodayPlaylistId(existingPlaylist.id);
      }
    }
  }, [playlists]);

  const createPlaylist = async () => {
    if (!playlists || isLoading) {
      return;
    }

    const existingPlaylist =
      playlists && playlists?.items.find((playlist) => playlist.name === name);


    if (existingPlaylist) {
      return existingPlaylist;
    }

    try {
      const newPlaylist = await sendApiRequest<SpotifyPlaylistItem>({
        path: `me/playlists`,
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          public: false,
        }),
      });

      setTodayPlaylistId(newPlaylist.id);
      return newPlaylist;
    } catch (error) {
      console.error("Error creating new playlist:", error);
      throw error;
    }
  };

  return { createPlaylist, todayPlaylistId, playlists, isLoading };
};
