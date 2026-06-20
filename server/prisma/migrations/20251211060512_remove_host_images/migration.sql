/*
  Warnings:

  - You are about to drop the `host_images` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "host_images" DROP CONSTRAINT "host_images_host_id_fkey";

-- DropTable
DROP TABLE "host_images";

-- DropEnum
DROP TYPE "HostImageStatus";
