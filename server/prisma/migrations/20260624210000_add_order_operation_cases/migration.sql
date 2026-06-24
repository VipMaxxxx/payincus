-- CreateEnum
CREATE TYPE "OrderOperationStatus" AS ENUM ('pending_review', 'confirmed', 'compensated', 'closed');

-- CreateTable
CREATE TABLE "order_operation_cases" (
    "id" SERIAL NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" INTEGER NOT NULL,
    "order_no" TEXT,
    "user_id" INTEGER NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "updated_by_user_id" INTEGER,
    "balance_adjustment_request_id" INTEGER,
    "status" "OrderOperationStatus" NOT NULL DEFAULT 'pending_review',
    "reason" TEXT NOT NULL,
    "result" TEXT,
    "refund_amount" DECIMAL(10,2),
    "provider_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_operation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_operation_cases_balance_adjustment_request_id_key" ON "order_operation_cases"("balance_adjustment_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_operation_cases_source_type_source_id_key" ON "order_operation_cases"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "order_operation_cases_status_created_at_idx" ON "order_operation_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "order_operation_cases_user_id_created_at_idx" ON "order_operation_cases"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "order_operation_cases_order_no_idx" ON "order_operation_cases"("order_no");

-- CreateIndex
CREATE INDEX "order_operation_cases_created_by_user_id_idx" ON "order_operation_cases"("created_by_user_id");

-- CreateIndex
CREATE INDEX "order_operation_cases_updated_by_user_id_idx" ON "order_operation_cases"("updated_by_user_id");

-- AddForeignKey
ALTER TABLE "order_operation_cases" ADD CONSTRAINT "order_operation_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_operation_cases" ADD CONSTRAINT "order_operation_cases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_operation_cases" ADD CONSTRAINT "order_operation_cases_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_operation_cases" ADD CONSTRAINT "order_operation_cases_balance_adjustment_request_id_fkey" FOREIGN KEY ("balance_adjustment_request_id") REFERENCES "balance_adjustment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
