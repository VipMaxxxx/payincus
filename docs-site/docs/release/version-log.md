# 系统版本更新日志

<!-- 此文件由 docs-site/scripts/generate-changelog.mjs 自动生成。请不要手动编辑。 -->

该页面从仓库 Git tag 和 commit 自动生成，用于展示系统版本演进。后台 OTA 的“可更新版本”和生产部署仍以 GitHub Release tag 为准。

## 最新发布状态 / Latest Release State

- 最新发布提交 / Latest Release Commit: `bb5a0ea8a`
- 提交日期 / Commit date: 2026-07-13
- 最新 tag / Latest tag: `v1.5.0`

## 未发布变更 / Unreleased Changes

### 其他变更 / Other Changes

- 修复文档部署守卫:移除已删主题平台的 theme-staging 断言 `c7a6f8b2f`

## 历史版本 / Historical Versions

## v1.5.0

- 发布提交 / Release commit: `bb5a0ea8a`
- 提交日期 / Commit date: 2026-07-13


### 精简（移除下列模块，含前端、后端路由/worker、Prisma 模型与数据库表）

### 优化

- 全站 UI 重做为纯净的浅色主色 + 单一强调色的 Linear 风格设计，支持浅色 / 深色双主题。
- 修复长期存在的“点击侧边栏偶发白屏”问题：`index.html` 增加 `Cache-Control: no-cache`，避免浏览器 / CDN 缓存到旧入口导致的分块 404。
- 文档站删减已下线功能的冗余内容，导航去除死链。

### 修复

### 升级说明（面向自建 / 开源用户）

- 本版新增 9 个下线迁移，全部按幂等、无损原则编写：`DROP TABLE IF EXISTS ... CASCADE`、`DROP TYPE IF EXISTS`；共享枚举（`TicketObjectLinkType`、`PaymentProviderType`）采用“重命名旧类型 + 新建 + `USING` 转换”的安全收窄方式，且在收窄前先删除/转换被移除枚举值对应的数据行，不使用不受支持的 `ALTER TYPE ... DROP VALUE`。
- `plugin_gateway` 类型的支付渠道会被自动置为 `disabled` 并归类为 `manual`，不会因外键约束中止升级；升级后管理员可自行清理这些遗留渠道。
- 上述设计保证任意历史版本的部署都能顺利完成“备份 → 迁移 → 重启”的在线升级流程，仅删除被下线功能自身的数据，其余业务数据完整保留。

## v1.4.3

- 发布提交 / Release commit: `cdcdeb583`
- 提交日期 / Commit date: 2026-07-12
- 提交说明 / Commit subject: Release v1.4.3: 修复 OTA 迁移前 pg_dump 连接（role "root"）


### 修复

- 修复 OTA 迁移前数据库备份步骤连接错误：此前 `pg_dump` 未携带正确的连接信息，会回退到本地 unix socket 并以操作系统用户（root）连接，触发 `role "root" does not exist`，导致备份失败、迁移中止并自动回滚。现改为从 `DATABASE_URL` 解析出主机/端口/用户/密码/库名并通过环境变量传入 `pg_dump`，凭据不落命令行、不写入更新日志。

> 本补丁修复了 v1.4.0/v1.4.1 引入的 OTA 数据库备份缺陷，使后续在线升级能够顺利完成备份→迁移→重启流程。无 schema 变更。基于 v1.4.2。

## v1.4.2

- 发布提交 / Release commit: `630544fe1`
- 提交日期 / Commit date: 2026-07-12
- 提交说明 / Commit subject: Release v1.4.2: 版本号对齐 tag + 归档本次大版本审计台账


### 维护

- 将 `package.json` 版本号从 `1.3.7` 更新为 `1.4.2`，与发行 tag 保持一致(此前版本号未随 v1.4.0/v1.4.1 同步)。
- 归档本次大版本(v1.4.0)的审计台账与逐项评审记录到仓库(`EXECUTION_LOG.md`、`audits/`),便于团队追溯。

> 无功能/schema 变更。基于 v1.4.1(见对应发布说明)。

## v1.4.0

- 发布提交 / Release commit: `38c7bf154`
- 提交日期 / Commit date: 2026-07-12
- 提交说明 / Commit subject: Release v1.4.0 全面加固与功能补全 + OTA 数据库迁移支持


> 本版(v1.4.0)为一次大范围加固与功能补全:约 120 项缺陷/逻辑修复 + 7 个大功能,并首次为 OTA 增加数据库迁移支持。**升级前请务必阅读文末「升级注意 / 部署红线」。**

### 安全加固

- 修复开放重定向反斜杠绕过(前后端同步),防 OAuth 登录码泄漏致账号接管。
- 所有外呼(AI/SMTP/webhook/市场扫描/图床/证书查询)统一走安全出站组件:连接期 DNS 复核、禁重定向、超时、响应限长,防 SSRF/DNS rebinding。
- 日志脱敏覆盖 `pat_`/`poa_`/Basic/深层对象;`apiError` 5xx 不再返回内部异常原文。
- Caddy 管理请求启用 TLS 证书校验(CA 固定/fail-closed),不再明文可劫持。
- root OTA 单元只执行 root 拥有、服务用户不可写的固定入口与 SHA256 已验证产物,阻断服务用户→root 提权链。

### 资金与计费正确性

- 修复退款方向/漏钱:充值来源退款改「扣减」,退款按比例冲回 AFF 佣金与统计,托管「删除并退款」回扣节点主人。
- 邮箱退款按真实实付逐期、累计退款≤累计实付;延期统一 31 天基、升级剩余价值按实付封顶、三者入事务加锁。
- 订单退款限已完成状态、上限取实付、条件唯一防查重竞态;套餐价「分/元」不再放大 100 倍。
- 硬删用户/到期实例改软删/归档,不再级联抹掉财务与审计;积分↔余额比价护栏、奖池概率总和约束、礼品卡资金来源与撤销。

### 实例交付 / 网络 / 终端 / 流量

- 流量双通道加采样版本、拒迟到上报回退快照,消除重复计量;月流量重置在采集锁内重建基线再原子清零;固定 Asia/Shanghai 时区。
- 批量端口映射统一按最终数计配额/校验范围;IPv6 CIDR 子网重叠检查;资源池申领按主机容量原子校验防 OOM 超卖;宿主用量原子 increment 防并发丢失更新。
- **修复终端「Failed to connect」**:审计日志失败与连接生命周期隔离;WS 初次建连/重连加 close 监听与代次校验,消除僵尸会话。

### 规则与体验

- 礼品卡按 `expiresAt` 实时排除过期;有使用记录的兑换码禁物理删除只允许禁用/归档;流量兑换码改一次性。

### 新功能

- **AFF 佣金/折扣百分比后台可配**。
- **邮箱过期自救 + 自动续费**:过期可续费复活、到期暂停上游/续费恢复、`autoRenew` 自动扣费执行器(每次 1 月)、定时同步上游实际用量。
- **Hosting 现金提现人工审核流**(转面板余额免审即时)。
- **工单自动关闭可配置 + 可关**。

### 运维 / OTA

