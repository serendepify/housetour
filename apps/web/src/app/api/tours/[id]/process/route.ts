import { authOptions } from "@/lib/auth";
import { processTourPipeline } from "@/lib/process-tour";
import { enqueueTourProcess } from "@/lib/queue";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  mode: z.enum(["pano", "photogrammetry"]).default("pano"),
});

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let mode: "pano" | "photogrammetry" = "pano";
  try {
    const json = await req.json().catch(() => ({}));
    mode = bodySchema.parse(json).mode;
  } catch {
    mode = "pano";
  }

  const tour = await prisma.tour.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { assets: true },
  });
  if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    include: { subscription: { include: { plan: true } } },
  });

  if (mode === "photogrammetry" && !org?.subscription?.plan.allowPhotogrammetry) {
    return NextResponse.json(
      {
        error:
          "Photogrammetry requires Pro or Studio. Upgrade in Billing.",
      },
      { status: 402 },
    );
  }

  const panos = tour.assets.filter((a) => a.kind === "PANO" || a.kind === "MULTI_VIEW");
  if (panos.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one 360° panorama or multi-view image before processing" },
      { status: 400 },
    );
  }

  // Soft quota on processing minutes this calendar month
  const plan = org?.subscription?.plan;
  if (plan) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const used = await prisma.usageRecord.aggregate({
      where: {
        organizationId: session.user.organizationId,
        kind: { in: ["PROCESS_MINUTES", "PHOTOGRAMMETRY_MINUTES"] },
        createdAt: { gte: monthStart },
      },
      _sum: { quantity: true },
    });
    const total = used._sum.quantity ?? 0;
    if (total >= plan.processingMinutesIncluded) {
      return NextResponse.json(
        {
          error: `Processing minute quota reached (${total}/${plan.processingMinutesIncluded}). Upgrade plan or wait until next month.`,
        },
        { status: 402 },
      );
    }
  }

  const job = await prisma.processingJob.create({
    data: {
      tourId: id,
      type: mode === "photogrammetry" ? "tour.photogrammetry" : "tour.process",
      status: "QUEUED",
      progress: 0,
    },
  });

  await prisma.tour.update({
    where: { id },
    data: { status: "PROCESSING", failureReason: null },
  });

  try {
    const bull = await enqueueTourProcess(job.id, id, mode);
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { bullJobId: bull.id },
    });
  } catch {
    try {
      await processTourPipeline(job.id, id, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      await prisma.processingJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      });
      await prisma.tour.update({
        where: { id },
        data: { status: "FAILED", failureReason: message },
      });
      return NextResponse.json({ error: message, jobId: job.id }, { status: 500 });
    }
  }

  return NextResponse.json({ jobId: job.id, status: "QUEUED", mode });
}
