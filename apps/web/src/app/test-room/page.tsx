"use client";

import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useState } from "react";

function RoomDebug() {
  const gltf = useGLTF(
    "/derived/orgs/8251166b-0d95-4ddb-99b0-632ae0898a0e/tours/63584f2a-2742-413f-b109-ef2f91303cf8/derived/7f53d72a-c71c-4263-902c-a03ea17b974a/navigation-proxy.glb",
  );
  const [info, setInfo] = useState("loading...");

  useEffect(() => {
    const names: string[] = [];
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) names.push(obj.name || "(unnamed)");
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const c = new THREE.Vector3();
    box.getCenter(c);
    setInfo(
      `${names.length} meshes: ${names.slice(0, 8).join(", ")}${names.length > 8 ? "..." : ""}\n` +
        `bbox: [${box.min.x.toFixed(1)}, ${box.min.y.toFixed(1)}, ${box.min.z.toFixed(1)}] → [${box.max.x.toFixed(1)}, ${box.max.y.toFixed(1)}, ${box.max.z.toFixed(1)}]\n` +
        `center: (${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)})`,
    );
  }, [gltf]);

  return (
    <>
      <primitive object={gltf.scene} />
      {/* Red cube at origin for reference */}
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[0.4, 0.4, 0.4]} />
        <meshBasicMaterial color="red" />
      </mesh>
      <Html center position={[0, 3.5, 0]}>
        <pre className="whitespace-pre-wrap rounded bg-black/85 p-3 text-[11px] leading-relaxed text-lime-400">
          {info}
        </pre>
      </Html>
    </>
  );
}

export default function TestRoomPage() {
  return (
    <div className="h-screen w-screen bg-[#111]">
      <Canvas camera={{ position: [2, 3, 8], fov: 65 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 10, 3]} intensity={1} />
        <RoomDebug />
        <OrbitControls target={[0, 1.4, 0]} />
        <gridHelper args={[20, 20, "#333", "#111"]} />
      </Canvas>
    </div>
  );
}
