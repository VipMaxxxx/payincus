# FX-063 规格：流量超量限速与风控 QoS 两套共用带宽字段互不感知(BF-6-13 / G-A)

## owner 裁决
BF-6-13:流量限速与风控 QoS **统一到一个带宽仲裁点(明确优先级)**。

## 根因
`resource-risk.ts:605-606` 与 `traffic-scheduler.ts:214-219`:两套系统**各自捕获/恢复 `original` 带宽**,叠加时**恢复目标可能取到对方的限速值**(如流量限速把带宽压到 X,风控恢复时把 X 当成 original 恢复,或反之)→ 用户带宽被错误锁死/错误放开。

## 修法(只改 resource-risk.ts + traffic-scheduler.ts(+ 可加一个共享带宽仲裁 helper,放二者之一或 lib)+ 守卫;不改 schema/package;不碰 instances(并行))
1. 先只读:两处 original 捕获/恢复逻辑、正常线速从哪来(套餐/实例配置 `trafficLimitSpeed`=正常线速,见 BF-6-08)、风控 QoS 档位带宽、流量超量限速目标带宽如何算。
2. **单一权威正常线速**:正常线速从**套餐/实例配置**取(权威基线),**绝不从实时带宽状态捕获**(避免捕获到对方的限速值)。
3. **单一仲裁点(最严者胜)**:实现一个 `computeEffectiveBandwidth(instance)`(或等价),返回所有**当前生效约束**的**最小带宽**:
   - 正常线速(基线);
   - 若流量超量生效 → 流量超量限速目标;
   - 若风控 QoS 生效 → 风控 QoS 档带宽;
   - 取三者最小值(最严格者胜);两者都不生效 → 正常线速。
   两套系统各自只**设置/清除自己的生效标志/目标**,然后都调用该仲裁点重算并落实际带宽;**不再各自恢复 original**。
4. **恢复(解除某一约束)**:某约束解除时,重新调用仲裁点按**剩余生效约束**重算带宽(而非恢复到某个捕获值)。这样两约束叠加/先后解除都正确。
5. 与 FX-060(实例级 80% 预警)、FX-066(风控衰减)不冲突,勿回退。

## 加守卫
`test:traffic-route-limit-guards`/`test:resource-risk-guards` 追加:存在单一带宽仲裁点(最严者胜)、正常线速取配置非捕获、解除约束按剩余约束重算。不改 package.json。

## 不许动
不碰 instances(并行)。不回退 FX-060/066/067。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:traffic-route-limit-guards`、`test:resource-risk-guards`、`test:traffic-notification-claim-guards` 通过。交付一段话:仲裁点在哪、优先级(最严者胜)、正常线速来源、叠加/解除如何重算、守卫结果。
