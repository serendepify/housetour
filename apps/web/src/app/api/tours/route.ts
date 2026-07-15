import { createTourSchema } from "@housetour/api-contract";
import { prisma } from "@housetour/db";
import { slugify } from "@housetour/tour-engine";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tours = await prisma.tour.findMany({
    where: { organizationId: session.user.organizationId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    include: { property: true, _count: { select: { scenes: true, assets: true } } },
  });

  return NextResponse.json({ tours });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = createTourSchema.parse(await req.json());
    const orgId = session.user.organizationId;

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!org?.subscription?.plan) {
      return NextResponse.json({ error: "No active plan" }, { status: 402 });
    }

    const activeCount = await prisma.tour.count({
      where: {
        organizationId: orgId,
        archivedAt: null,
        status: { not: "ARCHIVED" },
      },
    });
    if (activeCount >= org.subscription.plan.maxActiveTours) {
      return NextResponse.json(
        { error: "Tour quota reached for your plan. Upgrade in Billing." },
        { status: 402 },
      );
    }

    let base = slugify(body.title) || "tour";
    let slug = base;
    let n = 1;
    while (
      await prisma.tour.findFirst({
        where: { organizationId: orgId, slug },
      })
    ) {
      slug = `${base}-${n++}`;
    }

    const tour = await prisma.$transaction(async (tx) => {
      let propertyId: string | undefined;
      if (body.propertyTitle || body.addressLine1 || body.city) {
        const property = await tx.property.create({
          data: {
            organizationId: orgId,
            title: body.propertyTitle ?? body.title,
            listingType: body.listingType,
            currency: body.currency.toUpperCase(),
            addressLine1: body.addressLine1,
            city: body.city,
            region: body.region,
            postalCode: body.postalCode,
            country: body.country,
            bedrooms: body.bedrooms,
            bathrooms: body.bathrooms,
            sqft: body.sqft,
            listPrice: body.listPrice,
          },
        });
        propertyId = property.id;
      }

      return tx.tour.create({
        data: {
          organizationId: orgId,
          propertyId,
          createdById: session.user.id,
          title: body.title,
          description: body.description,
          slug,
          status: "DRAFT",
        },
      });
    });

    return NextResponse.json({ tour }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
