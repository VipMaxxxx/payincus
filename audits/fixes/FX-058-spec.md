# FX-058 规格：流量通知占领失败不补发 + CaddyClient Agent 泄漏 + 单天图表 NaN(D-078,D-079,D-147)

## 三根因
- **D-078**(P2) `traffic-scheduler.ts:163`:流量通知**发送前占领状态,发送失败被吞不补发** → 通知丢失。修:带状态租约的通知 **outbox**,**发送成功后才 claim**(失败保留待重试)。
- **D-079**(P2) `caddy-client.ts:37`:每个 CaddyClient 建**独立 Agent 不关闭致资源泄漏**。修:按宿主缓存复用 Agent,或 finally 关闭。
- **D-147**(P3) `TrafficStats.vue:341`:单天历史 **X 轴位置计算 NaN%**(除以 0)。修:单条记录固定居中位置。

## 前置事实
FX-063/067/054-rest/D014/D017/061 已改 traffic-scheduler.ts 的通知/带宽逻辑;markInstanceTrafficWarningIfNeeded 等 claim 机制已存在(traffic-notification-claim-guards 锁定)。本修的 D-078 是"发送失败补发",与既有 claim 语义协同——**claim 应表示'已成功发送',失败要能重试**,勿回退既有 claim 守卫结构。

## 修法(只改 services/traffic-scheduler.ts + services/traffic-notifier.ts + lib/caddy-client.ts + client TrafficStats.vue + 守卫;不改 schema/package;不碰 instances(并行 FX-043))
1. **D-078**:通知发送改"先尝试发送→成功后才标记已发/claim";发送失败**不吞**,保留状态待下轮补发(带状态租约避免并发重复发)。与既有 markInstance*WarningIfNeeded 的原子 claim 协同:claim 成功后若发送失败,应能回退/重试(不能 claim 了却没发还不补)。
2. **D-079**:caddy-client 的 https Agent 按宿主缓存复用(module 级 Map<hostKey, Agent>),或每次请求 finally 关闭,消除每 client 一个 Agent 泄漏。与 FX-055/057 的 caddy 改动共存,勿回退。
3. **D-147**:TrafficStats.vue 单条记录(分母为 0)时 X 轴位置固定居中(如 50%),避免 NaN%。
4. 保持通知/图表正常路径不回归。

## 加守卫
`test:traffic-notification-claim-guards`/`test:frontend-route-guards` 追加:通知发送失败可补发(claim 表已发)、caddy Agent 复用/关闭、单天图表固定居中。不改 package.json。

## 不许动
不碰 instances(并行)。不回退 FX-055/057/063/067。不改 schema/package。不 commit。

## 验收
type-check/client type-check 通过;`test:traffic-notification-claim-guards`、`test:proxy-site-route-id-guards`、`test:frontend-route-guards` 通过。交付一段话:outbox/补发怎么做、Agent 复用点、图表居中、守卫结果。
