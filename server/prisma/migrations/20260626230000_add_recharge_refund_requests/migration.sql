-- CreateEnum
CREATE TYPE "RechargeRefundStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "recharge_refund_requests" (
    "id" SERIAL NOT NULL,
    "recharge_record_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "requested_by_user_id" INTEGER NOT NULL,
    "processed_by_user_id" INTEGER,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RechargeRefundStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "provider_refund_id" TEXT,
    "provider_status" TEXT,
    "provider_message" TEXT,
    "provider_metadata" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "recharge_refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recharge_refund_requests_idempotency_key_key" ON "recharge_refund_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "recharge_refund_requests_recharge_record_id_status_idx" ON "recharge_refund_requests"("recharge_record_id", "status");

-- CreateIndex
CREATE INDEX "recharge_refund_requests_user_id_created_at_idx" ON "recharge_refund_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "recharge_refund_requests_provider_id_status_idx" ON "recharge_refund_requests"("provider_id", "status");

-- CreateIndex
CREATE INDEX "recharge_refund_requests_status_created_at_idx" ON "recharge_refund_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "recharge_refund_requests" ADD CONSTRAINT "recharge_refund_requests_recharge_record_id_fkey" FOREIGN KEY ("recharge_record_id") REFERENCES "recharge_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recharge_refund_requests" ADD CONSTRAINT "recharge_refund_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recharge_refund_requests" ADD CONSTRAINT "recharge_refund_requests_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recharge_refund_requests" ADD CONSTRAINT "recharge_refund_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recharge_refund_requests" ADD CONSTRAINT "recharge_refund_requests_processed_by_user_id_fkey" FOREIGN KEY ("processed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
