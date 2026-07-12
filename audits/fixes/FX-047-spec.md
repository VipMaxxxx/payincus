# FX-047 规格：sync-status 可把 suspended 洗回 stopped 绕过封停(P1 / D-005 / M05-01)

## 根因
`server/src/routes/instances.ts:3251`(`POST /:id/sync-status`)+ `server/src/db/instances.ts:347` 写库路径:实例所有者可调 sync-status 把 `suspended` 覆写为 `stopped`,**绕过封停(含欠费/滥用/到期封停)** → 自助解封、状态机漂移、与到期风控/计费冲突。

## 修法(只改 routes/instances.ts 的 sync-status 段 + db/instances.ts 的状态写入段 + 守卫;不碰 traffic.ts(并行)、不改 schema/package)
1. 先只读:sync-status 处理器、db 写状态函数、suspended 语义(哪些是封停态:suspended,可能还有到期/风控封停)、状态机允许的转移。
2. **对 suspended(及同类封停态)跳过 agent 上报的状态覆写**:
   - sync-status 写库前:若当前 DB 状态为 `suspended`(封停),**不允许**被 agent 上报的 running/stopped 覆写(跳过状态字段更新,其余只读遥测可正常记录);
   - 在 db 写入函数(`db/instances.ts`)层也加**防御性排除**(where 条件排除 suspended,或写入前判定),做到路由 + DB 双层防护,不依赖单点。
3. 不影响正常 running↔stopped 同步、不影响管理员显式解封路径(解封是另一条受控入口,不走 sync-status)。

## 加守卫
在 `test:instance-operation-conflict-guards` 或实例状态守卫追加:sync-status 不能把 suspended 覆写为 stopped/running(路由 + db 双层断言)。不改 package.json。

## 不许动
不碰 traffic.ts(并行 FX-D017)。不改封停/解封业务入口。不改 schema/package。不 commit。

## 验收
pnpm --filter server type-check 通过;`test:instance-operation-conflict-guards` 通过。交付一段话:在哪两层排除 suspended、正常同步不回归、守卫结果。
