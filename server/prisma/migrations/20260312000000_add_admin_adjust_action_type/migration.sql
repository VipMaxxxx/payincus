-- 为 HostingActionType 枚举添加 admin_adjust 值
-- 用于标识管理员调整托管余额的操作

ALTER TYPE "HostingActionType" ADD VALUE IF NOT EXISTS 'admin_adjust';
