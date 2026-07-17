export type CaptureQuality = {
  brightness: number;
  sharpness: number;
  rating: "good" | "check" | "poor";
  issues: Array<"dark" | "bright" | "soft">;
  overlapSimilarity?: number; // 0-100: 0=no overlap, 100=identical (ideal:50-85)
};

export type CaptureQualitySummary = {
  good: number;
  check: number;
  poor: number;
  total: number;
  usable: number;
};

export function laplacianVariance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3 || pixels.length < width * height * 4) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  const luminance = (offset: number) =>
    pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = (y * width + x) * 4;
      const value =
        luminance(center - width * 4) +
        luminance(center - 4) -
        4 * luminance(center) +
        luminance(center + 4) +
        luminance(center + width * 4);
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }

  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, sumSquares / count - mean * mean);
}

export function averageBrightness(pixels: Uint8ClampedArray): number {
  if (pixels.length < 4) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    total += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    count++;
  }
  return count ? total / count : 0;
}

export function assessCaptureQuality(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CaptureQuality {
  const brightness = averageBrightness(pixels);
  const sharpness = laplacianVariance(pixels, width, height);
  const issues: CaptureQuality["issues"] = [];

  if (brightness < 42) issues.push("dark");
  if (brightness > 226) issues.push("bright");
  if (sharpness < 55) issues.push("soft");

  return {
    brightness: Math.round(brightness),
    sharpness: Math.round(sharpness),
    rating: issues.length === 0 ? "good" : issues.length === 1 ? "check" : "poor",
    issues,
  };
}

export function summarizeCaptureQuality(qualities: CaptureQuality[]) {
  const summary = qualities.reduce(
    (summary, quality) => {
      summary[quality.rating]++;
      return summary;
    },
    { good: 0, check: 0, poor: 0 },
  );
  return {
    ...summary,
    total: qualities.length,
    usable: summary.good + summary.check,
  };
}

export function isCaptureReadyForReconstruction(
  summary: Pick<CaptureQualitySummary, "good" | "check" | "poor" | "total" | "usable">,
) {
  if (summary.total < 8) return false;
  const usableThreshold = Math.min(12, Math.max(8, Math.ceil(summary.total * 0.7)));
  const poorThreshold = Math.max(1, Math.floor(summary.total * 0.25));
  return summary.usable >= usableThreshold && summary.poor <= poorThreshold;
}

export function reconstructionQualityMessage(
  summary: Pick<CaptureQualitySummary, "good" | "check" | "poor" | "total" | "usable">,
) {
  if (isCaptureReadyForReconstruction(summary)) return null;

  const reasons: string[] = [];
  if (summary.total < 8) {
    reasons.push(`capture at least 8 overlapping frames`);
  }
  if (summary.usable < Math.min(12, Math.max(8, Math.ceil(summary.total * 0.7)))) {
    reasons.push(`keep more frames sharp and evenly lit`);
  }
  if (summary.poor > Math.max(1, Math.floor(summary.total * 0.25))) {
    reasons.push(`retake the soft or dark frames`);
  }

  return `This scan is not strong enough for photogrammetry yet: ${reasons.join("; ")}.`;
}

/**
 * Compare two same-sized pixel arrays and return a similarity percentage
 * (0 = completely different, 100 = identical). Uses a downscaled grid for
 * speed — call before capture to tell the user whether they've moved enough.
 */
export function pixelSimilarity(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  len: number,
): number {
  let diff = 0;
  for (let i = 0; i < len; i += 4) {
    diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  const maxDiff = (len / 4) * 3 * 255;
  return maxDiff ? Math.round((1 - diff / maxDiff) * 100) : 100;
}
