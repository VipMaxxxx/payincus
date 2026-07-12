# BF-12-14 规格：插件升级后 enabled/status 不一致(界面显示启用、实际不加载)(G-E 同意)

## 裁决
升级后必须进入"**待重新启用**"状态,前后端统一显示。

## 现状
重装同 ID 把 status 改回 installed 但 enabled 仍 true,运行时要求两者同为 enabled,前端主要看 enabled → 升级后"显示启用实际不加载",首次点击执行的是禁用。证据:db/plugins.ts:635-647、plugins.ts:398。

## 修法(只改 db/plugins.ts + routes/plugins.ts + client PluginCenterView.vue + 守卫;不改 schema/package;不碰前面并行)
1. 先只读:重装/升级同 ID 的 status/enabled 写法、运行时加载条件、前端启用态展示。
2. **升级后进"待重新启用"**:重装/升级同 ID 时把 `enabled=false`(或统一状态标记"待重新启用"),status 与 enabled 一致;运行时不加载(符合现有"两者同 enabled 才加载");前端展示"待重新启用"而非"已启用",首次点击是"启用"而非"禁用"。
3. 前后端状态口径统一(同一真源);补必要 i18n。

## 加守卫
`test:plugin-center-guards`/`test:plugin-runtime-capabilities-guards` 追加:升级后 enabled=false/待重新启用、前后端一致。不改 package.json。

## 不许动
不改 schema/package。不 commit。

## 验收
type-check/client type-check 通过;`test:plugin-center-guards`、`test:plugin-runtime-capabilities-guards`、`test:frontend-i18n-keys`、`test:frontend-route-guards` 通过。交付一段话:状态统一点、前端展示、守卫结果。
