# 系统版本更新日志

<!-- 此文件由 docs-site/scripts/generate-changelog.mjs 自动生成。请不要手动编辑。 -->

该页面从仓库 Git tag 和 commit 自动生成，用于展示系统版本演进。后台 OTA 的“可更新版本”和生产部署仍以 GitHub Release tag 为准。

## 最新发布状态 / Latest Release State

- 最新发布提交 / Latest Release Commit: `f8249da10`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.9 auth Turnstile cache hotfix
- 最新 tag / Latest tag: `v1.2.9`

## 未发布变更 / Unreleased Changes

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## 历史版本 / Historical Versions

## v1.2.9

- 发布提交 / Release commit: `f8249da10`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.9 auth Turnstile cache hotfix

# v1.2.9

## 修复

- 注册、登录和忘记密码页提交时会从 Turnstile 组件和隐藏响应字段重新读取 token，并在缺少验证时聚焦到可见验证区，避免验证码组件已完成但页面仍提示未验证。
- 忘记密码页补入认证页白名单，避免残留会话检查把它当成普通用户页处理。
- 前后台入口注册 Service Worker 时使用版本化 `/sw.js?v=...` 并禁用更新缓存，避免边缘缓存返回旧 `sw.js` 导致旧 JS/CSS chunk 持续生效。

## 验证

- `pnpm --filter server exec tsx scripts/test-frontend-route-guards.ts`
- `pnpm --filter server exec tsx scripts/test-theme-system-guards.ts`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `git diff --check`

## v1.2.8

- 发布提交 / Release commit: `e1280b967`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.8 auth and OTA cache hotfix

# v1.2.8

## 修复

- 修复交易所后台配置保存把只读的强制暂停策略写入数据库的问题，避免 Prisma `Unknown argument forceStoppedRequired` 导致配置保存失败。
- 注册页发送验证码按钮不再因为 Turnstile token 尚未生成而硬禁用；点击后继续走现有校验并给出人机验证提示，避免页面看起来“不能用”。
- Service Worker 静态资源改为网络优先并升级缓存名；新 worker 接管后自动刷新一次，降低 OTA 后旧 JS/CSS chunk 导致白屏、需要手动刷新才恢复的风险。

## 验证

- `pnpm --filter server exec tsx scripts/test-exchange-marketplace-guards.ts`
- `pnpm --filter server type-check`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## v1.2.7

- 发布提交 / Release commit: `8c69a032f`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.7 kawaii UI refresh

# v1.2.7

## 改进

- 发布 Product Design / kawaii-cloud 主题升级：公共首页、套餐市场、认证页、用户端、资源方页面和管理端共享浅色云朵主题、玻璃质感卡片和更一致的导航布局。
- 引入 Uiverse 风格的轻量动效，但保持为本地 CSS 实现：卡片 aurora 边框、按钮 glint 反馈、骨架屏流光和 loading 高亮都遵守 `prefers-reduced-motion`。
- 增加主题图片资产，用于首页和市场页的可爱 IDC 视觉表达，不新增运行时依赖。
- 收敛本地 UI 扫描中暴露的若干页面问题：普通用户日志页避免触发管理员接口、公开配置加载去重、集成中心 Telegram webhook 检查只在配置完整时执行，资源池本地 fixture 补齐默认 storage pool。

## 验证

- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm test`
- `git diff --check`
- `UI_SCAN_RUN_ID=2026-07-01T02-27-00-uiverse-motion-final node .ui-scan/run-cdp-ui-scan.mjs`
- `DATABASE_URL=... JWT_SECRET=... COOKIE_SECRET=... ENCRYPTION_KEY=... RUN_RECHARGE_CALLBACK_SMOKE=false RUN_AGENT_HEARTBEAT_SMOKE=false RUN_AGENT_RELEASE_SMOKE=false pnpm smoke:split:nginx`

## v1.2.6

- 发布提交 / Release commit: `ebf963345`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.6 exchange wallet audit atomicity

# v1.2.6

## 修复

- 修复交易所后台余额冻结、解冻、人工调整的原子性问题：余额变更、交易所钱包流水和交易所审计日志现在会在同一个数据库事务内提交。
- 如果审计日志写入失败，本次后台余额操作会整体回滚，避免出现“资金已变化但接口返回失败，管理员重试后重复冻结或重复调整”的风险。
- 补强交易所后台资金操作守卫，确保后续不会把钱包资金变更和审计日志重新拆成两段事务。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm build`
- `git diff --check`

## v1.2.5

- 发布提交 / Release commit: `30e81c439`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.5 exchange manual settlement

# v1.2.5

## 修复

- 交易所后台订单管理新增普通订单“人工放款”入口，管理员可以在确认期、已交割或人工复核状态下主动结算托管款到卖家交易所余额。
- 人工放款会复用交易所托管结算链路，写入订单审计、卖家交易所余额流水和卖家侧操作日志，避免人工处理绕过资金流水。
- 如果订单存在未完结争议，普通人工放款会被拒绝，必须进入争议管理按争议放款或退款流程处理，避免绕开争议冻结。
- 补强交易所生命周期守卫，覆盖自动确认结算、普通人工放款、提现审核完成凭证和提现拒绝退回等资金路径。

## 验证

- `pnpm --filter server test:exchange-lifecycle-guards`
- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`
- `pnpm build`
- `git diff --check`

## v1.2.4

- 发布提交 / Release commit: `7fd01ea2b`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.4 exchange lock polish

# v1.2.4

## 修复

- 实例详情页在交易所挂牌或交割锁定期间，现在会在自动续费弹窗内明确提示不能修改自动续费策略，并直接禁用开启/关闭按钮，避免用户从详情页绕过交易锁入口误操作。
- 加固交易所交割回归保护：交割流程继续保留实例当前已用流量和剩余额度，禁止重新引入“重置流量基线”步骤或将月流量清零。
- 补强交易所匿名与状态锁定守卫，确保前台接口类型、交割进度文案和详情页操作入口持续符合匿名交易与暂停锁定规则。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server test:exchange-lifecycle-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`
- `git diff --check`

## v1.2.3

- 发布提交 / Release commit: `a34afc734`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.3 exchange marketplace polish

# v1.2.3

## 修复

- 优化交易所挂牌检测展示：将实例准入检测和交割清理策略分组展示，避免用户把“能否上架”和“成交后会清理什么”混在一起理解。
- 补齐交易所市场卡片和详情页交割说明：明确标注“暂停锁定后强制重装”，让买家在购买前看到成交后的真实交割方式。
- 补齐交易所后台交割任务资金信息：交割任务列表展示订单金额、平台手续费和卖家托管净额，方便人工复核交割、争议和结算。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`
- `git diff --check`

## v1.2.2

- 发布提交 / Release commit: `c9ed099fc`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.2 exchange listing hardening

# v1.2.2

## 修复

- 优化交易所“上架交易所”入口：运行中的可交易实例不再被简单禁用入口，而是引导用户先暂停实例，暂停完成后重新检测并挂牌。
- 修复交易所可上架检测的通过项文案：后台和用户侧检查结果现在区分“通过说明”和“失败原因”，避免绿色通过项仍显示失败提示。
- 强化交易所后台策略保存：强制“实例必须暂停后才能上架”作为固定规则，前端保存和后端接口都会写死为开启，防止旧配置或直接调接口绕过。

## 验证

- `pnpm --filter client type-check`
- `pnpm --filter server type-check`
- `pnpm --filter server test:exchange-marketplace-guards`
- `git diff --check`

## v1.2.1

- 发布提交 / Release commit: `6fcf173f1`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.1 exchange withdrawal hardening

# v1.2.1

## 修复

- 修复交易所后台提现审核列表的操作按钮状态不精确问题：待审核只显示“通过/拒绝”，已通过或打款中只显示“完成”，已完成、已拒绝等终态不再展示可执行按钮。
- 强化交易所提现完成审计：管理员标记提现完成时必须填写打款凭证 URL 或流水号，避免线下打款完成后缺少可追溯证据。
- 接口层同步强制校验提现完成凭证，防止绕过后台 UI 直接调用接口把提现单标记为完成。

## 验证

- `pnpm --filter client type-check`
- `pnpm --filter server type-check`
- `pnpm --filter server test:exchange-marketplace-guards`

## v1.2.0

- 发布提交 / Release commit: `377f7f449`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.2.0 exchange hardening

# v1.2.0

## 修复

- 交易所允许已停用或售罄套餐的存量实例继续交易，挂牌和购买校验不再因为原方案不可新购而拒绝存量使用权交易。
- 强化交割前旧访问清理的容错能力：端口映射设备和代理站点远端清理失败会写入交割审计告警，不再直接中断强制重装交割链路。
- 修复历史半完成争议退款场景：如果订单已经退款但已交割实例仍在买家名下，管理员重试退款会把实例停机并原路退回卖家，不会二次退款。
- 明确交易所交割不会重置流量：买家详情、确认购买和交易说明都提示当前已用流量与剩余额度会按挂牌状态原样交割。
- 修复实例列表交易状态可能漏显示的问题：实例页现在按当前可见实例读取挂牌锁定状态，不再依赖“我的挂牌”第一页前 100 条数据。

## 验证

- `pnpm --filter client type-check`
- `pnpm --filter server type-check`
- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server test:exchange-lifecycle-guards`

