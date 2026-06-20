-- CreateEnum
CREATE TYPE "TrafficStatus" AS ENUM ('NORMAL', 'WARNING', 'LIMITED');

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "monthly_traffic_limit" BIGINT,
ADD COLUMN     "monthly_traffic_used" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "traffic_status" "TrafficStatus" NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "user_quotas" ADD COLUMN     "extra_traffic_quota" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "extra_traffic_used" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "monthly_traffic_limit" BIGINT,
ADD COLUMN     "monthly_traffic_used" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "traffic_status" "TrafficStatus" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "traffic_warning_sent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "traffic_snapshots" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "rx_raw" BIGINT NOT NULL,
    "tx_raw" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traffic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_traffic" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "rx_total" BIGINT NOT NULL,
    "tx_total" BIGINT NOT NULL,

    CONSTRAINT "daily_traffic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "traffic_snapshots_instance_id_key" ON "traffic_snapshots"("instance_id");

-- CreateIndex
CREATE INDEX "daily_traffic_instance_id_date_idx" ON "daily_traffic"("instance_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_traffic_instance_id_date_key" ON "daily_traffic"("instance_id", "date");

-- AddForeignKey
ALTER TABLE "traffic_snapshots" ADD CONSTRAINT "traffic_snapshots_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_traffic" ADD CONSTRAINT "daily_traffic_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
