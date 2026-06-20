INSERT INTO "system_configs" ("key", "value", "type", "label", "description", "updated_at")
VALUES
    ('telegram_group_join_enabled', 'false', 'boolean', 'Telegram 入群申请', '是否允许绑定用户通过机器人申请私有群邀请链接', CURRENT_TIMESTAMP),
    ('telegram_group_chat_id', '', 'string', 'Telegram 私有群 Chat ID', '用于 createChatInviteLink 的私有群或超级群 chat_id', CURRENT_TIMESTAMP),
    ('telegram_group_join_mode', 'any', 'string', 'Telegram 入群门槛模式', 'any=充值或消费任一达标，all=充值和消费同时达标', CURRENT_TIMESTAMP),
    ('telegram_group_min_recharge', '0', 'number', 'Telegram 入群累计充值门槛', '累计充值金额达到该值后可申请入群，0 表示不要求', CURRENT_TIMESTAMP),
    ('telegram_group_min_consume', '0', 'number', 'Telegram 入群累计消费门槛', '累计消费金额达到该值后可申请入群，0 表示不要求', CURRENT_TIMESTAMP),
    ('telegram_group_invite_expire_minutes', '30', 'number', 'Telegram 邀请链接有效期', '机器人生成的一次性邀请链接有效分钟数', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
