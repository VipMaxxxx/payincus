DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VipBenefitRewardType') THEN
    CREATE TYPE "VipBenefitRewardType" AS ENUM ('balance', 'points', 'instance');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VipBenefitClaimStatus') THEN
    CREATE TYPE "VipBenefitClaimStatus" AS ENUM ('delivered', 'pending');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PointsLogType' AND e.enumlabel = 'vip_benefit'
  ) THEN
    ALTER TYPE "PointsLogType" ADD VALUE 'vip_benefit';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "vip_benefit_rewards" (
  "id" SERIAL NOT NULL,
  "level" INTEGER NOT NULL,
  "type" "VipBenefitRewardType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "claim_limit" INTEGER NOT NULL DEFAULT 1,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_benefit_rewards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "vip_benefit_claims" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "reward_id" INTEGER NOT NULL,
  "level" INTEGER NOT NULL,
  "status" "VipBenefitClaimStatus" NOT NULL,
  "claim_no" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vip_benefit_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vip_benefit_rewards_level_enabled_sort_order_idx" ON "vip_benefit_rewards"("level", "enabled", "sort_order");
CREATE INDEX IF NOT EXISTS "vip_benefit_rewards_type_idx" ON "vip_benefit_rewards"("type");
CREATE UNIQUE INDEX IF NOT EXISTS "vip_benefit_claims_user_id_reward_id_claim_no_key" ON "vip_benefit_claims"("user_id", "reward_id", "claim_no");
CREATE INDEX IF NOT EXISTS "vip_benefit_claims_user_id_level_idx" ON "vip_benefit_claims"("user_id", "level");
CREATE INDEX IF NOT EXISTS "vip_benefit_claims_reward_id_idx" ON "vip_benefit_claims"("reward_id");
CREATE INDEX IF NOT EXISTS "vip_benefit_claims_status_created_at_idx" ON "vip_benefit_claims"("status", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vip_benefit_claims_user_id_fkey'
  ) THEN
    ALTER TABLE "vip_benefit_claims"
      ADD CONSTRAINT "vip_benefit_claims_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vip_benefit_claims_reward_id_fkey'
  ) THEN
    ALTER TABLE "vip_benefit_claims"
      ADD CONSTRAINT "vip_benefit_claims_reward_id_fkey"
      FOREIGN KEY ("reward_id") REFERENCES "vip_benefit_rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "vip_benefit_rewards" (
  "level",
  "type",
  "title",
  "description",
  "claim_limit",
  "sort_order",
  "enabled",
  "config"
)
SELECT
  r."level",
  'balance'::"VipBenefitRewardType",
  'VIP' || r."level" || ' 赠金',
  '用户达到 VIP' || r."level" || ' 后可领取的余额奖励',
  1,
  10,
  true,
  jsonb_build_object('amount', ((r."benefits"->'benefitHall'->'balance'->>'amount')::numeric))
FROM "vip_level_rules" r
WHERE r."type" = 'user'
  AND COALESCE((r."benefits"->'benefitHall'->'balance'->>'enabled')::boolean, false) = true
  AND COALESCE((r."benefits"->'benefitHall'->'balance'->>'amount')::numeric, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "vip_benefit_rewards" existing
    WHERE existing."level" = r."level"
      AND existing."type" = 'balance'::"VipBenefitRewardType"
      AND existing."sort_order" = 10
  );

INSERT INTO "vip_benefit_rewards" (
  "level",
  "type",
  "title",
  "description",
  "claim_limit",
  "sort_order",
  "enabled",
  "config"
)
SELECT
  r."level",
  'points'::"VipBenefitRewardType",
  'VIP' || r."level" || ' 积分',
  '用户达到 VIP' || r."level" || ' 后可领取的积分奖励',
  1,
  20,
  true,
  jsonb_build_object('amount', ((r."benefits"->'benefitHall'->'points'->>'amount')::integer))
FROM "vip_level_rules" r
WHERE r."type" = 'user'
  AND COALESCE((r."benefits"->'benefitHall'->'points'->>'enabled')::boolean, false) = true
  AND COALESCE((r."benefits"->'benefitHall'->'points'->>'amount')::integer, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "vip_benefit_rewards" existing
    WHERE existing."level" = r."level"
      AND existing."type" = 'points'::"VipBenefitRewardType"
      AND existing."sort_order" = 20
  );

INSERT INTO "vip_benefit_rewards" (
  "level",
  "type",
  "title",
  "description",
  "claim_limit",
  "sort_order",
  "enabled",
  "config"
)
SELECT
  r."level",
  'instance'::"VipBenefitRewardType",
  'VIP' || r."level" || ' 套餐实例',
  '用户达到 VIP' || r."level" || ' 后可登记领取的套餐实例奖励',
  1,
  30,
  true,
  jsonb_build_object(
    'packageId', ((r."benefits"->'benefitHall'->'instance'->>'packageId')::integer),
    'packageName', r."benefits"->'benefitHall'->'instance'->>'packageName',
    'planId', ((r."benefits"->'benefitHall'->'instance'->>'planId')::integer),
    'planName', r."benefits"->'benefitHall'->'instance'->>'planName',
    'days', COALESCE((r."benefits"->'benefitHall'->'instance'->>'days')::integer, 30),
    'quantity', COALESCE((r."benefits"->'benefitHall'->'instance'->>'quantity')::integer, 1)
  )
FROM "vip_level_rules" r
WHERE r."type" = 'user'
  AND COALESCE((r."benefits"->'benefitHall'->'instance'->>'enabled')::boolean, false) = true
  AND COALESCE((r."benefits"->'benefitHall'->'instance'->>'packageId')::integer, 0) > 0
  AND COALESCE((r."benefits"->'benefitHall'->'instance'->>'planId')::integer, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "vip_benefit_rewards" existing
    WHERE existing."level" = r."level"
      AND existing."type" = 'instance'::"VipBenefitRewardType"
      AND existing."sort_order" = 30
  );