- **OTA 首次支持数据库迁移**:升级时在切换 release 后、重启前自动 `pg_dump` 备份并 `prisma migrate deploy`;迁移失败中止,代码自动回滚时保留 DB 备份并告警(DB 不自动回滚,如需请用备份手工恢复)。
- 明确并文档化「私有后端单进程」假设(登录锁/OAuth nonce/去重/配置缓存)。

### ⚠️ 升级注意 / 部署红线

2. **流量重置价改「元」存储须与代码原子同发**——迁移把存量「分」值 ÷100,若代码上线而迁移未跑会导致 100 倍偏差。
3. **Caddy TLS 校验**:升级前须在后端配置 `CADDY_CA_PATH` 并收集各宿主 `/etc/caddy/cert.pem`,否则反代管理会 fail-closed。
4. **root 提权链硬化(装机/OTA 单元变更)**:升级需在维护窗口重新执行装机脚本安装新 OTA 单元,并按部署清单核对属主/权限/sudoers。
5. 发布前请在维护窗口对受影响流程做真机验证。

### 验证

- 全量守卫(200+ 个 `test-*-guards`)、前后端 TypeScript、i18n 键、路由与产物边界守卫通过;用户端与管理端生产构建通过。
- 说明:以上为本地/守卫层验证,生产真机验证在部署期完成。

## v1.3.7

- 发布提交 / Release commit: `fd5e722f0`
- 提交日期 / Commit date: 2026-07-10
- 提交说明 / Commit subject: Release v1.3.7 UI consistency refinement


### 界面一致性

- 继续统一用户端与管理端的中性色视觉语言，收敛实例、套餐、消息、账务、运营和系统设置页面中过多的装饰性颜色。
- 保留失败、危险、成功、警告和处理中等关键业务状态的语义色，并补齐对应的暗色模式样式。
- 优化表格、筛选区、状态标签、操作按钮和管理端表单的间距、边框与信息层级，降低高密度页面的视觉干扰。

### 布局与可读性

- Antom 支付配置弹窗扩大到双列表单宽度，减少密钥、币种和商户字段的拥挤。
- 实例与套餐页面的网络模式、来源和类型标签改为稳定的中性标签；IPv6 地址不再截断，便于核对完整地址。
- 调整账务提醒、批量操作及多项管理表单的网格布局，并改善窄屏下的换行和内容容纳。

### 验证

- 前端 TypeScript、国际化键和路由守卫通过。
- ESLint 零错误；存量 Vue 缩进提示不阻断发布。
- 用户端与管理端生产构建、前后台产物边界守卫和后端 TypeScript 编译通过。

## v1.3.6

- 发布提交 / Release commit: `1f4008cc2`
- 提交日期 / Commit date: 2026-07-10
- 提交说明 / Commit subject: Release v1.3.6 Antom payments and UI refinement


### 界面体验

- 统一用户端与管理端的页面密度、导航、表单、列表、空状态和响应式布局，减少模板化装饰，提升长时间操作时的可读性。
- 重构首页、市场、登录、用户仪表盘及管理端核心页面的视觉层级，并补齐桌面端与 390px 移动端适配。
- 使用语义状态色区分成功、处理中、警告与失败状态，避免中性色主题削弱业务反馈。
- 引入轻量滚动揭示动效，并遵循系统的减少动态效果设置；空状态图标统一使用 Lucide 图标。

### Antom 支付

- 新增 Antom Checkout Payment 托管收银台支付方式，支持支付会话创建、结果查询、异步通知与幂等入账。
- 管理端支付方式页面新增 Antom 配置表单、字段说明、密钥脱敏和生产就绪检查。
- Antom 回调继续复用现有订单金额校验、状态流转和重复通知保护；新增 Prisma 枚举迁移与定向 guard。
- Antom 默认保持未配置和停用状态，正式启用前仍需完成商户凭证配置及沙箱实付验证；原路退款暂按人工流程处理。

### 文档与验证

- 补充中英文 Antom 配置、回调和上线前核对说明。
- 前后端 TypeScript 类型检查、前端国际化检查、Prisma 校验、183 项测试命令、用户端与管理端生产构建、文档构建全部通过。
- 首页、市场、登录、用户仪表盘、支付方式管理及 Antom 表单已完成桌面端和移动端实屏验收。

## v1.3.5

- 发布提交 / Release commit: `7f6f6b8c1`
- 提交日期 / Commit date: 2026-07-09
- 提交说明 / Commit subject: Release v1.3.5 security hardening and UI refresh


### 安全与稳定性

- 修复重建、迁移和恢复期间 Incus 实例短暂不可见时被状态调度器误标为删除的问题，并避免操作期间误发意外停机通知。
- 强化主题资源响应的 CSP 与 sandbox，降低可执行 SVG/HTML 资源造成存储型 XSS 的风险。
- OAuth state 与登录码改用常量时间签名比较，并按各自有效期逐条清理防重放 nonce。
- OTA manifest 和 artifact 仅向可信 GitHub 主机附带 Release Token；回滚拒绝删除包含原子备份的安装目录。
- Restore 与 Backup Upload Worker 只清理确实超时的 PROCESSING 任务，避免多节点部署误杀其他节点任务。
- Telegram webhook URL 不再从客户端可控的转发头推导；普通用户不再看到通知渠道 Chat ID 预览。

### 账务与支付

- 用余额生成礼品卡改用独立 `gift_card_issue` 余额日志类型，不再计入可兑换积分的真实消费额。
- 新增历史日志重分类迁移，使用礼品卡关联、金额与事务时间窗口识别历史发行扣款。
- 已验签且金额一致的迟到支付回调不再因本地过期时间被静默丢弃，继续进入幂等入账；待支付订单增加六小时取消宽限期。

### 会话与前端可靠性

- 用户端和管理端 Token 刷新增加 15 秒超时，刷新端点挂起时不再长期阻塞请求队列。
- 管理端 `/auth/me` 瞬时失败不再触发管理员整段登出。
- 用户端与管理端跨域误入时只清当前标签页内存状态，保留另一端合法共享会话。
- Service Worker 缓存名从注册 URL 的版本参数生成，后续发版无需重复手工维护缓存字面量。

### 界面与文档

- 用户端与管理端视觉调整为更克制、清晰的产品界面，统一页面密度、表单、导航、卡片和响应式细节。
- 文档站改为任务导向的信息架构，统一浅色/暗色主题、侧栏、正文、代码块、表格和风险提示，并完成中英文移动端适配。
- 修复一键升级的原子布局识别和版本输出，安装包增加 SHA256 与归档路径校验。
- 重写中英文手工部署与 systemd 指南，补齐 GitHub Pages sitemap、robots、canonical 和多语言 alternate。

### 验证

- 前后端 TypeScript 类型检查。
- 全量 `pnpm build`、`pnpm test`、文档构建和部署文档 guard。
- 文档站 70 个路由的桌面与 390px 移动端宽度、标题和链接检查。

## v1.3.4

- 发布提交 / Release commit: `bd0a36c69`
- 提交日期 / Commit date: 2026-07-09
- 提交说明 / Commit subject: Release v1.3.4 reload loop guard


### 修复与体验

