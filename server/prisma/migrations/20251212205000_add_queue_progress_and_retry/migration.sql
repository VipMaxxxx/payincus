-- Add progress and retryCount fields to RestoreTask
ALTER TABLE "restore_tasks" ADD COLUMN "progress" TEXT;
ALTER TABLE "restore_tasks" ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;

-- Add progress and retryCount fields to BackupUploadTask
ALTER TABLE "backup_upload_tasks" ADD COLUMN "progress" TEXT;
ALTER TABLE "backup_upload_tasks" ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0;
