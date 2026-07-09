-- AlterEnum
-- 新增独立的余额日志类型：用余额生成礼品卡的扣款。
-- 礼品卡是保值凭证，此扣款不应计入“可兑换积分的消费额”。
ALTER TYPE "BalanceLogType" ADD VALUE IF NOT EXISTS 'gift_card_issue';
