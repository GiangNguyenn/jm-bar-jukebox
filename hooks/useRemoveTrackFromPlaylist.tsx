import { useState, useEffect } from 'react';
import { TrackItem } from '@/shared/types';
import { ERROR_MESSAGES } from '@/shared/constants/errors';
import { sendApiRequest } from '@/shared/api';
import { useFixedPlaylist } from './useFixedPlaylist';
import { useGetPlaylist } from './useGetPlaylist';

export const useRemoveTrackFromPlaylist = () => {
  const { todayPlaylistId, error: createPlaylistError } = useFixedPlaylist();
  const { isError: playlistError, refetchPlaylist } = useGetPlaylist(todayPlaylistId ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!todayPlaylistId) return ERROR_MESSAGES.NO_PLAYLIST;
    if (playlistError || createPlaylistError) return 'Failed to load playlist';
    return null;
  });
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!todayPlaylistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      setIsSuccess(false);
    } else if (playlistError || createPlaylistError) {
      setError('Failed to load playlist');
      setIsSuccess(false);
    }
  }, [todayPlaylistId, playlistError, createPlaylistError]);

  const removeTrack = async (track: TrackItem) => {
    if (!todayPlaylistId) {
      setError(ERROR_MESSAGES.NO_PLAYLIST);
      throw new Error(ERROR_MESSAGES.NO_PLAYLIST);
    }

    if (playlistError || createPlaylistError) {
      setError('Failed to load playlist');
      throw new Error('Failed to load playlist');
    }

    setIsLoading(true);
    setIsSuccess(false);

    try {
      console.log('[Remove Track] Removing track', track.track.uri, 'from playlist', todayPlaylistId);

      await sendApiRequest({
        path: `playlists/${todayPlaylistId}/tracks`,
        method: 'DELETE',
        body: { tracks: [{ uri: track.track.uri }] }
      });

      console.log('[Remove Track] Track removed successfully, refreshing playlist');
      await refetchPlaylist();
      setIsSuccess(true);
      setError(null);
    } catch (error) {
      console.error('[Remove Track] Error removing track:', error);
      setError(ERROR_MESSAGES.FAILED_TO_REMOVE);
      setIsSuccess(false);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    removeTrack: todayPlaylistId ? removeTrack : null,
    isLoading,
    error,
    isSuccess
  };
};