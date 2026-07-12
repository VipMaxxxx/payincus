# BF-12 插件 / 主题市场 · 业务行为说明书 + 疑点清单

## 一、现状行为

### 1. 开发者提交

1. 插件开发者可在用户端“扩展”页面上传 `.tar.gz`。服务端解析 manifest、计算 SHA256，生成公开的包和 manifest URL；前端自动填充投稿表单。`server/src/routes/plugin-market-submissions.ts:662` `server/src/routes/plugin-market-submissions.ts:671` `server/src/routes/plugin-market-submissions.ts:694` `client/src/views/ExtensionsView.vue:265`
2. 插件投稿要求 ID、版本、名称、四个 HTTPS URL、SHA256、开发者名称及邮箱；权限、兼容范围、定价均只要求是 JSON 对象。`server/src/routes/plugin-market-submissions.ts:220` `server/src/routes/plugin-market-submissions.ts:235` `server/src/routes/plugin-market-submissions.ts:256`
3. 插件默认表单口径为：
   - 兼容范围：`{"minPayincus":"0.6.0"}`
   - 定价：`{"type":"free"}`
   
   开发者也可直接填写任意定价 JSON。`client/src/views/ExtensionsView.vue:239` `client/src/views/ExtensionsView.vue:253` `client/src/views/ExtensionsView.vue:309`
4. 同一 `pluginId + version` 全平台只能提交一次；提交者没有后续编辑、撤回或重提该版本的接口。`server/prisma/schema.prisma:2761` `server/src/routes/plugin-market-submissions.ts:727`
5. 主题投稿后端只提供 JSON API，要求开发者自行准备 HTTPS manifest、包地址和 SHA256；没有对应的开发者包上传接口。`server/src/routes/theme-market-submissions.ts:25` `server/src/routes/theme-market-submissions.ts:139` `server/src/routes/theme-market-submissions.ts:207`
6. 用户端只实现了插件投稿；前端没有调用主题投稿创建或“我的主题投稿”接口。主题投稿目前实际面向能直接调用 API 的开发者。`client/src/views/ExtensionsView.vue:290` `client/src/api/admin.ts:2865`
7. 主题投稿模型没有定价、币种或分成字段。`server/prisma/schema.prisma:2771`

### 2. 审核与扫描

1. 插件、主题状态均为 `pending / listed / rejected / delisted`；风险等级为 `low / medium / high / critical`。`server/src/routes/plugin-market-submissions.ts:36` `server/src/routes/theme-market-submissions.ts:19`
2. 审核和扫描只能由扩展/主题管理员白名单中的管理员执行；白名单为空时退化为仅用户名等于 `admin` 的管理员。`server/src/routes/plugin-market-submissions.ts:159` `server/src/routes/theme-market-submissions.ts:63`
3. 扫描是管理员手工触发，不会在投稿或审核时自动执行。扫描结果为 `passed / warning / failed`。`server/src/routes/plugin-market-submissions.ts:881` `server/src/routes/theme-market-submissions.ts:297`
4. 审核接口可以在任何扫描状态下直接把投稿改成 `listed`，也允许把 `failed/high/critical` 的投稿标为 `listed`；接口不校验扫描完成与否。`server/src/routes/plugin-market-submissions.ts:849` `server/src/routes/plugin-market-submissions.ts:858` `server/src/routes/theme-market-submissions.ts:267`
5. `rejected`、`delisted` 不强制填写原因；一次状态修改会覆盖当前 `reviewNotes/reviewedBy/reviewedAt`，没有独立复审历史。`server/src/db/plugin-market-submissions.ts:187` `server/src/db/plugin-market-submissions.ts:194` `server/src/db/theme-market-submissions.ts:186`
6. 插件扫描校验包、manifest、SHA256和权限风险，但传入的 `compatibility`、`pricing` 没有参与扫描判断。`server/src/lib/plugin-market-submission-scan.ts:18` `server/src/lib/plugin-market-submission-scan.ts:187`
7. 主题扫描会解析兼容声明，但不把不一致判为失败：最低版本不匹配只生成 `info`，最高版本只记录一条 `info`。`server/src/lib/theme-market-submission-scan.ts:208`

