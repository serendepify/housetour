import { registerSchema } from "@housetour/api-contract";
import { prisma } from "@housetour/db";
import { slugify } from "@housetour/tour-engine";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = registerSchema.parse(await req.json());
    const email = body.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    let baseSlug = slugify(body.organizationName) || "agency";
    let slug = baseSlug;
    let i = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${i++}`;
    }

    const starter = await prisma.plan.findUnique({ where: { code: "starter" } });
    if (!starter) {
      return NextResponse.json(
        { error: "Plans not seeded. Run pnpm db:seed." },
        { status: 500 },
      );
    }

    const passwordHash = await hash(body.password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: body.name,
          passwordHash,
        },
      });
      const org = await tx.organization.create({
        data: {
          name: body.organizationName,
          slug,
        },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: "OWNER",
        },
      });
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: starter.id,
          status: "active",
        },
      });
      return { userId: user.id, organizationId: org.id, slug };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
