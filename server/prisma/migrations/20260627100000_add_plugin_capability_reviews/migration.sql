CREATE TABLE "plugin_capability_reviews" (
  "id" SERIAL NOT NULL,
  "plugin_id" TEXT NOT NULL,
  "manifest_version" TEXT NOT NULL,
  "capability_key" TEXT NOT NULL,
  "capability_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "risk_level" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "hooks" JSONB NOT NULL DEFAULT '[]',
  "review_notes" TEXT,
  "reviewed_by_user_id" INTEGER,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plugin_capability_reviews_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "plugin_capability_reviews"
  ADD CONSTRAINT "plugin_capability_reviews_plugin_id_fkey"
  FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "plugin_capability_reviews_plugin_id_manifest_version_capability_key_key"
  ON "plugin_capability_reviews"("plugin_id", "manifest_version", "capability_key");

CREATE INDEX "plugin_capability_reviews_plugin_id_status_idx" ON "plugin_capability_reviews"("plugin_id", "status");
CREATE INDEX "plugin_capability_reviews_status_risk_level_idx" ON "plugin_capability_reviews"("status", "risk_level");
CREATE INDEX "plugin_capability_reviews_capability_type_idx" ON "plugin_capability_reviews"("capability_type");
