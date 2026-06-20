-- AlterEnum: Add 'suspended' to InstanceStatus
ALTER TYPE "InstanceStatus" ADD VALUE 'suspended';

-- AlterTable: Add billing fields to packages
ALTER TABLE "packages" ADD COLUMN "price_monthly" DECIMAL(10,2);
ALTER TABLE "packages" ADD COLUMN "setup_fee" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: Add billing and suspend fields to instances
ALTER TABLE "instances" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "instances" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "instances" ADD COLUMN "suspended_by" INTEGER;
ALTER TABLE "instances" ADD COLUMN "suspend_reason" TEXT;
ALTER TABLE "instances" ADD COLUMN "billing_price" DECIMAL(10,2);
ALTER TABLE "instances" ADD COLUMN "auto_renew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "instances" ADD COLUMN "expiry_notified_at" TIMESTAMP(3);

-- CreateIndex: For billing scheduler to find expiring instances
CREATE INDEX "instances_expires_at_idx" ON "instances"("expires_at");
