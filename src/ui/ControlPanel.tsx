import { usePlayerStore } from "../store/playerStore";
import { albumElapsed, albumTotalDuration } from "../audio/albumProgress";
import { ProgressBar } from "./ProgressBar";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface ControlPanelProps {
  onPickFolder: () => void;
}

/** Bottom transport: track info, play controls, draggable seek, folder picker. */
export function ControlPanel({ onPickFolder }: ControlPanelProps) {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const trackDurations = usePlayerStore((s) => s.trackDurations);
  const musicDir = usePlayerStore((s) => s.musicDir);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const error = usePlayerStore((s) => s.error);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);

  const album = albums[currentAlbumIndex];
  const track = album?.tracks[currentTrackIndex];
  const hasSelection = Boolean(track);
  const sideTotal = albumTotalDuration(album, trackDurations);
  const sideElapsed = albumElapsed(album, currentTrackIndex, currentTime, trackDurations);

  const togglePlay = () => {
    if (!hasSelection) return;
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="control-panel">
      <div className="control-top">
        <div className="now-playing">
          <div className="now-playing-title">{track ? track.title : "Select a track"}</div>
          <div className="now-playing-sub">
            {album
              ? `${album.name} · ${currentTrackIndex + 1}/${album.tracks.length}` +
                (sideTotal > 0 ? ` · side ${formatTime(sideElapsed)}/${formatTime(sideTotal)}` : "")
              : "—"}
          </div>
        </div>

        <div className="transport">
          <button onClick={prevTrack} disabled={!hasSelection} title="Previous" aria-label="Previous track">
            ⏮
          </button>
          <button
            className="play-btn"
            onClick={togglePlay}
            disabled={!hasSelection}
            title={isPlaying ? "Pause" : "Play"}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={nextTrack} disabled={!hasSelection} title="Next" aria-label="Next track">
            ⏭
          </button>
        </div>

        <div className="library-info">
          <button onClick={onPickFolder} disabled={isLoading}>
            {isLoading ? "Scanning…" : "Choose Folder"}
          </button>
          <span className="dir-path" title={musicDir ?? undefined}>
            {musicDir ?? "default library"}
          </span>
          {error && <span className="error-text">{error}</span>}
        </div>
      </div>

      <ProgressBar />
    </div>
  );
}
