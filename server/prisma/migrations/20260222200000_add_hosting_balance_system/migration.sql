-- 托管余额系统
-- 允许满足条件的用户自行托管节点并获得收益

-- 枚举类型
CREATE TYPE "HostingBalanceType" AS ENUM ('income', 'unfreeze', 'withdraw');
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'approved', 'rejected', 'completed');
CREATE TYPE "WithdrawalTarget" AS ENUM ('balance', 'usdt');

-- 在 users 表添加托管余额字段
ALTER TABLE "users" ADD COLUMN "hosting_balance" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- 托管余额变动日志表
CREATE TABLE "hosting_balance_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "HostingBalanceType" NOT NULL,
    "amount" DECIMAL(10, 2) NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT true,
    "unfreeze_at" TIMESTAMP(3),
    "related_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosting_balance_logs_pkey" PRIMARY KEY ("id")
);

-- 托管余额提现记录表
CREATE TABLE "hosting_withdrawals" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10, 2) NOT NULL,
    "fee_rate" DECIMAL(5, 4) NOT NULL,
    "fee_amount" DECIMAL(10, 2) NOT NULL,
    "actual_amount" DECIMAL(10, 2) NOT NULL,
    "target" "WithdrawalTarget" NOT NULL,
    "usdt_address" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "processed_at" TIMESTAMP(3),
    "processed_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosting_withdrawals_pkey" PRIMARY KEY ("id")
);

-- 索引
CREATE INDEX "hosting_balance_logs_user_id_frozen_idx" ON "hosting_balance_logs"("user_id", "frozen");
CREATE INDEX "hosting_balance_logs_unfreeze_at_idx" ON "hosting_balance_logs"("unfreeze_at");
CREATE INDEX "hosting_withdrawals_user_id_status_idx" ON "hosting_withdrawals"("user_id", "status");

-- 外键约束
ALTER TABLE "hosting_balance_logs" ADD CONSTRAINT "hosting_balance_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hosting_withdrawals" ADD CONSTRAINT "hosting_withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
