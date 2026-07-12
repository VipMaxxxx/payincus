# PayIncus 全面修缮方案（MAINTENANCE_PLAN.md）

> 配套规矩见 `AGENTS.md`（硬规矩/守卫纪律/完成定义全部适用）。
> 本文件 = 模块编号总表 + 修缮流程 + 缺陷台账入口。Claude Code 与 codex 共同以此为作战地图。
> 状态标记：`⬜未开始 / 🔍审计中 / 🛠修复中 / ✅已验收 / ⏸挂起`

---

## 一、模块拆分总表（27 个模块，按风险分档）

### 🔴 A 档 —— 高危路径（AGENTS.md §2.3：先读代码+守卫再动手；Claude 定根因/收规格，codex 只做收紧后的实现）

| 编号 | 模块 | 主要代码落点 | 状态 |
|------|------|--------------|------|
| M01 | 认证与会话 | `server/routes/auth.ts` `verification.ts` `oauth.ts` `oauth-provider.ts`；`lib/cookie-config.ts` `operation-verification.ts`；`client/views/LoginView` `RegisterView` `ForgotPasswordView` `OAuthAuthorizeView` | ⬜ |
| M02 | 用户与权限 | `routes/users.ts` `user-lifecycle.ts`；`lib/permission.ts` `demo-safety.ts`；`admin/UsersView` `UserLifecycleView` `ProfileView` | ⬜ |
| M03 | 支付与充值 | `routes/recharge.ts` `balance.ts`；`lib/antom.ts` `epay.ts` `heleket.ts` `outbound-security.ts`；`admin/PaymentProvidersView`；`client/views/WalletView`(充值段) | ⬜ |
| M04 | 订单与计费 | `routes/orders.ts` `instance-billing.ts` `admin-billing.ts`；`lib/billing-calc.ts`；`services/billing-scheduler.ts`；`OrdersView`(双端) `admin/BillingView` | ⬜ |
| M05 | 实例生命周期 | `routes/instances.ts` `instance-destroy.ts` `snapshots.ts` `backups.ts`；`lib/incus*` `instance-swap.ts` `instance-network-sync.ts`；`workers/instanceTaskWorker` `backupUploadWorker` `restoreTaskWorker`；`InstancesView` `InstanceDetailView` `InstanceCreateView` | ⬜ |
| M06 | 资源交付与资源池 | `routes/resource-pool.ts`；`lib/managed-instance-provision.ts`；`admin/DeliveryCenterView`（admin-delivery） | ⬜ |
| M07 | 主机与 Go Agent | `routes/hosts.ts` `agent.ts`；`lib/agent-auth.ts` `host-agent-credentials.ts`；`services/agent-instance-report.ts` `host-address-monitor.ts`；`agent/`(Go) | ⬜ |
| M08 | 钱包/转账/兑换 | `routes/transfers.ts` `exchange.ts` `admin-exchange.ts`；`services/exchange*.ts`；`workers/exchangeDeliveryWorker`；`TransfersView` `ExchangeView` `admin/ExchangeManageView` | ⬜ |
| M09 | 风控 | `routes/resource-risk.ts`；`services/resource-risk.ts` `user-order-restrictions.ts`；`lib/geoip.ts`；`admin/ResourceRiskView` | ⬜ |
| M10 | 系统配置与 OTA | `routes/system-config.ts` `system-update.ts`；`scripts/apply-online-update.sh` 等；`deploy/`；`admin/SystemConfigView` `SystemUpdateView` `ProductionProofView` | ⬜ |

### 🟡 B 档 —— 中危（业务逻辑但爆炸半径可控；codex 可端到端修，Claude 审查）

| 编号 | 模块 | 主要代码落点 | 状态 |
|------|------|--------------|------|
| M11 | 套餐与商城 | `routes/packages.ts`；`MarketView` `PortalView`(套餐段)；plan/capacity 守卫群 | ⬜ |
| M12 | 秒杀/礼品卡/兑换码 | `routes/flash-sales.ts` `gift-cards.ts` `redeem-codes.ts`；`services/flash-sales.ts`；对应双端 View | ⬜ |
| M13 | 网络/IP/流量 | `routes/ip-addresses.ts` `traffic.ts` `proxy-sites.ts`；`lib/ip-calculator` `network-*` `caddy-client`；`services/traffic-*` `instance-traffic-collector` | ⬜ |
| M14 | Web 终端 | `routes/terminal.ts` `terminal-saved-commands.ts`；`lib/terminal-proxy.ts`；`TerminalView` `useTerminal` `terminal-core`（xterm 6） | ⬜ |
| M15 | 邀请/返利/好友 | `routes/aff.ts` `user-invites.ts` `friends.ts`；`lib/invite-pricing.ts`；`InvitesView` `FriendsView` `admin/AffReviewView` | ⬜ |
| M16 | 游戏化(签到/抽奖/VIP) | `routes/entertainment.ts` `checkin.ts` `vip-levels.ts` `vip-benefits.ts`；`lib/lottery-notifier`；`EntertainmentView`(双端) | ⬜ |
| M17 | 工单与 AI 客服 | `routes/tickets.ts`；`services/ai-ticket-*` `ticket-auto-close-scheduler`；`lib/action-ticket` `lsky.ts`(图床)；`TicketsView` | ⬜ |
| M18 | 通知/邮件/TG/站内信 | `routes/notifications.ts` `inbox.ts` `telegram.ts` `announcements.ts`；`lib/mailer` `notifier`；`workers/hostNotificationEmailWorker`；`InboxView` `admin/BroadcastView` `TelegramConfigView` 通知渠道 | ⬜ |
| M19 | 邮箱托管业务 | `routes/mail.ts`；`services/cranemail` `smartermail` `mail-expiry-scheduler`；`MailView` `MailDomainView` `admin/AdminMailView` | ⬜ |
| M20 | Hosting 托管业务 | `routes/hosting.ts` `admin-hosting.ts`；`services/hosting-scheduler`；`lib/hosting-access`；`HostingWalletView` `admin/HostingView` | ⬜ |
| M21 | 插件平台 | `routes/plugins.ts` `admin-plugins.ts` `plugin-market-submissions.ts`；`lib/plugin-*`；`services/plugin-*`；`plugin-templates/`；`ExtensionsView` `PluginPageView` `admin/PluginCenterView` | ⬜ |
| M22 | 主题平台 | `routes/themes.ts` `admin-themes.ts` `theme-market-submissions.ts`；`theme-templates/` | ⬜ |
| M23 | Public API & SDK | `routes/public-api.ts` `api-tokens.ts`；openapi/sdk 守卫群 | ⬜ |
| M24 | 管理端运营台 | `routes/admin-statistics.ts` `admin-capacity-cost.ts` `admin-sla-alerts.ts` `admin-integrations.ts` `batch-config.ts`；`services/system-monitor` `auto-policy-scheduler`；对应 admin View | ⬜ |
| M25 | 日志/审计/安全基线 | `routes/logs.ts`；`lib/log-sanitizer` `log-localization` `instance-audit` `errors.ts` `http-response.ts`；security-headers/cors/trust-proxy 守卫群；`LogsView` | ⬜ |

