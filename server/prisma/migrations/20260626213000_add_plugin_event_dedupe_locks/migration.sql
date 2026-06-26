-- CreateTable
CREATE TABLE "plugin_event_dedupe_locks" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_flight',
    "event_log_id" INTEGER,
    "expires_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_event_dedupe_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_event_dedupe_locks_plugin_id_event_name_handler_dedupe_key_key" ON "plugin_event_dedupe_locks"("plugin_id", "event_name", "handler", "dedupe_key");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_plugin_id_idx" ON "plugin_event_dedupe_locks"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_event_name_idx" ON "plugin_event_dedupe_locks"("event_name");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_handler_idx" ON "plugin_event_dedupe_locks"("handler");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_dedupe_key_idx" ON "plugin_event_dedupe_locks"("dedupe_key");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_status_idx" ON "plugin_event_dedupe_locks"("status");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_expires_at_idx" ON "plugin_event_dedupe_locks"("expires_at");

-- CreateIndex
CREATE INDEX "plugin_event_dedupe_locks_event_log_id_idx" ON "plugin_event_dedupe_locks"("event_log_id");

-- AddForeignKey
ALTER TABLE "plugin_event_dedupe_locks" ADD CONSTRAINT "plugin_event_dedupe_locks_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;