## v1.1.9

- 发布提交 / Release commit: `6b371bc07`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.9 exchange dispute refund atomicity

# v1.1.9

## 修复

- 修复交易所后台“争议退款”仍然拆成两段流程的问题：现在买家退款、托管退款流水、订单状态、争议状态关闭、争议冻结解除流水和审计日志在同一个事务内完成。
- 如果历史版本已经出现“订单已退款但争议仍停留在 processing”的半完成状态，管理员再次处理时会只关闭争议并记录补救审计，不会二次给买家退款。
- 保持交易所退款规则不变：如果实例已经交割给买家，退款前会先停机并把实例归属、Incus 名称和管理权退回原卖家；退回过程继续保留当前流量用量和剩余额度。
- `v1.0.0` 正式版公告重写为可发布版本，补齐 0.9.x 到 1.0.0 的生产稳定性、Agent 加固、支付回调策略、资源售罄判断和升级建议。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`

## v1.1.8

- 发布提交 / Release commit: `aaaca037b`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.8 exchange dispute release atomicity

# v1.1.8

## 修复

- 修复交易所后台“争议人工放款”存在两段事务的问题：现在订单放款、卖家交易所余额入账、争议状态关闭、争议冻结解除流水和审计日志会在同一个事务内完成。
- 如果历史上已经出现订单已放款但争议仍停留在 processing 的半完成状态，管理员再次处理时会只关闭争议并记录补救审计，不会重复给卖家放款。
- 扩展交易所守卫，防止后续把争议放款重新拆回非原子流程。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server test:exchange-lifecycle-guards`
- `pnpm --filter server type-check`

## v1.1.7

- 发布提交 / Release commit: `9c5425c60`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.7 exchange seller settlement privacy

# v1.1.7

## 修复

- 收紧交易所公开市场和买家订单视角的数据最小化规则：公开挂牌响应不再返回卖家预计到账金额。
- 买家视角订单响应不再返回 `sellerReceivesAmount`；该字段仅保留给卖家视角、后台管理和内部结算使用。
- 用户侧商品详情只展示售价和平台手续费，不再向买家展示卖家净收入，进一步符合匿名交易和交易双方信息隔离原则。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`

## v1.1.6

- 发布提交 / Release commit: `9009dcf8a`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.6 exchange traffic audit wording

# v1.1.6

## 修复

- 修复交易所后台人工确认交割完成时的审计详情仍记录为 `trafficBaselineReset` 的问题。
- 人工交割完成审计现在统一记录 `trafficUsagePreserved: true`，与自动交割和实际交易规则保持一致：买家接收实例时保留挂牌实例当前已用流量和剩余额度，不重置流量基线。
- 扩展交易所守卫，确保后台人工交割完成路径也必须保留流量口径，避免后续重新引入“流量重置”的错误证据。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server test:exchange-lifecycle-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`

## v1.1.5

- 发布提交 / Release commit: `cb5c33ccb`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.5 exchange active dispute guards

# v1.1.5

## 修复

- 修复交易所未完结争议状态判断遗漏 `redelivering` 的问题，重新交割中的争议现在会被视为未完结争议。
- 交易所余额划转、提现申请、后台提现审核/完成、买家购买风控和重复争议判断都会拦截 `open / processing / redelivering` 状态。
- 后台交易所概览的未完结争议统计同步纳入重新交割中的争议。
- 后台争议列表在 `redelivering` 状态下继续显示处理按钮，避免重新交割中的争议变成不可操作状态。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`

## v1.1.4

- 发布提交 / Release commit: `03b06df33`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.4 exchange auto snapshot lock

# v1.1.4

## 修复

- 加固交易所挂牌/交割锁：自动快照调度器在真正创建或轮换快照前，会再次检查实例是否已上架交易所或存在未结交易订单。
- 修复已有自动快照策略在实例挂牌后仍可能被后台定时任务执行的问题，避免挂牌期间生成新快照或轮换旧快照。
- 扩展自动快照调度器守卫和交易所全局守卫，确保后续修改不会绕过交易所实例锁。

## 验证

- `pnpm --filter server test:auto-policy-scheduler-guards`
- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`

## v1.1.3

- 发布提交 / Release commit: `56d3f245d`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.3 exchange anonymity hardening

# v1.1.3

## 修复

- 加固交易所市场、详情和用户订单接口的匿名快照脱敏规则，新增拦截 `owner/fromUser/toUser/buyer/seller/avatar/telegram/wechat/qq` 等常见身份字段。
- 保持后台内部处理所需的买卖双方 ID 不变，但用户侧和市场侧继续只返回匿名交易标识和脱敏实例资产信息。
- 扩展交易所守卫测试，防止后续 snapshot 结构扩展时误把用户名、邮箱、头像、联系方式或双方身份对象返回给市场和交易参与方接口。

## 验证

- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`
- `pnpm build`

## v1.1.2

- 发布提交 / Release commit: `616d836fa`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.2 exchange traffic wording

# v1.1.2

## 修复

- 后台交易所人工确认交割提示改为“确认已用流量和剩余额度原样保留”，不再要求管理员核验“流量基线重置”。
- 生产 proof 中的交易所真实 E2E 记录模板同步改为流量用量保留，避免验收记录和实际交割规则冲突。
- 更新交易所生命周期守卫，防止后续代码或测试重新把交割流程改回流量重置。

## 验证

- `pnpm --filter server test:exchange-lifecycle-guards`
- `pnpm --filter server test:production-proof-center-guards`
- `pnpm --filter server test:exchange-marketplace-guards`
- `pnpm --filter server type-check`
- `pnpm --filter client type-check`

## v1.1.1

- 发布提交 / Release commit: `eb6e228f7`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: fix exchange refund return flow

# v1.1.1

## 修复

- 实例列表不再显示“可上架 / 需先暂停 / 不可上架”这类交易所资格提示标签，避免普通实例列表被交易所检测状态干扰。
- 实例列表仍保留真实交易状态标签，例如“交易所挂牌中”“交易所暂停中”“交易锁定中”“交割异常”，并继续锁定挂牌或交割中的实例操作。
- 交易所交割不再重置实例月流量用量、流量状态、流量基线和每日流量记录，买家接收的实例会保留挂牌时的已用流量和剩余额度。
- 交易所争议退款/订单退款如果发生在实例已交割给买家之后，会先停机并把实例归属、Incus 名称和管理权退回原卖家，再执行买家退款；退回过程保留当前流量用量。

## 验证

- 已确认生产真实交易所流程完成过一次交割：订单进入托管、强制重装、清理旧访问和绑定、转移实例归属、重建账单并进入确认期。

## v1.1.0

- 发布提交 / Release commit: `0c1eaa0be`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.1.0 exchange delivery fix

## v1.1.0

Fix Exchange Marketplace forced-reinstall delivery after live testing found Incus rejects renaming a running instance.

- Stop the rebuilt instance before the Exchange delivery worker renames it and transfers ownership, then persist the delivered instance as stopped.
- Keep the delivery model aligned with the product rule: buyers receive a freshly rebuilt instance, not the seller's original running environment.
- Expand the public Exchange policy summary used by the user UI: fee rule, confirmation rule, withdrawal limits, listing/purchase limits, expiry threshold, markup cap, public IP policy, image-selection policy and dispute timeout.
- Add guard coverage so future changes cannot remove the pre-rename stop or the user-facing Exchange policy summary.

## v1.0.9

- 发布提交 / Release commit: `1b3079211`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.9 exchange marketplace fixes

## v1.0.9

Harden Exchange Marketplace purchase/display behavior and fix registration Turnstile retry UX.

- Fix Exchange purchase secondary verification: `exchange_purchase` now accepts the listing ID as a scoped resource, so the sensitive verification modal can send and verify codes without the `Resource ID is not allowed for this operation` error.
- Fix anonymous Exchange listing snapshots: the public market still hides the original instance ID/name and user identity fields, but keeps sale metadata such as node name, package name, and plan name for buyer inspection.
- Add Exchange market package categories and package filtering. Market pagination now counts against the selected package category, while the category list is built from currently visible public listings.
- Show renewal price on Exchange market cards and listing details, using the instance billing price and billing cycle snapshot.
- Allow existing instances whose plan is inactive or sold out to be listed and purchased on the Exchange, because the trade is for remaining-use rights, not new stock.
- Add a protected Exchange Marketplace smoke command. It defaults to read-only checks and requires explicit environment flags before any destructive listing, purchase, or delivery polling path can run.
- Fix registration retry after Turnstile-protected failures such as an incorrect invite code: the page now resets only the Cloudflare challenge token and keeps the filled registration form intact.

## v1.0.8

- 发布提交 / Release commit: `5f45543e0`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.8 exchange marketplace

## v1.0.8

Release the first complete Exchange Marketplace implementation and close the latest create-instance verification issue.

- Add the Exchange Marketplace for idle instance resale: anonymous public market, seller listing flow, buyer purchase flow, escrow wallet, withdrawal requests, wallet transfer to account balance, order records, delivery records, disputes, and admin management.
- Enforce the required delivery model: instances must be stopped before listing, risk/overdue/expiring/task-running instances cannot list, buyer delivery always uses a forced reinstall, and seller/buyer identity is hidden from public and counterpart views.
- Add Exchange operation locks across ordinary instance mutation paths, billing operations, snapshots, backups, proxy sites, traffic reset, transfers, public API operations, admin billing actions, instance tasks, and destroy paths.
- Harden Exchange-sensitive access: listed or pre-delivery instances now block non-admin password viewing and terminal access, while the delivered buyer can use the rebuilt instance during confirmation or dispute handling.
- Add admin Exchange controls for policy, listings, orders, delivery retries/manual takeover, wallets, withdrawals, disputes, risk records, and audit logs, including payout rechecks before approval or completion.
- Fix create-instance Turnstile submission: the page now uses the visible verification widget token, falls back to Cloudflare's hidden response field, blocks locally when verification is missing, and localizes raw Turnstile backend errors.
- Include Exchange guards in the full repository test suite and explicitly whitelist the public, non-sensitive Exchange config endpoint used by the front-end purchase UI.

## v1.0.7

- 发布提交 / Release commit: `82275d089`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.7 instance verification

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.0.6

- 发布提交 / Release commit: `5c8d3b8e1`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.6 flash sale editing

- Allow admins to edit generated flash sale campaign content and time windows.

- Allow admins to edit flash sale item price, stock, per-user limit, coupon and AFF settings.

- Preserve existing reservations while applying edits to future purchases only.

- Add guard coverage for generated flash sale editing.

## v1.0.5

- 发布提交 / Release commit: `4d0dd50dd`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.5 flash sales

- Add flash sale campaigns, items, reservations, stock audit and guarded admin/user APIs.

- Add user flash sale page and admin multi-item flash sale management.

- Route flash sale purchases through the normal instance billing, Turnstile, risk restriction, stock lock and delivery compensation chain.

- Add flash sale guard coverage and documentation.

## v1.0.4

- 发布提交 / Release commit: `2bd25ba5a`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.4 resource risk policy hardening

Expand the Resource Risk policy model with recover scores, minimum QoS duration, downgrade cooldowns, per-tier notification flags, per-tier order restriction flags and a continue-downgrade switch.

Add a read-only policy simulation endpoint and admin UI result panel so operators can preview impacted instances, QoS hits, order restrictions and auto-suspensions before saving a strategy.

Harden automatic evaluation so manual QoS and manual suspension states are preserved until an operator releases them, QoS recovery restores the original bandwidth after recovery thresholds, and offline hosts do not falsely mark unapplied QoS as active.

Add a dedicated resource-risk QoS notification template and show users an upfront create-instance warning with a review ticket action when their account is under an active resource-risk order restriction.

## v1.0.3

- 发布提交 / Release commit: `09670ad88`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.3 package delivery hotfix

Fix hosted package delivery guards and Incus certificate path resilience.

Packages can now be published or unpublished directly from the package list. The action only changes package visibility for new orders; existing instances and renewals keep their normal lifecycle.

Harden package host storage-pool persistence. When a package is active, bound hosts must resolve to an `instance_data` storage pool. Empty storage-pool selections now fall back to the host's preferred system disk pool, prioritizing `default`, and activation is blocked if no usable pool exists.

Fix stale Incus client certificate paths after OTA. If a host still references an old release directory and that certificate file no longer exists, Incus operations fall back to the stable panel certificate directory under `/opt/incudal/server/certs` or the configured panel certificate environment variables.

Restore the Germany `DEBGP` production package configuration by binding it back to the `default` system disk pool and publishing it again after confirming `DE-01` can list Incus storage pools.

## v1.0.2

- 发布提交 / Release commit: `08362032d`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.2 welfare check-in

Add daily points check-in to the Welfare center.

Users can now open the Check-in tab, claim one random points reward per Beijing calendar day, and see current points, reward range, streak, monthly count and recent records. The default reward range is 1-500 points.

Add admin controls for daily check-in. Operators can enable or disable check-in, set the random points range, optionally require users to own an instance before claiming, and review paginated check-in logs with username, date, points, streak, IP and timestamp.

Harden check-in accounting with a dedicated `daily_checkins` table, a unique `(user_id, date_key)` constraint, points ledger entries, and a per-user advisory lock so concurrent requests cannot double-claim the daily reward.

Keep the existing system redeem code and resource pool flows intact. The daily check-in reward itself now grants points instead of random resource-pool credits.

Update the customer instance cards with clearer LXC/KVM, IPv4 NAT/dedicated network and quota markers so the instance list matches the newer network delivery model.

## v1.0.1

- 发布提交 / Release commit: `eca273ce9`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.1 network delivery

Add dedicated IPv4 and dedicated IPv4 + dedicated IPv6 delivery modes for hosted instances.

Plans can now use `public_ipv4` and `public_ipv4_ipv6`. New plan creation only exposes IPv4 NAT, IPv4 NAT + dedicated IPv6, dedicated IPv6, dedicated IPv4, and dedicated IPv4 + dedicated IPv6. Legacy `nat_ipv6_nat` and `ipv6_nat` values remain for existing data compatibility only and are not new plan targets.

Add host public IPv4 IPAM. Host owners and admins can create public IPv4 pools, add addresses, disable or re-enable free addresses, and delete unused addresses from the host detail page. Dedicated IPv4 capacity is checked during host selection, and instance creation reserves addresses with row locking to avoid concurrent double allocation.

Update Incus network payload generation so dedicated IPv4 instances use a routed `eth0` NIC on the host interface. Dual-stack dedicated IPv4 + IPv6 instances also receive the existing routed IPv6 NIC. NAT IPv4 modes continue to use the `incusbr0` bridge and remain the only modes that expose NAT port mappings.

Harden provisioning rollback for dedicated IPv4. User purchases, admin-created instances, host-owner created instances, async provisioning failures, and stuck `creating` timeout cleanup now release reserved public IPv4 addresses and compensate failed purchases consistently.

Update the host install script and hosting documentation so new nodes no longer present IPv6 NAT as a target capability. IPv6 delivery is documented as routed dedicated IPv6, while dedicated IPv4 requires a configured public IPv4 pool.

## v1.0.0

- 发布提交 / Release commit: `8d722fe78`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update handoff for DEBGP closure

# PayIncus v1.0.0 正式版更新公告

PayIncus v1.0.0 是第一个正式稳定版本。本版本的重点不是堆新入口，而是把 0.9.x 阶段暴露出来的生产问题收口：在线升级、节点 Agent、资源交付、支付回调、售罄判断、后台风控证据和部署文档都进入可运营状态。

## 正式版定位

v1.0.0 面向真实商业运营场景发布，目标是让面板具备稳定上线、可升级、可回滚、可审计、可排障的基础能力。

从 0.9.0 到 1.0.0，主要完成了这些能力收口：

- 后台资源风控、实例评分、人工处置和风险证据页进入可用状态。
- 在线升级链路加固，减少重复执行、重复 worker 和异常升级带来的不确定状态。
- 前后台分离部署、生产验收、版本日志和公开安装文档统一到 PayIncus 品牌。
- 支付回调策略明确支持“无固定回调 IP，但强制验签、金额校验和幂等”的生产配置。
- 节点 Agent 加固，避免高频心跳、全量状态采集和日志刷屏对宿主机造成压力。

## 生产稳定性

- 修复 OTA worker 重复启动和重复处理任务的问题。
- 跳过重复任务时会正确关闭数据库连接，避免升级进程残留。
- 生产包内的 split auth smoke 修复，确保发布产物和线上验证脚本一致。
- Turnstile 开启时，split auth smoke 能识别人机验证保护状态，不再把正常防护误判为失败。
- 版本日志过滤 handoff 和日志同步类提交，减少发布记录噪音。

## 节点 Agent 加固

- Agent 默认心跳间隔调整为 60 秒，并设置 30 秒最低间隔，避免被错误配置成高频请求。
- Incus 实例状态采集只处理运行中的实例，减少对宿主机 CPU 的压力。
- 单次状态上报加入 500 实例上限和更低并发，避免节点规模较大时把宿主机打满。
- 心跳日志做节流，避免长期运行时日志无限写入导致磁盘压力。
- 生成的 `incudal-agent.service` 增加 CPU、内存、任务数量和 journal 写入限额。
- Agent 发布版本提升到 `v1.0.0`，面板可以向已有节点分发加固后的 Agent 二进制。

已有节点只升级 Agent 二进制还不够。要让 systemd 的 CPU、内存、任务和日志限额生效，需要在每台节点重新运行 Agent 安装脚本，刷新 systemd unit。

## 支付回调策略

- 新增明确的生产策略：当支付商没有固定回调出口 IP 时，可以设置 `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`。
- 该策略不等于跳过安全校验。回调仍必须通过签名验证、交易状态验证、金额匹配和 `payment_callbacks` 幂等记录。
- `PAYMENT_CALLBACK_SKIP_IP_WHITELIST=true` 仍属于跳过 IP 检查的高风险配置，文档已区分这两种模式。
- 生产 readiness 不再把“明确接受无固定回调 IP 策略”的配置误报为未解决风险。

## 资源与售罄判断

- 公开套餐售罄判断补齐磁盘容量，避免前台显示可购买、下单后创建失败。
- 生产 readiness 文档补充 CPU、内存和磁盘容量要求。
- 节点/套餐资源判断更接近真实交付链路，减少购买成功后资源不足的异常。

## 后台风控与证据页

- 修复后台资源风控证据抽屉透明背景问题。
- 证据详情现在使用实体背景覆盖，不再透出底层风险列表。
- 证据快照、表格和 JSON 内容在浅色/深色模式下都保持可读。
- 后台资源风险页更适合运营人员直接查看实例风险、证据和处置记录。

## 部署与文档

- 公共安装脚本、环境初始化、OTA 文案和生产验收报告统一使用 PayIncus 品牌。
- 运行路径、系统用户、systemd 服务名和发布产物名保持兼容，仍沿用 `/opt/incudal`、`incudal` 用户、`incudal-backend` 服务和现有 release artifact 命名，避免破坏已有线上环境。
- 中文和英文部署文档补充支付回调 IP 策略、Agent systemd 限额和生产检查说明。

## 升级建议

- 建议所有 0.9.x 用户升级到 v1.0.0。
- 升级后检查后台版本页、生产健康检查、支付回调配置和节点 Agent 状态。
- 每台宿主机建议重新运行 Agent 安装脚本，让 systemd 限额配置生效。
- 如果支付通道没有固定回调 IP，请使用明确策略 `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`，不要使用跳过安全检查的临时绕过配置。

## 总结

v1.0.0 标志着 PayIncus 从快速迭代进入正式运营阶段。本版本重点解决线上升级、节点 Agent 资源占用、支付回调策略、资源售罄判断和后台风控可读性问题，为后续交易所、扩展中心、主题系统和更完整的商业运营能力打下稳定基础。

## v0.9.9

- 发布提交 / Release commit: `e64ad2c6c`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.9

Update public installer, environment initialization, atomic OTA migration and live acceptance report wording to use PayIncus branding.

Keep `/opt/incudal`, the `incudal` system user, the `incudal-backend` service name and release artifact names unchanged for runtime and OTA compatibility.

Add guard coverage so future split-deployment changes cannot reintroduce old public-facing Incudal branding in installer or production proof output.

## v0.9.8

- 发布提交 / Release commit: `a69542b4d`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.8

Fix the admin resource-risk evidence drawer with scoped opaque panel, card, table and JSON backgrounds so the evidence detail view no longer appears transparent over the underlying risk list.

Clarify production readiness warnings for empty payment callback IP allowlists: callbacks still require signature verification, trade-status validation, amount matching and `payment_callbacks` idempotency before balance credit.

Add DB readiness detail that identifies active payment providers without built-in callback IP defaults when no global callback source IP allowlist is configured.

## v0.9.7

- 发布提交 / Release commit: `6fb574b3b`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.7

Fix the admin resource-risk evidence drawer so it renders above the admin chrome with solid light and dark backgrounds.

Keep evidence snapshot cards, tables, and JSON blocks readable instead of inheriting transparent themed surfaces.

## v0.9.6

- 发布提交 / Release commit: `031d93c58`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.6

Fix public package sold-out detection to include disk capacity, keeping market availability aligned with backend instance creation checks.

Update production readiness warnings and docs to describe CPU, memory and disk capacity requirements.

## v0.9.5

- 发布提交 / Release commit: `4fb5d0392`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.5

Fix themed surface transparency so admin risk evidence drawers and themed cards render with solid backgrounds.

Keep docs version logs focused on real release changes by filtering handoff and version-log sync commits from unreleased changes.

## v0.9.4

- 发布提交 / Release commit: `15e6c63cd`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Close OTA worker database on skipped duplicate

### 其他变更 / Other Changes

- Close OTA worker database on skipped duplicate `15e6c63cd`

## v0.9.3

- 发布提交 / Release commit: `d1290ac3b`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Guard OTA workers against duplicate starts

### 其他变更 / Other Changes

- Guard OTA workers against duplicate starts `d1290ac3b`

## v0.9.2

- 发布提交 / Release commit: `e67fc89c7`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Handle Turnstile in split auth smoke

### 其他变更 / Other Changes

- Handle Turnstile in split auth smoke `e67fc89c7`

## v0.9.1

- 发布提交 / Release commit: `763baaf90`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix split auth smoke in production artifacts

### 修复与稳定性 / Fixes and Stability

- Fix split auth smoke in production artifacts `763baaf90`

## v0.9.0

- 发布提交 / Release commit: `aa087db3b`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.0

### 其他变更 / Other Changes

- Document resource risk operations `430d0bc28`

## v0.8.9

- 发布提交 / Release commit: `bf3d86ef0`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.9

Resource risk admin pagination and source-scoped manual order restriction controls.

## v0.8.8

- 发布提交 / Release commit: `359501c12`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.8

PayIncus independent baseline release with rebuilt public docs, SDK examples, extension/theme templates, and clean public attribution.

## v0.8.7

- 发布提交 / Release commit: `8df363493`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance plan upgrade capacity checks

### 修复与稳定性 / Fixes and Stability

- Fix instance plan upgrade capacity checks `8df363493`

## v0.8.6

- 发布提交 / Release commit: `20f9209af`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add manual resource risk controls

### 新增能力 / New Capabilities

- Add manual resource risk controls `20f9209af`

## v0.8.5

- 发布提交 / Release commit: `51e2df00f`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden OTA Prisma client generation

### 修复与稳定性 / Fixes and Stability

- Harden OTA Prisma client generation `51e2df00f`

## v0.8.4

- 发布提交 / Release commit: `7c476d272`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add instance resource risk center

### 新增能力 / New Capabilities

- Add instance resource risk center `7c476d272`

## v0.8.3

- 发布提交 / Release commit: `1a82f05ec`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance bandwidth and billing nav display

### 修复与稳定性 / Fixes and Stability

- Fix instance bandwidth and billing nav display `1a82f05ec`

## v0.8.2

- 发布提交 / Release commit: `4f5bb5ec1`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add package traffic reset pricing

### 新增能力 / New Capabilities

- Add package traffic reset pricing `4f5bb5ec1`

## v0.8.1

- 发布提交 / Release commit: `4a131d7a9`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden storage readiness and traffic reset

### 修复与稳定性 / Fixes and Stability

- Harden storage readiness and traffic reset `4a131d7a9`

## v0.6.19

- 发布提交 / Release commit: `d60bf6d5f`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance transfer path release guard

- 继续发布用户端实例产品卡片和创建实例自动命名能力。
- 修复实例卡片 PUSH 跳转的前后台构建边界，避免后台包包含用户端固定转让路径。
- 更新 route guard 以覆盖新的 transfersPath helper 形态。

## v0.6.18

- 发布提交 / Release commit: `5c8668a9f`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish instance cards and creation naming

- 用户端实例卡片改为产品信息卡样式，集中展示地区、节点、套餐、配置、网络、流量、价格、到期时间和自动续费。
- 实例卡片新增管理、PUSH、续费入口，并复用现有单实例续费/自动续费能力。
- 创建实例时自动生成安全实例名称，支持手动覆盖和重新生成；后端 API 在 name 缺省时也会兜底生成。
- 侧边栏分组标题增加翻译兜底，避免显示裸 key。

## v0.6.17

- 发布提交 / Release commit: `e9c266ed0`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish UI structure and docs for v0.6.17

- Keep public market and help pages in the public site shell.
- Add collapsible user/admin sidebar groups.
- Improve help center search, links, and error states.
- Improve gift card user/admin UI safety, code masking, copy, and responsive layout.
- Deep-link Extension Center tabs and align theme market styling.
- Refresh Extension Center docs and OTA guard coverage.

## v0.6.16

- 发布提交 / Release commit: `69ac3840a`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile body verification

### Fixes and Stability / 修复与稳定性

- Move user gift card Turnstile verification from onRequest to preHandler so body turnstileToken is available.

- Keep authentication in onRequest and add guard coverage to prevent body-token verification regressions.

- Let the gift-card flow test check the active database schema for isolated test runs.

## v0.6.15

- 发布提交 / Release commit: `e3963e086`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Persist expired gift card state

### 其他变更 / Other Changes

- Persist expired gift card state `e3963e086`

## v0.6.14

- 发布提交 / Release commit: `370be981b`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile token flow

### 修复与稳定性 / Fixes and Stability

- Fix gift card Turnstile token flow `370be981b`

## v0.6.13

- 发布提交 / Release commit: `f28e86037`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix user gift card Turnstile verification

### 修复与稳定性 / Fixes and Stability

- Fix user gift card Turnstile verification `f28e86037`

## v0.6.12

- 发布提交 / Release commit: `f7544939f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix admin gift card generation Turnstile gate