### 3. 上架与市场索引

1. 审核改为 `listed` 后不会自动上架；管理员还必须手工调用“发布市场索引”。`server/src/routes/plugin-market-submissions.ts:927` `server/src/routes/theme-market-submissions.ts:339`
2. 发布器只选择同时满足以下公式的投稿：

   `可发布 = reviewStatus == listed AND scanStatus ∈ {passed, warning}`

   `pending`、`failed` 不会进入本次新投稿集合。`server/src/lib/plugin-market-publisher.ts:139` `server/src/lib/theme-market-publisher.ts:112`
3. 发布器会先读取现有 `index.json`，再把本次符合条件的投稿覆盖到内存 Map；它不是从数据库重新生成一份严格镜像。`server/src/lib/plugin-market-publisher.ts:126` `server/src/lib/plugin-market-publisher.ts:151` `server/src/lib/theme-market-publisher.ts:99`
4. 同一 ID 的投稿按版本字符串降序读取，但随后每个版本都执行 `Map.set`。最终留下的是排序结果中最后处理的版本，而不是第一条。`server/src/lib/plugin-market-publisher.ts:141` `server/src/lib/plugin-market-publisher.ts:155` `server/src/lib/theme-market-publisher.ts:114` `server/src/lib/theme-market-publisher.ts:128`
5. 新生成的第三方市场条目：
   - 有 GitHub URL即标记 `verified`
   - 评分固定 `0/0`
   - 安装量固定 `0`
   - 签名固定 `unsigned`
   
   `server/src/lib/plugin-market-publisher.ts:101` `server/src/lib/plugin-market-publisher.ts:107` `server/src/lib/plugin-market-publisher.ts:118` `server/src/lib/theme-market-publisher.ts:75`
6. 插件定价发布规则：
   - `type` 不是精确的 `paid` 就变成 `free`
   - `price`、`currency` 是普通字符串
   - `revenueSharePercent` 若为数字则截断到 `[0,100]`
   - 未填分成时安装侧归一化为 `0`
   
   `server/src/lib/plugin-market-publisher.ts:47` `server/src/lib/plugin-market.ts:213`
7. 文档站现有官方插件和主题索引中的评分、安装量是静态 JSON；市场安装没有回写索引或统计模型。`docs-site/docs/public/plugin-market/index.json:61` `docs-site/docs/public/theme-market/index.json:73`

### 4. 市场展示、安装与启用

1. 市场只在管理端扩展中心展示；普通用户端没有插件/主题商品购买或安装入口。`server/src/routes/admin-plugins.ts:542` `server/src/routes/admin-themes.ts:225` `client/src/views/admin/PluginCenterView.vue:2026`
2. 读取市场时只保留 `reviewStatus=listed` 的条目；安装前检查 listed、SHA256 和兼容版本。`server/src/lib/plugin-market.ts:321` `server/src/lib/plugin-market.ts:338` `server/src/lib/plugin-market.ts:353`
3. 插件安装按钮只判断 listed 和 checksum；付费条目仍显示普通“安装”按钮，确认弹窗也不展示价格、币种或分成。`client/src/views/admin/PluginCenterView.vue:456` `client/src/views/admin/PluginCenterView.vue:460` `client/src/views/admin/PluginCenterView.vue:2149`
4. 插件市场安装接口不读取 `pricing`，不创建订单、不扣余额、不生成授权，也不记开发者收入；成功条件只有市场条目存在、安装策略通过、包下载及校验成功。`server/src/routes/admin-plugins.ts:707` `server/src/routes/admin-plugins.ts:723` `server/src/routes/admin-plugins.ts:730`
5. 数据模型只有插件、版本、安装任务、投稿和主题包，没有插件/主题购买、授权、分账或开发者结算模型。`server/prisma/schema.prisma:2594` `server/prisma/schema.prisma:2657` `server/prisma/schema.prisma:2673` `server/prisma/schema.prisma:2728` `server/prisma/schema.prisma:2814`
6. 插件安装后默认未启用。高风险、严重风险 capability 会在安装时生成另一套能力审核记录；未批准时不能启用，但不阻止市场上架和下载安装。`server/src/db/plugins.ts:616` `server/src/db/plugins.ts:672` `server/src/db/plugins.ts:462` `server/src/routes/admin-plugins.ts:997`
7. 主题安装后同样默认未启用；重新安装同 ID 主题会明确关闭旧主题，需要再次启用。`server/src/db/themes.ts:129` `server/src/db/themes.ts:161`
8. 重新安装同 ID 插件会把 `status` 改为 `installed`，但更新分支没有把 `enabled` 改为 `false`；运行时又同时要求 `enabled=true` 且 `status=enabled`。因此已启用插件升级后可能显示仍启用、实际不再被加载。`server/src/db/plugins.ts:635` `server/src/db/plugins.ts:647` `server/src/routes/plugins.ts:398`

