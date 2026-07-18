import { prisma } from "./src/index.ts";

const tourId = "63584f2a-2742-413f-b109-ef2f91303cf8";
const sessionId = "94c7bf75-d680-40c4-ae57-94658a7e69d5";
const floorId = "6dbd8b81-e58e-4303-8997-df63e284ac19";
const mediaKey =
  "public/orgs/8251166b-0d95-4ddb-99b0-632ae0898a0e/tours/63584f2a-2742-413f-b109-ef2f91303cf8/derived/breku-mesh.glb";
const mediaUrl =
  "/derived/orgs/8251166b-0d95-4ddb-99b0-632ae0898a0e/tours/63584f2a-2742-413f-b109-ef2f91303cf8/derived/breku-mesh.glb";

const asset = await prisma.tourAsset.create({
  data: {
    tourId,
    captureSessionId: sessionId,
    kind: "MESH_GLB",
    filename: "breku-mesh.glb",
    contentType: "model/gltf-binary",
    sizeBytes: 2302688n,
    storageKey: mediaKey,
    publicUrl: mediaUrl,
  },
});
console.log("asset:", asset.id);

await prisma.tourScene.deleteMany({
  where: { tourId, captureSessionId: sessionId, kind: "MESH" },
});
const scene = await prisma.tourScene.create({
  data: {
    tourId,
    captureSessionId: sessionId,
    floorId,
    name: "Breku Room (Reconstructed)",
    kind: "MESH",
    mediaKey,
    mediaUrl,
    posterUrl: "/demo/panos/entry.jpg",
    posX: 0.5,
    posY: 0,
    posZ: 0.5,
    initialYaw: 0,
    initialPitch: 0,
  },
});
console.log("scene:", scene.id, scene.name);

await prisma.captureSession.update({
  where: { id: sessionId },
  data: { status: "READY" },
});

const count = await prisma.tourScene.count({ where: { tourId } });
console.log("total scenes:", count);

await prisma.$disconnect();
