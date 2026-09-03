import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore, type Album, type Track } from "../store/playerStore";
import {
  searchMusic,
  getAlbumDetail,
  getSongPlayUrl,
  downloadAlbum,
  onDownloadProgress,
  type AlbumSearchResult,
  type SongSearchResult,
  type MusicSearchResult,
  type AlbumDetail,
  type AlbumTrack,
} from "../audio/searchApi";

function IconDownload() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 2v7.4M5 6.8 8 9.8l3-3M3.5 12.5h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBack() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M10 3 5 8l5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M4.2 2.8v10.4L13.2 8 4.2 2.8z" fill="currentColor" />
    </svg>
  );
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Right-hand pane once an album is opened: cover, info, full track list,
 * each track playable online (fetches a fresh CDN url on click) plus a
 * whole-album download button. */
function AlbumDetailView({
  album,
  onBack,
  onDownloaded,
}: {
  album: AlbumSearchResult;
  onBack: () => void;
  onDownloaded: () => void;
}) {
  const [detail, setDetail] = useState<AlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const unlistenRef = useRef<(() => void) | null>(null);

  const albums = usePlayerStore((s) => s.albums);
  const setAlbums = usePlayerStore((s) => s.setAlbums);
  const selectTrack = usePlayerStore((s) => s.selectTrack);
  const musicDir = usePlayerStore((s) => s.musicDir);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAlbumDetail(album.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [album.id]);

  useEffect(() => () => unlistenRef.current?.(), []);

  const isCurrentOnlineAlbum =
    currentAlbumIndex >= 0 && albums[currentAlbumIndex]?.onlineId === album.id;

  const handlePlay = useCallback(
    async (track: AlbumTrack, trackIndex: number) => {
      if (!detail) return;
      setPlayingId(track.id);
      setError(null);
      try {
        const url = await getSongPlayUrl(track.id, track.title, detail.artist);
        if (!url) {
          setError(`《${track.title}》无可用播放地址（可能需要会员或已下架）`);
          return;
        }
        const existing = albums.find((a) => a.onlineId === album.id);
        // Keep already-resolved sibling urls so album play-through can reuse
        // them; every track carries `onlineSongId` for on-demand fetch.
        const onlineTracks: Track[] = detail.tracks.map((t, i) => ({
          title: t.title,
          path: t.id === track.id ? url : existing?.tracks[i]?.path ?? "",
          onlineSongId: t.id,
        }));
        const onlineAlbum: Album = {
          name: detail.name,
          artist: detail.artist,
          cover: detail.coverUrl || null,
          tracks: onlineTracks,
          onlineId: album.id,
        };
        const existingIndex = albums.findIndex((a) => a.onlineId === album.id);
        const nextAlbums =
          existingIndex >= 0
            ? albums.map((a, i) => (i === existingIndex ? onlineAlbum : a))
            : [...albums, onlineAlbum];
        setAlbums(nextAlbums, musicDir);
        const albumIndex = existingIndex >= 0 ? existingIndex : nextAlbums.length - 1;
        selectTrack(albumIndex, trackIndex);
      } catch (err) {
        setError(String(err));
      } finally {
        setPlayingId(null);
      }
    },
    [detail, album.id, albums, setAlbums, musicDir, selectTrack]
  );

  const handlePlayAll = useCallback(() => {
    if (!detail || detail.tracks.length === 0) return;
    void handlePlay(detail.tracks[0], 0);
  }, [detail, handlePlay]);

  const handleDownload = useCallback(async () => {
    if (!detail || downloading) return;
    setDownloading(true);
    setError(null);
    setProgressLabel(`准备下载 0 / ${detail.tracks.length}`);

    unlistenRef.current?.();
    unlistenRef.current = await onDownloadProgress((p) => {
      if (p.album !== detail.name) return;
      setProgressLabel(`下载中 ${p.completed} / ${p.total}${p.currentTitle ? "：" + p.currentTitle : ""}`);
    });

    try {
      await downloadAlbum(detail.name, detail.artist, detail.tracks, detail.coverUrl || null);
      onDownloaded();
    } catch (err) {
      setError(String(err));
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setDownloading(false);
      setProgressLabel("");
    }
  }, [detail, downloading, onDownloaded]);

  return (
    <div className="album-detail-view">
      <div className="album-detail-topbar">
        <button className="album-detail-back" onClick={onBack} aria-label="返回搜索结果">
          <IconBack />
          <span>返回</span>
        </button>
      </div>

      {loading ? (
        <div className="search-panel-empty">加载专辑详情…</div>
      ) : error && !detail ? (
        <div className="search-panel-error">{error}</div>
      ) : detail ? (
        <>
          <div className="album-detail-header">
            {detail.coverUrl ? (
              <img className="album-detail-cover" src={detail.coverUrl} alt={detail.name} />
            ) : (
              <div className="album-detail-cover album-detail-cover-empty" />
            )}
            <button
              className="album-detail-play-all"
              onClick={handlePlayAll}
              disabled={playingId !== null || detail.tracks.length === 0}
              title="播放整张专辑"
              aria-label="播放整张专辑"
            >
              <IconPlay />
            </button>
            <div className="album-detail-info">
              <div className="album-detail-name">{detail.name}</div>
              <div className="album-detail-artist">{detail.artist || "未知歌手"}</div>
              {detail.description ? (
                <div className="album-detail-description">{detail.description}</div>
              ) : null}
              <button
                className="search-album-download album-detail-download"
                onClick={handleDownload}
                disabled={downloading}
                title="下载整张专辑"
              >
                <IconDownload />
                <span>{downloading ? "下载中…" : "下载整张专辑"}</span>
              </button>
              {downloading ? <div className="search-album-progress">{progressLabel}</div> : null}
            </div>
          </div>

          {error ? <div className="search-panel-error">{error}</div> : null}

          <ul className="album-detail-track-list">
            {detail.tracks.map((track, i) => {
              const isActive = isCurrentOnlineAlbum && currentTrackIndex === i;
              const isBusy = playingId === track.id;
              return (
                <li
                  className={`album-detail-track${isActive ? " active" : ""}${isBusy ? " busy" : ""}`}
                  key={track.id}
                  onClick={() => {
                    if (playingId) return;
                    void handlePlay(track, i);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (!playingId) void handlePlay(track, i);
                    }
                  }}
                  aria-label={`播放 ${track.title}`}
                  aria-disabled={playingId !== null}
                >
                  <span className="album-detail-track-no">
                    {isActive && isPlaying ? "▶" : isBusy ? "…" : track.trackNo}
                  </span>
                  <span className="album-detail-track-title">{track.title}</span>
                  <span className="album-detail-track-duration">
                    {formatDuration(track.duration)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Left panel: online song+album search → click a song title to play it
 * directly, or click an album to open its detail (cover/info/tracklist,
 * online playback) → optional whole-album download into the local library
 * (rescanned on completion). */
export function SearchPanel({ onDownloaded }: { onDownloaded: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MusicSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openAlbum, setOpenAlbum] = useState<AlbumSearchResult | null>(null);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const toggleSearch = usePlayerStore((s) => s.toggleSearch);

  const albums = usePlayerStore((s) => s.albums);
  const setAlbums = usePlayerStore((s) => s.setAlbums);
  const selectTrack = usePlayerStore((s) => s.selectTrack);
  const musicDir = usePlayerStore((s) => s.musicDir);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchMusic(q));
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  /** Play a top-level song search result directly (no per-track button):
   * builds/updates a single-track "virtual album" keyed by the song id so
   * it slots into the existing player-store playback machinery. */
  const handlePlaySong = useCallback(
    async (song: SongSearchResult) => {
      setPlayingSongId(song.id);
      setError(null);
      try {
        const url = await getSongPlayUrl(song.id, song.title, song.artist);
        if (!url) {
          setError(`《${song.title}》无可用播放地址（可能需要会员或已下架）`);
          return;
        }
        const onlineId = `song:${song.id}`;
        const onlineAlbum: Album = {
          name: song.title,
          artist: song.artist,
          cover: song.coverUrl || null,
          tracks: [{ title: song.title, path: url, onlineSongId: song.id }],
          onlineId,
        };
        const existingIndex = albums.findIndex((a) => a.onlineId === onlineId);
        const nextAlbums =
          existingIndex >= 0
            ? albums.map((a, i) => (i === existingIndex ? onlineAlbum : a))
            : [...albums, onlineAlbum];
        setAlbums(nextAlbums, musicDir);
        const albumIndex = existingIndex >= 0 ? existingIndex : nextAlbums.length - 1;
        selectTrack(albumIndex, 0);
      } catch (err) {
        setError(String(err));
      } finally {
        setPlayingSongId(null);
      }
    },
    [albums, setAlbums, musicDir, selectTrack]
  );

  return (
    <div className="search-overlay">
      <div className="search-panel">
        <div className="search-panel-header">
          <span>{openAlbum ? openAlbum.name : "在线搜索"}</span>
          <button className="search-panel-close" onClick={toggleSearch} aria-label="关闭搜索">
            ×
          </button>
        </div>

        {openAlbum ? (
          <AlbumDetailView
            album={openAlbum}
            onBack={() => setOpenAlbum(null)}
            onDownloaded={onDownloaded}
          />
        ) : (
          <>
            <form
              className="search-panel-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
            >
              <input
                className="search-panel-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="歌名 / 专辑名 / 歌手"
                autoFocus
              />
              <button className="search-panel-submit" type="submit" disabled={loading || !query.trim()}>
                {loading ? "搜索中…" : "搜索"}
              </button>
            </form>

            {error ? <div className="search-panel-error">{error}</div> : null}

            <div className="search-panel-results">
              {results.length === 0 && !loading ? (
                <div className="search-panel-empty">输入歌名、专辑名或歌手搜索，点歌名直接播放，点专辑查看曲目。</div>
              ) : (
                <ul className="album-search-list">
                  {results.map((r) => {
                    if (r.kind === "song") {
                      const song = r.song;
                      const onlineId = `song:${song.id}`;
                      const isActive =
                        currentAlbumIndex >= 0 &&
                        albums[currentAlbumIndex]?.onlineId === onlineId;
                      return (
                        <li className="album-search-item song-search-item" key={onlineId}>
                          {song.coverUrl ? (
                            <img className="album-search-cover" src={song.coverUrl} alt={song.title} />
                          ) : (
                            <div className="album-search-cover album-search-cover-empty" />
                          )}
                          <div className="album-search-info">
                            <button
                              className="song-search-title"
                              onClick={() => handlePlaySong(song)}
                              disabled={playingSongId === song.id}
                            >
                              {isActive && isPlaying
                                ? "▶ "
                                : playingSongId === song.id
                                ? "… "
                                : ""}
                              {song.title}
                            </button>
                            <div className="album-search-artist">
                              {song.artist || "未知歌手"}
                              {song.albumName ? ` · ${song.albumName}` : ""}
                            </div>
                          </div>
                        </li>
                      );
                    }
                    const album = r.album;
                    return (
                      <li
                        className="album-search-item"
                        key={`album:${album.id}`}
                        onClick={() => setOpenAlbum(album)}
                      >
                        {album.coverUrl ? (
                          <img className="album-search-cover" src={album.coverUrl} alt={album.name} />
                        ) : (
                          <div className="album-search-cover album-search-cover-empty" />
                        )}
                        <div className="album-search-info">
                          <div className="album-search-name">
                            <span className="album-search-badge">专辑</span>
                            {album.name}
                          </div>
                          <div className="album-search-artist">{album.artist || "未知歌手"}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
