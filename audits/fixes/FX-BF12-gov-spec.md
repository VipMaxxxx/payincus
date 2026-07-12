# 插件治理批:BF-12-03 发布以DB当前有效状态 + BF-12-04 每ID最高SemVer + BF-12-05 listed仅passed/warning(G-E 全同意)

## 三条裁决
- **BF-12-03**:每次发布**以 DB 当前有效状态为准**,已下架/拒绝且无其他有效版本的 ID **从公开索引删除**(现发布器读旧 index 覆盖,delisted/rejected 不真下架)。证据:plugin-market-publisher.ts:126、theme-market-publisher.ts:99。
- **BF-12-04**:每个 ID 只发布**最高 SemVer 且审核有效**的一个版本(现字符串排序循环覆盖,latest 可能回退旧版;字符串排序非 SemVer)。证据:plugin-market-publisher.ts:141-155。
- **BF-12-05**:`listed` **只能在最近扫描为 passed/warning 时设置**(现任何扫描状态含 failed/high/critical 都可置 listed,发布器只收 passed/warning→"审核成功但市场无条目")。证据:plugin-market-submissions.ts:849-858、plugin-market-publisher.ts:142。

## 修法(只改 plugin-market-publisher.ts + theme-market-publisher.ts + plugin-market-submissions.ts + 守卫;不改 schema/package;不碰 hosting(并行);建立在 BF-12-01/02 已合并改动上勿回退)
1. **BF-12-03**:发布器**不再读旧 index 覆盖式合并**;改为**完全从 DB 当前有效条目重建公开索引**(只含 free+passed/warning+listed 的有效版本);DB 中 delisted/rejected 且无其他有效版本的 ID **不出现在新索引**(即真下架)。主题发布器同。
2. **BF-12-04**:同 ID 多版本时用 **SemVer 比较**(复用已有 semver 库或实现可靠比较,10.0.0>2.0.0)选**最高 SemVer 且审核有效(listed+scan passed/warning)** 的**唯一**版本发布,不循环覆盖回退。
3. **BF-12-05**:审核接口置 `listed` 时**校验最近扫描∈{passed,warning}**,否则拒绝(failed/high/critical 不可 listed),消除"审核成功但市场无条目"。
4. 与 BF-12-01/02(禁 paid)协同:索引只含 free+passed/warning+listed+最高SemVer。

## 加守卫
`test:plugin-market-publish-guards`/`test:plugin-market-submission-guards`/`test:plugin-market-governance-guards` 追加:索引从DB重建+真下架、每ID最高SemVer唯一、listed 仅 passed/warning。不改 package.json。

## 不许动
不碰 hosting(并行)。不回退 BF-12-01/02。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:plugin-market-publish-guards`、`test:plugin-market-submission-guards`、`test:plugin-market-governance-guards`、`test:plugin-market-guards`、`test:theme-system-guards` 通过。交付一段话:索引重建/真下架、SemVer 选版、listed 门禁、守卫结果。
