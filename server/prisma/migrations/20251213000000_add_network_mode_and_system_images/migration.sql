-- 修改 NetworkMode 枚举：添加新值并重命名
-- 旧值: nat, ipv6, dual
-- 新值: nat, nat_ipv6, ipv4, ipv4_ipv6
-- 注意: PostgreSQL 不允许在同一事务中添加新枚举值后立即使用，所以使用替换枚举类型的方法

-- 1. 创建新的枚举类型
CREATE TYPE "NetworkMode_new" AS ENUM ('nat', 'nat_ipv6', 'ipv4', 'ipv4_ipv6');

-- 2. 修改 packages 表：先删除默认值，转换类型，再恢复默认值
ALTER TABLE "packages" ALTER COLUMN "network_mode" DROP DEFAULT;
ALTER TABLE "packages" ALTER COLUMN "network_mode" TYPE TEXT;
UPDATE "packages" SET "network_mode" = 'nat_ipv6' WHERE "network_mode" = 'ipv6';
UPDATE "packages" SET "network_mode" = 'ipv4_ipv6' WHERE "network_mode" = 'dual';
ALTER TABLE "packages" ALTER COLUMN "network_mode" TYPE "NetworkMode_new" USING "network_mode"::"NetworkMode_new";
ALTER TABLE "packages" ALTER COLUMN "network_mode" SET DEFAULT 'nat'::"NetworkMode_new";

-- 3. 修改 instances 表：先删除默认值，转换类型，再恢复默认值
ALTER TABLE "instances" ALTER COLUMN "network_mode" DROP DEFAULT;
ALTER TABLE "instances" ALTER COLUMN "network_mode" TYPE TEXT;
UPDATE "instances" SET "network_mode" = 'nat_ipv6' WHERE "network_mode" = 'ipv6';
UPDATE "instances" SET "network_mode" = 'ipv4_ipv6' WHERE "network_mode" = 'dual';
ALTER TABLE "instances" ALTER COLUMN "network_mode" TYPE "NetworkMode_new" USING "network_mode"::"NetworkMode_new";
ALTER TABLE "instances" ALTER COLUMN "network_mode" SET DEFAULT 'nat'::"NetworkMode_new";

-- 4. 删除旧枚举类型，重命名新类型
DROP TYPE "NetworkMode";
ALTER TYPE "NetworkMode_new" RENAME TO "NetworkMode";

-- CreateTable
CREATE TABLE "system_images" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "remote_alias" TEXT NOT NULL,
    "os_type" TEXT NOT NULL DEFAULT 'Linux',
    "architecture" TEXT NOT NULL DEFAULT 'x86_64',
    "icon" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_images_remote_alias_key" ON "system_images"("remote_alias");

-- 插入默认镜像数据（remote_alias 包含完整的源前缀）
INSERT INTO "system_images" ("name", "remote_alias", "os_type", "architecture", "icon", "sort_order", "updated_at") VALUES
-- AlmaLinux
('AlmaLinux 8', 'images:almalinux/8/cloud', 'Linux', 'x86_64', 'almalinux', 10, NOW()),
('AlmaLinux 9', 'images:almalinux/9/cloud', 'Linux', 'x86_64', 'almalinux', 11, NOW()),
('AlmaLinux 10', 'images:almalinux/10/cloud', 'Linux', 'x86_64', 'almalinux', 12, NOW()),
-- Alpine
('Alpine 3.19', 'images:alpine/3.19/cloud', 'Linux', 'x86_64', 'alpine', 20, NOW()),
('Alpine 3.20', 'images:alpine/3.20/cloud', 'Linux', 'x86_64', 'alpine', 21, NOW()),
('Alpine 3.21', 'images:alpine/3.21/cloud', 'Linux', 'x86_64', 'alpine', 22, NOW()),
('Alpine Edge', 'images:alpine/edge/cloud', 'Linux', 'x86_64', 'alpine', 29, NOW()),
-- CentOS
('CentOS 9 Stream', 'images:centos/9-Stream/cloud', 'Linux', 'x86_64', 'centos', 30, NOW()),
('CentOS 10 Stream', 'images:centos/10-Stream/cloud', 'Linux', 'x86_64', 'centos', 31, NOW()),
-- Debian
('Debian 11 (Bullseye)', 'images:debian/11/cloud', 'Linux', 'x86_64', 'debian', 40, NOW()),
('Debian 12 (Bookworm)', 'images:debian/12/cloud', 'Linux', 'x86_64', 'debian', 41, NOW()),
('Debian 13 (Trixie)', 'images:debian/13/cloud', 'Linux', 'x86_64', 'debian', 42, NOW()),
-- Fedora
('Fedora 41', 'images:fedora/41/cloud', 'Linux', 'x86_64', 'fedora', 50, NOW()),
('Fedora 42', 'images:fedora/42/cloud', 'Linux', 'x86_64', 'fedora', 51, NOW()),
-- Kali
('Kali Linux', 'images:kali/cloud', 'Linux', 'x86_64', 'kali', 60, NOW()),
-- openSUSE
('openSUSE 15.6', 'images:opensuse/15.6/cloud', 'Linux', 'x86_64', 'opensuse', 70, NOW()),
('openSUSE Tumbleweed', 'images:opensuse/tumbleweed/cloud', 'Linux', 'x86_64', 'opensuse', 79, NOW()),
-- Oracle
('Oracle Linux 8', 'images:oracle/8/cloud', 'Linux', 'x86_64', 'oracle', 80, NOW()),
('Oracle Linux 9', 'images:oracle/9/cloud', 'Linux', 'x86_64', 'oracle', 81, NOW()),
-- Rocky Linux
('Rocky Linux 8', 'images:rockylinux/8/cloud', 'Linux', 'x86_64', 'rockylinux', 90, NOW()),
('Rocky Linux 9', 'images:rockylinux/9/cloud', 'Linux', 'x86_64', 'rockylinux', 91, NOW()),
('Rocky Linux 10', 'images:rockylinux/10/cloud', 'Linux', 'x86_64', 'rockylinux', 92, NOW()),
-- Ubuntu
('Ubuntu 22.04 (Jammy)', 'images:ubuntu/jammy/cloud', 'Linux', 'x86_64', 'ubuntu', 100, NOW()),
('Ubuntu 24.04 (Noble)', 'images:ubuntu/noble/cloud', 'Linux', 'x86_64', 'ubuntu', 101, NOW()),
('Ubuntu 25.04 (Plucky)', 'images:ubuntu/25.04/cloud', 'Linux', 'x86_64', 'ubuntu', 102, NOW()),
('Ubuntu 25.10 (Questing)', 'images:ubuntu/25.10/cloud', 'Linux', 'x86_64', 'ubuntu', 103, NOW());
