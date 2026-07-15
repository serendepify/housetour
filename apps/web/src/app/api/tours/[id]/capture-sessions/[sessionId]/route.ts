import { updateCaptureSessionSchema } from "@housetour/api-contract";
import { Prisma, prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

const transitions: Record<string, string[]> = {
  DRAFT: ["CAPTURING", "CANCELLED"],
  CAPTURING: ["UPLOADING", "FAILED", "CANCELLED"],
  UPLOADING: ["READY", "FAILED", "CANCELLED"],
  READY: [],
  FAILED: [],
  CANCELLED: [],
};

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, sessionId } = await ctx.params;

  try {
    const body = updateCaptureSessionSchema.parse(await req.json());
    const captureSession = await prisma.captureSession.findFirst({
      where: {
        id: sessionId,
        tourId: id,
        tour: { organizationId: session.user.organizationId },
      },
    });
    if (!captureSession) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!transitions[captureSession.status]?.includes(body.status)) {
      return NextResponse.json(
        { error: `Cannot move capture from ${captureSession.status} to ${body.status}` },
        { status: 409 },
      );
    }
    if (body.status === "READY" && captureSession.frameCount < 8) {
      return NextResponse.json(
        { error: "At least 8 uploaded frames are required to finish a room scan" },
        { status: 400 },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.captureSession.update({
        where: { id: captureSession.id },
        data: {
          status: body.status,
          qualitySummary: body.qualitySummary as Prisma.InputJsonValue | undefined,
          completedAt:
            body.status === "READY" || body.status === "FAILED" || body.status === "CANCELLED"
              ? new Date()
              : undefined,
        },
      });

      if (body.status === "READY") {
        const sceneCount = await tx.tourScene.count({ where: { tourId: id } });
        await tx.tour.update({
          where: { id },
          data: {
            status: sceneCount > 0 ? "READY" : "DRAFT",
            failureReason: null,
          },
        });
      }
      return result;
    });
    return NextResponse.json({ captureSession: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
