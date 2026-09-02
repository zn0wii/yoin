import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "../audio/audioEngine";
import { toAssetUrl } from "../audio/assetUrl";
import { ProgressBar } from "./ProgressBar";

function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M6 6h2.2v12H6zm3.2 6 10 6.2V5.8z" />
    </svg>
  );
}

function IconNext() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M15.8 6H18v12h-2.2zM4.8 5.8v12.4l10-6.2z" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5.2v13.6L19 12z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="6.4" y="5.2" width="4" height="13.6" rx="1" />
      <rect x="13.6" y="5.2" width="4" height="13.6" rx="1" />
    </svg>
  );
}

function IconHeart({ filled }: { filled: boolean }) {
  return filled ? (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 20.4S3.6 14.7 3.6 8.9A4.4 4.4 0 0 1 12 6.6a4.4 4.4 0 0 1 8.4 2.3c0 5.8-8.4 11.5-8.4 11.5z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        d="M12 20.4S3.6 14.7 3.6 8.9A4.4 4.4 0 0 1 12 6.6a4.4 4.4 0 0 1 8.4 2.3c0 5.8-8.4 11.5-8.4 11.5z"
      />
    </svg>
  );
}

function IconSpeaker() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4.5 9.2h3.2L12 5.8v12.4L7.7 14.8H4.5z" fill="currentColor" />
      <path
        d="M15.7 8.1a6.2 6.2 0 0 1 0 7.8M14.2 10a3.4 3.4 0 0 1 0 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconVinyl() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="16.5" fill="#0e0c0c" />
      <circle cx="18" cy="18" r="16.5" fill="none" stroke="#6a605c" strokeWidth="0.8" />
      <circle cx="18" cy="18" r="13.4" fill="none" stroke="#3c3432" strokeWidth="0.7" />
      <circle cx="18" cy="18" r="10.4" fill="none" stroke="#4a4240" strokeWidth="0.6" />
      <circle cx="18" cy="18" r="5.6" fill="#e2929a" />
      <circle cx="18" cy="18" r="1.6" fill="#1a1210" />
    </svg>
  );
}

function IconQueue() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="6" width="12" height="12" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M9 4h10.2A1.8 1.8 0 0 1 21 5.8V16" />
    </svg>
  );
}

function IconList() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M8 5H5v3M16 5h3v3M8 19H5v-3M16 19h3v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VolumeSlider() {
  const [volume, setVolume] = useState(() => audioEngine.volume);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const apply = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audioEngine.setVolume(t);
    setVolume(t);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    apply(e.clientX);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const pct = Math.round(volume * 100);

  return (
    <div className="player-vol">
      <IconSpeaker />
      <div
        ref={trackRef}
        className="player-vol-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        tabIndex={0}
      >
        <div className="player-vol-fill" style={{ width: `${pct}%` }} />
        <div className="player-vol-thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="player-vol-pct">{pct}%</span>
    </div>
  );
}

interface ControlPanelProps {
  onPickFolder: () => void;
}

/** Bottom playback bar — matched to assets/design.png. */
export function ControlPanel({ onPickFolder }: ControlPanelProps) {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const error = usePlayerStore((s) => s.error);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const [liked, setLiked] = useState(false);

  const album = albums[currentAlbumIndex];
  const track = album?.tracks[currentTrackIndex];
  const hasSelection = Boolean(track);
  const cover = album?.cover ? toAssetUrl(album.cover) : null;

  const togglePlay = () => {
    if (!hasSelection) return;
    setIsPlaying(!isPlaying);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  };

  return (
    <div className="player-bar">
      <div className="player-left">
      <div className="player-now">
        {cover ? (
          <img className="player-cover" src={cover} alt="" draggable={false} />
        ) : (
          <div className="player-cover placeholder" aria-hidden />
        )}
        <div className="player-meta">
          <div className="player-title">{track ? track.title : "Select a track"}</div>
          <div className="player-album">{album ? album.name : "—"}</div>
        </div>
        <button
          className={`player-heart${liked ? " liked" : ""}`}
          onClick={() => setLiked((v) => !v)}
          title={liked ? "Unlike" : "Like"}
          aria-label={liked ? "Unlike" : "Like"}
        >
          <IconHeart filled={liked} />
        </button>
      </div>

      <ProgressBar />
      </div>

      <div className="player-transport">
        <button
          className="player-skip"
          onClick={prevTrack}
          disabled={!hasSelection}
          title="Previous"
          aria-label="Previous track"
        >
          <IconPrev />
        </button>
        <button
          className="player-play"
          onClick={togglePlay}
          disabled={!hasSelection}
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <IconPause /> : <IconPlay />}
        </button>
        <button
          className="player-skip"
          onClick={nextTrack}
          disabled={!hasSelection}
          title="Next"
          aria-label="Next track"
        >
          <IconNext />
        </button>
      </div>

      <div className="player-right">
      <div className="player-divider" />

      <div className="player-vinyl" aria-hidden>
        <IconVinyl />
      </div>

      <VolumeSlider />

      <div className="player-tools">
        <button
          onClick={onPickFolder}
          disabled={isLoading}
          title={error ?? (isLoading ? "Scanning…" : "Choose folder")}
          aria-label="Choose music folder"
        >
          <IconQueue />
        </button>
        <button title="Queue" aria-label="Queue" type="button">
          <IconList />
        </button>
        <button onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
          <IconExpand />
        </button>
      </div>
      </div>
    </div>
  );
}
