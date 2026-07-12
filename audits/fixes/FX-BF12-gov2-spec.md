# 插件治理批2:BF-12-06 高风险 capability 上架前审 + BF-12-08 verified 只管理员认证(G-E 全同意)

## 两条裁决
- **BF-12-06**:高风险 capability **在公共上架前完成审核**(现安装后才审、只阻止启用)。证据:db/plugins.ts:672、474。
- **BF-12-08**:verified/已认证**只能由管理员明确认证**(现填非空 GitHub HTTPS URL 即自动 verified=true/trustLevel=verified)。证据:plugin-market-publisher.ts:102。

## 修法(只改 db/plugins.ts + plugin-market-publisher.ts + 必要 routes/plugin-market-submissions + 守卫;不改 schema/package;不碰 tickets(并行))
1. **BF-12-06**:高风险 capability 审核**前移到上架(listed/发布)前置**——置 listed/发布公开索引前,若含高风险 capability 且未通过审核则**拒绝上架**(不再等安装后);保留安装/启用时的既有校验作纵深。
2. **BF-12-08**:**移除**"填 GitHub URL 即自动 verified"逻辑;`verified/trustLevel=verified` **只能由管理员显式认证接口设置**;开发者提交默认 unverified,GitHub URL 仅作展示不授予认证。
3. 与 BF-12-01/02/03/04/05 协同,勿回退。

## 加守卫
`test:plugin-market-governance-guards`/`test:plugin-market-publish-guards` 追加:高风险 capability 上架前审、verified 仅管理员。不改 package.json。

## 不许动
不碰 tickets(并行)。不回退 BF-12-01~05。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:plugin-market-governance-guards`、`test:plugin-market-publish-guards`、`test:plugin-market-guards`、`test:plugin-center-guards` 通过。交付一段话:capability 前移点、verified 认证收敛、守卫结果。
