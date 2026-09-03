import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** One album hit from `cloudsearch` (`type=10`). */
export interface AlbumSearchResult {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
}

/** One song hit from `cloudsearch` (`type=1`). */
export interface SongSearchResult {
  id: string;
  title: string;
  artist: string;
  albumId: string;
  albumName: string;
  coverUrl: string;
}

/** One entry in the mixed song+album search results. */
export type MusicSearchResult =
  | { kind: "song"; song: SongSearchResult }
  | { kind: "album"; album: AlbumSearchResult };

type RawMusicSearchResult =
  | { kind: "song"; id: string; title: string; artist: string; album_id: string; album_name: string; cover_url: string }
  | { kind: "album"; id: string; name: string; artist: string; cover_url: string };

/** Search songs and albums by free-text query in one call. */
export async function searchMusic(query: string): Promise<MusicSearchResult[]> {
  const raw = await invoke<RawMusicSearchResult[]>("search_netease_music", { query });
  return raw.map((r) =>
    r.kind === "song"
      ? {
          kind: "song",
          song: {
            id: r.id,
            title: r.title,
            artist: r.artist,
            albumId: r.album_id,
            albumName: r.album_name,
            coverUrl: r.cover_url,
          },
        }
      : {
          kind: "album",
          album: {
            id: r.id,
            name: r.name,
            artist: r.artist,
            coverUrl: r.cover_url,
          },
        }
  );
}

/** One track inside an album's detail response. */
export interface AlbumTrack {
  id: string;
  title: string;
  trackNo: number;
  /** Duration in seconds, if known. */
  duration: number | null;
}

interface RawAlbumTrack {
  id: string;
  title: string;
  track_no: number;
  duration: number | null;
}

/** Full album detail: cover, info, and every track. */
export interface AlbumDetail {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  description: string;
  publishTime: number | null;
  tracks: AlbumTrack[];
}

interface RawAlbumDetail {
  id: string;
  name: string;
  artist: string;
  cover_url: string;
  description: string;
  publish_time: number | null;
  tracks: RawAlbumTrack[];
}

export async function getAlbumDetail(albumId: string): Promise<AlbumDetail> {
  const raw = await invoke<RawAlbumDetail>("get_netease_album_detail", { albumId });
  return {
    id: raw.id,
    name: raw.name,
    artist: raw.artist,
    coverUrl: raw.cover_url,
    description: raw.description,
    publishTime: raw.publish_time,
    tracks: raw.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      trackNo: t.track_no,
      duration: t.duration,
    })),
  };
}

/** Streamable playback URL for one track, or `null` if every source fails.
 * Tries NetEase official URL first, then GD Studio fallback (Alger-style:
 * metadata from NetEase, audio from joox/kuwo/migu/…). Pass `title`/`artist`
 * so the fallback can search by name. CDN links are time-limited. */
export async function getSongPlayUrl(
  songId: string,
  title?: string,
  artist?: string
): Promise<string | null> {
  return await invoke<string | null>("get_netease_song_url", {
    songId,
    title: title ?? null,
    artist: artist ?? null,
  });
}

export interface DownloadProgress {
  album: string;
  completed: number;
  total: number;
  currentTitle: string;
}

/** Subscribe to `download-progress` events emitted while an album downloads. */
export function onDownloadProgress(cb: (p: DownloadProgress) => void) {
  return listen<{
    album: string;
    completed: number;
    total: number;
    current_title: string;
  }>("download-progress", (e) => {
    cb({
      album: e.payload.album,
      completed: e.payload.completed,
      total: e.payload.total,
      currentTitle: e.payload.current_title,
    });
  });
}

/** Download every track of one album; returns the folder it was saved to. */
export async function downloadAlbum(
  album: string,
  artist: string,
  tracks: AlbumTrack[],
  coverUrl: string | null
): Promise<string> {
  return await invoke<string>("download_album", {
    album,
    artist,
    tracks: tracks.map((t) => ({ id: t.id, title: t.title })),
    coverUrl,
  });
}
