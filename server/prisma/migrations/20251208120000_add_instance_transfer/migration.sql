-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "instance_transfers" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "from_user_id" INTEGER NOT NULL,
    "to_user_id" INTEGER NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'pending',
    "snapshot" JSONB NOT NULL,
    "remark" TEXT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "instance_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instance_transfers_from_user_id_status_idx" ON "instance_transfers"("from_user_id", "status");

-- CreateIndex
CREATE INDEX "instance_transfers_to_user_id_status_idx" ON "instance_transfers"("to_user_id", "status");

-- CreateIndex
CREATE INDEX "instance_transfers_instance_id_status_idx" ON "instance_transfers"("instance_id", "status");

-- AddForeignKey
ALTER TABLE "instance_transfers" ADD CONSTRAINT "instance_transfers_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_transfers" ADD CONSTRAINT "instance_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instance_transfers" ADD CONSTRAINT "instance_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
