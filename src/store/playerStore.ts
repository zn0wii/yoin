import { create } from "zustand";

/** Main-stage background images (served from /public), cycled by the nav switcher. */
export const BACKGROUNDS = ["/bg.png", "/bg2.png", "/bg3.png"];

const BACKGROUND_KEY = "yoin:background";

function loadBackgroundIndex(): number {
  try {
    const v = Number(localStorage.getItem(BACKGROUND_KEY));
    return Number.isInteger(v) && v >= 0 && v < BACKGROUNDS.length ? v : 0;
  } catch {
    return 0;
  }
}

/** How the 3D record's color is chosen. */
export type DiscColorMode = "auto" | "manual" | "pulse";
const DISC_MODES: DiscColorMode[] = ["auto", "manual", "pulse"];

const DISC_MODE_KEY = "yoin:disc-mode";
const DISC_HUE_KEY = "yoin:disc-hue";
/** Default manual hue ≈ the stock rose-quartz pink (#ffa2b2 is hue ~350°). */
export const DEFAULT_DISC_HUE = 350;

function loadDiscColorMode(): DiscColorMode {
  try {
    const v = localStorage.getItem(DISC_MODE_KEY);
    return DISC_MODES.includes(v as DiscColorMode) ? (v as DiscColorMode) : "auto";
  } catch {
    return "auto";
  }
}

function loadManualDiscHue(): number {
  try {
    const v = Number(localStorage.getItem(DISC_HUE_KEY));
    return Number.isFinite(v) && v >= 0 && v < 360 ? v : DEFAULT_DISC_HUE;
  } catch {
    return DEFAULT_DISC_HUE;
  }
}

/** Auto-advance repeat behaviour of the transport's repeat button. */
export type RepeatMode = "off" | "all" | "one";
const REPEAT_MODES: RepeatMode[] = ["off", "all", "one"];

const SHUFFLE_KEY = "yoin:shuffle";
const REPEAT_KEY = "yoin:repeat";

function loadShuffle(): boolean {
  try {
    return localStorage.getItem(SHUFFLE_KEY) === "1";
  } catch {
    return false;
  }
}

function loadRepeatMode(): RepeatMode {
  try {
    const v = localStorage.getItem(REPEAT_KEY);
    return REPEAT_MODES.includes(v as RepeatMode) ? (v as RepeatMode) : "off";
  } catch {
    return "off";
  }
}

export interface MusicLibrary {
  id: string;
  name: string;
  /** Absolute scan root; null = the bundled default music directory. */
  path: string | null;
  addedAt: number;
  /** Bumped on activation — powers the "most used" ordering of the switcher. */
  lastUsedAt: number;
}

const LIBRARIES_KEY = "yoin:libraries";
const ACTIVE_LIBRARY_KEY = "yoin:active-library";
const DEFAULT_LIBRARY_NAME = "默认曲库";

