已完成 FX-072，未 commit。

- 申领事务按 `reserveResources` 同款 `updateMany + 剩余容量 where + count===0` 原子校验 CPU、内存、磁盘；磁盘按 `storageSize × 1024` 转为 MB。
- 超限抛出 `HOST_RESOURCES_INSUFFICIENT`，事务回滚池余额、日志和实例记录；路由随后执行既有 Incus patch 回滚。
- `amount` 限制为正安全整数，最大 `104_857_600`，路由与 DB 双层校验。
- 仅修改两个指定源文件及两个守卫，未改 schema/package/caddy-client。

验证全部通过：

- `test:resource-pool-apply-consistency`
- `test:host-resource-atomic-guards`
- server `type-check`
- `git diff --check`
