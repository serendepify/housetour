import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCaptureQuality,
  averageBrightness,
  laplacianVariance,
  isCaptureReadyForReconstruction,
  summarizeCaptureQuality,
} from "./capture-quality";

function solid(width: number, height: number, value: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  return pixels;
}

test("averageBrightness reports a neutral solid frame", () => {
  assert.equal(Math.round(averageBrightness(solid(4, 4, 128))), 128);
});

test("laplacianVariance distinguishes edges from a flat frame", () => {
  const flat = solid(8, 8, 128);
  const edges = solid(8, 8, 0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const value = (x + y) % 2 === 0 ? 0 : 255;
      const offset = (y * 8 + x) * 4;
      edges[offset] = value;
      edges[offset + 1] = value;
      edges[offset + 2] = value;
    }
  }
  assert.equal(laplacianVariance(flat, 8, 8), 0);
  assert.ok(laplacianVariance(edges, 8, 8) > 1_000);
});

test("capture quality flags dark and soft frames", () => {
  const result = assessCaptureQuality(solid(8, 8, 20), 8, 8);
  assert.equal(result.rating, "poor");
  assert.deepEqual(result.issues, ["dark", "soft"]);
});

test("quality summaries retain review states", () => {
  assert.deepEqual(
    summarizeCaptureQuality([
      { brightness: 100, sharpness: 100, rating: "good", issues: [] },
      { brightness: 100, sharpness: 40, rating: "check", issues: ["soft"] },
    ]),
    { good: 1, check: 1, poor: 0, total: 2, usable: 2 },
  );
});

test("reconstruction readiness rejects tiny or weak scans", () => {
  assert.equal(
    isCaptureReadyForReconstruction({ good: 4, check: 3, poor: 1, total: 8, usable: 7 }),
    false,
  );
  assert.equal(
    isCaptureReadyForReconstruction({ good: 7, check: 3, poor: 0, total: 10, usable: 10 }),
    true,
  );
});