- 修复首页在 Service Worker 接管或静态资源恢复期间可能反复自动刷新的问题。
- Service Worker `controllerchange` 刷新改为按客户端版本在当前会话内只执行一次，避免同一版本重复接管造成刷新循环。
- 前端静态资源版本不一致恢复逻辑改为按当前 HTML 资源签名只自动刷新一次；如果刷新后仍失败，会停止自动刷新并保留控制台告警，避免用户卡在无限刷新中。

### 验证

- `pnpm --filter client type-check`
- `pnpm --filter server test:frontend-route-guards`

## v1.3.3

- 发布提交 / Release commit: `f32e44e02`
- 提交日期 / Commit date: 2026-07-09
- 提交说明 / Commit subject: Release v1.3.3 demo safeguards and UI polish


### 修复与体验

- 合并演示账号一键登录和只读保护：演示账号登录历史脱敏，受保护账号禁止修改密码和管理员重置密码。
- 前端保留最新生产主线功能的前提下，合入二次元风格的轻量视觉升级：字体、主题色、动效 token、实例配置卡片、镜像选择下拉和资料页标题细节。
- 镜像选择下拉改为 Teleport 到 `body`，避免被父级滚动容器裁切。
- Markdown 渲染增加基础 HTML 清理，降低帮助文档等富文本内容的 XSS 风险。
- 同步 Service Worker 静态缓存名到 `v1.3.3`，确保 OTA 后客户端获取新版本静态资源。

### 验证

- `pnpm --filter client type-check`
- `pnpm --filter server type-check`
- `pnpm --filter server test:demo-account-safety-guards`
- `pnpm --filter server test:demo-notification-redaction-guards`
- `pnpm --filter server test:demo-readonly-redaction-guards`
- `pnpm --filter server test:frontend-route-guards`
- `pnpm build`

## v1.3.2

- 发布提交 / Release commit: `62338ac31`
- 提交日期 / Commit date: 2026-07-08
- 提交说明 / Commit subject: Release v1.3.2 stale asset recovery


### 修复与稳定性

- 增加前后台统一的旧静态资源恢复逻辑：捕获 Vite preload、动态 import、router 和 Vue 错误中的旧 chunk 加载失败，清理 Incudal 静态缓存后自动刷新，减少 OTA 后点击页面无反应或白屏需要手动刷新的情况。
- 登录、注册、忘记密码等 Turnstile 验证区域固定显示验证状态，明确区分“未验证 / 已验证 / 已过期 / 验证失败”，避免用户误判当前验证码是否已经完成。
- 移除前端生产 HTML 中残留的 Figma capture 外链，降低线上 CSP/外部脚本噪音。
- 同步前端路由守卫测试，覆盖旧静态资源恢复、Figma capture 移除和 Turnstile 固定状态提示。
- 同步 Service Worker 静态缓存名到 `v1.3.2`，确保 OTA 后客户端获取新版本静态资源。

### 验证

- `pnpm --filter server test:frontend-route-guards`
- `pnpm --filter client type-check`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm build`
- `git diff --check`
- 本地 CDP 全页扫描：202 页，0 issues。
- 本地可见导航点击扫描：用户端 desktop/mobile 36/36，通过；管理端 desktop/mobile 60/60，通过。

## v1.3.1

- 发布提交 / Release commit: `edd97236f`
- 提交日期 / Commit date: 2026-07-08
- 提交说明 / Commit subject: Release v1.3.1 auth redirect fixes


### 修复

- 合并 PR #8：登录成功后使用 `router.replace()` 跳转，等待导航完成并避免登录页留在历史记录中。
- 注册成功后在同步认证状态并加载当前用户后立即跳转客户控制台，不再依赖延迟 `setTimeout()`。
- 已登录用户访问登录/注册等游客页时使用 `replace` 跳转到控制台，避免返回按钮回到已失效的认证页。
- 同步前端路由守卫测试，覆盖登录、注册和游客页重定向的新跳转语义。
- 同步 Service Worker 静态缓存名到 `v1.3.1`，确保 OTA 后客户端获取新版本静态资源。

## v1.2.12

- 发布提交 / Release commit: `df34eacf9`
- 提交日期 / Commit date: 2026-07-08
- 提交说明 / Commit subject: Release v1.2.12 UI and stability fixes


### 修复与稳定性

- 修复实例改配预览的套餐价格单位，避免分/元混用导致用户看到错误差价。
- 同步 Service Worker 静态缓存名到 `v1.2.12`，确保 `/sw.js?v=1.2.12` 激活后清理旧版本静态资源缓存。

## v1.2.11

- 发布提交 / Release commit: `17d1d2265`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.11 service worker cache version


### 修复

- 同步 Service Worker 静态缓存名到 `v1.2.11`，确保 `/sw.js?v=1.2.11` 激活后会清理旧版本资源缓存，延续 OTA 后避免旧 chunk 白屏的缓存隔离策略。

### 验证

- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `pnpm build`
- `pnpm --dir docs-site --ignore-workspace build`
- `git diff --check`

## v1.2.10

- 发布提交 / Release commit: `f1452aeff`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.10 help and OAuth fallback fixes


### 修复

- 帮助中心在没有后台发布文章时提供内置“快速开始使用 Incudal”文章，避免线上帮助页空数据或文章缺失时显示通用加载失败。
- 帮助文章详情页把 `ARTICLE_NOT_FOUND` 和 404 显示为明确的文章不存在状态，减少误判为系统错误。
- OAuth 授权页对无效、停用或回调地址不匹配的客户端显示中文不可用提示，不再直接暴露原始英文错误。

### 验证

- `pnpm --filter server exec tsx scripts/test-content-route-guards.ts`
- `pnpm --filter server exec tsx scripts/test-frontend-route-guards.ts`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `pnpm build`
- `pnpm --dir docs-site --ignore-workspace build`
- `git diff --check`

## v1.2.9

- 发布提交 / Release commit: `014c5af45`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.9 auth Turnstile cache hotfix


### 修复

- 注册、登录和忘记密码页提交时会从 Turnstile 组件和隐藏响应字段重新读取 token，并在缺少验证时聚焦到可见验证区，避免验证码组件已完成但页面仍提示未验证。
- 忘记密码页补入认证页白名单，避免残留会话检查把它当成普通用户页处理。
- 前后台入口注册 Service Worker 时使用版本化 `/sw.js?v=...` 并禁用更新缓存，避免边缘缓存返回旧 `sw.js` 导致旧 JS/CSS chunk 持续生效。

### 验证

- `pnpm --filter server exec tsx scripts/test-frontend-route-guards.ts`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm --filter server type-check`
- `pnpm test`
- `git diff --check`

## v1.2.8

- 发布提交 / Release commit: `7d166c288`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.8 auth and OTA cache hotfix


### 修复

- 注册页发送验证码按钮不再因为 Turnstile token 尚未生成而硬禁用；点击后继续走现有校验并给出人机验证提示，避免页面看起来“不能用”。
- Service Worker 静态资源改为网络优先并升级缓存名；新 worker 接管后自动刷新一次，降低 OTA 后旧 JS/CSS chunk 导致白屏、需要手动刷新才恢复的风险。

