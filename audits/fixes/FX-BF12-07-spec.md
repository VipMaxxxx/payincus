# BF-12-07 规格：补齐用户端主题投稿入口(G-E 同意)

## 裁决
补齐用户端**主题投稿入口**(现插件有投稿入口,主题缺)。

## 现状(codex 只读确认)
插件市场已有用户端投稿入口/流程,主题市场缺对等入口 → 开发者无法从用户端投稿主题。证据:参照插件投稿 PluginCenterView + plugin-market-submissions,主题侧 theme-market-submissions.ts 后端可能已有但前端无入口。

## 修法(只改 客户端主题相关视图 + 必要 routes/theme-market-submissions(若前端需)+ i18n + 守卫;不改 schema/package;不碰 instances(并行))
1. 先只读:插件用户端投稿入口如何做(PluginCenterView 投稿按钮/表单→plugin-market-submissions API);主题侧 theme-market-submissions 后端接口现状、主题用户端视图。
2. **补齐主题投稿入口**:在主题相关用户端视图加"投稿主题"入口/表单(对齐插件投稿的字段/校验/提交流程),调用主题投稿 API;补 i18n 三语。若后端主题投稿 API 缺失则复用/对齐插件投稿 API 模式补齐(不改 schema)。
3. 与 BF-12-01/02(禁 paid)/治理批协同:主题投稿默认 free、走审核。不新增锁定表格。

## 加守卫
`test:theme-system-guards`/`test:frontend-i18n-keys`/`test:frontend-route-guards` 追加:主题投稿入口存在+对齐插件流程。不改 package.json。

## 不许动
不碰 instances(并行)。不改 schema/package。不改锁定表格。不 commit。

## 验收
client type-check 通过;`test:theme-system-guards`、`test:frontend-i18n-keys`、`test:frontend-route-guards`、`test:plugin-market-submission-guards` 通过。交付一段话:入口加在哪、对齐哪个插件流程、守卫结果。
