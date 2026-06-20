-- Manual instance audit rules, whitelists, scan history, and action history.
-- These tables are isolated from core instance and billing state so deployment is additive.

CREATE TABLE "instance_audit_rules" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER,
    "created_by_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "category" TEXT NOT NULL DEFAULT 'custom',
    "target_types" JSONB NOT NULL DEFAULT '[]',
    "match_type" TEXT NOT NULL DEFAULT 'contains',
    "pattern" TEXT NOT NULL,
    "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "recommendation" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_audit_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "instance_audit_ignores" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "instance_id" INTEGER,
    "created_by_id" INTEGER NOT NULL,
    "rule_id" TEXT,
    "target_type" TEXT,
    "match_text" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'instance',
    "reason" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_audit_ignores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "instance_audit_scans" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "capability" TEXT,
    "risk_level" TEXT NOT NULL,
    "finding_count" INTEGER NOT NULL DEFAULT 0,
    "ignored_count" INTEGER NOT NULL DEFAULT 0,
    "process_count" INTEGER NOT NULL DEFAULT 0,
    "connection_count" INTEGER NOT NULL DEFAULT 0,
    "listening_count" INTEGER NOT NULL DEFAULT 0,
    "startup_item_count" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_audit_scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "instance_audit_actions" (
    "id" SERIAL NOT NULL,
    "scan_id" INTEGER,
    "host_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action_type" TEXT NOT NULL,
    "pid" INTEGER,
    "signal" TEXT,
    "process_command" TEXT,
    "reason" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "stdout" TEXT,
    "stderr" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_audit_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instance_audit_rules_host_id_enabled_idx" ON "instance_audit_rules"("host_id", "enabled");
CREATE INDEX "instance_audit_rules_created_by_id_idx" ON "instance_audit_rules"("created_by_id");
CREATE INDEX "instance_audit_ignores_host_id_enabled_idx" ON "instance_audit_ignores"("host_id", "enabled");
CREATE INDEX "instance_audit_ignores_instance_id_idx" ON "instance_audit_ignores"("instance_id");
CREATE INDEX "instance_audit_ignores_rule_id_idx" ON "instance_audit_ignores"("rule_id");
CREATE INDEX "instance_audit_scans_host_id_created_at_idx" ON "instance_audit_scans"("host_id", "created_at" DESC);
CREATE INDEX "instance_audit_scans_instance_id_created_at_idx" ON "instance_audit_scans"("instance_id", "created_at" DESC);
CREATE INDEX "instance_audit_actions_host_id_created_at_idx" ON "instance_audit_actions"("host_id", "created_at" DESC);
CREATE INDEX "instance_audit_actions_instance_id_created_at_idx" ON "instance_audit_actions"("instance_id", "created_at" DESC);

ALTER TABLE "instance_audit_rules" ADD CONSTRAINT "instance_audit_rules_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_rules" ADD CONSTRAINT "instance_audit_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_ignores" ADD CONSTRAINT "instance_audit_ignores_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_ignores" ADD CONSTRAINT "instance_audit_ignores_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_ignores" ADD CONSTRAINT "instance_audit_ignores_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_scans" ADD CONSTRAINT "instance_audit_scans_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_scans" ADD CONSTRAINT "instance_audit_scans_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_scans" ADD CONSTRAINT "instance_audit_scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_actions" ADD CONSTRAINT "instance_audit_actions_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "instance_audit_scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "instance_audit_actions" ADD CONSTRAINT "instance_audit_actions_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_actions" ADD CONSTRAINT "instance_audit_actions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_actions" ADD CONSTRAINT "instance_audit_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
