# 波4:工单自动关闭可配+可关(G-D BF-11-02,全同意)

## 裁决
自动关闭**加可配置+可关**(现固定 24h、不可配/不可关)。

## 现状
无后台开关或超时配置,resolved 后固定 24h(每小时扫描,实际24~25h)自动关。证据:db/tickets.ts:1256、ticket-auto-close-scheduler.ts:17。

## 修法(只改 routes/system-config.ts + services/ticket-auto-close-scheduler.ts + db/tickets.ts + 必要管理端配置 UI + 守卫;不改 schema/package;不碰 mail(并行))
1. 先只读:ticket-auto-close-scheduler 固定 24h、db/tickets.ts:1256 自动关查询、system-config 现有配置项模式、管理端配置页。
2. **可配置**:新增系统配置 `ticket_auto_close_enabled`(bool,默认 true)+ `ticket_auto_close_hours`(int,默认 24,合理下限如≥1)。
3. **可关**:`ticket_auto_close_enabled=false` 时调度器**跳过自动关闭**;`=true` 时用配置的 hours(替代硬编码 24)计算 cutoff(仍按 BF-11-03 从最后公开消息计时)。
4. 管理端配置页加这两项(内联提示,尽量复用现有系统配置 UI,不新增锁定表格;i18n 齐)。
5. 与 BF-11-03(最后公开消息计时)、BF-11-batch 协同,勿回退。

## 加守卫
`test:ticket-auto-close-guards`/`test:system-config-value-guards` 追加:自动关闭可配 enabled/hours、关闭时不自动关、hours 替代硬编码。不改 package.json。

## 不许动
不碰 mail(并行)。不回退 BF-11 系列。不改 schema/package。不改锁定表格。不 commit。

## 验收
type-check/client type-check 通过;`test:ticket-auto-close-guards`、`test:system-config-value-guards`、`test:frontend-i18n-keys`、`test:frontend-route-guards` 通过。交付一段话:两配置项、可关逻辑、hours 生效、守卫结果。
