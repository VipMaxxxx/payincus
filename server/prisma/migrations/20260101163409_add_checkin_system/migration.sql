-- CreateEnum
CREATE TYPE "RedeemCodeType" AS ENUM ('c', 'r', 'd', 't');

-- CreateTable
CREATE TABLE "checkin_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "redeem_code" TEXT NOT NULL,
    "code_type" "RedeemCodeType" NOT NULL,
    "code_value" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by" INTEGER,
    "used_for" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_stats" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "last_checkin_date" TIMESTAMP(3),
    "last_redeem_date" TIMESTAMP(3),
    "consecutive_others_use" INTEGER NOT NULL DEFAULT 0,
    "self_only_mode" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "checkin_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkin_records_redeem_code_key" ON "checkin_records"("redeem_code");

-- CreateIndex
CREATE INDEX "checkin_records_user_id_idx" ON "checkin_records"("user_id");

-- CreateIndex
CREATE INDEX "checkin_records_used_by_idx" ON "checkin_records"("used_by");

-- CreateIndex
CREATE INDEX "checkin_records_expires_at_idx" ON "checkin_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_stats_user_id_key" ON "checkin_stats"("user_id");

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_used_for_fkey" FOREIGN KEY ("used_for") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_stats" ADD CONSTRAINT "checkin_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
