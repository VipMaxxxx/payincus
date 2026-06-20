/*
  Warnings:

  - The values [ipv4,ipv4_ipv6] on the enum `NetworkMode` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "StoragePurpose" AS ENUM ('instance_data', 'instance_storage');

-- AlterEnum
BEGIN;
CREATE TYPE "NetworkMode_new" AS ENUM ('nat', 'nat_ipv6');
ALTER TABLE "public"."instances" ALTER COLUMN "network_mode" DROP DEFAULT;
ALTER TABLE "public"."packages" ALTER COLUMN "network_mode" DROP DEFAULT;
ALTER TABLE "packages" ALTER COLUMN "network_mode" TYPE "NetworkMode_new" USING ("network_mode"::text::"NetworkMode_new");
ALTER TABLE "instances" ALTER COLUMN "network_mode" TYPE "NetworkMode_new" USING ("network_mode"::text::"NetworkMode_new");
ALTER TYPE "NetworkMode" RENAME TO "NetworkMode_old";
ALTER TYPE "NetworkMode_new" RENAME TO "NetworkMode";
DROP TYPE "public"."NetworkMode_old";
ALTER TABLE "instances" ALTER COLUMN "network_mode" SET DEFAULT 'nat';
ALTER TABLE "packages" ALTER COLUMN "network_mode" SET DEFAULT 'nat';
COMMIT;

-- CreateTable
CREATE TABLE "storage_pools" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "purpose" "StoragePurpose" NOT NULL DEFAULT 'instance_data',
    "description" TEXT,
    "config" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_pools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_pools_host_id_idx" ON "storage_pools"("host_id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_pools_host_id_name_key" ON "storage_pools"("host_id", "name");

-- AddForeignKey
ALTER TABLE "storage_pools" ADD CONSTRAINT "storage_pools_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
