-- Add HostingActionType enum and action_type column to hosting_balance_logs

-- Create HostingActionType enum
CREATE TYPE "HostingActionType" AS ENUM ('purchase', 'renew', 'upgrade', 'destroy', 'unfreeze', 'withdraw');

-- Add action_type column (nullable for existing records)
ALTER TABLE "hosting_balance_logs" ADD COLUMN "action_type" "HostingActionType";

-- Backfill action_type for existing records based on type
UPDATE "hosting_balance_logs" SET "action_type" = 'purchase' WHERE "type" = 'income' AND "action_type" IS NULL;
UPDATE "hosting_balance_logs" SET "action_type" = 'unfreeze' WHERE "type" = 'unfreeze' AND "action_type" IS NULL;
UPDATE "hosting_balance_logs" SET "action_type" = 'destroy' WHERE "type" = 'deduction' AND "action_type" IS NULL;
UPDATE "hosting_balance_logs" SET "action_type" = 'withdraw' WHERE "type" = 'withdraw' AND "action_type" IS NULL;
