/**
 * GLB builder for a navigable 3D room from a capture session.
 *
 * Produces an actual walkable room:
 *  - a textured floor slab
 *  - perimeter walls with the real capture photos mapped onto them, positioned
 *    around the room by each frame's layout yaw (so the photos form the room
 *    surfaces you walk past)
 *  - a ceiling
 *  - a doorway gap in one wall so rooms can connect
 *
 * Mesh names are stable so the viewer can treat "Floor" as walkable and every
 * other mesh as a wall collider (see MeshWalkRoom).
 */

export type Vec3 = { x: number; y: number; z: number };

function pad4(n: number) {
  return (4 - (n % 4)) % 4;
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

type Part = { bytes: Uint8Array; offset: number; length: number };

function buildGlb(json: Record<string, unknown>, bin: Uint8Array): Buffer {
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = pad4(jsonBuf.length);
  const jsonChunkLength = jsonBuf.length + jsonPad;
  const binChunkLength = bin.byteLength;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
  const out = Buffer.alloc(totalLength);
  out.writeUInt32LE(0x46546c67, 0); // glTF
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLength, 8);
  out.writeUInt32LE(jsonChunkLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // JSON
  jsonBuf.copy(out, 20);
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBuf.length + i] = 0x20;
  const binStart = 20 + jsonChunkLength;
  out.writeUInt32LE(binChunkLength, binStart);
  out.writeUInt32LE(0x004e4942, binStart + 4); // BIN
  Buffer.from(bin).copy(out, binStart + 8);
  return out;
}

