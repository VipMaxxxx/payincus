# FX-040 规格：交付前置失败仅靠~10min兜底退款 + IPv4释放分散(F-A BF-5-01 / D-127 / D-125)

## 根因
`server/src/routes/instances.ts:2108`(D-125)独立 IPv4 预留失败的释放逻辑**分散多处易漏**;`:2222`(D-127)createInstanceAsync 事务**之后**的同步准备步骤(IP/存储池准备等)抛错时**无即时补偿**,实例挂在 `creating`,只能靠 ~10min 兜底 sweep 才退款/回收 → 用户扣了钱长时间拿不到机器也拿不回钱。

## 前置事实
FX-B504 已让"静态IP失败"复用 createInstanceAsync 的失败补偿路径(`compensateFailedInstancePurchase` + 资源回滚 + 独立IPv4释放)。本修**复用同一补偿路径**,把范围扩到"事务后同步准备步骤抛错"与"IPv4 预留释放统一"。

## 修法(只改 routes/instances.ts 创建路径 + 守卫;不碰 traffic.ts(并行)、不碰 instance-destroy.ts(留给 FX-049)、不改 schema/package)
1. 先只读:createInstanceAsync 事务边界、事务后同步准备步骤(2108~2222 区间)、现有 `compensateFailedInstancePurchase`/独立IPv4释放/资源回滚工具、FX-B504 已建立的补偿调用点。
2. **D-125 统一 IPv4 释放**:把分散的"独立 IPv4 预留释放"收敛到一个统一补偿 helper(或复用 FX-B504 用的释放函数),所有失败分支都走它,消除遗漏。
3. **D-127 事务后同步失败即时补偿**:createInstanceAsync 事务之后的同步准备步骤用 try/catch 包裹,任何抛错→立即执行失败补偿(置 error + 资源回滚 + 独立IPv4释放 + `compensateFailedInstancePurchase` 退款),不再把实例留在 creating 等 sweep;补偿要**幂等**(与既有 sweep/FX-B504 协同,已补偿则不重复退款/双减)。
4. 保持成功路径与既有 sweep 兜底不回归(sweep 作为最后防线保留)。

## 加守卫
`test:instance-create-failure-compensation` 追加:事务后同步准备步骤抛错→即时补偿(退款+回收+IPv4释放),IPv4释放收敛到统一 helper,补偿幂等。不改 package.json。

## 不许动
不碰 traffic.ts(并行)、不碰 instance-destroy.ts(D-128 留 FX-049)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:instance-create-failure-compensation`、`test:flash-sale-guards`、`test:instance-route-id-guards`、`test:port-mapping-safety`、`test:instance-operation-conflict-guards` 全通过(确认不回退前序 instances.ts 修)。交付一段话:统一 helper、事务后 try/catch 即时补偿点、幂等如何保证、守卫结果。
