/*
  迁移说明：
  1. 创建 package_hosts 表（套餐与宿主机的多对多关联）
  2. 迁移数据：将基于 node_group_id 的绑定转换为精确的宿主机绑定
  3. 删除 node_group_id 字段和 node_groups 表
  4. 对于没有绑定节点组的套餐，绑定套餐所有者的所有宿主机
*/

-- 步骤1: 创建 package_hosts 表
CREATE TABLE "package_hosts" (
    "id" SERIAL NOT NULL,
    "package_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_hosts_pkey" PRIMARY KEY ("id")
);

-- 步骤2: 创建索引和外键
CREATE INDEX "package_hosts_package_id_idx" ON "package_hosts"("package_id");
CREATE INDEX "package_hosts_host_id_idx" ON "package_hosts"("host_id");
CREATE UNIQUE INDEX "package_hosts_package_id_host_id_key" ON "package_hosts"("package_id", "host_id");

ALTER TABLE "package_hosts" ADD CONSTRAINT "package_hosts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "package_hosts" ADD CONSTRAINT "package_hosts_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 步骤3: 迁移数据
-- 3.1: 对于有 node_group_id 的套餐，绑定该节点组下的所有宿主机
INSERT INTO "package_hosts" ("package_id", "host_id", "created_at")
SELECT DISTINCT p.id, h.id, CURRENT_TIMESTAMP
FROM "packages" p
INNER JOIN "hosts" h ON h.node_group_id = p.node_group_id
WHERE p.node_group_id IS NOT NULL;

-- 3.2: 对于没有 node_group_id 的套餐，绑定套餐所有者的所有宿主机
INSERT INTO "package_hosts" ("package_id", "host_id", "created_at")
SELECT DISTINCT p.id, h.id, CURRENT_TIMESTAMP
FROM "packages" p
INNER JOIN "hosts" h ON h.user_id = p.user_id
WHERE p.node_group_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "package_hosts" ph 
    WHERE ph.package_id = p.id AND ph.host_id = h.id
  );

-- 步骤4: 删除外键约束
ALTER TABLE "hosts" DROP CONSTRAINT IF EXISTS "hosts_node_group_id_fkey";
ALTER TABLE "node_groups" DROP CONSTRAINT IF EXISTS "node_groups_user_id_fkey";
ALTER TABLE "packages" DROP CONSTRAINT IF EXISTS "packages_node_group_id_fkey";

-- 步骤5: 删除索引
DROP INDEX IF EXISTS "hosts_node_group_id_idx";

-- 步骤6: 删除字段
ALTER TABLE "hosts" DROP COLUMN IF EXISTS "node_group_id";
ALTER TABLE "packages" DROP COLUMN IF EXISTS "node_group_id";

-- 步骤7: 删除 node_groups 表
DROP TABLE IF EXISTS "node_groups";
