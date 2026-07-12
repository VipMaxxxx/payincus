# FX-050 规格：boost-processes 先写 DB,Incus 失败不抛致漂移(P3高 / D-144 / M05-08)

## 根因
`routes/instances.ts:6001`:boost-processes(进程数提升)先写 DB,随后调 Incus 应用;**Incus 失败时不抛错**,DB 已改而 Incus 未生效 → DB 与实际不一致(漂移)。

## 修法(只改 routes/instances.ts 的 boost-processes 段 + 守卫;不改 schema/package;不碰 resource-risk/traffic-scheduler(并行))
1. 先只读:boost-processes 处理器、DB 写入与 Incus 调用顺序、错误处理。
2. **Incus 失败回滚 DB 或返回部分失败**:
   - 优先:先写 DB(或事务),再调 Incus;**Incus 失败 → 回滚 DB**(恢复原值)并返回明确错误,保证一致;
   - 或若无法回滚(已部分生效),则**返回部分失败**并明确告知实际状态,不静默吞错。
   - 不允许"DB 改了、Incus 没生效、还返回成功"。
3. 保持正常 boost 成功路径不回归。

## 加守卫
`test:instance-route-id-guards` 追加:boost Incus 失败回滚 DB 或返回部分失败,不静默吞错。不改 package.json。

## 不许动
不碰 resource-risk/traffic-scheduler(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:instance-route-id-guards`、`test:instance-operation-conflict-guards` 通过。交付一段话:回滚还是部分失败、如何避免静默吞错、守卫结果。
