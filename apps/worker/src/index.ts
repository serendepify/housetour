import { loadEnv, prisma } from "@housetour/db";
import { processTourPipeline, type ProcessMode } from "@housetour/pipeline";
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
      await processTourPipeline(jobId, tourId, processMode, captureSessionId);
      console.log(`[worker] done ${tourId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
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
