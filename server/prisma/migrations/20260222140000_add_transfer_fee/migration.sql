-- Add transfer fee field to instance_transfers table
ALTER TABLE "instance_transfers" ADD COLUMN "fee" DECIMAL(10,2);

-- Add transfer_fee and transfer_refund to BalanceLogType enum
ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'transfer_fee';
ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'transfer_refund';
