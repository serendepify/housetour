import { loadEnv } from "@housetour/db";

loadEnv();

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  authSecret: process.env.AUTH_SECRET ?? "dev-secret-change-me-in-production-32chars",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.S3_REGION ?? "us-east-1",
    accessKey: process.env.S3_ACCESS_KEY ?? "housetour",
    secretKey: process.env.S3_SECRET_KEY ?? "housetoursecret",
    bucket: process.env.S3_BUCKET ?? "housetour",
    publicUrl: process.env.S3_PUBLIC_URL ?? "http://localhost:9000/housetour",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
    prices: {
      starter: process.env.STRIPE_PRICE_STARTER ?? "",
      pro: process.env.STRIPE_PRICE_PRO ?? "",
      studio: process.env.STRIPE_PRICE_STUDIO ?? "",
    },
  },
};