function newLibraryId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `lib-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadLibraries(): MusicLibrary[] | null {
  try {
    const raw = localStorage.getItem(LIBRARIES_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const libs = parsed.filter(
      (l): l is MusicLibrary =>
        !!l &&
        typeof l === "object" &&
        typeof (l as MusicLibrary).id === "string" &&
        typeof (l as MusicLibrary).name === "string" &&
        ((l as MusicLibrary).path === null ||
          typeof (l as MusicLibrary).path === "string")
    );
    return libs.length > 0 ? libs : null;
  } catch {
    return null;
  }
}

function saveLibraries(libs: MusicLibrary[]): void {
  try {
    localStorage.setItem(LIBRARIES_KEY, JSON.stringify(libs));
  } catch {
    // Storage disabled — libraries live for the session only.
  }
}

function loadActiveLibraryId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LIBRARY_KEY);
  } catch {
    return null;
  }
}

function saveActiveLibraryId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_LIBRARY_KEY, id);
    else localStorage.removeItem(ACTIVE_LIBRARY_KEY);
  } catch {
    // Ignore — see saveLibraries.
  }
}

function makeDefaultLibrary(): MusicLibrary {
  return {
    id: newLibraryId(),
    name: DEFAULT_LIBRARY_NAME,
    path: null,
    addedAt: Date.now(),
    lastUsedAt: Date.now(),
  };
}

/** Initial persisted library set; creates the default library on first run. */
function initialLibraryState(): { libraries: MusicLibrary[]; activeLibraryId: string } {
  const stored = loadLibraries();
  const libraries = stored ?? [makeDefaultLibrary()];
  if (!stored) saveLibraries(libraries);
  const activeId = loadActiveLibraryId();
  const active =
    libraries.find((l) => l.id === activeId) ??
    [...libraries].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
  saveActiveLibraryId(active.id);
  return { libraries, activeLibraryId: active.id };
}

export interface Track {
  title: string;
  path: string;
  /** Start offset (seconds) into `path` — CUE tracks share one file. */
  start?: number;
  /** NetEase song id for online-search tracks — `path` is filled on demand
   *  (CDN urls expire; only the playing track needs a fresh one). */
  onlineSongId?: string;
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
  /** Index into BACKGROUNDS for the main-stage background. */
  backgroundIndex: number;
  /** How the 3D record is tinted: from the cover, a manual hue, or music-pulsed. */
  discColorMode: DiscColorMode;
  /** Manual hue (0–360) shown when discColorMode is "manual". */
  manualDiscHue: number;
  /** Shuffle auto-advance: track end picks a random next track; persisted. */
  shuffle: boolean;
  /** Repeat mode of the transport's repeat button; persisted. */
  repeatMode: RepeatMode;
  /** Configured music libraries (name + scan root), persisted in localStorage. */
  libraries: MusicLibrary[];
  /** Library whose albums are (or will be) loaded; valid right after store init. */
  activeLibraryId: string;
  /** Library manager modal is visible. */
  libraryManagerOpen: boolean;
  /** Resolved path of the bundled default music dir (null in plain-browser dev). */
  defaultMusicDir: string | null;

  setAlbums: (albums: Album[], musicDir: string | null) => void;
  /** Like setAlbums, but keeps the loaded album (playing or paused) alive
   *  across a library switch: the album OBJECT is carried over — substituted
   *  at its rescanned slot, or appended as an extra shelf card when the new
   *  library doesn't have it — so indices stay valid, playback state is
   *  untouched, and useAudioSync's load effect never re-runs (identity). */
  replaceAlbumsKeepPlayback: (albums: Album[], musicDir: string | null) => void;
  toggleSearch: () => void;
  /** Cycle to the next background image (bg → bg2 → bg3 → bg). */
  cycleBackground: () => void;
  /** Switch the record tint mode; persisted. */
  setDiscColorMode: (mode: DiscColorMode) => void;
  /** Set the manual record hue (0–360); persisted. */
  setManualDiscHue: (hue: number) => void;
  /** Toggle shuffle auto-advance; persisted. */
  toggleShuffle: () => void;
  /** Cycle repeat off → all → one → off; persisted. */
  cycleRepeat: () => void;
  /** Register a new library; returns it so callers can activate it. */
  addLibrary: (name: string, path: string | null) => MusicLibrary;
  /** Drop a library (never the last one); deleting the active one falls over
   *  to the most recently used remaining library. */
  removeLibrary: (id: string) => void;
  renameLibrary: (id: string, name: string) => void;
  /** Point the player at a library — the App scan effect reacts and rescans. */
  setActiveLibraryId: (id: string) => void;
  toggleLibraryManager: () => void;
  setDefaultMusicDir: (dir: string | null) => void;
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

export const usePlayerStore = create<PlayerState>((set, get) => {
  const initialLibs = initialLibraryState();
  return {
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
    backgroundIndex: loadBackgroundIndex(),
    discColorMode: loadDiscColorMode(),
    manualDiscHue: loadManualDiscHue(),
    shuffle: loadShuffle(),
    repeatMode: loadRepeatMode(),
    libraries: initialLibs.libraries,
    activeLibraryId: initialLibs.activeLibraryId,
    libraryManagerOpen: false,
    defaultMusicDir: null,

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
  replaceAlbumsKeepPlayback: (albums, musicDir) => {
    const { albums: prevAlbums, currentAlbumIndex, browseAlbumIndex } = get();
    const playing = currentAlbumIndex >= 0 ? prevAlbums[currentAlbumIndex] : null;
    // Nothing loaded → plain destructive reset, nothing to keep alive.
    if (!playing) {
      get().setAlbums(albums, musicDir);
      return;
    }
    const sameAlbum = (a: Album, b: Album) =>
      a.onlineId != null || b.onlineId != null
        ? a.onlineId != null && a.onlineId === b.onlineId
        : a.name === b.name && (a.artist ?? null) === (b.artist ?? null);
    const next = [...albums];
    let playIdx = next.findIndex((a) => sameAlbum(a, playing));
    if (playIdx >= 0) {
      next[playIdx] = playing; // keep the old object → no audio reload
    } else {
      next.push(playing); // extra shelf card for the still-playing album
      playIdx = next.length - 1;
    }
    set({
      albums: next,
      musicDir,
      currentAlbumIndex: playIdx,
      // Keep the track panel on the playing album; a different browsed album
      // belonged to the old library. (TrackList falls back to the playing
      // album anyway when browse is -1.)
      browseAlbumIndex: browseAlbumIndex === currentAlbumIndex ? playIdx : -1,
      // currentTrackIndex / isPlaying / time / trackDurations stay as-is.
    });
  },
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
  cycleBackground: () => {
    const next = (get().backgroundIndex + 1) % BACKGROUNDS.length;
    try {
      localStorage.setItem(BACKGROUND_KEY, String(next));
    } catch {
      // Private mode / storage disabled — switching still works for the session.
    }
    set({ backgroundIndex: next });
  },
  setDiscColorMode: (mode) => {
    try {
      localStorage.setItem(DISC_MODE_KEY, mode);
    } catch {
      // Private mode / storage disabled — switching still works for the session.
    }
    set({ discColorMode: mode });
  },
  setManualDiscHue: (hue) => {
    const clamped = Math.min(360, Math.max(0, hue));
    try {
      localStorage.setItem(DISC_HUE_KEY, String(clamped));
    } catch {
      // See setDiscColorMode.
    }
    set({ manualDiscHue: clamped });
  },
  toggleShuffle: () => {
    const shuffle = !get().shuffle;
    try {
      localStorage.setItem(SHUFFLE_KEY, shuffle ? "1" : "0");
    } catch {
      // See setDiscColorMode.
    }
    set({ shuffle });
  },
  cycleRepeat: () => {
    const repeatMode =
      REPEAT_MODES[(REPEAT_MODES.indexOf(get().repeatMode) + 1) % REPEAT_MODES.length];
    try {
      localStorage.setItem(REPEAT_KEY, repeatMode);
    } catch {
      // See setDiscColorMode.
    }
    set({ repeatMode });
  },

  addLibrary: (name, path) => {
    const trimmed = name.trim();
    // Auto-name from the folder when the user left the name blank.
    const derived = path?.split(/[\\/]/).filter(Boolean).pop();
    const lib: MusicLibrary = {
      id: newLibraryId(),
      name: trimmed || derived || DEFAULT_LIBRARY_NAME,
      path,
      addedAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    const libraries = [...get().libraries, lib];
    saveLibraries(libraries);
    set({ libraries });
    return lib;
  },
  removeLibrary: (id) => {
    const { libraries, activeLibraryId } = get();
    if (libraries.length <= 1) return; // never delete the last library
    const next = libraries.filter((l) => l.id !== id);
    if (next.length === libraries.length) return;
    saveLibraries(next);
    if (id === activeLibraryId) {
      const fallback = [...next].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
      saveActiveLibraryId(fallback.id);
      set({ libraries: next, activeLibraryId: fallback.id });
    } else {
      set({ libraries: next });
    }
  },
  renameLibrary: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const libraries = get().libraries.map((l) =>
      l.id === id ? { ...l, name: trimmed } : l
    );
    saveLibraries(libraries);
    set({ libraries });
  },
  setActiveLibraryId: (id) => {
    const { libraries, activeLibraryId } = get();
    if (id === activeLibraryId || !libraries.some((l) => l.id === id)) return;
    const updated = libraries.map((l) =>
      l.id === id ? { ...l, lastUsedAt: Date.now() } : l
    );
    saveLibraries(updated);
    saveActiveLibraryId(id);
    set({ libraries: updated, activeLibraryId: id });
  },
  toggleLibraryManager: () =>
    set({ libraryManagerOpen: !get().libraryManagerOpen }),
  setDefaultMusicDir: (defaultMusicDir) => set({ defaultMusicDir }),
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
    const next = album.tracks[nextIndex];
    // Local tracks always have `path`. Online tracks may only have
    // `onlineSongId` until the load effect fetches a fresh CDN url.
    if (!next?.path && !next?.onlineSongId) return;
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
    const prev = album.tracks[prevIndex];
    if (!prev?.path && !prev?.onlineSongId) return;
    set({
      currentTrackIndex: prevIndex,
      currentTime: 0,
    });
  },
  };
});