### 验证

- `pnpm --filter server type-check`
- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm test`
- `pnpm build`
- `git diff --check`

## v1.2.7

- 发布提交 / Release commit: `948db6ad1`
- 提交日期 / Commit date: 2026-07-01
- 提交说明 / Commit subject: Release v1.2.7 kawaii UI refresh


### 改进

- 发布 Product Design / kawaii-cloud 主题升级：公共首页、套餐市场、认证页、用户端、资源方页面和管理端共享浅色云朵主题、玻璃质感卡片和更一致的导航布局。
- 引入 Uiverse 风格的轻量动效，但保持为本地 CSS 实现：卡片 aurora 边框、按钮 glint 反馈、骨架屏流光和 loading 高亮都遵守 `prefers-reduced-motion`。
- 增加主题图片资产，用于首页和市场页的可爱 IDC 视觉表达，不新增运行时依赖。

### 验证

- `pnpm --filter client build:user`
- `pnpm --filter client build:admin`
- `pnpm test`
- `git diff --check`
- `UI_SCAN_RUN_ID=2026-07-01T02-27-00-uiverse-motion-final node .ui-scan/run-cdp-ui-scan.mjs`
- `DATABASE_URL=... JWT_SECRET=... COOKIE_SECRET=... ENCRYPTION_KEY=... RUN_RECHARGE_CALLBACK_SMOKE=false RUN_AGENT_HEARTBEAT_SMOKE=false RUN_AGENT_RELEASE_SMOKE=false pnpm smoke:split:nginx`

## v1.1.9

- 发布提交 / Release commit: `d0bb415af`
- 提交日期 / Commit date: 2026-06-29


### 修复

- `v1.0.0` 正式版公告重写为可发布版本，补齐 0.9.x 到 1.0.0 的生产稳定性、Agent 加固、支付回调策略、资源售罄判断和升级建议。

### 验证

- `pnpm --filter server type-check`

## v1.1.1

- 发布提交 / Release commit: `c3099ec50`
- 提交日期 / Commit date: 2026-06-29


### 修复

### 验证

## v1.0.9

- 发布提交 / Release commit: `7ef8a144e`
- 提交日期 / Commit date: 2026-06-29

### v1.0.9

- Fix registration retry after Turnstile-protected failures such as an incorrect invite code: the page now resets only the Cloudflare challenge token and keeps the filled registration form intact.

## v1.0.8

- 发布提交 / Release commit: `f41632471`
- 提交日期 / Commit date: 2026-06-29

### v1.0.8

- Fix create-instance Turnstile submission: the page now uses the visible verification widget token, falls back to Cloudflare's hidden response field, blocks locally when verification is missing, and localizes raw Turnstile backend errors.

## v1.0.7

- 发布提交 / Release commit: `a6c0838ce`
- 提交日期 / Commit date: 2026-06-29
- 提交说明 / Commit subject: Release v1.0.7 instance verification

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v1.0.3

- 发布提交 / Release commit: `a6b15797e`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.3 package delivery hotfix

Fix hosted package delivery guards and Incus certificate path resilience.

Packages can now be published or unpublished directly from the package list. The action only changes package visibility for new orders; existing instances and renewals keep their normal lifecycle.

Harden package host storage-pool persistence. When a package is active, bound hosts must resolve to an `instance_data` storage pool. Empty storage-pool selections now fall back to the host's preferred system disk pool, prioritizing `default`, and activation is blocked if no usable pool exists.

Fix stale Incus client certificate paths after OTA. If a host still references an old release directory and that certificate file no longer exists, Incus operations fall back to the stable panel certificate directory under `/opt/incudal/server/certs` or the configured panel certificate environment variables.

Restore the Germany `DEBGP` production package configuration by binding it back to the `default` system disk pool and publishing it again after confirming `DE-01` can list Incus storage pools.

## v1.0.2

- 发布提交 / Release commit: `02a9bec30`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.2 welfare check-in

Add daily points check-in to the Welfare center.

Users can now open the Check-in tab, claim one random points reward per Beijing calendar day, and see current points, reward range, streak, monthly count and recent records. The default reward range is 1-500 points.

Add admin controls for daily check-in. Operators can enable or disable check-in, set the random points range, optionally require users to own an instance before claiming, and review paginated check-in logs with username, date, points, streak, IP and timestamp.

Harden check-in accounting with a dedicated `daily_checkins` table, a unique `(user_id, date_key)` constraint, points ledger entries, and a per-user advisory lock so concurrent requests cannot double-claim the daily reward.

Keep the existing system redeem code and resource pool flows intact. The daily check-in reward itself now grants points instead of random resource-pool credits.

Update the customer instance cards with clearer LXC/KVM, IPv4 NAT/dedicated network and quota markers so the instance list matches the newer network delivery model.

## v1.0.1

- 发布提交 / Release commit: `0e5d04951`
- 提交日期 / Commit date: 2026-06-28
- 提交说明 / Commit subject: Release v1.0.1 network delivery

Add dedicated IPv4 and dedicated IPv4 + dedicated IPv6 delivery modes for hosted instances.

Plans can now use `public_ipv4` and `public_ipv4_ipv6`. New plan creation only exposes IPv4 NAT, IPv4 NAT + dedicated IPv6, dedicated IPv6, dedicated IPv4, and dedicated IPv4 + dedicated IPv6. Legacy `nat_ipv6_nat` and `ipv6_nat` values remain for existing data compatibility only and are not new plan targets.

Add host public IPv4 IPAM. Host owners and admins can create public IPv4 pools, add addresses, disable or re-enable free addresses, and delete unused addresses from the host detail page. Dedicated IPv4 capacity is checked during host selection, and instance creation reserves addresses with row locking to avoid concurrent double allocation.

Update Incus network payload generation so dedicated IPv4 instances use a routed `eth0` NIC on the host interface. Dual-stack dedicated IPv4 + IPv6 instances also receive the existing routed IPv6 NIC. NAT IPv4 modes continue to use the `incusbr0` bridge and remain the only modes that expose NAT port mappings.

Harden provisioning rollback for dedicated IPv4. User purchases, admin-created instances, host-owner created instances, async provisioning failures, and stuck `creating` timeout cleanup now release reserved public IPv4 addresses and compensate failed purchases consistently.

Update the host install script and hosting documentation so new nodes no longer present IPv6 NAT as a target capability. IPv6 delivery is documented as routed dedicated IPv6, while dedicated IPv4 requires a configured public IPv4 pool.

## v1.0.0

- 发布提交 / Release commit: `b2857f492`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update handoff for DEBGP closure

### PayIncus v1.0.0 正式版更新公告

### 正式版定位

v1.0.0 面向真实商业运营场景发布，目标是让面板具备稳定上线、可升级、可回滚、可审计、可排障的基础能力。

从 0.9.0 到 1.0.0，主要完成了这些能力收口：

- 在线升级链路加固，减少重复执行、重复 worker 和异常升级带来的不确定状态。
- 支付回调策略明确支持“无固定回调 IP，但强制验签、金额校验和幂等”的生产配置。
- 节点 Agent 加固，避免高频心跳、全量状态采集和日志刷屏对宿主机造成压力。

### 生产稳定性

- 修复 OTA worker 重复启动和重复处理任务的问题。
- 跳过重复任务时会正确关闭数据库连接，避免升级进程残留。
- 生产包内的 split auth smoke 修复，确保发布产物和线上验证脚本一致。
- Turnstile 开启时，split auth smoke 能识别人机验证保护状态，不再把正常防护误判为失败。
- 版本日志过滤 handoff 和日志同步类提交，减少发布记录噪音。

### 节点 Agent 加固

- Agent 默认心跳间隔调整为 60 秒，并设置 30 秒最低间隔，避免被错误配置成高频请求。
- Incus 实例状态采集只处理运行中的实例，减少对宿主机 CPU 的压力。
- 单次状态上报加入 500 实例上限和更低并发，避免节点规模较大时把宿主机打满。
- 心跳日志做节流，避免长期运行时日志无限写入导致磁盘压力。
- 生成的 `incudal-agent.service` 增加 CPU、内存、任务数量和 journal 写入限额。
- Agent 发布版本提升到 `v1.0.0`，面板可以向已有节点分发加固后的 Agent 二进制。

已有节点只升级 Agent 二进制还不够。要让 systemd 的 CPU、内存、任务和日志限额生效，需要在每台节点重新运行 Agent 安装脚本，刷新 systemd unit。

### 支付回调策略

- 新增明确的生产策略：当支付商没有固定回调出口 IP 时，可以设置 `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`。
- 该策略不等于跳过安全校验。回调仍必须通过签名验证、交易状态验证、金额匹配和 `payment_callbacks` 幂等记录。
- `PAYMENT_CALLBACK_SKIP_IP_WHITELIST=true` 仍属于跳过 IP 检查的高风险配置，文档已区分这两种模式。
- 生产 readiness 不再把“明确接受无固定回调 IP 策略”的配置误报为未解决风险。

### 资源与售罄判断

- 公开套餐售罄判断补齐磁盘容量，避免前台显示可购买、下单后创建失败。
- 生产 readiness 文档补充 CPU、内存和磁盘容量要求。
- 节点/套餐资源判断更接近真实交付链路，减少购买成功后资源不足的异常。

- 证据详情现在使用实体背景覆盖，不再透出底层风险列表。
- 证据快照、表格和 JSON 内容在浅色/深色模式下都保持可读。
- 后台资源风险页更适合运营人员直接查看实例风险、证据和处置记录。

### 部署与文档

- 运行路径、系统用户、systemd 服务名和发布产物名保持兼容，仍沿用 `/opt/incudal`、`incudal` 用户、`incudal-backend` 服务和现有 release artifact 命名，避免破坏已有线上环境。
- 中文和英文部署文档补充支付回调 IP 策略、Agent systemd 限额和生产检查说明。

### 升级建议

- 建议所有 0.9.x 用户升级到 v1.0.0。
- 升级后检查后台版本页、生产健康检查、支付回调配置和节点 Agent 状态。
- 每台宿主机建议重新运行 Agent 安装脚本，让 systemd 限额配置生效。
- 如果支付通道没有固定回调 IP，请使用明确策略 `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false`，不要使用跳过安全检查的临时绕过配置。

### 总结

## v0.9.9

- 发布提交 / Release commit: `085ff7896`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.9

Keep `/opt/incudal`, the `incudal` system user, the `incudal-backend` service name and release artifact names unchanged for runtime and OTA compatibility.

## v0.9.6

- 发布提交 / Release commit: `dd0816dc8`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.6

Fix public package sold-out detection to include disk capacity, keeping market availability aligned with backend instance creation checks.

## v0.9.4

- 发布提交 / Release commit: `cdb1386ca`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Close OTA worker database on skipped duplicate

### 其他变更 / Other Changes

- Close OTA worker database on skipped duplicate `cdb1386ca`

## v0.9.3

- 发布提交 / Release commit: `2b5aa5dac`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Guard OTA workers against duplicate starts

### 其他变更 / Other Changes

- Guard OTA workers against duplicate starts `2b5aa5dac`

## v0.9.2

- 发布提交 / Release commit: `804fb5270`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Handle Turnstile in split auth smoke

### 其他变更 / Other Changes

- Handle Turnstile in split auth smoke `804fb5270`

## v0.9.1

- 发布提交 / Release commit: `e46a425a7`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix split auth smoke in production artifacts

### 修复与稳定性 / Fixes and Stability

- Fix split auth smoke in production artifacts `e46a425a7`

## v0.9.0

- 发布提交 / Release commit: `6a619cfe2`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.0

## v0.8.9

- 发布提交 / Release commit: `857e892d0`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.9

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.8.8

- 发布提交 / Release commit: `5c03ca250`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.8

### 其他变更 / Other Changes

- Establish PayIncus project baseline `cddea0dc8`

## v0.8.7

- 发布提交 / Release commit: `d7830b694`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance plan upgrade capacity checks

### 修复与稳定性 / Fixes and Stability

- Fix instance plan upgrade capacity checks `d7830b694`

## v0.8.5

- 发布提交 / Release commit: `394e92c05`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden OTA Prisma client generation

### 修复与稳定性 / Fixes and Stability

- Harden OTA Prisma client generation `394e92c05`

## v0.8.3

- 发布提交 / Release commit: `576d1382e`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance bandwidth and billing nav display

### 修复与稳定性 / Fixes and Stability

- Fix instance bandwidth and billing nav display `576d1382e`

## v0.8.2

- 发布提交 / Release commit: `fe79137ec`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add package traffic reset pricing

### 新增能力 / New Capabilities

- Add package traffic reset pricing `fe79137ec`

## v0.8.1

- 发布提交 / Release commit: `8dfa597e7`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden storage readiness and traffic reset

### 修复与稳定性 / Fixes and Stability

- Harden storage readiness and traffic reset `8dfa597e7`

## v0.6.19

- 发布提交 / Release commit: `19ae72719`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance transfer path release guard

- 继续发布用户端实例产品卡片和创建实例自动命名能力。
- 修复实例卡片 PUSH 跳转的前后台构建边界，避免后台包包含用户端固定转让路径。
- 更新 route guard 以覆盖新的 transfersPath helper 形态。

## v0.6.18

- 发布提交 / Release commit: `d69254c73`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish instance cards and creation naming

- 用户端实例卡片改为产品信息卡样式，集中展示地区、节点、套餐、配置、网络、流量、价格、到期时间和自动续费。
- 实例卡片新增管理、PUSH、续费入口，并复用现有单实例续费/自动续费能力。
- 创建实例时自动生成安全实例名称，支持手动覆盖和重新生成；后端 API 在 name 缺省时也会兜底生成。
- 侧边栏分组标题增加翻译兜底，避免显示裸 key。

## v0.6.17

- 发布提交 / Release commit: `7c62431e9`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish UI structure and docs for v0.6.17

- Keep public market and help pages in the public site shell.
- Add collapsible user/admin sidebar groups.
- Improve help center search, links, and error states.
- Improve gift card user/admin UI safety, code masking, copy, and responsive layout.

## v0.6.16

- 发布提交 / Release commit: `8639b5a6e`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile body verification

#### Fixes and Stability / 修复与稳定性

- Move user gift card Turnstile verification from onRequest to preHandler so body turnstileToken is available.

- Keep authentication in onRequest and add guard coverage to prevent body-token verification regressions.

- Let the gift-card flow test check the active database schema for isolated test runs.

## v0.6.15

- 发布提交 / Release commit: `e67c9603f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Persist expired gift card state

