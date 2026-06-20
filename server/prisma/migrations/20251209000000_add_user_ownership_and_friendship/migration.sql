-- 创建好友关系状态枚举
CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted');

-- 创建好友关系表
CREATE TABLE "friendships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "friend_id" INTEGER NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- 添加 user_id 列到 hosts 表（先允许 NULL）
ALTER TABLE "hosts" ADD COLUMN "user_id" INTEGER;

-- 添加 user_id 列到 images 表（先允许 NULL）
ALTER TABLE "images" ADD COLUMN "user_id" INTEGER;

-- 添加 user_id 列到 packages 表（先允许 NULL）
ALTER TABLE "packages" ADD COLUMN "user_id" INTEGER;

-- 添加 user_id 列到 node_groups 表（先允许 NULL）
ALTER TABLE "node_groups" ADD COLUMN "user_id" INTEGER;

-- 将现有数据的 user_id 设置为第一个管理员用户
-- 如果没有管理员用户，则设置为第一个用户
UPDATE "hosts" SET "user_id" = (
    SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "images" SET "user_id" = (
    SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "packages" SET "user_id" = (
    SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "node_groups" SET "user_id" = (
    SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

-- 如果仍有 NULL 值（没有管理员用户的情况），使用第一个用户
UPDATE "hosts" SET "user_id" = (
    SELECT "id" FROM "users" ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "images" SET "user_id" = (
    SELECT "id" FROM "users" ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "packages" SET "user_id" = (
    SELECT "id" FROM "users" ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "node_groups" SET "user_id" = (
    SELECT "id" FROM "users" ORDER BY "id" LIMIT 1
) WHERE "user_id" IS NULL;

-- 删除 hosts 表原有的唯一约束
DROP INDEX IF EXISTS "hosts_name_key";

-- 删除 node_groups 表原有的唯一约束
DROP INDEX IF EXISTS "node_groups_name_key";

-- 设置 NOT NULL 约束
ALTER TABLE "hosts" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "images" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "packages" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "node_groups" ALTER COLUMN "user_id" SET NOT NULL;

-- 添加外键约束
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_friend_id_fkey" 
    FOREIGN KEY ("friend_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosts" ADD CONSTRAINT "hosts_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "images" ADD CONSTRAINT "images_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "packages" ADD CONSTRAINT "packages_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "node_groups" ADD CONSTRAINT "node_groups_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 添加唯一约束
CREATE UNIQUE INDEX "friendships_user_id_friend_id_key" ON "friendships"("user_id", "friend_id");
CREATE UNIQUE INDEX "hosts_user_id_name_key" ON "hosts"("user_id", "name");
CREATE UNIQUE INDEX "images_user_id_name_key" ON "images"("user_id", "name");
CREATE UNIQUE INDEX "packages_user_id_name_key" ON "packages"("user_id", "name");
CREATE UNIQUE INDEX "node_groups_user_id_name_key" ON "node_groups"("user_id", "name");

-- 添加索引
CREATE INDEX "friendships_friend_id_status_idx" ON "friendships"("friend_id", "status");
CREATE INDEX "friendships_user_id_status_idx" ON "friendships"("user_id", "status");
CREATE INDEX "hosts_user_id_idx" ON "hosts"("user_id");
CREATE INDEX "images_user_id_idx" ON "images"("user_id");
CREATE INDEX "packages_user_id_idx" ON "packages"("user_id");
CREATE INDEX "node_groups_user_id_idx" ON "node_groups"("user_id");
