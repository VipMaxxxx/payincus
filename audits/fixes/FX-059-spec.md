# FX-059 规格：trafficLimitSpeed 字段义与代码相反 + 无独立超量限速值(G-A / BF-6-08 / D-...)

## owner 裁决
BF-6-08:`trafficLimitSpeed` **定义为"正常线速"**(代码现状);统一**改名/注释**;**另设独立超量限速值**。

## 现状
`trafficLimitSpeed` 字段名/注释是"超限后限速值",代码却当"正常线速"用(建实例做 limits、恢复回到它,默认1Mbit)→ 管理员按字面填低会把客户平时带宽设成1Mbit。超量限速当前用硬编码 `THROTTLE_BANDWIDTH`(FX-063 的常量)。证据:instances.ts:1802-1818、schema.prisma:4220、traffic-bandwidth.ts。

## 修法(只改 lib/traffic-bandwidth.ts + services/traffic-scheduler.ts + routes/system-config.ts + 守卫;**不改 schema**(不重命名 DB 列);不碰 traffic-notifier(并行 FX-064))
1. **语义澄清(不改 schema 列名)**:在代码里通过**注释 + 局部变量/getter 命名**明确 `trafficLimitSpeed` = **正常线速(normal line speed)**;schema.prisma 的字段**注释**改为"正常线速"(仅注释,不改列名/类型,不产生迁移)。FX-063 已用它做基线,勿破坏。
2. **独立超量限速值(system-config,免 schema)**:把 FX-063 硬编码的超量限速 `THROTTLE_BANDWIDTH` 改为**可配置系统项**(如 `traffic_overage_throttle_speed`,默认 `1Mbit`),从 system-config 读取;traffic-bandwidth 仲裁点用该配置值作"流量超量约束",不再硬编码。
3. 保持 FX-063 仲裁逻辑(最严者胜、基线取 trafficLimitSpeed)不变,只把超量值来源改为配置。

## 加守卫
`test:plan-bandwidth-limit-guards`/`test:traffic-route-limit-guards`/`test:system-config-value-guards` 追加:trafficLimitSpeed 注释=正常线速、超量限速值走 system-config 非硬编码。不改 package.json。

## 不许动
不碰 traffic-notifier(并行 FX-064)。不改 schema 列/类型。不回退 FX-063。不 commit。

## 验收
type-check 通过;`test:plan-bandwidth-limit-guards`、`test:traffic-route-limit-guards`、`test:system-config-value-guards` 通过。交付一段话:注释怎么澄清、超量值配置项 key/默认、守卫结果。
