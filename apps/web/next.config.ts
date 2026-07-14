import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: rootDir,
  transpilePackages: [
    "@housetour/db",
    "@housetour/api-contract",
    "@housetour/tour-engine",
    "@housetour/pipeline",
  ],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "bullmq", "ioredis", "sharp"],
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "9000" },
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
