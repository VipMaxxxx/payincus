ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'exchange_purchase';
ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'exchange_refund';
ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'exchange_transfer';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'exchange_purchase';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'exchange_withdrawal';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'exchange_balance_transfer';

CREATE TYPE "ExchangeListingStatus" AS ENUM (
  'active',
  'paused',
  'delisted',
  'locked',
  'sold',
  'delivery_failed',
  'force_delisted'
);

CREATE TYPE "ExchangeOrderStatus" AS ENUM (
  'escrowed',
  'delivering',
  'delivered',
  'confirming',
  'completed',
  'cancelled',
  'refunded',
  'disputed',
  'manual_review',
  'failed'
);

CREATE TYPE "ExchangeDeliveryTaskStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "ExchangeWalletLogType" AS ENUM (
  'escrow_hold',
  'escrow_refund',
  'fee_charge',
  'escrow_release',
  'withdrawal_freeze',
  'withdrawal_complete',
  'withdrawal_reject',
  'balance_transfer',
  'dispute_freeze',
  'dispute_release',
  'admin_adjust'
);

CREATE TYPE "ExchangeWithdrawalStatus" AS ENUM (
  'pending',
  'approved',
  'paying',
  'completed',
  'rejected',
  'cancelled',
  'failed_returned'
);

CREATE TYPE "ExchangeDisputeStatus" AS ENUM (
  'open',
  'processing',
  'rejected',
  'refunded',
  'redelivering',
  'released',
  'closed'
);

