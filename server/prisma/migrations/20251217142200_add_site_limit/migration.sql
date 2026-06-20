-- AlterTable: 为套餐添加站点数量限制
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "site_limit" INTEGER NOT NULL DEFAULT 10;

-- AlterTable: 为实例添加站点数量限制（可覆盖套餐设置）
ALTER TABLE "instances" ADD COLUMN IF NOT EXISTS "site_limit" INTEGER;

-- 对于已有实例，从套餐继承站点限制
UPDATE "instances" i SET 
  "site_limit" = COALESCE(i."site_limit", p."site_limit")
FROM "packages" p 
WHERE i."package_id" = p."id" 
AND i."site_limit" IS NULL;
