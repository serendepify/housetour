DO $$ BEGIN
  CREATE TYPE "ListingStatus" AS ENUM (
    'DRAFT', 'ACTIVE', 'UNDER_OFFER', 'SOLD', 'RENTED', 'ARCHIVED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Property"
  ADD COLUMN IF NOT EXISTS "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "listingType" "ListingType" NOT NULL DEFAULT 'SALE',
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE "TourScene" ADD COLUMN IF NOT EXISTS "captureSessionId" UUID;
ALTER TABLE "ProcessingJob" ADD COLUMN IF NOT EXISTS "captureSessionId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "TourScene_tourId_captureSessionId_key"
  ON "TourScene"("tourId", "captureSessionId");
CREATE INDEX IF NOT EXISTS "TourScene_captureSessionId_idx"
  ON "TourScene"("captureSessionId");
CREATE INDEX IF NOT EXISTS "ProcessingJob_captureSessionId_status_idx"
  ON "ProcessingJob"("captureSessionId", "status");

DO $$ BEGIN
  ALTER TABLE "TourScene"
    ADD CONSTRAINT "TourScene_captureSessionId_fkey"
    FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProcessingJob"
    ADD CONSTRAINT "ProcessingJob_captureSessionId_fkey"
    FOREIGN KEY ("captureSessionId") REFERENCES "CaptureSession"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
