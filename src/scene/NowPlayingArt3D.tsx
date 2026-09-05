import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { usePlayerStore, type Album } from "../store/playerStore";
import { toAssetUrl } from "../audio/assetUrl";
import { loadImage } from "./vinylTexture";

/** No-cover jacket: the album (folder) name printed on a gradient sleeve. */
function makeFallbackJacket(album: Album): THREE.CanvasTexture {
  const size = 512;
  const cnv = document.createElement("canvas");
  cnv.width = cnv.height = size;
  const ctx = cnv.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, "#5a3a36");
    grad.addColorStop(1, "#2a1c1a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(247, 241, 234, 0.88)";
    ctx.font = "600 34px -apple-system, 'SF Pro Text', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxW = size * 0.82;
    const lines: string[] = [];
    let line = "";
    for (const ch of album.name) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
      if (lines.length === 4) break;
    }
    if (line && lines.length < 4) lines.push(line);
    const startY = size / 2 - ((lines.length - 1) * 44) / 2;
    lines.forEach((l, i) => ctx.fillText(l, size / 2, startY + i * 44));
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Front-face cover texture for the jacket box; fallback sleeve when absent.
 *  Starts with the fallback so the material always has a map from mount —
 *  swapping map→map needs no shader recompile, null→map would never show. */
function useJacketMap(album: Album): THREE.Texture {
  const [map, setMap] = useState<THREE.Texture>(() => makeFallbackJacket(album));

  useEffect(() => {
    let cancelled = false;
    const disposables: THREE.Texture[] = [];

    const applyFallback = () => {
      const tex = makeFallbackJacket(album);
      if (cancelled) {
        tex.dispose();
        return;
      }
      disposables.push(tex);
      setMap(tex);
    };

    if (album.cover) {
      loadImage(toAssetUrl(album.cover))
        .then((img) => {
          if (cancelled) return;
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          tex.needsUpdate = true;
          disposables.push(tex);
          setMap(tex);
        })
        .catch((err) => {
          console.warn("[now-playing] cover load failed", err);
          if (!cancelled) applyFallback();
        });
    } else {
      applyFallback();
    }
    return () => {
      cancelled = true;
      disposables.forEach((tex) => tex.dispose());
    };
  }, [album]);

  return map;
}

/** Drag tilt target shared between the DOM pointer handlers and the r3f
 *  frame loop (a plain ref survives across the Canvas boundary). */
interface TiltTarget {
  x: number;
  y: number;
}

/** Jacket only — the cover as a solid 3D sleeve facing the camera. Damps
 *  toward the drag tilt target. */
function RecordGroup({
  album,
  tilt,
}: {
  album: Album;
  tilt: React.RefObject<TiltTarget>;
}) {
  const group = useRef<THREE.Group>(null);
  const jacketMap = useJacketMap(album);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-8 * dt);
    g.rotation.y += (tilt.current.y - g.rotation.y) * k;
    g.rotation.x += (tilt.current.x - g.rotation.x) * k;
  });

  return (
    <group ref={group}>
      {/* Jacket — thin sleeve facing the camera; cover print on the front,
          dark cardboard elsewhere. */}
      <mesh castShadow>
        <boxGeometry args={[1.05, 1.05, 0.045]} />
        <meshStandardMaterial attach="material-0" color="#241a17" roughness={0.85} />
        <meshStandardMaterial attach="material-1" color="#241a17" roughness={0.85} />
        <meshStandardMaterial attach="material-2" color="#2b201c" roughness={0.85} />
        <meshStandardMaterial attach="material-3" color="#2b201c" roughness={0.85} />
        <meshStandardMaterial
          attach="material-4"
          map={jacketMap}
          color="#ffffff"
          roughness={0.72}
        />
        <meshStandardMaterial attach="material-5" color="#241a17" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** Replaces the flat 2× cover while the library shelf is collapsed: the same
 *  jacket + peeking-vinyl composition, built as solid 3D objects. Dragging
 *  tilts the whole group slightly; releasing springs it back upright. */
export function NowPlayingArt3D() {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);

  const album = currentAlbumIndex >= 0 ? albums[currentAlbumIndex] : undefined;
  const tilt = useRef<TiltTarget>({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

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
    tilt.current.y = clamp(tilt.current.y + dx * 0.004, 0.5);
    tilt.current.x = clamp(tilt.current.x + dy * 0.004, 0.38);
  };
  const onPointerUp = () => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    setDragging(false);
    // Spring back upright.
    tilt.current.x = 0;
    tilt.current.y = 0;
  };

  if (!album) return null;

  return (
    <div
      className={`now-playing-3d${dragging ? " dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0.06, 2.15], fov: 34, near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <directionalLight position={[2.4, 3.2, 2.2]} intensity={1.0} color="#ffe4c0" />
        <directionalLight position={[-2.8, 2.2, 1.6]} intensity={0.7} color="#fff6ee" />
        <ambientLight intensity={0.35} color="#b0a298" />

        {/* Static env so the groove sheen / anisotropy catches a soft band. */}
        <Environment resolution={128} frames={1} environmentIntensity={0.9}>
          <Lightformer
            intensity={2.2}
            color="#ffd8b0"
            position={[2.4, 2.6, -2]}
            rotation={[0, Math.PI, 0]}
            scale={[5, 3.5, 1]}
          />
          <Lightformer
            intensity={2.2}
            color="#fff6ee"
            position={[-3, 2.2, 2]}
            rotation={[0, Math.PI / 3, 0]}
            scale={[4, 3, 1]}
          />
          <Lightformer
            intensity={0.6}
            color="#ffc8d2"
            position={[0, -1.4, 2.6]}
            scale={[5, 2, 1]}
          />
        </Environment>

        <RecordGroup album={album} tilt={tilt} />
      </Canvas>
    </div>
  );
}
