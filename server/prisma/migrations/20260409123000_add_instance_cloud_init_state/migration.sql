ALTER TABLE "instances"
ADD COLUMN "cloud_init_state" TEXT,
ADD COLUMN "cloud_init_source" TEXT,
ADD COLUMN "cloud_init_last_checked_at" TIMESTAMP(3),
ADD COLUMN "cloud_init_completed_at" TIMESTAMP(3),
ADD COLUMN "cloud_init_manual_completed_at" TIMESTAMP(3),
ADD COLUMN "cloud_init_manual_completed_by" INTEGER;
