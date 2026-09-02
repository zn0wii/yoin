import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "../audio/audioEngine";
import { toAssetUrl } from "../audio/assetUrl";
import { albumStylusProgress } from "../audio/albumProgress";
import { loadImage, makeGlowTexture, makeVinylTexture } from "./vinylTexture";

const PLATTER_RPM = 33.333;
const RAD_PER_SEC = (PLATTER_RPM / 60) * Math.PI * 2;

const RECORD_R = 0.93;
/** Label radius — must stay in sync with LABEL_OF_DISC in vinylTexture.ts. */
const LABEL_R = RECORD_R * 0.48;

/* Shared materials — module-level instances are safe to reuse across meshes. */
const armMaterial = new THREE.MeshPhysicalMaterial({
  color: "#0c0c0f",
  roughness: 0.2,
  metalness: 0.35,
  clearcoat: 1,
  clearcoatRoughness: 0.2,
});
const steelMaterial = new THREE.MeshStandardMaterial({
  color: "#cfc9bd",
  roughness: 0.25,
  metalness: 0.9,
});

/* --- Tonearm kinematics --------------------------------------------------- */

/** Pivot position on the plinth (rear-right), x/z in world space. */
const ARM_PIVOT = new THREE.Vector2(1.08, -0.72);
/** Distance pivot → stylus; the arm reaches along local −X. */
const ARM_LEN = 1.245;
/** Parked yaw, swung clear of the platter (~24° past lead-in). */
const ARM_REST_YAW = 1.75;

function stylusRadius(yaw: number): number {
  const sx = ARM_PIVOT.x - ARM_LEN * Math.cos(yaw);
  const sz = ARM_PIVOT.y + ARM_LEN * Math.sin(yaw);
  return Math.hypot(sx, sz);
}

/** Yaw that puts the stylus on a given groove radius. Stylus radius grows
 * monotonically with yaw across the sweep, so binary search converges. */
function yawForRadius(r: number): number {
  let lo = 0.7;
  let hi = ARM_REST_YAW;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stylusRadius(mid) > r) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Lift (Z rotation): negative = tip raised, ~0 = needle on the groove. */
const ARM_REST = { yaw: ARM_REST_YAW, lift: -0.09 };
const ARM_LEAD_IN = { yaw: yawForRadius(0.9), lift: 0.004 };
const ARM_RUN_OUT = { yaw: yawForRadius(0.52), lift: 0.004 };

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
    <group ref={group} position={[0, 0.105, 0]}>
      {/* Smoked-translucent side wall (openEnded — no caps to z-fight with
          the label/groove planes stacked just above it) */}
      <mesh castShadow>
        <cylinderGeometry args={[RECORD_R, RECORD_R, 0.012, 96, 1, true]} />
        <meshStandardMaterial
          color="#15151a"
          roughness={0.4}
          metalness={0.1}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* Grooved playing surface (see-through, lit from beneath) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0072, 0]}>
        <ringGeometry args={[LABEL_R - 0.002, RECORD_R, 96]} />
        <meshStandardMaterial
          map={grooveMap}
          roughness={0.42}
          metalness={0.08}
          transparent
          opacity={0.72}
          depthWrite={false}
        />
      </mesh>
      {/* Opaque center label (album cover / fallback rings) — slight
          self-illumination so dark covers stay readable in the dim scene */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}>
        <circleGeometry args={[LABEL_R, 64]} />
        <meshStandardMaterial
          map={grooveMap}
          roughness={0.5}
          metalness={0.02}
          emissive="#ffffff"
          emissiveMap={grooveMap}
          emissiveIntensity={0.22}
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
  const level = useRef(0.35);
  const map = useMemo(() => makeGlowTexture(), []);

  useFrame((_, dt) => {
    const target = playing ? 0.65 + audioEngine.getAmplitude() * 0.7 : 0.35;
    level.current = THREE.MathUtils.lerp(level.current, target, 1 - Math.exp(-6 * dt));
    if (mat.current) mat.current.opacity = level.current;
    if (light.current) light.current.intensity = level.current * 0.55;
  });

  return (
    <group position={[0, 0.0975, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.985, 64]} />
        <meshBasicMaterial
          ref={mat}
          map={map}
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <pointLight
        ref={light}
        position={[0, 0.3, 0]}
        color="#ff6d8a"
        intensity={0.4}
        distance={2.8}
        decay={2}
      />
    </group>
  );
}