### 5. 当前经济闭环

当前没有插件/主题交易经济闭环：

`开发者填写定价元数据 → 市场展示“免费/付费预留” → 管理员直接安装`

不存在：

`购买订单 → 用户/站点授权 → 扣款 → 平台抽成 → 开发者收入 → 退款/撤销授权 → 结算`

前端也明确把 `paid` 标为“付费预留”；规划文档将付费扩展、主题、授权校验、评分和安装量列在后续商业化阶段。`client/src/views/admin/PluginCenterView.vue:251` `docs-site/docs/plugins/platform-plan.md:458`

## 二、业务疑点清单

- [BF-12-01] 功能残缺/经济倒挂 | `server/src/routes/admin-plugins.ts:707`
  - 现状：标记为 `paid` 的插件与免费插件走完全相同的直接安装路径，不扣款、不授权、不分账。
  - 疑点：一旦允许第三方把条目标成付费，管理员仍可零成本安装；开发者也没有收入记录，付费语义不成立。
  - 需 owner 确认：**是否确认当前版本所有插件一律按免费处理，并禁止审核上架 `pricing.type=paid` 的投稿，直到完整交易、授权和结算闭环上线？**

- [BF-12-02] 功能残缺 | `server/prisma/schema.prisma:2771`
  - 现状：主题投稿、市场条目和安装流程完全没有定价字段；商业化规划却同时写了“付费扩展和主题”。
  - 疑点：主题市场当前只能是免费素材市场，无法承载付费主题。
  - 需 owner 确认：**是否确认本期主题市场只允许免费主题，付费主题不属于当前已交付功能？**

- [BF-12-03] 功能残缺/市场治理 | `server/src/lib/plugin-market-publisher.ts:126`
  - 现状：发布器保留旧索引全部条目，再覆盖本次 listed 投稿；数据库中改为 `delisted/rejected` 的现有条目不会被主动从索引删除。
  - 疑点：后台显示“已下架”不等于公开市场真正下架，文档所述“delisted 不展示、不能安装”无法保证。主题发布器相同行为。`docs-site/docs/plugins/overview.md:107` `server/src/lib/theme-market-publisher.ts:99`
  - 需 owner 确认：**是否要求每次发布都以数据库当前有效状态为准，所有已下架/拒绝且无其他有效版本的 ID 必须从公开索引删除？**

- [BF-12-04] 内部矛盾 | `server/src/lib/plugin-market-publisher.ts:141`
  - 现状：版本按字符串降序读取，却循环覆盖同一 ID，最终留下排序中最后一项；主题相同。
  - 疑点：存在多个 listed 版本时，市场可能回退到较旧版本；而且数据库字符串排序不是 SemVer 排序，例如 `10.0.0` 与 `2.0.0` 口径不可靠。
  - 需 owner 确认：**是否规定市场每个 ID 只发布一个“最高 SemVer 且审核有效”的版本？**

