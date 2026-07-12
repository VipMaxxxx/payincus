# OTA 补 DB 迁移支持(让带 schema 变更的版本能完成 OTA 升级)

## 背景(生产实证)
生产 147.x 已装原子 OTA(current/releases + 自动回滚),但 `run-system-update-task.ts` **全流程不跑 prisma 迁移**。本会话有 3 处迁移(idempotencyKey/traffic_reset_price_to_yuan/plugin_trade_core),且未来带 schema 的版本 OTA 上去会缺表缺列崩。**回滚只回滚代码 symlink、不回滚 DB**——需妥善处理。

## 现有流程(勿破坏)
取产物→下载校验解压到 releaseDir→`switchCurrentRelease(599)`→`systemctl restart`+`waitForBackendHealth(670)`→失败 `switchCurrentRelease(backup)` 自动回滚+重启。

## 修法(只改 server/src/scripts/run-system-update-task.ts + 守卫;不改业务逻辑;高危 OTA 文件,最小改动)
1. `requiredCommands` 增加 `pg_dump`(和 `pnpm`/`prisma` 视需要);缺则明确报错。
2. **迁移前 DB 备份**:在跑迁移前用 `pg_dump` 把生产库导出到 `backupDir/db-pre-migrate-<ver>-<ts>.sql`(用 .env 的 DATABASE_URL;失败则中止 OTA 不硬来)。
3. **跑迁移**:切到新 release 后、**restart 之前**,在新 release 目录执行 `pnpm --filter server exec prisma migrate deploy`(或 `npx prisma migrate deploy`,schema 指向新 release 的 server/prisma)。`migrate deploy` 只应用已存在迁移、幂等、无 shadow DB;失败→中止并走既有失败清理+代码回滚。
4. **DB 不自动回滚的处理**:代码自动回滚时,**日志明确告警**"DB 已迁移但代码回滚,DB 与旧代码可能不兼容;如需回滚 DB 请用 `backupDir/db-pre-migrate-*.sql` 手工恢复",并保留该备份(不清理)。不尝试自动 DB 回滚(危险)。
5. 顺序权衡:迁移放在 switch 之后 restart 之前,保证新代码+新 schema 一致后再起服务;健康失败回滚代码时 DB 备份可用。

## 加守卫
`test:system-update-guards` 追加:OTA 流程含 pg_dump 备份 + prisma migrate deploy(restart 前)+ 迁移失败中止 + 备份保留告警。

## 不许动
不 commit/push/发版/OTA。不碰生产。不改其它业务逻辑。

## 验收
`pnpm --filter server type-check` 通过;`test:system-update-guards` 通过。交付一段话:迁移插入点、备份策略、失败/回滚处理、requiredCommands、守卫结果。
