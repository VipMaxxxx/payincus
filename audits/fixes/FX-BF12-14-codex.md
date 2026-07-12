已按 BF-12-14 完成最小修改，未改 schema/package、未改锁定表格、未 commit。

- 同 ID 升级/重装后统一写入 `status='installed'`、`enabled=false`，并清空启用人和启用时间。
- API 序列化、能力审核数据及运行时加载统一使用 `enabled && status === 'enabled'`。
- 管理端升级后显示“待重新启用”，首次按钮为“启用”，并补齐中英繁 i18n。
- 两项守卫已加入升级状态及前后端一致性断言。

验证结果：

- server type-check：通过
- client type-check：通过
- `test:plugin-center-guards`：通过
- `test:frontend-i18n-keys`：通过
- `test:frontend-route-guards`：通过
- `test:frontend-dist-boundary-guards`：通过
- server build：通过
- `test:plugin-runtime-capabilities-guards`：BF-12-14 新增断言通过，但随后被现有充值并行改动阻断：守卫仍断言 `record.orderNo`，代码已改为 `gatewayOrderNo`。未越界修改该支付逻辑或守卫。
- 根级前端 build：Windows 不支持 package 中的 POSIX 环境变量写法，手工 Vite build 又受当前沙箱目录访问限制，未完成。

关键位置：[plugins.ts](/C:/Users/Administrator/Desktop/payinces/server/src/db/plugins.ts:220)、[运行时路由](/C:/Users/Administrator/Desktop/payinces/server/src/routes/plugins.ts:401)、[PluginCenterView.vue](/C:/Users/Administrator/Desktop/payinces/client/src/views/admin/PluginCenterView.vue:719)。
