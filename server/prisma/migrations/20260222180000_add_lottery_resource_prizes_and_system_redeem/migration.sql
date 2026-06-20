-- AlterEnum: Add resource prize types to LotteryPrizeType
ALTER TYPE "LotteryPrizeType" ADD VALUE 'cpu';
ALTER TYPE "LotteryPrizeType" ADD VALUE 'memory';
ALTER TYPE "LotteryPrizeType" ADD VALUE 'disk';
ALTER TYPE "LotteryPrizeType" ADD VALUE 'traffic';

-- AlterEnum: Add system_redeem to ResourcePoolAction
ALTER TYPE "ResourcePoolAction" ADD VALUE 'system_redeem';
