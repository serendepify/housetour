import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

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
  };
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
  await ensureBucket();
  const values = config();
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
  await ensureBucket();
  const values = config();
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: values.bucket, Key: key }),
  );
  if (!result.Body) throw new Error(`Stored capture ${key} has no body`);
  return Buffer.from(await result.Body.transformToByteArray());
}
