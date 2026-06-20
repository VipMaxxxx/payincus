-- AlterTable
ALTER TABLE "package_shares" ADD COLUMN     "max_instances" INTEGER,
ADD COLUMN     "quota_multiplier" DECIMAL(3,1);
