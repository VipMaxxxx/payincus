# FX-074 规格：宿主机用量绝对覆盖并发丢失更新(P1 / D-051 / M24-04)

## 根因
`server/src/routes/batch-config.ts:304` + `server/src/db/hosts.ts:485`:宿主机资源用量基于**请求开始时读到的旧值绝对覆盖**(`host.cpu_used + delta` 然后整体 set),并发批量互相**丢失更新** → 两并发批量互相覆盖,容量台账少算/多算 → 错误放行实例或触发错误告警。

## 修法(只改 db/hosts.ts + routes/batch-config.ts + 守卫;不改 schema/package;不碰 restoreTaskWorker(并行))
1. 先只读:hosts.ts:485 用量写入(是否 `update{ set: old+delta }`)、batch-config 调用点、是否已有宿主行锁/事务、其它地方是否用 `increment`(参照 reserveResources/FX-072 的原子模式)。
2. **改为事务内原子更新**:
   - 用 Prisma **原子 `increment`/`decrement`**(`data: { cpuUsed: { increment: delta } }`)替代"读旧值→加 delta→set",消除读改写竞态;各维度(cpu/mem/disk)都用 increment。
   - 或若必须先重算(如按实例集合重算),则在**同一事务内对宿主加锁**(`SELECT ... FOR UPDATE`/advisory lock)后重算并提交,保证并发串行化。
   - 与 FX-072/reserveResources 的容量校验语义**不冲突**:若该写入点也需容量上限校验则复用同款条件;本修至少消除"绝对覆盖丢失更新"。
3. 保持批量配置正常路径不回归。

## 加守卫
`test:host-resource-atomic-guards`/`test:batch-config-route-guards` 追加:宿主用量用原子 increment(或加锁重算),不得绝对覆盖 old+delta。不改 package.json。

## 不许动
不碰 restoreTaskWorker(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:host-resource-atomic-guards`、`test:batch-config-route-guards` 通过。交付一段话:改成 increment 还是加锁重算、各维度覆盖、守卫结果。