### 其他变更 / Other Changes

- Persist expired gift card state `e67c9603f`

## v0.6.14

- 发布提交 / Release commit: `d0389797f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile token flow

### 修复与稳定性 / Fixes and Stability

- Fix gift card Turnstile token flow `d0389797f`

## v0.6.13

- 发布提交 / Release commit: `dae1a64c5`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix user gift card Turnstile verification

### 修复与稳定性 / Fixes and Stability

- Fix user gift card Turnstile verification `dae1a64c5`

## v0.6.12

- 发布提交 / Release commit: `2fcc75bfb`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix admin gift card generation Turnstile gate

### 修复与稳定性 / Fixes and Stability

- Fix admin gift card generation Turnstile gate `2fcc75bfb`

## v0.6.11

- 发布提交 / Release commit: `6b0bf1232`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add operations settings center

### 新增能力 / New Capabilities

- Add operations settings center `6b0bf1232`

## v0.6.10

- 发布提交 / Release commit: `1cb4f76b2`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add gift card center

#### New capabilities / 新增能力

- Add user gift card page for balance-funded gift card generation, redemption, and owned-card history.

- Add admin gift card center for single and batch generation, stats, redacted lists, enable, disable, and delete actions.

- Add GiftCard Prisma model and migration; OTA applies it through prisma migrate deploy.

#### Fixes and stability / 修复与稳定性

- Protect gift card balance flows with advisory locks, transaction-scoped balance deduction, self-redeem blocking, and one-time redeem claims.

- Restrict production gift card management with PAYINCUS_GIFT_CARD_ADMIN_IDS and mask codes by default.

- Localize and fix the OAuth Provider admin UI template.

## v0.6.9

- 发布提交 / Release commit: `85d952b53`
- 提交日期 / Commit date: 2026-06-26

- Trust the real docs-site host for market index and package downloads

- Keep market guard coverage aligned with the live docs domain

## v0.6.3

- 发布提交 / Release commit: `e42ee2b15`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查

### 修复与稳定性 / Fixes and Stability

- Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查 `e42ee2b15`

## v0.6.2

- 发布提交 / Release commit: `49f484ec3`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Force artifact OTA dependency install / 强制重建 OTA 制品依赖

### 其他变更 / Other Changes

- Force artifact OTA dependency install / 强制重建 OTA 制品依赖 `49f484ec3`

## v0.6.1

- 发布提交 / Release commit: `08ad73d59`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出

### 修复与稳定性 / Fixes and Stability

- Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出 `08ad73d59`

## v0.6.0

- 发布提交 / Release commit: `dd81058ff`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限

### 其他变更 / Other Changes

- Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限 `dd81058ff`

## v0.5.9

- 发布提交 / Release commit: `5738eb89e`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden artifact OTA install directory handling

### 修复与稳定性 / Fixes and Stability

- Harden artifact OTA install directory handling `5738eb89e`

## v0.5.8

- 发布提交 / Release commit: `e687afc70`
- 提交日期 / Commit date: 2026-06-25

### 其他变更 / Other Changes

- Document safe Lsky cleanup proof boundary `5cbf7d734`

## v0.5.7

- 发布提交 / Release commit: `921168bf4`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden online update runner environment

### 修复与稳定性 / Fixes and Stability

- Harden online update runner environment `921168bf4`

### 其他变更 / Other Changes

- Record latest Lsky proof access attempt `3178e60af`

## v0.5.6

- 发布提交 / Release commit: `ea1d4d812`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky production proof script

### 新增能力 / New Capabilities

- Add Lsky production proof script `ea1d4d812`

### 其他变更 / Other Changes

- Document Lsky cleanup blocker evidence `b41fec0a7`

## v0.5.5

- 发布提交 / Release commit: `f92545e7b`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Expose SMTP provider proof metadata

### 其他变更 / Other Changes

- Expose SMTP provider proof metadata `f92545e7b`

## v0.5.4

- 发布提交 / Release commit: `b3279626c`
- 提交日期 / Commit date: 2026-06-25

## v0.5.3

- 发布提交 / Release commit: `800036838`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add production DB restore drill proof

### 新增能力 / New Capabilities

- Add production DB restore drill proof `800036838`

## v0.5.2

- 发布提交 / Release commit: `e0a630fc0`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky delete diagnostics

Log non-sensitive Lsky delete status/body/error diagnostics and avoid treating provider status:false responses as successful cleanup.

## v0.5.1

- 发布提交 / Release commit: `498b824c2`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky v2 image deletion

Preserve numeric Lsky v2 photo IDs and delete images through the official batch /user/photos endpoint.

## v0.5.0

- 发布提交 / Release commit: `5fa3402a8`
- 提交日期 / Commit date: 2026-06-25

## v0.4.9

- 发布提交 / Release commit: `0854f27c1`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky upload cleanup identifier / 修复 Lsky 上传清理标识

Preserve Lsky pathname/path fallback provider IDs so uploaded ticket images can be cleaned up when provider responses omit id/key/hash.

## v0.3.7

- 发布提交 / Release commit: `266f52d55`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix admin benefits localization bundle / 修复后台福利本地化打包

#### 新增能力 / New Capabilities

- Added a release guard that checks all benefits translation keys used by the admin benefits page.
- 新增后台福利页 i18n key 发布守卫，覆盖页面使用的全部福利文案。

#### 改进与调整 / Improvements and Adjustments

- Keep the admin benefits translation namespace in the admin frontend bundle while continuing to strip admin-only benefits text from the customer bundle.
- 后台前端包保留福利管理所需文案，同时用户端包继续剔除后台福利管理文案。
- Prevent admin benefits pages from rendering raw translation keys such as entertainment.admin.title.
- 避免后台福利页显示 entertainment.admin.title 等原始翻译 key。

## v0.3.6

- 发布提交 / Release commit: `773843087`
- 提交日期 / Commit date: 2026-06-25

#### 新增能力 / New Capabilities

- 后台日志页新增风险审计概览，显示风险动作数量、本页高风险、需要审批和需要验证码的记录数。 / Added an audit summary to the admin logs page with risk catalog count, high-risk records, approval-required records, and verification-required records.

- 日志列表新增风险等级与风险说明，覆盖低、中、高、严重四级。 / Added risk level and risk title display to log rows with low, medium, high, and critical levels.

- 新增管理员审计 CSV 导出，单次最多 1000 条，并记录 audit.export 操作日志。 / Added admin-only audit CSV export capped at 1000 rows and recorded as an audit.export operation log.

#### 改进与调整 / Improvements and Adjustments

- 日志接口返回前脱敏用户名、邮箱、IP、token 和 JWT 类内容。 / Redacted usernames, emails, IP addresses, tokens, and JWT-like values before returning log data.

- 根目录全量测试纳入 risk-audit 守卫。 / Included the risk-audit guard in the root full test command.

- 更新中英文后台文档和商业运营目标进度。 / Updated Chinese and English admin docs plus commercial operation progress notes.

## v0.3.5

- 发布提交 / Release commit: `7e9f95a8c`
- 提交日期 / Commit date: 2026-06-25


#### 改进与调整 / Improvements

- Fix benefits admin localization fallback and missing English keys.

## v0.3.1

- 发布提交 / Release commit: `51be2d4ac`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add customer success ticket workspace / 新增客服成功工单工作台

### 新增能力 / New Capabilities

- Add customer success ticket workspace / 新增客服成功工单工作台 `51be2d4ac`

## v0.2.8

- 发布提交 / Release commit: `7e8a29e43`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add financial reconciliation workflow / 新增财务对账闭环

### 新增能力 / New Capabilities

- Add financial reconciliation workflow / 新增财务对账闭环 `7e8a29e43`

## v0.2.7

- 发布提交 / Release commit: `7f6f66e29`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order payment operations workflow / 新增订单支付运营闭环

#### 新增能力 / New capabilities

- Add admin order operation cases with dispute states: pending review, confirmed, compensated and closed.
- Add manual refund registration that creates balance-adjustment approval requests without directly changing user balances.
- 新增人工退款登记，只创建调账审批，不直接修改用户余额。
- Add redacted provider status summaries and extended order search by keyword and date range.
- 新增脱敏 provider 状态摘要，并扩展订单号、交易号、用户和时间范围搜索。

#### 改进与调整 / Improvements and adjustments

- Link order operation records to adjustment approvals and balance logs after approval.
- 订单运营处理记录可关联调账审批，审批通过后继续关联余额流水。
- Update admin billing documentation in Chinese and English.
- 更新中英文后台与支付账务文档。

#### 验证 / Verification

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

- 发布提交 / Release commit: `0f327fe1f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add commercial operations overview / 新增商业运营总览

