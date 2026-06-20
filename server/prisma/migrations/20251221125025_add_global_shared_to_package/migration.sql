-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "global_max_instances" INTEGER,
ADD COLUMN     "global_quota_multiplier" DECIMAL(3,1),
ADD COLUMN     "global_shared" BOOLEAN NOT NULL DEFAULT false;
