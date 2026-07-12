已实现插件交易核心闭环，但本地迁移实际执行和双端 Vite build 受环境限制，不能宣称完全验收。

- 新增 `PluginPurchase / PluginLicense / PluginRefund / PluginDeveloperEarning / PluginDeveloperWithdrawal`，迁移文件为 [20260712180000_add_plugin_trade_core](/C:/Users/Administrator/Desktop/payinces/server/prisma/migrations/20260712180000_add_plugin_trade_core/migration.sql)。
- [plugin-trade.ts](/C:/Users/Administrator/Desktop/payinces/server/src/services/plugin-trade.ts:60) 完成余额购买、永久按版本授权、7 天退款吊销授权并冲回收入、20% 平台抽成、收入冻结至退款窗结束、开发者提现人工审核。
- 金额使用整数分，数据库 CHECK 强制 `gross = fee + net`；CNY/USD 白名单。现有钱包无币种字段，因此不做 FX，按余额与定价同币种前提处理；paid 门禁仍关闭，开放前需 owner 再确认 USD 口径。
- 购买、退款、提现均使用 advisory lock、条件更新和唯一幂等键；重复购买同一版本拒绝。提现目标 API 脱敏、审计不记录目标明文。
- 安装、启用及运行时 action 已接入 paid license 门禁；paid 上架门禁保持不变。
- 新增 `test:plugin-trade-guards`；交易、market、governance、center、runtime、submission、Hosting 提现及余额守卫全部通过。
- server/client type-check、Prisma validate/generate、server build、前端路由及 dist 边界守卫通过。
- `prisma migrate dev` 仅连接本地 `127.0.0.1`，但因账号无创建 shadow database 权限报 P3014，迁移未实际应用。双端 Vite build 又受 Windows 环境变量脚本及 sandbox 目录 ACL 限制未完成；因此未做数据库真机流程。
- 未 commit、push、发版或接触生产；生产迁移仍待 owner。
