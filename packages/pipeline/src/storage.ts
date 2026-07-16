import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

let client: S3Client | null = null;
let bucketPromise: Promise<void> | null = null;

function config() {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKey: process.env.S3_ACCESS_KEY ?? "housetour",
    secretKey: process.env.S3_SECRET_KEY ?? "housetoursecret",
    bucket: process.env.S3_BUCKET ?? "housetour",
    publicUrl: process.env.S3_PUBLIC_URL ?? "http://localhost:9000/housetour",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    // Local-dev fallback: when set, derived objects (e.g. navigation-proxy.glb)
    // are written to disk under S3_FS_ROOT and served from S3_FS_PUBLIC_URL
    // instead of requiring a running MinIO/S3 instance.
    fsBackend: process.env.S3_BACKEND === "fs",
    // Resolve to an absolute path at config time so the write location is
    // independent of the current working directory.
    fsRoot: resolve(process.env.S3_FS_ROOT ?? "apps/web/public/derived"),
    fsPublicUrl: process.env.S3_FS_PUBLIC_URL ?? "/derived",
  };
}

/**
 * Returns the on-disk absolute path for an S3-style key when the filesystem
 * backend is active. Keys look like `public/orgs/<id>/tours/<id>/derived/<id>/file.glb`.
 */
function fsPathFor(key: string, values: ReturnType<typeof config>) {
  // Strip the leading `public/` segment so the path maps to the served dir.
  const rel = key.replace(/^public\//, "");
  return join(values.fsRoot, rel);
}

function getClient() {
  if (!client) {
    const values = config();
    client = new S3Client({
      endpoint: values.endpoint,
      region: values.region,
      forcePathStyle: values.forcePathStyle,
      credentials: {
        accessKeyId: values.accessKey,
        secretAccessKey: values.secretKey,
      },
    });
  }
  return client;
}

async function ensureBucket() {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const values = config();
      try {
        await getClient().send(new HeadBucketCommand({ Bucket: values.bucket }));
      } catch {
        await getClient().send(new CreateBucketCommand({ Bucket: values.bucket }));
      }
    })();
  }
  await bucketPromise;
}

export async function uploadDerivedObject({
  key,
  body,
  contentType,
  cacheControl = "public, max-age=31536000, immutable",
}: {
  key: string;
  body: Buffer | string;
  contentType: string;
  cacheControl?: string;
}) {
  const values = config();

  // Filesystem backend (local dev without MinIO)
  if (values.fsBackend) {
    const target = fsPathFor(key, values);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, body);
    return `${values.fsPublicUrl.replace(/\/$/, "")}/${key.replace(/^public\//, "").replace(/^\//, "")}`;
  }

  await ensureBucket();
  await getClient().send(
    new PutObjectCommand({
      Bucket: values.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
  return `${values.publicUrl.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

export async function downloadSourceObject(key: string) {
  const values = config();

  if (values.fsBackend) {
    const target = fsPathFor(key, values);
    if (!existsSync(target)) throw new Error(`Stored capture ${key} not found locally`);
    return readFileSync(target);
  }

  await ensureBucket();
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: values.bucket, Key: key }),
  );
  if (!result.Body) throw new Error(`Stored capture ${key} has no body`);
  return Buffer.from(await result.Body.transformToByteArray());
}
