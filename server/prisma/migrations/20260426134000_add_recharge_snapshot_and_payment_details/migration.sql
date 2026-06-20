ALTER TABLE "recharge_records"
ADD COLUMN IF NOT EXISTS "provider_config_snapshot" TEXT,
ADD COLUMN IF NOT EXISTS "payment_details" JSONB;
