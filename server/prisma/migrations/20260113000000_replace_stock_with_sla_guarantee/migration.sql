-- Replace stock_limit/stock_used with sla_guarantee in package_plans table
-- This migration converts the inventory system to an SLA guarantee display

-- Step 1: Add the new sla_guarantee column
ALTER TABLE "package_plans" ADD COLUMN IF NOT EXISTS "sla_guarantee" DECIMAL(5,2);

-- Step 2: Drop the old stock columns (no data migration needed as we're changing the concept entirely)
ALTER TABLE "package_plans" DROP COLUMN IF EXISTS "stock_limit";
ALTER TABLE "package_plans" DROP COLUMN IF EXISTS "stock_used";
