import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

let client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;

export function getS3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint,
      forcePathStyle: env.s3.forcePathStyle,
      credentials: {
        accessKeyId: env.s3.accessKey,
        secretAccessKey: env.s3.secretKey,
      },
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const s3 = getS3();
      try {
        await s3.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
      } catch {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
        } catch {
          // race or already exists
        }
      }
    })();
  }
  await bucketReady;
}

export function publicUrlForKey(key: string): string {
  return `${env.s3.publicUrl.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

export async function presignPut(params: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string> {
  await ensureBucket();
  const command = new PutObjectCommand({
    Bucket: env.s3.bucket,
    Key: params.key,
    ContentType: params.contentType,
  });
  return getSignedUrl(getS3(), command, { expiresIn: params.expiresIn ?? 900 });
}
