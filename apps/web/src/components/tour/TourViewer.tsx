"use client";

import type { TourManifest } from "@housetour/api-contract";
import { formatListPrice, sphericalToCartesian } from "@housetour/tour-engine";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useSearchParams } from "next/navigation";
import {
  Html,
  OrbitControls,
  useGLTF,
  useTexture,
} from "@react-three/drei";
import { createXRStore, XR } from "@react-three/xr";
import { SplatViewer } from "./SplatViewer";
import {
  type ComponentRef,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { Component, type ReactNode } from "react";

// Catches GLTF load failures (e.g. a derived mesh 404s in object storage) so a
// single broken room shows a friendly fallback instead of crashing the canvas.
class MeshErrorBoundary extends Component<{
  fallback: ReactNode;
  children: ReactNode;
}> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  componentDidCatch() {
    // swallow — the fallback UI communicates the issue
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const xrStore = createXRStore();

type Props = {
  manifest: TourManifest;
  mode?: "public" | "embed" | "studio";
  onSceneChange?: (sceneId: string) => void;
  className?: string;
};

function PanoramaSphere({
  url,
  opacity,
}: {
  url: string;
  opacity: number;
}) {
  const texture = useTexture(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;

  return (
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[500, 64, 40]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.BackSide}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function HotspotMarker({
  yaw,
  pitch,
  label,
  color,
  onClick,
}: {
  yaw: number;
  pitch: number;
  label?: string | null;
  color: string;
  onClick: () => void;
}) {
  const pos = sphericalToCartesian(yaw, pitch, 40);
  const [hovered, setHovered] = useState(false);

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={() => {
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[hovered ? 1.4 : 1.1, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.9 : 0.45}
          transparent
          opacity={0.95}
        />
      </mesh>
      <mesh>
        <ringGeometry args={[1.5, 2.1, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? 0.85 : 0.45}
          side={THREE.DoubleSide}
        />
      </mesh>
      {label ? (
        <Html center distanceFactor={40} style={{ pointerEvents: "none" }}>
          <div className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white whitespace-nowrap backdrop-blur">
            {label}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function SceneCamera({
  yaw,
  pitch,
}: {
  yaw: number;
  pitch: number;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0, 0.1);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 75;
      camera.updateProjectionMatrix();
    }
    const target = sphericalToCartesian(yaw, pitch, 10);
    camera.lookAt(target.x, target.y, target.z);
  }, [camera, yaw, pitch]);
  return null;
}

function CaptureLookControls({
  initialYaw = 0,
  initialPitch = 0,
}: {
  initialYaw?: number;
  initialPitch?: number;
}) {
  const { camera, gl } = useThree();
  const drag = useRef({ active: false, x: 0, y: 0 });
  const yaw = useRef(initialYaw);
  const pitch = useRef(initialPitch);

  useEffect(() => {
    const element = gl.domElement;
    camera.position.set(0, 1.55, 0);
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitch.current, yaw.current, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 58;
      camera.updateProjectionMatrix();
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      drag.current = { active: true, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag.current.active) return;
      const deltaX = event.clientX - drag.current.x;
      const deltaY = event.clientY - drag.current.y;
      drag.current.x = event.clientX;
      drag.current.y = event.clientY;
      yaw.current -= deltaX * 0.004;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - deltaY * 0.003,
        -Math.PI / 3,
        Math.PI / 3,
      );
      camera.rotation.set(pitch.current, yaw.current, 0);
    };
    const onPointerUp = (event: PointerEvent) => {
      drag.current.active = false;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
    };
  }, [camera, gl, initialPitch, initialYaw]);

  return null;
}

function MeshWalkRoom({
  url,
  initialYaw = 0,
  initialPitch = 0,
  walkEnabled = false,
  scene,
  onEnterDoorway,
}: {
  url: string;
  initialYaw?: number;
  initialPitch?: number;
  walkEnabled?: boolean;
  scene: NonNullable<ReturnType<typeof useManifestScene>>;
  onEnterDoorway?: (id: string) => void;
}) {
  const { scene: gltfScene } = useGLTF(url);
  const { camera } = useThree();
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { cloned, isCaptureGallery, colliders } = useMemo(() => {
    const next = gltfScene.clone(true);
    const colliders: THREE.Object3D[] = [];
    let hasCaptureFrames = false;

    next.traverse((object) => {
      if (object.name.startsWith("CaptureView")) {
        hasCaptureFrames = true;
        object.scale.set(1.08, 2.25, 1);
      }
    });

    if (hasCaptureFrames) {
      next.traverse((object) => {
        if (object.name === "NavigationProxy" || object.name === "SpaceHull") {
          object.visible = false;
        }
      });
    } else {
      // Reconstructed room: collect solid meshes as wall colliders.
      next.traverse((object) => {
        if ((object as THREE.Mesh).isMesh && object.name !== "Floor") {
          colliders.push(object);
        }
      });
    }

    return { cloned: next, isCaptureGallery: hasCaptureFrames, colliders };
  }, [gltfScene]);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (isCaptureGallery) {
      camera.position.set(0, 1.55, 0);
      camera.rotation.order = "YXZ";
      camera.rotation.set(initialPitch, initialYaw, 0);
    } else {
      camera.position.set(5.5, 3.2, 5.5);
      controls?.target.set(0, 0.4, 0);
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = isCaptureGallery ? 58 : 75;
      camera.updateProjectionMatrix();
    }
    controls?.update();
  }, [camera, initialPitch, initialYaw, isCaptureGallery]);

  return (
    <>
      <primitive
        object={cloned}
        position={isCaptureGallery ? [0, 0, 0] : [0, -1.4, 0]}
        rotation={isCaptureGallery ? [0, 0, 0] : [0, Math.PI / 8, 0]}
      />
      {isCaptureGallery ? (
        <CaptureLookControls initialYaw={initialYaw} initialPitch={initialPitch} />
      ) : walkEnabled ? (
        <MeshWalkController
          enabled
          colliders={colliders}
          scene={scene}
          onEnterDoorway={(id) => onEnterDoorway?.(id)}
        />
      ) : (
        <OrbitControls
          ref={controlsRef}
          enableZoom
          enablePan
          minDistance={2}
          maxDistance={30}
          target={[0, 0.4, 0]}
          dampingFactor={0.08}
          enableDamping
        />
      )}
    </>
  );
}

function CameraTracker({ onYaw }: { onYaw: (yaw: number) => void }) {
  useFrame(({ camera }) => {
    // camera.rotation.order is 'YXZ' by default in R3F
    onYaw(camera.rotation.y);
  });
  return null;
}

// Tracks held movement keys for continuous first-person walking.
function useWalkKeys() {
  const keys = useRef({ forward: false, back: false, left: false, right: false });
  useEffect(() => {
    const set = (code: string, down: boolean) => {
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          keys.current.forward = down;
          break;
        case "KeyS":
        case "ArrowDown":
          keys.current.back = down;
          break;
        case "KeyA":
        case "ArrowLeft":
          keys.current.left = down;
          break;
        case "KeyD":
        case "ArrowRight":
          keys.current.right = down;
          break;
      }
    };
    const down = (e: KeyboardEvent) => {
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      ) {
        e.preventDefault();
        set(e.code, true);
      }
    };
    const up = (e: KeyboardEvent) => set(e.code, false);
    const blur = () => {
      keys.current.forward = keys.current.back = keys.current.left = keys.current.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return keys;
}

// Continuous first-person walk for panorama mode.
// WASD translates the camera through the equirect space; walking toward a
// doorway hotspot smoothly transitions to the next room (no teleport jump).
function WalkController({
  enabled,
  speed = 6,
  scene,
  onEnterDoorway,
}: {
  enabled: boolean;
  speed?: number;
  scene: NonNullable<ReturnType<typeof useManifestScene>>;
  onEnterDoorway: (sceneId: string) => void;
}) {
  const { camera } = useThree();
  const keys = useWalkKeys();
  const fadeCooldown = useRef(0);

  useFrame((_, delta) => {
    if (!enabled) return;
    const k = keys.current;
    const moving = k.forward || k.back || k.left || k.right;
    if (!moving) return;

    const yaw = camera.rotation.y;
    let dx = 0;
    let dz = 0;
    if (k.forward) {
      dx += -Math.sin(yaw);
      dz += -Math.cos(yaw);
    }
    if (k.back) {
      dx += Math.sin(yaw);
      dz += Math.cos(yaw);
    }
    if (k.right) {
      dx += Math.cos(yaw);
      dz += -Math.sin(yaw);
    }
    if (k.left) {
      dx += -Math.cos(yaw);
      dz += Math.sin(yaw);
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    const step = speed * delta;
    camera.position.x += dx * step;
    camera.position.z += dz * step;
    camera.position.y = 0;

    const radius = Math.hypot(camera.position.x, camera.position.z);
    fadeCooldown.current = Math.max(0, fadeCooldown.current - delta);
    if (radius > 18 && fadeCooldown.current === 0 && scene.hotspots?.length) {
      let best: (typeof scene.hotspots)[number] | null = null;
      let bestDist = Infinity;
      for (const h of scene.hotspots) {
        const norm = ((h.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const view = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let diff = Math.abs(norm - view);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < bestDist) {
          bestDist = diff;
          best = h;
        }
      }
      if (best && bestDist < Math.PI / 4) {
        fadeCooldown.current = 1.5;
        onEnterDoorway(best.targetSceneId);
      }
    }
  });

  return null;
}

// Continuous first-person walk for reconstructed mesh rooms with wall collision.
function MeshWalkController({
  enabled,
  speed = 2.4,
  colliders,
  scene,
  onEnterDoorway,
}: {
  enabled: boolean;
  speed?: number;
  colliders: THREE.Object3D[];
  scene: NonNullable<ReturnType<typeof useManifestScene>>;
  onEnterDoorway: (sceneId: string) => void;
}) {
  const { camera } = useThree();
  const keys = useWalkKeys();
  const fadeCooldown = useRef(0);
  const raycaster = useRef(new THREE.Raycaster());

  useFrame((_, delta) => {
    if (!enabled) return;
    const k = keys.current;
    const moving = k.forward || k.back || k.left || k.right;
    if (!moving) return;

    const yaw = camera.rotation.y;
    let dx = 0;
    let dz = 0;
    if (k.forward) {
      dx += -Math.sin(yaw);
      dz += -Math.cos(yaw);
    }
    if (k.back) {
      dx += Math.sin(yaw);
      dz += Math.cos(yaw);
    }
    if (k.right) {
      dx += Math.cos(yaw);
      dz += -Math.sin(yaw);
    }
    if (k.left) {
      dx += -Math.cos(yaw);
      dz += Math.sin(yaw);
    }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;

    const step = speed * delta;
    const next = new THREE.Vector3(
      camera.position.x + dx * step,
      camera.position.y,
      camera.position.z + dz * step,
    );

    const tryAxis = (axis: "x" | "z", value: number) => {
      const probe = new THREE.Vector3(
        axis === "x" ? value : camera.position.x,
        camera.position.y,
        axis === "z" ? value : camera.position.z,
      );
      raycaster.current.set(probe, new THREE.Vector3(0, 0, 1));
      raycaster.current.far = 0.6;
      const hit = colliders.some((c) => raycaster.current.intersectObject(c, true));
      if (!hit) camera.position[axis] = value;
    };
    tryAxis("x", next.x);
    tryAxis("z", next.z);

    fadeCooldown.current = Math.max(0, fadeCooldown.current - delta);
    if (fadeCooldown.current === 0 && scene.hotspots?.length) {
      let best: (typeof scene.hotspots)[number] | null = null;
      let bestDist = Infinity;
      for (const h of scene.hotspots) {
        const target = sphericalToCartesian(h.yaw, h.pitch ?? 0, 4.5);
        const d = Math.hypot(
          camera.position.x - target.x,
          camera.position.z - target.z,
        );
        if (d < bestDist) {
          bestDist = d;
          best = h;
        }
      }
      if (best && bestDist < 1.4) {
        fadeCooldown.current = 1.5;
        onEnterDoorway(best.targetSceneId);
      }
    }
  });

  return null;
}

function useManifestScene(manifest: TourManifest, sceneId: string) {
  return manifest.scenes.find((s) => s.id === sceneId);
}

function TourScene({
  manifest,
  sceneId,
  onNavigate,
  primaryColor,
  onCameraYaw,
  onEnterDoorway,
}: {
  manifest: TourManifest;
  sceneId: string;
  onNavigate: (id: string) => void;
  primaryColor: string;
  onCameraYaw?: (yaw: number) => void;
  onEnterDoorway: (id: string) => void;
}) {
  const scene = manifest.scenes.find((s) => s.id === sceneId);
  if (!scene || !scene.mediaUrl) {
    return (
      <Html center>
        <div className="rounded-lg bg-black/70 px-4 py-2 text-sm text-white">
          Scene media missing
        </div>
      </Html>
    );
  }

  const isMesh =
    scene.kind === "mesh" ||
    scene.mediaUrl.toLowerCase().endsWith(".glb") ||
    scene.mediaUrl.toLowerCase().includes(".glb");

  const isSplat =
    scene.kind === "splat" ||
    scene.mediaUrl.toLowerCase().endsWith(".ply") ||
    scene.mediaUrl.toLowerCase().includes("gaussian-splat");

  if (isSplat) {
    return (
      <SplatViewer
        url={scene.mediaUrl}
        initialYaw={scene.initialYaw ?? 0}
        initialPitch={scene.initialPitch ?? 0}
      />
    );
  }

  return (
    <>
      <ambientLight intensity={isMesh ? 0.85 : 0.6} />
      <CameraTracker onYaw={onCameraYaw ?? (() => {})} />
      {isMesh ? (
        <>
          <directionalLight position={[6, 10, 4]} intensity={1.1} />
          <directionalLight position={[-4, 6, -2]} intensity={0.35} />
          <MeshErrorBoundary
            fallback={
              <Html center>
                <div className="max-w-[16rem] rounded-lg bg-black/70 px-4 py-3 text-center text-sm text-white">
                  This 3D room could not be loaded.
                  <span className="mt-1 block text-[11px] text-white/50">
                    Its model is missing from storage.
                  </span>
                </div>
              </Html>
            }
          >
            <Suspense
              fallback={
                <Html center>
                  <div className="rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">
                    Loading mesh…
                  </div>
                </Html>
              }
            >
              <MeshWalkRoom
                url={scene.mediaUrl}
                initialYaw={scene.initialYaw ?? 0}
                initialPitch={scene.initialPitch ?? 0}
                walkEnabled
                scene={scene}
                onEnterDoorway={onEnterDoorway}
              />
            </Suspense>
          </MeshErrorBoundary>
          {/* Billboard hotspots around the room for mesh ↔ pano jumps */}
          {scene.hotspots.map((h) => {
            const pos = sphericalToCartesian(h.yaw, h.pitch ?? 0, 4.5);
            return (
              <group
                key={h.id}
                position={[pos.x, pos.y + 0.6, pos.z]}
              >
                <mesh
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(h.targetSceneId);
                  }}
                  onPointerOver={() => {
                    document.body.style.cursor = "pointer";
                  }}
                  onPointerOut={() => {
                    document.body.style.cursor = "default";
                  }}
                >
                  <sphereGeometry args={[0.22, 20, 20]} />
                  <meshStandardMaterial
                    color={primaryColor}
                    emissive={primaryColor}
                    emissiveIntensity={0.55}
                  />
                </mesh>
                {h.label ? (
                  <Html center distanceFactor={8} style={{ pointerEvents: "none" }}>
                    <div className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white whitespace-nowrap">
                      {h.label}
                    </div>
                  </Html>
                ) : null}
              </group>
            );
          })}
        </>
      ) : (
        <>
          <SceneCamera
            yaw={scene.initialYaw ?? 0}
            pitch={scene.initialPitch ?? 0}
          />
          <Suspense fallback={null}>
            <PanoramaSphere url={scene.mediaUrl} opacity={1} />
          </Suspense>
          {scene.hotspots.map((h) => (
            <HotspotMarker
              key={h.id}
              yaw={h.yaw}
              pitch={h.pitch}
              label={h.label}
              color={primaryColor}
              onClick={() => onNavigate(h.targetSceneId)}
            />
          ))}
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            rotateSpeed={-0.35}
            dampingFactor={0.08}
            enableDamping
          />
          <WalkController
            enabled
            scene={scene}
            onEnterDoorway={onEnterDoorway}
          />
        </>
      )}
    </>
  );
}

export function TourViewer({
  manifest,
  mode = "public",
  onSceneChange,
  className,
}: Props) {
  const searchParams = useSearchParams();
  const sceneFromQuery = searchParams.get("scene");
  const resolvedStartId = sceneFromQuery
    ? (manifest.scenes.find((s) => s.id === sceneFromQuery)?.id ?? null)
    : null;
  const startId = resolvedStartId || manifest.startSceneId || manifest.scenes[0]?.id;
  const [sceneId, setSceneId] = useState(startId);
  const [vrSupported, setVrSupported] = useState(false);
  const [infoOpen, setInfoOpen] = useState(mode === "public");
  const [walkTarget, setWalkTarget] = useState<{ x: number; y: number } | null>(null);
  const cameraYawRef = useRef(0);
  const primary = manifest.branding?.primaryColor || "#C4A35A";

  const scene = useMemo(
    () => manifest.scenes.find((s) => s.id === sceneId),
    [manifest.scenes, sceneId],
  );

  const navigate = useCallback(
    (nextId: string) => {
      if (nextId === sceneId) return;
      setSceneId(nextId);
    },
    [sceneId],
  );

  const sceneMap = useMemo(() => {
    const m = new Map<string, (typeof manifest.scenes)[number]>();
    for (const s of manifest.scenes) m.set(s.id, s);
    return m;
  }, [manifest]);

  // Find the hotspot closest to a given yaw angle
  const findHotspotAtAngle = useCallback(
    (targetYaw: number): { sceneId: string; label?: string | null } | null => {
      if (!scene) return null;
      const hotspots = scene.hotspots;
      if (hotspots.length === 0) return null;
      // Normalize target to [0, 2π)
      const norm = ((targetYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let best: (typeof hotspots)[number] | null = null;
      let bestDist = Infinity;
      for (const h of hotspots) {
        const hNorm = ((h.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let diff = Math.abs(hNorm - norm);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < bestDist) {
          bestDist = diff;
          best = h;
        }
      }
      // Only navigate if hotspot is within ~60° of target
      if (best && bestDist < Math.PI / 3) {
        return { sceneId: best.targetSceneId, label: best.label };
      }
      return null;
    },
    [scene],
  );

  // Camera yaw tracker — runs inside Canvas via TourScene
  const setCameraYaw = useCallback((yaw: number) => {
    cameraYawRef.current = yaw;
  }, []);

  // Floor click handler: click a doorway/floor area to walk into the nearest room.
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!scene) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      // Only respond to clicks on the lower 40% (floor area)
      if (y < 0.6) return;

      // Show walk indicator
      setWalkTarget({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setTimeout(() => setWalkTarget(null), 600);

      // Map x position to yaw angle (0 = left edge = -π, 1 = right edge = +π)
      // In equirectangular: x=0 is -π, x=0.5 is 0 (center/forward), x=1 is +π
      const clickYaw = (x - 0.5) * Math.PI * 2;
      const target = findHotspotAtAngle(clickYaw);
      if (target) navigate(target.sceneId);
    },
    [scene, findHotspotAtAngle, navigate],
  );

  useEffect(() => {
    if (typeof navigator !== "undefined" && "xr" in navigator) {
      const xr = (
        navigator as Navigator & {
          xr?: { isSessionSupported?: (m: string) => Promise<boolean> };
        }
      ).xr;
      xr?.isSessionSupported?.("immersive-vr").then((ok: boolean) => {
        setVrSupported(Boolean(ok));
      });
    }
  }, []);

  useEffect(() => {
    if (sceneId) onSceneChange?.(sceneId);
  }, [sceneId, onSceneChange]);

  const price = formatListPrice(manifest.property?.listPrice);
  const floor = manifest.floors[0];
  const hasSceneNavigation = manifest.scenes.length > 1;
  const isRoomPreview = mode === "studio" && !hasSceneNavigation;

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-ink-950 ${className ?? ""}`}
      onClick={handleCanvasClick}
    >
      <div className="absolute inset-0">
        <Canvas
          camera={{
            position:
              scene?.kind === "mesh"
                ? scene.mediaUrl.includes("navigation-proxy")
                  ? [0, 1.55, 0.12]
                  : [5.5, 3.2, 5.5]
                : [0, 0, 0.1],
            fov:
              scene?.kind === "mesh" &&
              scene.mediaUrl.includes("navigation-proxy")
                ? 58
                : 75,
            near: 0.1,
            far: 1000,
          }}
          gl={{ antialias: true, alpha: false }}
          dpr={[1, 2]}
        >
          <XR store={xrStore}>
            <color attach="background" args={["#0B0C0E"]} />
            {sceneId ? (
              <TourScene
                manifest={manifest}
                sceneId={sceneId}
                onNavigate={navigate}
                primaryColor={primary}
                onCameraYaw={setCameraYaw}
                onEnterDoorway={navigate}
              />
            ) : null}
          </XR>
        </Canvas>
      </div>

      {/* Walk indicator — ripple at click position */}
      {walkTarget ? (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: walkTarget.x, top: walkTarget.y }}
        >
          <div className="absolute -translate-x-1/2 -translate-y-1/2">
            <div className="h-3 w-3 animate-ping rounded-full bg-gold-500/60" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-300" />
          </div>
        </div>
      ) : null}

      {/* Top bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 md:p-6 ${isRoomPreview ? "pr-20 md:pr-32" : ""}`}
      >
        <div className="pointer-events-auto min-w-0 max-w-full rounded-lg border border-white/10 bg-black/45 px-4 py-3 backdrop-blur-md">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold-300">
            {manifest.branding?.orgName ?? "HouseTour"}
          </p>
          <h1 className="font-display text-lg text-white md:text-xl">
            {isRoomPreview ? scene?.name : manifest.title}
          </h1>
          {scene ? (
            <p className="text-xs text-white/70">
              {isRoomPreview
                ? `Room scan in ${manifest.property?.title ?? manifest.title}`
                : scene.name}
            </p>
          ) : null}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {manifest.flags.allowVr && vrSupported ? (
            <button
              type="button"
              onClick={() => xrStore.enterVR()}
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur hover:bg-white/20"
            >
              Enter VR
            </button>
          ) : null}
          {mode === "public" ? (
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              className="rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white/90 backdrop-blur"
            >
              {infoOpen ? "Hide info" : "Property info"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Room rail */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 md:p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          {infoOpen && mode !== "embed" ? (
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur-md md:flex md:items-center md:justify-between">
              <div>
                <p className="font-display text-base text-white">
                  {manifest.property?.title ?? manifest.title}
                </p>
                <p className="text-sm text-white/65">
                  {[
                    manifest.property?.addressLine1,
                    manifest.property?.city,
                    manifest.property?.region,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p className="mt-1 text-xs text-white/55">
                  {[
                    manifest.property?.bedrooms != null
                      ? `${manifest.property.bedrooms} bed`
                      : null,
                    manifest.property?.bathrooms
                      ? `${manifest.property.bathrooms} bath`
                      : null,
                    manifest.property?.sqft
                      ? `${manifest.property.sqft.toLocaleString()} sqft`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-3 md:mt-0">
                {price ? (
                  <span className="font-display text-2xl text-gold-300">{price}</span>
                ) : null}
                {manifest.branding?.ctaUrl && manifest.branding?.ctaLabel ? (
                  <a
                    href={manifest.branding.ctaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-950"
                    style={{ backgroundColor: primary }}
                  >
                    {manifest.branding.ctaLabel}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex items-end gap-3">
            {hasSceneNavigation && manifest.flags.showFloorPlan && floor?.planUrl ? (
              <div className="hidden h-36 w-44 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/50 p-2 backdrop-blur md:block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={floor.planUrl}
                  alt={floor.name}
                  className="h-full w-full object-contain opacity-90"
                />
                <div className="relative -mt-full h-full w-full">
                  {manifest.scenes.map((s) =>
                    s.position ? (
                      <button
                        key={s.id}
                        type="button"
                        title={s.name}
                        onClick={() => navigate(s.id)}
                        className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40"
                        style={{
                          left: `${s.position.x * 100}%`,
                          top: `${s.position.z * 100}%`,
                          backgroundColor:
                            s.id === sceneId ? primary : "rgba(255,255,255,0.7)",
                          boxShadow:
                            s.id === sceneId
                              ? `0 0 0 3px ${primary}55`
                              : undefined,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            ) : null}

            {hasSceneNavigation ? (
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                {manifest.scenes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => navigate(s.id)}
                    className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs transition ${
                      s.id === sceneId
                        ? "border-gold-500/60 bg-gold-500/20 text-white"
                        : "border-white/10 bg-black/45 text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <span className="block font-medium">{s.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-white/45">
                      {s.kind}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <p className="text-center text-[10px] uppercase tracking-[0.18em] text-white/40">
            {scene?.kind === "mesh"
              ? scene.mediaUrl.includes("navigation-proxy")
                ? "Drag to look around the captured room"
                : "Orbit mesh - scroll zoom - click markers to change rooms"
              : "Free-walk: hold W/A/S/D or arrows to move · Drag to look · Walk into a doorway to enter the next room · Click markers to jump"}
          </p>
        </div>
      </div>
    </div>
  );
}
