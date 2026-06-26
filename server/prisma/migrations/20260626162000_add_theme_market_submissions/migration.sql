CREATE TABLE "theme_market_submissions" (
  "id" SERIAL NOT NULL,
  "theme_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "repo_url" TEXT NOT NULL,
  "release_url" TEXT NOT NULL,
  "manifest_url" TEXT NOT NULL,
  "package_url" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "developer_name" TEXT NOT NULL,
  "developer_homepage" TEXT,
  "developer_github" TEXT,
  "contact_email" TEXT NOT NULL,
  "compatibility" JSONB NOT NULL DEFAULT '{}',
  "tokens" JSONB NOT NULL DEFAULT '[]',
  "layout_slots" JSONB NOT NULL DEFAULT '[]',
  "notes" TEXT,
  "review_status" TEXT NOT NULL DEFAULT 'pending',
  "risk_level" TEXT NOT NULL DEFAULT 'medium',
  "review_notes" TEXT,
  "scan_status" TEXT NOT NULL DEFAULT 'pending',
  "scan_result" JSONB NOT NULL DEFAULT '{}',
  "scanned_at" TIMESTAMP(3),
  "submitted_by_user_id" INTEGER NOT NULL,
  "reviewed_by_user_id" INTEGER,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "theme_market_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "theme_market_submissions_theme_id_version_key" ON "theme_market_submissions"("theme_id", "version");
CREATE INDEX "theme_market_submissions_review_status_idx" ON "theme_market_submissions"("review_status");
CREATE INDEX "theme_market_submissions_risk_level_idx" ON "theme_market_submissions"("risk_level");
CREATE INDEX "theme_market_submissions_scan_status_idx" ON "theme_market_submissions"("scan_status");
CREATE INDEX "theme_market_submissions_submitted_by_user_id_idx" ON "theme_market_submissions"("submitted_by_user_id");
CREATE INDEX "theme_market_submissions_reviewed_by_user_id_idx" ON "theme_market_submissions"("reviewed_by_user_id");
CREATE INDEX "theme_market_submissions_created_at_idx" ON "theme_market_submissions"("created_at");

ALTER TABLE "theme_market_submissions"
  ADD CONSTRAINT "theme_market_submissions_submitted_by_user_id_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "theme_market_submissions"
  ADD CONSTRAINT "theme_market_submissions_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
