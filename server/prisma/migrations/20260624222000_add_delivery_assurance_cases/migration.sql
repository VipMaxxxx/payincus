-- CreateEnum
CREATE TYPE "DeliveryAssuranceCaseStatus" AS ENUM ('pending_manual', 'auto_retryable', 'in_progress', 'recovered', 'closed');

-- CreateEnum
CREATE TYPE "DeliveryAssuranceIssueType" AS ENUM ('task_failed', 'task_stale', 'host_offline', 'agent_offline', 'resource_pressure');

-- CreateEnum
CREATE TYPE "DeliveryAssuranceActionType" AS ENUM ('detected', 'retry', 'takeover', 'notify_user', 'mark_recovered', 'close');

-- CreateTable
CREATE TABLE "delivery_assurance_cases" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER,
    "instance_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" "DeliveryAssuranceCaseStatus" NOT NULL DEFAULT 'pending_manual',
    "issue_type" "DeliveryAssuranceIssueType" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "retry_task_id" INTEGER,
    "title" TEXT NOT NULL,
    "last_error" TEXT,
    "detail" JSONB,
    "note" TEXT,
    "handled_by_user_id" INTEGER,
    "handled_by_username" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_assurance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_assurance_actions" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "action_type" "DeliveryAssuranceActionType" NOT NULL,
    "actor_user_id" INTEGER,
    "actor_username" TEXT,
    "note" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_assurance_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_assurance_cases_task_id_key" ON "delivery_assurance_cases"("task_id");

-- CreateIndex
CREATE INDEX "delivery_assurance_cases_status_created_at_idx" ON "delivery_assurance_cases"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "delivery_assurance_cases_instance_id_idx" ON "delivery_assurance_cases"("instance_id");

-- CreateIndex
CREATE INDEX "delivery_assurance_cases_host_id_idx" ON "delivery_assurance_cases"("host_id");

-- CreateIndex
CREATE INDEX "delivery_assurance_cases_user_id_idx" ON "delivery_assurance_cases"("user_id");

-- CreateIndex
CREATE INDEX "delivery_assurance_cases_retry_task_id_idx" ON "delivery_assurance_cases"("retry_task_id");

-- CreateIndex
CREATE INDEX "delivery_assurance_actions_case_id_created_at_idx" ON "delivery_assurance_actions"("case_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "delivery_assurance_actions_action_type_created_at_idx" ON "delivery_assurance_actions"("action_type", "created_at" DESC);
