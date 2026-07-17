"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a 3D Gaussian Splatting .ply (produced by the Modal
 * train_gaussian_splat function) as a walkable photoreal scene.
 *
 * The viewer library (@mkkellogg/gaussian-splats-3d) is loaded dynamically so
 * this component compiles whether or not the dep is installed, and so a missing
 * asset / API mismatch degrades to a readable error instead of a white screen.
 */
export function SplatViewer({
  url,
  initialYaw = 0,
  initialPitch = 0,
}: {
  url: string;
  initialYaw?: number;
  initialPitch?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const host = containerRef.current;

    (async () => {
      try {
        const mod = await import("@mkkellogg/gaussian-splats-3d");
        const THREE = await import("three");
        // The library ships a default export object; tolerate both shapes.
        const Viewer: any = (mod as any).Viewer ?? (mod as any).default?.Viewer;
        if (!Viewer) throw new Error("splat viewer export not found");

        const camera = new THREE.PerspectiveCamera(
          70,
          host.clientWidth / Math.max(host.clientHeight, 1),
          0.1,
          1000,
        );
        camera.position.set(0, 1.6, 4);
        camera.rotation.order = "YXZ";
        camera.rotation.y = initialYaw;
        camera.rotation.x = initialPitch;

        const viewer = new Viewer({
          camera,
          renderer: new THREE.WebGLRenderer({ antialias: false }),
          useBuiltInControls: true,
          selfDrivenMode: true,
        });
        host.appendChild(viewer.domElement);
        await viewer.addSplatScene(url, { position: [0, 0, 0] });
        if (!disposed) setLoading(false);

        (window as any).__splatViewer = viewer;
      } catch (e: unknown) {
        if (!disposed) setError(String((e as Error)?.message ?? e));
      }
    })();

    return () => {
      disposed = true;
      const v = (window as any).__splatViewer;
      try {
        v?.dispose?.();
      } catch {
        /* noop */
      }
    };
  }, [url, initialYaw, initialPitch]);

  return (
    <div ref={containerRef} className="relative h-full w-full" style={{ background: "#0b0b12" }}>
      {loading && !error ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
          Loading Gaussian splat…
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-sm text-white/80">
          This Gaussian splat could not be loaded.
          <span className="mt-1 block text-[11px] text-white/50">{error}</span>
        </div>
      ) : null}
    </div>
  );
}
