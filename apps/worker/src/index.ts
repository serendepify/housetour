import { loadEnv, prisma } from "@housetour/db";
import {
  processTourPipeline,
  JobCancelledError,
  type ProcessMode,
  runModalReconstruction,
  gatherCaptureFrames,
  uploadDerivedObject,
} from "@housetour/pipeline";
import { Worker } from "bullmq";

loadEnv();

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = { url: redisUrl, maxRetriesPerRequest: null };

const worker = new Worker(
  "tour-process",
  async (job) => {
    const { jobId, tourId, mode, captureSessionId } = job.data as {
      jobId: string;
      tourId: string;
      mode?: ProcessMode;
      captureSessionId?: string;
    };
    const processMode: ProcessMode =
      mode === "photogrammetry" || job.name === "photogrammetry"
        ? "photogrammetry"
        : "pano";
    console.log(`[worker] ${processMode} tour ${tourId} job ${jobId}`);
    try {
      // GPU path: if Modal is configured and we have real capture frames,
      // run real COLMAP-dense / Gaussian Splatting reconstruction on Modal.
      if (processMode === "photogrammetry") {
        const tour = await prisma.tour.findUnique({
          where: { id: tourId },
          include: { assets: { where: { kind: "MULTI_VIEW" }, select: { storageKey: true } } },
        });
        const frameKeys = tour?.assets.map((a) => a.storageKey).filter(Boolean) as string[];
        if (frameKeys.length >= 2) {
          const engine = process.env.RECON_ENGINE === "splat" ? "splat" : "colmap";
          const frames = await gatherCaptureFrames(frameKeys);
          const modal = await runModalReconstruction({
            jobId,
            tourId,
            orgId: tour!.organizationId,
            engine,
            frames,
            uploadFrames: (key, body) =>
              uploadDerivedObject({
                key,
                body,
                contentType: engine === "splat" ? "application/x-ply" : "model/gltf-binary",
              }),
            callbackUrl: `${process.env.APP_BASE_URL ?? ""}/api/jobs/${jobId}/modal-callback`,
          });
          if (modal.used) {
            await prisma.$transaction(async (tx) => {
              const floor =
                (await tx.floor.findFirst({ where: { tourId } })) ??
                (await tx.floor.create({ data: { tourId, name: "Main Level", sortOrder: 0 } }));
              await tx.tourAsset.create({
                data: {
                  tourId,
                  captureSessionId,
                  kind: modal.assetKind,
                  filename: modal.sceneKind === "SPLAT" ? "gaussian-splat.ply" : "navigation-proxy.glb",
                  contentType: modal.sceneKind === "SPLAT" ? "application/x-ply" : "model/gltf-binary",
                  sizeBytes: 0n,
                  storageKey: modal.storageKey,
                  publicUrl: modal.mediaUrl,
                  sortOrder: 0,
                  meta: modal.engineMeta as any,
                },
              });
              await tx.tourScene.create({
                data: {
                  tourId,
                  floorId: floor.id,
                  captureSessionId,
                  name: modal.engine === "splat" ? "Gaussian Splatting Tour" : "Photoreal Mesh",
                  kind: modal.sceneKind,
                  mediaKey: modal.storageKey,
                  mediaUrl: modal.mediaUrl,
                  posterUrl: tour!.coverUrl,
                  posX: 0.5,
                  posY: 0,
                  posZ: 0.5,
                  initialYaw: 0,
                  initialPitch: 0,
                },
              });
            });
            await prisma.tour.update({ where: { id: tourId }, data: { status: "READY" } });
            console.log(`[worker] Modal ${modal.engine} done -> ${modal.mediaUrl}`);
            return;
          }
          console.log("[worker] Modal unavailable/failed, falling back to CPU pipeline");
        }
      }

      await processTourPipeline(jobId, tourId, processMode, captureSessionId);
      console.log(`[worker] done ${tourId}`);
      } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      if (err instanceof JobCancelledError) {
        console.log(`[worker] cancelled ${tourId}`);
        await prisma.processingJob.update({
          where: { id: jobId },
          data: { status: "CANCELLED", finishedAt: new Date() },
        });
        // Leave any scenes already built; don't mark the whole tour failed.
        const sceneCount = await prisma.tourScene.count({ where: { tourId } });
        await prisma.tour.update({
          where: { id: tourId },
          data: { status: sceneCount > 0 ? "READY" : "DRAFT" },
        });
        return;
      }
      console.error(`[worker] failed ${tourId}`, message);
      await prisma.processingJob.update({
        where: { id: jobId },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      });
      const sceneCount = await prisma.tourScene.count({ where: { tourId } });
      await prisma.tour.update({
        where: { id: tourId },
        data: {
          status: sceneCount > 0 ? "READY" : "FAILED",
          failureReason: message,
        },
      });
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("ready", () =>
  console.log("[worker] ready on queue tour-process (pano + photogrammetry)"),
);
worker.on("failed", (job, err) => {
  console.error("[worker] job failed", job?.id, err.message);
});

process.on("SIGINT", async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});
