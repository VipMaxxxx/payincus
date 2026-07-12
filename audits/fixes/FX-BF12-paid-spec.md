# BF-12-01/02 规格：插件/主题付费无交易闭环,禁止上架 paid 条目(G-E 同意)

## 裁决
本期插件与主题**一律按免费处理、禁止上架 paid 条目**,直到交易/授权/退款/分成/结算闭环上线。

## 现状
标 paid 的插件/主题与免费走**完全相同直装路径**,不扣款/不授权/不分账;主题无定价字段;无购买/授权/分账/结算表。证据:admin-plugins.ts:707-730、plugin-market-publisher.ts、theme-market-publisher.ts、schema.prisma:2771/2594。

## 修法(只改 插件/主题市场的上架/发布/审核校验代码 + 守卫;不改 schema/package;不碰 flash-sales/tickets(并行))
1. 先只读:插件/主题提交→审核→listed→发布索引 的流程;pricing/paid 字段现状;admin-plugins.ts:707-730 的上架点;plugin-market-publisher / theme-market-publisher。
2. **禁止 paid 上架(门禁,不改 schema)**:
   - 审核/置 listed / 发布公开索引时,**拒绝任何 pricing='paid'(或非 free)的条目**,返回明确错误"付费上架暂未开放(交易闭环未上线)";或强制以 free 处理(按 owner"一律按免费处理"——二者取其一,优先**拒绝上架 paid**更安全,并在错误里说明)。
   - 公开市场索引**只纳入 free 且 passed/warning** 的条目;paid 条目不进公开索引。
   - 保留 pricing 字段(数据模型不动),仅在上架门禁拦截。
3. 与既有插件市场守卫(governance/publish/submission)协同,不弱化。

## 加守卫
`test:plugin-market-governance-guards`/`test:plugin-market-publish-guards` 追加:paid 条目禁上架/不进公开索引。不改 package.json。

## 不许动
不碰 flash-sales/tickets(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:plugin-market-governance-guards`、`test:plugin-market-publish-guards`、`test:plugin-market-guards`、`test:plugin-center-guards`、`test:theme-system-guards` 通过。交付一段话:在哪个门禁拦截 paid、公开索引如何排除、守卫结果。
