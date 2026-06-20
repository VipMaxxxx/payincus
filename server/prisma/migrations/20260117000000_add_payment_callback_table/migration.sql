-- CreateTable: 支付回调防重放记录
CREATE TABLE IF NOT EXISTS "payment_callbacks" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "order_no" TEXT NOT NULL,
    "trade_no" TEXT,
    "callback_ip" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 联合唯一索引防重放
CREATE UNIQUE INDEX IF NOT EXISTS "payment_callbacks_provider_id_order_no_trade_no_key" ON "payment_callbacks"("provider_id", "order_no", "trade_no");

-- CreateIndex: 用于定期清理
CREATE INDEX IF NOT EXISTS "payment_callbacks_created_at_idx" ON "payment_callbacks"("created_at");
