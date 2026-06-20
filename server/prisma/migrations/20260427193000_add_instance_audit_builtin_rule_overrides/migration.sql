CREATE TABLE "instance_audit_builtin_rule_overrides" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "builtin_rule_id" TEXT NOT NULL,
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

    CONSTRAINT "instance_audit_builtin_rule_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instance_audit_builtin_rule_overrides_host_id_builtin_rule_id_key" ON "instance_audit_builtin_rule_overrides"("host_id", "builtin_rule_id");
CREATE INDEX "instance_audit_builtin_rule_overrides_host_id_enabled_idx" ON "instance_audit_builtin_rule_overrides"("host_id", "enabled");
CREATE INDEX "instance_audit_builtin_rule_overrides_created_by_id_idx" ON "instance_audit_builtin_rule_overrides"("created_by_id");

ALTER TABLE "instance_audit_builtin_rule_overrides" ADD CONSTRAINT "instance_audit_builtin_rule_overrides_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instance_audit_builtin_rule_overrides" ADD CONSTRAINT "instance_audit_builtin_rule_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
