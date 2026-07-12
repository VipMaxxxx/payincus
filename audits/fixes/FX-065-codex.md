FX-065 已按规格形成未提交 diff，但最终审计发现高危冲突，暂不能判定为安全完成。

当前仓库实际数据链路仍按“分”写入：

- 管理端输入 `5.00`，会转换成 `500` 后提交：[PackageFormView.vue](/C:/Users/Administrator/Desktop/payinces/client/src/views/resources/PackageFormView.vue:713)
- 编辑回显时再 `/ 100`：[PackageFormView.vue](/C:/Users/Administrator/Desktop/payinces/client/src/views/resources/PackageFormView.vue:602)
- 套餐方案覆盖也采用相同转换：[MyPackagesView.vue](/C:/Users/Administrator/Desktop/payinces/client/src/views/resources/MyPackagesView.vue:588)
- 服务端接口明确按 integer cents 校验：[packages.ts](/C:/Users/Administrator/Desktop/payinces/server/src/routes/packages.ts:1678)

因此，本次取消扣费端 `/ 100` 后，现有值 `500` 会扣成 500 元，而不是 5 元，存在 100 倍过扣风险。这与规格中“存量 5.00 就是 5 元、无需迁移”的前提冲突。

当前未提交改动包括：

- 扣费解析改成按元直接扣减、保留两位小数：[traffic.ts](/C:/Users/Administrator/Desktop/payinces/server/src/routes/traffic.ts:46)
- 两处 Prisma 注释改为“元”，未改列型、未迁移：[schema.prisma](/C:/Users/Administrator/Desktop/payinces/server/prisma/schema.prisma:1327)
- 套餐及方案表单增加内联“单位:元”：[PackageFormView.vue](/C:/Users/Administrator/Desktop/payinces/client/src/views/resources/PackageFormView.vue:1261)、[MyPackagesView.vue](/C:/Users/Administrator/Desktop/payinces/client/src/views/resources/MyPackagesView.vue:1357)
- 守卫禁止恢复分转换：[test-traffic-reset-locks.ts](/C:/Users/Administrator/Desktop/payinces/server/scripts/test-traffic-reset-locks.ts:30)

验证均通过：

- server/client type-check
- `test:traffic-reset-locks`
- `test:system-config-value-guards`
- `test:frontend-route-guards`
- `test:frontend-dist-boundary-guards`
- user/admin 双端生产构建
- 限定文件 `git diff --check`

未触碰 `client/src/locales/*.ts`；其中现有修改属于并行工作树。未 commit、push、发版。

需要 owner 裁决：同步将写入/回显/API 契约改为元并处理存量数据，还是维持分存储并撤销扣费端改动。仅“取消消费端 `/100` + 不迁移”无法安全交付。
