import { loadEnv, prisma } from "@housetour/db";
import { processTourPipeline, type ProcessMode } from "@housetour/pipeline";
import { Worker } from "bullmq";
import IORedis from "ioredis";

loadEnv();

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  "tour-process",
  async (job) => {
    const { jobId, tourId, mode } = job.data as {
      jobId: string;
      tourId: string;
      mode?: ProcessMode;
    };
    const processMode: ProcessMode =
      mode === "photogrammetry" || job.name === "photogrammetry"
        ? "photogrammetry"
        : "pano";
    console.log(`[worker] ${processMode} tour ${tourId} job ${jobId}`);
    try {
      await processTourPipeline(jobId, tourId, processMode);
      console.log(`[worker] done ${tourId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      console.error(`[worker] failed ${tourId}`, message);
      await prisma.processingJob.update({
        where: { id: jobId },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      });
      await prisma.tour.update({
        where: { id: tourId },
        data: { status: "FAILED", failureReason: message },
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
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
});
