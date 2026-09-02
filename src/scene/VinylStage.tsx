import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayerStore } from "../store/playerStore";
import {
  ARM_PIVOT,
  RECORD_R,
  RECORD_Y,
  TonearmArm,
  TonearmMount,
  VinylDisc,
} from "./Turntable";

/**
 * Where the 3D record should land on the background image, as fractions of
 * the DISPLAYED image (not the container — the image is `cover`-cropped).
 * Anchored to the machine in the photo (white deck center x≈43%, top edge
 * y≈45%): the disc hovers over the deck's upper half.
 */
const BG_IMAGE = "/bg.png";
const BG_ASPECT = 1672 / 941;
const BG_TARGET = { x: 0.51, y: 0.64, r: 0.2 };

/**
 * Tonearm proportions: the record shrank in the overlay, so a default-length
 * arm would shrink with it. OVERLAY_ARM_LEN gives the arm back its "full"
 * visual size. The pivot keeps the hand-tuned OFFSET direction but its
 * distance is scaled by the same ratio, so the stylus orbit still crosses
 * the lead-in/run-out grooves.
 */
const ARM_PIVOT_OFFSET = new THREE.Vector2(-0.54, 0.3);
/** Real-deck proportions: arm ≈ 1.53 × record radius, pivot ≈ 1.43 ×. */
const OVERLAY_ARM_LEN = 1.4;

/**
 * Fixed view that roughly matches the mockup's perspective on the disc —
 * mid elevation for a gently flattened ellipse, arm entering from right.
 */
const CAMERA = { pos: [0.3, 1.6, 3.05] as [number, number, number], fov: 30 };

/**
 * Keep a group aligned with a target rectangle of the CSS background image:
 * unproject the target center/radius from screen space onto the record plane
 * every frame, so the 3D disc tracks the `cover`-cropped image at any
 * container size.
 */
function useBgAlignment(group: React.RefObject<THREE.Group | null>) {
  const { camera, size } = useThree();

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const cw = size.width;
    const ch = size.height;

    // Displayed rect of the background image under CSS `cover`.
    const dispW = Math.max(cw, ch * BG_ASPECT);
    const dispH = dispW / BG_ASPECT;
    const offX = (cw - dispW) / 2;
    const offY = (ch - dispH) / 2;

    const cx = offX + BG_TARGET.x * dispW;
    const cy = offY + BG_TARGET.y * dispH;
    const rPx = BG_TARGET.r * dispW;

    // Screen px → NDC.
    const ndc = (px: number, py: number) =>
      new THREE.Vector2((px / cw) * 2 - 1, -(py / ch) * 2 + 1);

    // NDC → ray → intersect the record plane (y = RECORD_Y, scaled below, but
    // the scale is small so using the model plane keeps offset error tiny).
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -RECORD_Y);
    const pointAt = (px: number, py: number) => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc(px, py), camera);
      const hit = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, hit) ? hit : null;
    };

    const center = pointAt(cx, cy);
    const edge = pointAt(cx + rPx, cy);
    if (!center || !edge) return;

    const worldRadius = center.distanceTo(edge);
    if (!Number.isFinite(worldRadius) || worldRadius <= 1e-6) return;

    g.position.set(center.x, 0, center.z);
    g.scale.setScalar(worldRadius / RECORD_R);
  });
}

function OverlayScene() {
  const group = useRef<THREE.Group>(null);
  useBgAlignment(group);
  const armPivot = useMemo(() => {
    // The hand-tuned offset only sets the pivot DIRECTION around the disc;
    // the distance mirrors a real deck (≈1.43 × record radius, slightly
    // under the arm length so the stylus still reaches the run-out groove).
    const dir = ARM_PIVOT.clone().add(ARM_PIVOT_OFFSET).normalize();
    return dir.multiplyScalar(OVERLAY_ARM_LEN - 0.1);
  }, []);

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const album = albums[currentAlbumIndex];
  const active = currentAlbumIndex >= 0 && isPlaying;

  return (
    <group ref={group}>
      {/* Reuses the modeled record + tonearm from the 3D scene. */}
      <VinylDisc playing={active} coverPath={album?.cover ?? null} />
      <TonearmMount pivot={armPivot} />
      <TonearmArm pivot={armPivot} armLen={OVERLAY_ARM_LEN} />
    </group>
  );
}

/**
 * Background-image stage: the designed room photo fills the main area and a
 * transparent 3D canvas overlays just the spinning record + tonearm.
 */
export function VinylStage() {
  return (
    <div
      className="vinyl-stage"
      style={{ backgroundImage: `url(${BG_IMAGE})` }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: CAMERA.pos, fov: CAMERA.fov, near: 0.1, far: 30 }}
        gl={{ antialias: true, alpha: true, toneMappingExposure: 1.1 }}
      >
        {/* Match the photo's warm key light (upper-left) plus soft fills. */}
        <ambientLight intensity={0.55} color="#9a8f85" />
        <directionalLight position={[-2.4, 4, 2.2]} intensity={1.15} color="#ffe3c2" />
        <directionalLight position={[2.6, 2.2, 1.4]} intensity={0.35} color="#cfa9ff" />
        <pointLight position={[0, 1.6, 1.2]} intensity={0.22} color="#ffd9bb" distance={6} />

        <OverlayScene />
      </Canvas>
    </div>
  );
}
