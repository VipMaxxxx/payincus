-- 清理系统配置表中的旧配额字段
-- 删除不再使用的 CPU/内存/磁盘/端口/快照/备份 配额配置

DELETE FROM "system_configs" WHERE "key" IN (
    'default_quota_cpu',
    'default_quota_memory',
    'default_quota_disk',
    'default_quota_port',
    'default_quota_snapshot',
    'default_quota_backup'
);
