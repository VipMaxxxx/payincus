-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('S3', 'WEBDAV', 'FTP', 'SFTP');

-- CreateEnum
CREATE TYPE "BackupUploadTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "storage_configs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StorageType" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER,
    "username" TEXT,
    "password" TEXT,
    "base_path" TEXT,
    "extra" JSONB,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_upload_tasks" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "backup_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "storage_config_id" INTEGER NOT NULL,
    "status" "BackupUploadTaskStatus" NOT NULL DEFAULT 'PENDING',
    "remote_file_name" TEXT,
    "file_size" BIGINT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "backup_upload_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storage_configs_user_id_idx" ON "storage_configs"("user_id");

-- CreateIndex
CREATE INDEX "backup_upload_tasks_host_id_status_idx" ON "backup_upload_tasks"("host_id", "status");

-- CreateIndex
CREATE INDEX "backup_upload_tasks_user_id_idx" ON "backup_upload_tasks"("user_id");

-- CreateIndex
CREATE INDEX "backup_upload_tasks_instance_id_idx" ON "backup_upload_tasks"("instance_id");

-- AddForeignKey
ALTER TABLE "storage_configs" ADD CONSTRAINT "storage_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_upload_tasks" ADD CONSTRAINT "backup_upload_tasks_storage_config_id_fkey" FOREIGN KEY ("storage_config_id") REFERENCES "storage_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
