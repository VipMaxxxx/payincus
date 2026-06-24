-- CreateEnum
CREATE TYPE "BalanceAdjustmentRequestType" AS ENUM ('manual_adjust', 'refund');

-- CreateEnum
CREATE TYPE "BalanceAdjustmentRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "balance_adjustment_requests" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "requested_by_user_id" INTEGER NOT NULL,
    "reviewed_by_user_id" INTEGER,
    "amount" DECIMAL(10,2) NOT NULL,
    "request_type" "BalanceAdjustmentRequestType" NOT NULL DEFAULT 'manual_adjust',
    "status" "BalanceAdjustmentRequestStatus" NOT NULL DEFAULT 'pending',
    "source_type" TEXT,
    "source_id" INTEGER,
    "order_no" TEXT,
    "reason" TEXT NOT NULL,
    "review_remark" TEXT,
    "balance_log_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "balance_adjustment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "balance_adjustment_requests_balance_log_id_key" ON "balance_adjustment_requests"("balance_log_id");

-- CreateIndex
CREATE INDEX "balance_adjustment_requests_status_created_at_idx" ON "balance_adjustment_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "balance_adjustment_requests_user_id_created_at_idx" ON "balance_adjustment_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "balance_adjustment_requests_requested_by_user_id_idx" ON "balance_adjustment_requests"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "balance_adjustment_requests_reviewed_by_user_id_idx" ON "balance_adjustment_requests"("reviewed_by_user_id");

-- CreateIndex
CREATE INDEX "balance_adjustment_requests_order_no_idx" ON "balance_adjustment_requests"("order_no");

-- AddForeignKey
ALTER TABLE "balance_adjustment_requests" ADD CONSTRAINT "balance_adjustment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_adjustment_requests" ADD CONSTRAINT "balance_adjustment_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_adjustment_requests" ADD CONSTRAINT "balance_adjustment_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_adjustment_requests" ADD CONSTRAINT "balance_adjustment_requests_balance_log_id_fkey" FOREIGN KEY ("balance_log_id") REFERENCES "balance_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
