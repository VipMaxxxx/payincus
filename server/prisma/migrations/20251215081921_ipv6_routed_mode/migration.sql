-- AlterTable
ALTER TABLE "hosts" ADD COLUMN     "ipv6_parent_interface" TEXT;

-- AlterTable
ALTER TABLE "ip_addresses" ADD COLUMN     "is_custom" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "device" SET DEFAULT 'eth1';

-- CreateTable
CREATE TABLE "ipv6_subnets" (
    "id" SERIAL NOT NULL,
    "cidr" TEXT NOT NULL,
    "primary_ip" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'eth1',
    "instance_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ipv6_subnets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ipv6_subnets_cidr_key" ON "ipv6_subnets"("cidr");

-- CreateIndex
CREATE INDEX "ipv6_subnets_instance_id_idx" ON "ipv6_subnets"("instance_id");

-- AddForeignKey
ALTER TABLE "ipv6_subnets" ADD CONSTRAINT "ipv6_subnets_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
