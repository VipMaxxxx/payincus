-- 简化镜像管理：移除 Image 表，直接在 HostImage 中存储镜像信息

-- 1. 备份现有数据（如果需要恢复）
-- 创建临时表保存现有的 host_images 数据
CREATE TEMP TABLE temp_host_images AS
SELECT 
    hi.id,
    hi.host_id,
    i.remote_alias as image_id,
    i.name,
    i.os_type,
    i.remote_alias,
    COALESCE(i.icon, SPLIT_PART(i.remote_alias, '/', 1)) as icon,
    hi.fingerprint,
    hi.alias,
    hi.size,
    hi.status,
    hi.error_message,
    hi.synced_at,
    hi.created_at,
    hi.updated_at
FROM host_images hi
JOIN images i ON hi.image_id = i.id;

-- 2. 删除外键约束和旧表
DROP TABLE IF EXISTS host_images;
DROP TABLE IF EXISTS images;

-- 3. 创建新的 host_images 表
CREATE TABLE host_images (
    id SERIAL PRIMARY KEY,
    host_id INTEGER NOT NULL,
    image_id VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    os_type VARCHAR(50) NOT NULL DEFAULT 'Linux',
    remote_alias VARCHAR(200) NOT NULL,
    icon VARCHAR(50),
    fingerprint VARCHAR(100),
    alias VARCHAR(100),
    size INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    synced_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_host_images_host FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE CASCADE,
    CONSTRAINT uq_host_images_host_image UNIQUE (host_id, image_id)
);

-- 4. 创建索引
CREATE INDEX idx_host_images_host_id ON host_images(host_id);

-- 5. 恢复数据（将 remote_alias 转换为 image_id 格式）
INSERT INTO host_images (
    host_id, image_id, name, os_type, remote_alias, icon,
    fingerprint, alias, size, status, error_message, synced_at, created_at, updated_at
)
SELECT 
    host_id,
    LOWER(REPLACE(REPLACE(remote_alias, '/', '-'), '.', '-')) as image_id,
    name,
    os_type,
    remote_alias,
    icon,
    fingerprint,
    alias,
    size,
    status::VARCHAR,
    error_message,
    synced_at,
    created_at,
    updated_at
FROM temp_host_images;

-- 6. 清理临时表
DROP TABLE temp_host_images;
