CREATE TYPE "FlashSaleCampaignStatus" AS ENUM (
  'draft',
  'scheduled',
  'active',
  'paused',
  'ended',
  'cancelled'
);

CREATE TYPE "FlashSaleReservationStatus" AS ENUM (
  'paid',
  'delivering',
  'delivered',
  'failed',
  'refunded',
  'cancelled'
);

CREATE TYPE "FlashSaleAuditAction" AS ENUM (
  'create',
  'update',
  'start',
  'pause',
  'resume',
  'finish',
  'cancel',
  'stock_adjust',
  'reservation_refund',
  'reservation_release'
);

CREATE TABLE "flash_sale_campaigns" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "FlashSaleCampaignStatus" NOT NULL DEFAULT 'draft',
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "require_turnstile" BOOLEAN NOT NULL DEFAULT true,
  "min_account_age_hours" INTEGER NOT NULL DEFAULT 0,
  "require_email" BOOLEAN NOT NULL DEFAULT false,
  "block_risk_restricted" BOOLEAN NOT NULL DEFAULT true,
  "max_per_user" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "created_by_user_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flash_sale_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flash_sale_items" (
  "id" SERIAL NOT NULL,
  "campaign_id" INTEGER NOT NULL,
  "package_plan_id" INTEGER NOT NULL,
  "flash_price" DECIMAL(10,2) NOT NULL,
  "original_price_snapshot" DECIMAL(10,2) NOT NULL,
  "total_stock" INTEGER NOT NULL,
  "sold_count" INTEGER NOT NULL DEFAULT 0,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "delivered_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "per_user_limit" INTEGER NOT NULL DEFAULT 1,
  "allow_coupon" BOOLEAN NOT NULL DEFAULT false,
  "allow_aff" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flash_sale_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flash_sale_reservations" (
  "id" SERIAL NOT NULL,
  "campaign_id" INTEGER NOT NULL,
  "item_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "instance_id" INTEGER,
  "status" "FlashSaleReservationStatus" NOT NULL DEFAULT 'paid',
  "amount" DECIMAL(10,2) NOT NULL,
  "balance_log_id" INTEGER,
  "billing_record_id" INTEGER,
  "idempotency_key" TEXT NOT NULL,
  "failure_reason" TEXT,
  "metadata" JSONB DEFAULT '{}',
  "paid_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "refunded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flash_sale_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "flash_sale_audit_logs" (
  "id" SERIAL NOT NULL,
  "campaign_id" INTEGER NOT NULL,
  "item_id" INTEGER,
  "actor_user_id" INTEGER NOT NULL,
  "action" "FlashSaleAuditAction" NOT NULL,
  "before_data" JSONB,
  "after_data" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flash_sale_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flash_sale_campaigns_status_start_at_end_at_idx" ON "flash_sale_campaigns"("status", "start_at", "end_at");
CREATE INDEX "flash_sale_campaigns_created_by_user_id_created_at_idx" ON "flash_sale_campaigns"("created_by_user_id", "created_at" DESC);

CREATE UNIQUE INDEX "flash_sale_items_campaign_id_package_plan_id_key" ON "flash_sale_items"("campaign_id", "package_plan_id");
CREATE INDEX "flash_sale_items_package_plan_id_idx" ON "flash_sale_items"("package_plan_id");
CREATE INDEX "flash_sale_items_campaign_id_sort_order_idx" ON "flash_sale_items"("campaign_id", "sort_order");

CREATE UNIQUE INDEX "flash_sale_reservations_idempotency_key_key" ON "flash_sale_reservations"("idempotency_key");
CREATE INDEX "flash_sale_reservations_user_id_created_at_idx" ON "flash_sale_reservations"("user_id", "created_at" DESC);
CREATE INDEX "flash_sale_reservations_campaign_id_status_idx" ON "flash_sale_reservations"("campaign_id", "status");
CREATE INDEX "flash_sale_reservations_item_id_status_idx" ON "flash_sale_reservations"("item_id", "status");
CREATE INDEX "flash_sale_reservations_instance_id_idx" ON "flash_sale_reservations"("instance_id");

CREATE INDEX "flash_sale_audit_logs_campaign_id_created_at_idx" ON "flash_sale_audit_logs"("campaign_id", "created_at" DESC);
CREATE INDEX "flash_sale_audit_logs_actor_user_id_created_at_idx" ON "flash_sale_audit_logs"("actor_user_id", "created_at" DESC);

ALTER TABLE "flash_sale_campaigns"
  ADD CONSTRAINT "flash_sale_campaigns_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "flash_sale_items"
  ADD CONSTRAINT "flash_sale_items_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "flash_sale_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flash_sale_items"
  ADD CONSTRAINT "flash_sale_items_package_plan_id_fkey"
  FOREIGN KEY ("package_plan_id") REFERENCES "package_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "flash_sale_reservations"
  ADD CONSTRAINT "flash_sale_reservations_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "flash_sale_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flash_sale_reservations"
  ADD CONSTRAINT "flash_sale_reservations_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "flash_sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flash_sale_reservations"
  ADD CONSTRAINT "flash_sale_reservations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flash_sale_reservations"
  ADD CONSTRAINT "flash_sale_reservations_instance_id_fkey"
  FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "flash_sale_audit_logs"
  ADD CONSTRAINT "flash_sale_audit_logs_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "flash_sale_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "flash_sale_audit_logs"
  ADD CONSTRAINT "flash_sale_audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