### 修复与稳定性 / Fixes and Stability

- Fix admin gift card generation Turnstile gate `f7544939f`

## v0.6.11

- 发布提交 / Release commit: `4db8d4582`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add operations settings center

### 新增能力 / New Capabilities

- Add operations settings center `4db8d4582`

## v0.6.10

- 发布提交 / Release commit: `11ecc4b27`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add gift card center

### New capabilities / 新增能力

- Add user gift card page for balance-funded gift card generation, redemption, and owned-card history.

- Add admin gift card center for single and batch generation, stats, redacted lists, enable, disable, and delete actions.

- Add GiftCard Prisma model and migration; OTA applies it through prisma migrate deploy.

### Fixes and stability / 修复与稳定性

- Protect gift card balance flows with advisory locks, transaction-scoped balance deduction, self-redeem blocking, and one-time redeem claims.

- Restrict production gift card management with PAYINCUS_GIFT_CARD_ADMIN_IDS and mask codes by default.

- Localize and fix the OAuth Provider admin UI template.

## v0.6.9

- 发布提交 / Release commit: `369212f8e`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix extension market public domain

- Point extension, theme, and SDK public URLs to payincus.com

- Trust the real docs-site host for market index and package downloads

- Keep market guard coverage aligned with the live docs domain

## v0.6.8

