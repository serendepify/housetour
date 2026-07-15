/**
 * Minimal glTF 2.0 binary (GLB) builder for room mesh from capture points.
 * Produces a walkable floor + walls hull suitable for mesh mode in the viewer.
 */

export type Vec3 = { x: number; y: number; z: number };

function pad4(n: number) {
  return (4 - (n % 4)) % 4;
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

/**
 * Build a simple extruded floorplan mesh from 2D capture points (normalized 0–1).
 * Points become room centers; we build a floor slab + perimeter walls.
 */
export function buildRoomMeshGlb(
  points: Vec3[],
  options?: { wallHeight?: number; scale?: number; imagePanels?: Buffer[] },
) {
  const wallHeight = options?.wallHeight ?? 2.6;
  const scale = options?.scale ?? 12;
  const imagePanels = options?.imagePanels?.slice(0, 12) ?? [];

  if (points.length === 0) {
    points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
    ];
  }

  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs) - 0.08;
  const maxX = Math.max(...xs) + 0.08;
  const minZ = Math.min(...zs) - 0.08;
  const maxZ = Math.max(...zs) + 0.08;

  // Floor corners in world space (Y-up)
  const corners: Vec3[] = [
    { x: (minX - 0.5) * scale, y: 0, z: (minZ - 0.5) * scale },
    { x: (maxX - 0.5) * scale, y: 0, z: (minZ - 0.5) * scale },
    { x: (maxX - 0.5) * scale, y: 0, z: (maxZ - 0.5) * scale },
    { x: (minX - 0.5) * scale, y: 0, z: (maxZ - 0.5) * scale },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  function pushVertex(p: Vec3, n: Vec3) {
    positions.push(p.x, p.y, p.z);
    normals.push(n.x, n.y, n.z);
    return positions.length / 3 - 1;
  }

  // Floor (up)
  {
    const n = { x: 0, y: 1, z: 0 };
    const a = pushVertex(corners[0], n);
    const b = pushVertex(corners[1], n);
    const c = pushVertex(corners[2], n);
    const d = pushVertex(corners[3], n);
    indices.push(a, b, c, a, c, d);
  }

  // Ceiling (down-facing from outside, up normal for interior)
  {
    const n = { x: 0, y: -1, z: 0 };
    const top = corners.map((c) => ({ x: c.x, y: wallHeight, z: c.z }));
    const a = pushVertex(top[0], n);
    const b = pushVertex(top[1], n);
    const c = pushVertex(top[2], n);
    const d = pushVertex(top[3], n);
    indices.push(a, c, b, a, d, c);
  }

  // Walls
  const edges = [
    [0, 1, { x: 0, y: 0, z: -1 }],
    [1, 2, { x: 1, y: 0, z: 0 }],
    [2, 3, { x: 0, y: 0, z: 1 }],
    [3, 0, { x: -1, y: 0, z: 0 }],
  ] as const;

  for (const [i0, i1, n] of edges) {
    const bl = corners[i0];
    const br = corners[i1];
    const tl = { x: bl.x, y: wallHeight, z: bl.z };
    const tr = { x: br.x, y: wallHeight, z: br.z };
    const a = pushVertex(bl, n);
    const b = pushVertex(br, n);
    const c = pushVertex(tr, n);
    const d = pushVertex(tl, n);
    indices.push(a, b, c, a, c, d);
  }

  // Capture marker discs (small platforms) for each point
  for (const p of points) {
    const cx = (p.x - 0.5) * scale;
    const cz = (p.z - 0.5) * scale;
    const r = 0.35;
    const n = { x: 0, y: 1, z: 0 };
    const center = pushVertex({ x: cx, y: 0.02, z: cz }, n);
    const ring: number[] = [];
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      ring.push(
        pushVertex(
          { x: cx + Math.cos(a) * r, y: 0.02, z: cz + Math.sin(a) * r },
          n,
        ),
      );
    }
    for (let i = 0; i < segs; i++) {
      indices.push(center, ring[i], ring[(i + 1) % segs]);
    }
  }

  const posBuffer = new Float32Array(positions);
  const normBuffer = new Float32Array(normals);
  const indexBuffer = new Uint16Array(indices);
  const planePositionBuffer = new Float32Array([
    -1.6, -0.9, 0,
    1.6, -0.9, 0,
    1.6, 0.9, 0,
    -1.6, 0.9, 0,
  ]);
  const planeNormalBuffer = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const planeUvBuffer = new Float32Array([
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ]);
  const planeIndexBuffer = new Uint16Array([0, 1, 2, 0, 2, 3]);

  type Part = { bytes: Uint8Array; offset: number; length: number };
  const parts: Part[] = [];
  let binLength = 0;
  function addPart(bytes: Uint8Array) {
    const part = { bytes, offset: binLength, length: bytes.byteLength };
    parts.push(part);
    binLength += bytes.byteLength + pad4(bytes.byteLength);
    return part;
  }

  const posPart = addPart(new Uint8Array(posBuffer.buffer));
  const normPart = addPart(new Uint8Array(normBuffer.buffer));
  const indexPart = addPart(new Uint8Array(indexBuffer.buffer));
  const planePositionPart = imagePanels.length
    ? addPart(new Uint8Array(planePositionBuffer.buffer))
    : null;
  const planeNormalPart = imagePanels.length
    ? addPart(new Uint8Array(planeNormalBuffer.buffer))
    : null;
  const planeUvPart = imagePanels.length
    ? addPart(new Uint8Array(planeUvBuffer.buffer))
    : null;
  const planeIndexPart = imagePanels.length
    ? addPart(new Uint8Array(planeIndexBuffer.buffer))
    : null;
  const imageParts = imagePanels.map((image) => addPart(new Uint8Array(image)));

  const bufferViews: Array<Record<string, number>> = [
    { buffer: 0, byteOffset: posPart.offset, byteLength: posPart.length, target: 34962 },
    { buffer: 0, byteOffset: normPart.offset, byteLength: normPart.length, target: 34962 },
    { buffer: 0, byteOffset: indexPart.offset, byteLength: indexPart.length, target: 34963 },
  ];
  if (planePositionPart && planeNormalPart && planeUvPart && planeIndexPart) {
    bufferViews.push(
      { buffer: 0, byteOffset: planePositionPart.offset, byteLength: planePositionPart.length, target: 34962 },
      { buffer: 0, byteOffset: planeNormalPart.offset, byteLength: planeNormalPart.length, target: 34962 },
      { buffer: 0, byteOffset: planeUvPart.offset, byteLength: planeUvPart.length, target: 34962 },
      { buffer: 0, byteOffset: planeIndexPart.offset, byteLength: planeIndexPart.length, target: 34963 },
    );
  }
  const firstImageBufferView = bufferViews.length;
  for (const imagePart of imageParts) {
    bufferViews.push({
      buffer: 0,
      byteOffset: imagePart.offset,
      byteLength: imagePart.length,
    });
  }

  const accessors: Array<Record<string, unknown>> = [
    {
      bufferView: 0,
      componentType: 5126,
      count: posBuffer.length / 3,
      type: "VEC3",
      max: [
        Math.max(...positions.filter((_, i) => i % 3 === 0)),
        Math.max(...positions.filter((_, i) => i % 3 === 1)),
        Math.max(...positions.filter((_, i) => i % 3 === 2)),
      ],
      min: [
        Math.min(...positions.filter((_, i) => i % 3 === 0)),
        Math.min(...positions.filter((_, i) => i % 3 === 1)),
        Math.min(...positions.filter((_, i) => i % 3 === 2)),
      ],
    },
    { bufferView: 1, componentType: 5126, count: normBuffer.length / 3, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: indexBuffer.length, type: "SCALAR" },
  ];
  if (imagePanels.length) {
    accessors.push(
      {
        bufferView: 3,
        componentType: 5126,
        count: 4,
        type: "VEC3",
        min: [-1.6, -0.9, 0],
        max: [1.6, 0.9, 0],
      },
      { bufferView: 4, componentType: 5126, count: 4, type: "VEC3" },
      {
        bufferView: 5,
        componentType: 5126,
        count: 4,
        type: "VEC2",
        min: [0, 0],
        max: [1, 1],
      },
      { bufferView: 6, componentType: 5123, count: 6, type: "SCALAR" },
    );
  }

  const materials: Array<Record<string, unknown>> = [
    {
      name: "NavigationProxy",
      pbrMetallicRoughness: {
        baseColorFactor: [0.12, 0.16, 0.15, 1],
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
      doubleSided: true,
    },
  ];
  const meshes: Array<Record<string, unknown>> = [
    {
      name: "SpaceHull",
      primitives: [
        {
          attributes: { POSITION: 0, NORMAL: 1 },
          indices: 2,
          material: 0,
          mode: 4,
        },
      ],
    },
  ];
  const nodes: Array<Record<string, unknown>> = imagePanels.length
    ? []
    : [{ mesh: 0, name: "NavigationProxy" }];
  const images = imagePanels.map((_, index) => ({
    bufferView: firstImageBufferView + index,
    mimeType: "image/jpeg",
    name: `CaptureFrame${String(index + 1).padStart(2, "0")}`,
  }));
  const textures = imagePanels.map((_, index) => ({ sampler: 0, source: index }));

  for (let index = 0; index < imagePanels.length; index++) {
    materials.push({
      name: `CaptureMaterial${String(index + 1).padStart(2, "0")}`,
      pbrMetallicRoughness: {
        baseColorTexture: { index },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
      extensions: { KHR_materials_unlit: {} },
    });
    meshes.push({
      name: `CapturePanel${String(index + 1).padStart(2, "0")}`,
      primitives: [
        {
          attributes: { POSITION: 3, NORMAL: 4, TEXCOORD_0: 5 },
          indices: 6,
          material: index + 1,
          mode: 4,
        },
      ],
    });
    const angle = (index / imagePanels.length) * Math.PI * 2;
    const yaw = angle + Math.PI;
    nodes.push({
      mesh: index + 1,
      name: `CaptureView${String(index + 1).padStart(2, "0")}`,
      translation: [Math.sin(angle) * 4.2, 1.55, Math.cos(angle) * 4.2],
      rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    });
  }

  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "HouseTour Capture Preview Pipeline" },
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    scene: 0,
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  if (imagePanels.length) {
    gltf.images = images;
    gltf.textures = textures;
    gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    gltf.extensionsUsed = ["KHR_materials_unlit"];
  }

  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = pad4(json.length);
  const jsonChunkLength = json.length + jsonPad;
  const binChunkLength = binLength;

  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
  const out = Buffer.alloc(totalLength);
  // header
  out.writeUInt32LE(0x46546c67, 0); // glTF
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLength, 8);
  // JSON chunk
  out.writeUInt32LE(jsonChunkLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16); // JSON
  json.copy(out, 20);
  for (let i = 0; i < jsonPad; i++) out[20 + json.length + i] = 0x20;
  // BIN chunk
  const binStart = 20 + jsonChunkLength;
  out.writeUInt32LE(binChunkLength, binStart);
  out.writeUInt32LE(0x004e4942, binStart + 4); // BIN
  for (const part of parts) {
    Buffer.from(part.bytes).copy(out, binStart + 8 + part.offset);
  }

  return out;
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
