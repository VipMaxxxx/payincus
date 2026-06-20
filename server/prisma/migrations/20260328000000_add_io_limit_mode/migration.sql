-- AlterTable
ALTER TABLE "packages" ADD COLUMN "io_limit_mode" TEXT NOT NULL DEFAULT 'throughput';
