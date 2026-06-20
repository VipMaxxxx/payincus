-- AlterEnum
ALTER TYPE "FriendshipStatus" ADD VALUE 'rejected';

-- AlterTable
ALTER TABLE "friendships" ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "remark" TEXT;
