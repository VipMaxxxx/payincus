/*
  Warnings:

  - You are about to drop the column `zfs_size` on the `hosts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "hosts" DROP COLUMN "zfs_size",
ADD COLUMN     "install_token_expire" TIMESTAMP(3),
ADD COLUMN     "storage_driver" TEXT NOT NULL DEFAULT 'zfs',
ADD COLUMN     "storage_path" TEXT,
ADD COLUMN     "storage_size" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "storage_type" TEXT NOT NULL DEFAULT 'loop',
ADD COLUMN     "sysctl_config" TEXT;