CREATE TABLE "exchange_listings" (
  "id" SERIAL NOT NULL,
  "instance_id" INTEGER NOT NULL,
  "seller_user_id" INTEGER NOT NULL,
  "status" "ExchangeListingStatus" NOT NULL DEFAULT 'active',
  "price" DECIMAL(10,2) NOT NULL,
  "fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "seller_receives_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "description" TEXT,
  "auto_delist_at" TIMESTAMP(3),
  "locked_order_id" INTEGER,
  "idempotency_key" TEXT,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "eligibility_snapshot" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delisted_at" TIMESTAMP(3),
  CONSTRAINT "exchange_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_orders" (
  "id" SERIAL NOT NULL,
  "order_no" TEXT NOT NULL,
  "listing_id" INTEGER NOT NULL,
  "instance_id" INTEGER NOT NULL,
  "buyer_user_id" INTEGER NOT NULL,
  "seller_user_id" INTEGER NOT NULL,
  "status" "ExchangeOrderStatus" NOT NULL DEFAULT 'escrowed',
  "price" DECIMAL(10,2) NOT NULL,
  "fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "seller_receives_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "escrow_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "buyer_balance_log_id" INTEGER,
  "refund_balance_log_id" INTEGER,
  "wallet_log_id" INTEGER,
  "confirmation_due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "failure_reason" TEXT,
  "idempotency_key" TEXT,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_delivery_tasks" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "instance_id" INTEGER NOT NULL,
  "instance_task_id" INTEGER,
  "buyer_user_id" INTEGER NOT NULL,
  "seller_user_id" INTEGER NOT NULL,
  "status" "ExchangeDeliveryTaskStatus" NOT NULL DEFAULT 'PENDING',
  "step" TEXT,
  "progress" JSONB NOT NULL DEFAULT '{}',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "image_alias" TEXT,
  "ssh_key_id" INTEGER,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "exchange_delivery_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_wallets" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "available_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "frozen_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_wallet_logs" (
  "id" SERIAL NOT NULL,
  "wallet_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "type" "ExchangeWalletLogType" NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "available_before" DECIMAL(10,2) NOT NULL,
  "available_after" DECIMAL(10,2) NOT NULL,
  "frozen_before" DECIMAL(10,2) NOT NULL,
  "frozen_after" DECIMAL(10,2) NOT NULL,
  "order_id" INTEGER,
  "withdrawal_id" INTEGER,
  "balance_log_id" INTEGER,
  "idempotency_key" TEXT,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_wallet_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_withdrawals" (
  "id" SERIAL NOT NULL,
  "withdrawal_no" TEXT NOT NULL,
  "wallet_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "status" "ExchangeWithdrawalStatus" NOT NULL DEFAULT 'pending',
  "method" TEXT,
  "account_snapshot" JSONB NOT NULL DEFAULT '{}',
  "applicant_remark" TEXT,
  "idempotency_key" TEXT,
  "reviewer_user_id" INTEGER,
  "review_remark" TEXT,
  "proof_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "exchange_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_disputes" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "creator_user_id" INTEGER NOT NULL,
  "status" "ExchangeDisputeStatus" NOT NULL DEFAULT 'open',
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "idempotency_key" TEXT,
  "resolution" TEXT,
  "handled_by_user_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "exchange_disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_audit_logs" (
  "id" SERIAL NOT NULL,
  "actor_user_id" INTEGER,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" INTEGER,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exchange_policy_configs" (
  "id" SERIAL NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "min_remaining_days" INTEGER NOT NULL DEFAULT 7,
  "expiring_soon_days" INTEGER NOT NULL DEFAULT 7,
  "min_price" DECIMAL(10,2) NOT NULL DEFAULT 1,
  "max_price" DECIMAL(10,2),
  "max_markup_percent" INTEGER NOT NULL DEFAULT 150,
  "fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 5,
  "min_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "max_fee" DECIMAL(10,2),
  "confirmation_hours" INTEGER NOT NULL DEFAULT 24,
  "auto_confirm_enabled" BOOLEAN NOT NULL DEFAULT true,
  "min_withdrawal_amount" DECIMAL(10,2) NOT NULL DEFAULT 10,
  "daily_withdrawal_limit" DECIMAL(10,2),
  "daily_withdrawal_count_limit" INTEGER NOT NULL DEFAULT 3,
  "allow_balance_transfer" BOOLEAN NOT NULL DEFAULT true,
  "allow_public_ip_transfer" BOOLEAN NOT NULL DEFAULT true,
  "allow_buyer_image_selection" BOOLEAN NOT NULL DEFAULT false,
  "max_active_listings_per_user" INTEGER NOT NULL DEFAULT 5,
  "max_purchases_per_user_per_day" INTEGER NOT NULL DEFAULT 5,
  "dispute_timeout_hours" INTEGER NOT NULL DEFAULT 72,
  "package_allowlist" JSONB NOT NULL DEFAULT '[]',
  "host_allowlist" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_policy_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exchange_listings_seller_user_id_status_idx" ON "exchange_listings"("seller_user_id", "status");
CREATE INDEX "exchange_listings_instance_id_status_idx" ON "exchange_listings"("instance_id", "status");
CREATE INDEX "exchange_listings_status_created_at_idx" ON "exchange_listings"("status", "created_at" DESC);
CREATE INDEX "exchange_listings_auto_delist_at_idx" ON "exchange_listings"("auto_delist_at");
CREATE UNIQUE INDEX "exchange_listings_idempotency_key_key" ON "exchange_listings"("idempotency_key");

CREATE UNIQUE INDEX "exchange_orders_order_no_key" ON "exchange_orders"("order_no");
CREATE UNIQUE INDEX "exchange_orders_idempotency_key_key" ON "exchange_orders"("idempotency_key");
CREATE INDEX "exchange_orders_listing_id_idx" ON "exchange_orders"("listing_id");
CREATE INDEX "exchange_orders_instance_id_idx" ON "exchange_orders"("instance_id");
CREATE INDEX "exchange_orders_buyer_user_id_status_idx" ON "exchange_orders"("buyer_user_id", "status");
CREATE INDEX "exchange_orders_seller_user_id_status_idx" ON "exchange_orders"("seller_user_id", "status");
CREATE INDEX "exchange_orders_status_created_at_idx" ON "exchange_orders"("status", "created_at" DESC);

CREATE INDEX "exchange_delivery_tasks_order_id_idx" ON "exchange_delivery_tasks"("order_id");
CREATE INDEX "exchange_delivery_tasks_instance_id_status_idx" ON "exchange_delivery_tasks"("instance_id", "status");
CREATE UNIQUE INDEX "exchange_delivery_tasks_instance_task_id_key" ON "exchange_delivery_tasks"("instance_task_id");
CREATE INDEX "exchange_delivery_tasks_instance_task_id_idx" ON "exchange_delivery_tasks"("instance_task_id");
CREATE INDEX "exchange_delivery_tasks_status_created_at_idx" ON "exchange_delivery_tasks"("status", "created_at");

CREATE UNIQUE INDEX "exchange_wallets_user_id_key" ON "exchange_wallets"("user_id");
CREATE INDEX "exchange_wallet_logs_user_id_created_at_idx" ON "exchange_wallet_logs"("user_id", "created_at" DESC);
CREATE INDEX "exchange_wallet_logs_order_id_idx" ON "exchange_wallet_logs"("order_id");
CREATE INDEX "exchange_wallet_logs_withdrawal_id_idx" ON "exchange_wallet_logs"("withdrawal_id");
CREATE UNIQUE INDEX "exchange_wallet_logs_idempotency_key_key" ON "exchange_wallet_logs"("idempotency_key");

CREATE UNIQUE INDEX "exchange_withdrawals_withdrawal_no_key" ON "exchange_withdrawals"("withdrawal_no");
CREATE UNIQUE INDEX "exchange_withdrawals_idempotency_key_key" ON "exchange_withdrawals"("idempotency_key");
CREATE INDEX "exchange_withdrawals_user_id_status_idx" ON "exchange_withdrawals"("user_id", "status");
CREATE INDEX "exchange_withdrawals_status_created_at_idx" ON "exchange_withdrawals"("status", "created_at");

CREATE INDEX "exchange_disputes_order_id_status_idx" ON "exchange_disputes"("order_id", "status");
CREATE INDEX "exchange_disputes_creator_user_id_status_idx" ON "exchange_disputes"("creator_user_id", "status");
CREATE UNIQUE INDEX "exchange_disputes_idempotency_key_key" ON "exchange_disputes"("idempotency_key");

CREATE INDEX "exchange_audit_logs_actor_user_id_created_at_idx" ON "exchange_audit_logs"("actor_user_id", "created_at" DESC);
CREATE INDEX "exchange_audit_logs_target_type_target_id_idx" ON "exchange_audit_logs"("target_type", "target_id");

ALTER TABLE "exchange_listings"
  ADD CONSTRAINT "exchange_listings_instance_id_fkey"
  FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_listings"
  ADD CONSTRAINT "exchange_listings_seller_user_id_fkey"
  FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_orders"
  ADD CONSTRAINT "exchange_orders_listing_id_fkey"
  FOREIGN KEY ("listing_id") REFERENCES "exchange_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_orders"
  ADD CONSTRAINT "exchange_orders_instance_id_fkey"
  FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_orders"
  ADD CONSTRAINT "exchange_orders_buyer_user_id_fkey"
  FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_orders"
  ADD CONSTRAINT "exchange_orders_seller_user_id_fkey"
  FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_delivery_tasks"
  ADD CONSTRAINT "exchange_delivery_tasks_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "exchange_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_delivery_tasks"
  ADD CONSTRAINT "exchange_delivery_tasks_instance_id_fkey"
  FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "exchange_delivery_tasks"
  ADD CONSTRAINT "exchange_delivery_tasks_instance_task_id_fkey"
  FOREIGN KEY ("instance_task_id") REFERENCES "instance_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "exchange_wallets"
  ADD CONSTRAINT "exchange_wallets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_wallet_logs"
  ADD CONSTRAINT "exchange_wallet_logs_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "exchange_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_wallet_logs"
  ADD CONSTRAINT "exchange_wallet_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_withdrawals"
  ADD CONSTRAINT "exchange_withdrawals_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "exchange_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_withdrawals"
  ADD CONSTRAINT "exchange_withdrawals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_disputes"
  ADD CONSTRAINT "exchange_disputes_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "exchange_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_disputes"
  ADD CONSTRAINT "exchange_disputes_creator_user_id_fkey"
  FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exchange_audit_logs"
  ADD CONSTRAINT "exchange_audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "exchange_policy_configs" ("enabled")
SELECT false
WHERE NOT EXISTS (SELECT 1 FROM "exchange_policy_configs");
