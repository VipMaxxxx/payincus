# M15 审计报告
## 结论摘要
邀请码扣费使用事务、余额锁和条件更新，未发现有充分证据的重复扣费或重复返利路径。但 AFF 禁用状态未在实例优惠码验证中生效，好友关系状态机也存在并发重复关系及重新申请方向错乱问题，可能影响实际折扣、返利和好友关系完整性。

## 发现清单
- [M15-01] P2 | 置信度 高 | server/src/db/aff.ts:443
  - 问题:实例优惠码验证未检查 `enabled`，已禁用的优惠码仍可继续用于新购。
  - 证据:`validateAffCode()` 查询优惠码后只检查方案和自用：`if (affCode.packagePlanId !== null...)`、`if (affCode.userId === userId)`，随后直接返回 `valid: true`；同文件邮箱验证在 1101-1104 行明确包含 `if (!affCode.enabled) ...`。
  - 影响:本应撤销的优惠码仍能产生用户折扣、推荐人返利及永久实例绑定，造成计费策略失效。
  - 修复建议:在所有 AFF 验证入口统一校验启用状态，并确保绑定时再次验证。

- [M15-02] P2 | 置信度 高 | server/src/db/friendships.ts:59；server/prisma/schema.prisma:1004
  - 问题:双向同时发送好友请求存在竞态，可创建两条方向相反的关系记录。
  - 证据:逻辑先执行 `findFirst` 检查任一方向，随后在无事务或锁保护下执行 `prisma.friendship.create(...)`；数据库仅有方向敏感的 `@@unique([userId, friendId])`，不能阻止同时出现 `(A,B)` 和 `(B,A)`。
  - 影响:并发请求可能产生两条待处理或已接受关系，好友列表重复、删除一条后另一条仍然有效，关系状态可互相矛盾。
  - 修复建议:以规范化用户对建立数据库唯一约束，并在单事务内原子创建或接受关系。

- [M15-03] P2 | 置信度 高 | server/src/db/friendships.ts:81
  - 问题:被拒绝或删除后的重新申请状态机不完整，可能颠倒申请方向或直接返回数据库错误。
  - 证据:对 `rejected` 记录只更新 `status`、`remark`、`rejectedAt`，没有按本次申请者重设 `userId/friendId`；`removed` 状态没有处理，最终仍执行 `create`。
  - 影响:原接收者反向重新申请时，系统仍把原发起者记为申请人；原发起者删除后再次申请则可能触发同向唯一约束并返回 500。
  - 修复建议:重新申请时显式重建申请方向，并为 `removed` 状态定义一致的复用或重建规则。

- [M15-04] P2 | 置信度 高 | server/src/routes/friends.ts:51；server/src/lib/errors.ts:700
  - 问题:好友接口将捕获到的内部异常原文返回客户端。
  - 证据:多个异常分支调用 `apiError(ErrorCode.INTERNAL_ERROR, message)`；`apiError()` 会把第二个参数直接放入响应的 `details` 字段。
  - 影响:Prisma、数据库约束、字段名或内部状态等错误细节可能泄露给普通用户，同时用户会看到不可理解的底层报错。
  - 修复建议:响应只返回固定错误码和通用文案，完整异常仅写入服务端脱敏日志。

- [M15-05] P3 | 置信度 高 | client/src/views/FriendsView.vue:1056
  - 问题:好友历史中的 `removed` 状态被错误显示为“已拒绝”。
  - 证据:模板使用 `record.status === 'accepted' ? statusAccepted : statusRejected`，日期同样只在 `acceptedAt` 与 `rejectedAt` 之间选择，而接口类型明确包含 `removed`。
  - 影响:用户删除好友后，历史记录会谎报为拒绝申请，并可能显示空的处理日期。
  - 修复建议:为 `removed` 增加独立文案和对应时间展示规则。

- [M15-06] P3 | 置信度 高 | server/src/db/friendships.ts:266
  - 问题:好友列表资源统计存在明显 N+1 查询。
  - 证据:先取得全部好友，再执行 `friendIds.map(friendId => prisma.instance.count(...))`，每个好友单独发起一次计数查询。
  - 影响:好友数量增加时，单次列表请求会产生 `1+N` 次数据库查询，增加连接占用和响应延迟。
  - 修复建议:使用一次分组聚合查询批量取得所有好友的实例数量。

- [M15-07] P3 | 置信度 高 | server/src/routes/user-invites.ts:55
  - 问题:邀请码列表分页解析并不严格，相关守卫声称的安全整数约束实际未实现。
  - 证据:`parsePositiveInteger()` 使用 `parseInt(value || '', 10)` 且只检查 `Number.isInteger(parsed)`；例如 `2junk` 会被解析为 `2`，超出安全整数范围的值也可能通过。
  - 影响:畸形分页参数不会被拒绝，极大页码还可能产生不安全的 `skip` 值并导致数据库查询异常。
  - 修复建议:使用完整数字正则、`Number()` 和 `Number.isSafeInteger()` 严格解析并限制最大页码。

- [M15-08] P3 | 置信度 高 | client/src/views/InvitesView.vue:87
  - 问题:邀请码页面大量用户可见文案未接入 i18n。
  - 证据:页面直接硬编码 `邀请码已生成`、`生成邀请码失败`、`已使用`、`已过期`、`未使用`、`复制失败`、`邀请码管理` 等文案，且未使用 `useI18n()`。
  - 影响:切换非中文语言时该页面仍显示中文，错误提示和页面主体语言不一致。
  - 修复建议:将页面文案统一迁移到现有 i18n key，并补齐各语言资源。
