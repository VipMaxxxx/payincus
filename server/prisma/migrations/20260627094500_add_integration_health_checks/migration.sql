CREATE TABLE "integration_health_checks" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "detail" TEXT,
  "duration_ms" INTEGER NOT NULL,
  "checked_at" TIMESTAMP(3) NOT NULL,
  "checked_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_health_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_health_checks_key_checked_at_idx" ON "integration_health_checks"("key", "checked_at");
CREATE INDEX "integration_health_checks_status_checked_at_idx" ON "integration_health_checks"("status", "checked_at");
CREATE INDEX "integration_health_checks_checked_at_idx" ON "integration_health_checks"("checked_at");
