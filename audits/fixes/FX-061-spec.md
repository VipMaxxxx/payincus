# FX-061 规格：用户级(每月1号)与实例级(节点 resetDay)重置错位(G-A / BF-6-03)

## owner 裁决
**用户级跟随节点重置日**(或废用户级统一实例级)。取**用户级跟随节点重置日**方向(改动更小、不推翻 FX-054-rest)。

## 现状
用户级流量在**每月1号**重置;实例级在**节点 resetDay**重置 → 错位:用户可能实例是新周期但用户级已用量还没重置(或反之),导致误判超限/误放。

## 前置事实(重要)
FX-054-rest 已有 `syncUserExtraTrafficUsed(userId)`:用户级 extraTrafficUsed 由**各实例超基础限额用量汇总**派生;FX-D017 已让重置在采集锁内重建基线;FX-062 已固定 Asia/Shanghai。本修与之协同,勿回退。

## 修法(只改 db/traffic.ts + services/traffic-scheduler.ts + 守卫;不碰 instances(并行 FX-045);不改 schema/package)
1. 先只读:用户级重置(每月1号)代码点、实例级重置(节点 resetDay)、`syncUserExtraTrafficUsed`、用户级已用量字段口径。
2. **用户级重置跟随节点重置日**:
   - 不再用固定"每月1号"重置用户级;改为**当某实例随其节点 resetDay 重置时,同步扣减/重算该实例对用户级已用量的贡献**(与 FX-054-rest 付费重置扣本实例贡献同款口径:扣本实例贡献,不清零整个用户)。
   - 这样用户级已用量始终 = 各实例当前周期已用量之和(与实例级同步),消除错位。
   - 若用户在多节点有实例(不同 resetDay),用户级自然按各实例分别对齐(逐实例贡献随各自节点重置),不需单一"用户 resetDay"。
3. 保持用户级限额(上限)语义;只改"已用量的重置对齐"。与 syncUserExtraTrafficUsed 一致,能复用就复用。

## 加守卫
`test:traffic-reset-locks` 追加:用户级已用量随实例/节点重置逐实例对齐(不再固定每月1号整体清零)。不改 package.json。

## 不许动
不碰 instances(并行)。不回退 FX-054-rest/D017/062。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:traffic-reset-locks`、`test:traffic-route-limit-guards`、`test:traffic-collector-status-guard` 通过。交付一段话:用户级如何改为跟随节点重置日(逐实例贡献)、多节点如何处理、守卫结果。
