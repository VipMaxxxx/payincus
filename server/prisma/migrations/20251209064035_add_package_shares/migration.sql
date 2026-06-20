/*
  Warnings:

  - You are about to drop the column `backup_limit` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `backup_used` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `cpu_limit` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `cpu_used` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `disk_limit` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `disk_used` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `memory_limit` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `memory_used` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `port_limit` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `port_used` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `snapshot_limit` on the `user_quotas` table. All the data in the column will be lost.
  - You are about to drop the column `snapshot_used` on the `user_quotas` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "user_quotas" DROP COLUMN "backup_limit",
DROP COLUMN "backup_used",
DROP COLUMN "cpu_limit",
DROP COLUMN "cpu_used",
DROP COLUMN "disk_limit",
DROP COLUMN "disk_used",
DROP COLUMN "memory_limit",
DROP COLUMN "memory_used",
DROP COLUMN "port_limit",
DROP COLUMN "port_used",
DROP COLUMN "snapshot_limit",
DROP COLUMN "snapshot_used",
ALTER COLUMN "instance_limit" SET DEFAULT 50;

-- CreateTable
CREATE TABLE "package_shares" (
    "id" SERIAL NOT NULL,
    "package_id" INTEGER NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "shared_to_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_shares_shared_to_id_idx" ON "package_shares"("shared_to_id");

-- CreateIndex
CREATE INDEX "package_shares_owner_id_idx" ON "package_shares"("owner_id");

-- CreateIndex
CREATE INDEX "package_shares_package_id_idx" ON "package_shares"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_shares_package_id_shared_to_id_key" ON "package_shares"("package_id", "shared_to_id");

-- AddForeignKey
ALTER TABLE "package_shares" ADD CONSTRAINT "package_shares_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_shares" ADD CONSTRAINT "package_shares_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_shares" ADD CONSTRAINT "package_shares_shared_to_id_fkey" FOREIGN KEY ("shared_to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