export function buildRoomMeshGlb(
  points: Vec3[],
  options?: { wallHeight?: number; scale?: number; imagePanels?: Buffer[] },
) {
  const wallHeight = options?.wallHeight ?? 2.6;
  const scale = options?.scale ?? 12;
  const imagePanels = (options?.imagePanels ?? []).slice(0, 24);

  // Use capture layout as the room outline. With <3 points fall back to a box.
  const ring =
    points.length >= 3
      ? points
      : [
          { x: 0.15, y: 0, z: 0.15 },
          { x: 0.85, y: 0, z: 0.15 },
          { x: 0.85, y: 0, z: 0.85 },
          { x: 0.15, y: 0, z: 0.85 },
        ];

  // World-space outline on the floor (Y-up), centred in the room volume.
  const outline = ring.map((p) => ({
    x: (p.x - 0.5) * scale,
    z: (p.z - 0.5) * scale,
  }));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const meshPrimitives: Array<{
    attributes: Record<string, number>;
    indices: number;
    material: number;
    mode: number;
    name: string;
  }> = [];
  const materials: Array<Record<string, unknown>> = [
    // 0: floor
    {
      name: "Floor",
      pbrMetallicRoughness: { baseColorFactor: [0.32, 0.3, 0.28, 1], metallicFactor: 0, roughnessFactor: 0.95 },
      doubleSided: true,
    },
    // 1: ceiling
    {
      name: "Ceiling",
      pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.92, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true,
    },
    // 2: wall (untextured shell behind photo panels)
    {
      name: "Wall",
      pbrMetallicRoughness: { baseColorFactor: [0.18, 0.2, 0.22, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true,
    },
  ];
  const images: Array<{ bufferView: number; mimeType: string; name: string }> = [];
  const textures: Array<{ sampler: number; source: number }> = [];

  let posAccCount = 0;
  let currentMaterial = 2; // start photo materials after index 2

  function pushVertex(p: Vec3, n: Vec3, uv: [number, number] = [0, 0]) {
    positions.push(p.x, p.y, p.z);
    normals.push(n.x, n.y, n.z);
    uvs.push(uv[0], uv[1]);
    return positions.length / 3 - 1;
  }

  // Build each primitive's vertex range explicitly.
  interface Prim {
    material: number;
    name: string;
    startVertex: number;
    vertCount: number;
    startIndex: number;
    indexCount: number;
  }
  const prims: Prim[] = [];

  function addPrim(material: number, name: string, verts: Array<{ p: Vec3; n: Vec3; uv?: [number, number] }>, tris: number[]) {
    const startVertex = positions.length / 3;
    for (const v of verts) pushVertex(v.p, v.n, v.uv ?? [0, 0]);
    const startIndex = indices.length;
    for (const t of tris) indices.push(startVertex + t);
    prims.push({
      material,
      name,
      startVertex,
      vertCount: verts.length,
      startIndex,
      indexCount: tris.length,
    });
  }

  // --- Floor ---
  {
    const n = { x: 0, y: 1, z: 0 };
    const verts = outline.map((c) => ({ p: { x: c.x, y: 0, z: c.z }, n }));
    const tris: number[] = [];
    for (let i = 1; i < verts.length - 1; i++) tris.push(0, i, i + 1);
    addPrim(0, "Floor", verts, tris);
  }

  // --- Ceiling ---
  {
    const n = { x: 0, y: -1, z: 0 };
    const verts = outline.map((c) => ({ p: { x: c.x, y: wallHeight, z: c.z }, n }));
    const tris: number[] = [];
    for (let i = 1; i < verts.length - 1; i++) tris.push(0, i + 1, i);
    addPrim(1, "Ceiling", verts, tris);
  }

  // --- Walls (perimeter) with a doorway gap on the first edge ---
  const segments = outline.length;
  const doorwayEdge = 0; // leave a gap in the first wall segment
  for (let s = 0; s < segments; s++) {
    const a = outline[s];
    const b = outline[(s + 1) % segments];
    const n = { x: -(b.z - a.z), y: 0, z: b.x - a.x };
    const len = Math.hypot(n.x, n.z) || 1;
    n.x /= len; n.z /= len;

    const bl = { x: a.x, y: 0, z: a.z };
    const br = { x: b.x, y: 0, z: b.z };
    const tl = { x: a.x, y: wallHeight, z: a.z };
    const tr = { x: b.x, y: wallHeight, z: b.z };

    if (s === doorwayEdge) {
      // Doorway: two short wall stubs leaving a central opening ~1.1m wide.
      const dx = (br.x - bl.x) / len;
      const dz = (br.z - bl.z) / len;
      const open = 1.1; // metres
      const stub = (len - open) / 2;
      const doorTop = Math.min(2.05, wallHeight);
      const seg = (t0: number, t1: number) => {
        const p0 = { x: bl.x + dx * t0, y: 0, z: bl.z + dz * t0 };
        const p1 = { x: bl.x + dx * t1, y: 0, z: bl.z + dz * t1 };
        const q0 = { x: p0.x, y: doorTop, z: p0.z };
        const q1 = { x: p1.x, y: doorTop, z: p1.z };
        const verts = [
          { p: p0, n }, { p: p1, n }, { p: q1, n }, { p: q0, n },
        ];
        addPrim(2, "Wall", verts, [0, 1, 2, 0, 2, 3]);
      };
      seg(0, stub);
      seg(stub + open, len);
    } else {
      const verts = [
        { p: bl, n }, { p: br, n }, { p: tr, n }, { p: tl, n },
      ];
      addPrim(2, "Wall", verts, [0, 1, 2, 0, 2, 3]);
    }
  }

  // --- Photo panels on the walls, positioned by each capture's yaw ---
  // Map each image to a point on the perimeter at the capture's layout angle.
  const photoCount = imagePanels.length;
  for (let i = 0; i < photoCount; i++) {
    const pt = ring[i] ?? ring[Math.floor((i / Math.max(photoCount, 1)) * ring.length)];
    const wx = (pt.x - 0.5) * scale;
    const wz = (pt.z - 0.5) * scale;
    // inward normal (toward room centre)
    const cx = 0;
    const cz = 0;
    let nx = cx - wx;
    let nz = cz - wz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const panelW = Math.min(2.4, (2 * Math.PI * Math.hypot(wx, wz)) / Math.max(photoCount, 6) - 0.2);
    const panelH = 1.8;
    const cy = 1.25;
    const ox = -nz; // tangent
    const oz = nx;
    const off = panelW / 2;
    const bl = { x: wx + ox * off, y: cy - panelH / 2, z: wz + oz * off };
    const br = { x: wx - ox * off, y: cy - panelH / 2, z: wz - oz * off };
    const tr = { x: wx - ox * off, y: cy + panelH / 2, z: wz - oz * off };
    const tl = { x: wx + ox * off, y: cy + panelH / 2, z: wz + oz * off };
    const n = { x: nx, y: 0, z: nz };
    const verts = [
      { p: bl, n, uv: [0, 0] as [number, number] },
      { p: br, n, uv: [1, 0] as [number, number] },
      { p: tr, n, uv: [1, 1] as [number, number] },
      { p: tl, n, uv: [0, 1] as [number, number] },
    ];
    addPrim(3 + i, `Photo${String(i + 1).padStart(2, "0")}`, verts, [0, 1, 2, 0, 2, 3]);

    // add a textured material + image/texture for this panel
    materials.push({
      name: `PhotoMaterial${String(i + 1).padStart(2, "0")}`,
      pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true,
    });
    images.push({ bufferView: 0, mimeType: "image/jpeg", name: `CaptureFrame${String(i + 1).padStart(2, "0")}` });
    textures.push({ sampler: 0, source: i });
  }

  // --- Build binary buffers (positions, normals, uvs, indices, images) ---
  const posArr = new Float32Array(positions);
  const normArr = new Float32Array(normals);
  const uvArr = new Float32Array(uvs);
  const idxArr = new Uint32Array(indices);

  const parts: Part[] = [];
  let binLength = 0;
  function addPart(bytes: Uint8Array) {
    const part = { bytes, offset: binLength, length: bytes.byteLength };
    parts.push(part);
    binLength += bytes.byteLength + pad4(bytes.byteLength);
    return part;
  }

  const posPart = addPart(new Uint8Array(posArr.buffer, posArr.byteOffset, posArr.byteLength));
  const normPart = addPart(new Uint8Array(normArr.buffer, normArr.byteOffset, normArr.byteLength));
  const uvPart = addPart(new Uint8Array(uvArr.buffer, uvArr.byteOffset, uvArr.byteLength));
  const idxPart = addPart(new Uint8Array(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength));
  const imageParts = imagePanels.map((img) => addPart(new Uint8Array(img)));

  // Shared bufferViews: POSITION, NORMAL, TEXCOORD_0, INDICES (each primitive
  // references a sub-range of these via its own accessors).
  const bufferViews: Array<Record<string, number>> = [
    { buffer: 0, byteOffset: posPart.offset, byteLength: posPart.length, target: 34962 },
    { buffer: 0, byteOffset: normPart.offset, byteLength: normPart.length, target: 34962 },
    { buffer: 0, byteOffset: uvPart.offset, byteLength: uvPart.length, target: 34962 },
    { buffer: 0, byteOffset: idxPart.offset, byteLength: idxPart.length, target: 34963 },
  ];
  const imgBaseView = bufferViews.length;
  imageParts.forEach((p) => bufferViews.push({ buffer: 0, byteOffset: p.offset, byteLength: p.length }));
  images.forEach((img, i) => (img.bufferView = imgBaseView + i));

  // Accessors: global POSITION/NORMAL/TEXCOORD + one INDICES accessor per primitive.
  const accessors: Array<Record<string, unknown>> = [
    { bufferView: 0, componentType: 5126, count: posArr.length / 3, type: "VEC3", min: [Math.min(...positions.filter((_, i) => i % 3 === 0)), 0, Math.min(...positions.filter((_, i) => i % 3 === 2))], max: [Math.max(...positions.filter((_, i) => i % 3 === 0)), wallHeight, Math.max(...positions.filter((_, i) => i % 3 === 2))] },
    { bufferView: 1, componentType: 5126, count: normArr.length / 3, type: "VEC3" },
    { bufferView: 2, componentType: 5126, count: uvArr.length / 2, type: "VEC2", min: [0, 0], max: [1, 1] },
  ];
  const POS = 0, NORM = 1, UV = 2;
  const indexAccessors: number[] = [];
  for (const prim of prims) {
    indexAccessors.push(accessors.length);
    accessors.push({
      bufferView: 3,
      byteOffset: prim.startIndex * 4,
      componentType: 5125,
      count: prim.indexCount,
      type: "SCALAR",
    });
  }

  // One mesh per primitive so each references its own index accessor.
  const meshes = prims.map((prim, i) => ({
    name: prim.name,
    primitives: [
      {
        attributes: { POSITION: POS, NORMAL: NORM, TEXCOORD_0: UV },
        indices: indexAccessors[i],
        material: prim.material,
        mode: 4,
      },
    ],
  }));

  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "HouseTour Room Builder" },
    scene: 0,
    scenes: [{ nodes: prims.map((_, i) => i) }],
    nodes: prims.map((prim, i) => ({ mesh: i, name: prim.name })),
    meshes,
    materials,
    images,
    textures,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  // Assemble binary blob
  const bin = Buffer.alloc(binLength);
  for (const part of parts) Buffer.from(part.bytes).copy(bin, part.offset);

  return buildGlb(gltf, bin);
}

/** PLY point cloud from capture points + jitter samples for debug export. */
export function buildPointCloudPly(points: Vec3[], samplesPerPoint = 80): string {
  const pts: Vec3[] = [];
  for (const p of points) {
    pts.push(p);
    for (let i = 0; i < samplesPerPoint; i++) {
      pts.push({
        x: p.x + (Math.random() - 0.5) * 0.12,
        y: p.y + Math.random() * 0.4,
        z: p.z + (Math.random() - 0.5) * 0.12,
      });
    }
  }
  const lines = [
    "ply",
    "format ascii 1.0",
    `element vertex ${pts.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    ...pts.map((p) => `${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)}`),
  ];
  return lines.join("\n");
}
