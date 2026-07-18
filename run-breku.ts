import { loadEnv, prisma } from "./packages/db/src/index";
import { processTourPipeline } from "./packages/pipeline/src/process-tour";

async function main() {
  loadEnv();

  const jobId = crypto.randomUUID();
  const tourId = "63584f2a-2742-413f-b109-ef2f91303cf8";
  const sessionId = "94c7bf75-d680-40c4-ae57-94658a7e69d5";

  // Clean old MESH scenes for this session
  await prisma.tourScene.deleteMany({
    where: { tourId, captureSessionId: sessionId, kind: "MESH" },
  });

  await prisma.processingJob.create({
    data: {
      id: jobId,
      tourId,
      captureSessionId: sessionId,
      type: "tour.process",
      status: "RUNNING",
    },
  });

  console.log(`[breku] Pipeline job ${jobId} starting`);
  try {
    await processTourPipeline(jobId, tourId, "photogrammetry", sessionId);
    console.log("[breku] Pipeline complete");
  } catch (err) {
    console.error("[breku] Failed:", err instanceof Error ? err.message : err);
    await prisma.processingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: String(err instanceof Error ? err.message : err), finishedAt: new Date() },
    });
  }

  await prisma.$disconnect();
}

main();
