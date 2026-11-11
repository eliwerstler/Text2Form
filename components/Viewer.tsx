"use client";

import { Bounds, Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";

// Z is up to match CAD conventions.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export default function Viewer({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const size = geometry?.boundingBox
    ? geometry.boundingBox.getSize(new THREE.Vector3()).length()
    : 100;
  const gridCell = size > 400 ? 50 : size > 80 ? 10 : 2;

  return (
    <Canvas camera={{ position: [160, -200, 140], fov: 40, near: 0.1, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={["#0f1115"]} />
      <hemisphereLight args={["#ffffff", "#334155", 1.1]} />
      <directionalLight position={[200, -300, 400]} intensity={1.6} />
      <directionalLight position={[-300, 200, 100]} intensity={0.5} />

      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        cellSize={gridCell}
        sectionSize={gridCell * 5}
        cellColor="#262b35"
        sectionColor="#3b4252"
        infiniteGrid
        fadeDistance={size * 8}
      />

      {geometry && (
        <Bounds key={geometry.uuid} fit clip observe margin={1.6}>
          <mesh geometry={geometry}>
            <meshStandardMaterial color="#e2a54a" metalness={0.15} roughness={0.45} side={THREE.DoubleSide} />
          </mesh>
        </Bounds>
      )}
      <OrbitControls makeDefault />
    </Canvas>
  );
}
