-- 历史修正：把历史上被错误记为 'consume' 的“用余额生成礼品卡”扣款重新归类为 'gift_card_issue'，
-- 使其不再虚增 getUsersTotalConsumeMap 计算的可兑换消费额（防止礼品卡刷积分）。
--
-- 识别方式采用结构化关联，不依赖易被用户自定义的 remark。判定一条 consume 扣款为
-- “用余额自助生成礼品卡”的发行扣款，需要同时满足（全部条件，尽量避免误伤正常消费）：
--   1. gift_cards.created_by_id = balance_logs.user_id  —— 发行者是本人（创建后不变）
--   2. gift_cards.owner_id      = balance_logs.user_id  —— 用余额自助生成时持有者也是本人
--      （管理员控制台生成的礼品卡 created_by_id 为 NULL，不会命中；发给他人的卡 owner_id 不同，也不会命中）
--   3. gift_cards.face_value    = -balance_logs.amount  —— 发行扣款金额为负的面值
--   4. 两者创建时间相差在 ±10 秒内（发行与扣款在同一事务内，实际相差毫秒级）
--
-- 注意：本迁移不回收已发放的积分；仅使被污染的消费基数不再产生“未来”的可兑换积分。
-- 对已 convertedConsume 的用户，其可兑换额会变为非正值，兑换函数已对非正值做保护（不铸币）。
--
-- 迁移前/后验证方案（可在应用迁移前后手动执行，用于核对影响面是否合理）：
--   -- (A) 本次将被重分类的 consume 行数（应与“用户自助用余额生成的礼品卡数量”量级一致）：
--   --   SELECT count(*) FROM "balance_logs" bl
--   --   WHERE bl."type" = 'consume' AND EXISTS (
--   --     SELECT 1 FROM "gift_cards" gc
--   --     WHERE gc."created_by_id" = bl."user_id" AND gc."owner_id" = bl."user_id"
--   --       AND gc."face_value" = (-bl."amount")
--   --       AND gc."created_at" BETWEEN bl."created_at" - INTERVAL '10 seconds'
--   --                               AND bl."created_at" + INTERVAL '10 seconds');
--   -- (B) 用户自助生成的礼品卡总数（作为量级对照上界）：
--   --   SELECT count(*) FROM "gift_cards"
--   --   WHERE "created_by_id" IS NOT NULL AND "created_by_id" = "owner_id";
--   -- (C) 迁移后应为 0（确认已无遗留的“余额生成礼品卡”被记为 consume）：
--   --   同 (A) 的查询在迁移后再跑一次，结果应为 0。

-- 迁移时统计：把本次将被重分类的行数写入迁移日志，便于运维核对影响面。
DO $$
DECLARE
  affected_count integer;
BEGIN
  SELECT count(*) INTO affected_count
  FROM "balance_logs" AS bl
  WHERE bl."type" = 'consume'
    AND EXISTS (
      SELECT 1
      FROM "gift_cards" AS gc
      WHERE gc."created_by_id" = bl."user_id"
        AND gc."owner_id" = bl."user_id"
        AND gc."face_value" = (-bl."amount")
        AND gc."created_at" BETWEEN bl."created_at" - INTERVAL '10 seconds'
                                AND bl."created_at" + INTERVAL '10 seconds'
    );
  RAISE NOTICE 'gift_card_issue reclassification: % consume balance_logs rows match the tightened correlation and will be reclassified to gift_card_issue', affected_count;
END $$;

UPDATE "balance_logs" AS bl
SET "type" = 'gift_card_issue'
WHERE bl."type" = 'consume'
  AND EXISTS (
    SELECT 1
    FROM "gift_cards" AS gc
    WHERE gc."created_by_id" = bl."user_id"
      AND gc."owner_id" = bl."user_id"
      AND gc."face_value" = (-bl."amount")
      AND gc."created_at" BETWEEN bl."created_at" - INTERVAL '10 seconds'
                              AND bl."created_at" + INTERVAL '10 seconds'
  );
