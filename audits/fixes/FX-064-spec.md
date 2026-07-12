# FX-064 规格：流量通知文案写死"限速1Mbit/下月1日重置"(G-A / BF-6-09)

## owner 裁决
BF-6-09:通知文案改为**按实际恢复带宽与实际节点重置日动态生成**。

## 现状
`traffic-notifier.ts:116-117、174-176`:预警写死"限速至1Mbit"、限速写死"下月1日重置",与方案实际恢复带宽(=正常线速 trafficLimitSpeed)、节点实际 resetDay 不符。

## 修法(只改 services/traffic-notifier.ts + client i18n(en/zh-CN/zh-TW)+ 守卫;不碰 traffic-scheduler/traffic-bandwidth(并行 FX-059);不改 schema/package)
1. 先只读:traffic-notifier 的预警/限速通知函数签名(能拿到哪些参数:实例/方案/节点?)、i18n 文案 key、FX-061 后节点 resetDay 从哪取、正常线速 trafficLimitSpeed 从方案取。
2. **文案动态化**:
   - 预警/限速文案里的"限速至 X":X 取**实际超量限速值/恢复后正常线速**(从传入的方案/实例上下文取;若 notifier 已有该上下文直接用,缺则从入参补;**不改 traffic-scheduler**——若确实缺参数,在 notifier 内按 instanceId 查一次 DB 补齐,不动调用方)。
   - "下月1日重置" → 按**节点实际 resetDay** 动态生成(如"每月 N 日重置"或下次重置日期)。
   - i18n 文案改为带占位符({speed}/{resetDay}/{date}),补齐 en/zh-CN/zh-TW,过 frontend-i18n-keys。
3. 不改通知发送机制(FX-058 的 claim/补发保持)。

## 加守卫
`test:frontend-i18n-keys`/相关通知守卫追加:文案含动态占位符、不再硬编码 1Mbit/下月1日。不改 package.json。

## 不许动
不碰 traffic-scheduler/traffic-bandwidth(并行 FX-059)。不回退 FX-058。不改 schema/package。不 commit。

## 验收
type-check/client type-check 通过;`test:frontend-i18n-keys`、`test:traffic-notification-claim-guards` 通过。交付一段话:动态取值来源、i18n 占位符、守卫结果。
