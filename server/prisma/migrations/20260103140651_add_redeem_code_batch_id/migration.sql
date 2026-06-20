-- AlterTable
ALTER TABLE "redeem_codes" ADD COLUMN     "batch_id" TEXT;

-- CreateIndex
CREATE INDEX "redeem_codes_batch_id_idx" ON "redeem_codes"("batch_id");
