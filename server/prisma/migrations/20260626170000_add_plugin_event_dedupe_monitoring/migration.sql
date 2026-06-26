-- AlterTable
ALTER TABLE "plugin_event_logs"
ADD COLUMN "dedupe_key" TEXT,
ADD COLUMN "last_attempt_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "plugin_event_logs_handler_idx" ON "plugin_event_logs"("handler");

-- CreateIndex
CREATE INDEX "plugin_event_logs_dedupe_key_idx" ON "plugin_event_logs"("dedupe_key");

-- CreateIndex
CREATE INDEX "plugin_event_logs_plugin_id_event_name_handler_dedupe_key_idx" ON "plugin_event_logs"("plugin_id", "event_name", "handler", "dedupe_key");

-- CreateIndex
CREATE INDEX "plugin_event_logs_last_attempt_at_idx" ON "plugin_event_logs"("last_attempt_at");
