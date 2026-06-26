CREATE TABLE "public_plugin_action_rate_limit_buckets" (
  "id" SERIAL NOT NULL,
  "token_source" TEXT NOT NULL,
  "token_id" INTEGER NOT NULL,
  "plugin_id" TEXT NOT NULL,
  "action_name" TEXT NOT NULL,
  "policy" TEXT NOT NULL DEFAULT 'normal',
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "reset_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "public_plugin_action_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_plugin_action_rate_limit_buckets_token_source_token_id_plugin_id_action_name_key"
  ON "public_plugin_action_rate_limit_buckets"("token_source", "token_id", "plugin_id", "action_name");

CREATE INDEX "public_plugin_action_rate_limit_buckets_plugin_id_idx"
  ON "public_plugin_action_rate_limit_buckets"("plugin_id");

CREATE INDEX "public_plugin_action_rate_limit_buckets_reset_at_idx"
  ON "public_plugin_action_rate_limit_buckets"("reset_at");

ALTER TABLE "public_plugin_action_rate_limit_buckets"
  ADD CONSTRAINT "public_plugin_action_rate_limit_buckets_plugin_id_fkey"
  FOREIGN KEY ("plugin_id")
  REFERENCES "plugins"("plugin_id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