function Platter() {
  return (
    <group>
      {/* Frosted acrylic platter */}
      <mesh castShadow receiveShadow position={[0, 0.07, 0]}>
        <cylinderGeometry args={[1, 1, 0.05, 96]} />
        <meshStandardMaterial
          color="#e8e3db"
          roughness={0.5}
          metalness={0}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Machined rim detail */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0952, 0]}>
        <ringGeometry args={[0.955, 0.995, 96]} />
        <meshStandardMaterial color="#c9c3b8" roughness={0.6} />
      </mesh>
      {/* Spindle */}
      <mesh position={[0, 0.125, 0]} material={steelMaterial} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.06, 24]} />
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
      {/* Mount base + collar (static) */}
      <mesh
        position={[ARM_PIVOT.x, 0.0875, ARM_PIVOT.y]}
        material={armMaterial}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.095, 0.105, 0.085, 32]} />
      </mesh>
      <mesh position={[ARM_PIVOT.x, 0.1475, ARM_PIVOT.y]} material={armMaterial}>
        <cylinderGeometry args={[0.04, 0.04, 0.035, 24]} />
      </mesh>

      <group ref={pivot} position={[ARM_PIVOT.x, 0.18, ARM_PIVOT.y]}>
        {/* Straight glossy arm tube */}
        <mesh
          position={[-0.62, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={armMaterial}
          castShadow
        >
          <cylinderGeometry args={[0.015, 0.015, 1.16, 16]} />
        </mesh>
        {/* Rear stub + counterweight */}
        <mesh position={[0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={armMaterial}>
          <cylinderGeometry args={[0.011, 0.011, 0.14, 12]} />
        </mesh>
        <mesh
          position={[0.19, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={armMaterial}
          castShadow
        >
          <cylinderGeometry args={[0.052, 0.052, 0.095, 32]} />
        </mesh>
        {/* Headshell — angled inward, cartridge + stylus under the far end */}
        <group position={[-1.2, 0, 0]} rotation={[0, 0.42, 0]}>
          <mesh material={armMaterial} castShadow>
            <boxGeometry args={[0.15, 0.02, 0.048]} />
          </mesh>
          {/* Finger lift */}
          <mesh
            position={[0.05, 0.03, 0.018]}
            rotation={[0, 0, -0.6]}
            material={steelMaterial}
          >
            <cylinderGeometry args={[0.004, 0.004, 0.06, 8]} />
          </mesh>
          {/* Cartridge body */}
          <mesh position={[-0.015, -0.026, 0]}>
            <boxGeometry args={[0.075, 0.032, 0.042]} />
            <meshStandardMaterial color="#26262b" roughness={0.55} metalness={0.1} />
          </mesh>
          {/* Stylus (tip down) */}
          <mesh
            position={[-0.045, -0.056, 0]}
            rotation={[Math.PI, 0, 0]}
            material={steelMaterial}
          >
            <coneGeometry args={[0.007, 0.024, 8]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Plinth() {
  return (
    <group>
      {/* Matte white low-profile chassis */}
      <RoundedBox
        args={[2.9, 0.09, 2.05]}
        radius={0.028}
        smoothness={4}
        position={[0.05, 0, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#f2efe9" roughness={0.62} metalness={0.02} />
      </RoundedBox>
      {/* Rubber feet */}
      {(
        [
          [-1.22, -0.78],
          [-1.22, 0.78],
          [1.32, -0.78],
          [1.32, 0.78],
        ] as const
      ).map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, -0.075, z]} castShadow>
          <cylinderGeometry args={[0.1, 0.11, 0.06, 24]} />
          <meshStandardMaterial color="#26221e" roughness={0.85} />
        </mesh>
      ))}
      {/* Arm rest post + clip, where the headshell parks */}
      <group position={[1.29, 0, 0.45]}>
        <mesh position={[0, 0.16, 0]} material={armMaterial} castShadow>
          <cylinderGeometry args={[0.016, 0.02, 0.23, 16]} />
        </mesh>
        <mesh position={[0, 0.283, 0]} material={armMaterial}>
          <boxGeometry args={[0.052, 0.02, 0.032]} />
        </mesh>
      </group>
    </group>
  );
}

/** Dark warm surface the deck sits on. */
function Desk() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.112, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#211a13" roughness={0.92} metalness={0} />
    </mesh>
  );
}

/** Procedural minimalist turntable — white plinth, frosted backlit platter,
 * glossy black straight arm. Spins + drops the arm when playing. */
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
