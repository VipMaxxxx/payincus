# FX-044 规格：初始 createInstanceAsync 失败不产生 task、不进交付保障中心(F-A BF-5-06)

## owner 裁决
BF-5-06(全同意):初始开通失败**自动开交付保障 case**。

## 现状
`DeliveryAssuranceCase` 绑定 taskId,只覆盖 task 型(recreate/换机/克隆);初始 createInstanceAsync fire-and-forget **不产生 task**,失败(尤其退款也失败)仅 console.error,**无人工接管入口**。证据:admin-delivery.ts:163-213、instances.ts:2253。

## 前置事实
FX-040/049/B504/041 已在实例创建/事务后失败路径做即时补偿(退款+回收);FX-049 已在销毁结算失败落 DeliveryAssuranceCase。本修让**初始开通失败**也自动开 case,与补偿协同(补偿归补偿,case 是人工接管入口),幂等不重复开。

## 修法(只改 routes/instances.ts + routes/admin-delivery.ts(或 db 层建 case 的函数)+ 守卫;不改 schema/package;不碰 transfers(并行))
1. 先只读:DeliveryAssuranceCase 结构(是否必须 taskId?若 taskId 必填则需允许 null 或用哨兵——**优先不改 schema**,看现有字段能否承载"无 task 的初始开通失败")、admin-delivery.ts:163-213 建 case 逻辑、instances.ts:2253 初始失败点、FX-040/049 已有的补偿/case 调用。
2. **初始开通失败自动开 case**:createInstanceAsync 失败(含退款成功/退款也失败两种)时,自动创建 DeliveryAssuranceCase(类型标"初始开通失败",记实例/用户/失败原因/退款状态),作为人工接管入口。
   - 若 DeliveryAssuranceCase.taskId 非空必填且不可改 schema:用现有可空字段或把 case 关联到 instanceId(而非 taskId)——按现有模型能力择最小改动;若确实无法不改 schema 承载,则**在报告中标注需 owner 定 schema**(类似 FX-046),代码侧先把能做的(失败原因落库+告警)做掉。
3. **幂等**:同一实例的初始失败只开一个 case,不与 FX-040/049 的补偿/case 重复。

## 加守卫
`test:delivery-center-guards` 追加:初始 createInstanceAsync 失败自动开 case、幂等。不改 package.json。

## 不许动
不碰 transfers(并行)。不回退 FX-040/049。不改 schema(除非报告标注待 owner)。不 commit。

## 验收
type-check 通过;`test:delivery-center-guards`、`test:instance-create-failure-compensation` 通过。交付一段话:case 怎么关联(taskId/instanceId)、是否需 schema、幂等、守卫结果。
