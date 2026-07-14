import { analyticsEventSchema } from "@housetour/api-contract";
import { prisma } from "@housetour/db";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const body = analyticsEventSchema.parse(await req.json());
    const tour = await prisma.tour.findFirst({
      where: { slug, published: true },
      select: { id: true },
    });
    if (!tour) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.analyticsEvent.create({
      data: {
        tourId: tour.id,
        type: body.type,
        sceneId: body.sceneId,
        sessionId: body.sessionId,
        meta: body.meta as object | undefined,
        userAgent: req.headers.get("user-agent"),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
