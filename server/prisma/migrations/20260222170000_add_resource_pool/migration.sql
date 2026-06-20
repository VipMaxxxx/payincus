-- CreateEnum
CREATE TYPE "ResourcePoolAction" AS ENUM ('checkin', 'redeem', 'admin_grant', 'system_grant', 'lottery', 'apply');

-- CreateTable
CREATE TABLE "user_resource_pools" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "cpu" INTEGER NOT NULL DEFAULT 0,
    "memory" INTEGER NOT NULL DEFAULT 0,
    "disk" INTEGER NOT NULL DEFAULT 0,
    "traffic" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_resource_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_pool_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" "ResourcePoolAction" NOT NULL,
    "resource_type" "RedeemCodeType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "instance_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_pool_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_resource_pools_user_id_key" ON "user_resource_pools"("user_id");

-- CreateIndex
CREATE INDEX "resource_pool_logs_user_id_idx" ON "resource_pool_logs"("user_id");

-- CreateIndex
CREATE INDEX "resource_pool_logs_user_id_action_idx" ON "resource_pool_logs"("user_id", "action");

-- AddForeignKey
ALTER TABLE "user_resource_pools" ADD CONSTRAINT "user_resource_pools_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_pool_logs" ADD CONSTRAINT "resource_pool_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_pool_logs" ADD CONSTRAINT "resource_pool_logs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
