ALTER TABLE "packages"
ADD COLUMN IF NOT EXISTS "traffic_reset_price" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "package_plans"
ADD COLUMN IF NOT EXISTS "traffic_reset_price" DECIMAL(10,2);
