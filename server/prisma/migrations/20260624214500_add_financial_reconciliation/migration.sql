-- CreateEnum
CREATE TYPE "FinancialReconciliationStatus" AS ENUM ('normal', 'discrepancy', 'confirmed', 'ignored');

-- CreateEnum
CREATE TYPE "FinancialReconciliationItemType" AS ENUM ('recharge_missing_balance_log', 'orphan_balance_log', 'delivered_instance_missing_billing', 'approved_adjustment_missing_balance_log');

-- CreateTable
CREATE TABLE "financial_reconciliation_runs" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "status" "FinancialReconciliationStatus" NOT NULL DEFAULT 'normal',
    "summary" JSONB NOT NULL,
    "created_by_user_id" INTEGER,
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_reconciliation_items" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "item_key" TEXT NOT NULL,
    "item_type" "FinancialReconciliationItemType" NOT NULL,
    "status" "FinancialReconciliationStatus" NOT NULL DEFAULT 'discrepancy',
    "source_type" TEXT NOT NULL,
    "source_id" INTEGER,
    "user_id" INTEGER,
    "amount" DECIMAL(10,2),
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "note" TEXT,
    "handled_by_user_id" INTEGER,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_reconciliation_runs_date_key" ON "financial_reconciliation_runs"("date");

-- CreateIndex
CREATE INDEX "financial_reconciliation_runs_status_date_idx" ON "financial_reconciliation_runs"("status", "date");

-- CreateIndex
CREATE INDEX "financial_reconciliation_runs_created_by_user_id_idx" ON "financial_reconciliation_runs"("created_by_user_id");

-- CreateIndex
CREATE INDEX "financial_reconciliation_runs_updated_by_user_id_idx" ON "financial_reconciliation_runs"("updated_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_reconciliation_items_run_id_item_key_key" ON "financial_reconciliation_items"("run_id", "item_key");

-- CreateIndex
CREATE INDEX "financial_reconciliation_items_run_id_status_idx" ON "financial_reconciliation_items"("run_id", "status");

-- CreateIndex
CREATE INDEX "financial_reconciliation_items_item_type_idx" ON "financial_reconciliation_items"("item_type");

-- CreateIndex
CREATE INDEX "financial_reconciliation_items_source_type_source_id_idx" ON "financial_reconciliation_items"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "financial_reconciliation_items_user_id_idx" ON "financial_reconciliation_items"("user_id");

-- CreateIndex
CREATE INDEX "financial_reconciliation_items_handled_by_user_id_idx" ON "financial_reconciliation_items"("handled_by_user_id");

-- AddForeignKey
ALTER TABLE "financial_reconciliation_runs" ADD CONSTRAINT "financial_reconciliation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reconciliation_runs" ADD CONSTRAINT "financial_reconciliation_runs_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reconciliation_items" ADD CONSTRAINT "financial_reconciliation_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "financial_reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reconciliation_items" ADD CONSTRAINT "financial_reconciliation_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_reconciliation_items" ADD CONSTRAINT "financial_reconciliation_items_handled_by_user_id_fkey" FOREIGN KEY ("handled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
