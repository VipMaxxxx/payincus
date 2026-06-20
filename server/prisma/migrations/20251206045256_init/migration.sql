-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'banned');

-- CreateEnum
CREATE TYPE "HostStatus" AS ENUM ('online', 'offline', 'maintenance');

-- CreateEnum
CREATE TYPE "InstanceType" AS ENUM ('container', 'vm', 'both');

-- CreateEnum
CREATE TYPE "NetworkMode" AS ENUM ('nat', 'ipv6', 'dual');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('creating', 'running', 'stopped', 'error', 'deleted');

-- CreateEnum
CREATE TYPE "Protocol" AS ENUM ('tcp', 'udp');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('creating', 'ready', 'error', 'deleted');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('telegram', 'discord', 'email', 'webhook');

-- CreateEnum
CREATE TYPE "NotificationLogStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('github', 'google');

-- CreateEnum
CREATE TYPE "HostImageStatus" AS ENUM ('pending', 'syncing', 'ready', 'error');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_quotas" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "cpu_limit" INTEGER NOT NULL DEFAULT 20,
    "cpu_used" INTEGER NOT NULL DEFAULT 0,
    "memory_limit" INTEGER NOT NULL DEFAULT 102400,
    "memory_used" INTEGER NOT NULL DEFAULT 0,
    "disk_limit" INTEGER NOT NULL DEFAULT 512000,
    "disk_used" INTEGER NOT NULL DEFAULT 0,
    "instance_limit" INTEGER NOT NULL DEFAULT 10,
    "instance_used" INTEGER NOT NULL DEFAULT 0,
    "port_limit" INTEGER NOT NULL DEFAULT 20,
    "port_used" INTEGER NOT NULL DEFAULT 0,
    "snapshot_limit" INTEGER NOT NULL DEFAULT 50,
    "snapshot_used" INTEGER NOT NULL DEFAULT 0,
    "backup_limit" INTEGER NOT NULL DEFAULT 30,
    "backup_used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "used_by" INTEGER,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ssh_keys" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssh_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "location" TEXT,
    "country_code" TEXT NOT NULL DEFAULT 'us',
    "node_group_id" INTEGER,
    "status" "HostStatus" NOT NULL DEFAULT 'offline',
    "cert_path" TEXT,
    "key_path" TEXT,
    "nat_public_ip" TEXT,
    "nat_port_start" INTEGER,
    "nat_port_end" INTEGER,
    "cpu_total" INTEGER NOT NULL DEFAULT 0,
    "cpu_used" INTEGER NOT NULL DEFAULT 0,
    "memory_total" INTEGER NOT NULL DEFAULT 0,
    "memory_used" INTEGER NOT NULL DEFAULT 0,
    "disk_total" INTEGER NOT NULL DEFAULT 0,
    "disk_used" INTEGER NOT NULL DEFAULT 0,
    "tags" JSONB DEFAULT '[]',
    "nat_ports_used_count" INTEGER NOT NULL DEFAULT 0,
    "cpu_allowance_max" INTEGER NOT NULL DEFAULT 0,
    "memory_max" INTEGER NOT NULL DEFAULT 0,
    "instance_type" "InstanceType" NOT NULL DEFAULT 'container',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cpu_max" INTEGER NOT NULL,
    "memory_max" INTEGER NOT NULL,
    "disk_max" INTEGER NOT NULL,
    "bandwidth_max" INTEGER,
    "network_mode" "NetworkMode" NOT NULL DEFAULT 'nat',
    "node_group_id" INTEGER,
    "node_selectors" JSONB DEFAULT '[]',
    "privileged" BOOLEAN NOT NULL DEFAULT false,
    "nested" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "port_limit" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" SERIAL NOT NULL,
    "incus_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "package_id" INTEGER,
    "image" TEXT NOT NULL,
    "status" "InstanceStatus" NOT NULL DEFAULT 'creating',
    "cpu" INTEGER NOT NULL,
    "memory" INTEGER NOT NULL,
    "disk" INTEGER NOT NULL,
    "ipv4" TEXT,
    "ipv6" TEXT,
    "network_mode" "NetworkMode" NOT NULL DEFAULT 'nat',
    "ssh_port" INTEGER,
    "root_password" TEXT,
    "snapshotted_specs" JSONB DEFAULT '{}',
    "port_limit" INTEGER,
    "snapshot_limit" INTEGER,
    "backup_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "port_mappings" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "protocol" "Protocol" NOT NULL DEFAULT 'tcp',
    "public_port" INTEGER NOT NULL,
    "private_port" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "port_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "incus_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stateful" BOOLEAN NOT NULL DEFAULT false,
    "size" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "incus_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "status" "BackupStatus" NOT NULL DEFAULT 'creating',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_policies" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_hours" INTEGER NOT NULL DEFAULT 24,
    "retention_count" INTEGER NOT NULL DEFAULT 3,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot_policies" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_hours" INTEGER NOT NULL DEFAULT 6,
    "retention_count" INTEGER NOT NULL DEFAULT 5,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snapshot_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationLogStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_configs" (
    "id" SERIAL NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_oauth_bindings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "provider_username" TEXT,
    "provider_email" TEXT,
    "provider_avatar" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_oauth_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_articles" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "os_type" TEXT NOT NULL DEFAULT 'Linux',
    "remote_alias" TEXT NOT NULL,
    "architecture" TEXT NOT NULL DEFAULT 'x86_64',
    "description" TEXT,
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_images" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "image_id" INTEGER NOT NULL,
    "fingerprint" TEXT,
    "alias" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "status" "HostImageStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "user_quotas_user_id_key" ON "user_quotas"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");

