-- AlterTable
ALTER TABLE "instances" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "instances_idempotency_key_key" ON "instances"("idempotency_key");
