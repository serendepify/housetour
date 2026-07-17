import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getTourQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, jobId } = await ctx.params;

  const job = await prisma.processingJob.findFirst({
    where: { id: jobId, tourId: id, tour: { organizationId: session.user.organizationId } },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED") {
    return NextResponse.json(
      { error: `Job already ${job.status.toLowerCase()}` },
      { status: 409 },
    );
  }

  // Mark cancelled. The worker checks this flag before each stage and stops;
  // if the job is still queued in BullMQ we also remove it so it never starts.
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });

  try {
    const queue = getTourQueue();
    await queue.remove(job.bullJobId ?? jobId);
  } catch {
    // BullMQ remove is best-effort; the DB flag is the source of truth.
  }

  const sceneCount = await prisma.tourScene.count({ where: { tourId: id } });
  await prisma.tour.update({
    where: { id },
    data: { status: sceneCount > 0 ? "READY" : "DRAFT" },
  });

  return NextResponse.json({ status: "CANCELLED", jobId });
}
