ALTER TABLE "package_hosts"
ADD COLUMN "traffic_multiplier" DECIMAL(8, 3) NOT NULL DEFAULT 1.0;
