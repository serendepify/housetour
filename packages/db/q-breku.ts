import { prisma } from "./src/index.ts";
import { existsSync, statSync } from "node:fs";

// Find ALL breku-ette multi-view assets
const assets = await prisma.tourAsset.findMany({
  where: { kind: "MULTI_VIEW", filename: { contains: "breku" } },
  select: { id: true, filename: true, storageKey: true, sizeBytes: true },
  orderBy: { filename: "asc" },
});
console.log(`Breku-ette frames: ${assets.length}`);
for (const a of assets.slice(0, 5)) {
  console.log(`  ${a.filename} key=${a.storageKey}`);
}
if (assets.length > 5) console.log(`  ... and ${assets.length - 5} more`);

// Check fs-backend paths
const fsRoot = process.env.S3_FS_ROOT || "apps/web";
const paths = [
  `${fsRoot}/private/orgs/8251166b-0d95-4ddb-99b0-632ae0898a0e/tours/63584f2a-2742-413f-b109-ef2f91303cf8/multi_view/`,
  `${fsRoot}/public/orgs/8251166b-0d95-4ddb-99b0-632ae0898a0e/tours/63584f2a-2742-413f-b109-ef2f91303cf8/capture/`,
];
import { readdirSync } from "node:fs";
for (const p of paths) {
  console.log(`\nChecking: ${p}`);
  if (existsSync(p)) {
    const files = readdirSync(p).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
    console.log(`  ${files.length} image files`);
    for (const f of files.slice(0, 4)) {
      const sz = statSync(`${p}/${f}`).size;
      console.log(`    ${f}: ${(sz/1024).toFixed(0)}KB`);
    }
  } else {
    console.log("  NOT FOUND");
  }
}

await prisma.$disconnect();
