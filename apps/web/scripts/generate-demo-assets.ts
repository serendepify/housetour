/**
 * Generates photorealistic equirectangular panorama textures, cover, and floor plan
 * under apps/web/public/demo for the Harbor Loft seed tour.
 *
 * Each panorama is a 2:1 (2048x1024) equirectangular projection of a room interior
 * with architectural detail: ceiling, walls, floor, windows, doors, furniture,
 * lighting, and texture — no dummy text overlays.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../public/demo");
const panoDir = join(outDir, "panos");

mkdirSync(panoDir, { recursive: true });

const W = 2048;
const H = 1024;

// ---- color helpers ----
function lerp(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function rgb(r: number, g: number, b: number) {
  return `rgb(${r},${g},${b})`;
}

// Simple seeded hash for per-pixel variation
function hash(x: number, y: number, seed: number) {
  let h = seed + x * 374761393 + y * 668265263;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h & 0xff) / 255;
}

// ---- room definitions ----
interface RoomDef {
  key: string;
  // Colors
  ceilingRgb: [number, number, number];
  wallRgb: [number, number, number];
  floorRgb: [number, number, number];
  accentRgb: [number, number, number];
  // Windows
  windows: Array<{ xPct: number; wPct: number; yPct: number; hPct: number }>;
  // Door archways (vertical rectangles showing next room)
  doorways: Array<{ xPct: number; wPct: number }>;
  // Furniture: SVG strings positioned in equirectangular space
  furnitureSvg: string;
  // Art on walls
  artFrames: Array<{ xPct: number; yPct: number; wPct: number; hPct: number }>;
  // Floor type
  floorType: "wood" | "tile" | "marble";
  // Outdoor scene color (through windows)
  outdoorTop: [number, number, number];
  outdoorBottom: [number, number, number];
}

const rooms: RoomDef[] = [
  {
    key: "entry",
    ceilingRgb: [248, 246, 242],
    wallRgb: [235, 230, 222],
    floorRgb: [80, 60, 45],
    accentRgb: [196, 163, 90],
    windows: [],
    doorways: [
      { xPct: 0.75, wPct: 0.12 },
      { xPct: 0.30, wPct: 0.12 },
    ],
    furnitureSvg: `
      <!-- Console table -->
      <rect x="840" y="440" width="120" height="8" fill="#5a4030" rx="2"/>
      <rect x="850" y="448" width="4" height="60" fill="#5a4030"/>
      <rect x="946" y="448" width="4" height="60" fill="#5a4030"/>
      <!-- Mirror above console -->
      <ellipse cx="900" cy="380" rx="40" ry="55" fill="#d4cfc8" stroke="#8a7a60" stroke-width="3"/>
      <!-- Potted plant -->
      <ellipse cx="700" cy="490" rx="22" ry="30" fill="#4a6b3a" opacity="0.9"/>
      <rect x="695" y="510" width="10" height="18" fill="#6b4a3a" rx="3"/>
      <ellipse cx="700" cy="515" rx="18" ry="8" fill="#5a4030"/>
    `,
    artFrames: [
      { xPct: 0.18, yPct: 0.55, wPct: 0.06, hPct: 0.09 },
      { xPct: 0.58, yPct: 0.55, wPct: 0.06, hPct: 0.09 },
    ],
    floorType: "marble",
    outdoorTop: [150, 190, 220],
    outdoorBottom: [200, 210, 230],
  },
  {
    key: "living",
    ceilingRgb: [250, 248, 244],
    wallRgb: [242, 238, 232],
    floorRgb: [90, 65, 45],
    accentRgb: [180, 140, 100],
    windows: [
      { xPct: 0.25, wPct: 0.14, yPct: 0.38, hPct: 0.28 },
      { xPct: 0.52, wPct: 0.14, yPct: 0.38, hPct: 0.28 },
      { xPct: 0.78, wPct: 0.14, yPct: 0.38, hPct: 0.28 },
    ],
    doorways: [
      { xPct: 0.05, wPct: 0.10 },
    ],
    furnitureSvg: `
      <!-- Sofa -->
      <rect x="150" y="440" width="340" height="55" fill="#7a6b5a" rx="8"/>
      <rect x="140" y="430" width="20" height="70" fill="#8a7b6a" rx="6"/>
      <rect x="480" y="430" width="20" height="70" fill="#8a7b6a" rx="6"/>
      <rect x="155" y="425" width="330" height="18" fill="#9a8b7a" rx="6"/>
      <!-- Throw pillows -->
      <ellipse cx="200" cy="428" rx="18" ry="14" fill="#c4a882"/>
      <ellipse cx="440" cy="428" rx="18" ry="14" fill="#c4a882"/>
      <!-- Coffee table -->
      <rect x="220" y="490" width="200" height="10" fill="#6a5a4a" rx="3"/>
      <rect x="228" y="500" width="6" height="30" fill="#6a5a4a"/>
      <rect x="406" y="500" width="6" height="30" fill="#6a5a4a"/>
      <!-- Rug under coffee table -->
      <ellipse cx="320" cy="510" rx="130" ry="18" fill="#c4b5a0" opacity="0.6"/>
      <!-- Floor lamp -->
      <rect x="530" y="320" width="4" height="180" fill="#4a4a4a"/>
      <ellipse cx="532" cy="318" rx="22" ry="16" fill="#e8dcc8" opacity="0.7"/>
      <!-- TV unit on wall -->
      <rect x="1100" y="380" width="200" height="80" fill="#1a1a1a" rx="4"/>
      <rect x="1096" y="376" width="208" height="4" fill="#3a3a3a"/>
      <rect x="1120" y="462" width="160" height="16" fill="#3a3028" rx="4"/>
      <!-- Bookshelf -->
      <rect x="1450" y="360" width="80" height="140" fill="#5a4a3a" rx="3"/>
      <rect x="1454" y="370" width="72" height="3" fill="#3a2a1a"/>
      <rect x="1454" y="400" width="72" height="3" fill="#3a2a1a"/>
      <rect x="1454" y="430" width="72" height="3" fill="#3a2a1a"/>
      <rect x="1454" y="460" width="72" height="3" fill="#3a2a1a"/>
      <rect x="1460" y="375" width="12" height="23" fill="#c44a3a" opacity="0.4"/>
      <rect x="1476" y="375" width="10" height="23" fill="#4a6a3a" opacity="0.4"/>
      <rect x="1490" y="375" width="14" height="23" fill="#4a5a8a" opacity="0.4"/>
    `,
    artFrames: [
      { xPct: 0.08, yPct: 0.52, wPct: 0.07, hPct: 0.10 },
    ],
    floorType: "wood",
    outdoorTop: [100, 150, 210],
    outdoorBottom: [180, 200, 220],
  },
  {
    key: "kitchen",
    ceilingRgb: [245, 244, 240],
    wallRgb: [238, 235, 230],
    floorRgb: [180, 175, 170],
    accentRgb: [100, 120, 140],
    windows: [
      { xPct: 0.35, wPct: 0.16, yPct: 0.38, hPct: 0.26 },
    ],
    doorways: [
      { xPct: 0.05, wPct: 0.10 },
    ],
    furnitureSvg: `
      <!-- Upper cabinets -->
      <rect x="200" y="310" width="280" height="110" fill="#e8e4dc" rx="2"/>
      <rect x="210" y="320" width="60" height="90" fill="#ddd9d0" stroke="#c0b8a8" stroke-width="1"/>
      <rect x="280" y="320" width="60" height="90" fill="#ddd9d0" stroke="#c0b8a8" stroke-width="1"/>
      <rect x="350" y="320" width="60" height="90" fill="#ddd9d0" stroke="#c0b8a8" stroke-width="1"/>
      <rect x="420" y="320" width="50" height="90" fill="#ddd9d0" stroke="#c0b8a8" stroke-width="1"/>
      <!-- Lower cabinets -->
      <rect x="200" y="425" width="280" height="80" fill="#d8d4cc" rx="2"/>
      <!-- Countertop -->
      <rect x="195" y="420" width="290" height="8" fill="#3a3a3a" rx="2"/>
      <!-- Sink -->
      <ellipse cx="340" cy="424" rx="35" ry="12" fill="#c8c4bc" stroke="#aaa" stroke-width="1"/>
      <!-- Stove/range -->
      <rect x="500" y="425" width="80" height="46" fill="#2a2a2a" rx="4"/>
      <circle cx="520" cy="438" r="8" fill="#444"/>
      <circle cx="540" cy="438" r="8" fill="#444"/>
      <circle cx="560" cy="438" r="8" fill="#444"/>
      <circle cx="520" cy="458" r="8" fill="#444"/>
      <circle cx="540" cy="458" r="8" fill="#444"/>
      <circle cx="560" cy="458" r="8" fill="#444"/>
      <!-- Range hood -->
      <rect x="505" y="360" width="70" height="55" fill="#888" rx="3"/>
      <!-- Island -->
      <rect x="640" y="440" width="180" height="10" fill="#e0dcd4" rx="3"/>
      <rect x="650" y="450" width="10" height="60" fill="#d0ccc4"/>
      <rect x="800" y="450" width="10" height="60" fill="#d0ccc4"/>
      <!-- Bar stools -->
      <rect x="680" y="462" width="4" height="42" fill="#6a5a4a"/>
      <ellipse cx="682" cy="460" rx="14" ry="4" fill="#7a6a5a"/>
      <rect x="760" y="462" width="4" height="42" fill="#6a5a4a"/>
      <ellipse cx="762" cy="460" rx="14" ry="4" fill="#7a6a5a"/>
      <!-- Pendant lights -->
      <ellipse cx="340" cy="280" rx="10" ry="12" fill="#e8e0c0" opacity="0.8"/>
      <rect x="338" y="268" width="4" height="14" fill="#666"/>
      <ellipse cx="730" cy="280" rx="10" ry="12" fill="#e8e0c0" opacity="0.8"/>
      <rect x="728" y="268" width="4" height="14" fill="#666"/>
      <!-- Fruit bowl on counter -->
      <ellipse cx="235" cy="418" rx="18" ry="8" fill="#c4a040"/>
      <circle cx="228" cy="414" r="4" fill="#e05030"/>
      <circle cx="236" cy="412" r="4" fill="#f0a030"/>
      <circle cx="244" cy="414" r="4" fill="#60a030"/>
    `,
    artFrames: [],
    floorType: "tile",
    outdoorTop: [120, 160, 200],
    outdoorBottom: [160, 190, 210],
  },
  {
    key: "dining",
    ceilingRgb: [248, 246, 242],
    wallRgb: [240, 235, 228],
    floorRgb: [85, 60, 42],
    accentRgb: [160, 120, 80],
    windows: [
      { xPct: 0.55, wPct: 0.13, yPct: 0.40, hPct: 0.24 },
    ],
    doorways: [
      { xPct: 0.85, wPct: 0.10 },
    ],
    furnitureSvg: `
      <!-- Dining table -->
      <rect x="280" y="430" width="240" height="14" fill="#6a5040" rx="4"/>
      <rect x="340" y="444" width="8" height="55" fill="#6a5040"/>
      <rect x="452" y="444" width="8" height="55" fill="#6a5040"/>
      <!-- Chairs -->
      <rect x="310" y="448" width="30" height="38" fill="#8a7a6a" rx="4"/>
      <rect x="310" y="440" width="30" height="8" fill="#9a8a7a" rx="3"/>
      <rect x="460" y="448" width="30" height="38" fill="#8a7a6a" rx="4"/>
      <rect x="460" y="440" width="30" height="8" fill="#9a8a7a" rx="3"/>
      <rect x="380" y="460" width="40" height="34" fill="#8a7a6a" rx="4"/>
      <rect x="380" y="452" width="40" height="8" fill="#9a8a7a" rx="3"/>
      <!-- Place settings -->
      <ellipse cx="360" cy="435" rx="16" ry="12" fill="#eee" opacity="0.9"/>
      <ellipse cx="440" cy="435" rx="16" ry="12" fill="#eee" opacity="0.9"/>
      <ellipse cx="400" cy="445" rx="16" ry="12" fill="#eee" opacity="0.9"/>
      <!-- Wine glasses -->
      <circle cx="375" cy="428" r="4" fill="transparent" stroke="#ccc" stroke-width="1"/>
      <rect x="374" y="432" width="2" height="6" fill="#ccc"/>
      <circle cx="425" cy="428" r="4" fill="transparent" stroke="#ccc" stroke-width="1"/>
      <rect x="424" y="432" width="2" height="6" fill="#ccc"/>
      <!-- Chandelier -->
      <ellipse cx="400" cy="290" rx="60" ry="14" fill="#d4c490" opacity="0.5"/>
      <rect x="398" y="270" width="4" height="20" fill="#999"/>
      <!-- Sideboard -->
      <rect x="580" y="410" width="160" height="90" fill="#5a4030" rx="3"/>
      <rect x="585" y="420" width="150" height="3" fill="#4a3020"/>
      <rect x="585" y="455" width="150" height="3" fill="#4a3020"/>
      <!-- Vase on sideboard -->
      <ellipse cx="630" cy="400" rx="14" ry="22" fill="#4a6a8a" opacity="0.7"/>
    `,
    artFrames: [
      { xPct: 0.15, yPct: 0.52, wPct: 0.07, hPct: 0.10 },
    ],
    floorType: "wood",
    outdoorTop: [140, 170, 200],
    outdoorBottom: [170, 190, 210],
  },
  {
    key: "bedroom",
    ceilingRgb: [248, 247, 244],
    wallRgb: [230, 225, 218],
    floorRgb: [75, 55, 40],
    accentRgb: [140, 155, 180],
    windows: [
      { xPct: 0.40, wPct: 0.14, yPct: 0.38, hPct: 0.26 },
    ],
    doorways: [
      { xPct: 0.05, wPct: 0.10 },
    ],
    furnitureSvg: `
      <!-- Bed frame -->
      <rect x="900" y="420" width="260" height="80" fill="#e8e4dc" rx="6"/>
      <rect x="895" y="415" width="270" height="8" fill="#f0ece4" rx="4"/>
      <!-- Headboard -->
      <rect x="900" y="360" width="260" height="58" fill="#d8d4cc" rx="4"/>
      <rect x="908" y="368" width="244" height="42" fill="#e0dcd4" rx="2"/>
      <!-- Pillows -->
      <ellipse cx="950" cy="425" rx="35" ry="18" fill="#f0ede8"/>
      <ellipse cx="1110" cy="425" rx="35" ry="18" fill="#f0ede8"/>
      <ellipse cx="960" cy="428" rx="28" ry="14" fill="#e8e4dc"/>
      <ellipse cx="1100" cy="428" rx="28" ry="14" fill="#e8e4dc"/>
      <!-- Duvet -->
      <rect x="905" y="430" width="250" height="70" fill="#c8c4bc" rx="4"/>
      <rect x="905" y="430" width="250" height="70" fill="none" stroke="#b8b4ac" stroke-width="1"/>
      <!-- Nightstand left -->
      <rect x="870" y="435" width="28" height="65" fill="#5a4030" rx="2"/>
      <rect x="872" y="442" width="24" height="3" fill="#4a3020"/>
      <!-- Lamp on nightstand -->
      <rect x="882" y="405" width="3" height="32" fill="#7a6a5a"/>
      <ellipse cx="884" cy="403" rx="16" ry="12" fill="#e8dcc8" opacity="0.7"/>
      <!-- Nightstand right -->
      <rect x="1162" y="435" width="28" height="65" fill="#5a4030" rx="2"/>
      <rect x="1164" y="442" width="24" height="3" fill="#4a3020"/>
      <!-- Dresser -->
      <rect x="1400" y="400" width="160" height="100" fill="#5a4030" rx="3"/>
      <rect x="1405" y="415" width="150" height="3" fill="#4a3020"/>
      <rect x="1405" y="450" width="150" height="3" fill="#4a3020"/>
      <!-- Mirror above dresser -->
      <ellipse cx="1480" cy="350" rx="40" ry="50" fill="#d4cfc8" stroke="#8a7a60" stroke-width="3"/>
      <!-- Curtains -->
      <rect x="770" y="350" width="30" height="155" fill="#a89880" opacity="0.7" rx="2"/>
      <rect x="1100" y="350" width="30" height="155" fill="#a89880" opacity="0.7" rx="2"/>
    `,
    artFrames: [
      { xPct: 0.12, yPct: 0.52, wPct: 0.07, hPct: 0.10 },
      { xPct: 0.22, yPct: 0.54, wPct: 0.05, hPct: 0.07 },
    ],
    floorType: "wood",
    outdoorTop: [100, 140, 200],
    outdoorBottom: [150, 180, 210],
  },
  {
    key: "terrace",
    ceilingRgb: [140, 170, 210],
    wallRgb: [190, 200, 210],
    floorRgb: [140, 130, 120],
    accentRgb: [180, 160, 130],
    windows: [
      // Open terrace — large "window" is actually open sky
      { xPct: 0.15, wPct: 0.70, yPct: 0.32, hPct: 0.42 },
    ],
    doorways: [],
    furnitureSvg: `
      <!-- Outdoor sofa -->
      <rect x="700" y="445" width="260" height="45" fill="#9a8a70" rx="8"/>
      <rect x="690" y="435" width="18" height="60" fill="#a89880" rx="6"/>
      <rect x="952" y="435" width="18" height="60" fill="#a89880" rx="6"/>
      <rect x="705" y="428" width="250" height="16" fill="#b8a890" rx="6"/>
      <!-- Cushions -->
      <ellipse cx="760" cy="432" rx="16" ry="12" fill="#8a7a60"/>
      <ellipse cx="900" cy="432" rx="16" ry="12" fill="#8a7a60"/>
      <!-- Coffee table -->
      <rect x="770" y="488" width="120" height="8" fill="#7a6a5a" rx="3"/>
      <rect x="778" y="496" width="5" height="20" fill="#7a6a5a"/>
      <rect x="877" y="496" width="5" height="20" fill="#7a6a5a"/>
      <!-- Planters with greenery -->
      <ellipse cx="640" cy="495" rx="30" ry="35" fill="#3a5a2a" opacity="0.9"/>
      <rect x="634" y="520" width="12" height="16" fill="#6a5a4a"/>
      <ellipse cx="1130" cy="490" rx="25" ry="32" fill="#4a6a3a" opacity="0.9"/>
      <rect x="1123" y="515" width="14" height="18" fill="#6a5a4a"/>
      <!-- City skyline silhouette (seen through "windows") -->
      <rect x="100" y="510" width="30" height="70" fill="#3a4a5a" opacity="0.4"/>
      <rect x="140" y="490" width="25" height="90" fill="#4a5a6a" opacity="0.4"/>
      <rect x="175" y="500" width="35" height="80" fill="#3a4a5a" opacity="0.4"/>
      <rect x="220" y="470" width="20" height="110" fill="#5a6a7a" opacity="0.4"/>
      <rect x="310" y="485" width="28" height="95" fill="#3a4a5a" opacity="0.4"/>
      <rect x="480" y="510" width="22" height="70" fill="#4a5a6a" opacity="0.4"/>
      <rect x="510" y="495" width="30" height="85" fill="#3a4a5a" opacity="0.4"/>
      <!-- Railing -->
      <rect x="80" y="550" width="900" height="3" fill="#888" opacity="0.5"/>
      <rect x="80" y="510" width="2" height="43" fill="#888" opacity="0.5"/>
      <rect x="200" y="510" width="2" height="43" fill="#888" opacity="0.5"/>
      <rect x="400" y="510" width="2" height="43" fill="#888" opacity="0.5"/>
      <rect x="600" y="510" width="2" height="43" fill="#888" opacity="0.5"/>
      <rect x="800" y="510" width="2" height="43" fill="#888" opacity="0.5"/>
      <rect x="960" y="510" width="2" height="43" fill="#888" opacity="0.5"/>
    `,
    artFrames: [],
    floorType: "tile",
    outdoorTop: [80, 130, 200],
    outdoorBottom: [140, 170, 210],
  },
];

// ---- build functions ----

function makeBasePano(room: RoomDef): Buffer {
  const raw = Buffer.alloc(W * H * 4); // RGBA
  const seed = room.key.charCodeAt(0) * 137;

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);

    // Ceiling zone: top ~30%
    const ceilingFade = v < 0.28 ? 1 : v < 0.32 ? 1 - (v - 0.28) / 0.04 : 0;
    // Wall zone: ~30-62%
    const wallZone = v >= 0.30 && v <= 0.62 ? 1 : 0;
    // Floor zone: bottom ~38%
    const floorFade = v > 0.62 ? (v - 0.62) / 0.38 : 0;

    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const noise = (hash(x, y, seed) - 0.5) * 14;

      // Base color: blend ceiling → wall → floor
      let r: number, g: number, b: number;
      if (v < 0.30) {
        // Ceiling
        r = room.ceilingRgb[0];
        g = room.ceilingRgb[1];
        b = room.ceilingRgb[2];
        // Subtle shadow at ceiling edges
        const edgeShadow = Math.max(0, 1 - Math.abs(v - 0.15) * 8) * 15;
        r -= edgeShadow;
        g -= edgeShadow;
        b -= edgeShadow;
      } else if (v < 0.32) {
        // Crown molding transition
        const t = (v - 0.30) / 0.02;
        r = lerp(room.ceilingRgb[0], room.wallRgb[0], t);
        g = lerp(room.ceilingRgb[1], room.wallRgb[1], t);
        b = lerp(room.ceilingRgb[2], room.wallRgb[2], t);
        // Crown molding highlight
        r += 12;
        g += 10;
        b += 8;
      } else if (v < 0.62) {
        // Wall
        r = room.wallRgb[0];
        g = room.wallRgb[1];
        b = room.wallRgb[2];
        // Subtle wainscoting line
        if (v > 0.55 && v < 0.57) {
          r -= 8;
          g -= 8;
          b -= 8;
        }
      } else if (v < 0.64) {
        // Baseboard
        const t = (v - 0.62) / 0.02;
        r = lerp(room.wallRgb[0], room.floorRgb[0] * 0.6, t);
        g = lerp(room.wallRgb[1], room.floorRgb[1] * 0.6, t);
        b = lerp(room.wallRgb[2], room.floorRgb[2] * 0.6, t);
      } else {
        // Floor
        r = room.floorRgb[0];
        g = room.floorRgb[1];
        b = room.floorRgb[2];

        if (room.floorType === "wood") {
          // Wood plank pattern
          const plankLine = Math.sin(v * 80) > 0.85 ? 5 : 0;
          const grainNoise = Math.sin(u * 400 + v * 80) * 6;
          r -= plankLine + grainNoise * 0.2;
          g -= plankLine + grainNoise * 0.3;
          b -= plankLine + grainNoise * 0.3;
          // Plank color variation
          if (Math.floor(v * 5) % 3 === 0) {
            r += 4;
            g += 2;
          }
        } else if (room.floorType === "tile") {
          // Tile grid
          const tx = Math.floor(u * 6);
          const ty = Math.floor((v - 0.62) * 8);
          const isGrout =
            Math.abs(u * 6 - tx - 0.5) < 0.03 ||
            Math.abs((v - 0.62) * 8 - ty - 0.5) < 0.04;
          if (isGrout) {
            r -= 25;
            g -= 25;
            b -= 25;
          }
          if ((tx + ty) % 3 === 0) {
            r += 6;
            g += 6;
            b += 6;
          }
        } else {
          // Marble: subtle veining
          const vein = Math.sin(u * 30 + v * 60) * Math.sin(u * 20 - v * 40) * 10;
          r += vein;
          g += vein * 0.9;
          b += vein * 0.8;
        }
      }

      // Apply noise
      r = Math.max(0, Math.min(255, r + noise));
      g = Math.max(0, Math.min(255, g + noise));
      b = Math.max(0, Math.min(255, b + noise));

      const i = (y * W + x) * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }

  return raw;
}

function makeSvgOverlay(room: RoomDef): Buffer {
  const windowRects = room.windows
    .map((w) => {
      const wx = w.xPct * W;
      const wy = w.yPct * H;
      const ww = w.wPct * W;
      const wh = w.hPct * H;
      const [rt, gt, bt] = room.outdoorTop;
      const [rb, gb, bb] = room.outdoorBottom;
      const gradId = `windowGrad_${room.key}`;
      return `
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgb(${rt},${gt},${bt})"/>
            <stop offset="100%" stop-color="rgb(${rb},${gb},${bb})"/>
          </linearGradient>
        </defs>
        <rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="url(#${gradId})" rx="4"/>
        <!-- Window frame -->
        <rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="none" stroke="rgb(220,215,210)" stroke-width="5" rx="4"/>
        <line x1="${wx + ww / 2}" y1="${wy}" x2="${wx + ww / 2}" y2="${wy + wh}" stroke="rgb(220,215,210)" stroke-width="3"/>
        <line x1="${wx}" y1="${wy + wh / 2}" x2="${wx + ww}" y2="${wy + wh / 2}" stroke="rgb(220,215,210)" stroke-width="3"/>
        <!-- Silhouette trees/buildings outside -->
        <circle cx="${wx + ww * 0.3}" cy="${wy + wh * 0.7}" r="${wh * 0.15}" fill="rgb(60,100,60)" opacity="0.6"/>
        <circle cx="${wx + ww * 0.45}" cy="${wy + wh * 0.6}" r="${wh * 0.18}" fill="rgb(50,90,50)" opacity="0.5"/>
        <circle cx="${wx + ww * 0.7}" cy="${wy + wh * 0.72}" r="${wh * 0.13}" fill="rgb(55,95,55)" opacity="0.6"/>
        <!-- Curtains -->
        <rect x="${wx - 4}" y="${wy}" width="18" height="${wh}" fill="rgb(170,160,140)" opacity="0.55" rx="2"/>
        <rect x="${wx + ww - 14}" y="${wy}" width="18" height="${wh}" fill="rgb(170,160,140)" opacity="0.55" rx="2"/>
      `;
    })
    .join("\n");

  const doorwayRects = room.doorways
    .map((d) => {
      const dx = d.xPct * W;
      const dw = d.wPct * W;
      return `
        <!-- Doorway arch -->
        <rect x="${dx}" y="${H * 0.30}" width="${dw}" height="${H * 0.33}" fill="rgb(180,175,168)" rx="4"/>
        <rect x="${dx}" y="${H * 0.30}" width="${dw}" height="${H * 0.33}" fill="none" stroke="rgb(220,215,210)" stroke-width="5" rx="4"/>
        <!-- Visible next room hint -->
        <rect x="${dx + dw * 0.15}" y="${H * 0.34}" width="${dw * 0.7}" height="${H * 0.25}" fill="rgb(200,195,188)" opacity="0.5"/>
        <!-- Floor continuation -->
        <rect x="${dx + dw * 0.15}" y="${H * 0.58}" width="${dw * 0.7}" height="${H * 0.05}" fill="rgb(${room.floorRgb[0]},${room.floorRgb[1]},${room.floorRgb[2]})" opacity="0.6"/>
      `;
    })
    .join("\n");

  const artRects = room.artFrames
    .map((a) => {
      const ax = a.xPct * W;
      const ay = a.yPct * H;
      const aw = a.wPct * W;
      const ah = a.hPct * H;
      return `
        <rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" fill="rgb(200,190,180)" rx="2"/>
        <rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" fill="none" stroke="rgb(160,140,120)" stroke-width="3" rx="2"/>
        <!-- Abstract art content -->
        <circle cx="${ax + aw * 0.3}" cy="${ay + ah * 0.5}" r="${ah * 0.2}" fill="rgb(140,160,180)" opacity="0.7"/>
        <circle cx="${ax + aw * 0.6}" cy="${ay + ah * 0.6}" r="${ah * 0.15}" fill="rgb(180,140,120)" opacity="0.7"/>
        <rect x="${ax + aw * 0.4}" y="${ay + ah * 0.25}" width="${aw * 0.15}" height="${ah * 0.4}" fill="rgb(120,130,150)" opacity="0.6"/>
      `;
    })
    .join("\n");

  // Recessed/can lights on ceiling
  const ceilingLights = [];
  for (let i = 0; i < 8; i++) {
    const lx = (W * (i + 0.5)) / 8;
    ceilingLights.push(`
      <circle cx="${lx}" cy="${H * 0.20}" r="6" fill="rgb(240,235,220)" opacity="0.7"/>
      <circle cx="${lx}" cy="${H * 0.20}" r="12" fill="rgb(240,235,220)" opacity="0.25"/>
    `);
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>
    .crown { fill: none; stroke: rgb(230,225,218); stroke-width: 2; }
  </style>
  <!-- Crown molding line -->
  <line x1="0" y1="${H * 0.30}" x2="${W}" y2="${H * 0.30}" class="crown" />
  <line x1="0" y1="${H * 0.31}" x2="${W}" y2="${H * 0.31}" stroke="rgb(220,215,208)" stroke-width="1" />

  <!-- Baseboard -->
  <rect x="0" y="${H * 0.62}" width="${W}" height="${H * 0.015}" fill="rgb(210,205,198)" />
  <rect x="0" y="${H * 0.633}" width="${W}" height="${H * 0.008}" fill="rgb(190,185,178)" />

  ${windowRects}
  ${doorwayRects}
  ${artRects}
  ${ceilingLights.join("\n")}
  ${room.furnitureSvg}
</svg>`;

  return Buffer.from(svg);
}

function makeFinishLayer(seed: number): Buffer {
  // Subtle vignette + grain
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="50%" stop-color="black" stop-opacity="0" />
      <stop offset="100%" stop-color="black" stop-opacity="0.12" />
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vignette)" />
</svg>`;

  return Buffer.from(svg);
}

async function makePano(room: RoomDef) {
  const base = makeBasePano(room);
  const overlay = makeSvgOverlay(room);
  const finish = makeFinishLayer(room.key.charCodeAt(0) * 7);

  await sharp(base, {
    raw: { width: W, height: H, channels: 4 },
  })
    .composite([
      { input: overlay, top: 0, left: 0 },
      { input: finish, top: 0, left: 0 },
    ])
    .removeAlpha()
    .jpeg({ quality: 90 })
    .toFile(join(panoDir, `${room.key}.jpg`));

  console.log(`  wrote ${room.key}.jpg`);
}

async function main() {
  console.log("Generating demo panoramas...");
  for (const room of rooms) {
    await makePano(room);
  }

  // Cover from living crop
  console.log("Generating cover...");
  await sharp(join(panoDir, "living.jpg"))
    .extract({ left: 512, top: 180, width: 1024, height: 640 })
    .resize(1280, 800)
    .jpeg({ quality: 90 })
    .toFile(join(outDir, "cover.jpg"));

  // Floor plan
  const floorplan = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <rect width="400" height="300" fill="#0B0C0E"/>
  <rect x="30" y="30" width="340" height="240" fill="none" stroke="#C4A35A" stroke-width="3" rx="2"/>
  <line x1="150" y1="30" x2="150" y2="180" stroke="#C4A35A" stroke-width="2"/>
  <line x1="150" y1="180" x2="370" y2="180" stroke="#C4A35A" stroke-width="2"/>
  <line x1="250" y1="180" x2="250" y2="270" stroke="#C4A35A" stroke-width="2"/>
  <text x="65" y="110" fill="#A09080" font-family="system-ui, sans-serif" font-size="11">BEDROOM</text>
  <text x="210" y="110" fill="#A09080" font-family="system-ui, sans-serif" font-size="11">LIVING</text>
  <text x="290" y="140" fill="#A09080" font-family="system-ui, sans-serif" font-size="11">KITCHEN</text>
  <text x="280" y="230" fill="#A09080" font-family="system-ui, sans-serif" font-size="11">DINING</text>
  <text x="320" y="60" fill="#A09080" font-family="system-ui, sans-serif" font-size="10">TERRACE</text>
  <!-- Room markers -->
  <circle cx="80" cy="100" r="4" fill="#C4A35A" opacity="0.8"/>
  <circle cx="80" cy="155" r="4" fill="#C4A35A" opacity="0.8"/>
  <circle cx="210" cy="80" r="4" fill="#C4A35A" opacity="0.8"/>
  <circle cx="290" cy="120" r="4" fill="#C4A35A" opacity="0.8"/>
  <circle cx="290" cy="220" r="4" fill="#C4A35A" opacity="0.8"/>
  <circle cx="340" cy="60" r="4" fill="#C4A35A" opacity="0.8"/>
  <!-- Entry arrow -->
  <text x="200" y="275" fill="#A09080" font-family="system-ui, sans-serif" font-size="9">ENTRY</text>
  <polygon points="200,255 195,265 205,265" fill="#C4A35A" opacity="0.7"/>
</svg>`;
  writeFileSync(join(outDir, "floorplan.svg"), floorplan);

  console.log("Demo assets ready at", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
