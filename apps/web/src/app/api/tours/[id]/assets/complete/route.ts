import { completeAssetSchema } from "@housetour/api-contract";
import { Prisma, prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { inspectUploadedObject, publicUrlForKey } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

function serializeAsset<T extends { sizeBytes: bigint }>(asset: T) {
  return { ...asset, sizeBytes: asset.sizeBytes.toString() };
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const body = completeAssetSchema.parse(await req.json());
    const tour = await prisma.tour.findFirst({
      where: { id, organizationId: session.user.organizationId },
    });
    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const expectedSuffix = `orgs/${session.user.organizationId}/tours/${id}/`;
    if (
      !body.storageKey.startsWith(`public/${expectedSuffix}`) &&
      !body.storageKey.startsWith(`private/${expectedSuffix}`) &&
      !body.storageKey.startsWith(expectedSuffix)
    ) {
      return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
    }

    const duplicate = await prisma.tourAsset.findUnique({
      where: { storageKey: body.storageKey },
    });
    if (duplicate) {
      if (duplicate.tourId !== id) {
        return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
      }
      return NextResponse.json({ asset: serializeAsset(duplicate), duplicate: true });
    }

    const captureSession = body.captureSessionId
      ? await prisma.captureSession.findFirst({
          where: { id: body.captureSessionId, tourId: id },
        })
      : null;
    if (body.captureSessionId && !captureSession) {
      return NextResponse.json({ error: "Capture session not found" }, { status: 404 });
    }

    let uploaded: Awaited<ReturnType<typeof inspectUploadedObject>>;
    try {
      uploaded = await inspectUploadedObject(body.storageKey);
    } catch {
      return NextResponse.json(
        { error: "Upload was not found in storage. Retry the file upload." },
        { status: 409 },
      );
    }
    if (uploaded.sizeBytes !== body.sizeBytes) {
      return NextResponse.json(
        { error: "Uploaded file size does not match the reserved asset" },
        { status: 409 },
      );
    }

    const publicUrl = body.storageKey.startsWith("private/")
      ? null
      : publicUrlForKey(body.storageKey);

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.tourAsset.create({
        data: {
          tourId: id,
          captureSessionId: body.captureSessionId,
          kind: body.kind,
          filename: body.filename,
          contentType: uploaded.contentType || body.contentType,
          sizeBytes: BigInt(uploaded.sizeBytes),
          storageKey: body.storageKey,
          publicUrl,
          sortOrder: body.sortOrder ?? 0,
          meta: {
            ...(body.meta ?? {}),
            ...(body.capturedAt ? { capturedAt: body.capturedAt } : {}),
            ...(uploaded.etag ? { etag: uploaded.etag } : {}),
          } as Prisma.InputJsonValue,
        },
      });
      await tx.organization.update({
        where: { id: session.user.organizationId },
        data: { storageUsedBytes: { increment: BigInt(uploaded.sizeBytes) } },
      });
      if (captureSession) {
        await tx.captureSession.update({
          where: { id: captureSession.id },
          data: {
            status: "UPLOADING",
            frameCount: { increment: 1 },
          },
        });
      }
      return created;
    });

    return NextResponse.json({ asset: serializeAsset(asset) }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
