import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "../audio/audioEngine";
import { toAssetUrl } from "../audio/assetUrl";
import { albumStylusProgress } from "../audio/albumProgress";
import {
  loadImage,
  makeGlowTexture,
  makePlatterTexture,
  makeVinylTexture,
} from "./vinylTexture";

const PLATTER_RPM = 33.333;
const RAD_PER_SEC = (PLATTER_RPM / 60) * Math.PI * 2;

const PLATTER_R = 0.98;
const RECORD_R = 0.91;
/** Label radius — must stay in sync with LABEL_OF_DISC in vinylTexture.ts. */
const LABEL_R = RECORD_R * 0.48;

/* Shared materials — module-level instances are safe to reuse across meshes. */
const armMaterial = new THREE.MeshStandardMaterial({
  color: "#131316",
  roughness: 0.52,
  metalness: 0.28,
});
const steelMaterial = new THREE.MeshStandardMaterial({
  color: "#c8c2b6",
  roughness: 0.3,
  metalness: 0.9,
});
const stylusMaterial = new THREE.MeshStandardMaterial({
  color: "#ff4438",
  emissive: "#c81f12",
  emissiveIntensity: 0.55,
  roughness: 0.35,
  metalness: 0.2,
});

/* --- Tonearm kinematics --------------------------------------------------- */

/** Pivot position on the plinth (rear-right), x/z in world space. */
const ARM_PIVOT = new THREE.Vector2(1.26, -0.86);
/** Distance pivot → stylus; the arm reaches along local −X. */
const ARM_LEN = 1.46;
/** Parked yaw, swung clear of the platter. */
const ARM_REST_YAW = 1.7;

function stylusRadius(yaw: number): number {
  const sx = ARM_PIVOT.x - ARM_LEN * Math.cos(yaw);
  const sz = ARM_PIVOT.y + ARM_LEN * Math.sin(yaw);
  return Math.hypot(sx, sz);
}

/** Yaw that puts the stylus on a given groove radius. Stylus radius grows
 * monotonically with yaw across the sweep, so binary search converges. */
function yawForRadius(r: number): number {
  let lo = 0.5;
  let hi = ARM_REST_YAW;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stylusRadius(mid) > r) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Lift (Z rotation): negative = tip raised, ~0 = needle on the groove. */
const ARM_REST = { yaw: ARM_REST_YAW, lift: -0.1 };
const ARM_LEAD_IN = { yaw: yawForRadius(0.86), lift: 0.005 };
const ARM_RUN_OUT = { yaw: yawForRadius(0.52), lift: 0.005 };

/** Where the headshell parks — derived from the same geometry, not hand-tuned. */
const ARM_REST_POS = {
  x: ARM_PIVOT.x - ARM_LEN * Math.cos(ARM_REST_YAW),
  z: ARM_PIVOT.y + ARM_LEN * Math.sin(ARM_REST_YAW),
};

function useVinylMap(coverPath: string | null | undefined) {
  const fallback = useMemo(() => makeVinylTexture(null), []);
  const [map, setMap] = useState<THREE.CanvasTexture>(fallback);

  useEffect(() => {
    let cancelled = false;
    if (!coverPath) {
      setMap(makeVinylTexture(null));
      return;
    }
    const url = toAssetUrl(coverPath);
    loadImage(url)
      .then((img) => {
        if (cancelled) return;
        setMap(makeVinylTexture(img));
      })
      .catch((err) => {
        console.warn("[vinyl] cover load failed", err);
        if (!cancelled) setMap(makeVinylTexture(null));
      });
    return () => {
      cancelled = true;
    };
  }, [coverPath]);

  return map;
}

