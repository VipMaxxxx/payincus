-- AlterEnum: Add 'processing' to TransferStatus
ALTER TYPE "TransferStatus" ADD VALUE 'processing';

-- AlterTable: Add updated_at column to instance_transfers
ALTER TABLE "instance_transfers" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
