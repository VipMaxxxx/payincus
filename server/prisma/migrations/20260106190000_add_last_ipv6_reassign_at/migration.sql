-- AlterTable: 添加 IPv6 重新分配冷却时间字段（每实例每天限一次）
ALTER TABLE "instances" ADD COLUMN "last_ipv6_reassign_at" TIMESTAMP(3);