function VinylDisc({
  playing,
  coverPath,
}: {
  playing: boolean;
  coverPath: string | null | undefined;
}) {
  const group = useRef<THREE.Group>(null);
  const grooveMap = useVinylMap(coverPath);

  useFrame((_, dt) => {
    if (!group.current || !playing) return;
    group.current.rotation.y += RAD_PER_SEC * dt;
  });

  return (
    <group ref={group} position={[0, 0.0715, 0]}>
      {/* Sakura-glass side wall (openEnded — no caps to z-fight with the
          label/groove planes stacked just above it) */}
      <mesh castShadow>
        <cylinderGeometry args={[RECORD_R, RECORD_R, 0.01, 96, 1, true]} />
        <meshPhysicalMaterial
          color="#f5afc0"
          roughness={0.12}
          metalness={0}
          transparent
          opacity={0.55}
          clearcoat={1}
          clearcoatRoughness={0.08}
        />
      </mesh>
      {/* Grooved face — pink glass with a clearcoat sheen */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[LABEL_R - 0.002, RECORD_R, 96]} />
        <meshPhysicalMaterial
          map={grooveMap}
          roughness={0.14}
          metalness={0.05}
          transparent
          opacity={0.68}
          depthWrite={false}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>
      {/* Center label (album cover / coral fallback rings) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0062, 0]}>
        <circleGeometry args={[LABEL_R, 64]} />
        <meshPhysicalMaterial
          map={grooveMap}
          roughness={0.35}
          metalness={0.02}
          clearcoat={0.6}
          clearcoatRoughness={0.2}
          emissive="#ffffff"
          emissiveMap={grooveMap}
          emissiveIntensity={0.2}
        />
      </mesh>
    </group>
  );
}

/**
 * Backlit platter center: an additive pink glow disc under the record plus a
 * matching accent light. Pulses with the music once the analyser has data.
 */
function CenterGlow({ playing }: { playing: boolean }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const level = useRef(0.22);
  const map = useMemo(() => makeGlowTexture(), []);

  useFrame((_, dt) => {
    const target = playing ? 0.45 + audioEngine.getAmplitude() * 0.5 : 0.22;
    level.current = THREE.MathUtils.lerp(level.current, target, 1 - Math.exp(-6 * dt));
    if (mat.current) mat.current.opacity = level.current;
    if (light.current) light.current.intensity = level.current * 0.5;
  });

  return (
    <group position={[0, 0.0658, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.95, 64]} />
        <meshBasicMaterial
          ref={mat}
          map={map}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight
        ref={light}
        position={[0, 0.28, 0]}
        color="#ff6d8a"
        intensity={0.3}
        distance={3}
        decay={2}
      />
    </group>
  );
}

function Platter() {
  const faceMap = useMemo(() => makePlatterTexture(), []);
  return (
    <group>
      {/* Frosted acrylic side wall */}
      <mesh castShadow receiveShadow position={[0, 0.045, 0]}>
        <cylinderGeometry args={[PLATTER_R, PLATTER_R, 0.04, 96, 1, true]} />
        <meshPhysicalMaterial
          color="#f6e9ea"
          roughness={0.25}
          metalness={0}
          transparent
          opacity={0.7}
          clearcoat={0.6}
          clearcoatRoughness={0.2}
        />
      </mesh>
      {/* Milky → pale-pink translucent face, whiter plinth shows through */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0652, 0]}>
        <circleGeometry args={[PLATTER_R, 96]} />
        <meshStandardMaterial
          map={faceMap}
          transparent
          roughness={0.38}
          metalness={0}
        />
      </mesh>
      {/* Spindle */}
      <mesh position={[0, 0.095, 0]} material={steelMaterial} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 0.06, 24]} />
      </mesh>
    </group>
  );
}

