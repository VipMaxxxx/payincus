-- CreateTable
CREATE TABLE "plugin_market_submissions" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
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
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "compatibility" JSONB NOT NULL DEFAULT '{}',
    "pricing" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'pending',
    "risk_level" TEXT NOT NULL DEFAULT 'medium',
    "review_notes" TEXT,
    "submitted_by_user_id" INTEGER NOT NULL,
    "reviewed_by_user_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_market_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_market_submissions_plugin_id_version_key" ON "plugin_market_submissions"("plugin_id", "version");

-- CreateIndex
CREATE INDEX "plugin_market_submissions_review_status_idx" ON "plugin_market_submissions"("review_status");

-- CreateIndex
CREATE INDEX "plugin_market_submissions_risk_level_idx" ON "plugin_market_submissions"("risk_level");

-- CreateIndex
CREATE INDEX "plugin_market_submissions_submitted_by_user_id_idx" ON "plugin_market_submissions"("submitted_by_user_id");

-- CreateIndex
CREATE INDEX "plugin_market_submissions_reviewed_by_user_id_idx" ON "plugin_market_submissions"("reviewed_by_user_id");

-- CreateIndex
CREATE INDEX "plugin_market_submissions_created_at_idx" ON "plugin_market_submissions"("created_at");

-- AddForeignKey
ALTER TABLE "plugin_market_submissions" ADD CONSTRAINT "plugin_market_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_market_submissions" ADD CONSTRAINT "plugin_market_submissions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
