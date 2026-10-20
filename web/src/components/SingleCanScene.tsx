"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useMemo, useRef } from "react";
import { useMemoryTexture } from "@/lib/memory-texture";
import type { Capsule } from "@/lib/data";

function CanModel({ capsule }: { capsule: Capsule }) {
  const { scene } = useGLTF("/webgl/can.glb");
  const metallic = useLoader(THREE.TextureLoader, "/webgl/can-metallic.avif");
  const texture = useMemoryTexture(capsule);
  const groupRef = useRef<THREE.Group>(null);

  const cloned = useMemo(() => {
    const labelMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xcccccc),
      metalness: 0.9,
      roughness: 0.2,
      sheen: 0.05,
      sheenRoughness: 0.125,
      sheenColor: new THREE.Color(0xffffff),
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
      reflectivity: 1,
      ior: 2,
      map: texture,
      metalnessMap: metallic,
      envMapIntensity: 1.6,
    });

    const metalMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x555555),
      metalness: 0.9,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      reflectivity: 1,
      ior: 2,
      metalnessMap: metallic,
      envMapIntensity: 3,
    });

    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.material = mesh.name === "Shell" ? labelMaterial : metalMaterial;
      }
    });
    return clone;
  }, [scene, texture, metallic]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    // gentle sway around the front view
    groupRef.current.rotation.y = Math.sin(t * 0.4) * 0.55;
    groupRef.current.rotation.z = Math.PI / 9 + Math.sin(t * 0.6) * 0.03;
    groupRef.current.position.y = Math.sin(t * 0.8) * 0.1;
  });

  return (
    <group ref={groupRef} scale={0.8}>
      <primitive object={cloned} />
    </group>
  );
}

export default function SingleCanScene({ capsule }: { capsule: Capsule }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
      camera={{ position: [0, 0, 7.2], fov: 28 }}
    >
      <Suspense fallback={null}>
        <Environment files="/webgl/hdri2.hdr" background={false} />
        <ambientLight intensity={0.2} />
        <spotLight position={[-4, 5, 4]} angle={Math.PI / 5} penumbra={0.8} intensity={60} />
        <spotLight position={[4, 5, 4]} angle={Math.PI / 5} penumbra={0.8} intensity={60} />
        <spotLight position={[0, 6, 2]} angle={Math.PI / 6} penumbra={1} intensity={120} />
        <spotLight position={[0, 1.5, 6]} angle={Math.PI / 7} penumbra={0.6} intensity={90} />
        <CanModel capsule={capsule} />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload("/webgl/can.glb");
