import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

/**
 * Load workspace-root .env (cwd-independent).
 * Walks up from this file until package.json name is housetour or .env is found.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../.env"),
    resolve(here, "../../../../.env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path });
      return;
    }
  }

  config();
}
