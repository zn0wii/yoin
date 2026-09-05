import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePlayerStore, type DiscColorMode } from "../store/playerStore";
import { audioEngine } from "../audio/audioEngine";
import { toAssetUrl } from "../audio/assetUrl";
import { sheerHueHex } from "./coverColor";
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

function IconShuffle() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 7h3.1l9.4 10H21M4 17h3.1l2.8-3M13.6 10 16.5 7H21M18.6 4.6 21 7l-2.4 2.4M18.6 14.6 21 17l-2.4 2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRepeat() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7 5h9.2A3.8 3.8 0 0 1 20 8.8V10M17 19H7.8A3.8 3.8 0 0 1 4 15.2V14M17.4 7.4 20 10l-2.6 2.6M6.6 16.6 4 14l2.6-2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function IconPalette() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 3.4a8.6 8.6 0 1 0 0 17.2h1.1a1.9 1.9 0 0 0 1.3-3.2l-.4-.5a1.9 1.9 0 0 1 1.3-3.2h2.3a2.9 2.9 0 0 0 2.9-2.9c0-3.9-3.8-7.4-8.5-7.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="10.3" r="1.25" fill="currentColor" />
      <circle cx="11" cy="7.5" r="1.25" fill="currentColor" />
      <circle cx="15.4" cy="8.7" r="1.25" fill="currentColor" />
    </svg>
  );
}

/** Disc tint modes offered in the popover. */
const DISC_MODES: { value: DiscColorMode; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "auto", label: "跟随专辑" },
  { value: "manual", label: "手动选择" },
  { value: "pulse", label: "随音乐律动" },
];

/** Quick hue presets (degrees); 350 ≈ the stock rose-quartz pink. */
const DISC_HUE_PRESETS = [350, 25, 50, 120, 175, 210, 260, 310];

/** Record-color picker: palette button + popover (mode + hue slider). */
function DiscColorMenu() {
  const discColorMode = usePlayerStore((s) => s.discColorMode);
  const manualDiscHue = usePlayerStore((s) => s.manualDiscHue);
  const setDiscColorMode = usePlayerStore((s) => s.setDiscColorMode);
  const setManualDiscHue = usePlayerStore((s) => s.setManualDiscHue);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside pointer.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Hue slider — same pointer pattern as VolumeSlider.
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applyHue = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      setManualDiscHue(Math.round(t * 360));
    },
    [setManualDiscHue]
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyHue(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    applyHue(e.clientX);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const huePct = Math.round((manualDiscHue / 360) * 100);

  return (
    <div className="disc-color" ref={wrapRef}>
      <button
        className={open ? "open" : undefined}
        onClick={() => setOpen((v) => !v)}
        title="唱片颜色"
        aria-label="唱片颜色"
        aria-expanded={open}
      >
        <IconPalette />
      </button>
      {open && (
        <div className="disc-color-pop" role="dialog" aria-label="唱片颜色">
          <div className="disc-color-title">唱片颜色</div>
          <div className="disc-color-modes">
            {DISC_MODES.map((m) => (
              <button
                key={m.value}
                className={m.value === discColorMode ? "active" : undefined}
                onClick={() => setDiscColorMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {discColorMode === "manual" && (
            <div className="disc-color-manual">
              <div className="disc-color-swatches">
                {DISC_HUE_PRESETS.map((h) => (
                  <button
                    key={h}
                    className={h === manualDiscHue ? "active" : undefined}
                    style={{ background: sheerHueHex(h) }}
                    onClick={() => setManualDiscHue(h)}
                    aria-label={`预设色相 ${h}°`}
                  />
                ))}
              </div>
              <div
                ref={trackRef}
                className="disc-color-hue"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                role="slider"
                aria-label="色相"
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={manualDiscHue}
                tabIndex={0}
              >
                <div
                  className="disc-color-hue-thumb"
                  style={{
                    left: `${huePct}%`,
                    background: sheerHueHex(manualDiscHue),
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Volume: just a speaker icon in the bar; hovering it pops a vertical
 *  slider above (stays open while dragging, even past its bounds). */
function VolumeSlider() {
  const [volume, setVolume] = useState(() => audioEngine.volume);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Vertical: the top of the track is 100%.
    const t = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
    audioEngine.setVolume(t);
    setVolume(t);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    apply(e.clientY);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const pct = Math.round(volume * 100);

  return (
    <div className={`player-vol${dragging ? " dragging" : ""}`}>
      <span className="player-vol-btn" aria-hidden>
        <IconSpeaker />
      </span>
      <div className="player-vol-pop">
        <div
          ref={trackRef}
          className="player-vol-track"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="slider"
          aria-label="Volume"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          tabIndex={0}
        >
          <div className="player-vol-fill" style={{ height: `${pct}%` }} />
          <div className="player-vol-thumb" style={{ bottom: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Bottom playback bar — Apple-Music-style single row: now-playing info,
 *  transport (shuffle/prev/play/next/repeat), inline seek, volume + tools. */
export function ControlPanel() {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const error = usePlayerStore((s) => s.error);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const nextTrack = usePlayerStore((s) => s.nextTrack);
  const prevTrack = usePlayerStore((s) => s.prevTrack);
  const toggleLibraryManager = usePlayerStore((s) => s.toggleLibraryManager);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const [liked, setLiked] = useState(false);

  const album = albums[currentAlbumIndex];
  const track = album?.tracks[currentTrackIndex];
  const hasSelection = Boolean(track);
  const cover = album?.cover ? toAssetUrl(album.cover) : null;

  const repeatLabel =
    repeatMode === "one" ? "单曲循环" : repeatMode === "all" ? "列表循环" : "循环:关闭";

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
            <div className="player-cover placeholder" aria-hidden>
              {album?.name?.trim().charAt(0) || ""}
            </div>
          )}
          <div className="player-meta">
            <div className="player-title">{track ? track.title : "Select a track"}</div>
            <div className="player-album">{album?.artist || album?.name || "—"}</div>
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
      </div>

      <div className="player-transport">
        <button
          className={`player-mode${shuffle ? " active" : ""}`}
          onClick={toggleShuffle}
          title={shuffle ? "随机播放:开" : "随机播放:关"}
          aria-label="随机播放"
          aria-pressed={shuffle}
        >
          <IconShuffle />
        </button>
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
        <button
          className={`player-mode${repeatMode !== "off" ? " active" : ""}`}
          onClick={cycleRepeat}
          title={repeatLabel}
          aria-label={repeatLabel}
          aria-pressed={repeatMode !== "off"}
        >
          <IconRepeat />
          {repeatMode === "one" && <span className="player-mode-badge">1</span>}
        </button>
      </div>

      <ProgressBar />

      <div className="player-right">
        <VolumeSlider />

        <div className="player-tools">
          <button
            onClick={toggleLibraryManager}
            disabled={isLoading}
            title={error ?? (isLoading ? "扫描中…" : "库管理")}
            aria-label="库管理"
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

        <DiscColorMenu />
      </div>
    </div>
  );
}
