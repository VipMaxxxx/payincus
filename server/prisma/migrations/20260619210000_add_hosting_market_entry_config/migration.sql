INSERT INTO "system_configs" ("key", "value", "type", "label", "description", "created_at", "updated_at")
VALUES (
  'hosting_market_entry_enabled',
  'true',
  'boolean',
  '托管套餐购买入口',
  '控制开通实例页面是否显示托管专区和托管套餐购买入口',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
