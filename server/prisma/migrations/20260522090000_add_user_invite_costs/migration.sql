ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'invite_generate';
ALTER TYPE "PointsLogType" ADD VALUE IF NOT EXISTS 'invite_generate';

ALTER TABLE "invite_codes"
ADD COLUMN IF NOT EXISTS "cost_snapshot" JSONB;