- 发布提交 / Release commit: `809db50fc`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix extension platform release guards

- Keep plugin market review APIs in the admin API client

- Preserve user/admin SideNav build-time route separation

- Add frontend route guard to extension platform verification

## v0.6.7

- 发布提交 / Release commit: `d1737465f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Build extension platform and theme system

- Upgrade Extension Center product wording to Extension Center

- Add OAuth Provider, Public API, SDK, action runtime, events, scoped plugin storage, market review, and theme package system

- Add governed live extension/theme market assets and development documentation

- Add extension platform guard coverage and verification scripts

## v0.6.6

- 发布提交 / Release commit: `9fcbe2867`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Skip source smoke in artifact acceptance / 验收脚本跳过产物源码 smoke

### 其他变更 / Other Changes

- Skip source smoke in artifact acceptance / 验收脚本跳过产物源码 smoke `9fcbe2867`

## v0.6.5

- 发布提交 / Release commit: `cefd77acc`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update final proof scope waiver / 更新最终验收豁免口径

### 改进与调整 / Improvements and Adjustments

- Update final proof scope waiver / 更新最终验收豁免口径 `cefd77acc`

## v0.6.4

- 发布提交 / Release commit: `5eff38f15`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update production proof workspace status / 更新生产验收工作台状态

### 改进与调整 / Improvements and Adjustments

- Update production proof workspace status / 更新生产验收工作台状态 `5eff38f15`

## v0.6.3

- 发布提交 / Release commit: `54aa45a2c`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查

### 修复与稳定性 / Fixes and Stability

- Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查 `54aa45a2c`

## v0.6.2

- 发布提交 / Release commit: `0f67f1d2f`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Force artifact OTA dependency install / 强制重建 OTA 制品依赖

### 其他变更 / Other Changes

- Force artifact OTA dependency install / 强制重建 OTA 制品依赖 `0f67f1d2f`

## v0.6.1

- 发布提交 / Release commit: `0b408cc81`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出

### 修复与稳定性 / Fixes and Stability

- Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出 `0b408cc81`

## v0.6.0

- 发布提交 / Release commit: `50f0f8b96`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限

### 其他变更 / Other Changes

- Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限 `50f0f8b96`

## v0.5.9

- 发布提交 / Release commit: `800c5092e`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden artifact OTA install directory handling

### 修复与稳定性 / Fixes and Stability

- Harden artifact OTA install directory handling `800c5092e`

## v0.5.8

- 发布提交 / Release commit: `976a38a84`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update production proof workspace status

### 改进与调整 / Improvements and Adjustments

- Update production proof workspace status `976a38a84`

### 其他变更 / Other Changes

- Document safe Lsky cleanup proof boundary `813d8c04c`

## v0.5.7

- 发布提交 / Release commit: `d470e7b36`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden online update runner environment

### 修复与稳定性 / Fixes and Stability

- Harden online update runner environment `d470e7b36`

### 其他变更 / Other Changes

- Record latest Lsky proof access attempt `6c086cd3e`

## v0.5.6

- 发布提交 / Release commit: `79d00defc`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky production proof script

### 新增能力 / New Capabilities

- Add Lsky production proof script `79d00defc`

### 其他变更 / Other Changes

- Document Lsky cleanup blocker evidence `9c04f22f7`

## v0.5.5

- 发布提交 / Release commit: `80d353edb`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Expose SMTP provider proof metadata

### 其他变更 / Other Changes

- Expose SMTP provider proof metadata `80d353edb`

## v0.5.4

- 发布提交 / Release commit: `bbae57c1b`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update production proof workspace status

### 改进与调整 / Improvements and Adjustments

- Update production proof workspace status `bbae57c1b`

## v0.5.3

- 发布提交 / Release commit: `2e99abc73`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add production DB restore drill proof

Add a repeatable production database restore drill script and update the production proof workspace to 8/13 after the temporary restore proof.

## v0.5.2

- 发布提交 / Release commit: `4f5b3f076`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky delete diagnostics

Log non-sensitive Lsky delete status/body/error diagnostics and avoid treating provider status:false responses as successful cleanup.

## v0.5.1

- 发布提交 / Release commit: `b8eabc097`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky v2 image deletion

Preserve numeric Lsky v2 photo IDs and delete images through the official batch /user/photos endpoint.

## v0.5.0

- 发布提交 / Release commit: `cd8797b45`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix production proof workspace progress

Use the ledger-backed 7/13 Category 13 proof count in the admin production proof workspace instead of deriving progress from grouped display rows.

## v0.4.9

- 发布提交 / Release commit: `7ae496731`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky upload cleanup identifier / 修复 Lsky 上传清理标识

Preserve Lsky pathname/path fallback provider IDs so uploaded ticket images can be cleaned up when provider responses omit id/key/hash.

## v0.4.8

- 发布提交 / Release commit: `326cab141`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add production proof workspace / 新增生产验收工作台

### 新增能力 / New Capabilities

- Add production proof workspace / 新增生产验收工作台 `326cab141`

### 其他变更 / Other Changes

- Document v0.4.7 cache deployment notes / 记录 v0.4.7 缓存部署说明 `4ce40baf9`

## v0.4.7

- 发布提交 / Release commit: `4f5995da2`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI runtime calls and SPA cache headers / 修复工单 AI 运行时调用与 SPA 缓存头

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI runtime calls and SPA cache headers / 修复工单 AI 运行时调用与 SPA 缓存头 `4f5995da2`

## v0.4.6

- 发布提交 / Release commit: `b92a5a093`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add plugin market governance / 新增插件市场治理

### 新增能力 / New capabilities

- Add listed-only plugin market governance with review status, trust source, developer profile, permission declarations, compatibility range, security metadata, rating, install count and commercial reserve fields.
- Add server-side install policy for market plugins: listed status, GitHub Release artifact, SHA256 pinning and PayIncus version compatibility.
- Add admin plugin market governance summary, index fingerprint, rich market cards and install safety confirmation.

### 其他变更 / Other changes

- Publish governance metadata for the official AI ticket plugin market index generated by GitHub Release.
- Update Chinese and English extension center documentation for market governance and install safety.

### 改进与调整 / Improvements and adjustments

- Add plugin market governance guard and include it in the root test chain.

## v0.4.5

- 发布提交 / Release commit: `d0d0c0612`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI cached API fallback / 修复工单 AI 缓存 API 兜底

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI cached API fallback / 修复工单 AI 缓存 API 兜底 `d0d0c0612`

## v0.4.4

- 发布提交 / Release commit: `68abb173d`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add capacity and cost operations view / 新增容量与成本运营视图

### 新增能力 / New Capabilities

- Add capacity and cost operations view / 新增容量与成本运营视图 `68abb173d`

## v0.4.3

- 发布提交 / Release commit: `b186fa869`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI runtime fallback / 修复工单 AI 运行时兜底

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI runtime fallback / 修复工单 AI 运行时兜底 `b186fa869`

## v0.4.2

- 发布提交 / Release commit: `7f574ae8e`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI actions and panel cert paths / 修复工单 AI 与面板证书路径

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI actions and panel cert paths / 修复工单 AI 与面板证书路径 `7f574ae8e`

## v0.4.1

- 发布提交 / Release commit: `dfb490060`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Show installed plugin settings in sidebar / 安装后显示插件设置入口

### 其他变更 / Other Changes

- Show installed plugin settings in sidebar / 安装后显示插件设置入口 `dfb490060`

## v0.4.0

- 发布提交 / Release commit: `b4d4cce11`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add standalone plugin settings pages / 新增独立插件设置页

### 新增能力 / New Capabilities

- Add standalone plugin settings pages / 新增独立插件设置页 `b4d4cce11`

## v0.3.9

- 发布提交 / Release commit: `f009c7e01`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Localize AI plugin settings UI / 中文化 AI 插件设置界面

### 新增能力 / New capabilities

- Localize the official AI ticket plugin package as AI 工单助手 and publish plugin version 0.1.1.
- 将官方 AI 工单插件中文化为 AI 工单助手，并发布插件版本 0.1.1。

### 修复与稳定性 / Fixes and stability

- Show plugin settings pages before raw config JSON in the plugin detail panel.
- 在插件详情中将插件设置页面前置到原始配置 JSON 之前。

### 改进与调整 / Improvements and adjustments

- Add Chinese permission labels and a default config template shortcut in the extension center.
- 在扩展中心增加中文权限名和默认配置模板快捷入口。

## v0.3.8

- 发布提交 / Release commit: `92cda32ef`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Publish AI ticket plugin market assets / 发布 AI 工单插件市场资产

### 新增能力 / New capabilities

- Publish official AI Ticket Agent plugin market assets in GitHub Release.
- 在 GitHub Release 中发布官方 AI 工单插件市场资产。

### 其他变更 / Other changes

- Add plugin market release guard coverage.
- 增加插件市场 Release 资产守卫覆盖。

### 改进与调整 / Improvements and adjustments

- Document AI Ticket Agent installation from the plugin market in Chinese and English docs.
- 在中英文文档中补充 AI 工单插件从插件市场安装的说明。

## v0.3.7

- 发布提交 / Release commit: `bbf36c931`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix admin benefits localization bundle / 修复后台福利本地化打包

### 新增能力 / New Capabilities

- Added a release guard that checks all benefits translation keys used by the admin benefits page.
- 新增后台福利页 i18n key 发布守卫，覆盖页面使用的全部福利文案。

### 改进与调整 / Improvements and Adjustments

- Keep the admin benefits translation namespace in the admin frontend bundle while continuing to strip admin-only benefits text from the customer bundle.
- 后台前端包保留福利管理所需文案，同时用户端包继续剔除后台福利管理文案。
- Prevent admin benefits pages from rendering raw translation keys such as entertainment.admin.title.
- 避免后台福利页显示 entertainment.admin.title 等原始翻译 key。

## v0.3.6

- 发布提交 / Release commit: `8b5ad55d1`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add risk audit logging center / 新增风控审计日志中心

### 新增能力 / New Capabilities

- 后台日志页新增风险审计概览，显示风险动作数量、本页高风险、需要审批和需要验证码的记录数。 / Added an audit summary to the admin logs page with risk catalog count, high-risk records, approval-required records, and verification-required records.

- 日志列表新增风险等级与风险说明，覆盖低、中、高、严重四级。 / Added risk level and risk title display to log rows with low, medium, high, and critical levels.

- 新增高风险操作目录，覆盖系统更新、支付通道、余额调账、批量删除实例、节点、套餐、管理员权限和插件安装等动作。 / Added a high-risk operation catalog covering system updates, payment providers, balance adjustments, batch instance deletion, hosts, packages, admin role changes, and plugin installation.

- 新增管理员审计 CSV 导出，单次最多 1000 条，并记录 audit.export 操作日志。 / Added admin-only audit CSV export capped at 1000 rows and recorded as an audit.export operation log.

### 改进与调整 / Improvements and Adjustments

- 日志接口返回前脱敏用户名、邮箱、IP、token 和 JWT 类内容。 / Redacted usernames, emails, IP addresses, tokens, and JWT-like values before returning log data.

- 根目录全量测试纳入 risk-audit 守卫。 / Included the risk-audit guard in the root full test command.

- 更新中英文后台文档和商业运营目标进度。 / Updated Chinese and English admin docs plus commercial operation progress notes.

## v0.3.5

- 发布提交 / Release commit: `a28cf91cb`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden plugin assets and benefits localization / 加固插件资产并修复福利本地化

### 新增能力 / New capabilities

- Add authenticated plugin asset token flow for protected plugin pages.
- Add safe AI ticket plugin status endpoint for admin settings.

### 改进与调整 / Improvements

- Fix benefits admin localization fallback and missing English keys.
- Extend guards for benefits i18n, plugin protected assets, and AI ticket status safety.

### 其他变更 / Other changes

- Update AI ticket plugin template docs and settings UI for safe status visibility.

## v0.3.4

- 发布提交 / Release commit: `2babf9d8e`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Require AI ticket reply confidence checks / 增加 AI 工单回复置信度检查

### 其他变更 / Other Changes

- Require AI ticket reply confidence checks / 增加 AI 工单回复置信度检查 `2babf9d8e`

## v0.3.3

- 发布提交 / Release commit: `28dd2dede`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden AI ticket takeover safeguards / 加固 AI 工单接管安全边界

### 修复与稳定性 / Fixes and Stability

- Harden AI ticket takeover safeguards / 加固 AI 工单接管安全边界 `28dd2dede`

## v0.3.2

- 发布提交 / Release commit: `651f0ba1d`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add user lifecycle operations center / 新增用户生命周期运营中心

### 新增能力 / New Capabilities

- Add user lifecycle operations center / 新增用户生命周期运营中心 `651f0ba1d`

## v0.3.1

- 发布提交 / Release commit: `c71ade8cd`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add customer success ticket workspace / 新增客服成功工单工作台

### 新增能力 / New Capabilities

- Add customer success ticket workspace / 新增客服成功工单工作台 `c71ade8cd`

## v0.3.0

- 发布提交 / Release commit: `a721de8c1`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add SLA alert center / 新增 SLA 告警中心

### 新增能力 / New Capabilities

- Add SLA alert center / 新增 SLA 告警中心 `a721de8c1`

## v0.2.9

- 发布提交 / Release commit: `62825b809`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add delivery assurance operations workflow / 新增交付保障运营闭环

### 新增能力 / New Capabilities

- Add delivery assurance operations workflow / 新增交付保障运营闭环 `62825b809`

## v0.2.8

- 发布提交 / Release commit: `dc95c91e8`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add financial reconciliation workflow / 新增财务对账闭环

### 新增能力 / New Capabilities

- Add financial reconciliation workflow / 新增财务对账闭环 `dc95c91e8`

## v0.2.7

- 发布提交 / Release commit: `5de795a23`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order payment operations workflow / 新增订单支付运营闭环

### 新增能力 / New capabilities

- Add admin order operation cases with dispute states: pending review, confirmed, compensated and closed.
- 新增后台订单运营处理记录，支持待核查、已确认、已补偿、已关闭争议状态。
- Add manual refund registration that creates balance-adjustment approval requests without directly changing user balances.
- 新增人工退款登记，只创建调账审批，不直接修改用户余额。
- Add redacted provider status summaries and extended order search by keyword and date range.
- 新增脱敏 provider 状态摘要，并扩展订单号、交易号、用户和时间范围搜索。

### 改进与调整 / Improvements and adjustments

- Link order operation records to adjustment approvals and balance logs after approval.
- 订单运营处理记录可关联调账审批，审批通过后继续关联余额流水。
- Update admin billing documentation in Chinese and English.
- 更新中英文后台与支付账务文档。

### 验证 / Verification

- pnpm --filter server test:order-payment-operations-guards
- pnpm --filter server test:order-center-guards
- pnpm --filter server test:balance-adjustment-approval-guards
- pnpm --filter server type-check
- pnpm --filter client type-check
- pnpm --filter client build
- pnpm --filter server test:frontend-route-guards
- pnpm --filter server test:frontend-dist-boundary-guards
- pnpm --dir docs-site --ignore-workspace build
- pnpm build
- pnpm test
- git diff --check

## v0.2.6

- 发布提交 / Release commit: `e282b6346`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add commercial operations overview / 新增商业运营总览

### New capabilities / 新增能力

- Add admin commercial operations overview for revenue, orders, users, instances, delivery, infrastructure, support, and risk alerts.
- 新增后台商业运营总览，覆盖收入、订单、用户、实例、交付、基础设施、支持与风险提醒。

### Other changes / 其他变更

- Update admin documentation for the operations overview.
- 更新后台文档，说明运营总览指标与边界。

### Improvements and adjustments / 改进与调整

- Add commercial operations overview guard and include it in pnpm test.
- 新增商业运营总览守卫，并纳入 pnpm test。

## v0.2.5

- 发布提交 / Release commit: `49959a2e7`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Harden OTA cleanup and disk preflight / 加固 OTA 清理与磁盘预检

### 新增能力 / New capabilities

- Add OTA download-cache cleanup before and after update tasks.
- Add disk-space preflight with actionable Chinese failure guidance.
- Add atomic release pruning with protected current and rollback targets.

### 改进与调整 / Improvements and adjustments

- Preserve .incudal-update-downloads during legacy artifact application until cleanup finishes.
- Document OTA retention environment variables in Chinese and English.

### 其他变更 / Other changes

- Extend system update guard coverage for cleanup, preflight and release pruning.

## v0.2.4

- 发布提交 / Release commit: `0eb2178f7`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add balance adjustment approval / 新增调账审批流

### 新增能力 / New Capabilities

- Add balance adjustment approval / 新增调账审批流 `0eb2178f7`

## v0.2.3

- 发布提交 / Release commit: `21a678cb4`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order exception handling / 新增订单异常处理

### 新增能力 / New Capabilities

- Add order exception handling / 新增订单异常处理 `21a678cb4`

## v0.2.2

- 发布提交 / Release commit: `3c641c9b6`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add unified order center / 新增统一订单中心

### 新增能力 / New Capabilities

- Add unified order center / 新增统一订单中心 `3c641c9b6`
- Revert "Add demo login and read-only safeguards / 新增演示登录与只读保护" `a7b1825ac`
- Add demo login and read-only safeguards / 新增演示登录与只读保护 `07592a786`

### 其他变更 / Other Changes

- Separate demo docs from production guides / 区分演示文档与生产指南 `458dad6aa`

## v0.2.1

- 发布提交 / Release commit: `e8cca3906`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Allow installer to set initial admin email / 允许安装器设置初始管理员邮箱

### 新增能力 / New Capabilities

- 一键安装脚本支持设置初始管理员邮箱。
- One-click installer now supports setting the initial admin email.

### 改进与调整 / Improvements and Adjustments

- 默认管理员初始化改为读取 ADMIN_EMAIL，兼容 ADMIN_INITIAL_EMAIL。
- Default admin initialization now reads ADMIN_EMAIL and remains compatible with ADMIN_INITIAL_EMAIL.
- 环境示例和中英文部署文档补充 ADMIN_EMAIL。
- Environment examples and Chinese/English deployment docs now include ADMIN_EMAIL.

### 其他变更 / Other Changes

- 增加安装器和数据库初始化守卫测试，防止管理员邮箱再次硬编码。
- Added installer and database initialization guards to prevent hardcoded admin email regressions.

## v0.2.0

- 发布提交 / Release commit: `01731f693`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix installer static asset permissions / 修复安装器静态资源权限

### 修复与稳定性 / Fixes and stability

- Keep the install root traversable for Nginx so one-click installs can serve frontend static assets.
- 保持安装根目录可被 Nginx 穿透，确保一键安装后可正常提供前端静态资源。

### 改进与调整 / Improvements and adjustments

- Preserve owner-only permissions for .env after install and upgrade permission repair.
- Add split deployment guard coverage for installer static asset permissions.

## v0.1.9

- 发布提交 / Release commit: `8f2d2f39b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Ensure installer enables pnpm / 确保安装脚本启用 pnpm

