# FX-026 规格：删用户硬删除静默抹掉资金/审计流水,或因外键 500(P1 / D-003 / M02-01)

## 根因
删除用户走 prisma.user.delete 硬删除;删除阻断器只统计 instances/hosts/packages/hostingZones 四类。
User 大量关系 onDelete:Cascade(BalanceLog/RechargeRecord/HostingBalanceLog/LoginRecord/RedeemCodeUsage…)→ 删成功即静默抹掉资金流水与登录审计(合规/取证风险,且未做余额对账);
另一批 RESTRICT(invite_codes.created_by、ExchangeOrder buyer/seller、OrderOperationCreator、RechargeRefundRequester…)→ 只要产生过对应记录,user.delete 抛外键约束变成未捕获 500。

## 修法（bounded:不做用户软删大重构、不改 schema;改 server/src/routes/users.ts 删除路径 + server/src/db/users.ts deleteUser)
1. 先只读:删除路由(users.ts:1124-1179)、阻断器 getUserDeletionBlockers(users.ts:44-60)、db.deleteUser(users.ts:697-701)。
2. **扩展删除阻断**:删除前额外校验并阻断(返回明确 4xx + 阻断原因,不 500):
   - 用户主余额 / 托管余额 非零 → 阻断(要求先清零/结算);
   - 存在资金/审计类关键记录(BalanceLog / RechargeRecord / HostingBalanceLog 等,以"是否有记录"为阻断条件)→ 阻断,提示"该用户有资金/审计流水,不能直接删除"。
   把这些纳入 getUserDeletionBlockers 的返回,路由据此拒绝并给清晰原因。
3. **捕获外键错误**:db.deleteUser 加 try/catch,捕获 Prisma 外键约束错误(P2003/P2014 等)→ 向上返回明确业务错误(如"该用户存在关联记录,无法删除"),路由返回 4xx 而非未捕获 500。
4. **不静默级联抹财务**:通过第2条阻断"有资金/审计记录的用户不可删",从源头避免 Cascade 静默删除财务流水;不改 schema 的 Cascade(改它需迁移,风险大;阻断即规避)。
5. 结果:有资金/审计历史的用户**不能被直接硬删**(需先处理),删除动作要么成功(干净用户)要么给明确阻断原因,不再静默抹账、不再误导性 500。

## 加守卫
在现有 server/scripts/test-admin-user-delete-resource-guards.ts 追加断言:删除阻断含余额/资金审计记录校验 + db.deleteUser 捕获外键错误返回业务码。不改 package.json。

## 不许动
- 不改 schema Cascade/Restrict;不做用户软删架构改造(记为 owner 设计待办)。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:admin-user-delete-resource-guards、test:user-route-id-guards 通过。

## 交付
一段话:扩了哪些阻断、外键错误如何捕获、守卫结果、以及"用户软删架构"是否建议 owner 后续做。不要 commit。
