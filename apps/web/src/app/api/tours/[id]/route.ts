import { updateTourSchema } from "@housetour/api-contract";
import { prisma } from "@housetour/db";
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
    include: {
      assets: true,
      scenes: { include: { hotspots: true }, orderBy: { sortOrder: "asc" } },
      floors: true,
      jobs: { orderBy: { createdAt: "desc" }, take: 10 },
      property: true,
    },
  });

  if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ tour });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    const body = updateTourSchema.parse(await req.json());
    const existing = await prisma.tour.findFirst({
      where: { id, organizationId: session.user.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (body.published === true && existing.status !== "READY") {
      return NextResponse.json(
        { error: "Only READY tours can be published. Process the tour first." },
        { status: 400 },
      );
    }

    const tour = await prisma.tour.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        published: body.published,
        allowVr: body.allowVr,
        allowEmbed: body.allowEmbed,
        showFloorPlan: body.showFloorPlan,
        startSceneId: body.startSceneId,
      },
    });

    return NextResponse.json({ tour });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
