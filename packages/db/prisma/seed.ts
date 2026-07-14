import { hash } from "bcryptjs";
import { createPrismaClient, loadEnv } from "../src/index";

loadEnv();

const prisma = createPrismaClient();

async function main() {
  const plans = [
    {
      code: "starter",
      name: "Starter",
      description: "Solo agents launching branded virtual tours",
      priceMonthly: "49.00",
      maxActiveTours: 5,
      maxStorageBytes: BigInt(10 * 1024 ** 3),
      maxSeats: 2,
      allowBranding: false,
      allowApi: false,
      allowPhotogrammetry: false,
      processingMinutesIncluded: 30,
      sortOrder: 1,
    },
    {
      code: "pro",
      name: "Pro",
      description: "Boutique agencies with branding, VR, and photogrammetry",
      priceMonthly: "149.00",
      maxActiveTours: 50,
      maxStorageBytes: BigInt(100 * 1024 ** 3),
      maxSeats: 10,
      allowBranding: true,
      allowApi: false,
      allowPhotogrammetry: true,
      processingMinutesIncluded: 300,
      sortOrder: 2,
    },
    {
      code: "studio",
      name: "Studio",
      description: "Photo teams and brokerages at scale",
      priceMonthly: "399.00",
      maxActiveTours: 250,
      maxStorageBytes: BigInt(500 * 1024 ** 3),
      maxSeats: 50,
      allowBranding: true,
      allowApi: true,
      allowPhotogrammetry: true,
      processingMinutesIncluded: 2000,
      sortOrder: 3,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: plan,
      update: {
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        maxActiveTours: plan.maxActiveTours,
        maxStorageBytes: plan.maxStorageBytes,
        maxSeats: plan.maxSeats,
        allowBranding: plan.allowBranding,
        allowApi: plan.allowApi,
        allowPhotogrammetry: plan.allowPhotogrammetry,
        processingMinutesIncluded: plan.processingMinutesIncluded,
        sortOrder: plan.sortOrder,
      },
    });
  }

  const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: "pro" } });

  const email = process.env.DEMO_EMAIL ?? "agent@housetour.demo";
  const password = process.env.DEMO_PASSWORD ?? "housetour-demo";
  const passwordHash = await hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Avery Chen",
      passwordHash,
    },
    update: {
      name: "Avery Chen",
      passwordHash,
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "serene-homes" },
    create: {
      name: "Serene Homes Realty",
      slug: "serene-homes",
      primaryColor: "#C4A35A",
      ctaLabel: "Book a private showing",
      ctaUrl: "https://example.com/contact",
      logoUrl: null,
    },
    update: {
      name: "Serene Homes Realty",
      primaryColor: "#C4A35A",
      ctaLabel: "Book a private showing",
      ctaUrl: "https://example.com/contact",
    },
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    create: {
      organizationId: org.id,
      userId: user.id,
      role: "OWNER",
    },
    update: { role: "OWNER" },
  });

  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      planId: proPlan.id,
      status: "active",
    },
    update: {
      planId: proPlan.id,
      status: "active",
    },
  });

  const property = await prisma.property.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: org.id,
      title: "Harbor Loft — Unit 4B",
      addressLine1: "128 Pier Avenue",
      city: "Seattle",
      region: "WA",
      postalCode: "98101",
      country: "US",
      bedrooms: 2,
      bathrooms: "2.0",
      sqft: 1480,
      listPrice: "1245000.00",
    },
    update: {
      title: "Harbor Loft — Unit 4B",
      listPrice: "1245000.00",
    },
  });

  // Wipe and recreate demo tour graph for idempotent seed
  const existing = await prisma.tour.findFirst({
    where: { organizationId: org.id, slug: "demo-loft" },
  });
  if (existing) {
    await prisma.tour.delete({ where: { id: existing.id } });
  }

  const tour = await prisma.tour.create({
    data: {
      organizationId: org.id,
      propertyId: property.id,
      createdById: user.id,
      title: "Harbor Loft — Walkable 3D Tour",
      description:
        "A walkable 360° tour through five stunning European interiors — from a Portuguese library's marble hall to a Berlin courthouse's grand atrium. Real equirectangular photography. Drag to look, click hotspots to walk between viewpoints.",
      slug: "demo-loft",
      status: "READY",
      published: true,
      allowVr: true,
      allowEmbed: true,
      showFloorPlan: true,
      coverUrl: "/demo/cover.jpg",
      viewCount: 128,
    },
  });

  const floor = await prisma.floor.create({
    data: {
      tourId: tour.id,
      name: "Main Level",
      sortOrder: 0,
      planImageUrl: "/demo/floorplan.svg",
      metersPerPixel: 0.02,
    },
  });

  const sceneDefs = [
    {
      key: "entry",
      name: "Marble Entrance Hall",
      sortOrder: 0,
      mediaUrl: "/demo/panos/entry.jpg",
      posX: 0.2,
      posY: 0,
      posZ: 0.5,
      initialYaw: 0,
    },
    {
      key: "living",
      name: "Library Exhibition Room",
      sortOrder: 1,
      mediaUrl: "/demo/panos/living.jpg",
      posX: 0.45,
      posY: 0,
      posZ: 0.45,
      initialYaw: 0.4,
    },
    {
      key: "kitchen",
      name: "Grand Courthouse Atrium",
      sortOrder: 2,
      mediaUrl: "/demo/panos/kitchen.jpg",
      posX: 0.7,
      posY: 0,
      posZ: 0.4,
      initialYaw: -0.3,
    },
    {
      key: "bedroom",
      name: "Cathedral Sanctuary",
      sortOrder: 3,
      mediaUrl: "/demo/panos/bedroom.jpg",
      posX: 0.25,
      posY: 0,
      posZ: 0.2,
      initialYaw: 0.1,
    },
    {
      key: "terrace",
      name: "Historic Chapel Nave",
      sortOrder: 4,
      mediaUrl: "/demo/panos/terrace.jpg",
      posX: 0.85,
      posY: 0,
      posZ: 0.25,
      initialYaw: -0.8,
    },
  ] as const;

  const scenes: Record<string, { id: string }> = {};
  for (const s of sceneDefs) {
    const created = await prisma.tourScene.create({
      data: {
        tourId: tour.id,
        floorId: floor.id,
        name: s.name,
        kind: "PANO",
        sortOrder: s.sortOrder,
        mediaUrl: s.mediaUrl,
        posterUrl: s.mediaUrl,
        posX: s.posX,
        posY: s.posY,
        posZ: s.posZ,
        initialYaw: s.initialYaw,
      },
    });
    scenes[s.key] = created;
  }

  await prisma.tour.update({
    where: { id: tour.id },
    data: { startSceneId: scenes.entry.id },
  });

  const edges: Array<[string, string, number, number, string]> = [
    ["entry", "living", 0.1, -0.05, "Exhibition Room"],
    ["living", "entry", 3.2, -0.05, "Entrance Hall"],
    ["living", "kitchen", 0.9, -0.05, "Courthouse Atrium"],
    ["kitchen", "living", 4.0, -0.05, "Exhibition Room"],
    ["kitchen", "bedroom", 1.8, -0.05, "Cathedral"],
    ["bedroom", "kitchen", 0.2, -0.05, "Courthouse"],
    ["bedroom", "terrace", 2.5, -0.05, "Chapel Nave"],
    ["terrace", "bedroom", 5.5, -0.05, "Cathedral"],
  ];

  for (const [from, to, yaw, pitch, label] of edges) {
    await prisma.hotspot.create({
      data: {
        fromSceneId: scenes[from].id,
        targetSceneId: scenes[to].id,
        yaw,
        pitch,
        label,
      },
    });
  }

  // Register demo assets as logical records (files served from public/)
  const panoOrder = sceneDefs.map((s, i) => ({
    kind: "PANO" as const,
    filename: `${s.key}.jpg`,
    contentType: "image/jpeg",
    storageKey: `demo/panos/${s.key}.jpg`,
    publicUrl: s.mediaUrl,
    sortOrder: i,
  }));

  for (const a of [
    ...panoOrder,
    {
      kind: "FLOOR_PLAN" as const,
      filename: "floorplan.svg",
      contentType: "image/svg+xml",
      storageKey: "demo/floorplan.svg",
      publicUrl: "/demo/floorplan.svg",
      sortOrder: 0,
    },
    {
      kind: "COVER" as const,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      storageKey: "demo/cover.jpg",
      publicUrl: "/demo/cover.jpg",
      sortOrder: 0,
    },
  ]) {
    await prisma.tourAsset.create({
      data: {
        tourId: tour.id,
        kind: a.kind,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: BigInt(250_000),
        storageKey: a.storageKey,
        publicUrl: a.publicUrl,
        sortOrder: a.sortOrder,
      },
    });
  }

  console.log("Seed complete");
  console.log(`  Demo login: ${email} / ${password}`);
  console.log(`  Public tour: /t/demo-loft`);
  console.log(`  Org: ${org.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
