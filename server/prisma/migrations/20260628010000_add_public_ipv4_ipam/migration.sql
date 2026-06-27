-- Add productized public IPv4 delivery modes and IPAM tables.
ALTER TYPE "NetworkMode" ADD VALUE IF NOT EXISTS 'public_ipv4';
ALTER TYPE "NetworkMode" ADD VALUE IF NOT EXISTS 'public_ipv4_ipv6';

DO $$ BEGIN
  CREATE TYPE "PublicIpv4AddressStatus" AS ENUM ('free', 'assigned', 'disabled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "public_ipv4_pools" (
  "id" SERIAL PRIMARY KEY,
  "host_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "cidr" TEXT,
  "gateway" TEXT NOT NULL,
  "prefix_length" INTEGER NOT NULL DEFAULT 32,
  "dns" JSONB NOT NULL DEFAULT '[]',
  "route_mode" TEXT NOT NULL DEFAULT 'routed',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_ipv4_pools_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "public_ipv4_addresses" (
  "id" SERIAL PRIMARY KEY,
  "pool_id" INTEGER,
  "host_id" INTEGER NOT NULL,
  "instance_id" INTEGER,
  "address" TEXT NOT NULL,
  "prefix_length" INTEGER NOT NULL DEFAULT 32,
  "gateway" TEXT,
  "dns" JSONB NOT NULL DEFAULT '[]',
  "status" "PublicIpv4AddressStatus" NOT NULL DEFAULT 'free',
  "assigned_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_ipv4_addresses_pool_id_fkey"
    FOREIGN KEY ("pool_id") REFERENCES "public_ipv4_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "public_ipv4_addresses_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "public_ipv4_addresses_instance_id_fkey"
    FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_ipv4_addresses_host_id_address_key"
  ON "public_ipv4_addresses"("host_id", "address");

CREATE UNIQUE INDEX IF NOT EXISTS "public_ipv4_addresses_instance_id_key"
  ON "public_ipv4_addresses"("instance_id");

CREATE INDEX IF NOT EXISTS "public_ipv4_pools_host_id_enabled_idx"
  ON "public_ipv4_pools"("host_id", "enabled");

CREATE INDEX IF NOT EXISTS "public_ipv4_addresses_host_id_status_idx"
  ON "public_ipv4_addresses"("host_id", "status");

CREATE INDEX IF NOT EXISTS "public_ipv4_addresses_pool_id_status_idx"
  ON "public_ipv4_addresses"("pool_id", "status");
