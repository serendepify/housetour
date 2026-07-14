import type { TourManifest } from "@housetour/api-contract";

export type { TourManifest };

export function getSceneMap(manifest: TourManifest) {
  return new Map(manifest.scenes.map((s) => [s.id, s]));
}

export function getAdjacentSceneIds(
  manifest: TourManifest,
  sceneId: string,
): string[] {
  const scene = manifest.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  return scene.hotspots.map((h) => h.targetSceneId);
}

/** Convert yaw/pitch (radians) to a unit direction on a sphere (Y-up). */
export function sphericalToCartesian(yaw: number, pitch: number, radius = 1) {
  const cp = Math.cos(pitch);
  return {
    x: radius * Math.sin(yaw) * cp,
    y: radius * Math.sin(pitch),
    z: radius * -Math.cos(yaw) * cp,
  };
}

export function formatListPrice(value?: string | null): string | null {
  if (!value) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function buildAutoLinearHotspots(
  sceneIds: string[],
  bidirectional = true,
): Array<{
  fromSceneId: string;
  targetSceneId: string;
  yaw: number;
  pitch: number;
  label?: string;
}> {
  const edges: Array<{
    fromSceneId: string;
    targetSceneId: string;
    yaw: number;
    pitch: number;
    label?: string;
  }> = [];

  for (let i = 0; i < sceneIds.length - 1; i++) {
    edges.push({
      fromSceneId: sceneIds[i],
      targetSceneId: sceneIds[i + 1],
      yaw: 0.15,
      pitch: -0.05,
      label: "Continue",
    });
    if (bidirectional) {
      edges.push({
        fromSceneId: sceneIds[i + 1],
        targetSceneId: sceneIds[i],
        yaw: Math.PI + 0.15,
        pitch: -0.05,
        label: "Back",
      });
    }
  }
  return edges;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
