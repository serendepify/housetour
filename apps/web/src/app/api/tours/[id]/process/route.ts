import { authOptions } from "@/lib/auth";
import {
  isCaptureReadyForReconstruction,
  summarizeCaptureQuality,
  type CaptureQuality,
} from "@/lib/capture-quality";
import { processTourPipeline } from "@/lib/process-tour";
import { enqueueTourProcess } from "@/lib/queue";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  mode: z.enum(["pano", "photogrammetry"]).default("pano"),
  captureSessionId: z.string().uuid().optional(),
});

function collectCaptureQuality(assetMeta: unknown): CaptureQuality | null {
  if (!assetMeta || typeof assetMeta !== "object") return null;
  const quality = (assetMeta as { quality?: unknown }).quality;
  if (!quality || typeof quality !== "object") return null;
  const rating = (quality as { rating?: unknown }).rating;
  if (rating !== "good" && rating !== "check" && rating !== "poor") return null;
  return {
    brightness: 0,
    sharpness: 0,
    rating,
    issues: Array.isArray((quality as { issues?: unknown }).issues)
      ? ((quality as { issues?: Array<"dark" | "bright" | "soft"> }).issues ?? []).filter(
          (issue): issue is "dark" | "bright" | "soft" =>
            issue === "dark" || issue === "bright" || issue === "soft",
        )
      : [],
  };
}

function summarizeCaptureAssets(assets: Array<{ meta: unknown }>) {
  const qualities = assets
    .map((asset) => collectCaptureQuality(asset.meta))
    .filter((quality): quality is CaptureQuality => quality !== null);
  return summarizeCaptureQuality(qualities);
}

async function markBuildFailed(tourId: string, message: string) {
  const sceneCount = await prisma.tourScene.count({ where: { tourId } });
  await prisma.tour.update({
    where: { id: tourId },
    data: {
      status: sceneCount > 0 ? "READY" : "FAILED",
      failureReason: message,
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let mode: "pano" | "photogrammetry" = "pano";
  let captureSessionId: string | undefined;
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = bodySchema.parse(json);
    mode = parsed.mode;
    captureSessionId = parsed.captureSessionId;
  } catch {
    mode = "pano";
  }

  const tour = await prisma.tour.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { assets: true, _count: { select: { scenes: true } } },
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

  const captureSession = captureSessionId
    ? await prisma.captureSession.findFirst({
        where: { id: captureSessionId, tourId: id },
      })
    : null;
  if (captureSessionId && !captureSession) {
    return NextResponse.json({ error: "Room scan not found" }, { status: 404 });
  }
  if (captureSession && captureSession.status !== "READY") {
    return NextResponse.json(
      { error: "Finish uploading this room scan before building it" },
      { status: 409 },
    );
  }

  const panos = tour.assets.filter((asset) => asset.kind === "PANO");
  const multiViews = tour.assets.filter(
    (asset) =>
      asset.kind === "MULTI_VIEW" &&
      asset.contentType.startsWith("image/") &&
      (!captureSessionId || asset.captureSessionId === captureSessionId),
  );
  const orderedMultiViews = [...multiViews].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  if (mode === "pano" && panos.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one 360° panorama before running the panorama path" },
      { status: 400 },
    );
  }
  if (mode === "photogrammetry" && orderedMultiViews.length < 8) {
    return NextResponse.json(
      {
        error: `High-fidelity reconstruction needs at least 8 overlapping perspective frames (${orderedMultiViews.length}/8 uploaded)`,
      },
      { status: 400 },
    );
  }
  if (mode === "photogrammetry") {
    const qualitySummary = summarizeCaptureAssets(orderedMultiViews);
    if (qualitySummary.total > 0 && !isCaptureReadyForReconstruction(qualitySummary)) {
      return NextResponse.json(
        {
          error:
            "This room scan is not strong enough for photogrammetry yet. Retake the soft or dark frames before building it.",
          qualitySummary,
        },
        { status: 400 },
      );
    }
  }


  const activeJob = await prisma.processingJob.findFirst({
    where: {
      tourId: id,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (activeJob) {
    const sameBuild =
      activeJob.captureSessionId === (captureSessionId ?? null) &&
      activeJob.type ===
        (mode === "photogrammetry" ? "tour.photogrammetry" : "tour.process");
    if (!sameBuild) {
      return NextResponse.json(
        { error: "Another room in this listing is already building" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        jobId: activeJob.id,
        status: activeJob.status,
        mode,
        captureSessionId,
        duplicate: true,
      },
      { status: 202 },
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
      captureSessionId,
      type: mode === "photogrammetry" ? "tour.photogrammetry" : "tour.process",
      status: "QUEUED",
      progress: 0,
    },
  });

  await prisma.tour.update({
    where: { id },
    data: {
      status: tour._count.scenes > 0 ? "READY" : "PROCESSING",
      failureReason: null,
    },
  });

  try {
    const bull = await enqueueTourProcess(job.id, id, mode, captureSessionId);
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { bullJobId: bull.id },
    });
  } catch {
    try {
      await processTourPipeline(job.id, id, mode, captureSessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      await prisma.processingJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      });
      await markBuildFailed(id, message);
      return NextResponse.json({ error: message, jobId: job.id }, { status: 500 });
    }
  }

  return NextResponse.json({
    jobId: job.id,
    status: "QUEUED",
    mode,
    captureSessionId,
  });
}
