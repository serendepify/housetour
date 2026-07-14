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
export function buildRoomMeshGlb(points: Vec3[], options?: { wallHeight?: number; scale?: number }) {
  const wallHeight = options?.wallHeight ?? 2.6;
  const scale = options?.scale ?? 12;

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

  const posBytes = new Uint8Array(posBuffer.buffer);
  const normBytes = new Uint8Array(normBuffer.buffer);
  const idxBytes = new Uint8Array(indexBuffer.buffer);

  const binParts = [posBytes, normBytes, idxBytes];
  let binLength = 0;
  const aligned: Uint8Array[] = [];
  for (const part of binParts) {
    aligned.push(part);
    binLength += part.byteLength;
    const pad = pad4(part.byteLength);
    if (pad) {
      aligned.push(new Uint8Array(pad));
      binLength += pad;
    }
  }

  let posOffset = 0;
  let normOffset = posBytes.byteLength + pad4(posBytes.byteLength);
  let idxOffset =
    normOffset + normBytes.byteLength + pad4(normBytes.byteLength);

  const gltf = {
    asset: { version: "2.0", generator: "HouseTour Photogrammetry Pipeline" },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, name: "ReconstructedSpace" }],
    meshes: [
      {
        name: "SpaceHull",
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            mode: 4,
          },
        ],
      },
    ],
    accessors: [
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
      {
        bufferView: 1,
        componentType: 5126,
        count: normBuffer.length / 3,
        type: "VEC3",
      },
      {
        bufferView: 2,
        componentType: 5123,
        count: indexBuffer.length,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: normOffset, byteLength: normBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = pad4(json.length);
  const jsonChunkLength = json.length + jsonPad;
  const binChunkLength = binLength + pad4(binLength);

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
  let o = binStart + 8;
  for (const part of aligned) {
    Buffer.from(part).copy(out, o);
    o += part.byteLength;
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