- [BF-12-05] 内部矛盾/功能残缺 | `server/src/routes/plugin-market-submissions.ts:849`
  - 现状：扫描未执行或已经失败时也能把投稿标成 `listed`；发布器随后悄悄忽略它。
  - 疑点：开发者看到“通过上架”，实际市场没有条目，形成“审核成功但无法上架”的卡住状态。主题也一样。`server/src/lib/plugin-market-publisher.ts:142`
  - 需 owner 确认：**是否要求 `listed` 状态只能在最近一次扫描结果为 `passed` 或 `warning` 时设置？**

- [BF-12-06] 文档-代码不符 | `docs-site/docs/plugins/market.md:25`
  - 现状：文档称高风险能力审查通过后才能写入稳定索引；代码中的 capability 审核却在插件安装后才生成，只阻止启用，不阻止投稿上架、发布或安装。`server/src/db/plugins.ts:672` `server/src/db/plugins.ts:474`
  - 疑点：市场审核和安装后能力审核是两套互不联动的状态，文档把两者描述成了上架前置条件。
  - 需 owner 确认：**是否要求高风险 capability 在公共上架前完成审核，而不是等站点管理员安装后再审？**

- [BF-12-07] 功能残缺 | `client/src/api/admin.ts:2865`
  - 现状：主题投稿后端 API 存在，但用户端没有投稿表单、包上传或“我的主题投稿”入口。
  - 疑点：普通主题开发者无法通过产品 UI 完成端到端投稿，主题流程实际上停在 API 使用者层。
  - 需 owner 确认：**是否要求主题开发者拥有与插件相同的用户端上传、投稿和进度查看入口？**

- [BF-12-08] 规则可疑/市场治理 | `server/src/lib/plugin-market-publisher.ts:102`
  - 现状：只要开发者填写任意非空 GitHub HTTPS URL，市场条目就自动标记 `verified=true`、`trustLevel=verified`；没有账号绑定、仓库所有权或人工认证字段。
  - 疑点：“已认证开发者”目前只代表“填了一个 GitHub 地址”，容易误导安装者，也无法防止抢占插件 ID。
  - 需 owner 确认：**是否要求 `verified` 只能由管理员明确认证，开发者自行填写 GitHub URL不得自动获得认证标识？**

- [BF-12-09] 规则可疑 | `server/src/lib/plugin-market-publisher.ts:47`
  - 现状：付费价格是任意字符串，币种也是任意字符串；`paid` 可以不填价格或币种；分成比例只做 `[0,100]` 截断，没有平台默认比例、精度、计价单位或谁承担支付手续费的规则。
  - 疑点：即使以后补扣款，当前元数据也无法形成确定、可核账的金额公式。
  - 需 owner 确认：**是否在商业化前统一规定“最小货币单位整数金额 + 币种白名单 + 固定平台抽成口径”，并拒绝不完整的 paid 定价？**

- [BF-12-10] 内部矛盾 | `server/src/routes/plugin-market-submissions.ts:707`
  - 现状：插件包上传返回兼容格式 `{"payincus":"manifest范围"}`，前端原样覆盖投稿表单；发布器只识别 `minPayincus/maxPayincus`，插件扫描也不校验这两个口径。`client/src/views/ExtensionsView.vue:280` `server/src/lib/plugin-market-publisher.ts:39`
  - 疑点：使用推荐上传流程投稿的插件会丢失兼容约束，安装时可能不执行原 manifest 对应的市场版本限制。
  - 需 owner 确认：**是否以 manifest 的 `payincus` 范围作为唯一兼容性真源，并在投稿、扫描、索引和安装全过程统一使用？**

