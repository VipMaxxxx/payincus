-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "last_synced_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "backup_policies_enabled_next_run_at_idx" ON "backup_policies"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "instances_host_id_status_idx" ON "instances"("host_id", "status");

-- CreateIndex
CREATE INDEX "snapshot_policies_enabled_next_run_at_idx" ON "snapshot_policies"("enabled", "next_run_at");
