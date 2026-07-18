import { TourStudio } from "@/components/app/TourStudio";
import { authOptions } from "@/lib/auth";
import { buildTourManifestById } from "@/lib/manifest";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ capture?: string }>;
};

function extractStages(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const stages = (result as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return null;
  return stages as Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "succeeded" | "failed" | "skipped";
    detail?: string;
  }>;
}

export default async function TourStudioPage({ params, searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) redirect("/login");
  const { id } = await params;
  const query = await searchParams;

  const [tour, org] = await Promise.all([
    prisma.tour.findFirst({
      where: {
        id,
        organizationId: session.user.organizationId,
        archivedAt: null,
      },
      include: {
        assets: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
        scenes: {
          orderBy: { sortOrder: "asc" },
          include: { hotspots: true },
        },
        floors: true,
        captureSessions: { orderBy: { createdAt: "desc" }, take: 12 },
        jobs: { orderBy: { createdAt: "desc" }, take: 8 },
        property: true,
      },
    }),
    prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      include: { subscription: { include: { plan: true } } },
    }),
  ]);

  if (!tour) notFound();

  const manifest =
    tour.scenes.length > 0
      ? await buildTourManifestById(tour.id, session.user.organizationId)
      : null;

  // Always enable photogrammetry — MESH is the only reconstruction mode.

  return (
    <TourStudio
      tour={{
        id: tour.id,
        title: tour.title,
        description: tour.description,
        slug: tour.slug,
        status: tour.status,
        published: tour.published,
        allowVr: tour.allowVr,
        allowEmbed: tour.allowEmbed,
        showFloorPlan: tour.showFloorPlan,
        failureReason: tour.failureReason,
        startSceneId: tour.startSceneId,
        viewCount: tour.viewCount,
        property: tour.property
          ? {
              title: tour.property.title,
              status: tour.property.status,
              listingType: tour.property.listingType,
              currency: tour.property.currency,
              addressLine1: tour.property.addressLine1,
              city: tour.property.city,
              region: tour.property.region,
              bedrooms: tour.property.bedrooms,
              bathrooms: tour.property.bathrooms?.toString() ?? null,
              sqft: tour.property.sqft,
              listPrice: tour.property.listPrice?.toString() ?? null,
            }
          : null,
        assets: tour.assets.map((a) => ({
          id: a.id,
          kind: a.kind,
          filename: a.filename,
          publicUrl: a.publicUrl,
          sizeBytes: a.sizeBytes.toString(),
          sortOrder: a.sortOrder,
        })),
        scenes: tour.scenes.map((s) => ({
          id: s.id,
          captureSessionId: s.captureSessionId,
          name: s.name,
          sortOrder: s.sortOrder,
          mediaUrl: s.mediaUrl,
          kind: s.kind,
          hotspotCount: s.hotspots.length,
        })),
        jobs: tour.jobs.map((j) => ({
          id: j.id,
          captureSessionId: j.captureSessionId,
          type: j.type,
          status: j.status,
          progress: j.progress,
          error: j.error,
          createdAt: j.createdAt.toISOString(),
          stages: extractStages(j.result),
        })),
        captureSessions: tour.captureSessions.map((capture) => ({
          id: capture.id,
          roomName: capture.roomName,
          mode: capture.mode,
          status: capture.status,
          frameCount: capture.frameCount,
          targetFrameCount: capture.targetFrameCount,
          createdAt: capture.createdAt.toISOString(),
        })),
      }}
      manifest={manifest}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}
      autoCapture={query.capture === "1"}
    />
  );
}
