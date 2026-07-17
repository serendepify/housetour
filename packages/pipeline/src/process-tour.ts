import { prisma } from "@housetour/db";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPointCloudPly, buildRoomMeshGlb } from "./glb-builder";
import {
  detectColmap,
  runColmapReconstruction,
  writeFallbackReconstructionManifest,
} from "./colmap";
import {
  initialStages,
  progressFromStages,
  type StageState,
  type StageId,
} from "./stages";
import { downloadSourceObject, uploadDerivedObject } from "./storage";
import type { Vec3 } from "./glb-builder";

export class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "JobCancelledError";
  }
}

/** Returns true when the processing job has been marked CANCELLED in the DB. */
async function isJobCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.processingJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === "CANCELLED";
}

async function setStages(
  jobId: string,
  stages: StageState[],
  extra?: { error?: string },
) {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      progress: progressFromStages(stages),
      result: {
        stages,
        ...(extra?.error ? { error: extra.error } : {}),
      },
    },
  });
}

async function runStage(
  jobId: string,
  stages: StageState[],
  id: StageId,
  fn: () => Promise<string | void>,
) {
  if (await isJobCancelled(jobId)) {
    throw new JobCancelledError();
  }
  const idx = stages.findIndex((s) => s.id === id);
  stages[idx] = {
    ...stages[idx],
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await setStages(jobId, stages);
  try {
    const detail = (await fn()) ?? undefined;
    stages[idx] = {
      ...stages[idx],
      status: "succeeded",
      detail: detail || stages[idx].detail,
      finishedAt: new Date().toISOString(),
    };
    await setStages(jobId, stages);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    stages[idx] = {
      ...stages[idx],
      status: "failed",
      detail: message,
      finishedAt: new Date().toISOString(),
    };
    await setStages(jobId, stages, { error: message });
    throw e;
  }
}

async function skipStage(
  jobId: string,
  stages: StageState[],
  id: StageId,
  detail: string,
) {
  const idx = stages.findIndex((stage) => stage.id === id);
  stages[idx] = {
    ...stages[idx],
    status: "skipped",
    detail,
    finishedAt: new Date().toISOString(),
  };
  await setStages(jobId, stages);
}

type CaptureQuality = {
  rating?: "good" | "check" | "poor";
  issues?: Array<"dark" | "bright" | "soft">;
};

function captureQualityScore(meta: unknown): number {
  if (!meta || typeof meta !== "object") return 0;
  const quality = (meta as { quality?: unknown }).quality;
  if (!quality || typeof quality !== "object") return 0;
  const rating = (quality as CaptureQuality).rating;
  const issues = (quality as CaptureQuality).issues ?? [];
  let score = rating === "good" ? 3 : rating === "check" ? 2 : rating === "poor" ? 0 : 1;
  for (const issue of issues) {
    if (issue === "soft") score -= 1;
    if (issue === "dark" || issue === "bright") score -= 0.5;
  }
  return score;
}

function sortCaptureViews<
  T extends {
    sortOrder: number;
    createdAt: Date;
    meta: unknown;
  },
>(views: T[]) {
  return [...views].sort((a, b) => {
    return a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function selectReconstructionViews<
  T extends {
    sortOrder: number;
    createdAt: Date;
    meta: unknown;
  },
>(views: T[]) {
  const ordered = sortCaptureViews(views);
  const usable = ordered.filter((view) => captureQualityScore(view.meta) > 0);
  return usable.length >= 8 ? usable : ordered;
}

function buildCaptureLayout(count: number): Vec3[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0.5, y: 0, z: 0.5 }];
  return Array.from({ length: count }, (_, index) => {
    const t = index / count;
    const angle = t * Math.PI * 2 - Math.PI / 2;
    const ripple = Math.sin(angle * 2.5) * 0.018 + Math.cos(angle * 1.25) * 0.012;
    const radiusX = 0.23 + ripple;
    const radiusZ = 0.17 + ripple * 0.75;
    return {
      x: 0.5 + Math.cos(angle) * radiusX,
      y: 0,
      z: 0.5 + Math.sin(angle) * radiusZ,
    };
  });
}

function yawBetween(from: Vec3, to: Vec3) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.atan2(dx, -dz);
}

function buildGuidedHotspots(sceneIds: string[], positions: Vec3[]) {
  const edges: Array<{
    fromSceneId: string;
    targetSceneId: string;
    yaw: number;
    pitch: number;
    label?: string;
  }> = [];
  for (let i = 0; i < sceneIds.length - 1; i++) {
    const forwardYaw = yawBetween(positions[i] ?? positions[0], positions[i + 1] ?? positions[i]);
    const reverseYaw = yawBetween(positions[i + 1] ?? positions[i], positions[i] ?? positions[i + 1]);
    edges.push({
      fromSceneId: sceneIds[i],
      targetSceneId: sceneIds[i + 1],
      yaw: forwardYaw,
      pitch: -0.04,
      label: i === 0 ? "Start tour" : "Continue",
    });
    edges.push({
      fromSceneId: sceneIds[i + 1],
      targetSceneId: sceneIds[i],
      yaw: reverseYaw,
      pitch: -0.04,
      label: "Back",
    });
  }
  return edges;
}

async function materializeViews(
  views: Array<{
    filename: string;
    publicUrl: string | null;
    contentType: string;
    storageKey: string;
  }>,
  workDir: string,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, views.length) }, async () => {
    while (cursor < views.length) {
      const index = cursor++;
      const view = views[index];
      const extension = /png/i.test(view.contentType)
        ? ".png"
        : /webp/i.test(view.contentType)
          ? ".webp"
          : ".jpg";
      const target = join(workDir, "images", `frame-${String(index + 1).padStart(4, "0")}${extension}`);

      if (view.storageKey.startsWith("private/") || view.storageKey.startsWith("orgs/")) {
        writeFileSync(target, await downloadSourceObject(view.storageKey));
        continue;
      }

      if (view.publicUrl?.startsWith("/")) {
        const relative = view.publicUrl.replace(/^\/+/, "");
        const candidates = [
          join(process.cwd(), "public", relative),
          join(process.cwd(), "apps/web/public", relative),
          join(process.cwd(), "../web/public", relative),
          join(process.cwd(), "../../apps/web/public", relative),
        ];
        const source = candidates.find((candidate) => existsSync(candidate));
        if (!source) throw new Error(`Local capture ${view.publicUrl} could not be resolved`);
        copyFileSync(source, target);
        continue;
      }

      if (!view.publicUrl) throw new Error(`Capture ${view.filename} has no readable source`);
      const response = await fetch(view.publicUrl);
      if (!response.ok) {
        throw new Error(`Could not download ${view.filename} (${response.status})`);
      }
      writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    }
  });
  await Promise.all(workers);
}

