# FX-073 规格：资源池申领 Incus 先于 DB 崩溃漂移无对账 + 余额展示精度(P3 / D-161,D-171余项 / M06)

## 范围核实(避免重复)
- **D-073**(改配抹池加成)**已由 FX-023 修**(改配并入历史 apply)——本修**不含**。
- **D-171 的 amount 上限已由 FX-072 修**(amount ≤104857600 双层校验)——本修只补 **D-171 展示精度**(余额/大数展示用字符串透传,避免 Number 精度丢失)。
- 本修主做 **D-161**:`routes/resource-pool.ts:176` 申领**先 patch Incus 后落库**,中途崩溃 → DB 与 Incus 漂移且**无对账**。

## 修法(只改 routes/resource-pool.ts + db/resource-pool.ts + 守卫;不改 schema/package;不碰 resource-risk/traffic-scheduler(并行 FX-063))
1. 先只读:FX-072 改造后的 apply 流程(原子容量校验 + Incus patch + 落库顺序)、是否已有可重放任务/对账机制、余额/大数如何序列化给前端。
2. **D-161 轻量对账/可重放**:
   - 优先**调整顺序为"先落库(pending)→patch Incus→确认落库(applied)"**,或对"已 patch Incus 未落库"的漂移增加**轻量对账**(启动/定时校验:比对 DB 申领记录与 Incus 实际,补齐或告警);或纳入既有可重放任务框架。
   - 保证崩溃后能对账修复,不长期漂移。与 FX-072 的原子校验/回滚协同,不回退。
3. **D-171 展示精度**:申领 amount / 余额等大数返回前端时用**字符串透传**(BigInt→string),避免 Number 精度丢失;后端计算仍用 bigint。
4. 改动最小,P3。

## 加守卫
`test:resource-pool-apply-consistency`/`test:resource-quota-bigint-guards` 追加:申领有对账/可重放不长期漂移、大数展示字符串透传。不改 package.json。

## 不许动
不碰 resource-risk/traffic-scheduler(并行)。不回退 FX-072/FX-023。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:resource-pool-apply-consistency`、`test:resource-quota-bigint-guards`、`test:host-resource-atomic-guards` 通过。交付一段话:对账/顺序怎么改、字符串透传点、守卫结果。