#### New capabilities / 新增能力

- Add admin commercial operations overview for revenue, orders, users, instances, delivery, infrastructure, support, and risk alerts.
- 新增后台商业运营总览，覆盖收入、订单、用户、实例、交付、基础设施、支持与风险提醒。

#### Other changes / 其他变更

- Update admin documentation for the operations overview.
- 更新后台文档，说明运营总览指标与边界。

#### Improvements and adjustments / 改进与调整

- Add commercial operations overview guard and include it in pnpm test.
- 新增商业运营总览守卫，并纳入 pnpm test。

## v0.2.5

- 发布提交 / Release commit: `1c3b63086`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Harden OTA cleanup and disk preflight / 加固 OTA 清理与磁盘预检

#### 新增能力 / New capabilities

- Add OTA download-cache cleanup before and after update tasks.
- Add disk-space preflight with actionable Chinese failure guidance.
- Add atomic release pruning with protected current and rollback targets.

#### 改进与调整 / Improvements and adjustments

- Preserve .incudal-update-downloads during legacy artifact application until cleanup finishes.
- Document OTA retention environment variables in Chinese and English.

#### 其他变更 / Other changes

- Extend system update guard coverage for cleanup, preflight and release pruning.

## v0.2.4

- 发布提交 / Release commit: `12bcebeb2`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add balance adjustment approval / 新增调账审批流

