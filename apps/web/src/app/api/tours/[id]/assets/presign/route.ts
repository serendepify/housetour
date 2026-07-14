import { presignAssetSchema } from "@housetour/api-contract";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { presignPut, publicUrlForKey } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const body = presignAssetSchema.parse(await req.json());
    const tour = await prisma.tour.findFirst({
      where: { id, organizationId: session.user.organizationId },
    });
    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const org = await prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      include: { subscription: { include: { plan: true } } },
    });
    const limit = org?.subscription?.plan.maxStorageBytes ?? BigInt(0);
    if (org && org.storageUsedBytes + BigInt(body.sizeBytes) > limit) {
      return NextResponse.json({ error: "Storage quota exceeded" }, { status: 402 });
    }

    const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `orgs/${session.user.organizationId}/tours/${id}/${body.kind.toLowerCase()}/${randomUUID()}-${safeName}`;

    const uploadUrl = await presignPut({
      key: storageKey,
      contentType: body.contentType,
    });

    return NextResponse.json({
      uploadUrl,
      storageKey,
      publicUrl: publicUrlForKey(storageKey),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
