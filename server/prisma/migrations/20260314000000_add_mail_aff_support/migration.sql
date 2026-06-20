-- 邮箱订阅 AFF 优惠码支持
-- 1. 创建邮箱订阅与优惠码绑定表
-- 2. 在 AFF 日志表添加邮箱订阅关联字段

-- 创建邮箱订阅 AFF 绑定表
CREATE TABLE "mail_subscription_aff_bindings" (
    "id" SERIAL NOT NULL,
    "mail_subscription_id" INTEGER NOT NULL,
    "aff_code_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_subscription_aff_bindings_pkey" PRIMARY KEY ("id")
);

-- 创建唯一索引（一个订阅只能绑定一个优惠码）
CREATE UNIQUE INDEX "mail_subscription_aff_bindings_mail_subscription_id_key" ON "mail_subscription_aff_bindings"("mail_subscription_id");

-- 创建优惠码索引
CREATE INDEX "mail_subscription_aff_bindings_aff_code_id_idx" ON "mail_subscription_aff_bindings"("aff_code_id");

-- 添加外键约束
ALTER TABLE "mail_subscription_aff_bindings" ADD CONSTRAINT "mail_subscription_aff_bindings_mail_subscription_id_fkey" FOREIGN KEY ("mail_subscription_id") REFERENCES "mail_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_subscription_aff_bindings" ADD CONSTRAINT "mail_subscription_aff_bindings_aff_code_id_fkey" FOREIGN KEY ("aff_code_id") REFERENCES "aff_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 在 AFF 日志表添加邮箱订阅关联字段
ALTER TABLE "aff_logs" ADD COLUMN "mail_subscription_id" INTEGER;

-- 创建邮箱订阅索引
CREATE INDEX "aff_logs_mail_subscription_id_idx" ON "aff_logs"("mail_subscription_id");

-- 添加外键约束（允许级联设置为 NULL）
ALTER TABLE "aff_logs" ADD CONSTRAINT "aff_logs_mail_subscription_id_fkey" FOREIGN KEY ("mail_subscription_id") REFERENCES "mail_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
