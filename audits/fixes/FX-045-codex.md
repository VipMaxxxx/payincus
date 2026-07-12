FX-045 已按规格完成，未 commit/push/发版。

- `Instance` 无 `errorMessage/failReason/statusMessage` 字段，未改 schema。
- 复用 FX-044：失败原因经脱敏后持久化到 `DeliveryAssuranceCase.lastError`。
- [instances.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/instances.ts:2362) 在错误实例详情响应中返回 `failureReason`。
- [InstanceDetailView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/InstanceDetailView.vue:2923) 在异常横幅展示具体失败原因，使用纯文本避免注入。
- 新增 i18n key：`instance.errorBanner.reasonLabel`，已补齐 en、zh-CN、zh-TW。
- 增加后端读取、前端展示和 i18n 完整性守卫断言。
- 未修改 traffic、锁定表格或 `package.json`。

验证结果：

- `test:frontend-route-guards`：通过
- `test:frontend-i18n-keys`：通过
- `test:instance-route-id-guards`：通过
- client type-check：通过
- server type-check：通过
- `git diff --check`：通过

双端 Vite build 未完成：仓库构建脚本的 POSIX 环境变量语法无法直接在 Windows 执行；等价命令又因沙箱禁止 Vite/esbuild 读取工作区外父目录而中止。按本次验收“build 或 client type-check”，client type-check 已通过。未进行真实失败交付流程验证。
