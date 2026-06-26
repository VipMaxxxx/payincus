CREATE TABLE "public_plugin_action_rate_limit_policies" (
  "id" SERIAL NOT NULL,
  "plugin_id" TEXT NOT NULL DEFAULT '*',
  "action_name" TEXT NOT NULL DEFAULT '*',
  "rate_limit" TEXT NOT NULL,
  "max_requests" INTEGER NOT NULL,
  "window_seconds" INTEGER NOT NULL DEFAULT 60,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "public_plugin_action_rate_limit_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_plugin_action_rate_limit_policies_rate_limit_check" CHECK ("rate_limit" IN ('normal', 'strict')),
  CONSTRAINT "public_plugin_action_rate_limit_policies_max_requests_check" CHECK ("max_requests" BETWEEN 1 AND 10000),
  CONSTRAINT "public_plugin_action_rate_limit_policies_window_seconds_check" CHECK ("window_seconds" BETWEEN 10 AND 3600)
);

CREATE UNIQUE INDEX "public_plugin_action_rate_limit_policies_plugin_id_action_name_rate_limit_key"
  ON "public_plugin_action_rate_limit_policies"("plugin_id", "action_name", "rate_limit");

CREATE INDEX "public_plugin_action_rate_limit_policies_plugin_id_idx"
  ON "public_plugin_action_rate_limit_policies"("plugin_id");

CREATE INDEX "public_plugin_action_rate_limit_policies_rate_limit_idx"
  ON "public_plugin_action_rate_limit_policies"("rate_limit");

CREATE INDEX "public_plugin_action_rate_limit_policies_enabled_idx"
  ON "public_plugin_action_rate_limit_policies"("enabled");

CREATE INDEX "public_plugin_action_rate_limit_policies_updated_by_user_id_idx"
  ON "public_plugin_action_rate_limit_policies"("updated_by_user_id");

ALTER TABLE "public_plugin_action_rate_limit_policies"
  ADD CONSTRAINT "public_plugin_action_rate_limit_policies_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
