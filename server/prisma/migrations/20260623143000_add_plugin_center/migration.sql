-- CreateEnum
CREATE TYPE "PluginStatus" AS ENUM ('installed', 'enabled', 'disabled', 'failed');

-- CreateEnum
CREATE TYPE "PluginInstallTaskStatus" AS ENUM ('pending', 'running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "PluginInstallTaskAction" AS ENUM ('upload_install', 'market_install', 'enable', 'disable', 'uninstall');

-- CreateEnum
CREATE TYPE "PluginSourceType" AS ENUM ('upload', 'market');

-- CreateTable
CREATE TABLE "plugins" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PluginStatus" NOT NULL DEFAULT 'installed',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "current_version" TEXT,
    "source_type" "PluginSourceType" NOT NULL DEFAULT 'upload',
    "source_repo" TEXT,
    "installed_by_user_id" INTEGER NOT NULL,
    "enabled_by_user_id" INTEGER,
    "enabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_versions" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "package_sha256" TEXT NOT NULL,
    "install_path" TEXT NOT NULL,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_install_tasks" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT,
    "action" "PluginInstallTaskAction" NOT NULL,
    "status" "PluginInstallTaskStatus" NOT NULL DEFAULT 'pending',
    "source_type" "PluginSourceType" NOT NULL DEFAULT 'upload',
    "source_url" TEXT,
    "log_path" TEXT,
    "error_message" TEXT,
    "started_by_user_id" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_install_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_configs" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value_encrypted" TEXT,
    "value_json" JSONB,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_market_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_market_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_event_logs" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_user_data" (
    "id" SERIAL NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_user_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugins_plugin_id_key" ON "plugins"("plugin_id");

-- CreateIndex
CREATE INDEX "plugins_status_idx" ON "plugins"("status");

-- CreateIndex
CREATE INDEX "plugins_enabled_idx" ON "plugins"("enabled");

-- CreateIndex
CREATE INDEX "plugins_source_type_idx" ON "plugins"("source_type");

-- CreateIndex
CREATE INDEX "plugins_installed_by_user_id_idx" ON "plugins"("installed_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_versions_plugin_id_version_key" ON "plugin_versions"("plugin_id", "version");

-- CreateIndex
CREATE INDEX "plugin_versions_plugin_id_idx" ON "plugin_versions"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_install_tasks_plugin_id_idx" ON "plugin_install_tasks"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_install_tasks_status_idx" ON "plugin_install_tasks"("status");

-- CreateIndex
CREATE INDEX "plugin_install_tasks_action_idx" ON "plugin_install_tasks"("action");

-- CreateIndex
CREATE INDEX "plugin_install_tasks_started_by_user_id_idx" ON "plugin_install_tasks"("started_by_user_id");

-- CreateIndex
CREATE INDEX "plugin_install_tasks_created_at_idx" ON "plugin_install_tasks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_configs_plugin_id_key_key" ON "plugin_configs"("plugin_id", "key");

-- CreateIndex
CREATE INDEX "plugin_configs_plugin_id_idx" ON "plugin_configs"("plugin_id");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_market_sources_url_key" ON "plugin_market_sources"("url");

-- CreateIndex
CREATE INDEX "plugin_market_sources_enabled_idx" ON "plugin_market_sources"("enabled");

-- CreateIndex
CREATE INDEX "plugin_event_logs_plugin_id_idx" ON "plugin_event_logs"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_event_logs_user_id_idx" ON "plugin_event_logs"("user_id");

-- CreateIndex
CREATE INDEX "plugin_event_logs_action_idx" ON "plugin_event_logs"("action");

-- CreateIndex
CREATE INDEX "plugin_event_logs_created_at_idx" ON "plugin_event_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_user_data_plugin_id_user_id_key_key" ON "plugin_user_data"("plugin_id", "user_id", "key");

-- CreateIndex
CREATE INDEX "plugin_user_data_plugin_id_idx" ON "plugin_user_data"("plugin_id");

-- CreateIndex
CREATE INDEX "plugin_user_data_user_id_idx" ON "plugin_user_data"("user_id");

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_installed_by_user_id_fkey" FOREIGN KEY ("installed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_enabled_by_user_id_fkey" FOREIGN KEY ("enabled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_versions" ADD CONSTRAINT "plugin_versions_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_install_tasks" ADD CONSTRAINT "plugin_install_tasks_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_install_tasks" ADD CONSTRAINT "plugin_install_tasks_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_configs" ADD CONSTRAINT "plugin_configs_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_event_logs" ADD CONSTRAINT "plugin_event_logs_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_event_logs" ADD CONSTRAINT "plugin_event_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_user_data" ADD CONSTRAINT "plugin_user_data_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_user_data" ADD CONSTRAINT "plugin_user_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
