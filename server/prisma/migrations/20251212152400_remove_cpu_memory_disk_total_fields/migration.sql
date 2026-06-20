/*
  Warnings:

  - You are about to drop the column `cpu_total` on the `hosts` table. All the data in the column will be lost.
  - You are about to drop the column `disk_total` on the `hosts` table. All the data in the column will be lost.
  - You are about to drop the column `memory_total` on the `hosts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "hosts" DROP COLUMN "cpu_total",
DROP COLUMN "disk_total",
DROP COLUMN "memory_total";
