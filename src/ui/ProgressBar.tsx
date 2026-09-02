import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { audioEngine } from "../audio/audioEngine";
import { usePlayerStore } from "../store/playerStore";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Draggable playback scrubber at the bottom of the transport. */
export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const hasTrack = usePlayerStore((s) => s.currentAlbumIndex >= 0);
  const setTime = usePlayerStore((s) => s.setTime);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const seconds = t * duration;
      audioEngine.seek(seconds);
      setTime(seconds, duration);
    },
    [duration, setTime]
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasTrack || duration <= 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    seekFromClientX(e.clientX);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className={`progress-bar${hasTrack ? "" : " disabled"}`}>
      <span className="progress-time">{formatTime(currentTime)}</span>
      <div
        ref={trackRef}
        className="progress-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration) || 0}
        aria-valuenow={Math.floor(currentTime)}
        aria-label="Seek"
        tabIndex={hasTrack ? 0 : -1}
      >
        <div className="progress-fill" style={{ width: `${ratio * 100}%` }} />
        <div className="progress-thumb" style={{ left: `${ratio * 100}%` }} />
      </div>
      <span className="progress-time">{formatTime(duration)}</span>
    </div>
  );
}
