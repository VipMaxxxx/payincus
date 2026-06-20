-- CreateEnum: Balance Log Types
CREATE TYPE "BalanceLogType" AS ENUM ('recharge', 'consume', 'refund', 'admin_adjust', 'gift');

-- CreateEnum: Payment Provider Types
CREATE TYPE "PaymentProviderType" AS ENUM ('yipay', 'stripe', 'alipay_direct', 'wechat_direct', 'manual');

-- CreateEnum: Payment Provider Status
CREATE TYPE "PaymentProviderStatus" AS ENUM ('active', 'disabled', 'testing');

-- CreateEnum: Recharge Status
CREATE TYPE "RechargeStatus" AS ENUM ('pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded');

-- CreateEnum: Billing Record Types
CREATE TYPE "BillingRecordType" AS ENUM ('newPurchase', 'renew', 'upgrade', 'downgrade', 'refund');

-- AlterTable: Add balance field to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "balance" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: Add billing fields to instances
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "package_plan_id" INTEGER;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "billing_cycle" INTEGER;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "auto_renew_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "last_auto_renew_attempt_at" TIMESTAMP(3);
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: PaymentProvider
CREATE TABLE IF NOT EXISTS "payment_providers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentProviderType" NOT NULL,
    "status" "PaymentProviderStatus" NOT NULL DEFAULT 'disabled',
    "config" JSONB NOT NULL DEFAULT '{}',
    "methods" JSONB NOT NULL DEFAULT '[]',
    "fee_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "fee_fixed" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "min_amount" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "max_amount" DECIMAL(10,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BalanceLog
CREATE TABLE IF NOT EXISTS "balance_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "BalanceLogType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balance_before" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(10,2) NOT NULL,
    "order_id" TEXT,
    "instance_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RechargeRecord
CREATE TABLE IF NOT EXISTS "recharge_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "order_no" TEXT NOT NULL,
    "trade_no" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "actual_amount" DECIMAL(10,2),
    "fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "payment_method" TEXT,
    "status" "RechargeStatus" NOT NULL DEFAULT 'pending',
    "callback_data" JSONB,
    "callback_at" TIMESTAMP(3),
    "fail_reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expired_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "recharge_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PackagePlan
CREATE TABLE IF NOT EXISTS "package_plans" (
    "id" SERIAL NOT NULL,
    "package_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cpu" INTEGER NOT NULL,
    "memory" INTEGER NOT NULL,
    "disk" INTEGER NOT NULL,
    "port_limit" INTEGER NOT NULL,
    "snapshot_limit" INTEGER NOT NULL,
    "backup_limit" INTEGER NOT NULL,
    "site_limit" INTEGER NOT NULL,
    "traffic_limit" BIGINT NOT NULL,
    "traffic_limit_speed" TEXT NOT NULL DEFAULT '1Mbit',
    "price" DECIMAL(10,2) NOT NULL,
    "billing_cycle" INTEGER NOT NULL DEFAULT 1,
    "setup_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "stock_limit" INTEGER,
    "stock_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InstanceBillingRecord
CREATE TABLE IF NOT EXISTS "instance_billing_records" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "BillingRecordType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "balance_log_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_billing_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "recharge_records_order_no_key" ON "recharge_records"("order_no");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_logs_user_id_created_at_idx" ON "balance_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "balance_logs_type_idx" ON "balance_logs"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recharge_records_user_id_status_idx" ON "recharge_records"("user_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recharge_records_status_created_at_idx" ON "recharge_records"("status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recharge_records_order_no_idx" ON "recharge_records"("order_no");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recharge_records_trade_no_idx" ON "recharge_records"("trade_no");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "package_plans_package_id_name_key" ON "package_plans"("package_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "package_plans_package_id_is_active_idx" ON "package_plans"("package_id", "is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "instance_billing_records_instance_id_created_at_idx" ON "instance_billing_records"("instance_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "instance_billing_records_user_id_created_at_idx" ON "instance_billing_records"("user_id", "created_at" DESC);

-- AddForeignKey (only if not exists - handle gracefully)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'balance_logs_user_id_fkey') THEN
        ALTER TABLE "balance_logs" ADD CONSTRAINT "balance_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recharge_records_user_id_fkey') THEN
        ALTER TABLE "recharge_records" ADD CONSTRAINT "recharge_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recharge_records_provider_id_fkey') THEN
        ALTER TABLE "recharge_records" ADD CONSTRAINT "recharge_records_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_plans_package_id_fkey') THEN
        ALTER TABLE "package_plans" ADD CONSTRAINT "package_plans_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'instances_package_plan_id_fkey') THEN
        ALTER TABLE "instances" ADD CONSTRAINT "instances_package_plan_id_fkey" FOREIGN KEY ("package_plan_id") REFERENCES "package_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'instance_billing_records_instance_id_fkey') THEN
        ALTER TABLE "instance_billing_records" ADD CONSTRAINT "instance_billing_records_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Remove old billing fields from packages (if exist)
ALTER TABLE "packages" DROP COLUMN IF EXISTS "price_monthly";
ALTER TABLE "packages" DROP COLUMN IF EXISTS "setup_fee";
