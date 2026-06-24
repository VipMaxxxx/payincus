CREATE TABLE "host_cost_profiles" (
  "id" SERIAL NOT NULL,
  "host_id" INTEGER NOT NULL,
  "monthly_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "ipv4_monthly_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "traffic_tb_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "notes" TEXT,
  "updated_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "host_cost_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capacity_snapshots" (
  "id" SERIAL NOT NULL,
  "host_id" INTEGER NOT NULL,
  "captured_date" DATE NOT NULL,
  "cpu_total" INTEGER NOT NULL,
  "cpu_used" INTEGER NOT NULL,
  "memory_total" INTEGER NOT NULL,
  "memory_used" INTEGER NOT NULL,
  "disk_total" INTEGER NOT NULL,
  "disk_used" INTEGER NOT NULL,
  "nat_port_total" INTEGER NOT NULL,
  "nat_port_used" INTEGER NOT NULL,
  "instance_count" INTEGER NOT NULL,
  "traffic_used_bytes" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "capacity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "host_cost_profiles_host_id_key" ON "host_cost_profiles"("host_id");
CREATE INDEX "host_cost_profiles_updated_by_user_id_idx" ON "host_cost_profiles"("updated_by_user_id");
CREATE UNIQUE INDEX "capacity_snapshots_host_id_captured_date_key" ON "capacity_snapshots"("host_id", "captured_date");
CREATE INDEX "capacity_snapshots_captured_date_idx" ON "capacity_snapshots"("captured_date");
CREATE INDEX "capacity_snapshots_host_id_captured_date_idx" ON "capacity_snapshots"("host_id", "captured_date");

ALTER TABLE "host_cost_profiles" ADD CONSTRAINT "host_cost_profiles_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capacity_snapshots" ADD CONSTRAINT "capacity_snapshots_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
