-- CreateEnum
CREATE TYPE "SlaAlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "SlaAlertStatus" AS ENUM ('open', 'investigating', 'recovered', 'ignored');

-- CreateEnum
CREATE TYPE "SlaAlertObjectType" AS ENUM ('host', 'agent', 'instance', 'order', 'task', 'notification_channel', 'system_update', 'smtp', 'telegram', 'disk', 'system');

-- CreateEnum
CREATE TYPE "SlaAlertActionType" AS ENUM ('detected', 'merged', 'notified', 'acknowledge', 'mark_recovered', 'ignore', 'silence', 'rule_update');

-- CreateTable
CREATE TABLE "sla_alert_rules" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "SlaAlertSeverity" NOT NULL DEFAULT 'warning',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold_minutes" INTEGER,
    "threshold_count" INTEGER,
    "dedupe_minutes" INTEGER NOT NULL DEFAULT 30,
    "notification_channels" JSONB NOT NULL DEFAULT '[]',
    "silence_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_alert_events" (
    "id" SERIAL NOT NULL,
    "rule_code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "severity" "SlaAlertSeverity" NOT NULL,
    "status" "SlaAlertStatus" NOT NULL DEFAULT 'open',
    "object_type" "SlaAlertObjectType" NOT NULL,
    "object_id" INTEGER,
    "object_label" TEXT,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "trigger_count" INTEGER NOT NULL DEFAULT 1,
    "first_triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recovered_at" TIMESTAMP(3),
    "silenced_until" TIMESTAMP(3),
    "handled_by_user_id" INTEGER,
    "handled_by_username" TEXT,
    "handled_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_alert_actions" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "action_type" "SlaAlertActionType" NOT NULL,
    "actor_user_id" INTEGER,
    "actor_username" TEXT,
    "note" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_alert_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sla_alert_rules_code_key" ON "sla_alert_rules"("code");

-- CreateIndex
CREATE INDEX "sla_alert_rules_enabled_module_idx" ON "sla_alert_rules"("enabled", "module");

-- CreateIndex
CREATE INDEX "sla_alert_rules_severity_idx" ON "sla_alert_rules"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "sla_alert_events_rule_code_fingerprint_key" ON "sla_alert_events"("rule_code", "fingerprint");

-- CreateIndex
CREATE INDEX "sla_alert_events_status_severity_last_triggered_at_idx" ON "sla_alert_events"("status", "severity", "last_triggered_at" DESC);

-- CreateIndex
CREATE INDEX "sla_alert_events_module_status_idx" ON "sla_alert_events"("module", "status");

-- CreateIndex
CREATE INDEX "sla_alert_events_object_type_object_id_idx" ON "sla_alert_events"("object_type", "object_id");

-- CreateIndex
CREATE INDEX "sla_alert_events_rule_code_idx" ON "sla_alert_events"("rule_code");

-- CreateIndex
CREATE INDEX "sla_alert_actions_event_id_created_at_idx" ON "sla_alert_actions"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sla_alert_actions_action_type_created_at_idx" ON "sla_alert_actions"("action_type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sla_alert_actions" ADD CONSTRAINT "sla_alert_actions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "sla_alert_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
