-- Photogrammetry asset kinds
ALTER TYPE "AssetKind" ADD VALUE IF NOT EXISTS 'MULTI_VIEW';
ALTER TYPE "AssetKind" ADD VALUE IF NOT EXISTS 'POINT_CLOUD';
ALTER TYPE "AssetKind" ADD VALUE IF NOT EXISTS 'DEPTH_MAP';

-- Plan entitlements for processing / photogrammetry / Stripe product
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "allowPhotogrammetry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "processingMinutesIncluded" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "stripeProductId" TEXT;

-- Usage metering
DO $$ BEGIN
  CREATE TYPE "UsageKind" AS ENUM (
    'PROCESS_MINUTES',
    'PHOTOGRAMMETRY_MINUTES',
    'STORAGE_GB_MONTH',
    'TOUR_PUBLISH'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "UsageRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tourId" UUID,
    "kind" "UsageKind" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "meta" JSONB,
    "stripeMeterId" TEXT,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UsageRecord_organizationId_kind_createdAt_idx"
  ON "UsageRecord"("organizationId", "kind", "createdAt");

CREATE INDEX IF NOT EXISTS "UsageRecord_tourId_idx" ON "UsageRecord"("tourId");

DO $$ BEGIN
  ALTER TABLE "UsageRecord"
    ADD CONSTRAINT "UsageRecord_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
