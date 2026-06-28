CREATE TABLE "daily_checkins" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "date_key" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "streak_days" INTEGER NOT NULL DEFAULT 1,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_checkins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_checkins_user_id_date_key_key" ON "daily_checkins"("user_id", "date_key");
CREATE INDEX "daily_checkins_user_id_created_at_idx" ON "daily_checkins"("user_id", "created_at" DESC);
CREATE INDEX "daily_checkins_date_key_created_at_idx" ON "daily_checkins"("date_key", "created_at" DESC);

ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "system_configs" ("key", "value", "type", "label", "description", "created_at", "updated_at") VALUES
  ('checkin_enabled', 'true', 'boolean', '每日签到', '是否开放用户每日签到领取积分', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('checkin_min_points', '1', 'number', '签到最小积分', '每日签到随机积分下限', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('checkin_max_points', '500', 'number', '签到最大积分', '每日签到随机积分上限', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('checkin_require_instance', 'false', 'boolean', '签到要求实例', '开启后，用户需要至少拥有一个未删除实例才能签到', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