function Tonearm() {
  const pivot = useRef<THREE.Group>(null);
  const yaw = useRef(ARM_REST.yaw);
  const lift = useRef(ARM_REST.lift);

  useFrame((_, dt) => {
    if (!pivot.current) return;

    // Read live playback clock every frame (not the ~4Hz React timeupdate).
    const s = usePlayerStore.getState();
    const album = s.albums[s.currentAlbumIndex];
    const onGroove = s.currentAlbumIndex >= 0;
    const needleDown = onGroove && s.isPlaying;
    const liveTime = onGroove ? audioEngine.currentTime : 0;
    const liveDur = audioEngine.duration;
    const t = albumStylusProgress(
      album,
      s.currentTrackIndex,
      liveTime,
      s.trackDurations,
      liveDur
    );

    const grooveYaw = THREE.MathUtils.lerp(ARM_LEAD_IN.yaw, ARM_RUN_OUT.yaw, t);
    const targetYaw = onGroove ? grooveYaw : ARM_REST.yaw;
    const targetLift = needleDown ? ARM_LEAD_IN.lift : ARM_REST.lift;
    // Light smoothing — tracks the groove closely without visible stepping.
    const k = 1 - Math.exp(-10 * dt);
    yaw.current = THREE.MathUtils.lerp(yaw.current, targetYaw, k);
    lift.current = THREE.MathUtils.lerp(lift.current, targetLift, k);
    pivot.current.rotation.y = yaw.current;
    pivot.current.rotation.z = lift.current;
  });

  return (
    <group>
      {/* Mount base + collar + gimbal (static, mechanical details around it) */}
      <mesh
        position={[ARM_PIVOT.x, 0.06, ARM_PIVOT.y]}
        material={armMaterial}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.085, 0.095, 0.07, 32]} />
      </mesh>
      <mesh position={[ARM_PIVOT.x, 0.1075, ARM_PIVOT.y]} material={armMaterial}>
        <cylinderGeometry args={[0.036, 0.036, 0.025, 24]} />
      </mesh>
      <mesh position={[ARM_PIVOT.x, 0.128, ARM_PIVOT.y]} material={armMaterial}>
        <cylinderGeometry args={[0.028, 0.028, 0.024, 20]} />
      </mesh>
      {/* Small steel rods — anti-skate / adjustment levers */}
      {(
        [
          [ARM_PIVOT.x - 0.09, ARM_PIVOT.y - 0.1],
          [ARM_PIVOT.x + 0.07, ARM_PIVOT.y - 0.11],
        ] as const
      ).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.0675, z]} material={steelMaterial} castShadow>
          <cylinderGeometry args={[0.006, 0.006, 0.085, 10]} />
        </mesh>
      ))}

      <group ref={pivot} position={[ARM_PIVOT.x, 0.132, ARM_PIVOT.y]}>
        {/* Slim matte-black straight arm tube */}
        <mesh
          position={[-0.725, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={armMaterial}
          castShadow
        >
          <cylinderGeometry args={[0.013, 0.013, 1.35, 16]} />
        </mesh>
        {/* Rear stub + counterweight */}
        <mesh position={[0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={armMaterial}>
          <cylinderGeometry args={[0.01, 0.01, 0.13, 12]} />
        </mesh>
        <mesh
          position={[0.19, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={armMaterial}
          castShadow
        >
          <cylinderGeometry args={[0.05, 0.05, 0.09, 32]} />
        </mesh>
        {/* Headshell — angled inward, cartridge + red stylus under the far end */}
        <group position={[-1.42, 0, 0]} rotation={[0, 0.42, 0]}>
          <mesh material={armMaterial} castShadow>
            <boxGeometry args={[0.14, 0.018, 0.044]} />
          </mesh>
          {/* Finger lift */}
          <mesh
            position={[0.048, 0.028, 0.016]}
            rotation={[0, 0, -0.6]}
            material={steelMaterial}
          >
            <cylinderGeometry args={[0.0035, 0.0035, 0.055, 8]} />
          </mesh>
          {/* Cartridge body */}
          <mesh position={[-0.012, -0.024, 0]}>
            <boxGeometry args={[0.07, 0.03, 0.04]} />
            <meshStandardMaterial color="#1c1c20" roughness={0.6} metalness={0.1} />
          </mesh>
          {/* Red stylus tip (small but high-contrast) */}
          <mesh
            position={[-0.04, -0.055, 0]}
            rotation={[Math.PI, 0, 0]}
            material={stylusMaterial}
          >
            <coneGeometry args={[0.0075, 0.024, 10]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Plinth() {
  return (
    <group>
      {/* Ultra-thin paper-white slab — the record seems to float on it */}
      <RoundedBox
        args={[2.9, 0.05, 2.14]}
        radius={0.016}
        smoothness={4}
        position={[0.03, 0, 0.02]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#faf8f4" roughness={0.55} metalness={0.02} />
      </RoundedBox>
      {/* Low feet, mostly hidden */}
      {(
        [
          [-1.24, -0.8],
          [-1.24, 0.84],
          [1.3, -0.8],
          [1.3, 0.84],
        ] as const
      ).map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, -0.037, z]} castShadow>
          <cylinderGeometry args={[0.08, 0.09, 0.026, 24]} />
          <meshStandardMaterial color="#242019" roughness={0.85} />
        </mesh>
      ))}
      {/* Arm rest post + clip, where the headshell parks */}
      <group position={[ARM_REST_POS.x, 0, ARM_REST_POS.z]}>
        <mesh position={[0, 0.1125, 0]} material={armMaterial} castShadow>
          <cylinderGeometry args={[0.015, 0.019, 0.175, 16]} />
        </mesh>
        <mesh position={[0, 0.202, 0]} material={armMaterial}>
          <boxGeometry args={[0.05, 0.018, 0.03]} />
        </mesh>
      </group>
    </group>
  );
}

/** Dark warm surface the deck sits on. */
function Desk() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.055, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#241a12" roughness={0.92} metalness={0} />
    </mesh>
  );
}

/** Procedural minimalist turntable — thin white plinth, large frosted
 * backlit platter, translucent pink record, slim matte-black straight arm. */
export function Turntable() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const hasTrack = currentAlbumIndex >= 0;
  const album = albums[currentAlbumIndex];
  const active = hasTrack && isPlaying;
  const coverPath = album?.cover ?? null;

  return (
    <group>
      <Desk />
      <Plinth />
      <Platter />
      <CenterGlow playing={active} />
      <VinylDisc playing={active} coverPath={coverPath} />
      <Tonearm />
    </group>
  );
}
