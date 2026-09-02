import { create } from "zustand";

export interface Track {
  title: string;
  path: string;
}

export interface Album {
  name: string;
  /** Display artist; optional when the folder name has no "Artist - Title". */
  artist?: string | null;
  tracks: Track[];
  /** Absolute path (or /demo/…) to cover art, if the folder has one. */
  cover?: string | null;
}

interface PlayerState {
  albums: Album[];
  /** Index into `albums` of the track list currently loaded, or -1 if none selected yet. */
  currentAlbumIndex: number;
  /** Index into the current album's track list. */
  currentTrackIndex: number;
  isPlaying: boolean;
  /** Playback position in seconds. */
  currentTime: number;
  duration: number;
  musicDir: string | null;
  isLoading: boolean;
  error: string | null;
  /** Cached track path → duration (seconds), used for album-wide stylus travel. */
  trackDurations: Record<string, number>;

  setAlbums: (albums: Album[], musicDir: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setTime: (currentTime: number, duration: number) => void;
  setTrackDuration: (path: string, duration: number) => void;
  /** Select a track by album/track index and start playing it. */
  selectTrack: (albumIndex: number, trackIndex: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  albums: [],
  currentAlbumIndex: -1,
  currentTrackIndex: 0,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  musicDir: null,
  isLoading: false,
  error: null,
  trackDurations: {},

  setAlbums: (albums, musicDir) =>
    set({
      albums,
      musicDir,
      currentAlbumIndex: -1,
      currentTrackIndex: 0,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      trackDurations: {},
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setTime: (currentTime, duration) => set({ currentTime, duration }),
  setTrackDuration: (path, duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const prev = get().trackDurations[path];
    if (prev && Math.abs(prev - duration) < 0.01) return;
    set({ trackDurations: { ...get().trackDurations, [path]: duration } });
  },

  selectTrack: (albumIndex, trackIndex) => {
    const { albums } = get();
    const album = albums[albumIndex];
    if (!album || trackIndex < 0 || trackIndex >= album.tracks.length) return;
    set({
      currentAlbumIndex: albumIndex,
      currentTrackIndex: trackIndex,
      currentTime: 0,
      isPlaying: true,
    });
  },

  nextTrack: () => {
    const { albums, currentAlbumIndex, currentTrackIndex } = get();
    const album = albums[currentAlbumIndex];
    if (!album) return;
    set({
      currentTrackIndex: (currentTrackIndex + 1) % album.tracks.length,
      currentTime: 0,
    });
  },
  prevTrack: () => {
    const { albums, currentAlbumIndex, currentTrackIndex } = get();
    const album = albums[currentAlbumIndex];
    if (!album) return;
    set({
      currentTrackIndex:
        (currentTrackIndex - 1 + album.tracks.length) % album.tracks.length,
      currentTime: 0,
    });
  },
}));
