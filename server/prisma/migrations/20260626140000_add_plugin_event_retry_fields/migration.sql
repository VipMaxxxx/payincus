-- AlterTable
ALTER TABLE "plugin_event_logs"
ADD COLUMN "event_name" TEXT,
ADD COLUMN "handler" TEXT,
ADD COLUMN "payload" JSONB DEFAULT '{}',
ADD COLUMN "actor" JSONB DEFAULT '{}',
ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "max_retries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "next_retry_at" TIMESTAMP(3),
ADD COLUMN "dead_letter_at" TIMESTAMP(3),
ADD COLUMN "last_error" TEXT;

-- CreateIndex
CREATE INDEX "plugin_event_logs_result_idx" ON "plugin_event_logs"("result");

-- CreateIndex
CREATE INDEX "plugin_event_logs_event_name_idx" ON "plugin_event_logs"("event_name");

-- CreateIndex
CREATE INDEX "plugin_event_logs_next_retry_at_idx" ON "plugin_event_logs"("next_retry_at");

-- CreateIndex
CREATE INDEX "plugin_event_logs_dead_letter_at_idx" ON "plugin_event_logs"("dead_letter_at");
