import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Turntable } from "./Turntable";

/** Full-bleed 3D stage: dark warm room, cinematic key light, high 3/4 view. */
export function TurntableCanvas() {
  return (
    <div className="turntable-canvas">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [2.4, 3.0, 3.0], fov: 30, near: 0.1, far: 40 }}
        gl={{ antialias: true, toneMappingExposure: 1.15 }}
      >
        <color attach="background" args={["#151009"]} />
        <fog attach="fog" args={["#151009", 9, 22]} />

        {/* Local lights only — no remote HDR Environment (breaks under Tauri / offline). */}
        <ambientLight intensity={0.5} color="#8a7a6c" />
        <directionalLight
          castShadow
          position={[3.2, 5, 2.6]}
          intensity={1.4}
          color="#ffd9b8"
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={20}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
        />
        <directionalLight position={[-3, 2.4, -1.2]} intensity={0.35} color="#a9b6cc" />
        <pointLight position={[1.6, 1.2, 2.2]} intensity={0.25} color="#ffe3c4" distance={8} />

        <Turntable />

        <ContactShadows
          position={[0, -0.108, 0]}
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
