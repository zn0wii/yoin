import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Turntable } from "./Turntable";

/** Blurred warm orbs far behind the deck — out-of-focus room bokeh. */
function BackdropBokeh() {
  const orbs: [number[], number, string][] = [
    [[-2.8, 1.7, -4.6], 0.9, "#b06a35"],
    [[0.5, 2.2, -5.6], 1.4, "#8a4f2c"],
    [[2.7, 1.0, -3.9], 0.7, "#c98a4b"],
    [[-0.9, 2.9, -6.2], 1.6, "#6e4022"],
    [[1.6, 2.4, -5.0], 1.0, "#a05e30"],
  ];
  return (
    <group>
      {orbs.map(([p, r, c], i) => (
        <mesh key={i} position={p as [number, number, number]}>
          <sphereGeometry args={[r, 24, 24]} />
          <meshBasicMaterial color={c} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Full-bleed 3D stage: dark warm room, low warm key light (long shadows),
 * soft cool fill, high 3/4 view. */
export function TurntableCanvas() {
  return (
    <div className="turntable-canvas">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [2.3, 2.7, 2.9], fov: 30, near: 0.1, far: 40 }}
        gl={{ antialias: true, toneMappingExposure: 1.12 }}
      >
        <color attach="background" args={["#171009"]} />
        <fog attach="fog" args={["#171009", 6, 15]} />

        {/* Local lights only — no remote HDR Environment (breaks under Tauri / offline). */}
        <ambientLight intensity={0.5} color="#918a82" />
        <directionalLight
          castShadow
          position={[3.4, 2.6, 1.2]}
          intensity={1.6}
          color="#fff1dc"
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={20}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
        />
        <directionalLight position={[-3, 1.8, -1]} intensity={0.32} color="#8fa0b8" />
        <pointLight position={[1.8, 1.4, 2.4]} intensity={0.15} color="#ffe3c4" distance={9} />

        <Turntable />
        <BackdropBokeh />

        <ContactShadows
          position={[0, -0.052, 0]}
          opacity={0.55}
          scale={9}
          blur={2.4}
          far={3}
        />

        <OrbitControls
          makeDefault
          target={[0.05, 0.02, 0]}
          enablePan={false}
          minPolarAngle={0.05}
          maxPolarAngle={Math.PI / 2 - 0.04}
          minDistance={2.2}
          maxDistance={6.5}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
}
