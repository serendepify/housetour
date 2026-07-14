"use client";

import type { TourManifest } from "@housetour/api-contract";
import { formatListPrice, sphericalToCartesian } from "@housetour/tour-engine";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Html,
  OrbitControls,
  useGLTF,
  useTexture,
} from "@react-three/drei";
import { createXRStore, XR } from "@react-three/xr";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

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
    const target = sphericalToCartesian(yaw, pitch, 10);
    camera.lookAt(target.x, target.y, target.z);
  }, [camera, yaw, pitch]);
  return null;
}

function FadeController({
  fading,
  onDone,
}: {
  fading: boolean;
  onDone: () => void;
}) {
  const t = useRef(0);
  useFrame((_, delta) => {
    if (!fading) {
      t.current = 0;
      return;
    }
    t.current += delta;
    if (t.current > 0.35) onDone();
  });
  return null;
}

function MeshWalkRoom({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return (
    <primitive
      object={cloned}
      position={[0, -1.4, 0]}
      scale={1}
      rotation={[0, Math.PI / 8, 0]}
    />
  );
}

function TourScene({
  manifest,
  sceneId,
  onNavigate,
  primaryColor,
}: {
  manifest: TourManifest;
  sceneId: string;
  onNavigate: (id: string) => void;
  primaryColor: string;
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

  return (
    <>
      <ambientLight intensity={isMesh ? 0.85 : 0.6} />
      {isMesh ? (
        <>
          <directionalLight position={[6, 10, 4]} intensity={1.1} />
          <directionalLight position={[-4, 6, -2]} intensity={0.35} />
          <Suspense
            fallback={
              <Html center>
                <div className="rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">
                  Loading mesh…
                </div>
              </Html>
            }
          >
            <MeshWalkRoom url={scene.mediaUrl} />
          </Suspense>
          {/* Billboard hotspots around the room for mesh ↔ pano jumps */}
          {scene.hotspots.map((h, i) => {
            const angle = (i / Math.max(scene.hotspots.length, 1)) * Math.PI * 2;
            return (
              <group
                key={h.id}
                position={[Math.sin(angle) * 4.5, 0.6, Math.cos(angle) * 4.5]}
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
          <OrbitControls
            enableZoom
            enablePan
            minDistance={2}
            maxDistance={18}
            target={[0, 0.4, 0]}
            dampingFactor={0.08}
            enableDamping
          />
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
  const startId = manifest.startSceneId || manifest.scenes[0]?.id;
  const [sceneId, setSceneId] = useState(startId);
  const [fading, setFading] = useState(false);
  const [pendingScene, setPendingScene] = useState<string | null>(null);
  const [vrSupported, setVrSupported] = useState(false);
  const [infoOpen, setInfoOpen] = useState(mode !== "embed");
  const primary = manifest.branding?.primaryColor || "#C4A35A";

  const scene = useMemo(
    () => manifest.scenes.find((s) => s.id === sceneId),
    [manifest.scenes, sceneId],
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

  const navigate = useCallback(
    (nextId: string) => {
      if (nextId === sceneId || fading) return;
      setPendingScene(nextId);
      setFading(true);
    },
    [sceneId, fading],
  );

  const finishFade = useCallback(() => {
    if (pendingScene) {
      setSceneId(pendingScene);
      setPendingScene(null);
    }
    setFading(false);
  }, [pendingScene]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!scene) return;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        const next = scene.hotspots[0];
        if (next) navigate(next.targetSceneId);
      }
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        const prev = scene.hotspots.find((h) =>
          h.label?.toLowerCase().includes("back"),
        ) ?? scene.hotspots[scene.hotspots.length - 1];
        if (prev) navigate(prev.targetSceneId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, navigate]);

  const price = formatListPrice(manifest.property?.listPrice);
  const floor = manifest.floors[0];

  return (
    <div className={`relative h-full w-full overflow-hidden bg-ink-950 ${className ?? ""}`}>
      <Canvas
        camera={{
          position:
            scene?.kind === "mesh" ? [5.5, 3.2, 5.5] : [0, 0, 0.1],
          fov: 75,
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
            />
          ) : null}
          <FadeController fading={fading} onDone={finishFade} />
        </XR>
      </Canvas>

      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-300"
        style={{ opacity: fading ? 0.55 : 0 }}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4 md:p-6">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/45 px-4 py-3 backdrop-blur-md">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gold-300">
            {manifest.branding?.orgName ?? "HouseTour"}
          </p>
          <h1 className="font-display text-lg text-white md:text-xl">{manifest.title}</h1>
          {scene ? (
            <p className="text-xs text-white/70">{scene.name}</p>
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
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            className="rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white/90 backdrop-blur"
          >
            {infoOpen ? "Hide info" : "Property info"}
          </button>
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
            {manifest.flags.showFloorPlan && floor?.planUrl ? (
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
          </div>

          <p className="text-center text-[10px] uppercase tracking-[0.18em] text-white/40">
            {scene?.kind === "mesh"
              ? "Orbit mesh · Scroll zoom · Click markers to return to panoramas"
              : "Drag to look · Click gold markers or arrow keys to walk · Continuous multi-point tour"}
          </p>
        </div>
      </div>
    </div>
  );
}
