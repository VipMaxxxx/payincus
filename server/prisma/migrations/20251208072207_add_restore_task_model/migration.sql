-- CreateEnum
CREATE TYPE "RestoreTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "restored_from" JSONB;

-- CreateTable
CREATE TABLE "restore_tasks" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "backup_id" INTEGER,
    "host_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "RestoreTaskStatus" NOT NULL DEFAULT 'PENDING',
    "temp_instance_name" TEXT,
    "original_instance_name" TEXT NOT NULL,
    "original_incus_id" TEXT NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "restore_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restore_tasks_host_id_status_idx" ON "restore_tasks"("host_id", "status");

-- CreateIndex
CREATE INDEX "restore_tasks_instance_id_idx" ON "restore_tasks"("instance_id");
