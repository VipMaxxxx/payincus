-- Refresh default system image catalog.
-- Keep custom admin-created images, but remove the old built-in defaults that
-- are no longer part of the supported catalog.

DELETE FROM "system_images"
WHERE "remote_alias" IN (
  'images:alpine/3.19/cloud',
  'images:alpine/3.20/cloud',
  'images:fedora/41/cloud',
  'images:fedora/42/cloud',
  'images:kali/cloud',
  'images:opensuse/15.6/cloud',
  'images:opensuse/tumbleweed/cloud',
  'images:oracle/8/cloud',
  'images:oracle/9/cloud',
  'images:ubuntu/25.04/cloud'
);

INSERT INTO "system_images" ("name", "remote_alias", "os_type", "architecture", "instance_type", "icon", "sort_order", "updated_at") VALUES
-- Alpine
('Alpine 3.21', 'images:alpine/3.21/cloud', 'Linux', 'x86_64', 'both', 'alpine', 100, NOW()),
('Alpine 3.21', 'images:alpine/3.21/cloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 101, NOW()),
('Alpine 3.21 Tiny Cloud', 'images:alpine/3.21/tinycloud', 'Linux', 'x86_64', 'both', 'alpine', 102, NOW()),
('Alpine 3.21 Tiny Cloud', 'images:alpine/3.21/tinycloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 103, NOW()),
('Alpine 3.22', 'images:alpine/3.22/cloud', 'Linux', 'x86_64', 'both', 'alpine', 104, NOW()),
('Alpine 3.22', 'images:alpine/3.22/cloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 105, NOW()),
('Alpine 3.22 Tiny Cloud', 'images:alpine/3.22/tinycloud', 'Linux', 'x86_64', 'both', 'alpine', 106, NOW()),
('Alpine 3.22 Tiny Cloud', 'images:alpine/3.22/tinycloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 107, NOW()),
('Alpine 3.23', 'images:alpine/3.23/cloud', 'Linux', 'x86_64', 'both', 'alpine', 108, NOW()),
('Alpine 3.23', 'images:alpine/3.23/cloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 109, NOW()),
('Alpine 3.23 Tiny Cloud', 'images:alpine/3.23/tinycloud', 'Linux', 'x86_64', 'both', 'alpine', 110, NOW()),
('Alpine 3.23 Tiny Cloud', 'images:alpine/3.23/tinycloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 111, NOW()),
('Alpine 3.24', 'images:alpine/3.24/cloud', 'Linux', 'x86_64', 'both', 'alpine', 112, NOW()),
('Alpine 3.24', 'images:alpine/3.24/cloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 113, NOW()),
('Alpine 3.24 Tiny Cloud', 'images:alpine/3.24/tinycloud', 'Linux', 'x86_64', 'both', 'alpine', 114, NOW()),
('Alpine 3.24 Tiny Cloud', 'images:alpine/3.24/tinycloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 115, NOW()),
('Alpine Edge', 'images:alpine/edge/cloud', 'Linux', 'x86_64', 'both', 'alpine', 116, NOW()),
('Alpine Edge', 'images:alpine/edge/cloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 117, NOW()),
('Alpine Edge Tiny Cloud', 'images:alpine/edge/tinycloud', 'Linux', 'x86_64', 'both', 'alpine', 118, NOW()),
('Alpine Edge Tiny Cloud', 'images:alpine/edge/tinycloud/arm64', 'Linux', 'aarch64', 'both', 'alpine', 119, NOW()),
-- Debian
('Debian 11 (Bullseye)', 'images:debian/11/cloud', 'Linux', 'x86_64', 'both', 'debian', 200, NOW()),
('Debian 11 (Bullseye)', 'images:debian/11/cloud/arm64', 'Linux', 'aarch64', 'both', 'debian', 201, NOW()),
('Debian 12 (Bookworm)', 'images:debian/12/cloud', 'Linux', 'x86_64', 'both', 'debian', 202, NOW()),
('Debian 12 (Bookworm)', 'images:debian/12/cloud/arm64', 'Linux', 'aarch64', 'both', 'debian', 203, NOW()),
('Debian 13 (Trixie)', 'images:debian/13/cloud', 'Linux', 'x86_64', 'both', 'debian', 204, NOW()),
('Debian 13 (Trixie)', 'images:debian/13/cloud/arm64', 'Linux', 'aarch64', 'both', 'debian', 205, NOW()),
('Debian 14 (Forky)', 'images:debian/14/cloud', 'Linux', 'x86_64', 'both', 'debian', 206, NOW()),
('Debian 14 (Forky)', 'images:debian/14/cloud/arm64', 'Linux', 'aarch64', 'both', 'debian', 207, NOW()),
-- Ubuntu
('Ubuntu 22.04 (Jammy)', 'images:ubuntu/jammy/cloud', 'Linux', 'x86_64', 'both', 'ubuntu', 300, NOW()),
('Ubuntu 22.04 (Jammy)', 'images:ubuntu/jammy/cloud/arm64', 'Linux', 'aarch64', 'both', 'ubuntu', 301, NOW()),
('Ubuntu 24.04 (Noble)', 'images:ubuntu/noble/cloud', 'Linux', 'x86_64', 'both', 'ubuntu', 302, NOW()),
('Ubuntu 24.04 (Noble)', 'images:ubuntu/noble/cloud/arm64', 'Linux', 'aarch64', 'both', 'ubuntu', 303, NOW()),
('Ubuntu 25.10 (Questing)', 'images:ubuntu/25.10/cloud', 'Linux', 'x86_64', 'both', 'ubuntu', 304, NOW()),
('Ubuntu 25.10 (Questing)', 'images:ubuntu/25.10/cloud/arm64', 'Linux', 'aarch64', 'both', 'ubuntu', 305, NOW()),
('Ubuntu 26.04 (Resolute)', 'images:ubuntu/26.04/cloud', 'Linux', 'x86_64', 'both', 'ubuntu', 306, NOW()),
('Ubuntu 26.04 (Resolute)', 'images:ubuntu/26.04/cloud/arm64', 'Linux', 'aarch64', 'both', 'ubuntu', 307, NOW()),
-- Rocky Linux
('Rocky Linux 8', 'images:rockylinux/8/cloud', 'Linux', 'x86_64', 'both', 'rockylinux', 400, NOW()),
('Rocky Linux 8', 'images:rockylinux/8/cloud/arm64', 'Linux', 'aarch64', 'container', 'rockylinux', 401, NOW()),
('Rocky Linux 9', 'images:rockylinux/9/cloud', 'Linux', 'x86_64', 'both', 'rockylinux', 402, NOW()),
('Rocky Linux 9', 'images:rockylinux/9/cloud/arm64', 'Linux', 'aarch64', 'container', 'rockylinux', 403, NOW()),
('Rocky Linux 10', 'images:rockylinux/10/cloud', 'Linux', 'x86_64', 'both', 'rockylinux', 404, NOW()),
('Rocky Linux 10', 'images:rockylinux/10/cloud/arm64', 'Linux', 'aarch64', 'container', 'rockylinux', 405, NOW()),
-- AlmaLinux
('AlmaLinux 8', 'images:almalinux/8/cloud', 'Linux', 'x86_64', 'both', 'almalinux', 500, NOW()),
('AlmaLinux 8', 'images:almalinux/8/cloud/arm64', 'Linux', 'aarch64', 'container', 'almalinux', 501, NOW()),
('AlmaLinux 9', 'images:almalinux/9/cloud', 'Linux', 'x86_64', 'both', 'almalinux', 502, NOW()),
('AlmaLinux 9', 'images:almalinux/9/cloud/arm64', 'Linux', 'aarch64', 'container', 'almalinux', 503, NOW()),
('AlmaLinux 10', 'images:almalinux/10/cloud', 'Linux', 'x86_64', 'both', 'almalinux', 504, NOW()),
('AlmaLinux 10', 'images:almalinux/10/cloud/arm64', 'Linux', 'aarch64', 'container', 'almalinux', 505, NOW()),
-- CentOS
('CentOS 9 Stream', 'images:centos/9-Stream/cloud', 'Linux', 'x86_64', 'both', 'centos', 600, NOW()),
('CentOS 9 Stream', 'images:centos/9-Stream/cloud/arm64', 'Linux', 'aarch64', 'container', 'centos', 601, NOW()),
('CentOS 10 Stream', 'images:centos/10-Stream/cloud', 'Linux', 'x86_64', 'both', 'centos', 602, NOW()),
('CentOS 10 Stream', 'images:centos/10-Stream/cloud/arm64', 'Linux', 'aarch64', 'container', 'centos', 603, NOW())
ON CONFLICT ("remote_alias") DO UPDATE SET
  "name" = EXCLUDED."name",
  "os_type" = EXCLUDED."os_type",
  "architecture" = EXCLUDED."architecture",
  "instance_type" = EXCLUDED."instance_type",
  "icon" = EXCLUDED."icon",
  "sort_order" = EXCLUDED."sort_order",
  "hidden" = false,
  "updated_at" = NOW();
