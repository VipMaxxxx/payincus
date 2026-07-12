# FX-DISC-14 诊断修复:plugin-runtime-capabilities-guards 基线红(gateway/payment 复合断言)

## 背景
`test:plugin-runtime-capabilities-guards` 有一条既有复合 `assert.ok`(约 test-plugin-runtime-capabilities-guards.ts:361-390+,"plugin gateway extension route and payment lifecycle bridge must require admin access...")FAIL。本会话**未碰** plugin-extension-dispatch.ts/plugin-extension-contracts.ts/plugin-payment-lifecycle.ts,该断言读这些文件+routes/plugins.ts+schema。已核实 routes/plugins.ts 的 4 个网关路由子条件都在、负向条件(providerConfigSnapshot/callbackData)=0。属**会话前基线遗留**。

## 任务(诊断优先,最小修复)
1. **逐条 bisect** 该复合 `assert.ok` 的每个子条件,精确定位**哪一个 includes/!includes 不满足**(打印每个子条件的真假)。
2. 判定根因二选一:
   - (a) **代码漂移**:某网关/支付生命周期代码被改得与守卫期望不符,但**功能正确**——则**据实更新该子条件**匹配当前正确代码(仅改该子条件字面,不弱化整体不变量:admin 鉴权/hooks/dispatch/契约/脱敏/审计 语义须仍被断言)。
   - (b) **真 bug**:代码确实缺了守卫要求的安全语义(admin 鉴权/脱敏/审计等)——则**修代码**补齐,不改守卫。
3. 只做**最小**改动;若是 (a) 更新守卫子条件须在报告里逐条说明"旧字面→新字面 + 为何语义不变"。

## 不许动
不改 schema/package。不碰无关文件。不弱化 admin/脱敏/审计等安全不变量。不 commit。

## 验收
`test:plugin-runtime-capabilities-guards` 通过;`test:plugin-center-guards`、`test:plugin-market-guards`、server type-check 通过。交付一段话:失败子条件是哪条、根因(a/b)、怎么修、为何安全不变量不变。
