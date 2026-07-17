import { prisma } from "@housetour/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ jobId: string }> };

/**
 * Modal reconstruction progress callback. The Modal GPU function (infra/modal/
 * reconstruct.py) POSTs stage updates here; we persist them into the
 * ProcessingJob.meta so the worker (or the UI) can show live progress and the
 * final result.
 */
export async function POST(req: Request, ctx: Ctx) {
  const secret = process.env.MODAL_WEBHOOK_SECRET;
  const provided =
    req.headers.get("x-housetour-key") ?? req.headers.get("authorization") ?? "";
  if (secret && provided.replace(/^Bearer /, "") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { jobId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { stage, status } = body as { stage?: string; status?: string };

  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const prevMeta = (job.meta ?? {}) as Record<string, unknown>;
  const stages = (prevMeta.stages ?? {}) as Record<string, unknown>;
  if (stage) stages[stage] = { status, at: new Date().toISOString(), ...body };

  const newMeta = { ...prevMeta, stages, lastModal: body };

  // Terminal status updates
  if (status === "succeeded" && (body.meshUrl || body.splatUrl)) {
    const sceneCount = await prisma.tourScene.count({ where: { tourId: job.tourId } });
    await prisma.tour.update({
      where: { id: job.tourId },
      data: { status: sceneCount > 0 ? "READY" : "DRAFT" },
    });
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        meta: newMeta as any,
      },
    });
  } else if (status === "error") {
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        error: String((body as any).error ?? "modal reconstruction failed"),
        finishedAt: new Date(),
        meta: newMeta as any,
      },
    });
  } else {
    // In-progress update
    await prisma.processingJob.update({
      where: { id: jobId },
      data: { meta: newMeta as any },
    });
  }

  return NextResponse.json({ ok: true });
}
