-- 配额系统重构迁移
-- 用户配额从 CPU/内存/磁盘/端口/快照/备份 改为 宿主机数量/实例数量/好友数量
-- 套餐新增 snapshotLimit 和 backupLimit 字段

-- =====================================================
-- 1. 修改 user_quotas 表
-- =====================================================

-- 添加新字段
ALTER TABLE "user_quotas" ADD COLUMN IF NOT EXISTS "host_limit" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "user_quotas" ADD COLUMN IF NOT EXISTS "host_used" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_quotas" ADD COLUMN IF NOT EXISTS "friend_limit" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "user_quotas" ADD COLUMN IF NOT EXISTS "friend_used" INTEGER NOT NULL DEFAULT 0;

-- 更新 instance_limit 默认值为 50（可选，不影响现有数据）
-- ALTER TABLE "user_quotas" ALTER COLUMN "instance_limit" SET DEFAULT 50;

-- 统计并更新现有用户的 host_used
UPDATE "user_quotas" q SET "host_used" = (
  SELECT COUNT(*) FROM "hosts" h WHERE h."user_id" = q."user_id"
);

-- 统计并更新现有用户的 instance_used
UPDATE "user_quotas" q SET "instance_used" = (
  SELECT COUNT(*) FROM "instances" i WHERE i."user_id" = q."user_id" AND i."status" != 'deleted'
);

-- 统计并更新现有用户的 friend_used（已接受的好友数）
UPDATE "user_quotas" q SET "friend_used" = (
  SELECT COUNT(*) FROM "friendships" f 
  WHERE (f."user_id" = q."user_id" OR f."friend_id" = q."user_id") 
  AND f."status" = 'accepted'
);

-- 删除旧字段（可选，建议先保留一段时间后再删除）
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "cpu_limit";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "cpu_used";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "memory_limit";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "memory_used";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "disk_limit";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "disk_used";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "port_limit";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "port_used";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "snapshot_limit";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "snapshot_used";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "backup_limit";
-- ALTER TABLE "user_quotas" DROP COLUMN IF EXISTS "backup_used";

-- =====================================================
-- 2. 修改 packages 表
-- =====================================================

-- 添加新字段
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "snapshot_limit" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "backup_limit" INTEGER NOT NULL DEFAULT 3;

-- =====================================================
-- 3. 更新实例配额（从套餐继承）
-- =====================================================

-- 对于有套餐的实例，如果 snapshot_limit 或 backup_limit 为 NULL，则从套餐继承
UPDATE "instances" i SET 
  "snapshot_limit" = COALESCE(i."snapshot_limit", p."snapshot_limit"),
  "backup_limit" = COALESCE(i."backup_limit", p."backup_limit")
FROM "packages" p 
WHERE i."package_id" = p."id" 
AND (i."snapshot_limit" IS NULL OR i."backup_limit" IS NULL);
