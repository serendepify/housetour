/**
 * Modal reconstruction client.
 *
 * Invokes the GPU reconstruction services deployed on Modal
 * (infra/modal/reconstruct.py) from the Node worker. The Node worker itself
 * needs NO GPU — it just POSTs a job to Modal's web endpoint, Modal spins up
 * a GPU container on demand, the heavy work runs there, and the result is
 * uploaded to object storage. Cost is per-second, scale-to-zero.
 *
 * Capability model:
 *   - If MODAL_WEBHOOK_URL is configured -> real GPU reconstruction (COLMAP /
 *     3D Gaussian Splatting) runs on Modal using the user's credits.
 *   - If not configured -> caller falls back to the CPU software reconstruction
 *     (capture-layout proxy + textured room mesh) so the product still works.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ReconstructionEngine = "colmap" | "splat";

export type ModalConfig = {
  webhookUrl: string;
  apiKey: string;
};

/** Read Modal config from env. Returns null when GPU reconstruction is disabled. */
export function getModalConfig(): ModalConfig | null {
  const url = process.env.MODAL_WEBHOOK_URL;
  const key = process.env.MODAL_WEBHOOK_SECRET;
  if (!url || !key) return null;
  return { webhookUrl: url, apiKey: key };
}

/** Build a ZIP of capture frame buffers. */
export function buildFramesZip(frames: Buffer[]): Buffer {
  // eslint-disable-next-line no-eval
  const ADM = eval("require")("adm-zip");
  const zip = new ADM();
  frames.forEach((buf, i) =>
    zip.addFile(`frame_${String(i).padStart(4, "0")}.jpg`, buf),
  );
  return zip.toBuffer();
}

export type ModalReconstructionResult = {
  ok: boolean;
  engine: ReconstructionEngine;
  meshUrl?: string;
  splatUrl?: string;
  frames?: number;
  vertices?: number;
  error?: string;
  raw?: unknown;
};

export type TriggerParams = {
  config: ModalConfig;
  engine: ReconstructionEngine;
  jobId: string;
  tourId: string;
  orgId: string;
  framesZip: Buffer;
  uploadFrames: (key: string, body: Buffer) => Promise<string>;
  callbackUrl: string;
};

/**
 * Trigger Modal reconstruction. The caller provides `uploadFrames` so this
 * client stays storage-agnostic (S3 / MinIO / fs backends all work).
 *
 * The Modal function reports progress/result back via `callbackUrl`, which the
 * web app exposes and persists into ProcessingJob.meta. This client POSTs the
 * job and returns Modal's immediate acknowledgement; the worker polls the job
 * meta (updated by the callback) for the terminal result.
 */
export async function triggerModalReconstruction(
  params: TriggerParams,
): Promise<ModalReconstructionResult> {
  const { config, engine, jobId, tourId, orgId, framesZip, uploadFrames, callbackUrl } =
    params;

  const framesKey = `orgs/${orgId}/tours/${tourId}/frames/${jobId}.zip`;
  const framesUrl = await uploadFrames(framesKey, framesZip);

  const endpoint =
    engine === "splat"
      ? config.webhookUrl.replace(/gpu-probe/, "train-gaussian-splat")
      : config.webhookUrl.replace(/gpu-probe/, "colmap-dense-mesh");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: config.apiKey,
      jobId,
      tourId,
      orgId,
      framesUrl,
      callbackUrl,
      engine,
    }),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false,
      engine,
      error: `Modal ${res.status}: ${JSON.stringify(raw)}`,
      raw,
    };
  }
  return {
    ok: Boolean(raw?.ok),
    engine,
    meshUrl: raw?.meshUrl,
    splatUrl: raw?.splatUrl,
    frames: raw?.frames,
    vertices: raw?.vertices,
    error: raw?.error,
    raw,
  };
}

/** Local temp dir helper for staging frame downloads. */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
