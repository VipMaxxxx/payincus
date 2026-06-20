-- 为 BalanceLogType 枚举添加 hosting_withdraw 值
-- 用于记录托管余额提现到面板余额的操作

ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'hosting_withdraw';
