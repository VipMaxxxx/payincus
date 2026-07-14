-- 创建实例时系统自动下发的远程端口映射（Linux=22 / Windows=3389）标记。
-- 该标记为 false 的映射才计入用户端口配额（port_limit）。
-- 无损：新增列并对既有行填充 false —— 既有映射全部是用户手动创建的，语义正确。
ALTER TABLE "port_mappings" ADD COLUMN "system_managed" BOOLEAN NOT NULL DEFAULT false;
