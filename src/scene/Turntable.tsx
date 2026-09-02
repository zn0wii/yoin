import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "../audio/audioEngine";
import { toAssetUrl } from "../audio/assetUrl";
import { albumStylusProgress } from "../audio/albumProgress";
import { loadImage, makeVinylTexture } from "./vinylTexture";

const PLATTER_RPM = 33.333;
const RAD_PER_SEC = (PLATTER_RPM / 60) * Math.PI * 2;

/**
 * Tonearm yaw (Y) ↔ stylus radius on the platter (pivot ≈ (0.95,0.95), arm ≈ 1.12):
 *   lead-in  yaw≈+0.03 → r≈1.00 (outer)
 *   run-out  yaw≈-0.37 → r≈0.55 (inner, just outside label)
 * Range is monotonic outer→inner. Lift (Z): negative = tip raised.
 */
const ARM_REST = { yaw: 0.85, lift: -0.28 };
const ARM_LEAD_IN = { yaw: 0.03, lift: 0.02 };
const ARM_RUN_OUT = { yaw: -0.37, lift: 0.02 };

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
    <group ref={group} position={[0, 0.055, 0]}>
      {/* Cylinder is Y-up by default = flat disc on the platter. */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[1.05, 1.05, 0.018, 96]} />
        <meshStandardMaterial color="#121214" roughness={0.55} metalness={0.05} />
      </mesh>
      {/* Top face: grooves + album cover label */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[1.05, 96]} />
        <meshStandardMaterial map={grooveMap} roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.01, 32]} />
        <meshStandardMaterial color="#2a2a2e" roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  );
}

function Platter() {
  return (
    <group position={[0, 0.03, 0]}>
      <mesh receiveShadow castShadow>
        <cylinderGeometry args={[1.12, 1.12, 0.04, 64]} />
        <meshStandardMaterial color="#2c2c30" roughness={0.55} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.022, 0]}>
        <cylinderGeometry args={[1.08, 1.08, 0.006, 64]} />
        <meshStandardMaterial color="#1a1a1c" roughness={0.9} metalness={0} />
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
    <group position={[0.95, 0.12, 0.95]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.09, 0.1, 0.06, 32]} />
        <meshStandardMaterial color="#d8d2c8" roughness={0.35} metalness={0.55} />
      </mesh>
      <group ref={pivot} position={[0, 0.04, 0]}>
        <mesh position={[0.18, 0.02, 0]} castShadow>
          <boxGeometry args={[0.14, 0.05, 0.05]} />
          <meshStandardMaterial color="#3a3a3e" roughness={0.4} metalness={0.5} />
        </mesh>
        <mesh position={[-0.55, 0.025, 0]} rotation={[0, 0, 0.02]} castShadow>
          <boxGeometry args={[1.0, 0.028, 0.028]} />
          <meshStandardMaterial color="#c8c2b8" roughness={0.3} metalness={0.7} />
        </mesh>
        <group position={[-1.08, 0.01, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.12, 0.02, 0.07]} />
            <meshStandardMaterial color="#2e2e32" roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[-0.04, -0.03, 0]}>
            <coneGeometry args={[0.008, 0.04, 8]} />
            <meshStandardMaterial color="#111114" roughness={0.3} metalness={0.8} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function Plinth() {
  return (
    <group>
      <mesh position={[0.15, 0, 0.05]} receiveShadow castShadow>
        <boxGeometry args={[2.6, 0.08, 2.2]} />
        <meshStandardMaterial color="#f2ebe0" roughness={0.65} metalness={0.05} />
      </mesh>
      <mesh position={[1.05, 0.055, -0.15]} castShadow>
        <boxGeometry args={[0.55, 0.03, 1.5]} />
        <meshStandardMaterial color="#ece4d8" roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[1.05, 0.09, 0.35]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.04, 24]} />
        <meshStandardMaterial color="#c45c3e" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[1.05, 0.08, -0.35]} castShadow>
        <boxGeometry args={[0.08, 0.02, 0.35]} />
        <meshStandardMaterial color="#2a2a2e" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.08, 16]} />
        <meshStandardMaterial color="#b8b2a8" roughness={0.25} metalness={0.85} />
      </mesh>
    </group>
  );
}

function Desk() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.041, 0]} receiveShadow>
      <planeGeometry args={[12, 12]} />
      <meshStandardMaterial color="#e8e2d8" roughness={0.85} metalness={0} />
    </mesh>
  );
}

/** Procedural Technics-inspired turntable. Spins + drops tonearm when playing. */
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
      <VinylDisc playing={active} coverPath={coverPath} />
      <Tonearm />
    </group>
  );
}
