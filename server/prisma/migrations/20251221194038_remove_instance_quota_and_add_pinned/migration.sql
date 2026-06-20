-- AlterTable: Add pinned field to help_articles
ALTER TABLE "help_articles" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Remove instance quota fields from user_quotas
ALTER TABLE "user_quotas" DROP COLUMN "instance_limit";
ALTER TABLE "user_quotas" DROP COLUMN "instance_used";