### 🟢 C 档 —— 低危（样式/文档/基建外围；codex 主力，快审）

| 编号 | 模块 | 主要代码落点 | 状态 |
|------|------|--------------|------|
| M26 | 前端基座与 UI 层 | `client/router` `stores` `api` `locales` `styles`(kawaii-cloud/token 层) SW/PWA；门面页(Portal/Market/Auth/Help)；UI 单色重做延续（约束见 AGENTS.md §6） | ⬜ |
| M27 | 文档站与运维脚本外围 | `docs-site/`；`scripts/` 中非 OTA 的安装/校验脚本 | ⬜ |

> 注：SSH keys、镜像(images)、存储配置(storage-configs)、自定义 init 命令等小路由按就近原则挂靠：镜像→M05，存储→M05(备份)，ssh-keys→M05，custom-init-commands→M05，storage-configs→M05，images→M05。

---

## 二、修缮流程（四阶段）

### P0 建立基线（先做，半天）
在**改任何代码之前**，先量出「现在什么是红的」：
1. `pnpm --filter client type-check` + `pnpm --filter server type-check`
2. `pnpm test`（全量守卫，慢）
3. `pnpm build`（双端 + dist 边界）+ `pnpm lint`
4. 产出 **基线报告**：哪些本来就红（历史欠账）/ 哪些绿。之后所有修复以「不把绿的改红」为铁律。

### P1 缺陷收集与分诊（与 P0 并行启动）
双通道收集，汇入统一台账 `DEFECTS.md`（编号 D-001…，每条挂模块号）：
- **通道①（最高优先）owner 提供的真实用户报错**：反馈原文/截图/生产日志。→ 这是排序依据的第一来源。
- **通道② 地毯式代码审计**：按模块派 codex 审计（只读模式 `--sandbox read-only`），每模块产出「疑似缺陷清单+证据」；Claude 复核定级（P0 致命 / P1 严重 / P2 一般 / P3 优化）。

### P2 分波修复（核心阶段）
- **波次制**：每波 3~5 个模块，波内串行改文件、跨模块可并行（互不相交才并行）。
- **排序原则**：用户报错命中的模块最先 → 高危档已确认缺陷 → 中危 → 低危打磨。
- **分工**（AGENTS.md §7）：
  - A 档：Claude 定根因 + 写收紧规格 → codex 实现 → Claude 逐行审 + 跑守卫 + 真机验证
  - B 档：codex 端到端诊断+修复 → Claude 审查 + 守卫
  - C 档：codex 主力，Claude 快审
- 每条修复必须满足 AGENTS.md §8 完成定义（type-check/守卫/双端 build/真机/报告）。

### P3 回归与验收
- 每波收尾：全量 `pnpm test` + `pnpm build` + 受影响流程真机回归。
- 全部完成：完整回归 + `DEFECTS.md` 结账（每条缺陷有「根因/修法/验证证据」）。
- **commit / 发版 / OTA 一律等 owner 明确指令**，按 `OPERATIONS_HANDOFF.md` 的发版纪律走。

---

## 三、护栏（重申，违者返工）
1. 修复期**不做大重构**——只修缺陷本身。
2. 表格布局守卫清单内的表**绝不**改横向滚动（AGENTS.md §4）。
3. UI 改动只动样式/文案层级，功能 100% 不变（AGENTS.md §6）。
4. 不 commit / 不 push / 不发版 / 不碰生产，除非 owner 明说。
5. 工作区永远保持可构建：每完成一条缺陷即跑相关守卫，不攒大 diff。

---

## 四、当前进度
- [x] 模块拆分与编号（本文件）
- [ ] P0 基线报告
- [ ] `DEFECTS.md` 台账建立（等 owner 报错输入 + 首轮审计）
- [ ] P2 第一波
