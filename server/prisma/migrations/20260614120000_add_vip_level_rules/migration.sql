CREATE TYPE "VipLevelRuleType" AS ENUM ('user', 'hosting');

CREATE TYPE "VipLevelConditionMode" AS ENUM ('any', 'all');

CREATE TABLE "vip_level_rules" (
  "id" SERIAL NOT NULL,
  "type" "VipLevelRuleType" NOT NULL,
  "level" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "condition_mode" "VipLevelConditionMode" NOT NULL DEFAULT 'any',
  "min_recharge" DECIMAL(10, 2),
  "min_consume" DECIMAL(10, 2),
  "min_hosting_income" DECIMAL(10, 2),
  "min_hosting_instances" INTEGER,
  "benefits" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_level_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vip_level_rules_type_level_key" ON "vip_level_rules"("type", "level");
CREATE INDEX "vip_level_rules_type_enabled_idx" ON "vip_level_rules"("type", "enabled");

INSERT INTO "vip_level_rules" (
  "type",
  "level",
  "enabled",
  "condition_mode",
  "min_hosting_income",
  "min_hosting_instances",
  "benefits"
) VALUES
  ('hosting', 1, true, 'any', 50.00, 10, '{}'),
  ('hosting', 2, true, 'any', 100.00, 25, '{}'),
  ('hosting', 3, true, 'any', 200.00, 50, '{}'),
  ('hosting', 4, true, 'any', 300.00, 75, '{}'),
  ('hosting', 5, true, 'any', 500.00, 100, '{}');
