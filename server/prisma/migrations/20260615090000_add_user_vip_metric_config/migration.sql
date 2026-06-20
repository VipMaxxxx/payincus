INSERT INTO "system_configs" ("key", "value", "type", "label", "description", "created_at", "updated_at")
VALUES (
  'user_vip_metric',
  'totalRecharge',
  'string',
  '用户 VIP 统计口径',
  '用户 VIP 等级全局计算口径：totalRecharge=累计充值，totalConsume=累计消费',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
