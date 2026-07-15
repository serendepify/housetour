import { authOptions } from "@/lib/auth";
import { copyStoredObject, deleteStoredObjects } from "@/lib/s3";
import { Prisma, prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const importSchema = z.object({
  sourceCaptureSessionId: z.string().uuid(),
});

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const destination = await prisma.tour.findFirst({
    where: { id, organizationId: session.user.organizationId, archivedAt: null },
    select: { id: true },
  });
  if (!destination) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const captureSessions = await prisma.captureSession.findMany({
    where: {
      tourId: { not: id },
      status: "READY",
      tour: {
        organizationId: session.user.organizationId,
        archivedAt: null,
      },
      assets: { some: { kind: "MULTI_VIEW" } },
    },
    orderBy: { completedAt: "desc" },
    take: 50,
    include: {
      tour: { select: { id: true, title: true } },
      _count: { select: { assets: { where: { kind: "MULTI_VIEW" } } } },
    },
  });

  return NextResponse.json({
    captureSessions: captureSessions.map((capture) => ({
      id: capture.id,
      roomName: capture.roomName,
      frameCount: capture._count.assets,
      completedAt: capture.completedAt,
      sourceTour: capture.tour,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let copiedKeys: string[] = [];
  let importedSessionId: string | null = null;
  try {
    const body = importSchema.parse(await req.json());
    const [destination, source, organization] = await Promise.all([
      prisma.tour.findFirst({
        where: { id, organizationId: session.user.organizationId, archivedAt: null },
        select: { id: true },
      }),
      prisma.captureSession.findFirst({
        where: {
          id: body.sourceCaptureSessionId,
          status: "READY",
          tour: { organizationId: session.user.organizationId },
        },
        include: {
          assets: {
            where: { kind: { in: ["MULTI_VIEW", "OTHER"] } },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      }),
      prisma.organization.findUnique({
        where: { id: session.user.organizationId },
        include: { subscription: { include: { plan: true } } },
      }),
    ]);

    if (!destination) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!source || source.assets.length < 8) {
      return NextResponse.json(
        { error: "The source room scan is unavailable or incomplete" },
        { status: 404 },
      );
    }
    if (source.tourId === id) {
      return NextResponse.json({ error: "This room is already in the listing" }, { status: 409 });
    }

    const importedBytes = source.assets.reduce(
      (total, asset) => total + asset.sizeBytes,
      BigInt(0),
    );
    const storageLimit = organization?.subscription?.plan.maxStorageBytes ?? BigInt(0);
    if (!organization || organization.storageUsedBytes + importedBytes > storageLimit) {
      return NextResponse.json({ error: "Storage quota exceeded" }, { status: 402 });
    }

    const importedSession = await prisma.captureSession.create({
      data: {
        tourId: id,
        createdById: session.user.id,
        roomName: source.roomName,
        mode: source.mode,
        status: "UPLOADING",
        frameCount: 0,
        targetFrameCount: source.targetFrameCount,
        deviceInfo: {
          importedFromCaptureSessionId: source.id,
          importedFromTourId: source.tourId,
        },
        qualitySummary: source.qualitySummary ?? undefined,
        startedAt: new Date(),
      },
    });
    importedSessionId = importedSession.id;

    const copiedAssets: Array<{
      source: (typeof source.assets)[number];
      storageKey: string;
    }> = [];
    for (const asset of source.assets) {
      const safeName = asset.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageKey = `private/orgs/${session.user.organizationId}/tours/${id}/imports/${importedSession.id}/${randomUUID()}-${safeName}`;
      await copyStoredObject(asset.storageKey, storageKey);
      copiedKeys.push(storageKey);
      copiedAssets.push({ source: asset, storageKey });
    }

    const completed = await prisma.$transaction(async (tx) => {
      for (const copied of copiedAssets) {
        await tx.tourAsset.create({
          data: {
            tourId: id,
            captureSessionId: importedSession.id,
            kind: copied.source.kind,
            filename: copied.source.filename,
            contentType: copied.source.contentType,
            sizeBytes: copied.source.sizeBytes,
            storageKey: copied.storageKey,
            publicUrl: null,
            sortOrder: copied.source.sortOrder,
            meta: {
              ...(copied.source.meta && typeof copied.source.meta === "object"
                ? (copied.source.meta as Record<string, unknown>)
                : {}),
              importedFromAssetId: copied.source.id,
            } as Prisma.InputJsonValue,
          },
        });
      }
      await tx.organization.update({
        where: { id: session.user.organizationId },
        data: { storageUsedBytes: { increment: importedBytes } },
      });
      return tx.captureSession.update({
        where: { id: importedSession.id },
        data: {
          status: "READY",
          frameCount: copiedAssets.length,
          completedAt: new Date(),
        },
      });
    });

    return NextResponse.json({ captureSession: completed }, { status: 201 });
  } catch (error) {
    await deleteStoredObjects(copiedKeys).catch(() => undefined);
    if (importedSessionId) {
      await prisma.captureSession.delete({ where: { id: importedSessionId } }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Could not import room scan";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
