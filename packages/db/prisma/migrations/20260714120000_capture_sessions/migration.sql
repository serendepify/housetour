DO $$ BEGIN
  CREATE TYPE "CaptureMode" AS ENUM ('PERSPECTIVE', 'PANO_360', 'LIDAR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CaptureSessionStatus" AS ENUM (
    'DRAFT',
    'CAPTURING',
    'UPLOADING',
    'READY',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CaptureSession" (
  "id" UUID NOT NULL,
  "tourId" UUID NOT NULL,
  "createdById" UUID,
  "roomName" TEXT NOT NULL,
  "mode" "CaptureMode" NOT NULL DEFAULT 'PERSPECTIVE',
  "status" "CaptureSessionStatus" NOT NULL DEFAULT 'DRAFT',
  "frameCount" INTEGER NOT NULL DEFAULT 0,
  "targetFrameCount" INTEGER NOT NULL DEFAULT 18,
  "deviceInfo" JSONB,
  "qualitySummary" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TourAsset" ADD COLUMN IF NOT EXISTS "captureSessionId" UUID;

CREATE INDEX IF NOT EXISTS "CaptureSession_tourId_status_idx"
  ON "CaptureSession"("tourId", "status");
CREATE INDEX IF NOT EXISTS "CaptureSession_createdById_idx"
  ON "CaptureSession"("createdById");
CREATE INDEX IF NOT EXISTS "TourAsset_captureSessionId_sortOrder_idx"
  ON "TourAsset"("captureSessionId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "TourAsset_storageKey_key"
  ON "TourAsset"("storageKey");

DO $$ BEGIN
  ALTER TABLE "CaptureSession"
    ADD CONSTRAINT "CaptureSession_tourId_fkey"
    FOREIGN KEY ("tourId") REFERENCES "Tour"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CaptureSession"
    ADD CONSTRAINT "CaptureSession_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TourAsset"
    ADD CONSTRAINT "TourAsset_captureSessionId_fkey"
    FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
