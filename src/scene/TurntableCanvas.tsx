import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Turntable } from "./Turntable";

/** Full-bleed 3D stage: soft light room, top-down vinyl view. */
export function TurntableCanvas() {
  return (
    <div className="turntable-canvas">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0.15, 5.03, 0.38], fov: 28, near: 0.1, far: 40 }}
        gl={{ antialias: true, toneMappingExposure: 1.08 }}
      >
        <color attach="background" args={["#f3eee6"]} />
        <fog attach="fog" args={["#f3eee6", 8, 18]} />

        {/* Local lights only — no remote HDR Environment (breaks under Tauri / offline). */}
        <ambientLight intensity={0.62} />
        <directionalLight
          castShadow
          position={[2.5, 6, 1.5]}
          intensity={1.55}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={20}
          shadow-camera-left={-4}
          shadow-camera-right={4}
          shadow-camera-top={4}
          shadow-camera-bottom={-4}
        />
        <directionalLight position={[-2.5, 2.8, -1.5]} intensity={0.45} color="#ffd8bc" />
        <pointLight position={[0.2, 1.4, 0.3]} intensity={0.4} color="#fff2e4" distance={6} />

        <Turntable />

        <ContactShadows
          position={[0, -0.038, 0]}
          opacity={0.4}
          scale={8}
          blur={2.6}
          far={4}
        />

        <OrbitControls
          makeDefault
          target={[0.15, 0.04, 0.08]}
          enablePan={false}
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2.5}
          minDistance={2.6}
          maxDistance={8}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  );
}