-- CreateIndex
CREATE INDEX "invite_codes_code_idx" ON "invite_codes"("code");

-- CreateIndex
CREATE INDEX "ssh_keys_user_id_idx" ON "ssh_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "node_groups_name_key" ON "node_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hosts_name_key" ON "hosts"("name");

-- CreateIndex
CREATE INDEX "hosts_node_group_id_idx" ON "hosts"("node_group_id");

-- CreateIndex
CREATE INDEX "instances_user_id_idx" ON "instances"("user_id");

-- CreateIndex
CREATE INDEX "instances_host_id_idx" ON "instances"("host_id");

-- CreateIndex
CREATE INDEX "instances_status_idx" ON "instances"("status");

-- CreateIndex
CREATE INDEX "port_mappings_instance_id_idx" ON "port_mappings"("instance_id");

-- CreateIndex
CREATE INDEX "snapshots_instance_id_idx" ON "snapshots"("instance_id");

-- CreateIndex
CREATE INDEX "backups_instance_id_idx" ON "backups"("instance_id");

-- CreateIndex
CREATE INDEX "backups_status_idx" ON "backups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "backup_policies_instance_id_key" ON "backup_policies"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_policies_instance_id_key" ON "snapshot_policies"("instance_id");

-- CreateIndex
CREATE INDEX "notification_channels_user_id_idx" ON "notification_channels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_configs_provider_key" ON "oauth_configs"("provider");

-- CreateIndex
CREATE INDEX "user_oauth_bindings_user_id_idx" ON "user_oauth_bindings"("user_id");

-- CreateIndex
CREATE INDEX "user_oauth_bindings_provider_provider_user_id_idx" ON "user_oauth_bindings"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_oauth_bindings_user_id_provider_key" ON "user_oauth_bindings"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_oauth_bindings_provider_provider_user_id_key" ON "user_oauth_bindings"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");

-- CreateIndex
CREATE INDEX "host_images_host_id_idx" ON "host_images"("host_id");

-- CreateIndex
CREATE INDEX "host_images_image_id_idx" ON "host_images"("image_id");

-- CreateIndex
CREATE UNIQUE INDEX "host_images_host_id_image_id_key" ON "host_images"("host_id", "image_id");

-- CreateIndex
CREATE INDEX "logs_user_id_idx" ON "logs"("user_id");

-- CreateIndex
CREATE INDEX "logs_module_idx" ON "logs"("module");

-- CreateIndex
CREATE INDEX "logs_created_at_idx" ON "logs"("created_at");

-- AddForeignKey
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_node_group_id_fkey" FOREIGN KEY ("node_group_id") REFERENCES "node_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_node_group_id_fkey" FOREIGN KEY ("node_group_id") REFERENCES "node_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "port_mappings" ADD CONSTRAINT "port_mappings_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "port_mappings" ADD CONSTRAINT "port_mappings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_policies" ADD CONSTRAINT "backup_policies_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshot_policies" ADD CONSTRAINT "snapshot_policies_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_oauth_bindings" ADD CONSTRAINT "user_oauth_bindings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_images" ADD CONSTRAINT "host_images_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_images" ADD CONSTRAINT "host_images_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs" ADD CONSTRAINT "logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
