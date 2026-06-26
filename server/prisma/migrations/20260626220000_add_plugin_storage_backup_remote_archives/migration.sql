-- CreateTable
CREATE TABLE "plugin_storage_backup_remote_archives" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "backup_id" TEXT NOT NULL,
    "storage_config_id" INTEGER NOT NULL,
    "uploaded_by_user_id" INTEGER NOT NULL,
    "remote_file_name" TEXT NOT NULL,
    "remote_path" TEXT,
    "storage_name" TEXT NOT NULL,
    "storage_type" "StorageType" NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "last_restored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_storage_backup_remote_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_storage_backup_remote_archives_plugin_id_backup_id_storage_config_id_remote_file_name_key" ON "plugin_storage_backup_remote_archives"("plugin_id", "backup_id", "storage_config_id", "remote_file_name");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_plugin_id_idx" ON "plugin_storage_backup_remote_archives"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_backup_id_idx" ON "plugin_storage_backup_remote_archives"("backup_id");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_storage_config_id_idx" ON "plugin_storage_backup_remote_archives"("storage_config_id");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_uploaded_by_user_id_idx" ON "plugin_storage_backup_remote_archives"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_content_sha256_idx" ON "plugin_storage_backup_remote_archives"("content_sha256");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_status_idx" ON "plugin_storage_backup_remote_archives"("status");

-- CreateIndex
CREATE INDEX "plugin_storage_backup_remote_archives_created_at_idx" ON "plugin_storage_backup_remote_archives"("created_at");

-- AddForeignKey
ALTER TABLE "plugin_storage_backup_remote_archives" ADD CONSTRAINT "plugin_storage_backup_remote_archives_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_storage_backup_remote_archives" ADD CONSTRAINT "plugin_storage_backup_remote_archives_storage_config_id_fkey" FOREIGN KEY ("storage_config_id") REFERENCES "storage_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_storage_backup_remote_archives" ADD CONSTRAINT "plugin_storage_backup_remote_archives_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
