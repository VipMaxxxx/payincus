-- 自动快照/备份策略重构迁移
-- 1. 将 interval_hours 改为 interval_minutes（支持更细粒度的频率设置）
-- 2. 移除 retention_count（额度直接继承自套餐包）

-- =====================================================
-- 1. 修改 snapshot_policies 表
-- =====================================================

-- 添加 interval_minutes 字段，默认值为原 interval_hours * 60
ALTER TABLE "snapshot_policies" ADD COLUMN "interval_minutes" INTEGER NOT NULL DEFAULT 360;

-- 迁移现有数据：将 interval_hours 转换为分钟
UPDATE "snapshot_policies" SET "interval_minutes" = "interval_hours" * 60;

-- 删除旧字段
ALTER TABLE "snapshot_policies" DROP COLUMN "interval_hours";
ALTER TABLE "snapshot_policies" DROP COLUMN "retention_count";

-- =====================================================
-- 2. 修改 backup_policies 表
-- =====================================================

-- 添加 interval_minutes 字段，默认值为原 interval_hours * 60
ALTER TABLE "backup_policies" ADD COLUMN "interval_minutes" INTEGER NOT NULL DEFAULT 1440;

-- 迁移现有数据：将 interval_hours 转换为分钟
UPDATE "backup_policies" SET "interval_minutes" = "interval_hours" * 60;

-- 删除旧字段
ALTER TABLE "backup_policies" DROP COLUMN "interval_hours";
ALTER TABLE "backup_policies" DROP COLUMN "retention_count";
