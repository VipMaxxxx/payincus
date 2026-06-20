/*
  Warnings:

  - A unique constraint covering the columns `[user_id,batch_id]` on the table `redeem_code_usages` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "redeem_code_usages" ADD COLUMN     "batch_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "redeem_code_usages_user_id_batch_id_key" ON "redeem_code_usages"("user_id", "batch_id");
