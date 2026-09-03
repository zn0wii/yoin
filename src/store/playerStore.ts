import { create } from "zustand";

export interface Track {
  title: string;
  path: string;
  /** Start offset (seconds) into `path` — CUE tracks share one file. */
  start?: number;
}

export interface Album {
  name: string;
  /** Artist folder name under the library root. */
  artist?: string | null;
  tracks: Track[];
  /** Absolute path (or /demo/…) to cover art, if the folder has one. */
  cover?: string | null;
  /** NetEase album id, set only for the online-search virtual album — lets
   *  it be found/replaced by identity instead of by (necessarily unique)
   *  display name. */
  onlineId?: string;
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
  /** Album cover shelf is visible. */
  libraryOpen: boolean;
  /** Album shown in the right track panel, or -1 if none. */
  browseAlbumIndex: number;
  /** Online search panel is visible (mutually exclusive with the track panel). */
  searchOpen: boolean;

  setAlbums: (albums: Album[], musicDir: string | null) => void;
  toggleSearch: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setTime: (currentTime: number, duration: number) => void;
  setTrackDuration: (path: string, duration: number) => void;
  /** Select a track by album/track index and start playing it. */
  selectTrack: (albumIndex: number, trackIndex: number) => void;
  toggleLibrary: () => void;
  browseAlbum: (albumIndex: number) => void;
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
  libraryOpen: true,
  browseAlbumIndex: -1,
  searchOpen: false,

  setAlbums: (albums, musicDir) =>
    set({
      albums,
      musicDir,
      currentAlbumIndex: -1,
      browseAlbumIndex: -1,
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
      browseAlbumIndex: albumIndex,
      currentTrackIndex: trackIndex,
      currentTime: 0,
      isPlaying: true,
    });
  },
  toggleLibrary: () => set({ libraryOpen: !get().libraryOpen, searchOpen: false }),
  toggleSearch: () => set({ searchOpen: !get().searchOpen, libraryOpen: false }),
  browseAlbum: (albumIndex) => {
    const album = get().albums[albumIndex];
    if (!album) return;
    set({ browseAlbumIndex: albumIndex });
  },

  nextTrack: () => {
    const { albums, currentAlbumIndex, currentTrackIndex } = get();
    const album = albums[currentAlbumIndex];
    if (!album) return;
    const nextIndex = (currentTrackIndex + 1) % album.tracks.length;
    // Online-search albums only have a `path` for tracks the user has
    // already played (NetEase CDN urls are fetched on demand, not
    // prefetched for the whole album) — skipping to an unfetched one would
    // just fail to load, so stay put instead.
    if (!album.tracks[nextIndex]?.path) return;
    set({
      currentTrackIndex: nextIndex,
      currentTime: 0,
    });
  },
  prevTrack: () => {
    const { albums, currentAlbumIndex, currentTrackIndex } = get();
    const album = albums[currentAlbumIndex];
    if (!album) return;
    const prevIndex = (currentTrackIndex - 1 + album.tracks.length) % album.tracks.length;
    if (!album.tracks[prevIndex]?.path) return;
    set({
      currentTrackIndex: prevIndex,
      currentTime: 0,
    });
  },
}));
