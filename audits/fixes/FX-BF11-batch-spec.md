# 工单策略批:BF-11-01 关闭仍可查看/回复 + BF-11-13 网页可重开 + BF-11-03 自动关闭计时(G-D 全同意)

## 三条裁决
- **BF-11-01**:`ticket_enabled` 关闭时**仅禁新建**,仍允许用户进入工单中心**查看/回复/关闭已有**工单。证据:system-config.ts:72、router/user.ts:373。
- **BF-11-13**:普通用户**网页端也可重开**已关闭工单(现仅 Public API 可)。证据:tickets.ts:1205、TicketsView.vue:1277、public-api.ts:2482。
- **BF-11-03**:自动关闭 24h **从"最后一条公开消息"重新计算**(现从 resolvedAt,客服追加回复不刷新)。证据:db/tickets.ts:1056、1268、notifier.ts:715。

## 修法(只改 routes/tickets.ts + db/tickets.ts + routes/system-config.ts(仅 ticket_enabled 语义)+ router/user.ts + client TicketsView.vue + notifier.ts + 守卫;不改 schema/package;不碰 redeem-codes/user-lifecycle/checkin(并行))
1. **BF-11-01**:`ticket_enabled=false` 时后端**只拦截创建**接口;查看/回复/关闭已有工单接口放行;前端 `router/user.ts:373` 的 /tickets 守卫改为**不再整体跳回**(允许进入,仅隐藏/禁用"新建"入口)。
2. **BF-11-13**:tickets.ts 增加**网页端重开**入口(复用 public-api 的重开逻辑,置回 open,权限=工单所属用户);TicketsView.vue 加"重开"按钮(已关闭态可见)。补 i18n key。
3. **BF-11-03**:自动关闭计时锚点从 `resolvedAt` 改为**最后一条公开消息时间**(db/tickets.ts:1056/1268 查询取 max(公开消息 createdAt));notifier 文案同步"距最后回复24h"。客服追加公开回复应刷新计时。
4. 保持工单其它逻辑不回归。

## 加守卫
`test:ticket-query-guards`/`test:ticket-auto-close-guards`/`test:ticket-success-guards` 追加:关闭仅禁创建、网页可重开、自动关闭从最后公开消息计时。不改 package.json。

## 不许动
不碰 redeem-codes/user-lifecycle/checkin(并行)。不改 schema/package。不改锁定表格。不 commit。

## 验收
type-check/client type-check 通过;`test:ticket-query-guards`、`test:ticket-auto-close-guards`、`test:ticket-success-guards`、`test:frontend-i18n-keys`、`test:frontend-route-guards` 通过。交付一段话:三点各改法、守卫结果。
