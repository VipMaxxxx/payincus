已仅修改 [ResourceRiskView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/admin/ResourceRiskView.vue:865)，未 commit。

- 8 张桌面表恢复为 `overflow-hidden` + `table-fixed`，移除全部 `overflow-x-auto` / `min-w-[...]`。
- 保留现有移动端卡片。
- 8 组列宽分别校验，总和均为 100%。
- 原有 36 个 `@click` 表达式与 HEAD 完全一致。
- 长文本改为允许换行。

验证结果：

- ✅ `test:frontend-route-guards`
- ✅ `test:frontend-dist-boundary-guards`
- ✅ client type-check
- ✅ 资源风险前端布局断言逐项通过
- ❌ 完整 `test:resource-risk-guards`：在前端断言之前，被第 87 行既有后端 QoS 断言拦截；失败条件来自当前已修改的 `traffic-bandwidth.ts`/守卫工作区，不在本次允许修改范围内。
- ⚠️ `build:client`：仓库构建脚本使用 POSIX 环境变量语法，Windows 下提示无法识别 `VITE_APP_ENTRY`，与本次 Vue 改动无关。
