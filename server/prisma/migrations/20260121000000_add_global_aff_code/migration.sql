-- AlterTable: Make package_plan_id nullable to support global AFF codes
-- Global AFF codes have package_plan_id = NULL and can be used for all paid plans

-- Step 1: Drop the existing foreign key constraint
ALTER TABLE "aff_codes" DROP CONSTRAINT IF EXISTS "aff_codes_package_plan_id_fkey";

-- Step 2: Alter column to be nullable
ALTER TABLE "aff_codes" ALTER COLUMN "package_plan_id" DROP NOT NULL;

-- Step 3: Re-add foreign key with ON DELETE CASCADE (allows NULL values)
ALTER TABLE "aff_codes" ADD CONSTRAINT "aff_codes_package_plan_id_fkey" 
    FOREIGN KEY ("package_plan_id") REFERENCES "package_plans"("id") 
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Note: The unique constraint on (user_id, package_plan_id) remains
-- In PostgreSQL, NULL values are not considered equal for unique constraints,
-- so multiple rows with (same_user_id, NULL) would be allowed by the database.
-- The application layer uses transactions to prevent duplicate global codes per user.