### 修复与稳定性 / Fixes and stability

- Ensure the one-click production installer enables pnpm before Prisma migrations and systemd startup.
- 确保一键生产安装脚本在 Prisma 迁移和 systemd 启动前启用 pnpm。

### 改进与调整 / Improvements and adjustments

- Pin pnpm 9.14.2 in the installer and keep a Corepack-first, npm-fallback bootstrap path.
- 在安装脚本中固定 pnpm 9.14.2，并保留 Corepack 优先、npm 兜底的初始化路径。
- Extend split deployment guards to prevent clean-server installer regressions.
- 扩展前后台分离部署守卫，防止干净服务器安装路径回退。

## v0.1.8

- 发布提交 / Release commit: `65dbc9d8a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix delivery nav icon / 修复交付保障导航图标

### 修复与稳定性 / Fixes and stability

- 修复后台交付保障菜单没有侧边栏小图标的问题。

- Fixed the missing sidebar icon for the admin Delivery Assurance menu item.

### 改进与调整 / Improvements and adjustments

- 扩展交付保障守卫，确保菜单使用的 pulse 图标已被侧边栏组件支持。

- Extended the Delivery Assurance guard to ensure the pulse menu icon is supported by the sidebar component.

## v0.1.7

- 发布提交 / Release commit: `1e7a7388b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add delivery assurance center / 新增交付保障中心

