-- AlterTable
ALTER TABLE "plugin_market_submissions"
ADD COLUMN "scan_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "scan_result" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "scanned_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "plugin_market_submissions_scan_status_idx" ON "plugin_market_submissions"("scan_status");
