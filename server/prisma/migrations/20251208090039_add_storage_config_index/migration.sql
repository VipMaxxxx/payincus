-- CreateIndex
CREATE INDEX "backup_upload_tasks_storage_config_id_status_idx" ON "backup_upload_tasks"("storage_config_id", "status");
