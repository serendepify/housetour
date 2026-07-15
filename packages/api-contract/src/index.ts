import { z } from "zod";

export const tourManifestSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().nullable(),
  startSceneId: z.string(),
  slug: z.string(),
  property: z
    .object({
      title: z.string(),
      addressLine1: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      region: z.string().optional().nullable(),
      listPrice: z.string().optional().nullable(),
      bedrooms: z.number().optional().nullable(),
      bathrooms: z.string().optional().nullable(),
      sqft: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
  floors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      planUrl: z.string().optional().nullable(),
    }),
  ),
  scenes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      floorId: z.string().optional().nullable(),
      kind: z.enum(["pano", "mesh"]),
      mediaUrl: z.string(),
      posterUrl: z.string().optional().nullable(),
      position: z
        .object({
          x: z.number(),
          y: z.number(),
          z: z.number(),
        })
        .optional()
        .nullable(),
      initialYaw: z.number().optional(),
      initialPitch: z.number().optional(),
      hotspots: z.array(
        z.object({
          id: z.string(),
          targetSceneId: z.string(),
          yaw: z.number(),
          pitch: z.number(),
          label: z.string().optional().nullable(),
        }),
      ),
    }),
  ),
  branding: z
    .object({
      logoUrl: z.string().optional().nullable(),
      primaryColor: z.string().optional().nullable(),
      ctaLabel: z.string().optional().nullable(),
      ctaUrl: z.string().optional().nullable(),
      orgName: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  flags: z.object({
    allowVr: z.boolean(),
    showFloorPlan: z.boolean(),
    allowEmbed: z.boolean(),
  }),
});

export type TourManifest = z.infer<typeof tourManifestSchema>;

export const createTourSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  propertyTitle: z.string().max(200).optional(),
  listingType: z.enum(["SALE", "RENT"]).default("SALE"),
  currency: z.string().trim().length(3).default("USD"),
  addressLine1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().max(100).optional(),
  bedrooms: z.number().int().min(0).max(99).optional(),
  bathrooms: z.number().min(0).max(99).optional(),
  sqft: z.number().int().min(0).max(10_000_000).optional(),
  listPrice: z.number().min(0).max(10_000_000_000).optional(),
});

export type CreateTourInput = z.infer<typeof createTourSchema>;

export const updateTourSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  published: z.boolean().optional(),
  allowVr: z.boolean().optional(),
  allowEmbed: z.boolean().optional(),
  showFloorPlan: z.boolean().optional(),
  startSceneId: z.string().uuid().optional().nullable(),
});

export type UpdateTourInput = z.infer<typeof updateTourSchema>;

export const presignAssetSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/svg+xml",
    "model/gltf-binary",
    "application/octet-stream",
  ]),
  kind: z.enum([
    "PANO",
    "FLOOR_PLAN",
    "MESH_GLB",
    "COVER",
    "MULTI_VIEW",
    "OTHER",
  ]),
  sizeBytes: z.number().int().positive().max(500 * 1024 * 1024),
});

export type PresignAssetInput = z.infer<typeof presignAssetSchema>;

export const completeAssetSchema = z.object({
  storageKey: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  kind: z.enum([
    "PANO",
    "FLOOR_PLAN",
    "MESH_GLB",
    "COVER",
    "MULTI_VIEW",
    "OTHER",
  ]),
  sizeBytes: z.number().int().nonnegative(),
  sortOrder: z.number().int().optional(),
  captureSessionId: z.string().uuid().optional(),
  capturedAt: z.string().datetime().optional(),
  meta: z.record(z.unknown()).optional(),
});

export type CompleteAssetInput = z.infer<typeof completeAssetSchema>;

export const createCaptureSessionSchema = z.object({
  roomName: z.string().trim().min(2).max(80),
  mode: z.enum(["PERSPECTIVE", "PANO_360", "LIDAR"]).default("PERSPECTIVE"),
  targetFrameCount: z.number().int().min(8).max(120).default(18),
  deviceInfo: z.record(z.unknown()).optional(),
});

export type CreateCaptureSessionInput = z.infer<typeof createCaptureSessionSchema>;

export const updateCaptureSessionSchema = z.object({
  status: z.enum(["CAPTURING", "UPLOADING", "READY", "FAILED", "CANCELLED"]),
  qualitySummary: z.record(z.unknown()).optional(),
});

export type UpdateCaptureSessionInput = z.infer<typeof updateCaptureSessionSchema>;

export const createHotspotSchema = z.object({
  fromSceneId: z.string().uuid(),
  targetSceneId: z.string().uuid(),
  yaw: z.number(),
  pitch: z.number().default(0),
  label: z.string().max(80).optional(),
});

export type CreateHotspotInput = z.infer<typeof createHotspotSchema>;

export const analyticsEventSchema = z.object({
  type: z.enum(["VIEW", "SCENE_ENTER", "HOTSPOT_CLICK", "DWELL", "LEAD", "VR_ENTER"]),
  sceneId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
  meta: z.record(z.unknown()).optional(),
});

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  organizationName: z.string().min(2).max(120),
});

export type RegisterInput = z.infer<typeof registerSchema>;