### 新增能力 / New Capabilities

- Add balance adjustment approval / 新增调账审批流 `12bcebeb2`

## v0.2.3

- 发布提交 / Release commit: `9d03a7b6c`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order exception handling / 新增订单异常处理

### 新增能力 / New Capabilities

- Add order exception handling / 新增订单异常处理 `9d03a7b6c`

## v0.2.2

- 发布提交 / Release commit: `2311b2442`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add unified order center / 新增统一订单中心

### 新增能力 / New Capabilities

- Add unified order center / 新增统一订单中心 `2311b2442`
- Revert "Add demo login and read-only safeguards / 新增演示登录与只读保护" `bf96cde42`
- Add demo login and read-only safeguards / 新增演示登录与只读保护 `7be458969`

### 其他变更 / Other Changes

- Separate demo docs from production guides / 区分演示文档与生产指南 `4978cf845`

## v0.2.1

- 发布提交 / Release commit: `815dd2f73`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Allow installer to set initial admin email / 允许安装器设置初始管理员邮箱

#### 新增能力 / New Capabilities

- 一键安装脚本支持设置初始管理员邮箱。
- One-click installer now supports setting the initial admin email.

#### 改进与调整 / Improvements and Adjustments

- 默认管理员初始化改为读取 ADMIN_EMAIL，兼容 ADMIN_INITIAL_EMAIL。
- Default admin initialization now reads ADMIN_EMAIL and remains compatible with ADMIN_INITIAL_EMAIL.
- 环境示例和中英文部署文档补充 ADMIN_EMAIL。
- Environment examples and Chinese/English deployment docs now include ADMIN_EMAIL.

#### 其他变更 / Other Changes

- 增加安装器和数据库初始化守卫测试，防止管理员邮箱再次硬编码。
- Added installer and database initialization guards to prevent hardcoded admin email regressions.

## v0.2.0

- 发布提交 / Release commit: `dd9e8e395`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix installer static asset permissions / 修复安装器静态资源权限

#### 修复与稳定性 / Fixes and stability

- Keep the install root traversable for Nginx so one-click installs can serve frontend static assets.
- 保持安装根目录可被 Nginx 穿透，确保一键安装后可正常提供前端静态资源。

#### 改进与调整 / Improvements and adjustments

- Preserve owner-only permissions for .env after install and upgrade permission repair.
- Add split deployment guard coverage for installer static asset permissions.

## v0.1.9

- 发布提交 / Release commit: `9649f3c9b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Ensure installer enables pnpm / 确保安装脚本启用 pnpm

#### 修复与稳定性 / Fixes and stability

- Ensure the one-click production installer enables pnpm before Prisma migrations and systemd startup.
- 确保一键生产安装脚本在 Prisma 迁移和 systemd 启动前启用 pnpm。

#### 改进与调整 / Improvements and adjustments

- Pin pnpm 9.14.2 in the installer and keep a Corepack-first, npm-fallback bootstrap path.
- 在安装脚本中固定 pnpm 9.14.2，并保留 Corepack 优先、npm 兜底的初始化路径。
- Extend split deployment guards to prevent clean-server installer regressions.
- 扩展前后台分离部署守卫，防止干净服务器安装路径回退。

## v0.1.7

- 发布提交 / Release commit: `ba7a6eed2`
- 提交日期 / Commit date: 2026-06-24


#### 其他变更 / Other changes

- 实例任务失败、超时清理和启动清理僵尸任务时，会记录中文失败日志并触发用户失败通知。

- Instance task failures, timeout cleanup, and startup stale-task cleanup now write Chinese failure logs and send user failure notifications.

## v0.1.6

- 发布提交 / Release commit: `3bfdfe5ac`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix admin instance detail loading / 修复后台实例详情加载

### 修复与稳定性 / Fixes and Stability

- Fix admin instance detail loading / 修复后台实例详情加载 `3bfdfe5ac`

## v0.1.5

- 发布提交 / Release commit: `33d1afc9f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Localize operation logs in Chinese / 日志内容中文化

