# FX-046 规格：普通付费开通无幂等,超时重试/双击各扣款各建一台(BF-5-08)

## 现状(已核实,无需改 schema)
- `schema.prisma:2231` 已有 `idempotencyKey String? @unique`;`instances.ts` 已收 body `idempotencyKey`(maxLength 128);秒杀路径已设(1922),有 `createInstanceTaskOrConflict`。
- 缺口:**普通付费开通路径**未用 idempotencyKey 门控整条"扣款+建实例任务";且无 key 时用 `|| nanoid()` 兜底=每次都新键→不去重。→ 客户端超时重试/双击 → 各扣款各建一台。

## 修法(只改 server/src/routes/instances.ts(+ 必要的 db/instance-tasks 读取)+ 守卫;不改 schema/package;不碰 caddy-client(并行))
1. 先只读:普通付费路径的扣款(changeBalance/余额锁)与 createInstanceTask 顺序、`createInstanceTaskOrConflict` 冲突处理、unique 约束如何触发、秒杀路径怎么用 idempotencyKey。
2. **用 idempotencyKey 原子门控整条操作**:
   - 普通付费路径:**先按 idempotencyKey 抢占创建实例任务**(依赖 `@unique` + `createInstanceTaskOrConflict`),**仅当任务为本次新建时才扣款/继续交付**;若 unique 冲突(同键已存在)→**不再扣款、不再建第二台**,返回既有任务(幂等返回,如 200/409+既有 taskId)。
   - 顺序保证:扣款必须在"任务抢占成功"之后、且与之在可回滚的同一逻辑单元内,避免"扣了款但任务抢占失败"或"抢占成功但重复扣款"。
   - 兜底键策略:普通路径**不要**用随机 nanoid() 兜底做去重键(那样等于不去重)。若客户端未传 key,可用**确定性派生键**(如 `paid:{userId}:{packageId}:{planId}:{关键规格hash}` + 短时间窗口)以拦截"无键双击";或按 owner 现状最小改动:至少保证"传了相同 key 必去重"。以拦截双击为目标,择稳妥方案实现并在交付说明。
3. 不改秒杀路径既有行为。

## 加守卫
`test:instance-create-turnstile-guards`/`test:instance-task-cancel-race-guard` 追加:普通付费路径按 idempotencyKey 去重(同键不双扣款/不双建)、扣款在任务抢占之后。不改 package.json。

## 不许动
不碰 caddy-client(并行)。不改 schema(unique 已存在)。不 commit。

## 验收
type-check 通过;`test:instance-create-turnstile-guards`、`test:instance-task-cancel-race-guard`、`test:instance-route-id-guards`、`test:instance-create-failure-compensation` 通过(确认不回退前序 instances.ts 修)。交付一段话:去重门控点、兜底键策略、扣款顺序、守卫结果。
