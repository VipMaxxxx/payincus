# M05 审计报告

## 结论摘要
M05 实例生命周期整体防御较为扎实:创建走带行锁的 Serializable 事务、任务队列有 advisory lock + 条件 updateMany 竞态防护、创建失败与超时有补偿链,与守卫测试基本一致。但仍发现 2 个 P1:实例所有者可通过 `sync-status` 接口把 `suspended` 状态"洗"回 `stopped` 绕过封停(含到期封停);恢复任务在"已删原实例、未完成重命名"窗口内失败会把临时实例也删掉,造成实例数据全灭。另有多处资源分配/退款结算的竞态与补偿缺口(P2)。

## 发现清单

- [M05-01] P1 | 置信度 高 | server/src/routes/instances.ts:3251-3334、server/src/db/instances.ts:347-381
  - 问题:实例所有者可调用 `POST /:id/sync-status` 将 suspended 实例状态覆写为 stopped,绕过封停(含到期封停),随后即可 start/操作实例。
  - 证据:路由权限允许 isInstanceOwner;同步时 `if (currentStatus !== incusStatus) await db.updateInstanceStatus(...)`;封停实例在 Incus 侧是 Stopped 必然"不一致";updateInstanceStatus 仅保护 status:{not:'deleted'},不保护 suspended。定时同步器特意只取 running/stopped,该路由漏了同一防线。
  - 影响:封停(欠费到期、滥用封禁)可被实例所有者自助解除,状态机漂移,与到期封停风控/计费冲突。
  - 修复建议:sync-status 写库前排除 suspended 状态(或对 suspended 实例跳过覆写)。

- [M05-02] P1 | 置信度 中 | server/src/workers/restoreTaskWorker.ts:332-347、412-437
  - 问题:恢复流程顺序为「删原实例→重命名临时实例为原名→启动」。若删除成功后、重命名前(或 rename 本身)抛错,catch 分支无条件删除 tempInstanceName,此时原实例已删、临时实例是恢复出的唯一副本,一并删除导致实例数据彻底丢失。
  - 证据:删原实例无 try/catch;catch 中 `if (tempExists) await deleteInstance(client, task.tempInstanceName)` 对"原实例已删"不做区分——对比 backups.ts:1036-1051 rollback 先判断 originalExists 再决定是否保留临时实例。
  - 影响:恢复任务在关键窗口失败=实例灭失且无残留可人工恢复。
  - 修复建议:失败清理临时实例前先确认原实例仍存在;原实例已删则保留临时实例并标记人工介入。

- [M05-03] P2 | 置信度 中 | server/src/routes/instances.ts:2108-2132、6943-6950
  - 问题:public_ipv4 独立预留在主事务提交后单独进行;async 创建失败时 IPv4 释放依赖 provisioning failure 与 create-timeout 两处独立路径,nat_ipv4 内网 IP 分配后仅写 configPayload、不落 IpAddress 表,失败无显式释放,逻辑分散易漏。
  - 影响:边界失败下独立 IPv4 可能残留占用(端口/IP 池泄漏),需人工核对。
  - 修复建议:将独立 IPv4 释放收敛到统一补偿函数,provisioning 失败与超时清理共用。

- [M05-04] P2 | 置信度 中 | server/src/routes/instances.ts:4462-4521
  - 问题:端口映射添加中 DB createPortMapping 先于 Incus addDevice,自动分配路径与 createPortMapping 之间无第二次占用校验,依赖唯一约束兜底(P2002);有 per-instance 分布式锁,风险可控。
  - 影响:极端并发下短暂 DB 记录与 Incus 设备不一致,有回滚与唯一约束,危害有限。
  - 修复建议:自动分配路径在 createPortMapping 前统一补一次 checkPortInUse。

- [M05-05] P2 | 置信度 中 | server/src/routes/instances.ts:2222-2227、2253-2293
  - 问题:事务成功后到 createInstanceAsync 之间的同步步骤(IP 分配、存储池)若抛错(如 STORAGE_POOL_UNAVAILABLE),此路径没有回滚/退款/置 error 的补偿,异常直接冒泡,实例停在 creating,只能等 10 分钟超时清理兜底。
  - 影响:付费实例在存储池缺失等场景下扣费成功但长时间挂 creating,退款延迟到超时(最长约 10 分钟)。
  - 修复建议:将 IP/存储池准备阶段异常纳入与 createInstanceAsync 失败一致的即时补偿。

- [M05-06] P2 | 置信度 中 | server/src/routes/instance-destroy.ts:655-673
  - 问题:销毁流程 deleteIncusInstanceForUserDestroy 成功后才 settleUserDestroyBilling;若 Incus 删除成功但结算抛错,catch 只返回失败,不回滚 deleted 状态、不重试退款——实例已删、DB 标记 deleted,但用户未收到退款且无补偿记录。
  - 影响:销毁付费实例时结算阶段异常→用户丢退款,需人工对账。
  - 修复建议:结算失败落入待补偿队列/告警,或将删除与结算纳入同一可重放补偿单元。

- [M05-07] P2 | 置信度 中 | server/src/routes/instances.ts:5301-5308
  - 问题:PATCH /:id/config 更新宿主机资源用量用"读旧值+delta 覆写"(host.cpu_used+cpuDelta),而非删除/销毁路径的"从实例聚合重算";host 是请求早期快照,并发操作基于陈旧 cpu_used 覆写,导致宿主机资源计数漂移。此路径无 advisory lock。
  - 影响:高并发下宿主机 cpu/memory/disk 用量与实际实例总和偏离,影响调度容量判断(超卖或误判满载)。
  - 修复建议:config 变更后同样用 calculateHostResourcesFromInstances 重算,或纳入行锁事务做增量。

- [M05-08] P3 | 置信度 高 | server/src/routes/instances.ts:6001-6004
  - 问题:boost-processes 先写 DB 再应用 Incus,Incus 失败仅 console.error 且"不抛出错误",造成 DB=目标值但 Incus 未生效的漂移,用户看到成功但进程数未提升。
  - 修复建议:Incus 应用失败时回滚 DB 配置或明确返回部分失败。

- [M05-09] P3 | 置信度 中 | server/src/routes/instances.ts:2081-2103
  - 问题:nat_ipv4 内网 IP 分配失败(50 次用尽)时仅 console.error 并静默降级"使用动态 IP",但后续 cloud-init 依赖静态 staticIPv4 注入网络配置,null 时依赖 DHCP,与"固定内网 IP+端口映射"模型不一致;地址池仅约 766 个。
  - 影响:单宿主机实例数接近 766 时新建实例静默拿不到静态 IP,端口映射/反代假设失效。
  - 修复建议:分配失败应视网络模式返回明确错误而非静默降级,或扩大地址池。

补充(未列为独立发现,与守卫一致的良性设计):任务取消竞态、超时清理、删除顺序(claim→删 Incus→失败 restore)、创建失败补偿幂等、change_host/recreate/clone 失败清理与资源回滚,均与对应守卫测试一致。
