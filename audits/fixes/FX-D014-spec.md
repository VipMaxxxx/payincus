# FX-D014 规格：流量双通道无采样版本,迟到旧上报回退快照重复计量(P1 / D-014 / M13-01)

## 根因
Agent 上报(server/src/services/agent-instance-report.ts:230)与主动采集(server/src/services/instance-traffic-collector.ts:73)共用同一"上次计数器快照",但无采样版本/时间判断;
迟到的旧上报会把快照**回退**到更旧的计数器 → 下次增量 = 新计数器 − 被回退的旧快照,造成**重复计量** → 实例/用户月流量虚高、提前预警/限速/计费争议。

## 修法（改 agent-instance-report.ts + instance-traffic-collector.ts + 必要时 traffic-utils.ts;不碰 package.json、尽量不改 schema)
1. 先只读:快照(上次计数器/时间)存在哪(实例字段/表)、两通道如何读写快照、增量如何算(traffic-utils.ts:11-16 的 current<last→0 逻辑)。
2. **给快照加采样时间/序号并原子校验拒回退**:
   - 快照保存时带上该样本的采样时间戳(或单调序号);
   - 更新快照前**原子比较**:仅当新样本的采样时间/序号 **≥ 当前快照的** 才更新基线并累加增量;**迟到样本(更旧)直接丢弃、不回退基线、不累加**(记 debug 日志)。
   - 用带条件的 updateMany(where 快照时间 ≤ 新样本时间)做原子更新,避免并发回退。
3. 若已有采样时间字段就复用;若确实需要一个"快照采样时间"列且无迁移则用现有 updatedAt/lastReportAt 之类近似,并在交付说明;不擅自加 schema 列(能用现有字段就用)。
4. 保持"统一权威采集源"精神:两通道都经此原子校验,不各写各的。

## 加守卫
在现有 server/scripts/test-traffic-collector-status-guard.ts 或 traffic 相关守卫追加断言:迟到样本不回退快照/不重复计量(采样时间/序号原子校验)。不改 package.json。

## 不许动
- 不改流量计费口径(E7 双向保持);不碰 instances.ts(并行 FX-B504)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:traffic-collector-status-guard、test:agent-report-state-guards 通过。

## 交付
一段话:采样版本/时间用了什么字段、迟到样本如何拒、守卫结果。不要 commit。
