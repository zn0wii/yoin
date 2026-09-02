import { usePlayerStore } from "../store/playerStore";

function formatTime(sec: number | undefined): string {
  if (!Number.isFinite(sec) || !sec || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function IconPlay() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M3.2 1.6v8.8l7.2-4.4z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <rect x="2.4" y="1.8" width="2.6" height="8.4" rx="0.6" />
      <rect x="7" y="1.8" width="2.6" height="8.4" rx="0.6" />
    </svg>
  );
}

/** Right panel: tracks of the browsed album. */
export function TrackList() {
  const albums = usePlayerStore((s) => s.albums);
  const browseAlbumIndex = usePlayerStore((s) => s.browseAlbumIndex);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const trackDurations = usePlayerStore((s) => s.trackDurations);
  const selectTrack = usePlayerStore((s) => s.selectTrack);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);

  const albumIndex =
    browseAlbumIndex >= 0 ? browseAlbumIndex : currentAlbumIndex;
  const album = albums[albumIndex];

  if (!album) {
    return (
      <div className="track-list">
        <div className="track-list-empty">选择一张唱片</div>
      </div>
    );
  }

  return (
    <div className="track-list">
      <div className="track-list-album">
        <div className="track-list-album-header">
          <div className="track-list-album-name">{album.name}</div>
          {album.artist ? (
            <div className="track-list-album-artist">{album.artist}</div>
          ) : null}
        </div>
        {album.tracks.map((track, trackIndex) => {
          const isCurrent =
            albumIndex === currentAlbumIndex &&
            trackIndex === currentTrackIndex;
          const dur = formatTime(trackDurations[track.path]);
          return (
            <button
              key={track.path}
              className={`track-list-item${isCurrent ? " active" : ""}`}
              onClick={() => {
                if (isCurrent) setIsPlaying(!isPlaying);
                else selectTrack(albumIndex, trackIndex);
              }}
            >
              <span className="track-list-item-index">
                {isCurrent ? (
                  <span className="track-list-item-icon">
                    {isPlaying ? <IconPause /> : <IconPlay />}
                  </span>
                ) : (
                  String(trackIndex + 1).padStart(2, " ")
                )}
              </span>
              <span className="track-list-item-title">{track.title}</span>
              {dur ? <span className="track-list-item-time">{dur}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
