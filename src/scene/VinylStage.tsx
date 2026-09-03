import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { BACKGROUNDS, usePlayerStore } from "../store/playerStore";
import {
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
 * All backgrounds share the same composition, so one target fits them all.
 */
const BG_ASPECT = 1672 / 941;
const BG_TARGET = { x: 0.51, y: 0.64, r: 0.2 };

/**
 * Classic tonearm layout, like a real deck: pivot base at the rear-right of
 * the platter, arm reaching across the rim, needle on the groove, parked on
 * a rest beside the platter. Proportions mirror a real turntable: pivot ≈
 * 1.43 × record radius, effective arm ≈ 1.55 ×, with a small overhang past
 * the spindle.
 */
const OVERLAY_PIVOT_ANGLE = -37.9 * (Math.PI / 180);
const OVERLAY_PIVOT_DIST = 1.3;
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
  const armPivot = useMemo(
    () =>
      new THREE.Vector2(
        Math.cos(OVERLAY_PIVOT_ANGLE) * OVERLAY_PIVOT_DIST,
        Math.sin(OVERLAY_PIVOT_ANGLE) * OVERLAY_PIVOT_DIST
      ),
    []
  );

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const album = albums[currentAlbumIndex];
  const active = currentAlbumIndex >= 0 && isPlaying;

  return (
    <group ref={group}>
      {/* constantScreenLength: the stage camera is locked to the photo, so a
          rigid arm foreshortens as it sweeps and reads as "stretching" on the
          flat composite. This cancels it presentation-side (see TonearmArm). */}
      <VinylDisc
        playing={active}
        coverPath={album?.cover ?? null}
        title={album?.name ?? null}
        artist={album?.artist ?? null}
      />
      <TonearmMount pivot={armPivot} />
      <TonearmArm
        pivot={armPivot}
        armLen={OVERLAY_ARM_LEN}
        constantScreenLength
      />
    </group>
  );
}

/**
 * Background-image stage: the designed room photo fills the main area and a
 * transparent 3D canvas overlays just the spinning record + tonearm.
 */
export function VinylStage() {
  const backgroundIndex = usePlayerStore((s) => s.backgroundIndex);
  const bgImage = BACKGROUNDS[backgroundIndex] ?? BACKGROUNDS[0];

  // Warm the other backgrounds so the first switch is instant, not a flash.
  useEffect(() => {
    for (const bg of BACKGROUNDS) {
      if (bg !== bgImage) new Image().src = bg;
    }
  }, [bgImage]);

  return (
    <div
      className="vinyl-stage"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        camera={{ position: CAMERA.pos, fov: CAMERA.fov, near: 0.1, far: 30 }}
        gl={{
          antialias: true,
          alpha: true,
          premultipliedAlpha: true,
          toneMappingExposure: 1.14,
        }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        {/* Key from upper-right: arm shadow falls down-left onto the record. */}
        <directionalLight
          castShadow
          position={[2.6, 4, 1.8]}
          intensity={0.85}
          color="#ffe4c0"
          shadow-mapSize={[1024, 1024]}
          shadow-radius={8}
          shadow-bias={-0.0005}
          shadow-intensity={0.45}
          shadow-camera-near={1}
          shadow-camera-far={12}
          shadow-camera-left={-2.5}
          shadow-camera-right={2.5}
          shadow-camera-top={2.5}
          shadow-camera-bottom={-2.5}
        />
        {/* Left fill — drives the silvery groove band on the near-left rim. */}
        <directionalLight position={[-3.2, 3.0, 1.6]} intensity={0.95} color="#fff6ee" />
        <ambientLight intensity={0.3} color="#b0a298" />

        {/* Window-scale lightformers so groove normals / anisotropy catch a
            soft specular band like vinyl.png, not a glassy mirror streak. */}
        <Environment resolution={256} frames={1} environmentIntensity={1.05}>
          <Lightformer
            intensity={2.4}
            color="#ffd8b0"
            position={[2.4, 3.4, -2.2]}
            rotation={[0, Math.PI, 0]}
            scale={[6, 4, 1]}
          />
          <Lightformer
            intensity={2.6}
            color="#fff6ee"
            position={[-3.6, 2.8, 2.2]}
            rotation={[0, Math.PI / 3, 0]}
            scale={[5, 3.5, 1]}
          />
          <Lightformer
            intensity={0.8}
            color="#ffe2b8"
            position={[2.6, 3.2, 1.6]}
            rotation={[0, -Math.PI / 3, 0]}
            scale={[3, 3, 1]}
          />
          <Lightformer
            intensity={0.35}
            color="#ffc8d2"
            position={[0, 0.4, 3.2]}
            scale={[8, 2, 1]}
          />
        </Environment>

        <OverlayScene />
      </Canvas>
    </div>
  );
}