### 新增能力 / New capabilities

- 新增后台交付保障中心，可查看实例交付任务、队列状态、失败原因、疑似卡住任务和通知投递统计。

- Added the admin Delivery Assurance center for instance delivery tasks, queue state, failure details, stale processing tasks, and notification delivery metrics.

### 其他变更 / Other changes

- 实例任务失败、超时清理和启动清理僵尸任务时，会记录中文失败日志并触发用户失败通知。

- Instance task failures, timeout cleanup, and startup stale-task cleanup now write Chinese failure logs and send user failure notifications.

### 改进与调整 / Improvements and adjustments

- 将交付保障守卫加入根级 pnpm test，校验 admin-only 路由、敏感字段不返回、前后台边界和任务失败通知。

- Added Delivery Assurance guards to the root pnpm test chain, covering admin-only routes, sensitive-field redaction, frontend boundary, and failure notifications.

## v0.1.6

- 发布提交 / Release commit: `474ae022e`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix admin instance detail loading / 修复后台实例详情加载

### 修复与稳定性 / Fixes and Stability

- Fix admin instance detail loading / 修复后台实例详情加载 `474ae022e`

## v0.1.5

- 发布提交 / Release commit: `e865f4d41`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Localize operation logs in Chinese / 日志内容中文化

### 其他变更 / Other Changes

