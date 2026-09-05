import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePlayerStore } from "../store/playerStore";
import { toAssetUrl } from "../audio/assetUrl";
import { AlbumVinyl } from "./AlbumGrid";

/** Max tilt (deg) per axis. */
const MAX_ROT = 14;
/** Degrees of tilt per pixel dragged. */
const ROT_PER_PX = 0.16;
/** Damped-spring constants: slightly underdamped, so releasing settles
 *  back with a soft bounce — the 阻尼感. */
const STIFFNESS = 210;
const DAMPING = 20;

/** Overlay while the library shelf is collapsed: the playing album's jacket
 *  + vinyl, same look as the shelf card but twice the size. Dragging in any
 *  direction tilts the card in simulated 3D — vertical drag pitches it
 *  (rotateX), horizontal drag yaws it (rotateY) — and damped springs make
 *  it lag behind the finger and settle back on release. */
export function NowPlayingArt() {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);

  const target = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });
  const vel = useRef({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const [rot, setRot] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Spring integration: cur chases target on both axes; releases settle at 0.
  useEffect(() => {
    let id = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const ax of ["x", "y"] as const) {
        vel.current[ax] += (target.current[ax] - cur.current[ax]) * STIFFNESS * dt;
        vel.current[ax] -= vel.current[ax] * DAMPING * dt;
        cur.current[ax] += vel.current[ax] * dt;
      }
      const settled =
        target.current.x === 0 &&
        target.current.y === 0 &&
        Math.abs(cur.current.x) < 0.02 &&
        Math.abs(cur.current.y) < 0.02 &&
        Math.abs(vel.current.x) < 0.02 &&
        Math.abs(vel.current.y) < 0.02;
      if (settled) {
        cur.current = { x: 0, y: 0 };
        vel.current = { x: 0, y: 0 };
      }
      setRot((r) =>
        settled && r.x === 0 && r.y === 0 ? r : { ...cur.current }
      );
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const album = currentAlbumIndex >= 0 ? albums[currentAlbumIndex] : undefined;
  if (!album) return null;

  const clampRot = (v: number) => Math.max(-MAX_ROT, Math.min(MAX_ROT, v));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragFrom.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragFrom.current) return;
    const dx = e.clientX - dragFrom.current.x;
    const dy = e.clientY - dragFrom.current.y;
    dragFrom.current = { x: e.clientX, y: e.clientY };
    // Vertical drag pitches (rotateX), horizontal drag yaws (rotateY) —
    // the receding edge follows the drag direction.
    target.current = {
      x: clampRot(target.current.x + dy * ROT_PER_PX),
      y: clampRot(target.current.y + dx * ROT_PER_PX),
    };
  };
  const onPointerUp = () => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    setDragging(false);
    target.current = { x: 0, y: 0 };
  };

  return (
    <div className="now-playing-art">
      <div
        className={`now-playing-card${dragging ? " dragging" : ""}`}
        style={{
          // Simulated 3D tilt, driven by the damped springs above.
          transform: `perspective(900px) rotateX(${rot.x}deg) rotateY(${rot.y}deg)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="album-art">
          <AlbumVinyl cover={album.cover} />
          {album.cover ? (
            <img
              className="album-cover"
              src={toAssetUrl(album.cover)}
              alt=""
              draggable={false}
            />
          ) : (
            <div className="album-cover placeholder">
              <span className="album-cover-name">{album.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
