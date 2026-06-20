-- AlterTable
ALTER TABLE "user_quotas" ADD COLUMN     "package_limit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "package_used" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "host_limit" SET DEFAULT 0,
ALTER COLUMN "friend_limit" SET DEFAULT 0;
