CREATE TYPE "PluginPurchaseStatus" AS ENUM ('completed', 'refunded');
CREATE TYPE "PluginLicenseStatus" AS ENUM ('active', 'revoked');
CREATE TYPE "PluginRefundStatus" AS ENUM ('completed');
CREATE TYPE "PluginDeveloperEarningStatus" AS ENUM ('pending', 'reversed');
CREATE TYPE "PluginDeveloperWithdrawalStatus" AS ENUM ('pending', 'completed', 'rejected');

CREATE TABLE "plugin_purchases" (
  "id" SERIAL NOT NULL,
  "trade_no" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "developer_id" INTEGER NOT NULL,
  "submission_id" INTEGER NOT NULL,
  "plugin_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "gross_cents" INTEGER NOT NULL,
  "platform_fee_cents" INTEGER NOT NULL,
  "net_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "PluginPurchaseStatus" NOT NULL DEFAULT 'completed',
  "refundable_until" TIMESTAMP(3) NOT NULL,
  "refunded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plugin_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plugin_purchases_amounts_check" CHECK (
    "gross_cents" > 0 AND
    "platform_fee_cents" >= 0 AND
    "net_cents" >= 0 AND
    "gross_cents" = "platform_fee_cents" + "net_cents"
  ),
  CONSTRAINT "plugin_purchases_currency_check" CHECK ("currency" IN ('CNY', 'USD'))
);

CREATE TABLE "plugin_licenses" (
  "id" SERIAL NOT NULL,
  "purchase_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "plugin_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "PluginLicenseStatus" NOT NULL DEFAULT 'active',
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "plugin_licenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plugin_refunds" (
  "id" SERIAL NOT NULL,
  "purchase_id" INTEGER NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" TEXT,
  "status" "PluginRefundStatus" NOT NULL DEFAULT 'completed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plugin_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plugin_refunds_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "plugin_refunds_currency_check" CHECK ("currency" IN ('CNY', 'USD'))
);

CREATE TABLE "plugin_developer_earnings" (
  "id" SERIAL NOT NULL,
  "purchase_id" INTEGER NOT NULL,
  "developer_id" INTEGER NOT NULL,
  "plugin_id" TEXT NOT NULL,
  "gross_cents" INTEGER NOT NULL,
  "platform_fee_cents" INTEGER NOT NULL,
  "net_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" "PluginDeveloperEarningStatus" NOT NULL DEFAULT 'pending',
  "available_at" TIMESTAMP(3) NOT NULL,
  "reversed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plugin_developer_earnings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plugin_developer_earnings_amounts_check" CHECK (
    "gross_cents" > 0 AND
    "platform_fee_cents" >= 0 AND
    "net_cents" >= 0 AND
    "gross_cents" = "platform_fee_cents" + "net_cents"
  ),
  CONSTRAINT "plugin_developer_earnings_currency_check" CHECK ("currency" IN ('CNY', 'USD'))
);

CREATE TABLE "plugin_developer_withdrawals" (
  "id" SERIAL NOT NULL,
  "developer_id" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "payout_method" VARCHAR(32) NOT NULL,
  "payout_target" VARCHAR(256) NOT NULL,
  "status" "PluginDeveloperWithdrawalStatus" NOT NULL DEFAULT 'pending',
  "reject_reason" TEXT,
  "reviewed_by_user_id" INTEGER,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plugin_developer_withdrawals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plugin_developer_withdrawals_amount_check" CHECK ("amount_cents" >= 1000),
  CONSTRAINT "plugin_developer_withdrawals_currency_check" CHECK ("currency" IN ('CNY', 'USD'))
);

CREATE UNIQUE INDEX "plugin_purchases_trade_no_key" ON "plugin_purchases"("trade_no");
CREATE UNIQUE INDEX "plugin_purchases_user_id_idempotency_key_key" ON "plugin_purchases"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "plugin_purchases_user_id_plugin_id_version_key" ON "plugin_purchases"("user_id", "plugin_id", "version");
CREATE INDEX "plugin_purchases_developer_id_currency_created_at_idx" ON "plugin_purchases"("developer_id", "currency", "created_at");
CREATE INDEX "plugin_purchases_submission_id_idx" ON "plugin_purchases"("submission_id");
CREATE INDEX "plugin_purchases_status_refundable_until_idx" ON "plugin_purchases"("status", "refundable_until");

CREATE UNIQUE INDEX "plugin_licenses_purchase_id_key" ON "plugin_licenses"("purchase_id");
CREATE UNIQUE INDEX "plugin_licenses_user_id_plugin_id_version_key" ON "plugin_licenses"("user_id", "plugin_id", "version");
CREATE INDEX "plugin_licenses_user_id_plugin_id_status_idx" ON "plugin_licenses"("user_id", "plugin_id", "status");

CREATE UNIQUE INDEX "plugin_refunds_purchase_id_key" ON "plugin_refunds"("purchase_id");
CREATE INDEX "plugin_refunds_created_at_idx" ON "plugin_refunds"("created_at");

CREATE UNIQUE INDEX "plugin_developer_earnings_purchase_id_key" ON "plugin_developer_earnings"("purchase_id");
CREATE INDEX "plugin_developer_earnings_developer_id_currency_status_available_at_idx" ON "plugin_developer_earnings"("developer_id", "currency", "status", "available_at");
CREATE INDEX "plugin_developer_earnings_plugin_id_created_at_idx" ON "plugin_developer_earnings"("plugin_id", "created_at");

CREATE UNIQUE INDEX "plugin_developer_withdrawals_developer_id_idempotency_key_key" ON "plugin_developer_withdrawals"("developer_id", "idempotency_key");
CREATE INDEX "plugin_developer_withdrawals_developer_id_currency_status_created_at_idx" ON "plugin_developer_withdrawals"("developer_id", "currency", "status", "created_at");
CREATE INDEX "plugin_developer_withdrawals_status_created_at_idx" ON "plugin_developer_withdrawals"("status", "created_at");

ALTER TABLE "plugin_purchases" ADD CONSTRAINT "plugin_purchases_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_purchases" ADD CONSTRAINT "plugin_purchases_developer_id_fkey"
  FOREIGN KEY ("developer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_purchases" ADD CONSTRAINT "plugin_purchases_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "plugin_market_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_licenses" ADD CONSTRAINT "plugin_licenses_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "plugin_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_licenses" ADD CONSTRAINT "plugin_licenses_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_refunds" ADD CONSTRAINT "plugin_refunds_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "plugin_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_developer_earnings" ADD CONSTRAINT "plugin_developer_earnings_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "plugin_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_developer_earnings" ADD CONSTRAINT "plugin_developer_earnings_developer_id_fkey"
  FOREIGN KEY ("developer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_developer_withdrawals" ADD CONSTRAINT "plugin_developer_withdrawals_developer_id_fkey"
  FOREIGN KEY ("developer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plugin_developer_withdrawals" ADD CONSTRAINT "plugin_developer_withdrawals_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
