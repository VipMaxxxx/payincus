-- CreateTable
CREATE TABLE "theme_packages" (
    "id" SERIAL NOT NULL,
    "theme_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "manifest" JSONB NOT NULL,
    "tokens" JSONB NOT NULL DEFAULT '{}',
    "css_path" TEXT NOT NULL,
    "install_path" TEXT NOT NULL,
    "package_sha256" TEXT NOT NULL,
    "installed_by_user_id" INTEGER NOT NULL,
    "enabled_by_user_id" INTEGER,
    "enabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theme_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "theme_packages_theme_id_key" ON "theme_packages"("theme_id");

-- CreateIndex
CREATE INDEX "theme_packages_enabled_idx" ON "theme_packages"("enabled");

-- CreateIndex
CREATE INDEX "theme_packages_status_idx" ON "theme_packages"("status");

-- CreateIndex
CREATE INDEX "theme_packages_installed_by_user_id_idx" ON "theme_packages"("installed_by_user_id");

-- CreateIndex
CREATE INDEX "theme_packages_enabled_by_user_id_idx" ON "theme_packages"("enabled_by_user_id");

-- AddForeignKey
ALTER TABLE "theme_packages" ADD CONSTRAINT "theme_packages_installed_by_user_id_fkey" FOREIGN KEY ("installed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_packages" ADD CONSTRAINT "theme_packages_enabled_by_user_id_fkey" FOREIGN KEY ("enabled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
