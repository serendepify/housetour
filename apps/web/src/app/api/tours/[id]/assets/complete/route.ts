import { completeAssetSchema } from "@housetour/api-contract";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { publicUrlForKey } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

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

    const expectedPrefix = `orgs/${session.user.organizationId}/tours/${id}/`;
    if (!body.storageKey.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
    }

    const publicUrl = publicUrlForKey(body.storageKey);

    const [asset] = await prisma.$transaction([
      prisma.tourAsset.create({
        data: {
          tourId: id,
          kind: body.kind,
          filename: body.filename,
          contentType: body.contentType,
          sizeBytes: BigInt(body.sizeBytes),
          storageKey: body.storageKey,
          publicUrl,
          sortOrder: body.sortOrder ?? 0,
        },
      }),
      prisma.organization.update({
        where: { id: session.user.organizationId },
        data: { storageUsedBytes: { increment: BigInt(body.sizeBytes) } },
      }),
      prisma.tour.update({
        where: { id },
        data: {
          status: tour.status === "READY" ? "UPLOADING" : "UPLOADING",
        },
      }),
    ]);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
