"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useMemo, useRef } from "react";
import type { Capsule } from "@/lib/data";
import { useMemoryTexture } from "@/lib/memory-texture";

export const SPACING = 1.95;

function wrap(value: number, min: number, max: number) {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export interface CarouselState {
  position: number;
  target: number;
  holding: boolean;
  velocity: number;
  pointerX: number; // normalized -1..1
  pointerY: number;
  lastWheelAt: number; // for snap-after-wheel-settle
}

interface CanProps {
  capsule: Capsule | null;
  metallic: THREE.Texture;
  onMaterial: (mat: THREE.MeshPhysicalMaterial) => void;
}

function CanModel({ capsule, metallic, onMaterial }: CanProps) {
  const { scene } = useGLTF("/webgl/can.glb");
  const texture = useMemoryTexture(capsule);

  const cloned = useMemo(() => {
    const labelMaterial = !capsule
      ? new THREE.MeshPhysicalMaterial({
          // matte gray plastic look for placeholder cans
          color: new THREE.Color(0x9a9aa0),
          metalness: 0.3,
          roughness: 0.55,
          map: texture,
          envMapIntensity: 0.9,
        })
      : new THREE.MeshPhysicalMaterial({
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
    onMaterial(labelMaterial);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, texture, metallic]);

  return <primitive object={cloned} />;
}

interface CarouselProps {
  capsules: Capsule[];
  stateRef: React.MutableRefObject<CarouselState>;
  onIndexChange: (index: number) => void;
  onCanClick: (index: number) => void;
}

function Carousel({ capsules, stateRef, onIndexChange, onCanClick }: CarouselProps) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const matRefs = useRef<(THREE.MeshPhysicalMaterial | null)[]>([]);
  const lastIndex = useRef(-1);
  const smoothPointer = useRef({ x: 0, y: 0 });
  const { camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const pointerVec = useRef(new THREE.Vector2());

  const metallic = useLoader(THREE.TextureLoader, "/webgl/can-metallic.avif");

  // When there is no real project data, show a single empty placeholder can.
  // Otherwise render exactly the live capsules (so deletions/additions reflect immediately).
  const renderList = useMemo<Capsule[] | (Capsule | null)[]>(
    () => (capsules.length > 0 ? capsules : [null]),
    [capsules]
  );
  const TOTAL = renderList.length;
  const MIN_X = (TOTAL * -0.5) * SPACING;
  const MAX_X = (TOTAL * 0.5) * SPACING;

  const items = useMemo(
    () => renderList.map((capsule, i) => ({ capsule, i })),
    [renderList]
  );

  useEffect(() => {
    camera.position.set(0, 0.1, 12.8);
    camera.lookAt(0, 0, 0);
    (camera as THREE.PerspectiveCamera).fov = 30;
    camera.updateProjectionMatrix();
  }, [camera]);

  // Always track the latest render list length so the click handler never
  // reads a stale TOTAL from its closure after the data finishes loading.
  const renderListRef = useRef(renderList);
  useEffect(() => {
    renderListRef.current = renderList;
  }, [renderList]);

  useEffect(() => {
    const el = gl.domElement;
    const handleClick = (e: MouseEvent) => {
      const state = stateRef.current;
      if (Math.abs(state.target - state.position) > 0.05) return;
      const currentTotal = renderListRef.current.length;
      const rect = el.getBoundingClientRect();
      pointerVec.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerVec.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.current.setFromCamera(pointerVec.current, camera);

      const hits: { index: number; distance: number; x: number }[] = [];
      groupRefs.current.forEach((group, i) => {
        if (!group) return;
        const intersects = raycaster.current.intersectObject(group, true);
        if (intersects.length > 0) {
          hits.push({ index: i, distance: intersects[0].distance, x: group.position.x });
        }
      });
      if (hits.length === 0) return;
      hits.sort((a, b) => a.distance - b.distance);
      const hit = hits[0];
      const rounded = Math.round(hit.x / SPACING);
      if (rounded === 0) {
        onCanClick(hit.index % currentTotal);
      } else if (rounded < 0) {
        state.target += SPACING;
      } else {
        state.target -= SPACING;
      }
    };
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  useFrame((frameState, delta) => {
    const state = stateRef.current;
    const d = Math.min(delta, 0.05);
    const t = frameState.clock.elapsedTime;

    const sinceWheel = performance.now() - state.lastWheelAt;
    if (!state.holding) {
      // momentum glide
      state.target += state.velocity;
      state.velocity *= Math.pow(0.94, d * 60);
      if (Math.abs(state.velocity) < 0.004 && sinceWheel > 120) {
        state.velocity = 0;
        // settle into the nearest slot once input has stopped
        const snapped = Math.round(state.target / SPACING) * SPACING;
        state.target += (snapped - state.target) * (1 - Math.exp(-d * 8));
      }
    }
    // critically-damped-ish approach
    state.position += (state.target - state.position) * (1 - Math.exp(-d * 9));

    // pointer parallax smoothing
    smoothPointer.current.x += (state.pointerX - smoothPointer.current.x) * (1 - Math.exp(-d * 8));
    smoothPointer.current.y += (state.pointerY - smoothPointer.current.y) * (1 - Math.exp(-d * 8));
    const sp = smoothPointer.current;

    const len = renderList.length || 1;
    const rawIndex = Math.round(-state.position / SPACING);
    const index = ((rawIndex % len) + len) % len;
    if (index !== lastIndex.current) {
      lastIndex.current = index;
      onIndexChange(index);
    }

    groupRefs.current.forEach((group, i) => {
      if (!group) return;
      const x = wrap(i * SPACING + state.position, MIN_X, MAX_X) - (MIN_X + MAX_X) / 2;
      const centered = x / SPACING; // in can units
      const p = clamp(1 - Math.abs(centered), 0, 1); // 1 when centered

      const posY = Math.sin(centered * 0.5) * 0.2;
      const posZ = -Math.abs(centered) * 0.5 - 0.35;
      const rotY = centered * 0.5;
      // center can: nearly upright but keeps a slight top-left lean for dynamism
      const rotZ = (-centered * 0.09 + Math.PI / 9) * (1 - p * 0.62);
      const rotX = (0.14 - p * 0.22) * (1 - p * 0.55);
      const scale = 0.6 + p * 0.1;

      // gentle float only for the centered can (like the detail page)
      const floatY = Math.sin(t * 0.9) * 0.08 * p;
      const floatRotZ = Math.sin(t * 0.6) * 0.035 * p;
      const floatRotY = Math.sin(t * 0.5) * 0.05 * p;

      // pointer parallax — strongest on the center can
      const parY = sp.x * 0.35 * p;
      const parX = sp.y * 0.2 * p;

      group.position.set(x, posY + floatY, posZ);
      group.rotation.set(rotX + parX, rotY + floatRotY + parY, rotZ + floatRotZ);
      group.scale.setScalar(scale);

      // dim non-centered cans so the lit center pops (like the original)
      // empty placeholder cans stay a readable gray instead of going near-black
      const mat = matRefs.current[i];
      if (mat) {
        const isEmptySlot = !renderList[i % renderList.length];
        const dim = isEmptySlot ? 0.8 + 0.2 * p : 0.2 + 0.8 * p;
        mat.color.setScalar(dim);
        mat.envMapIntensity = (isEmptySlot ? 0.9 : 0.25) + (isEmptySlot ? 0.3 : 1.85) * p;
      }
    });
  });

  return (
    <group position={[0, -0.1, 0]}>
      {items.map(({ capsule, i }) => (
        <group key={i} ref={(el) => (groupRefs.current[i] = el)}>
          <CanModel
            capsule={capsule}
            metallic={metallic}
            onMaterial={(m) => (matRefs.current[i] = m)}
          />
        </group>
      ))}
    </group>
  );
}

function Lights() {
  const frontTarget = useRef<THREE.Object3D>(null);

  return (
    <>
      <ambientLight intensity={0.2} />
      <spotLight
        position={[-4, 5, 4]}
        angle={Math.PI / 5}
        penumbra={0.8}
        intensity={60}
        color="#ffffff"
      />
      <spotLight
        position={[4, 5, 4]}
        angle={Math.PI / 5}
        penumbra={0.8}
        intensity={60}
        color="#ffffff"
      />
      <spotLight position={[0, 6, 2]} angle={Math.PI / 6} penumbra={1} intensity={120} color="#ffffff" />
      {/* front key light on the active can */}
      <object3D ref={frontTarget} position={[0, 0, 0]} />
      <spotLight
        position={[0, 1.5, 6]}
        angle={Math.PI / 7}
        penumbra={0.6}
        intensity={90}
        color="#ffffff"
        target={frontTarget.current ?? undefined}
      />
    </>
  );
}

export default function CanCarouselScene({
  capsules,
  stateRef,
  onIndexChange,
  onCanClick,
}: CarouselProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, failIfMajorPerformanceCaveat: false, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
      camera={{ position: [0, 0.1, 12.8], fov: 30 }}
    >
      <Suspense fallback={null}>
        <Environment files="/webgl/hdri2.hdr" background={false} />
        <Lights />
        <Carousel capsules={capsules} stateRef={stateRef} onIndexChange={onIndexChange} onCanClick={onCanClick} />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload("/webgl/can.glb");
useGLTF.preload("/webgl/base.glb");
