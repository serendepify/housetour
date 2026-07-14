import { buildTourManifest } from "@/lib/manifest";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const manifest = await buildTourManifest(slug);
  if (!manifest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
