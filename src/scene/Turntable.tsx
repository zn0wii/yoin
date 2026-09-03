import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "../audio/audioEngine";
import { toAssetUrl } from "../audio/assetUrl";
import { albumStylusProgress } from "../audio/albumProgress";
import {
  LABEL_OF_DISC,
  loadImage,
  makeGlowTexture,
  makePlatterTexture,
  makeVinylGrooveMaps,
  makeVinylLabelTexture,
} from "./vinylTexture";

const PLATTER_RPM = 33.333;
const RAD_PER_SEC = (PLATTER_RPM / 60) * Math.PI * 2;

const PLATTER_R = 0.98;
/** Record disc radius — reused by the overlay stage for screen alignment. */
export const RECORD_R = 0.91;
/** Height of the record disc plane in model space — reused by the overlay. */
export const RECORD_Y = 0.0715;
/** Label radius — kept in sync with LABEL_OF_DISC in vinylTexture.ts. */
const LABEL_R = RECORD_R * LABEL_OF_DISC;

const GROOVE_NORMAL_SCALE = new THREE.Vector2(1.5, 1.5);
const CLEARCOAT_NORMAL_SCALE = new THREE.Vector2(0.6, 0.6);

/** Tangents along concentric grooves so anisotropy + normal maps light correctly. */
function makeGrooveGeometry(inner: number, outer: number) {
  const geo = new THREE.RingGeometry(inner, outer, 192, 2);
  geo.computeTangents();
  const pos = geo.attributes.position;
  const tangents = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const len = Math.hypot(x, y) || 1;
    // Groove direction (CCW) in the ring's XY plane.
    tangents[i * 4] = -y / len;
    tangents[i * 4 + 1] = x / len;
    tangents[i * 4 + 2] = 0;
    tangents[i * 4 + 3] = 1;
  }
  geo.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  return geo;
}

const spindleMaterial = new THREE.MeshPhysicalMaterial({
  color: "#dcd6cc",
  roughness: 0.16,
  metalness: 1,
  clearcoat: 0.45,
  clearcoatRoughness: 0.12,
});

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
/* Cartridge body + replaceable stylus assembly (the lighter front section). */
const cartridgeMaterial = new THREE.MeshStandardMaterial({
  color: "#1b1b21",
  roughness: 0.42,
  metalness: 0.28,
});
const stylusAssemblyMaterial = new THREE.MeshStandardMaterial({
  color: "#2d2d35",
  roughness: 0.5,
  metalness: 0.15,
});

/* --- Tonearm kinematics --------------------------------------------------- */

/** Pivot position on the plinth (rear-right), x/z in world space. */
export const ARM_PIVOT = new THREE.Vector2(1.26, -0.86);
/** Distance pivot → headshell mount along local −X. */
export const ARM_LEN = 1.46;
/**
 * Yaw search bound — high enough to sit past the parked position for every
 * layout (the parked yaw itself is solved from ARM_REST_R below).
 */
const ARM_YAW_MAX = 1.7;
/** Lead-in (outermost) and run-out (innermost) groove radii. */
const GROOVE_LEAD_IN_R = 0.86;
const GROOVE_RUN_OUT_R = 0.52;
/** Parked stylus radius — just clear of the platter rim (R = 0.98). */
const ARM_REST_R = 1.05;
/** Needle tip in headshell-local space — must match the stylus mesh below;
 * every kinematic solve (groove tracking, rest pose, offset angle) follows
 * this point. */
const STYLUS_IN_HEAD = { x: -0.099, z: 0 };

function headGroupX(armLen: number) {
  return -(armLen - 0.05);
}

/** Stylus x/z in the arm plane (after the headshell bend, before pivot yaw). */
function stylusInArmPlane(armLen: number, headYaw: number) {
  const c = Math.cos(headYaw);
  const s = Math.sin(headYaw);
  return {
    x: headGroupX(armLen) + STYLUS_IN_HEAD.x * c - STYLUS_IN_HEAD.z * s,
    z: STYLUS_IN_HEAD.x * s + STYLUS_IN_HEAD.z * c,
  };
}

