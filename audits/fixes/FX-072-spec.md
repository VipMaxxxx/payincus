# FX-072 规格：资源池申领无主机容量上限校验致 OOM 超卖(P1 / D-059 / M06-01)

## 根因
`server/src/db/resource-pool.ts:225` + `server/src/routes/resource-pool.ts:184`:资源池申领对主机用量**无条件 increment**,全程**无"是否超主机配额上限"校验**(与 `reserveResources` 严重不对称),`amount` 无上限 → 用户把签到/抽奖/兑换攒的池资源灌进实例可**突破节点内存上限,触发同宿主其他租户 OOM/KVM 失败**。

## 修法(只改 db/resource-pool.ts + routes/resource-pool.ts + 守卫;不改 schema/package;不碰 caddy-client(并行))
1. 先只读:`reserveResources` 的原子条件更新(它如何在同事务内按主机剩余容量校验、条件 where、失败如何回滚)、资源池申领现有 increment 路径、Incus patch 应用点、amount 来源与类型(bigint)。
2. **同事务内按 reserveResources 同款条件校验剩余容量**:
   - 申领把资源灌到实例前,在**同一事务**内用与 reserveResources **一致的条件原子更新**主机用量(如 `updateMany(where: 剩余容量≥申领量)`),`count===0`(即超限)→**拒绝并回滚**已下发的 Incus patch,返回明确错误。
   - 内存/CPU/磁盘等各维度都要校验,不能只校验部分维度。
3. **amount 上限**:申领 amount 加合理上限(bigint 安全范围内,且不超过套餐/主机可能值),schema 层或路由层校验,拒绝超大/负值。
4. 与既有 reserveResources 语义对齐,避免出现"预留走校验、申领不校验"的不对称。

## 加守卫
`test:resource-pool-apply-consistency`/`test:host-resource-atomic-guards` 追加:申领超主机容量被拒并回滚 Incus patch、amount 上限、各维度都校验。不改 package.json。

## 不许动
不碰 caddy-client(并行)。不改 schema(用现有字段/路由校验)。不 commit。

## 验收
type-check 通过;`test:resource-pool-apply-consistency`、`test:host-resource-atomic-guards` 通过。交付一段话:条件校验如何与 reserveResources 对齐、回滚 Incus patch、amount 上限、守卫结果。