- [BF-12-11] 功能残缺 | `server/src/routes/plugin-market-submissions.ts:699`
  - 现状：平台上传产生 `/api/plugin-market-submissions/uploads/...` 地址；发布器只把该地址写入索引，不把包复制到稳定 `/plugin-market/packages/...`。而 `payincus.com` 的安装白名单只允许 `/plugin-market/packages` 或 `/plugin-market/manifests`。`server/src/lib/plugin-market.ts:151`
  - 疑点：如果投稿公开地址配置为默认市场域名，平台上传并审核通过的包可能仍不满足安装 URL 路径规则；若配置为业务 API 子域，又必须额外把该域加入受信列表。
  - 需 owner 确认：**是否要求发布动作同时把审核包和 manifest 固化到稳定市场目录，而不是让公开索引长期引用投稿临时 API 地址？**

- [BF-12-12] 文档-代码不符 | `docs-site/docs/plugins/overview.md:87`
  - 现状：文档称市场展示价格、币种、分成、评分数量和安装量；实际 UI 只展示“免费/付费预留”，没有显示价格、币种、分成，评分与安装量也没有真实采集闭环。`client/src/views/admin/PluginCenterView.vue:2077`
  - 疑点：文档把预留字段描述成已工作的市场能力，owner 和开发者可能据此误判商业化完成度。
  - 需 owner 确认：**是否把文档明确改为“商业字段仅预留、当前不计费也不统计”，直至对应功能真正上线？**

- [BF-12-13] 功能残缺/市场治理 | `server/src/db/plugin-market-submissions.ts:194`
  - 现状：每次复审直接覆盖审核状态、备注、审核人和时间；下架理由也允许为空。
  - 疑点：文档要求保留拒绝/下架原因和复审记录，但当前无法回答“谁在何时因何理由从 listed 改成 delisted”。`docs-site/docs/plugins/overview.md:109`
  - 需 owner 确认：**是否要求拒绝和下架必须填写原因，并为每次状态变化保存不可覆盖的审核历史？**

- [BF-12-14] 内部矛盾/功能残缺 | `server/src/db/plugins.ts:647`
  - 现状：已启用插件安装新版本后保留 `enabled=true`，但把 `status` 改成 `installed`；运行时要求两者同时表示启用，前端却主要根据 `enabled` 显示状态。`server/src/routes/plugins.ts:398` `client/src/views/admin/PluginCenterView.vue:711`
  - 疑点：升级后可能出现“界面显示启用、实际扩展不加载”，且管理员第一次点击会执行禁用而不是重新启用。
  - 需 owner 确认：**是否规定插件升级后必须明确进入“待重新启用”状态，并让前端与运行时统一显示该状态？**

- [BF-12-15] 规则可疑 | `server/src/lib/plugin-market-publisher.ts:118`
  - 现状：投稿一经发布，评分和安装量固定重置为零；每次安装只写本地任务和日志，没有市场级计数或去重口径。
  - 疑点：运营指标既不能反映真实安装，也无法定义升级、重复安装、卸载是否计数。
  - 需 owner 确认：**是否确认评分和安装量目前应从产品界面移除，待定义“站点唯一安装/版本升级/卸载”的统计口径后再开放？**

## 三、给 owner 的 TOP5 必答确认问题

1. **是否确认当前版本插件和主题全部免费，并禁止上架 `paid` 条目，直到购买、授权、退款、分成和开发者结算闭环完成？**
2. **是否要求公开市场索引严格反映数据库当前状态，使 `delisted/rejected` 在下一次发布后真实消失且不能再安装？**
3. **是否规定同一插件/主题 ID 只发布最高有效 SemVer，禁止当前多版本循环覆盖造成旧版本成为 `latest`？**
4. **是否要求投稿必须先完成扫描且结果为 `passed/warning`，之后才允许设置为 `listed`？**
5. **是否要求开发者认证与 ID 所有权由平台审核确认，禁止仅凭填写 GitHub URL自动获得“已认证开发者”标识？**
