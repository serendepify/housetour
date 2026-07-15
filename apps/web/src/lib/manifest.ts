import type { TourManifest } from "@housetour/api-contract";
import { prisma } from "@housetour/db";

export async function buildTourManifest(slug: string): Promise<TourManifest | null> {
  const tour = await prisma.tour.findFirst({
    where: {
      slug,
      published: true,
      status: { not: "ARCHIVED" },
      archivedAt: null,
      scenes: { some: { mediaUrl: { not: null } } },
    },
    include: {
      organization: true,
      property: true,
      floors: { orderBy: { sortOrder: "asc" } },
      scenes: {
        orderBy: { sortOrder: "asc" },
        include: { hotspots: true },
      },
    },
  });

  if (!tour) return null;

  return {
    id: tour.id,
    title: tour.title,
    description: tour.description,
    startSceneId: tour.startSceneId ?? tour.scenes[0]?.id ?? "",
    slug: tour.slug,
    property: tour.property
      ? {
          title: tour.property.title,
          addressLine1: tour.property.addressLine1,
          city: tour.property.city,
          region: tour.property.region,
          listPrice: tour.property.listPrice?.toString() ?? null,
          bedrooms: tour.property.bedrooms,
          bathrooms: tour.property.bathrooms?.toString() ?? null,
          sqft: tour.property.sqft,
        }
      : null,
    floors: tour.floors.map((f) => ({
      id: f.id,
      name: f.name,
      planUrl: f.planImageUrl,
    })),
    scenes: tour.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      floorId: s.floorId,
      kind: s.kind === "MESH" ? "mesh" : "pano",
      mediaUrl: s.mediaUrl ?? "",
      posterUrl: s.posterUrl,
      position:
        s.posX != null && s.posY != null && s.posZ != null
          ? { x: s.posX, y: s.posY, z: s.posZ }
          : null,
      initialYaw: s.initialYaw,
      initialPitch: s.initialPitch,
      hotspots: s.hotspots.map((h) => ({
        id: h.id,
        targetSceneId: h.targetSceneId,
        yaw: h.yaw,
        pitch: h.pitch,
        label: h.label,
      })),
    })),
    branding: {
      logoUrl: tour.organization.logoUrl,
      primaryColor: tour.organization.primaryColor,
      ctaLabel: tour.organization.ctaLabel,
      ctaUrl: tour.organization.ctaUrl,
      orgName: tour.organization.name,
    },
    flags: {
      allowVr: tour.allowVr,
      showFloorPlan: tour.showFloorPlan,
      allowEmbed: tour.allowEmbed,
    },
  };
}

export async function buildTourManifestById(
  tourId: string,
  organizationId?: string,
): Promise<TourManifest | null> {
  const tour = await prisma.tour.findFirst({
    where: {
      id: tourId,
      ...(organizationId ? { organizationId } : {}),
      archivedAt: null,
    },
    include: {
      organization: true,
      property: true,
      floors: { orderBy: { sortOrder: "asc" } },
      scenes: {
        orderBy: { sortOrder: "asc" },
        include: { hotspots: true },
      },
    },
  });

  if (!tour) return null;

  return {
    id: tour.id,
    title: tour.title,
    description: tour.description,
    startSceneId: tour.startSceneId ?? tour.scenes[0]?.id ?? "",
    slug: tour.slug,
    property: tour.property
      ? {
          title: tour.property.title,
          addressLine1: tour.property.addressLine1,
          city: tour.property.city,
          region: tour.property.region,
          listPrice: tour.property.listPrice?.toString() ?? null,
          bedrooms: tour.property.bedrooms,
          bathrooms: tour.property.bathrooms?.toString() ?? null,
          sqft: tour.property.sqft,
        }
      : null,
    floors: tour.floors.map((f) => ({
      id: f.id,
      name: f.name,
      planUrl: f.planImageUrl,
    })),
    scenes: tour.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      floorId: s.floorId,
      kind: s.kind === "MESH" ? "mesh" : "pano",
      mediaUrl: s.mediaUrl ?? "",
      posterUrl: s.posterUrl,
      position:
        s.posX != null && s.posY != null && s.posZ != null
          ? { x: s.posX, y: s.posY, z: s.posZ }
          : null,
      initialYaw: s.initialYaw,
      initialPitch: s.initialPitch,
      hotspots: s.hotspots.map((h) => ({
        id: h.id,
        targetSceneId: h.targetSceneId,
        yaw: h.yaw,
        pitch: h.pitch,
        label: h.label,
      })),
    })),
    branding: {
      logoUrl: tour.organization.logoUrl,
      primaryColor: tour.organization.primaryColor,
      ctaLabel: tour.organization.ctaLabel,
      ctaUrl: tour.organization.ctaUrl,
      orgName: tour.organization.name,
    },
    flags: {
      allowVr: tour.allowVr,
      showFloorPlan: tour.showFloorPlan,
      allowEmbed: tour.allowEmbed,
    },
  };
}
