-- CreateEnum (with IF NOT EXISTS to handle partial migrations)
DO $$ BEGIN
    CREATE TYPE "IpType" AS ENUM ('inet4', 'inet6');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable (with IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "ip_addresses" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "type" "IpType" NOT NULL DEFAULT 'inet6',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "device" TEXT NOT NULL DEFAULT 'eth0',
    "instance_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (with IF NOT EXISTS)
CREATE UNIQUE INDEX IF NOT EXISTS "ip_addresses_address_key" ON "ip_addresses"("address");

-- CreateIndex (with IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "ip_addresses_instance_id_idx" ON "ip_addresses"("instance_id");

-- AddForeignKey (check if not exists)
DO $$ BEGIN
    ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
