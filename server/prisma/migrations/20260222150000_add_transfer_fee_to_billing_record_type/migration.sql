-- Add transfer_fee to BillingRecordType enum
-- This is safe: adding a new enum value does not affect existing records
ALTER TYPE "BillingRecordType" ADD VALUE IF NOT EXISTS 'transfer_fee';
