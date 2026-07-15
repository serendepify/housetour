import { createCaptureSessionSchema } from "@housetour/api-contract";
import { Prisma, prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const tour = await prisma.tour.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const captureSessions = await prisma.captureSession.findMany({
    where: { tourId: id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { assets: true } } },
  });
  return NextResponse.json({ captureSessions });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const body = createCaptureSessionSchema.parse(await req.json());
    const tour = await prisma.tour.findFirst({
      where: { id, organizationId: session.user.organizationId },
      select: { id: true },
    });
    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const captureSession = await prisma.captureSession.create({
      data: {
        tourId: id,
        createdById: session.user.id,
        roomName: body.roomName,
        mode: body.mode,
        status: "CAPTURING",
        targetFrameCount: body.targetFrameCount,
        deviceInfo: body.deviceInfo as Prisma.InputJsonValue | undefined,
        startedAt: new Date(),
      },
    });
    return NextResponse.json({ captureSession }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
