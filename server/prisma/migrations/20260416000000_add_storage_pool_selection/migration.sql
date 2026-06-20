ALTER TABLE "package_hosts"
ADD COLUMN "storage_pool_name" TEXT;

ALTER TABLE "instances"
ADD COLUMN "storage_pool_name" TEXT;
