-- 域名邮箱模块
-- 包含邮箱源、方案、订阅、域名、账户管理

-- 创建枚举类型
CREATE TYPE "MailDomainStatus" AS ENUM ('pending', 'verified', 'suspended');
CREATE TYPE "MailSubscriptionStatus" AS ENUM ('active', 'expired', 'suspended');
CREATE TYPE "MailBillingCycle" AS ENUM ('monthly', 'yearly');

-- 邮箱源表（数据中心）
CREATE TABLE "mail_sources" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "api_url" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "smartermail_url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_sources_pkey" PRIMARY KEY ("id")
);

-- 套餐方案表
CREATE TABLE "mail_plans" (
    "id" SERIAL NOT NULL,
    "source_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domain_limit" INTEGER NOT NULL,
    "disk_limit_gb" INTEGER NOT NULL,
    "billing_cycle" "MailBillingCycle" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_plans_pkey" PRIMARY KEY ("id")
);

-- 用户订阅表
CREATE TABLE "mail_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" "MailSubscriptionStatus" NOT NULL DEFAULT 'active',
    "domain_limit" INTEGER NOT NULL,
    "disk_limit_gb" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_subscriptions_pkey" PRIMARY KEY ("id")
);

-- 域名表
CREATE TABLE "mail_domains" (
    "id" SERIAL NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "MailDomainStatus" NOT NULL DEFAULT 'pending',
    "admin_username" TEXT,
    "admin_password" TEXT,
    "disk_used_mb" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_domains_pkey" PRIMARY KEY ("id")
);

-- 邮箱账户表
CREATE TABLE "mail_accounts" (
    "id" SERIAL NOT NULL,
    "domain_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT,
    "disk_limit_mb" INTEGER NOT NULL DEFAULT 2048,
    "disk_used_mb" INTEGER NOT NULL DEFAULT 0,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

-- 创建唯一索引
CREATE UNIQUE INDEX "mail_sources_code_key" ON "mail_sources"("code");
CREATE UNIQUE INDEX "mail_domains_domain_source_id_key" ON "mail_domains"("domain", "source_id");
CREATE UNIQUE INDEX "mail_accounts_domain_id_username_key" ON "mail_accounts"("domain_id", "username");

-- 创建普通索引
CREATE INDEX "mail_plans_source_id_enabled_idx" ON "mail_plans"("source_id", "enabled");
CREATE INDEX "mail_subscriptions_user_id_status_idx" ON "mail_subscriptions"("user_id", "status");
CREATE INDEX "mail_subscriptions_expires_at_idx" ON "mail_subscriptions"("expires_at");
CREATE INDEX "mail_domains_subscription_id_idx" ON "mail_domains"("subscription_id");
CREATE INDEX "mail_accounts_domain_id_idx" ON "mail_accounts"("domain_id");

-- 添加外键约束
ALTER TABLE "mail_plans" ADD CONSTRAINT "mail_plans_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "mail_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_subscriptions" ADD CONSTRAINT "mail_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_subscriptions" ADD CONSTRAINT "mail_subscriptions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "mail_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_subscriptions" ADD CONSTRAINT "mail_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "mail_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "mail_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "mail_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
