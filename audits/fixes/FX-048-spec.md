# FX-048 规格：恢复流程删原实例→重命名前抛错即删唯一临时副本致数据全灭(P1-数据安全 / D-058 / M05-02)

## 根因
`server/src/workers/restoreTaskWorker.ts:332,412`:恢复流程"删原实例 → 重命名临时副本 → 启动";若在**删原实例之后、重命名之前**抛错,catch 分支**无条件删除临时实例** —— 而此刻临时实例是**唯一副本** → 实例数据彻底丢失且无残留可人工恢复。

## 修法(只改 server/src/workers/restoreTaskWorker.ts + 守卫;不改 schema/package;不碰 caddy-client(并行))
1. 先只读:恢复流程各步骤(删原→重命名临时→启动)、catch 清理临时实例的逻辑、如何判断"原实例是否仍存在"(查 Incus/DB)、是否有"人工介入/失败标记"机制。
2. **清理临时实例前先确认原实例仍存在**:
   - catch 分支删除临时实例**之前**,先检查原实例是否仍存在(Incus 层实际存在性,不能只看 DB 状态):
     - 原实例**仍在** → 说明还没走到"删原"步骤,删临时副本是安全的(回滚重试),可保留现有清理。
     - 原实例**已删**(临时副本是唯一数据) → **绝不删临时实例**;改为**保留临时实例 + 标记人工介入**(任务置需人工处理/告警),让 owner 能手工把临时副本恢复成正式实例。
3. 不改恢复流程的正常成功路径。要幂等/可重入安全(重复恢复不误删)。

## 加守卫
`test:instance-recreate-consistency`/`test:backup-task-race-guards` 追加:删原后失败不删唯一临时副本、原实例已删则保留临时+标记人工介入。不改 package.json。

## 不许动
不碰 caddy-client(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:instance-recreate-consistency`、`test:backup-task-race-guards` 通过。交付一段话:如何判定原实例存在性、保留临时+人工介入怎么标记、守卫结果。
