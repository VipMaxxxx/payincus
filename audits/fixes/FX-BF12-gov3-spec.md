# 插件治理批3:BF-12-09 货币规范 + BF-12-10 兼容性唯一真源 + BF-12-11 固化稳定目录(G-E 全同意)

## 三条裁决
- **BF-12-09**:商业化前统一"**最小货币单位整数 + 币种白名单 + 固定平台抽成口径**"并**拒绝不完整 paid**(现 price/currency 任意字符串、分成只[0,100]截断)。证据:plugin-market-publisher.ts:47。
- **BF-12-10**:以 **manifest 的 payincus 范围为唯一兼容真源**,上传/发布/安装全过程统一(现上传 {payincus} 但发布器只识别 minPayincus/maxPayincus,扫描不校验→丢约束)。证据:plugin-market-submissions.ts:707、plugin-market-publisher.ts:39。
- **BF-12-11**:发布必须把**审核包+manifest 固化到稳定市场目录** `/plugin-market/packages`(现只写 /api/.../uploads 地址,安装白名单只允许 packages/manifests 路径→装不上)。证据:plugin-market-submissions.ts:699、plugin-market.ts:151。

## 修法(只改 plugin-market-publisher.ts + plugin-market-submissions.ts + plugin-market.ts + 守卫;不改 schema/package;不碰 install-panel/deploy(并行 FX-008)/traffic/tickets(并行))
1. **BF-12-09 货币规范**:pricing 校验——最小货币单位**整数分**、币种**白名单**(如 CNY/USD)、平台抽成**固定口径**;**拒绝不完整 paid**(缺价/币/非法)。与 BF-12-01/02(当前禁 paid)协同:规则就位,paid 仍禁上架,待闭环放开时生效。
2. **BF-12-10 兼容性唯一真源**:全过程以 **manifest.payincus 范围**为准——上传/扫描/发布/安装统一读同一字段(归一 minPayincus/maxPayincus ← manifest.payincus);推荐上传流程不丢约束。
3. **BF-12-11 固化稳定目录**:发布时把审核包+manifest **复制/固化到稳定 `/plugin-market/packages`(+manifests)** 目录并入索引(而非 uploads 临时地址),使安装白名单可放行。
4. 与 BF-12-01~08 治理协同,勿回退。

## 加守卫
`test:plugin-market-publish-guards`/`test:plugin-market-submission-guards`/`test:plugin-market-governance-guards` 追加:货币规范拒不完整 paid、manifest 唯一兼容真源、发布固化稳定目录。不改 package.json。

## 不许动
不碰 install-panel/deploy(并行)/traffic/tickets。不回退 BF-12-01~08。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:plugin-market-publish-guards`、`test:plugin-market-submission-guards`、`test:plugin-market-governance-guards`、`test:plugin-market-guards`、`test:theme-system-guards` 通过。交付一段话:货币规范、兼容真源归一、固化目录、守卫结果。
