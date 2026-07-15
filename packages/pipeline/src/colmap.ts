import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

const execFile = promisify(execFileCb);

export type ColmapAvailability = {
  available: boolean;
  binary: string | null;
  version?: string;
};

export async function detectColmap(): Promise<ColmapAvailability> {
  const candidates = ["colmap", "/usr/local/bin/colmap", "/opt/colmap/bin/colmap"];
  for (const bin of candidates) {
    try {
      const { stdout } = await execFile(bin, ["-h"], { timeout: 5000 });
      if (stdout || true) {
        let version = "unknown";
        try {
          const v = await execFile(bin, ["-h"], { timeout: 5000 });
          version = (v.stdout || v.stderr || "").split("\n")[0]?.slice(0, 80) ?? "unknown";
        } catch {
          /* ignore */
        }
        return { available: true, binary: bin, version };
      }
    } catch {
      /* try next */
    }
  }
  return { available: false, binary: null };
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`colmap ${args[0]} exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}

/**
 * Run COLMAP automatic reconstruction when binary is available.
 * Expects images already copied into workDir/images.
 * Returns paths to sparse model and (if dense succeeds) dense workspace.
 */
export async function runColmapReconstruction(workDir: string): Promise<{
  sparseDir: string;
  denseDir?: string;
  log: string[];
}> {
  const det = await detectColmap();
  if (!det.available || !det.binary) {
    throw new Error("COLMAP binary not found on PATH");
  }

  const images = join(workDir, "images");
  const database = join(workDir, "database.db");
  const sparse = join(workDir, "sparse");
  const dense = join(workDir, "dense");
  mkdirSync(sparse, { recursive: true });
  mkdirSync(dense, { recursive: true });

  const log: string[] = [`Using COLMAP at ${det.binary}`];
  const imgCount = readdirSync(images).filter((f) =>
    /\.(jpe?g|png|webp)$/i.test(f),
  ).length;
  if (imgCount < 2) {
    throw new Error("COLMAP needs at least 2 images");
  }

  await run(det.binary, [
    "feature_extractor",
    "--database_path",
    database,
    "--image_path",
    images,
    "--ImageReader.single_camera",
    "1",
  ], workDir);
  log.push("feature_extractor done");

  await run(det.binary, [
    imgCount >= 12 ? "sequential_matcher" : "exhaustive_matcher",
    "--database_path",
    database,
  ], workDir);
  log.push(`${imgCount >= 12 ? "sequential" : "exhaustive"}_matcher done`);

  await run(det.binary, [
    "mapper",
    "--database_path",
    database,
    "--image_path",
    images,
    "--output_path",
    sparse,
  ], workDir);
  log.push("mapper done");

  // Dense is optional / heavier — attempt image undistorter + patch match if CUDA-less CPU path fails gracefully
  try {
    const model0 = existsSync(join(sparse, "0")) ? join(sparse, "0") : sparse;
    await run(det.binary, [
      "image_undistorter",
      "--image_path",
      images,
      "--input_path",
      model0,
      "--output_path",
      dense,
      "--output_type",
      "COLMAP",
    ], workDir);
    log.push("image_undistorter done");
  } catch (e) {
    log.push(`dense skipped: ${e instanceof Error ? e.message : String(e)}`);
    return { sparseDir: sparse, log };
  }

  return { sparseDir: sparse, denseDir: dense, log };
}

/** Write a reconstruction marker file when COLMAP is unavailable (software fallback). */
export function writeFallbackReconstructionManifest(
  workDir: string,
  payload: Record<string, unknown>,
) {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(
    join(workDir, "reconstruction.json"),
    JSON.stringify(
      {
        engine: "housetour-software-photogrammetry",
        colmap: false,
        ...payload,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
