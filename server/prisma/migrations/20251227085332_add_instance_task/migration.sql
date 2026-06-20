-- CreateEnum
CREATE TYPE "InstanceTaskType" AS ENUM ('start', 'stop', 'restart', 'rebuild', 'clone');

-- CreateEnum
CREATE TYPE "InstanceTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "instance_tasks" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "task_type" "InstanceTaskType" NOT NULL,
    "status" "InstanceTaskStatus" NOT NULL DEFAULT 'PENDING',
    "progress" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "image_alias" TEXT,
    "target_name" TEXT,
    "target_host_id" INTEGER,
    "snapshot_name" TEXT,
    "new_instance_id" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "instance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instance_tasks_host_id_status_idx" ON "instance_tasks"("host_id", "status");

-- CreateIndex
CREATE INDEX "instance_tasks_instance_id_idx" ON "instance_tasks"("instance_id");

-- CreateIndex
CREATE INDEX "instance_tasks_user_id_idx" ON "instance_tasks"("user_id");

-- AddForeignKey
ALTER TABLE "instance_tasks" ADD CONSTRAINT "instance_tasks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