- Localize operation logs in Chinese / 日志内容中文化 `e865f4d41`

## v0.1.4

- 发布提交 / Release commit: `ac2b679e4`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定

### 其他变更 / Other Changes

- Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定 `ac2b679e4`

## v0.1.3

- 发布提交 / Release commit: `5bec34f74`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix instance detail bandwidth rendering / 修复实例详情带宽渲染

### 修复与稳定性 / Fixes and Stability

- Fix instance detail bandwidth rendering / 修复实例详情带宽渲染 `5bec34f74`

## v0.1.2

- 发布提交 / Release commit: `004c84f3c`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix admin update and plugin UI / 修复更新与插件 UI

### New capabilities / 新增能力

- Admin users can view latest release metadata while update execution remains super-admin only.

- 后台管理员可查看最新 release 信息，实际更新执行仍仅限超级管理员。

### Improvements and adjustments / 改进与调整

- Cap update and plugin task lists to 7 rows per page with stable pagination.

- 将更新任务和插件安装任务固定为每页 7 条并稳定分页。

- Rework plugin market and task logs into clearer plugin-center inner pages.

- 将插件市场和安装任务日志整理为更清晰的扩展中心内页。

## v0.1.1

- 发布提交 / Release commit: `f2aaefa45`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Polish update task and extension center UI / 优化更新任务和扩展中心界面

### 新增能力 / New Capabilities

- 插件市场在扩展中心内作为独立内页呈现，保留 GitHub Release 包和 SHA256 校验上下文。

- Plugin Market is presented as a dedicated in-center page with GitHub Release package and SHA256 verification context.

### 其他变更 / Other Changes

- 版本更新页在未发现新版本时持续展示当前/latest 版本信息，并将主按钮显示为已更新至最新版本。

- The system update page keeps latest/current version details visible when no newer release exists and marks the primary action as already up to date.

### 改进与调整 / Improvements and Adjustments

- 更新任务和插件安装任务列表收口为每页最多 7 行，超出后通过分页查看。

- 安装任务日志和市场页面布局改为更清晰的后台工作区，减少页面撑高和信息挤压。

- Update and plugin install task lists are capped at 7 rows per page with pagination for overflow.

- Install logs and market layout now use clearer admin workspace spacing to reduce page overflow and crowded content.

## v0.1.0

- 发布提交 / Release commit: `6c06bd873`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Polish update and plugin admin UI / 优化更新与插件后台界面

### 改进与调整 / Improvements and Adjustments

- Polish update and plugin admin UI / 优化更新与插件后台界面 `6c06bd873`

### 其他变更 / Other Changes

- Document bilingual versioning and OTA cadence rules `7fe36012d`

## v0.0.22

- 发布提交 / Release commit: `9f638d87f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add redacted production proof snapshot

### 新增能力 / New Capabilities

- Add redacted production proof snapshot `9f638d87f`

### 其他变更 / Other Changes

- Record public production revalidation `f9ed41edf`

## v0.0.21

- 发布提交 / Release commit: `71cdcff11`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix production OTA CLI start command

### 修复与稳定性 / Fixes and Stability

- Fix production OTA CLI start command `71cdcff11`

## v0.0.20

- 发布提交 / Release commit: `301fc2c9a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Update version log for static root fix

### 修复与稳定性 / Fixes and Stability

- Fix production split static roots `5afc9a57e`

## v0.0.19

- 发布提交 / Release commit: `97f87c5a9`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix storage pool defaults and error guidance

### 修复与稳定性 / Fixes and Stability

- Fix storage pool defaults and error guidance `97f87c5a9`

## v0.0.18

- 发布提交 / Release commit: `368d1953a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent binary installer cache query

### 修复与稳定性 / Fixes and Stability

- Fix Agent binary installer cache query `368d1953a`

## v0.0.17

- 发布提交 / Release commit: `60faf9a59`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent installer manifest parsing

### 修复与稳定性 / Fixes and Stability

- Fix Agent installer manifest parsing `60faf9a59`

## v0.0.16

- 发布提交 / Release commit: `a0a35fb51`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Refresh host panel trust certificate

### 其他变更 / Other Changes

- Refresh host panel trust certificate `a0a35fb51`

## v0.0.15

- 发布提交 / Release commit: `a361779aa`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix atomic OTA install root detection

### 修复与稳定性 / Fixes and Stability

- Fix atomic OTA install root detection `a361779aa`

## v0.0.14

- 发布提交 / Release commit: `6a0624abb`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Clarify Debian host install support

### 新增能力 / New Capabilities

- Clarify Debian host install support `6a0624abb`

## v0.0.13

- 发布提交 / Release commit: `5bf4e9aa3`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Update version log for HSTS hardening

- Add HSTS to split Nginx templates and installer-generated static frontend blocks.

- Guard HSTS in split deployment and security header checks.

- Document the public Strict-Transport-Security production requirement.

## v0.0.12

- 发布提交 / Release commit: `0453d5aac`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Add extension center

### 新增能力 / New Capabilities

- Add extension center `0453d5aac`
- Add bilingual PayIncus documentation site `8d89da363`

### 修复与稳定性 / Fixes and Stability

- Fix GitHub Pages docs workflow `9b9b40f55`

### 其他变更 / Other Changes

- Deploy docs site with GitHub Pages `9d6cd2b46`

### 改进与调整 / Improvements and Adjustments

- Update split deployment docs `878fc93d7`
- Update README with OTA and community links `86c623441`

## v0.0.11

- 发布提交 / Release commit: `6229369bc`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.10

- 发布提交 / Release commit: `6229369bc`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

### 新增能力 / New Capabilities

- Support atomic OTA release layout `6229369bc`

## v0.0.9

- 发布提交 / Release commit: `292408042`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Auto rollback failed online updates

### 修复与稳定性 / Fixes and Stability

- Auto rollback failed online updates `292408042`

## v0.0.8

- 发布提交 / Release commit: `b60103085`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.7

- 发布提交 / Release commit: `b60103085`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

### 改进与调整 / Improvements and Adjustments

- Prefer verified OTA artifacts for online updates `b60103085`

## v0.0.6

- 发布提交 / Release commit: `e691ffa8e`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Stabilize OTA restart verification

### 修复与稳定性 / Fixes and Stability

- Stabilize OTA restart verification `e691ffa8e`

## v0.0.5

- 发布提交 / Release commit: `674c0d8e5`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix OTA manifest release workflow checkout

### 修复与稳定性 / Fixes and Stability

- Fix OTA manifest release workflow checkout `674c0d8e5`

## v0.0.4

- 发布提交 / Release commit: `21c398f7e`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Add OTA release manifest metadata

### 新增能力 / New Capabilities

- Add OTA release manifest metadata `21c398f7e`

## v0.0.3

- 发布提交 / Release commit: `edac4e9e1`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make OTA worker tolerate production git ownership

### 修复与稳定性 / Fixes and Stability

- Make OTA worker tolerate production git ownership `edac4e9e1`

## v0.0.2

- 发布提交 / Release commit: `19391c900`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make online updates asynchronous and build-ready

### 改进与调整 / Improvements and Adjustments

- Make online updates asynchronous and build-ready `19391c900`

## v0.0.1

- 发布提交 / Release commit: `c7629e641`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Allow online update worker sudo under systemd

### 新增能力 / New Capabilities

- Allow online update worker sudo under systemd `c7629e641`

### 改进与调整 / Improvements and Adjustments

- Prepare v0.0.1 online update baseline `6a9854c5c`
- Make release installs reproducible `fb02c8c53`
- Update Agent release repository default `108efe281`
- Rewrite PayIncus README `063fbaf10`
- Update payincus deployment checks `354007222`
- Update README.md `fb9297153`
- Prepare host deployment package `52e1af49d`

### 修复与稳定性 / Fixes and Stability

- Harden release production verification `8b23a8f18`

### 其他变更 / Other Changes

- first commit `c2498911a`

## 生成方式

在仓库根目录执行：

```bash
pnpm docs:build
```

或者只刷新版本日志：

```bash
pnpm docs:changelog
```

如果 CI 或 GitHub Pages 使用浅克隆，可能拿不到完整 tag。需要在构建前拉取 tags，或改用 GitHub Release API 作为数据源。
