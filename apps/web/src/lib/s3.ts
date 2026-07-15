import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

let client: S3Client | null = null;
let presignClient: S3Client | null = null;
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

function getPresignS3(): S3Client {
  if (!presignClient) {
    presignClient = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.browserEndpoint,
      forcePathStyle: env.s3.forcePathStyle,
      credentials: {
        accessKeyId: env.s3.accessKey,
        secretAccessKey: env.s3.secretKey,
      },
    });
  }
  return presignClient;
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

export async function inspectUploadedObject(key: string) {
  await ensureBucket();
  const result = await getS3().send(
    new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }),
  );
  return {
    sizeBytes: result.ContentLength ?? 0,
    contentType: result.ContentType ?? "application/octet-stream",
    etag: result.ETag?.replaceAll('"', "") ?? null,
  };
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
  return getSignedUrl(getPresignS3(), command, { expiresIn: params.expiresIn ?? 900 });
}

function encodeCopySource(key: string) {
  return `${env.s3.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function copyStoredObject(sourceKey: string, destinationKey: string) {
  await ensureBucket();
  await getS3().send(
    new CopyObjectCommand({
      Bucket: env.s3.bucket,
      Key: destinationKey,
      CopySource: encodeCopySource(sourceKey),
      MetadataDirective: "COPY",
    }),
  );
}

export async function deleteStoredObjects(keys: string[]) {
  if (keys.length === 0) return;
  await ensureBucket();
  await getS3().send(
    new DeleteObjectsCommand({
      Bucket: env.s3.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
