# FX-046 完整实现:普通付费开通幂等(加 schema)

## 授权变更
owner 指令"全部做了" → **允许加 schema + 建迁移(只落本地 dev 库,不碰生产、不 commit)**。

## 目标
普通付费开通超时重试/双击 → 各扣款各建一台。加 idempotencyKey 幂等去重。

## 修法(可改 schema.prisma + 建 migration + db + routes/instances.ts + 客户端稳定键 + 守卫)
1. **schema**:新增 `Instance.idempotencyKey String? @unique @map("idempotency_key")`(或专用 `ProvisioningIdempotency` 表:key @unique, userId, resultInstanceId, createdAt——二选一,优先 Instance 上加 nullable unique 简单)。`prisma migrate dev --name add_instance_idempotency_key`(本地);generate client。
2. **后端门控**:普通付费路径整条"扣款+建实例"用 idempotencyKey 经 `@unique` 原子门控:
   - 先按 key 抢占(insert 或 upsert 命中唯一冲突);仅新建时扣款+交付;
   - 同 key 冲突 → 不再扣款/不再建,返回既有实例(200/409+既有 id)。
   - 扣款在抢占成功之后、同一逻辑单元(可回滚)。
3. **客户端稳定键**:开通前端每次"创建意图"生成一个稳定 key(如 uuid,同一意图内重试/双击复用),随请求发送。秒杀路径保持既有 FlashSaleReservation.idempotencyKey 不动。
4. 无 key 的入参(管理端等)不强制。

## 加守卫
`test:instance-create-turnstile-guards`/`test:instance-task-cancel-race-guard` 追加:同 key 不双扣不双建、扣款在抢占后。

## 不许动
不 commit/push/发版。不碰生产库(迁移只本地)。不回退前序 instances.ts 修。

## 验收
type-check 通过;`test:instance-create-turnstile-guards`、`test:instance-task-cancel-race-guard`、`test:instance-route-id-guards`、`test:instance-create-failure-compensation`、`test:instance-quota-zero-guards` 通过;迁移文件已建、prisma generate 成功。交付:schema 怎么加、门控点、客户端键、迁移文件名、守卫结果。
