/**
 * Modal reconstruction orchestration for the worker.
 *
 * Gathers the capture session's multi-view frames, ships them to the Modal GPU
 * service (infra/modal/reconstruct.py), and returns a spec the worker persists
 * as a TourScene + TourAsset. The Node worker stays GPU-free; Modal does the
 * heavy lifting on demand (per-second, scale-to-zero).
 *
 * Returns null when Modal is not configured -> caller falls back to the CPU
 * software reconstruction (capture-layout room mesh) so the product still works.
 */
import { downloadSourceObject } from "./storage";
import {
  getModalConfig,
  buildFramesZip,
  triggerModalReconstruction,
  type ReconstructionEngine,
} from "./modal-client";

export type ModalReconResult =
  | {
      used: true;
      engine: ReconstructionEngine;
      sceneKind: "MESH" | "SPLAT";
      mediaUrl: string;
      storageKey: string;
      assetKind: "MESH_GLB" | "SPLAT_PLY";
      frames: number;
      engineMeta: Record<string, unknown>;
    }
  | { used: false };

/**
 * @param frames - raw capture frame buffers (already downloaded by caller), max ~60
 * @param callbackUrl - optional web-app endpoint Modal reports progress to
 */
export async function runModalReconstruction(params: {
  jobId: string;
  tourId: string;
  orgId: string;
  engine: ReconstructionEngine;
  frames: Buffer[];
  uploadFrames: (key: string, body: Buffer) => Promise<string>;
  callbackUrl?: string;
}): Promise<ModalReconResult> {
  const cfg = getModalConfig();
  if (!cfg) return { used: false };
  if (params.frames.length < 2) return { used: false };

  const zip = buildFramesZip(params.frames);
  const res = await triggerModalReconstruction({
    config: cfg,
    engine: params.engine,
    jobId: params.jobId,
    tourId: params.tourId,
    orgId: params.orgId,
    framesZip: zip,
    uploadFrames: params.uploadFrames,
    callbackUrl: params.callbackUrl ?? "",
  });

  if (!res.ok) {
    console.warn(`[modal] ${params.engine} failed: ${res.error}`);
    return { used: false };
  }

  if (params.engine === "splat" && res.splatUrl) {
    return {
      used: true,
      engine: "splat",
      sceneKind: "SPLAT",
      mediaUrl: res.splatUrl,
      storageKey: res.splatUrl.split("/derived/")[1] ?? res.splatUrl,
      assetKind: "SPLAT_PLY",
      frames: res.frames ?? 0,
      engineMeta: { engine: "gaussian-splatting", vertices: res.vertices },
    };
  }
  if (res.meshUrl) {
    return {
      used: true,
      engine: "colmap",
      sceneKind: "MESH",
      mediaUrl: res.meshUrl,
      storageKey: res.meshUrl.split("/derived/")[1] ?? res.meshUrl,
      assetKind: "MESH_GLB",
      frames: res.frames ?? 0,
      engineMeta: { engine: "colmap-dense-mesh", photorealistic: true, vertices: res.vertices },
    };
  }
  return { used: false };
}

/** Download multi-view capture frames (already stored as MULTI_VIEW assets). */
export async function gatherCaptureFrames(
  storageKeys: string[],
  max = 60,
): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const key of storageKeys.slice(0, max)) {
    try {
      out.push(await downloadSourceObject(key));
    } catch (e) {
      console.warn(`[modal] frame download failed for ${key}: ${String(e)}`);
    }
  }
  return out;
}
