ALTER TABLE "traffic_snapshots"
ADD COLUMN IF NOT EXISTS "rx_packets_raw" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "tx_packets_raw" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cpu_usage_raw" BIGINT;

CREATE TABLE IF NOT EXISTS "resource_risk_policies" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '默认策略',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "bandwidth_window_minutes" INTEGER NOT NULL DEFAULT 60,
  "bandwidth_active_minutes" INTEGER NOT NULL DEFAULT 45,
  "bandwidth_threshold_mbps" INTEGER NOT NULL DEFAULT 100,
  "cpu_window_minutes" INTEGER NOT NULL DEFAULT 60,
  "cpu_active_minutes" INTEGER NOT NULL DEFAULT 45,
  "cpu_threshold_percent" INTEGER NOT NULL DEFAULT 90,
  "pps_threshold" INTEGER NOT NULL DEFAULT 20000,
  "packet_small_ratio_threshold" INTEGER NOT NULL DEFAULT 85,
  "qos_tiers" JSONB NOT NULL DEFAULT '[{"level":1,"bandwidthMbps":50,"score":50},{"level":2,"bandwidthMbps":30,"score":65},{"level":3,"bandwidthMbps":10,"score":80}]',
  "score_decay_per_hour" INTEGER NOT NULL DEFAULT 3,
  "order_restrict_score" INTEGER NOT NULL DEFAULT 70,
  "auto_suspend_score" INTEGER NOT NULL DEFAULT 90,
  "auto_suspend_enabled" BOOLEAN NOT NULL DEFAULT false,
  "account_order_restrict_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "resource_risk_policies_enabled_idx" ON "resource_risk_policies" ("enabled");

INSERT INTO "resource_risk_policies" ("name")
SELECT '默认策略'
WHERE NOT EXISTS (SELECT 1 FROM "resource_risk_policies");

CREATE TABLE IF NOT EXISTS "instance_risk_states" (
  "id" SERIAL PRIMARY KEY,
  "instance_id" INTEGER NOT NULL UNIQUE,
  "user_id" INTEGER NOT NULL,
  "host_id" INTEGER NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "level" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'normal',
  "qos_level" INTEGER NOT NULL DEFAULT 0,
  "current_bandwidth_limit" TEXT,
  "original_ingress" TEXT,
  "original_egress" TEXT,
  "cpu_limited" BOOLEAN NOT NULL DEFAULT false,
  "last_evaluated_at" TIMESTAMP(3),
  "last_triggered_at" TIMESTAMP(3),
  "last_recovered_at" TIMESTAMP(3),
  "reason" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_risk_states_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_risk_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_risk_states_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "instance_risk_states_user_id_status_idx" ON "instance_risk_states" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "instance_risk_states_host_id_status_idx" ON "instance_risk_states" ("host_id", "status");
CREATE INDEX IF NOT EXISTS "instance_risk_states_score_idx" ON "instance_risk_states" ("score");
CREATE INDEX IF NOT EXISTS "instance_risk_states_level_idx" ON "instance_risk_states" ("level");

CREATE TABLE IF NOT EXISTS "instance_resource_samples" (
  "id" SERIAL PRIMARY KEY,
  "instance_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "host_id" INTEGER NOT NULL,
  "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rx_bytes_delta" BIGINT NOT NULL DEFAULT 0,
  "tx_bytes_delta" BIGINT NOT NULL DEFAULT 0,
  "total_bytes_delta" BIGINT NOT NULL DEFAULT 0,
  "rx_packets_delta" BIGINT NOT NULL DEFAULT 0,
  "tx_packets_delta" BIGINT NOT NULL DEFAULT 0,
  "total_packets_delta" BIGINT NOT NULL DEFAULT 0,
  "rx_mbps" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tx_mbps" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_mbps" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pps" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "cpu_percent" DECIMAL(8,2),
  "source" TEXT NOT NULL DEFAULT 'traffic_scheduler',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_resource_samples_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_resource_samples_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_resource_samples_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "instance_resource_samples_instance_id_sampled_at_idx" ON "instance_resource_samples" ("instance_id", "sampled_at" DESC);
CREATE INDEX IF NOT EXISTS "instance_resource_samples_user_id_sampled_at_idx" ON "instance_resource_samples" ("user_id", "sampled_at" DESC);
CREATE INDEX IF NOT EXISTS "instance_resource_samples_host_id_sampled_at_idx" ON "instance_resource_samples" ("host_id", "sampled_at" DESC);

CREATE TABLE IF NOT EXISTS "instance_risk_events" (
  "id" SERIAL PRIMARY KEY,
  "instance_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "host_id" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "score_delta" INTEGER NOT NULL DEFAULT 0,
  "score_after" INTEGER NOT NULL DEFAULT 0,
  "action_taken" TEXT,
  "message" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "ticket_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_risk_events_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_risk_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_risk_events_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "instance_risk_events_instance_id_created_at_idx" ON "instance_risk_events" ("instance_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "instance_risk_events_user_id_created_at_idx" ON "instance_risk_events" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "instance_risk_events_severity_created_at_idx" ON "instance_risk_events" ("severity", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "user_order_restrictions" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "reason" TEXT NOT NULL,
  "source_instance_id" INTEGER,
  "source_risk_event_id" INTEGER,
  "ticket_id" INTEGER,
  "restricted_create" BOOLEAN NOT NULL DEFAULT true,
  "restricted_purchase" BOOLEAN NOT NULL DEFAULT true,
  "restricted_renew" BOOLEAN NOT NULL DEFAULT false,
  "review_required" BOOLEAN NOT NULL DEFAULT true,
  "released_by_user_id" INTEGER,
  "released_at" TIMESTAMP(3),
  "release_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_order_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_order_restrictions_source_instance_id_fkey" FOREIGN KEY ("source_instance_id") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "user_order_restrictions_user_id_status_idx" ON "user_order_restrictions" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "user_order_restrictions_source_instance_id_idx" ON "user_order_restrictions" ("source_instance_id");
CREATE INDEX IF NOT EXISTS "user_order_restrictions_source_risk_event_id_idx" ON "user_order_restrictions" ("source_risk_event_id");
