-- CreateEnum
CREATE TYPE "SystemUpdateTaskStatus" AS ENUM ('pending', 'running', 'success', 'failed', 'rolled_back');

-- CreateTable
CREATE TABLE "system_update_tasks" (
    "id" SERIAL NOT NULL,
    "target_version" TEXT NOT NULL,
    "from_version" TEXT,
    "status" "SystemUpdateTaskStatus" NOT NULL DEFAULT 'pending',
    "started_by_user_id" INTEGER NOT NULL,
    "backup_path" TEXT,
    "log_path" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_update_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_update_tasks_status_idx" ON "system_update_tasks"("status");

-- CreateIndex
CREATE INDEX "system_update_tasks_target_version_idx" ON "system_update_tasks"("target_version");

-- CreateIndex
CREATE INDEX "system_update_tasks_started_by_user_id_idx" ON "system_update_tasks"("started_by_user_id");

-- CreateIndex
CREATE INDEX "system_update_tasks_created_at_idx" ON "system_update_tasks"("created_at");

-- AddForeignKey
ALTER TABLE "system_update_tasks" ADD CONSTRAINT "system_update_tasks_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
