CREATE TYPE "HostAddressKind" AS ENUM ('domain', 'ipv4', 'ipv6');
CREATE TYPE "HostAddressSource" AS ENUM ('input', 'resolved');
CREATE TYPE "HostAddressCheckTrigger" AS ENUM ('create', 'update', 'backfill', 'poll');
CREATE TYPE "HostAddressCheckStatus" AS ENUM ('success', 'failed');
CREATE TYPE "HostAddressConflictStatus" AS ENUM ('active', 'resolved');

CREATE TABLE "host_address_aliases" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "kind" "HostAddressKind" NOT NULL,
    "source" "HostAddressSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_address_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "host_address_resolution_logs" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "input_address" TEXT NOT NULL,
    "input_kind" "HostAddressKind" NOT NULL,
    "trigger" "HostAddressCheckTrigger" NOT NULL,
    "status" "HostAddressCheckStatus" NOT NULL,
    "resolved_addresses" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "details" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_address_resolution_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "host_address_conflicts" (
    "id" SERIAL NOT NULL,
    "host_a_id" INTEGER NOT NULL,
    "host_b_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "status" "HostAddressConflictStatus" NOT NULL DEFAULT 'active',
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "host_address_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "host_address_aliases_host_id_address_key" ON "host_address_aliases"("host_id", "address");
CREATE INDEX "host_address_aliases_host_id_idx" ON "host_address_aliases"("host_id");
CREATE INDEX "host_address_aliases_address_idx" ON "host_address_aliases"("address");
CREATE INDEX "host_address_aliases_source_kind_idx" ON "host_address_aliases"("source", "kind");

CREATE INDEX "host_address_resolution_logs_host_id_created_at_idx" ON "host_address_resolution_logs"("host_id", "created_at" DESC);
CREATE INDEX "host_address_resolution_logs_status_created_at_idx" ON "host_address_resolution_logs"("status", "created_at" DESC);

CREATE UNIQUE INDEX "host_address_conflicts_host_a_id_host_b_id_address_key" ON "host_address_conflicts"("host_a_id", "host_b_id", "address");
CREATE INDEX "host_address_conflicts_address_idx" ON "host_address_conflicts"("address");
CREATE INDEX "host_address_conflicts_status_last_detected_at_idx" ON "host_address_conflicts"("status", "last_detected_at" DESC);

ALTER TABLE "host_address_aliases"
    ADD CONSTRAINT "host_address_aliases_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_address_resolution_logs"
    ADD CONSTRAINT "host_address_resolution_logs_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_address_conflicts"
    ADD CONSTRAINT "host_address_conflicts_host_a_id_fkey"
    FOREIGN KEY ("host_a_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_address_conflicts"
    ADD CONSTRAINT "host_address_conflicts_host_b_id_fkey"
    FOREIGN KEY ("host_b_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
