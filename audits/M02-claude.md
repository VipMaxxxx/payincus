# M02 审计报告

## 结论摘要
M02 用户与权限模块的鉴权面（authenticateAdmin/authenticateUser、self-or-admin 校验、演示账号保护、路由 ID 严格解析）整体扎实，未发现越权/水平越权/演示逃逸类可利用漏洞。最突出的问题在"删用户"高危路径：硬删除既会静默级联抹掉资金/审计流水，又会因 RESTRICT 外键（如邀请码）抛出未处理 500；其余为管理端用户列表的 N+1 性能、邮箱无唯一约束的 TOCTOU、以及若干后端/前端 i18n 硬编码。

## 发现清单

- [M02-01] P1 | 置信度 高 | server/src/routes/users.ts:1124-1179（配合 server/src/db/users.ts:697-701、prisma/schema.prisma）
  - 问题：删除用户走 `prisma.user.delete` 硬删除，且"阻断器"只统计 instances/hosts/packages/hostingZones 四类；对资金/审计类关系既不检查也不清理，`db.deleteUser` 无 try/catch、路由无错误处理。
  - 证据：阻断器 `getUserDeletionBlockers`(users.ts:44-60) 仅 4 类；`db.deleteUser` = `prisma.user.delete({ where: { id } })`(users.ts:697-701)。Schema 中大量 User 关系为 `onDelete: Cascade`——`BalanceLog`(schema:3882)、`RechargeRecord`(4077)、`HostingBalanceLog`(4979)、`LoginRecord`、`RedeemCodeUsage` 等，删除成功即被静默清除；同时另一批为 RESTRICT——`invite_codes.created_by`（迁移 20251206045256:475 `ON DELETE RESTRICT`）、`ExchangeOrder` buyer/seller(schema:2278-2279)、`OrderOperationCreator`/`RechargeRefundRequester` 等，只要目标用户产生过对应记录（例如生成过一枚邀请码），`user.delete` 就抛外键约束错误变成未捕获 500。余额/托管余额本身也未纳入阻断校验。
  - 影响：管理员删号时，要么不可逆地销毁资金流水与登录审计（合规/取证风险，且未做余额对账），要么删除动作对真实用户几乎必然以 500 失败且信息误导。
  - 修复建议：改为软删除或在事务内显式清理/迁移各关联，删除前校验零余额并补齐阻断项，同时捕获外键错误返回明确业务码。

- [M02-02] P2 | 置信度 高 | server/src/routes/users.ts:171-209（配合 server/src/db/instances.ts:12-）
  - 问题：管理端用户列表对当前页每个用户逐个发起 2FA、实例、GitHub 绑定、余额查询，构成 N+1；其中实例数量用 `getInstancesByUserId` 拉取整行再取 `.length`，属过度取数。
  - 证据：`userIds.map(async id => db.is2FAEnabled(id))`(173)、`db.getInstancesByUserId(id)` 后 `instances.length`(182-188)、`db.hasOAuthBinding`(191)、`db.getUserBalance`(203-209) 均按用户循环；`getInstancesByUserId`(instances.ts:12-) 是 `findMany({ include: { host } })`。pageSize 上限 100，单页可产生数百次查询与整表实例 JOIN。
  - 影响：用户量大时列表接口显著变慢、DB 压力大。
  - 修复建议：用 `groupBy`/`count` 批量聚合替换逐用户循环，实例数量改为按 userId 计数而非取整行。

- [M02-03] P2 | 置信度 中 | server/src/routes/users.ts:107-138（配合 prisma/schema.prisma:702、server/src/db/users.ts:146-）
  - 问题：邮箱在 DB 层无唯一约束，唯一性仅靠应用层"先查后写"的尽力校验，存在 TOCTOU；`findUserByEmail` 用 `findFirst` 取首条，重复邮箱下结果不确定。
  - 证据：schema `email String?`（无 `@unique`），迁移建表 `"email" TEXT`（无 UNIQUE 索引）；`validateEmailChangeTarget` 先 `db.findUserByEmail` 判重(132-135) 再由调用方 `db.updateUser` 写入，两步之间无锁；并发两个改邮箱请求可同时通过判重。
  - 影响：可产生同邮箱多账号，破坏任何以邮箱为身份依据的流程（找回/验证）的唯一性假设。
  - 修复建议：为 email 增加（大小写不敏感）唯一约束并依赖 DB 约束捕获冲突。

- [M02-04] P3 | 置信度 高 | server/src/routes/users.ts:953,986,991,996,1012,1016,1240,1783
  - 问题：后端多处直接返回中文用户可见文案，与本模块其余英文文案/错误码体系不一致。
  - 证据：配额自增分支 `'每次只能增加一种配额类型'`(953)、`'${typeNames}每次只能增加 ${expectedIncrease} 个'`(986)、`'当前使用率...才能增加配额'`(996)、`'配额增加成功'`(1016)；`'已撤销 ${count} 个会话'`(1240)；托管余额 `'托管余额正在处理，请稍后重试'`(1783)。
  - 影响：多语言前端下文案不可控、无法本地化，契约不统一。
  - 修复建议：统一改用 ErrorCode + 前端 i18n key，移除后端硬编码文案。

- [M02-05] P3 | 置信度 高 | client/src/views/admin/UserLifecycleView.vue（全文件，0 处 $t；示例 113,164,178,193,216）
  - 问题：用户生命周期管理视图完全未接入 i18n，模板与 toast 均为硬编码中文。
  - 证据：全文件 `$t(` 出现 0 次，模板含约 51 处中文文本；toast 硬编码如 `toast.success('分群已刷新')`(113)、`'标签已添加'`(164)、`'请填写有效的节点 ID、数值和有效期'`(193)、`'请选择用户并勾选确认'`(216)。
  - 影响：与仓库 i18n key 守卫体系及 en/zh-TW 语言包不一致，无法本地化。
  - 修复建议：将该视图文案抽取为 i18n key 并补齐各语言包。

- [M02-06] P3 | 置信度 中 | server/src/db/user-lifecycle.ts:443-472
  - 问题：`listLifecycleusers` 先 `take: 1000` 再在内存里按指标过滤并分页，超过 1000 的匹配用户被静默截断，分页在过滤后计算，结果不完整。
  - 证据：`prisma.user.findMany({ ..., take: 1000 })`(455)，随后 `filtered = candidates.filter(...)`(459-469) 与 `filtered.slice((page-1)*pageSize, ...)`(472)。
  - 影响：用户规模增长后生命周期用户列表/分群检索会漏用户、分页失真。
  - 修复建议：将金额/实例/活跃等过滤条件下推到查询层并用 DB 分页，避免内存截断。
