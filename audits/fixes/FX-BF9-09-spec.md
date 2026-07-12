# BF-9-09 规格：diskLimitGb 口径含糊(每域名/每账号各得完整空间)(G-B 裁决:整订阅共享总空间)

## 裁决
`diskLimitGb` 定义为**整个订阅共享的总空间**。

## 现状
页面称"总空间",但每域名都传完整 diskLimitGb、每账号也可配到整订阅空间,**无合计校验** → 含 N 域名可配出 N×diskLimitGb。证据:cranemail.ts:97-114、mail.ts:1711-1717。

## 修法(只改 services/cranemail.ts + routes/mail.ts(域名/账号配额处 1711-1717)+ 守卫;不改 schema/package;不碰 db/tickets(并行))
1. 先只读:cranemail.ts:97-114 如何把 diskLimitGb 下发给上游(每域名?)、mail.ts:1711-1717 账号配额、订阅下域名/账号集合。
2. **整订阅共享总空间 + 合计校验**:
   - 新增/改配域名或邮箱账号磁盘配额时,**校验该订阅下所有域名/账号已分配磁盘之和 ≤ 订阅 diskLimitGb**;超出拒绝。
   - 下发上游时按"共享总空间"语义(不再每域名各传完整 diskLimitGb 造成 N 倍);具体分配口径按现有上游 API 能力,核心是**合计不超总空间**。
3. 保持邮箱其它逻辑不回归。

## 加守卫
`test:mail-account-quota-guards`/`test:mail-domain-lifecycle-guards` 追加:域名/账号磁盘合计 ≤ 订阅 diskLimitGb。不改 package.json。

## 不许动
不碰 db/tickets(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:mail-account-quota-guards`、`test:mail-domain-lifecycle-guards`、`test:mail-plan-financial-guards` 通过。交付一段话:合计校验点、上游下发口径、守卫结果。
