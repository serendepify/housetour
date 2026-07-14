import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAutoLinearHotspots,
  formatListPrice,
  slugify,
  sphericalToCartesian,
} from "./index";

test("slugify normalizes titles", () => {
  assert.equal(slugify("Harbor Loft — Unit 4B"), "harbor-loft-unit-4b");
});

test("formatListPrice formats USD", () => {
  assert.equal(formatListPrice("1245000.00"), "$1,245,000");
});

test("sphericalToCartesian returns unit-ish vectors", () => {
  const v = sphericalToCartesian(0, 0, 1);
  assert.ok(Math.abs(v.z + 1) < 1e-9);
});

test("buildAutoLinearHotspots is bidirectional", () => {
  const edges = buildAutoLinearHotspots(["a", "b", "c"], true);
  assert.equal(edges.length, 4);
});