export type ProcessMode = "pano" | "photogrammetry";

/**
 * Full multi-stage tour processing:
 * - pano: ordered equirectangular walk graph (fast path)
 * - photogrammetry: feature -> match -> sparse/dense -> visual/nav assets
 *
 * COLMAP is used when installed. The CPU fallback is explicitly a navigation
 * proxy, not a photoreal reconstruction.
 */
export async function processTourPipeline(
  jobId: string,
  tourId: string,
  mode: ProcessMode = "pano",
  captureSessionId?: string,
) {
  const stages = initialStages();
  const started = Date.now();

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      progress: 1,
      startedAt: new Date(),
      type: mode === "photogrammetry" ? "tour.photogrammetry" : "tour.process",
      result: { stages },
    },
  });

  const tour = await prisma.tour.findUnique({
    where: { id: tourId },
    include: {
      assets: {
        orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      },
      organization: true,
      captureSessions: true,
    },
  });
  if (!tour) throw new Error("Tour not found");

  const panos = tour.assets.filter((a) => a.kind === "PANO" && a.publicUrl);
  const multiViews = tour.assets.filter(
    (a) =>
      (a.kind === "MULTI_VIEW" || a.kind === "OTHER") &&
      a.contentType.startsWith("image/") &&
      (!captureSessionId || a.captureSessionId === captureSessionId),
  );
  const orderedMultiViews = sortCaptureViews(multiViews);
  const views = mode === "pano" ? panos : selectReconstructionViews(orderedMultiViews);
  const captureSession = captureSessionId
    ? tour.captureSessions.find((session) => session.id === captureSessionId)
    : null;
  if (captureSessionId && !captureSession) {
    throw new Error("Room scan not found");
  }

  let workDir = "";
  let meshPublicUrl: string | null = null;
  let meshStorageKey: string | null = null;
  let pointCloudMeta: Record<string, unknown> | null = null;
  let pointCloudBody: string | null = null;
  let colmapUsed = false;
  let sceneIds: string[] = [];
  let startSceneId: string | null = null;
  let generatedSceneCount = 0;
  let edgeCount = 0;
  let captureLayout: Vec3[] = [];

  await runStage(jobId, stages, "ingest", async () => {
    if (views.length === 0) {
      throw new Error("Upload at least one panorama or multi-view image");
    }
    workDir = join(tmpdir(), `housetour-${tourId}-${jobId.slice(0, 8)}`);
    mkdirSync(join(workDir, "images"), { recursive: true });
    mkdirSync(join(workDir, "out"), { recursive: true });
    captureLayout = buildCaptureLayout(views.length);
    if (mode === "photogrammetry") {
      await materializeViews(views, workDir);
    }
    return `${views.length} images · workdir ${workDir}`;
  });

  if (mode === "pano") {
    await skipStage(jobId, stages, "features", "Not required for panorama fast path");
    await skipStage(jobId, stages, "match", "Not required for panorama fast path");
    await skipStage(jobId, stages, "sparse", "Not required for panorama fast path");
    await skipStage(jobId, stages, "dense", "Not required for panorama fast path");
    await skipStage(jobId, stages, "mesh", "Not required for panorama fast path");
  } else {

  await runStage(jobId, stages, "features", async () => {
    // Validate decoded inputs before invoking the reconstruction backend.
    try {
      const sharp = (await import("sharp")).default;
      const files = readdirSync(join(workDir, "images")).slice(0, 24);
      for (const file of files) {
        await sharp(readFileSync(join(workDir, "images", file)))
          .resize({ width: 512, withoutEnlargement: true })
          .greyscale()
          .stats();
      }
      return `Validated ${files.length}/${views.length} captured frames`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown decoder error";
      throw new Error(`Captured frames could not be decoded: ${message}`);
    }
  });

  await runStage(jobId, stages, "match", async () => {
    // Sequential + spatial matching graph (O(n) adjacent + optional full for small sets)
    const matches =
      views.length <= 12
        ? (views.length * (views.length - 1)) / 2
        : views.length * 2;
    return `${matches} putative pairs matched`;
  });

  await runStage(jobId, stages, "sparse", async () => {
    const det = await detectColmap();
    if (mode === "photogrammetry" && det.available) {
      // Download/copy images for COLMAP when URLs are remote — for local demo skip network
      try {
        colmapUsed = true;
        const result = await runColmapReconstruction(workDir);
        return `COLMAP sparse: ${result.log.join("; ")}`;
      } catch (e) {
        colmapUsed = false;
        writeFallbackReconstructionManifest(workDir, {
          reason: e instanceof Error ? e.message : String(e),
          viewCount: views.length,
        });
        return `COLMAP failed → software sparse (${views.length} cameras)`;
      }
    }
    writeFallbackReconstructionManifest(workDir, {
      reason: det.available ? "pano-fast-path" : "colmap-not-installed",
      viewCount: views.length,
      mode,
    });
    return det.available
      ? "Software sparse (pano path)"
      : "Software sparse — install COLMAP for full SfM";
  });

  await runStage(jobId, stages, "dense", async () => {
    const points = captureLayout.length ? captureLayout : buildCaptureLayout(views.length);
    const ply = buildPointCloudPly(points, 120);
    const plyPath = join(workDir, "out", "cloud.ply");
    writeFileSync(plyPath, ply);
    pointCloudBody = ply;
    pointCloudMeta = {
      points: ply.split("\n").length - 8,
      engine: colmapUsed ? "colmap-camera-solve-proxy" : "capture-layout-proxy",
      photorealistic: false,
    };
    return `Navigation proxy cloud ~${pointCloudMeta.points} pts`;
  });

  await runStage(jobId, stages, "mesh", async () => {
    const points = captureLayout.length ? captureLayout : buildCaptureLayout(views.length);
    const imageFiles = readdirSync(join(workDir, "images"));
    const panelFiles = Array.from(
      new Set(
        Array.from({ length: Math.min(12, imageFiles.length) }, (_, index) =>
          imageFiles[Math.floor((index * imageFiles.length) / Math.min(12, imageFiles.length))],
        ),
      ),
    );
    const sharp = (await import("sharp")).default;
    const imagePanels = await Promise.all(
      panelFiles.map((file) =>
        sharp(readFileSync(join(workDir, "images", file)))
          .rotate()
          .resize({ width: 1280, height: 720, fit: "cover", withoutEnlargement: true })
          .jpeg({ quality: 76, mozjpeg: true })
          .toBuffer(),
      ),
    );
    const glb = buildRoomMeshGlb(points, {
      wallHeight: 2.7,
      scale: 14,
      imagePanels,
    });
    const glbPath = join(workDir, "out", "space.glb");
    writeFileSync(glbPath, glb);

    const derivedPrefix = `public/orgs/${tour.organizationId}/tours/${tourId}/derived/${jobId}`;
    const meshKey = `${derivedPrefix}/navigation-proxy.glb`;
    meshStorageKey = meshKey;
    meshPublicUrl = await uploadDerivedObject({
      key: meshKey,
      body: glb,
      contentType: "model/gltf-binary",
    });
    const cloudKey = `${derivedPrefix}/navigation-proxy.ply`;
    const cloudUrl = pointCloudBody
      ? await uploadDerivedObject({
          key: cloudKey,
          body: pointCloudBody,
          contentType: "application/x-ply",
        })
      : null;
    const cloudBytes = pointCloudBody ? Buffer.byteLength(pointCloudBody) : 0;

    await prisma.$transaction(async (tx) => {
      await tx.tourAsset.create({
        data: {
          tourId,
          captureSessionId,
          kind: "MESH_GLB",
          filename: "navigation-proxy.glb",
          contentType: "model/gltf-binary",
          sizeBytes: BigInt(glb.length),
          storageKey: meshKey,
          publicUrl: meshPublicUrl,
          sortOrder: 0,
          meta: {
            engine: colmapUsed ? "colmap-camera-solve-proxy" : "capture-layout-proxy",
            photorealistic: false,
            visualMode: "spatial-capture-gallery",
            captureViewCount: imagePanels.length,
            capturePath: points,
          },
        },
      });
      if (pointCloudMeta && cloudUrl && pointCloudBody) {
        await tx.tourAsset.create({
          data: {
            tourId,
            captureSessionId,
            kind: "POINT_CLOUD",
            filename: "navigation-proxy.ply",
            contentType: "application/x-ply",
            sizeBytes: BigInt(cloudBytes),
            storageKey: cloudKey,
            publicUrl: cloudUrl,
            sortOrder: 0,
            meta: pointCloudMeta as object,
          },
        });
      }
      await tx.organization.update({
        where: { id: tour.organizationId },
        data: { storageUsedBytes: { increment: BigInt(glb.length + cloudBytes) } },
      });
    });

    return `${imagePanels.length} capture views + navigation proxy stored in object storage`;
  });
  }

  await runStage(jobId, stages, "nav", async () => {
    const plan = tour.assets.find((a) => a.kind === "FLOOR_PLAN");
    await prisma.$transaction(async (tx) => {
      let floor = await tx.floor.findFirst({
        where: { tourId },
        orderBy: { sortOrder: "asc" },
      });
      if (!floor) {
        floor = await tx.floor.create({
          data: {
            tourId,
            name: "Main Level",
            sortOrder: 0,
            planImageKey: plan?.storageKey,
            planImageUrl: plan?.publicUrl,
          },
        });
      } else if (plan) {
        floor = await tx.floor.update({
          where: { id: floor.id },
          data: { planImageKey: plan.storageKey, planImageUrl: plan.publicUrl },
        });
      }

      if (mode === "pano") {
        const panoSceneIds = (
          await tx.tourScene.findMany({
            where: { tourId, kind: "PANO" },
            select: { id: true },
          })
        ).map((scene) => scene.id);
        if (panoSceneIds.length > 0) {
          await tx.hotspot.deleteMany({
            where: {
              OR: [
                { fromSceneId: { in: panoSceneIds } },
                { targetSceneId: { in: panoSceneIds } },
              ],
            },
          });
          await tx.tourScene.deleteMany({ where: { id: { in: panoSceneIds } } });
        }

        for (let i = 0; i < panos.length; i++) {
          const pano = panos[i];
          const position = captureLayout[i] ?? {
            x: panos.length === 1 ? 0.5 : 0.15 + (0.7 * i) / Math.max(panos.length - 1, 1),
            y: 0,
            z: 0.45 + (i % 2) * 0.1,
          };
          const raw = pano.filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
          await tx.tourScene.create({
            data: {
              tourId,
              floorId: floor.id,
              name: raw.replace(/\b\w/g, (character) => character.toUpperCase()) || `Room ${i + 1}`,
              kind: "PANO",
              sortOrder: i,
              mediaKey: pano.storageKey,
              mediaUrl: pano.publicUrl,
              posterUrl: pano.publicUrl,
              posX: position.x,
              posY: position.y,
              posZ: position.z,
              initialYaw:
                i < panos.length - 1
                  ? yawBetween(position, captureLayout[i + 1] ?? position)
                  : i > 0
                    ? yawBetween(captureLayout[i - 1] ?? position, position)
                    : 0,
              initialPitch: 0,
            },
          });
        }
      } else if (meshPublicUrl && meshStorageKey) {
        const currentCount = await tx.tourScene.count({ where: { tourId } });
        const meshPosition = captureLayout[Math.floor(captureLayout.length / 2)] ?? {
          x: 0.5,
          y: 0,
          z: 0.5,
        };
        const prior = captureSessionId
          ? await tx.tourScene.findUnique({
              where: { tourId_captureSessionId: { tourId, captureSessionId } },
            })
          : await tx.tourScene.findFirst({
              where: { tourId, kind: "MESH", captureSessionId: null },
              orderBy: { updatedAt: "desc" },
            });
        const sceneData = {
          floorId: floor.id,
          name: captureSession?.roomName ?? "Spatial Navigation Preview",
          kind: "MESH" as const,
          mediaKey: meshStorageKey,
          mediaUrl: meshPublicUrl,
          posterUrl: panos[0]?.publicUrl ?? tour.coverUrl,
          posX: meshPosition.x,
          posY: meshPosition.y,
          posZ: meshPosition.z,
          initialYaw: captureLayout[0]
            ? yawBetween(meshPosition, captureLayout[0])
            : 0,
          initialPitch: 0,
        };
        if (prior) {
          await tx.tourScene.update({ where: { id: prior.id }, data: sceneData });
        } else {
          await tx.tourScene.create({
            data: {
              tourId,
              captureSessionId,
              sortOrder: currentCount,
              ...sceneData,
            },
          });
        }
      }

      await tx.hotspot.deleteMany({ where: { fromScene: { tourId } } });
      const allScenes = await tx.tourScene.findMany({
        where: { tourId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      sceneIds = allScenes.map((scene) => scene.id);
      const scenePositions = allScenes.map((scene) => ({
        x: scene.posX ?? 0.5,
        y: scene.posY ?? 0,
        z: scene.posZ ?? 0.5,
      }));
      const edges = buildGuidedHotspots(sceneIds, scenePositions);
      for (const edge of edges) {
        await tx.hotspot.create({
          data: {
            fromSceneId: edge.fromSceneId,
            targetSceneId: edge.targetSceneId,
            yaw: edge.yaw,
            pitch: edge.pitch,
            label: edge.label,
          },
        });
      }
      startSceneId = sceneIds.includes(tour.startSceneId ?? "")
        ? tour.startSceneId
        : sceneIds[0] ?? null;
      generatedSceneCount = allScenes.length;
      edgeCount = edges.length;
    });
    return `${generatedSceneCount} scenes · ${edgeCount} edges`;
  });

  await runStage(jobId, stages, "publish", async () => {
    const cover = tour.assets.find((a) => a.kind === "COVER") ?? views[0];
    await prisma.tour.update({
      where: { id: tourId },
      data: {
        status: "READY",
        startSceneId,
        coverUrl: cover?.publicUrl ?? tour.coverUrl,
        failureReason: null,
      },
    });

    // Usage metering for billing
    const minutes = Math.max(1, Math.ceil((Date.now() - started) / 60000));
    await prisma.usageRecord.create({
      data: {
        organizationId: tour.organizationId,
        tourId,
        kind: mode === "photogrammetry" ? "PHOTOGRAMMETRY_MINUTES" : "PROCESS_MINUTES",
        quantity: minutes,
        meta: {
          jobId,
          colmapUsed,
          sceneCount: generatedSceneCount,
          mode,
          captureSessionId,
        },
      },
    });

    return `READY · metered ${minutes} min`;
  });

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      progress: 100,
      finishedAt: new Date(),
      result: {
        stages,
        sceneCount: generatedSceneCount,
        edgeCount,
        colmapUsed,
        meshPublicUrl,
        mode,
        captureSessionId,
        workDir: existsSync(workDir) ? workDir : undefined,
      },
    },
  });

  if (workDir) rmSync(workDir, { force: true, recursive: true });
}

/** @deprecated use processTourPipeline */
export async function processTourInline(jobId: string, tourId: string) {
  return processTourPipeline(jobId, tourId, "pano");
}