### 其他变更 / Other Changes

- Localize operation logs in Chinese / 日志内容中文化 `33d1afc9f`

## v0.1.4

- 发布提交 / Release commit: `653d3a51b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定

### 其他变更 / Other Changes

- Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定 `653d3a51b`

## v0.1.3

- 发布提交 / Release commit: `b9857686a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix instance detail bandwidth rendering / 修复实例详情带宽渲染

### 修复与稳定性 / Fixes and Stability

- Fix instance detail bandwidth rendering / 修复实例详情带宽渲染 `b9857686a`

## v0.1.2

- 发布提交 / Release commit: `104c6c0c5`
- 提交日期 / Commit date: 2026-06-24

#### New capabilities / 新增能力

- Admin users can view latest release metadata while update execution remains super-admin only.

- 后台管理员可查看最新 release 信息，实际更新执行仍仅限超级管理员。

## v0.1.1

- 发布提交 / Release commit: `4fb35c487`
- 提交日期 / Commit date: 2026-06-24


#### 其他变更 / Other Changes

- 版本更新页在未发现新版本时持续展示当前/latest 版本信息，并将主按钮显示为已更新至最新版本。

- The system update page keeps latest/current version details visible when no newer release exists and marks the primary action as already up to date.

#### 改进与调整 / Improvements and Adjustments

- 安装任务日志和市场页面布局改为更清晰的后台工作区，减少页面撑高和信息挤压。

- Install logs and market layout now use clearer admin workspace spacing to reduce page overflow and crowded content.

## v0.1.0

- 发布提交 / Release commit: `e4f9f8a17`
- 提交日期 / Commit date: 2026-06-24

### 其他变更 / Other Changes

- Document bilingual versioning and OTA cadence rules `81fce60d0`

## v0.0.21

- 发布提交 / Release commit: `6a4ebdb1b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix production OTA CLI start command

### 修复与稳定性 / Fixes and Stability

- Fix production OTA CLI start command `6a4ebdb1b`

## v0.0.20

- 发布提交 / Release commit: `6b99a47f2`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Update version log for static root fix

### 修复与稳定性 / Fixes and Stability

- Fix production split static roots `9cb0ae0c2`

## v0.0.19

- 发布提交 / Release commit: `d8195460b`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix storage pool defaults and error guidance

### 修复与稳定性 / Fixes and Stability

- Fix storage pool defaults and error guidance `d8195460b`

## v0.0.18

- 发布提交 / Release commit: `43b9807ed`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent binary installer cache query

### 修复与稳定性 / Fixes and Stability

- Fix Agent binary installer cache query `43b9807ed`

## v0.0.17

- 发布提交 / Release commit: `71bb4ca70`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent installer manifest parsing

### 修复与稳定性 / Fixes and Stability

- Fix Agent installer manifest parsing `71bb4ca70`

## v0.0.16

- 发布提交 / Release commit: `0a75877a6`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Refresh host panel trust certificate

### 其他变更 / Other Changes

- Refresh host panel trust certificate `0a75877a6`

## v0.0.15

- 发布提交 / Release commit: `71e2af87c`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix atomic OTA install root detection

### 修复与稳定性 / Fixes and Stability

- Fix atomic OTA install root detection `71e2af87c`

## v0.0.14

- 发布提交 / Release commit: `3833c6f79`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Clarify Debian host install support

### 新增能力 / New Capabilities

- Clarify Debian host install support `3833c6f79`

## v0.0.13

- 发布提交 / Release commit: `f9f6cdb7c`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Update version log for HSTS hardening

- Add HSTS to split Nginx templates and installer-generated static frontend blocks.

- Guard HSTS in split deployment and security header checks.

- Document the public Strict-Transport-Security production requirement.

## v0.0.12

- 发布提交 / Release commit: `e44a5d7ce`
- 提交日期 / Commit date: 2026-06-23

### 修复与稳定性 / Fixes and Stability

- Fix GitHub Pages docs workflow `5e0a9a0fa`

### 其他变更 / Other Changes

- Deploy docs site with GitHub Pages `e041db36e`

### 新增能力 / New Capabilities

- Add bilingual PayIncus documentation site `0c8682741`

### 改进与调整 / Improvements and Adjustments

- Update split deployment docs `54368bf10`
- Update README with OTA and community links `ae5617118`

## v0.0.11

- 发布提交 / Release commit: `eae342d77`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.10

- 发布提交 / Release commit: `eae342d77`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

### 新增能力 / New Capabilities

- Support atomic OTA release layout `eae342d77`

## v0.0.9

- 发布提交 / Release commit: `2af166460`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Auto rollback failed online updates

### 修复与稳定性 / Fixes and Stability

- Auto rollback failed online updates `2af166460`

## v0.0.8

- 发布提交 / Release commit: `39140db7a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.7

- 发布提交 / Release commit: `39140db7a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

### 改进与调整 / Improvements and Adjustments

- Prefer verified OTA artifacts for online updates `39140db7a`

## v0.0.6

- 发布提交 / Release commit: `c6342d950`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Stabilize OTA restart verification

### 修复与稳定性 / Fixes and Stability

- Stabilize OTA restart verification `c6342d950`

## v0.0.5

- 发布提交 / Release commit: `8c633c68f`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix OTA manifest release workflow checkout

### 修复与稳定性 / Fixes and Stability

- Fix OTA manifest release workflow checkout `8c633c68f`

## v0.0.4

- 发布提交 / Release commit: `55fdd4abd`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Add OTA release manifest metadata

### 新增能力 / New Capabilities

- Add OTA release manifest metadata `55fdd4abd`

## v0.0.3

- 发布提交 / Release commit: `9ad38dde4`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make OTA worker tolerate production git ownership

### 修复与稳定性 / Fixes and Stability

- Make OTA worker tolerate production git ownership `9ad38dde4`

## v0.0.2

- 发布提交 / Release commit: `cb1f45b96`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make online updates asynchronous and build-ready

### 改进与调整 / Improvements and Adjustments

- Make online updates asynchronous and build-ready `cb1f45b96`

## v0.0.1

- 发布提交 / Release commit: `dcd968d20`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Allow online update worker sudo under systemd

### 新增能力 / New Capabilities

- Allow online update worker sudo under systemd `dcd968d20`

### 改进与调整 / Improvements and Adjustments

- Prepare v0.0.1 online update baseline `c7b223d93`
- Make release installs reproducible `deea26349`
- Update Agent release repository default `51bf5ff43`
- Rewrite PayIncus README `c1f237e0e`
- Update payincus deployment checks `7979d9dda`
- Update README.md `f971ad5f0`
- Prepare host deployment package `09d96b11b`

### 修复与稳定性 / Fixes and Stability

- Harden release production verification `c31d5ba79`

### 其他变更 / Other Changes

- first commit `cb4a866db`

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
