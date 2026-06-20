ALTER TYPE "PointsLogType" ADD VALUE IF NOT EXISTS 'badge_draw_spend';
ALTER TYPE "PointsLogType" ADD VALUE IF NOT EXISTS 'badge_select_spend';

CREATE TYPE "UserBadgeSource" AS ENUM ('draw', 'select', 'admin_grant');
CREATE TYPE "BadgeApplicationTarget" AS ENUM ('avatar', 'instance');

ALTER TABLE "users" ADD COLUMN "avatar_badge_id" TEXT;
ALTER TABLE "instances" ADD COLUMN "icon_badge_id" TEXT;

CREATE TABLE "user_badge_ownerships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "badge_id" TEXT NOT NULL,
    "source" "UserBadgeSource" NOT NULL DEFAULT 'draw',
    "application_target" "BadgeApplicationTarget",
    "applied_instance_id" INTEGER,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badge_ownerships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_badge_ownerships_user_id_created_at_idx" ON "user_badge_ownerships"("user_id", "created_at" DESC);
CREATE INDEX "user_badge_ownerships_user_id_badge_id_idx" ON "user_badge_ownerships"("user_id", "badge_id");
CREATE INDEX "user_badge_ownerships_user_id_application_target_idx" ON "user_badge_ownerships"("user_id", "application_target");
CREATE INDEX "user_badge_ownerships_applied_instance_id_idx" ON "user_badge_ownerships"("applied_instance_id");
CREATE UNIQUE INDEX "user_badge_ownerships_one_avatar_per_user_idx" ON "user_badge_ownerships"("user_id") WHERE "application_target" = 'avatar';
CREATE UNIQUE INDEX "user_badge_ownerships_one_badge_per_instance_idx" ON "user_badge_ownerships"("applied_instance_id") WHERE "application_target" = 'instance' AND "applied_instance_id" IS NOT NULL;

ALTER TABLE "user_badge_ownerships" ADD CONSTRAINT "user_badge_ownerships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_badge_ownerships" ADD CONSTRAINT "user_badge_ownerships_applied_instance_id_fkey" FOREIGN KEY ("applied_instance_id") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
