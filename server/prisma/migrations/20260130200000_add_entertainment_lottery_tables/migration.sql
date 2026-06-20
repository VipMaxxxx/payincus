-- CreateEnum
CREATE TYPE "PointsLogType" AS ENUM ('convert', 'lottery_win', 'lottery_spend', 'admin_adjust');

-- CreateEnum
CREATE TYPE "LotteryPrizeType" AS ENUM ('nothing', 'points', 'balance', 'instance');

-- CreateEnum
CREATE TYPE "LotteryRecordStatus" AS ENUM ('pending', 'delivered', 'claimed', 'expired');

-- CreateTable
CREATE TABLE "user_points" (
    "user_id" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "total_earned" INTEGER NOT NULL DEFAULT 0,
    "total_spent" INTEGER NOT NULL DEFAULT 0,
    "converted_consume" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "last_converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_points_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "points_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "PointsLogType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "points_before" INTEGER NOT NULL,
    "points_after" INTEGER NOT NULL,
    "related_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotteries" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost_points" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "total_draws" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,

    CONSTRAINT "lotteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_prizes" (
    "id" SERIAL NOT NULL,
    "lottery_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LotteryPrizeType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "probability" DECIMAL(5,2) NOT NULL,
    "total_quantity" INTEGER,
    "remain_quantity" INTEGER,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "instance_desc" TEXT,

    CONSTRAINT "lottery_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_records" (
    "id" SERIAL NOT NULL,
    "lottery_id" INTEGER NOT NULL,
    "prize_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "prize_type" "LotteryPrizeType" NOT NULL,
    "prize_value" INTEGER NOT NULL,
    "prize_name" TEXT NOT NULL,
    "status" "LotteryRecordStatus" NOT NULL DEFAULT 'delivered',
    "points_spent" INTEGER NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "delivered_by" INTEGER,
    "ticket_id" INTEGER,
    "notification_sent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_notification_configs" (
    "id" SERIAL NOT NULL,
    "lottery_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "notify_balance" BOOLEAN NOT NULL DEFAULT true,
    "notify_instance" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_notification_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "points_logs_user_id_created_at_idx" ON "points_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lottery_prizes_lottery_id_idx" ON "lottery_prizes"("lottery_id");

-- CreateIndex
CREATE INDEX "lottery_records_user_id_created_at_idx" ON "lottery_records"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "lottery_records_lottery_id_idx" ON "lottery_records"("lottery_id");

-- CreateIndex
CREATE INDEX "lottery_records_status_idx" ON "lottery_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "lottery_notification_configs_lottery_id_key" ON "lottery_notification_configs"("lottery_id");

-- AddForeignKey
ALTER TABLE "user_points" ADD CONSTRAINT "user_points_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_logs" ADD CONSTRAINT "points_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_prizes" ADD CONSTRAINT "lottery_prizes_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_records" ADD CONSTRAINT "lottery_records_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_records" ADD CONSTRAINT "lottery_records_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "lottery_prizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_records" ADD CONSTRAINT "lottery_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_notification_configs" ADD CONSTRAINT "lottery_notification_configs_lottery_id_fkey" FOREIGN KEY ("lottery_id") REFERENCES "lotteries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
