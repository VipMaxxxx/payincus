-- CreateEnum: AFF Log Types (if not exists)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffLogType') THEN
        CREATE TYPE "AffLogType" AS ENUM ('new_purchase', 'renew', 'convert');
    END IF;
END $$;

-- CreateEnum: AFF Withdrawal Status (if not exists)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AffWithdrawalStatus') THEN
        CREATE TYPE "AffWithdrawalStatus" AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

-- AlterTable: Add AFF fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aff_balance" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aff_activated_at" TIMESTAMP(3);

-- CreateTable: AffCode (优惠码)
CREATE TABLE IF NOT EXISTS "aff_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "package_plan_id" INTEGER NOT NULL,
    "discount_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "commission_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "total_earnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aff_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AffBinding (实例与优惠码绑定)
CREATE TABLE IF NOT EXISTS "aff_bindings" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "aff_code_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aff_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AffLog (AFF余额变动日志)
CREATE TABLE IF NOT EXISTS "aff_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "aff_code_id" INTEGER,
    "instance_id" INTEGER,
    "type" "AffLogType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "original_amount" DECIMAL(10,2),
    "balance_before" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(10,2) NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aff_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AffWithdrawal (AFF余额转化申请)
CREATE TABLE IF NOT EXISTS "aff_withdrawals" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "AffWithdrawalStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aff_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique code
CREATE UNIQUE INDEX IF NOT EXISTS "aff_codes_code_key" ON "aff_codes"("code");

-- CreateIndex: User can only have one code per plan
CREATE UNIQUE INDEX IF NOT EXISTS "aff_codes_user_id_package_plan_id_key" ON "aff_codes"("user_id", "package_plan_id");

-- CreateIndex: AffCode indexes
CREATE INDEX IF NOT EXISTS "aff_codes_user_id_idx" ON "aff_codes"("user_id");
CREATE INDEX IF NOT EXISTS "aff_codes_package_plan_id_idx" ON "aff_codes"("package_plan_id");

-- CreateIndex: AffBinding - one instance can only bind one code
CREATE UNIQUE INDEX IF NOT EXISTS "aff_bindings_instance_id_key" ON "aff_bindings"("instance_id");
CREATE INDEX IF NOT EXISTS "aff_bindings_aff_code_id_idx" ON "aff_bindings"("aff_code_id");

-- CreateIndex: AffLog indexes
CREATE INDEX IF NOT EXISTS "aff_logs_user_id_created_at_idx" ON "aff_logs"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "aff_logs_aff_code_id_idx" ON "aff_logs"("aff_code_id");

-- CreateIndex: AffWithdrawal indexes
CREATE INDEX IF NOT EXISTS "aff_withdrawals_user_id_status_idx" ON "aff_withdrawals"("user_id", "status");
CREATE INDEX IF NOT EXISTS "aff_withdrawals_status_created_at_idx" ON "aff_withdrawals"("status", "created_at");

-- AddForeignKey: AffCode -> User
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_codes_user_id_fkey') THEN
        ALTER TABLE "aff_codes" ADD CONSTRAINT "aff_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: AffCode -> PackagePlan
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_codes_package_plan_id_fkey') THEN
        ALTER TABLE "aff_codes" ADD CONSTRAINT "aff_codes_package_plan_id_fkey" FOREIGN KEY ("package_plan_id") REFERENCES "package_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: AffBinding -> Instance
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_bindings_instance_id_fkey') THEN
        ALTER TABLE "aff_bindings" ADD CONSTRAINT "aff_bindings_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: AffBinding -> AffCode
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_bindings_aff_code_id_fkey') THEN
        ALTER TABLE "aff_bindings" ADD CONSTRAINT "aff_bindings_aff_code_id_fkey" FOREIGN KEY ("aff_code_id") REFERENCES "aff_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: AffLog -> User
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_logs_user_id_fkey') THEN
        ALTER TABLE "aff_logs" ADD CONSTRAINT "aff_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: AffLog -> AffCode (SetNull on delete)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_logs_aff_code_id_fkey') THEN
        ALTER TABLE "aff_logs" ADD CONSTRAINT "aff_logs_aff_code_id_fkey" FOREIGN KEY ("aff_code_id") REFERENCES "aff_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey: AffWithdrawal -> User
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aff_withdrawals_user_id_fkey') THEN
        ALTER TABLE "aff_withdrawals" ADD CONSTRAINT "aff_withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
