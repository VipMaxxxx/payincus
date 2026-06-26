CREATE TABLE "plugin_event_alert_preferences" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "plugin_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minimum_level" TEXT NOT NULL DEFAULT 'warning',
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 360,
  "notify_on_dead_letter" BOOLEAN NOT NULL DEFAULT true,
  "notify_on_due_retry" BOOLEAN NOT NULL DEFAULT true,
  "notify_on_success_rate_below" BOOLEAN NOT NULL DEFAULT true,
  "success_rate_threshold" INTEGER NOT NULL DEFAULT 95,
  "recent_window_hours" INTEGER NOT NULL DEFAULT 24,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "plugin_event_alert_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plugin_event_alert_preferences_user_id_plugin_id_key"
  ON "plugin_event_alert_preferences"("user_id", "plugin_id");

CREATE INDEX "plugin_event_alert_preferences_plugin_id_idx"
  ON "plugin_event_alert_preferences"("plugin_id");

CREATE INDEX "plugin_event_alert_preferences_user_id_idx"
  ON "plugin_event_alert_preferences"("user_id");

ALTER TABLE "plugin_event_alert_preferences"
  ADD CONSTRAINT "plugin_event_alert_preferences_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