function stylusWorldXZ(
  pivot: THREE.Vector2,
  armLen: number,
  yaw: number,
  headYaw: number
): { x: number; z: number } {
  const loc = stylusInArmPlane(armLen, headYaw);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: pivot.x + loc.x * c + loc.z * s,
    z: pivot.y - loc.x * s + loc.z * c,
  };
}

function stylusRadius(
  pivot: THREE.Vector2,
  armLen: number,
  yaw: number,
  headYaw: number
): number {
  const p = stylusWorldXZ(pivot, armLen, yaw, headYaw);
  return Math.hypot(p.x, p.z);
}

/** Yaw that puts the stylus on a given groove radius. The stylus orbit has
 * its closest approach to the disc center at yawMin = atan2(−pivot.y,
 * pivot.x); groove tracking lives on the branch above it (yawMin → yaw max),
 * where the radius increases monotonically with yaw: run-out (inner) sits
 * near yawMin, lead-in (outer) further up. */
function yawForRadius(
  pivot: THREE.Vector2,
  armLen: number,
  r: number,
  headYaw: number
): number {
  const yawMin = Math.atan2(-pivot.y, pivot.x);
  let lo = Math.min(yawMin + 1e-4, ARM_YAW_MAX - 1e-4);
  let hi = ARM_YAW_MAX;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (stylusRadius(pivot, armLen, mid, headYaw) < r) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Signed tracking error at a pose: the angle between the cartridge axis (the
 * headshell's −X, i.e. the direction the stylus reads) and the groove
 * tangent at the stylus. Zero = the stylus follows the groove direction
 * exactly, like a linear-tracking arm; a pivoted arm can only approximate it.
 */
function signedTrackingError(
  pivot: THREE.Vector2,
  armLen: number,
  yaw: number,
  headYaw: number
): number {
  const st = stylusWorldXZ(pivot, armLen, yaw, headYaw);
  const r = Math.hypot(st.x, st.z) || 1;
  // Cartridge axis after arm yaw + headshell bend (headshell local −X).
  const w = yaw + headYaw;
  const ax = -Math.cos(w);
  const az = Math.sin(w);
  // Groove tangent at the stylus = radius rotated 90°.
  const tx = -st.z / r;
  const tz = st.x / r;
  return Math.atan2(ax * tz - az * tx, ax * tx + az * tz);
}

/**
 * Headshell offset angle (the cartridge bend) for this arm geometry. A
 * pivoted arm sweeps an arc while the groove is a spiral, so the cartridge
 * can never be tangent everywhere — real arms bend the headshell so the
 * tracking error is minimised and sign-symmetric across the side (the
 * Baerwald/two-null idea). Here: solve numerically for the bend that makes
 * the error at the lead-in and run-out grooves equal and opposite, on the
 * exact geometry (bending the headshell also nudges the stylus sideways, so
 * an analytic angle would be ~1° off).
 */
function headYawFor(pivot: THREE.Vector2, armLen: number): number {
  const errSum = (headYaw: number) =>
    signedTrackingError(
      pivot,
      armLen,
      yawForRadius(pivot, armLen, GROOVE_LEAD_IN_R, headYaw),
      headYaw
    ) +
    signedTrackingError(
      pivot,
      armLen,
      yawForRadius(pivot, armLen, GROOVE_RUN_OUT_R, headYaw),
      headYaw
    );
  let phi = 0;
  let f0 = errSum(phi);
  for (let i = 0; i < 6 && Math.abs(f0) > 1e-5; i++) {
    const probe = 0.05;
    const slope = (errSum(phi + probe) - f0) / probe;
    if (Math.abs(slope) < 1e-9) break;
    phi -= f0 / slope;
    f0 = errSum(phi);
  }
  return phi;
}

export interface ArmPose {
  /** Lift (Z rotation): negative = tip raised, ~0 = needle on the groove. */
  rest: { yaw: number; lift: number };
  leadIn: { yaw: number; lift: number };
  runOut: { yaw: number; lift: number };
  /** Where the headshell parks — derived from the same geometry. */
  restPos: { x: number; z: number };
  /** Cartridge bend for this geometry (see headYawFor) — drives the mesh. */
  headYaw: number;
}

/** Solve groove yaws + rest pose for an arm of length `armLen` pivoting at
 * `pivot` (x/z). The pivot must sit far enough out that the stylus orbit
 * still crosses the lead-in/run-out grooves. Playback then interpolates the
 * groove RADIUS linearly (constant groove pitch at 33⅓ rpm) and re-solves
 * the yaw per frame — see TonearmArm. `headYaw` defaults to the tracking-
 * error-optimal bend for this geometry. */
export function armPoseFor(
  pivot: THREE.Vector2,
  armLen: number = ARM_LEN,
  headYaw: number = headYawFor(pivot, armLen)
): ArmPose {
  const restYaw = yawForRadius(pivot, armLen, ARM_REST_R, headYaw);
  const rest = stylusWorldXZ(pivot, armLen, restYaw, headYaw);
  return {
    rest: { yaw: restYaw, lift: -0.1 },
    leadIn: {
      yaw: yawForRadius(pivot, armLen, GROOVE_LEAD_IN_R, headYaw),
      lift: 0.005,
    },
    runOut: {
      yaw: yawForRadius(pivot, armLen, GROOVE_RUN_OUT_R, headYaw),
      lift: 0.005,
    },
    restPos: { x: rest.x, z: rest.z },
    headYaw,
  };
}

const ARM_POSE = armPoseFor(ARM_PIVOT);

/** Shared no-cover, no-title label — one texture for the app's lifetime. */
let defaultLabelTexture: THREE.CanvasTexture | null = null;
function getDefaultLabel(): THREE.CanvasTexture {
  if (!defaultLabelTexture) defaultLabelTexture = makeVinylLabelTexture();
  return defaultLabelTexture;
}

/**
 * Label texture for the current album: the cover art when it loads, else the
 * fallback target printed with the album (folder) name + artist.
 */
function useVinylLabel(
  coverPath: string | null | undefined,
  title?: string | null,
  artist?: string | null
) {
  const [map, setMap] = useState<THREE.CanvasTexture>(() => getDefaultLabel());

  useEffect(() => {
    let cancelled = false;
    const disposables: THREE.CanvasTexture[] = [];

    const applyFallback = () => {
      if (!title && !artist) {
        setMap(getDefaultLabel());
        return;
      }
      const tex = makeVinylLabelTexture(null, title, artist);
      if (cancelled) {
        tex.dispose();
        return;
      }
      disposables.push(tex);
      setMap(tex);
    };

    if (coverPath) {
      loadImage(toAssetUrl(coverPath))
        .then((img) => {
          if (cancelled) return;
          const tex = makeVinylLabelTexture(img);
          disposables.push(tex);
          setMap(tex);
        })
        .catch((err) => {
          console.warn("[vinyl] cover load failed", err);
          if (!cancelled) applyFallback();
        });
    } else {
      applyFallback();
    }
    return () => {
      cancelled = true;
      disposables.forEach((tex) => tex.dispose());
    };
  }, [coverPath, title, artist]);

  return map;
}

export function VinylDisc({
  playing,
  coverPath,
  title,
  artist,
}: {
  playing: boolean;
  coverPath: string | null | undefined;
  /** Album (folder) name printed on the label when there is no cover. */
  title?: string | null;
  artist?: string | null;
}) {
  const group = useRef<THREE.Group>(null);
  // Depend on the factory so HMR of vinylTexture.ts rebuilds the PBR pack.
  const grooves = useMemo(() => makeVinylGrooveMaps(), [makeVinylGrooveMaps]);
  const grooveGeo = useMemo(
    () => makeGrooveGeometry(LABEL_R - 0.001, RECORD_R),
    []
  );
  const labelMap = useVinylLabel(coverPath, title, artist);

  useFrame((_, dt) => {
    if (!group.current || !playing) return;
    // Clockwise when viewed from above (negative Y is CW in right-hand coords).
    group.current.rotation.y -= RAD_PER_SEC * dt;
  });

  return (
    <group ref={group} position={[0, RECORD_Y, 0]}>
      {/* Translucent PVC edge — pale rose-quartz, openEnded so it doesn't
          z-fight with the label/groove planes stacked just above it. */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[RECORD_R, RECORD_R, 0.013, 128, 1, true]} />
        <meshPhysicalMaterial
          color="#e8a0b0"
          roughness={0.22}
          metalness={0}
          transparent
          opacity={0.5}
          clearcoat={0.55}
          clearcoatRoughness={0.25}
          specularColor="#fff4f6"
        />
      </mesh>
      {/* Grooved face — milky translucent PVC with concentric groove sheen. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.0065, 0]}
        receiveShadow
        geometry={grooveGeo}
      >
        <meshPhysicalMaterial
          map={grooves.map}
          normalMap={grooves.normalMap}
          normalScale={GROOVE_NORMAL_SCALE}
          roughnessMap={grooves.roughnessMap}
          roughness={1}
          metalness={0}
          transparent
          opacity={0.64}
          depthWrite={false}
          clearcoat={0.85}
          clearcoatRoughness={0.12}
          clearcoatNormalMap={grooves.normalMap}
          clearcoatNormalScale={CLEARCOAT_NORMAL_SCALE}
          iridescence={0.32}
          iridescenceIOR={1.3}
          iridescenceThicknessRange={[100, 400]}
          sheen={0.18}
          sheenColor="#ffe8ee"
          sheenRoughness={0.4}
          specularIntensity={1.2}
          specularColor="#fffafb"
          anisotropy={0.92}
          anisotropyRotation={0}
          envMapIntensity={1.4}
        />
      </mesh>
      {/* Paper label — matte print, no vinyl sheen. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0072, 0]}>
        <circleGeometry args={[LABEL_R, 80]} />
        <meshStandardMaterial
          map={labelMap}
          roughness={0.7}
          metalness={0}
          envMapIntensity={0.22}
        />
      </mesh>
      {/* Chrome spindle */}
      <mesh position={[0, 0.02, 0]} material={spindleMaterial} castShadow>
        <cylinderGeometry args={[0.016, 0.017, 0.026, 24]} />
      </mesh>
      <mesh position={[0, 0.033, 0]} material={spindleMaterial}>
        <sphereGeometry args={[0.015, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
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

/**
 * Animated tonearm assembly (tube, counterweight, headshell, stylus) —
 * shared by the full 3D scene and the background-image overlay stage.
 * Pass a custom `pivot` (x/z) and `armLen` to re-locate / re-size the arm;
 * groove yaws are re-solved so the stylus still tracks the record.
 *
 * `constantScreenLength` is for stages whose camera never moves (the photo
 * overlay): a rigid arm pointing into the depth foreshortens differently as
 * it sweeps, so its projected length drifts ~15% across a side — on a flat
 * composite, with no depth cues, that reads as the arm stretching. The arm
 * group is therefore rescaled a few percent around its pivot each frame to
 * hold the on-screen pivot→stylus distance constant, and the groove yaw is
 * re-solved at the effective length so the stylus still lands exactly on the
 * lead-in / run-out grooves. Never enable it where the camera can orbit.
 */
export function TonearmArm({
  pivot = ARM_PIVOT,
  armLen = ARM_LEN,
  constantScreenLength = false,
}: {
  pivot?: THREE.Vector2;
  armLen?: number;
  constantScreenLength?: boolean;
} = {}) {
  const poses = useMemo(() => armPoseFor(pivot, armLen), [pivot, armLen]);
  const yawRef = useRef<THREE.Group>(null);
  const liftRef = useRef<THREE.Group>(null);
  const yaw = useRef(poses.rest.yaw);
  const lift = useRef(poses.rest.lift);

  // Constant-screen-length compensation state (fixed-camera stages only).
  const { camera, size } = useThree();
  const screenLenTarget = useRef(0);
  const screenSizeKey = useRef("");
  const tmpA = useRef(new THREE.Vector3());
  const tmpB = useRef(new THREE.Vector3());

  /** Projected pivot→stylus distance in pixels for a rigid arm at `yaw`. */
  const measureScreenLen = (parent: THREE.Object3D, yawAngle: number) => {
    const a = tmpA.current.set(pivot.x, 0, pivot.y).applyMatrix4(parent.matrixWorld);
    const s = stylusWorldXZ(pivot, armLen, yawAngle, poses.headYaw);
    const b = tmpB.current.set(s.x, 0, s.z).applyMatrix4(parent.matrixWorld);
    a.project(camera);
    b.project(camera);
    return Math.hypot(
      (a.x - b.x) * size.width,
      (a.y - b.y) * size.height
    );
  };

  useFrame((_, dt) => {
    if (!yawRef.current || !liftRef.current) return;

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

    // Compensate foreshortening first (using last frame's yaw), so the
    // effective length is known when solving this frame's groove yaw.
    const parent = yawRef.current.parent;
    let effScale = 1;
    if (constantScreenLength && parent) {
      parent.updateWorldMatrix(true, false);
      const sizeKey = `${size.width}x${size.height}`;
      if (sizeKey !== screenSizeKey.current) {
        screenSizeKey.current = sizeKey;
        // Hold the sweep's mean projected length: parked pose + five groove
        // samples, so the residual (second-order perspective) stays ~1%.
        screenLenTarget.current =
          (measureScreenLen(parent, poses.rest.yaw) +
            [0, 0.25, 0.5, 0.75, 1].reduce(
              (sum, t) =>
                sum +
                measureScreenLen(
                  parent,
                  THREE.MathUtils.lerp(
                    poses.leadIn.yaw,
                    poses.runOut.yaw,
                    t
                  )
                ),
              0
            )) /
          6;
      }
      const measured = measureScreenLen(parent, yaw.current);
      if (measured > 1e-6 && screenLenTarget.current > 1e-6) {
        effScale = THREE.MathUtils.clamp(
          screenLenTarget.current / measured,
          0.8,
          1.25
        );
        yawRef.current.scale.setScalar(effScale);
      }
    }

    // Radius-space target: the stylus spirals inward at a constant groove
    // pitch; yaw is solved from the radius (at the effective arm length, so
    // compensation never displaces the needle off the grooves).
    const grooveR = THREE.MathUtils.lerp(GROOVE_LEAD_IN_R, GROOVE_RUN_OUT_R, t);
    const targetYaw = onGroove
      ? yawForRadius(pivot, armLen * effScale, grooveR, poses.headYaw)
      : poses.rest.yaw;
    const targetLift = needleDown ? poses.leadIn.lift : poses.rest.lift;
    // Light smoothing — tracks the groove closely without visible stepping.
    const k = 1 - Math.exp(-10 * dt);
    yaw.current = THREE.MathUtils.lerp(yaw.current, targetYaw, k);
    lift.current = THREE.MathUtils.lerp(lift.current, targetLift, k);
    // Nested gimbal: yaw around world Y, then lift around the arm's local Z
    // so the tube length stays constant in the horizontal plane.
    yawRef.current.rotation.y = yaw.current;
    liftRef.current.rotation.z = lift.current;
  });

  return (
    <group ref={yawRef} position={[pivot.x, 0.132, pivot.y]}>
      <group ref={liftRef}>
      {/* Slim matte-black straight arm tube — runs all the way into the headshell. */}
      <mesh
        position={[-armLen / 2, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        material={armMaterial}
        castShadow
      >
        <cylinderGeometry args={[0.013, 0.013, armLen - 0.1, 16]} />
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
      {/* Headshell — short paddle bent by the geometry-derived offset angle
          (see headYawFor): like a real cartridge mount, it keeps a FIXED
          angle relative to the tube and rides with the arm, so the stylus
          reads the groove close to its tangent across the whole side. */}
      <group position={[headGroupX(armLen), 0, 0]} rotation={[0, poses.headYaw, 0]}>
        {/* Sleeve that overlaps the tube tip so the joint reads as one piece */}
        <mesh
          position={[0.022, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={armMaterial}
        >
          <cylinderGeometry args={[0.0145, 0.013, 0.048, 12]} />
        </mesh>
        {/* Headshell paddle — butts against the sleeve, carries the cartridge */}
        <RoundedBox
          args={[0.11, 0.012, 0.05]}
          radius={0.004}
          smoothness={2}
          position={[-0.032, 0.0005, 0]}
          material={armMaterial}
          castShadow
        />
        {/* Finger lift on the near side */}
        <mesh
          position={[0.006, 0.02, 0.018]}
          rotation={[0.55, 0, 0.15]}
          material={steelMaterial}
        >
          <cylinderGeometry args={[0.0024, 0.0024, 0.038, 8]} />
        </mesh>
        {/* Cartridge body — overlaps the paddle bottom (mounted flush, like a
            real cartridge bolted under the headshell) */}
        <RoundedBox
          args={[0.062, 0.028, 0.034]}
          radius={0.004}
          smoothness={2}
          position={[-0.058, -0.0185, 0]}
          material={cartridgeMaterial}
          castShadow
        />
        {/* Two mounting screws tying cartridge to paddle */}
        {[-0.04, -0.076].map((x) => (
          <mesh key={x} position={[x, -0.011, 0]} material={steelMaterial}>
            <cylinderGeometry args={[0.0032, 0.0032, 0.016, 8]} />
          </mesh>
        ))}
        {/* Replaceable stylus assembly — nose poking out of the body front */}
        <mesh
          position={[-0.088, -0.026, 0]}
          material={stylusAssemblyMaterial}
          castShadow
        >
          <boxGeometry args={[0.014, 0.012, 0.02]} />
        </mesh>
        {/* Cantilever: thin steel tube from the nose, angling down-forward */}
        <mesh
          position={[-0.0937, -0.0355, 0]}
          rotation={[0, 0, -2.51]}
          material={steelMaterial}
        >
          <boxGeometry args={[0.016, 0.0028, 0.0028]} />
        </mesh>
        {/* Needle — red tip at the cantilever end, just reaching the groove */}
        <mesh
          position={[-0.099, -0.042, 0]}
          rotation={[Math.PI, 0, -0.45]}
          material={stylusMaterial}
        >
          <coneGeometry args={[0.0032, 0.011, 8]} />
        </mesh>
      </group>
      </group>
    </group>
  );
}

/** Static pivot base, collar and adjustment rods the arm sits on. */
export function TonearmMount({ pivot = ARM_PIVOT }: { pivot?: THREE.Vector2 }) {
  return (
    <group>
      {/* Mount base + collar + gimbal (static, mechanical details around it) */}
      <mesh
        position={[pivot.x, 0.06, pivot.y]}
        material={armMaterial}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.085, 0.095, 0.07, 32]} />
      </mesh>
      <mesh position={[pivot.x, 0.1075, pivot.y]} material={armMaterial}>
        <cylinderGeometry args={[0.036, 0.036, 0.025, 24]} />
      </mesh>
      <mesh position={[pivot.x, 0.128, pivot.y]} material={armMaterial}>
        <cylinderGeometry args={[0.028, 0.028, 0.024, 20]} />
      </mesh>
      {/* Small steel rods — anti-skate / adjustment levers */}
      {(
        [
          [pivot.x - 0.09, pivot.y - 0.1],
          [pivot.x + 0.07, pivot.y - 0.11],
        ] as const
      ).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.0675, z]} material={steelMaterial} castShadow>
          <cylinderGeometry args={[0.006, 0.006, 0.085, 10]} />
        </mesh>
      ))}
    </group>
  );
}

function Tonearm() {
  return (
    <group>
      <TonearmMount />
      <TonearmArm />
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
      <group position={[ARM_POSE.restPos.x, 0, ARM_POSE.restPos.z]}>
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
      <VinylDisc
        playing={active}
        coverPath={coverPath}
        title={album?.name ?? null}
        artist={album?.artist ?? null}
      />
      <Tonearm />
    </group>
  );
}
