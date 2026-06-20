CREATE TABLE "user_telegram_bindings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_telegram_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_bind_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_bind_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_telegram_bindings_user_id_key" ON "user_telegram_bindings"("user_id");
CREATE UNIQUE INDEX "user_telegram_bindings_telegram_user_id_key" ON "user_telegram_bindings"("telegram_user_id");
CREATE UNIQUE INDEX "telegram_bind_tokens_token_hash_key" ON "telegram_bind_tokens"("token_hash");
CREATE INDEX "telegram_bind_tokens_user_id_idx" ON "telegram_bind_tokens"("user_id");

ALTER TABLE "user_telegram_bindings"
    ADD CONSTRAINT "user_telegram_bindings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telegram_bind_tokens"
    ADD CONSTRAINT "telegram_bind_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "system_configs" ("key", "value", "type", "label", "description", "updated_at")
VALUES
    ('telegram_bot_enabled', 'false', 'boolean', 'Telegram 专用机器人', '是否启用 Telegram 账号绑定机器人', CURRENT_TIMESTAMP),
    ('telegram_bot_username', '', 'string', 'Telegram Bot 用户名', '机器人用户名，不含 @，用于生成绑定链接', CURRENT_TIMESTAMP),
    ('telegram_bot_token', '', 'secret', 'Telegram Bot Token', 'BotFather 分配的专用机器人 Token', CURRENT_TIMESTAMP),
    ('telegram_webhook_secret', '', 'secret', 'Telegram Webhook Secret', 'Telegram webhook 请求头 X-Telegram-Bot-Api-Secret-Token 校验值', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
