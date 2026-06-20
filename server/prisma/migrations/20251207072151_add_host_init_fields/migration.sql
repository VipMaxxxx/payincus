/*
  Warnings:

  - A unique constraint covering the columns `[install_token]` on the table `hosts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "hosts" ADD COLUMN     "enable_api" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "install_token" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "ipv6_gateway" TEXT,
ADD COLUMN     "ipv6_mode" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ipv6_subnet" TEXT,
ADD COLUMN     "is_installed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zfs_size" INTEGER NOT NULL DEFAULT 60;

-- CreateIndex
CREATE UNIQUE INDEX "hosts_install_token_key" ON "hosts"("install_token");
