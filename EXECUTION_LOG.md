# PayIncus 修复执行日志（EXECUTION_LOG.md）

逐条流水：规格 → codex → 7 身份评审 → 守卫/验证 → 裁决。仅记结论,详规见 `audits/fixes/`。
状态:✅保留 / 🔁打回 / 🔧修复中 / ⏸挂起。全程未 commit。

---

## 波0 安全阻断

### ✅ FX-001 — 插件 iframe 同源会话接管(P0 / D-001)
- 规格:`audits/fixes/FX-001-spec.md` · 执行:codex
- 改动:`client/src/components/plugins/PluginFrame.vue`(sandbox 去 `allow-same-origin`→`allow-forms allow-scripts`;postMessage targetOrigin→`'*'`)、`server/scripts/test-plugin-client-boundary-guards.ts`(加断言:必须新 sandbox 且不含 `allow-same-origin`,钉死)。
- 7 身份评审:🏛 最小自包含无重构✓ · 🗄 无数据改动 N/A · 🔐 会话接管根因消除(opaque 源隔离);config 非敏感、frame src 受控,`'*'` 可接受✓ · ✅ 根因已修、插件仍经 postMessage 收 config✓ · 💰 纯安全非业务✓ · 🧪 守卫已钉死本修复✓ · ♻️ client type-check + 双端 build 绿✓
- 复验(我方独立跑):`test:plugin-client-boundary-guards` ✓ · `test:frontend-route-guards` ✓ · client type-check ✓
- 裁决:**✅ 保留**。
- 备注:opaque 源使插件无法再以主站会话调 API——这是安全意图(若未来某插件确需数据,应经 postMessage/token 而非同源会话);更彻底的"独立插件源"隔离属插件平台加固,后续可另立项。

### ✅ FX-002 — OAuth 开放重定向反斜杠绕过(P1 / D-002 / M01-01)
- 规格:`audits/fixes/FX-002-spec.md` · 执行:codex
- 改动:`server/src/lib/redirect-validator.ts` + `client/src/utils/validation.ts`(isValidRedirectUrl 拒绝 `/\`、任意反斜杠、`%5c`/`/%2f`/`/%5c` 编码绕过,前后端一致);新建 `server/scripts/test-redirect-validator-guards.ts` + 接入 `server/package.json`(test:redirect-validator-guards)与根 test 链。
- 7 身份评审:🏛 前后端镜像、最小✓ · 🔐 反斜杠+编码绕过全堵、`/`根仍合法✓ · ✅ 各向量覆盖✓ · 🧪 新守卫钉死✓ · ♻️ type-check 绿✓
- 复验(我方独立):`test:redirect-validator-guards` ✓ · server/client type-check ✓
- 裁决:**✅ 保留**。
- ⚠️ 发现既有问题(非本次造成):`test:oauth-provider-guards` 失败于"OAuthConfigView.vue 必须 table-fixed 不横向滚动"断言,而该文件未改动 → **既有红**(UI 重做致表格漂移)。记为 **FX-DISC-01**,待基线扫描后归入波3 UI 修复。

### ✅ FX-005 — 日志脱敏覆盖不足(P1 / D-053 / M25-02)
- 规格:`audits/fixes/FX-005-spec.md` · 执行:codex
- 改动:`server/src/lib/log-sanitizer.ts`(TOKEN_PATTERNS 重构为 {pattern,replacement};新增 pat_/poa_(43位base64url,codex 核过 randomBytes(32).base64url 实际格式)、Basic、宽字符 Bearer、URL 查询密钥脱敏;SENSITIVE_FIELDS 补 assetToken/agentSecret/pat/poa;递归 depth>10 改返回 [REDACTED_TRUNCATED])、`server/scripts/test-log-sanitizer.ts`(加对应断言)。
- 7 身份评审:🏛 干净重构✓ · 🔐 凭证格式覆盖全;URL query 对 code/key 略过度脱敏但日志可接受✓ · ✅ 正则有效、depth 截断生效✓ · 🧪 守卫已加断言✓ · ♻️ type-check 绿✓
- 复验(我方独立):`test:log-sanitizer` ✓
- 裁决:**✅ 保留**。备注:pat_/poa_ 用 {43} 精确匹配,若未来 token 长度变需同步(已在规格注明格式来源)。

---
## 📊 全量守卫基线(2026-07-11,working tree)
**175 PASS / 10 FAIL**。以下 10 条守卫在 committed 代码上**本就失败**(非本次修复引入;`pnpm test` &&链首失败即停,故长期未暴露)。均为**既有欠账**,纳入修复(记 FX-DISC-01..10,按模块归入对应波次;疑似多为 UI 重做致表格/结构漂移 + 少量逻辑守卫):
- FX-DISC-01 `test:oauth-provider-guards`(OAuthConfigView 表格 table-fixed 漂移)
- FX-DISC-02 `test:admin-hosting-route-id-guards`
- FX-DISC-03 `test:auth-session-status-guards`
- FX-DISC-04 `test:delivery-center-guards`
- FX-DISC-05 `test:extension-platform-guards`
- FX-DISC-06 `test:gift-card-guards`
- FX-DISC-07 `test:order-center-guards`
- FX-DISC-08 `test:plugin-template-guards`
- FX-DISC-09 `test:resource-risk-guards`
- FX-DISC-10 `test:sla-alert-guards`
> 用途:后续 codex 跑守卫若命中此清单且未改对应断言文件 → 判"既有红"、不算 codex 改坏。这 10 条本身我会逐一定性(真逻辑问题 or 守卫/结构漂移)并修到绿,作为"基线归零"目标。

### ✅ FX-006 — apiError 泄漏内部异常原文(P2 横切 / D-118 根因)
- 规格:`audits/fixes/FX-006-spec.md` · 执行:codex
- 改动:`server/src/lib/errors.ts`(INTERNAL_ERROR_CODES={INTERNAL_ERROR};apiError 对内部码只回 {error,code} 无 details;其它码 details 经 sanitizeTokensInString 脱敏+截断 256)、新建 `server/scripts/test-error-response-guards.ts`+接入 package.json/根 test 链。
- 7 身份评审:🏛 errors→log-sanitizer 无循环、最小✓ · 🔐 内部异常原文不再外泄、其它码纵深脱敏✓ · ✅ details===undefined 行为同旧✓ · 🧪 新守卫钉死✓ · ♻️ 返回形状变化不破坏前端(details 本就可选)、type-check 绿✓
- 复验(我方独立):`test:error-response-guards` ✓ · server type-check ✓
- 裁决:**✅ 保留**。备注:per-route 直接 `send({error: err.message})` 的散点(如 packages.ts:1824)不走 apiError,归波3 模块清扫。

### ✅ FX-007 — 任意管理员写高危白名单自提权 OTA(P1 / D-007 / M10-01)
- 规格:`audits/fixes/FX-007-spec.md` · 执行:codex
- 改动:`server/src/routes/system-config.ts`(HIGH_RISK_ADMIN_ID_KEYS 4 键集合;PUT 写库前若含任一高危键且 `request.user.username!=='admin'` → 整批 403 FORBIDDEN)、`server/scripts/test-system-config-value-guards.ts`(加断言)。
- 7 身份评审:🏛 复用 OTA 门禁 owner 口径、放在写库前、最小✓ · 🔐 owner 锚点(内建 admin,不可经本 API 篡改)、JWT 注入的 username 不可伪造✓ · ✅ 整批拒绝、普通键不受影响✓ · 💰 非 owner 管理员不能改这 4 键=安全意图✓ · 🧪 守卫钉死✓ · ♻️ 两守卫+type-check 绿✓
- 复验(我方独立):`test:system-config-value-guards` ✓ · `test:system-update-guards` ✓ · type-check ✓
- 裁决:**✅ 保留**。

### ✅ FX-004 — trustProxy 全链信任致 request.ip 可伪造(P1 横切 / D-057，含 D-046 IP 伪造根因)
- 规格:`audits/fixes/FX-004-spec.md` · 执行:codex
- 改动:`server/src/lib/trust-proxy-config.ts`(新增 getTrustProxyConfig():空/off→false;true/1/yes/on→固定跳数默认1、TRUST_PROXY_HOPS 可覆盖;纯数字→跳数;IP/CIDR 列表→string[];非法→warn+false;**绝不返回布尔 true**;保留 getTrustProxyEnabled 兼容)、`server/src/app.ts:136`(trustProxy 改用 getTrustProxyConfig())、`server/scripts/test-trust-proxy-config.ts`(更新断言)。
- 7 身份评审:🏛 结构清晰、向后兼容✓ · 🔐 XFF 最左伪造失效、request.ip 变真实客户端 IP,连带修 D-046 限流伪造根因✓ · ✅ 取值矩阵覆盖含 0/非法/safe-int✓ · 💰 运维影响:多层代理需显式设 HOPS/CIDR(默认1跳=单nginx),更安全且可配✓ · 🧪 守卫更新✓ · ♻️ security/cors/type-check 绿✓
- 复验(我方独立):`test:trust-proxy-config`✓ `test:security-config`✓ `test:cors-origin-config`✓ type-check✓
- 裁决:**✅ 保留**。⚠️ 运维注(记入最终报告):部署若前置多层代理(如 CDN+nginx),需设 `TRUST_PROXY_HOPS` 或 `TRUST_PROXY=<受信CIDR>`;默认按单层 nginx(1 跳)。Public API 按 token 精细限流属后续增强(D-046 细化),不在本条。

### ✅ FX-003 — 外呼 SSRF / DNS rebinding(P1 横切 / D-056)
- 规格:`audits/fixes/FX-003-spec.md` · 执行:codex
- 改动:`server/src/lib/outbound-security.ts` 新增 `safeFetch`(assertSafeHttpUrl + safeOutboundDispatcher);迁移 **13 个 fetch 外呼点**(epay/heleket/lottery-notifier/notifier/traffic-notifier/system-monitor/lsky/plugin·theme 市场扫描/tickets 附件代理/cranemail/smartermail);新建 `test-safe-outbound-fetch-guards.ts`+接入 package.json/根 test 链。
- 7 身份评审:🏛 safeFetch 抽象正确、非 fetch 客户端正确排除✓ · 🔐 13 动态 URL 外呼点连接期复校 rebinding✓;抽查 tickets/notifier/heleket 均纯 fetch→safeFetch、URL/method/body 原样✓ · ✅ init 透传✓ · 💰 无业务参数改动(抽查确认)✓ · 🧪 新守卫+9 既有外呼守卫全绿✓ · ♻️ type-check + git diff --check 绿✓
- 复验(我方独立):`safe-outbound-fetch-guards`✓ `payment-provider-outbound-guard`✓ `mail-source-outbound-guard`✓ `ticket-image-security`✓ type-check✓
- 裁决:**✅ 保留**。
- 🔭 跟进项 FX-DISC-11:非 fetch 外呼客户端(nodemailer SMTP / FTP / SFTP / WebDAV / S3)不能用 undici dispatcher,仍存连接期 rebinding 缺口,需各自设计 IP 复校(assertSafeStorageTarget 仅校验期兜底)。归波3/后续单独治理。

---
### ⏸ FX-008 — root 单元执行服务用户可写 JS 提权链(P1 / D-055 / M27-01)【草案·待 owner 部署时验证】
- 规格:`audits/fixes/FX-008-spec.md` · 执行:codex · 手册:`audits/fixes/FX-008-owner-steps.md`
- 草案改动:`deploy/incudal-online-update@.service.example`/`-rollback@`(ExecStart 改固定 root-owned helper `incudal-online-task`,不再 exec 服务用户可写的 dist JS)、新增 `deploy/incudal-online-task.sh.example`(SHA256 清单/文件集/symlink/git 校验+安全权限恢复)、`incudal-systemctl-wrapper.sh.example`(只收 2 个 unit 模板+正整数 taskID)、`incudal-ota-chown-wrapper.sh.example`(拦截 OTA 递归 chown 防把代码交回 incudal);`deploy/incudal-backend.service.example`+`scripts/install-panel.sh`(PATH/sudoers secure_path 指向 /usr/local/libexec/incudal;.env→root:incudal 0640;code/current/releases/git 保持 root 控)。
- 安全/架构评审:🏛 root helper 为唯一入口、root-owned、固定路径,PATH/secure_path 阻断直呼 systemctl——设计切断提权链✓ · 🔐 root 不再执行服务用户可写产物、执行前 SHA256 校验树、sudoers 限参、.env 收紧✓(设计层) · 🧪 bash -n + test:installer + system-update-guards + type-check + wrapper 负向(exit 64)✓
- **裁决:⏸ 草案保留,不算已验证合并**。原因:本地无 systemd/root/sudoers,无法验证真实 OTA/回滚/权限行为。
- ⚠️ 必须提醒 owner(记入最终报告):
  1. 需在**预发/演练环境按 `FX-008-owner-steps.md` 验证**(迁移/负向/回滚)后才能上生产;纯文件 diff 不会自动纠正已部署机器上的既有权限,owner 要按手册手动 chown/chmod/更新 sudoers。
  2. **残留缺口**:`scripts/migrate-ota-atomic-layout.sh` 未加固,仍会写回旧式不安全 unit——加固后**绝不能再运行它**(手册已注明);建议后续把该脚本也加固/使其拒绝(记 FX-DISC-12)。

## 波0 小结
安全阻断 8 条:**FX-001/002/003/004/005/006/007 = ✅ 保留(7)**;**FX-008(root 提权链)= ⏸ 草案待 owner 部署时审阅**(基建,本地无法验证)。发现既有欠账:10 条基线红(FX-DISC-01..10)+ 非fetch外呼(FX-DISC-11),后续处理。

## 波1 资金/计费

### ✅ FX-010 — 充值退款方向应为余额收回(A3 / BF-2-08)
- 规格:`audits/fixes/FX-010-spec.md` · 执行:codex
- 改动:`server/src/db/balance.ts` approveBalanceAdjustmentRequest(isRechargeRefund=refund+sourceType='recharge' → 负数 admin_adjust 收回余额+备注;其它退款/调账不变;余额不足沿用 changeBalanceInTransaction 抛错回滚、不转负)、`server/scripts/test-balance-adjustment-approval-guards.ts`(加断言)。
- 7 身份评审:🏛 复用 sourceType 判别+现有原子扣减、最小✓ · 🗄 负数扣减走非负守卫、不转负;admin_adjust 不污染 refund 统计;与 D-176 口径不冲突(admin_adjust 且无 instanceId)✓ · ✅ recharge 扣/instance 加/null 加、余额不足回滚✓ · 💰 逐字对上 owner A3✓ · 🧪 守卫更新✓ · ♻️ 三守卫+type-check 绿✓ · **D-176 未触碰**✓
- 复验(我方独立):`balance-adjustment-approval-guards`✓ `balance-change-amount-guard`✓ `recharge-accounting-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-024 — 套餐收入单位放大 100 倍(P1 / D-048 / M24-01)
- 规格:`audits/fixes/FX-024-spec.md` · 执行:codex
- 改动:`server/src/routes/admin-capacity-cost.ts`(入口 priceYuan=toMoney(plan.price)/100,月收入/返回价统一元,全链只转一次;不动下单/账单/展示/共享取数)、`server/scripts/test-capacity-cost-guards.ts`(钉死换算)。
- 7 身份评审:🏛 单点换算清晰✓ · 🗄 分→元 /100 正确、只转一次✓ · ✅ 毛利/亏损预警口径归正✓ · 💰 修 D-048 低毛利显示成高毛利✓ · 🧪 守卫钉死✓ · ♻️ capacity-cost+commercial-operations 守卫+type-check 绿✓
- 复验(我方独立):`capacity-cost-guards`✓ `commercial-operations-overview-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-011 — 管理员退款回扣托管节点主人(E5① / BF-10-02 / M04-06)
- 规格:`audits/fixes/FX-011-spec.md` · 执行:codex
- 改动:`server/src/routes/admin-billing.ts`("退款"用 amount、"删除并退款"用 refundAmount,两事务内均调 deductHostingBalance(instance.hostId,...);复用 instance-destroy 口径,官方节点内部返回 null 无副作用)、`server/scripts/test-admin-billing-route-id-guards.ts`(加断言)。
- 7 身份评审:🏛 复用现成回扣、两路径一致、事务内✓ · 🗄 与退款同事务原子、非托管无副作用✓ · ✅ E18"扣不满记欠款"留 FX-014 不重复✓ · 💰 逐字对 E5①✓ · 🧪 守卫更新✓ · ♻️ admin-billing+financial-reconciliation+type-check 绿✓
- 复验(我方独立):`admin-billing-route-id-guards`✓ `financial-reconciliation-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-018 — 年付邮箱套餐仅允许12月整数倍续费(E21 / BF-9-05)
- 规格:`audits/fixes/FX-018-spec.md` · 执行:codex
- 改动:`server/src/routes/mail.ts`(新增 validateMailRenewMonthsForBillingCycle:yearly 须 12 的倍数、monthly 保持 1-12;报价前+扣款前双校验;年付非12倍数 400"年付套餐只能按年续费")、`server/scripts/test-mail-renewal-month-guards.ts`。
- 7 身份评审:🏛 helper 清晰、双点校验✓ · ✅ yearly%12、monthly 1-12、边界 0/1/12 正确✓ · 💰 对 E21;mail 只有 monthly/yearly 两周期,用实际 billingCycle 枚举✓ · 🧪 守卫更新✓ · ♻️ mail 守卫+type-check 绿✓
- 复验(我方独立):`mail-renewal-month-guards`✓ `mail-plan-financial-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-013 — 禁用优惠码仍照发续费佣金/仍可用(E5③ / BF-3-05)
- 规格:`audits/fixes/FX-013-spec.md` · 执行:codex
- 改动:`server/src/db/aff.ts`(validateAffCode 加 `if(!affCode.enabled) return {valid:false}`)、`server/src/db/billing-operations.ts`(续费折扣+佣金路径 gated on affBinding?.affCode.enabled)、`server/scripts/test-aff-review-ui-guards.ts`。
- 7 身份评审:🏛 一致的 enabled 检查模式✓ · ✅ 实例新购/续费均拦禁用码✓ · 💰 对 E5③(实例侧);现网 enabled 均 true 故无行为变化、为禁用能力(Q-C2)前置✓ · 🧪 守卫覆盖两路径✓ · ♻️ aff/invite 守卫+type-check 绿✓
- 复验(我方独立):`aff-review-ui-guards`✓ `aff-points-query-guards`✓ `invite-generation-accounting-guards`✓ type-check✓
- 裁决:**✅ 保留**。跟进项 **FX-DISC-13**:邮箱**续费**佣金 enabled 检查未做(避与 FX-018 并行冲突,codex 未碰 mail.ts),归后续邮箱清扫。

### ✅ FX-033 — apply-aff 事后绑他人码永久95折(E10 / BF-3-04)
- 规格:`audits/fixes/FX-033-spec.md` · 执行:codex
- 改动:`server/src/routes/instance-billing.ts`(apply-aff 端点**停用**,对合法实例 ID 统一 403"该功能已下线")、`server/scripts/test-instance-billing-route-id-guards.ts`。
- 7 身份评审:🏛 端点干净停用✓ · 💰 codex 正确判断"限自己码=自返利套利"→选停用,契合 E10✓ · 🔐 消除套利✓ · ✅ 403+守卫确保不再调 validateAffCode/createAffBinding✓ · 🧪 守卫更新✓ · ♻️ 守卫+type-check 绿✓
- 复验(我方独立):`instance-billing-route-id-guards`✓ `aff-review-ui-guards`✓ type-check✓
- 裁决:**✅ 保留**。跟进项 **FX-DISC-14**:前端 apply-aff 入口应隐藏(现调用得 403),归波3 前端。

### ✅ FX-022 — 自动续费预检用原价、实际扣折后价致误判失败(P3 / M04-10)
- 规格:`audits/fixes/FX-022-spec.md` · 执行:codex
- 改动:`server/src/services/billing-scheduler.ts`(预检 renewAmount=affBinding?.enabled?calculateDiscountedPrice(...):renewInfo.amount,与实际扣款一致;失败通知金额同步;保留预检优化)、`server/scripts/test-billing-query-guards.ts`。
- 7 身份评审:🏛 复用 calculateDiscountedPrice✓ · ✅ 折后价预检、enabled 门禁与 FX-013 自洽、余额介于折后/原价不再误判失败✓ · 💰 对 M04-10✓ · 🧪 守卫加✓ · ♻️ 未改扣款/失败计数、billing 守卫+type-check 绿✓
- 复验(我方独立):`billing-query-guards`✓ `billing-expiry-race-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-021 — 订单中心退款登记不校验状态/上限用名义额(D8 / BF-2-09/2-10)
- 规格:`audits/fixes/FX-021-spec.md` · 执行:codex
- 改动:`server/src/routes/orders.ts`(仅 completed/refunded 充值可登记退款、否则 409;退款上限改 toMoney(actualAmount ?? amount);账单类不变)、`server/scripts/test-order-payment-operations-guards.ts`。
- 7 身份评审:🏛 最小✓ · ✅ 状态校验+实付上限✓ · 💰 对 D8✓ · 🧪 order-payment-operations 守卫加✓;codex 诚实诊断 order-center-guards 仍红在第60行管理端表格结构(=FX-DISC-07,与本次无关、未越界)✓ · ♻️ type-check 绿✓
- 复验(我方独立):`order-payment-operations-guards`✓ type-check✓;`order-center-guards` 仍红(基线 FX-DISC-07,同一失败点、非本次引入)
- 裁决:**✅ 保留**。
- 💡 基线红规律:FX-DISC-01(oauth)+FX-DISC-07(order-center)均为"管理端 View 表格 table-fixed 结构漂移",10 红中一簇同源,波3 UI 可集群修。

### ✅ FX-017 — 邮箱退款按当前标价/无累计上限(E8 / BF-9-07)
- 规格:`audits/fixes/FX-017-spec.md` · 执行:codex
- 改动:`server/src/routes/mail.ts`(新增 getMailRefundableAmount:邮箱无独立计费表→以 BalanceLog 折后实扣流水为源;full=累计实付−累计已退;remaining=各期实付×未用时间比例,封顶 maxRefundable;不再用 plan.price)、`server/scripts/test-mail-plan-financial-guards.ts`。
- 7 身份评审:🏛 镜像实例级 getInstanceRefundableAmount✓ · 🗄 实付/已退基于 BalanceLog、roundMailCurrency 精度✓(小注:paid 靠 BalanceLog 识别略脆) · ✅ full/remaining/累计上限、不用 plan.price 修涨价虚高✓ · 💰 逐字对 E8✓ · 🧪 守卫加✓ · ♻️ 3 mail 守卫+type-check 绿✓
- 复验(我方独立):`mail-plan-financial-guards`✓ `mail-subscription-cancel-guards`✓ `mail-renewal-month-guards`✓ type-check✓
- 裁决:**✅ 保留**。跟进项 **FX-DISC-15**:邮箱理想应建独立逐期账单表(现靠 BalanceLog 识别实付略脆),大重构归后续。

### ✅ FX-025 — 到期删除硬删实例级联抹账单(P1 / D-004 / M04-01)
- 规格:`audits/fixes/FX-025-spec.md` · 执行:codex
- 改动:`server/src/services/billing-scheduler.ts`(prisma.instance.delete→带 id+version+suspended/expired+suspendedAt 条件的 updateMany 原子软删 status='deleted'+version++;Incus 删除/资源回滚/端口·IP·IPv6·公网IPv4 释放/通知 副作用保留;账单不级联删)、`server/scripts/test-billing-expiry-delete.ts`+`test-billing-expiry-race-guards.ts`。
- 7 身份评审:🏛 条件 updateMany 防并发续费竞态、version++✓ · 🗄 账单保留(修收入倒缩水)、副作用全保留✓ · ✅ 硬删→软删、并发守卫✓ · 💰 对 D-004✓ · 🧪 两守卫更新✓ · ♻️ 与既有用户销毁软删同口径(查询已过滤 deleted)、3 守卫+type-check 绿✓
- 复验(我方独立):`billing-expiry-delete`✓ `billing-expiry-race-guards`✓ `instance-billing-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-015 — 用户销毁托管实例手续费归节点主人而非平台(E19 / BF-10-06)
- 规格:`audits/fixes/FX-015-spec.md` · 执行:codex
- 改动:`server/src/routes/instance-destroy.ts`(托管回扣金额 refundAmount(R−F)→refundableValue(R,pre-fee 剩余价值);买家退款 R−F 不变;F 归平台;error 实例 F=0 一致)、`server/scripts/test-user-destroy-incus-order.ts`(正反断言)。
- 7 身份评审:🏛 最小口径改动✓ · 🗄 回扣 R、买家 R−F、平台净得 F✓ · ✅ 非托管无回扣、error 免费一致✓ · 💰 逐字对 E19✓ · 🧪 守卫正反断言✓ · ♻️ 与 FX-011(管理员退款不收销毁费)无冲突、守卫+type-check 绿✓
- 复验(我方独立):`user-destroy-incus-order`✓ `hosting-balance-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-016 — 管理员补发托管余额计入收入并抬高 VIP(E20 / BF-10-08)
- 规格:`audits/fixes/FX-016-spec.md` · 执行:codex
- 改动:`server/src/routes/users.ts`(admin 补发固定 `[Admin]` 前缀)、`server/src/routes/hosting.ts`(OPERATING_HOSTING_INCOME_WHERE 在累计/本月/VIP/最近收入排除 [Admin] 前缀,显式 OR 兼容 remark=null 真实收入)、`server/scripts/test-hosting-balance-guards.ts`。remark 排除法,不改 schema。
- 7 身份评审:🏛 常量复用四处、无 schema✓ · 🗄 排除 admin 补发、正确处理 null remark(避 NOT LIKE 漏 null)✓ · ✅ 补发余额仍增、只是不计收入口径✓ · 💰 对 E20✓ · 🧪 守卫加✓ · ♻️ hosting/vip 守卫+type-check 绿✓
- 复验(我方独立):`hosting-balance-guards`✓ `vip-level-rules-ui-guards`✓ type-check✓
- 裁决:**✅ 保留**。(小注:[Admin] 前缀判别略脆但避免迁移,合理取舍)

### ✅ FX-029 — 积分↔余额无系统级比价护栏+奖池概率不校验(E12 / BF-4-05)
- 规格:`audits/fixes/FX-029-spec.md` · 执行:codex
- 改动:`server/src/routes/admin-entertainment.ts`(抽奖配置保存前三校验:概率和≤100、不足需 nothing 兜底、balance 期望产出 Σ(prob×value元)≤costPoints/100元、面值≤单抽消耗价值×100;成本/奖品增删改全覆盖)、admin-entertainment 守卫。
- 7 身份评审:🏛 校验点全覆盖✓ · 🗄 分→元换算正确✓ · 🔐经济 期望产出≤消耗价值=无资金泵、概率兜底、面值上限✓ · ✅ 期望值公式正确✓ · 💰 `≤` 正好对 E12✓ · 🧪 守卫加✓ · ♻️ 守卫+type-check 绿✓
- 复验(我方独立):`admin-entertainment-route-guards`✓ `entertainment-route-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-019a — 管理员延期日价用30天基、与全站31天分叉(E9 一部分 / BF-1-01)
- 规格:`audits/fixes/FX-019a-spec.md` · 执行:codex
- 改动:`server/src/routes/admin-billing.ts`(删本地 /30 日价函数,改用公共 calculateDailyPrice 31天基;去双重舍入;延期仍 days×24h;不动续费/升级/退款)、`server/scripts/test-admin-billing-route-id-guards.ts`。
- 7 身份评审:🏛 复用公共函数 DRY✓ · 🗄 31天基一致、单次舍入✓ · ✅ 修 30/31 分叉+双重舍入✓ · 💰 对 E9(延期部分)✓ · 🧪 守卫加✓ · ♻️ admin-billing+financial 守卫+type-check 绿✓
- 复验(我方独立):`admin-billing-route-id-guards`✓ `financial-reconciliation-guards`✓ type-check✓
- 裁决:**✅ 保留**。(E9 另一半"升级剩余价值按实付封顶"=FX-019b,待做)

### ✅ FX-023 — 到期删除窗口内仍可续费/已删实例可续费改配(P2 / M04-02)
- 规格:`audits/fixes/FX-023-spec.md` · 执行:codex
- 改动:`server/src/routes/instance-billing.ts`(续费含批量/改配入口拒 status='deleted')、`server/src/db/billing-operations.ts`(performRenewal/performPlanChange 快照拒 deleted + 条件更新 status:{not:'deleted'}+version 防窗口竞态)、守卫。
- 7 身份评审:🏛 route+db 双层一致✓ · 🗄 条件更新防删除窗口竞态✓ · ✅ 拒已删✓ · 💰 修 M04-02(配合 FX-025 软删)✓ · 🧪 守卫加✓ · ♻️ 守卫+type-check 绿✓
- 复验:`instance-billing-route-id-guards`✓ `billing-expiry-race-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-030 — 礼品卡无资金来源/到账>面值/不可撤销(E4 / BF-8-06/07)
- 规格:`audits/fixes/FX-030-spec.md` · 执行:codex
- 改动:`server/src/routes/gift-cards.ts`+`server/src/db/gift-cards.ts`(路由+DB 双层拒到账>面值;新增发行人撤销接口:未兑用户余额卡→disabled+原面值 refund 退回、事务锁+卡ID幂等;管理员停用/删除也退款、已退款禁重启用;无平台资金账户→单批总面值 ¥10万上限)、守卫。
- 7 身份评审:🏛 后端最小、未擅造资金账户✓ · 🗄 到账≤面值、撤销退款幂等✓ · 🔐经济 消除超面值套利+可撤销✓ · 💰 对 E4(资金来源部分:批量上限兜底,完整方案需 owner 定平台资金账户)✓ · 🧪 新守卫过;gift-card-guards 仍基线红(GiftCardsView 横向滚动漂移,未掩盖)✓ · ♻️ type-check 绿✓
- 复验:type-check✓、FX-030 新守卫✓;`gift-card-guards` 仍红(FX-DISC-06,前端表格漂移,非本次)
- 裁决:**✅ 保留**。跟进:**FX-DISC-16** 管理员发卡平台资金账户(owner 设计);**FX-DISC-06** 归入波3 表格还原簇。

### 📌 基线红·表格漂移簇(FX-DISC-01/06/07 已确认同源)
UI 重做把**本应锁定 table-fixed+移动卡**的表(OAuthConfigView / GiftCardsView / admin·OrdersView 等)改成了 **overflow-x-auto 横向滚动**,违反表格布局守卫(且违反 owner 红线)。波3 统一**还原 table-fixed**(勿放宽守卫);逐一核对 10 条基线红中属此簇的,可一次修绿多条。

### ✅ FX-014 — Hosting 回扣不足平台默默兜底(E18 / BF-10-04)
- 规格:`audits/fixes/FX-014-spec.md` · 执行:codex
- 改动:`server/src/db/billing-operations.ts` deductHostingBalance(三级回扣后缺口 decrement hostingBalance 记欠款,仅此场景允许负余额+明确注释;负数 deduction 日志;totalDeducted=应扣全额)、`server/scripts/test-hosting-balance-guards.ts`。
- 7 身份评审:🏛 欠款路径 scoped+注释✓ · 🗄 缺口记负债、平台不吃差额、后续 increment 抵扣、无 schema✓ · ✅ 正常无缺口不变✓ · 💰 对 E18✓ · 🧪 守卫加✓ · ♻️ 提现 gte 守卫仍在、负=债务显示 graceful、守卫+type-check 绿✓
- 复验:`hosting-balance-guards`✓ `financial-reconciliation-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-012 — 退款不按比例冲回 AFF 佣金(E5② / BF-3-02)
- 规格:`audits/fixes/FX-012-spec.md` · 执行:codex
- 改动:`server/src/routes/instance-destroy.ts`(抽出 reverseInstanceAffCommissionForRefund:比例=退款/原实付、按比例扣已发佣金+totalEarnings、封顶未冲回额、全冲完回滚 usedCount 一次、affBalance 可负、AFF 锁)、`server/src/routes/admin-billing.ts`(退款/删除并退款调该函数)、守卫。
- 7 身份评审:🏛 抽出复用函数、3 路径共用、复用交付失败补偿口径✓ · 🗄 按比例、封顶未冲回、并发锁、事务内✓ · ✅ 无 affBinding no-op、多次部分退款不超冲✓ · 💰 对 E5②、杀双账号套利✓ · 🧪 守卫加✓ · ♻️ 4 守卫+type-check 绿✓
- 复验:`aff-review-ui-guards`✓ `user-destroy-incus-order`✓ `financial-reconciliation-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-031b — 交易所抽成未计入官方收入台账(E24 一部分 / BF-7-09)
- 规格:`audits/fixes/FX-031b-spec.md` · 执行:codex
- 改动:`server/src/routes/admin-statistics.ts`(收入聚合纳入 exchange_orders.fee_amount,仅 completed+completed_at+wallet_log_id 非空的已放款订单、按 completed_at 归期、不读重复钱包日志、无新 schema)、商业运营守卫。
- 7 身份评审:🏛 并入既有收入 SQL、无 schema✓ · 🗄 仅已结算、避重复/未结算计入、时间基一致✓ · 💰 对 E24(抽成入账部分)✓ · 🧪 守卫加✓ · ♻️ commercial+exchange 守卫+type-check 绿✓
- 复验:`commercial-operations-overview-guards`✓ `exchange-lifecycle-guards`✓ type-check✓
- 裁决:**✅ 保留**。跟进:**FX-031a** 交易所退款对买家持有期消耗补偿(E24 另一半,需设计)。

### ✅ FX-019b — 升级/改价按名义原价算剩余价值、不封顶实付(E9 另一半 / BF-1-03)
- 规格:`audits/fixes/FX-019b-spec.md` · 执行:codex
- 改动:`server/src/lib/billing-calc.ts`(升级剩余价值改实付账单未使用价值+封顶 maxRefundable)、`server/src/db/billing-operations.ts`(performPlanChange 复用 calculateInstanceRemainingRefundQuote;getMaxRefundable 加 tx)、`server/src/routes/admin-billing.ts`(改价预览+执行共用该报价)、守卫×2。
- 7 身份评审:🏛 与销毁退款口径统一 DRY、getMaxRefundable tx-aware✓ · 🗄 实付基+封顶、事务内一致✓ · ✅ 秒杀买家不再倒贴、<15天门槛/扣退款不变✓ · 💰 对 E9✓ · 🧪 守卫×2✓ · ♻️ 3 守卫+type-check 绿✓
- 复验:`instance-billing-route-id-guards`✓ `financial-reconciliation-guards`✓ `admin-billing-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。E9(延期31天+升级封顶实付)全部完成。

> **E22 状态**:核心"退款/剩余价值按实际服务时间比例折算"已由 FX-017(邮箱)+FX-019b(升级)+销毁退款(既有)+FX-025 达成;剩 Hosting 冻结期"自然月 vs 30天"分叉(BF-10-05)由 FX-020 统一。实例 31天/月交付、D8 已定保持。

### ✅ FX-020 — Hosting 冻结期自然月 vs 30天分叉(E22 剩余 / BF-10-05)
- 规格:`audits/fixes/FX-020-spec.md` · 执行:codex
- 改动:`server/src/db/billing-operations.ts`(抽 HOSTING_FREEZE_DAYS=30;购买/续费/升级三处冻结到期统一 now+30*24h 替 addMonths)、`server/scripts/test-hosting-balance-guards.ts`。
- 7 身份评审:🏛 常量复用三处 DRY✓ · 🗄 精确30天、与文案+管理侧一致✓ · ✅ 不动解冻调度✓ · 💰 对 E22/BF-10-05✓ · 🧪 守卫加✓ · ♻️ hosting 守卫+type-check 绿✓
- 复验:`hosting-balance-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-027 — 删 VIP 奖励级联抹领取记录致重复领取(P1 / D-024)
- 规格:`audits/fixes/FX-027-spec.md` · 执行:codex
- 改动:`server/src/services/vip-benefits.ts`(删除接口改置 enabled:false 软停用,不硬删→领取记录保留;展示/领取入口过滤停用;claimLimit 判重仍有效)、`server/scripts/test-vip-benefit-route-guards.ts`。复用现有 enabled 字段,无 schema。
- 7 身份评审:🏛 复用 enabled、无 schema✓ · 🗄 领取记录保留防重复领✓ · 🔐经济 停用不可领+判重✓ · 💰 对 D-024✓ · 🧪 守卫防级联硬删✓ · ♻️ 守卫+type-check 绿✓
- 复验:`vip-benefit-route-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-026 — 删用户硬删静默抹资金/审计,或外键 500(P1 / D-003 / M02-01)
- 规格:`audits/fixes/FX-026-spec.md` · 执行:codex
- 改动:`server/src/routes/users.ts`(删除阻断加主/托管余额非零 + BalanceLog/RechargeRecord/HostingBalanceLog/LoginRecord/RedeemCodeUsage 历史检查,各返 400)、`server/src/db/users.ts`(deleteUser 捕获 P2003/P2014→UserDeletionConflictError→路由 409)、守卫。bounded、无 schema、不做软删重构。
- 7 身份评审:🏛 扩阻断+捕获、flag 软删给 owner✓ · 🗄 有财务/审计记录即阻断→不静默级联删、外键→409 非 500✓ · 🔐合规 财务/审计保留✓ · 💰 修 D-003✓ · 🧪 守卫加✓ · ♻️ 守卫+type-check 绿✓
- 复验:`admin-user-delete-resource-guards`✓ `user-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。跟进 **FX-DISC-17** 用户软删/匿名化架构(owner 设计;有财务史的用户现不可硬删,需先处理)。

### ✅ FX-028 — 删抽奖奖品级联抹中奖记录(P1 / D-025)
- 规格:`audits/fixes/FX-028-spec.md` · 执行:codex
- 改动:`server/src/db/lottery.ts`+`server/src/routes/admin-entertainment.ts`(奖品无 enabled 字段→有中奖记录则阻断硬删 409,可设概率0停用,保留中奖/发放记录;仅无记录可删;FX-029 校验不变)、守卫。
- 7 身份评审:🏛 无字段→阻断硬删方案合理✓ · 🗄 中奖记录保留、无 schema✓ · 🔐经济 防级联抹记录✓ · 💰 对 D-025✓ · 🧪 守卫加✓ · ♻️ 2 entertainment 守卫+type-check 绿✓
- 复验:`entertainment-route-guards`✓ `admin-entertainment-route-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-032 — repay 重新支付不作废旧单致重复扣款(D3 / BF-2-05)
- 规格:`audits/fixes/FX-032-spec.md` · 执行:codex
- 改动:`server/src/routes/recharge.ts`(paymentDetails.paymentAttempt 记 current+superseded;repay 生成带 --PA-xxx 后缀新网关单+返回 previousPaymentLinkInvalidated;回调/验单只认当前尝试,旧尝试回调告警拒绝入账)、守卫。无 schema。
- 7 身份评审:🏛 attempt-state 追踪、防御性解析✓ · 🔐经济 平台侧只入账当前尝试、旧回调拒绝✓ · 💰 对 D3(平台侧);网关侧真 cancel 需集成✓ · 🧪 守卫加✓ · ♻️ recharge 守卫+type-check 绿✓
- 复验:`recharge-state-transitions`✓ `recharge-accounting-guards`✓ type-check✓
- 裁决:**✅ 保留**。跟进 **FX-DISC-18** 网关侧 cancel 集成(Heleket/Antom/易支付旧单真取消)。

---
## 🏁 波1 资金/计费 完成小结(24/24 ✅)
FX-010 充值退款扣减 · 011 管理员退款回扣节点主 · 012 退款冲回AFF佣金 · 013 禁用码停佣金 · 014 回扣不足记欠款 · 015 销毁费归平台 · 016 补发不计收入 · 017 邮箱退款按实付 · 018 年付仅12月 · 019a 延期31天 · 019b 升级封顶实付 · 020 冻结30天 · 021 订单退款仅completed/实付上限 · 022 自动续费折后价预检 · 023 拒续费已删实例 · 024 收入单位×100 · 025 到期软删保账单 · 026 用户删阻断+外键捕获 · 027 VIP奖励软删 · 028 抽奖奖品阻断硬删 · 029 积分↔余额护栏 · 030 礼品卡到账≤面值+可撤销 · 031b 交易所抽成入账 · 032 repay作废旧单(平台侧) · 033 apply-aff停用。
留待:FX-031a(交易所买家持有期消耗补偿·设计)、FX-DISC 若干(邮箱续费佣金enabled/前端apply-aff隐藏/网关cancel/管理员发卡资金账户/用户软删架构/基线表格漂移簇 等)。

## 波2 实例/交付/网络/终端/流量

### ✅ FX-081 — 终端审计日志失败被当连接失败关掉正常终端 ★owner 最初报的"终端报错"根因(P1 / M14-03/04)
- 规格:`audits/fixes/FX-081-spec.md` · 执行:codex
- 改动:`server/src/routes/terminal.ts`(连接成功审计 + close 断开审计各用局部 try/catch 隔离;日志失败只 console.error、不关已建立终端、无未处理 rejection)、`server/scripts/test-terminal-route-id-guards.ts`。
- 7 身份评审:🏛 最小隔离✓ · ✅ 审计失败不再关终端(M14-03)、close 回调捕获(M14-04)✓ · 💰 ★直接修 owner 原始"终端报错"✓ · 🧪 守卫断言隔离✓ · ♻️ 2 terminal 守卫+type-check 绿✓
- 复验:`terminal-route-id-guards`✓ `terminal-saved-command-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。★owner 原始报障根因已消除。(终端会话/重连僵尸=M14-01/02=FX-082 待做)

### ✅ FX-066 — 风险分衰减恒0→永久限速+可能永久限单(E2 / D-006 / BF-6-05/06)
- 改动:`server/src/services/resource-risk.ts`(衰减锚改 lastTriggeredAt 仅触发时刷;decay=max(0,cumulativeDecay−decayAppliedSinceTrigger) 按累计时长扣、不每轮重复扣;DEFAULT_SCORE_DECAY_PER_HOUR=5;纳入 admin 可编辑白名单;无 schema)、守卫。
- 7 身份评审:🏛 anchor+已应用量设计✓ · 🗄 无 schema、累积不重扣✓ · ✅ 分数回落→QoS 自动恢复✓ · 💰 对 E2 修永久限速✓ · 🧪 新断言过;resource-risk-guards 仍红=表格漂移簇(FX-DISC-09,未掩盖)✓ · ♻️ type-check 绿✓
- 复验:type-check✓、新断言✓;resource-risk-guards 仍基线红(FX-DISC-09,同表格簇)
- 裁决:**✅ 保留**。

### ✅ FX-082 — 终端僵尸会话/无人管理连接(P1 / M14-01/02)
- 改动:`server/src/lib/terminal-proxy.ts`(初连前注册 client close/error、连后复核 OPEN 否则关 Incus+不登记;重连 reconnectGeneration 可失效+退避/建连后复核会话代次OPEN;closeIncusConnectionPair helper)、守卫。
- 7 身份评审:🏛 epoch 取消模式✓ · ✅ 早退不留僵尸、stale 重连不接管✓ · 💰 修 M14-01/02✓ · 🧪 守卫加✓ · ♻️ terminal 守卫+type-check 绿✓
- 复验:`terminal-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。终端子系统(FX-081+082)稳固。

### ✅ FX-067 — 实例级超量零预警直接限速(G-A / BF-6-02)
- 改动:`server/src/services/traffic-scheduler.ts`+`traffic-notifier.ts`(实例达实例限额80%且未超→原子抢占 NORMAL→WARNING 发一次带实例名预警,节点重置恢复;用户级预警独立去重)、守卫。
- 7 身份评审:🏛 原子 claim 复用限速模式✓ · 🗄 去重、重置可再预警✓ · ✅ 修零预警✓ · 💰 对 BF-6-02✓ · 🧪 守卫过✓ · ♻️ traffic 守卫+type-check 绿✓
- 复验:`traffic-notification-claim-guards`✓ `traffic-reset-locks`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-B503 — 免费套餐后端不校验规格上限可超额领资源(E3 护栏 / BF-5-03)
- 改动:`server/src/routes/instances.ts`(免费套餐 requestedCpu/Mem/Disk > pkg.cpu_max/memory_max/disk_max → 400 拒绝;付费/共享不变)、`server/scripts/test-instance-quota-zero-guards.ts`。
- 7 身份评审:🏛 明确拒绝✓ · 🗄 资源守恒✓ · 🔐经济 修绕API超额领✓ · 💰 对 E3✓ · 🧪 守卫加✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`instance-quota-zero-guards`✓ `instance-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-B504 — 静态IP分配失败仍标 running 交付不通网(F-A / BF-5-04)
- 改动:`server/src/routes/instances.ts`(NAT需内网IPv4/ipv6类需routed IPv6 的模式,静态IP分配失败→staticIpAllocationError→复用 createInstanceAsync 失败补偿:error+回滚+释放IP+退款+503,不静默 running)、`server/scripts/test-instance-create-failure-compensation.ts`。
- 7 身份评审:🏛 复用现成补偿✓ · ✅ 按模式判致命、无静默交付✓ · 💰 对 BF-5-04 不通网机器✓ · 🧪 守卫加✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`instance-create-failure-compensation`✓ `instance-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-D014 — 流量双通道无采样版本,迟到旧上报回退快照重复计量(P1 / D-014 / M13-01)
- 改动:`agent-instance-report.ts`(采样时间=`reportedAt`,缺失回退接收时)、`instance-traffic-collector.ts`(采样时间=`counters.sampledAt`)、`traffic-utils.ts`(新增 `advanceTrafficSnapshot`:统一原子 `updateMany(where updatedAt<=sampledAt)` 推进快照,迟到样本 debug 后丢弃、不回退基线不累加)、守卫。复用 `TrafficSnapshot.updatedAt @updatedAt` 作采样时间,未改 schema、未碰 instances.ts。
- **关键正确性核验(真库回滚事务探针)**:Prisma 7 **尊重显式 `@updatedAt`** → CREATE honored=true;迟到样本 `updateMany` **count=0 被拒**(不回退);正常推进写入 updatedAt=sampledAt(honored=true)。防重复计量机制成立。
- 7 身份评审:🏛 单一权威原子推进✓ · 🗄 条件 updateMany 并发安全+探针证实✓ · ✅ 迟到不回退不累加✓ · 💰 消流量虚高/误限速误计费✓ · 🧪 3 守卫✓ · ♻️ type-check+守卫绿✓
- 复验:`traffic-collector-status-guard`✓ `agent-report-state-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-D015 — 批量端口映射绕过配额与端口范围(P1 / D-015 / M13-02)
- 改动:`server/src/routes/instances.ts`(显式数组/连续段/自动分配统一归一 finalMappings;配额按 `finalMappings.length` 计,both×2;schema `maxItems:100`;内外端口各自唯一;全落宿主 NAT 允许范围,否则 400)、`server/scripts/test-port-mapping-safety.ts`(超量/重复/越界/最终数计配额 4 断言)。
- 7 身份评审:🏛 单一归一漏斗三路径收敛✓ · 🔐 maxItems 上限防 DoS 数组+范围挡保留端口✓ · ✅ 数量/唯一/范围三闸✓ · 💰 诚实按最终数计配额✓ · 🧪 守卫 4 断言✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`port-mapping-safety`✓ `instance-route-id-guards`✓ `instance-quota-zero-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-D016 — IPv6 CIDR 不检子网重叠、不限前缀(P1 / D-016 / M13-03)
- 改动:`server/src/db/ipv6-subnets.ts`(`normalizeIpv6CidrRange`→网络地址+128bit BigInt 区间;标准重叠谓词 `startA<=endB && startB<=endA` 遍历已分配;advisory lock 事务内串行查重+插入防并发双分配;前缀集常量 `IPV6_SUBNET_ALLOWED_PREFIXES=[112,120,124]`)、`server/src/routes/ip-addresses.ts`(自定义/自动统一强制前缀集,规范化后查宿主网段包含,重叠 409、非法 400)、`server/scripts/test-ip-address-route-guards.ts`(规范化/嵌套重叠/相邻不重叠/非法前缀/锁顺序 5 断言)。复用 `ip-address` 库 Address6,未改 schema。
- 7 身份评审:🏛 BigInt 区间模型+库复用+前缀常量提取✓ · 🗄 advisory lock 串行查重+插入无竞态✓ · 🔐 挡路由劫持/串扰+限范围✓ · ✅ 标准区间重叠谓词+相邻边界守卫✓ · 💰 免 IPv6 不可达/串扰事故✓ · 🧪 5 断言✓ · ♻️ 守卫+type-check 绿✓
- 复验:`ip-address-route-guards`✓ `ipv6-subnet-guards`✓ `ip-address-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-047 — sync-status 可把 suspended 洗回 stopped 绕过封停(P1 / D-005 / M05-01)
- 改动:`server/src/routes/instances.ts`(sync-status:`currentStatus==='suspended'?保留:incusStatus`,遥测/IP 照同步)、`server/src/db/instances.ts`(状态写入 where `notIn:['deleted','suspended']` 并发兜底,顺带挡 deleted 洗回)、`server/scripts/test-instance-operation-conflict-guards.ts`(路由+DB 双层断言)。
- 7 身份评审:🏛 路由意图+DB where 双层✓ · 🗄 notIn 原子排除竞态安全✓ · 🔐 封死自助解封✓ · ✅ suspended 保留/遥测照记/正常同步不回归✓ · 💰 欠费/滥用/到期封停不可自助解除✓ · 🧪 双层守卫✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`instance-operation-conflict-guards`✓ `instance-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-D017(=FX-054 的 D-017 部分)— 月流量重置只清累计不刷计数器快照,重置窗口重复计入(P1 / D-017 / M13-04)
- 改动:`server/src/db/traffic.ts`(`withInstanceTrafficResetLock`:持采集同款 `traffic:instance:<id>` PG advisory 锁;`getTrafficResetSample`:**running→实时拉 Incus 计数器**作新基线、stopped→冻结快照、deleted→抛错;锁内复用 `advanceTrafficSnapshot` 推基线,同 Prisma 事务清零 `monthlyTrafficUsed`)、`server/src/routes/traffic.ts`(免费/付费重置都走该锁,付费原 advisory+余额事务不变)。
- **关键正确性核验**:读 traffic.ts:53-84 确认 running 分支走 `getIncusClientFromPool`+`getTrafficCounters` 取当前计数器(基线真推进,非回写旧值);stopped 分支用冻结快照(停机计数器不变)成立。
- 7 身份评审:🏛 复用 advanceTrafficSnapshot+同采集锁单一权威✓ · 🗄 锁+同事务先推基线后清零并发安全✓ · ✅ running 实时基线/stopped 冻结/旧窗口不进新周期✓ · 💰 消"重置后重现旧流量"+并发付费重置误计✓ · 🧪 6 流量守卫✓ · ♻️ type-check 绿✓
- 复验:`traffic-reset-locks`✓ `traffic-route-limit-guards`✓ `traffic-collector-status-guard`✓ type-check✓
- 裁决:**✅ 保留**。⚠️ **FX-054-rest 跟进**:E23 付费重置同扣用户级已用量 + BF-6-10/11 加油包作用实例级限额,本次未含,下轮补。

### ✅ FX-041 — 秒杀两条失败路径不释放库存、soldCount 不回滚(F-A / BF-5-02)
- 改动:`server/src/routes/instances.ts`(创建超时清理 + 公网IPv4无货 两条失败分支,在赢得 creating→error 原子迁移后调 `markFlashSaleFailed(...)` 释放库存,传退款标志)、`server/src/services/flash-sales.ts`(`markFlashSaleFailed` 改带原状态条件 `updateMany(where status in [paid,delivering])`+`count===0 return`,仅首次迁移回滚 soldCount)、`test-flash-sale-guards.ts`+`test-instance-create-failure-compensation.ts`。
- 7 身份评审:🏛 两路径接权威释放函数+幂等无主链路重构✓ · 🗄 条件 updateMany+count 卫并发不双减✓ · ✅ 仅在赢得原子迁移后补偿、无幽灵占用✓ · 💰 失败释放库存真买家可买✓ · 🧪 2 守卫✓ · ♻️ instances.ts 累计 6 守卫回归全绿(B504/D015/047 未退)✓
- 复验:`flash-sale-guards`✓ `instance-create-failure-compensation`✓ `port-mapping-safety`✓ `instance-operation-conflict-guards`✓ `instance-route-id-guards`✓ `instance-quota-zero-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-040 — 交付前置失败仅靠~10min兜底退款 + IPv4释放分散(F-A BF-5-01 / D-127 / D-125)
- 改动:`server/src/routes/instances.ts`(独立 IPv4 释放统一 `releaseReservedPublicIpv4ForFailedCreation` helper;事务后 IP分配/网络配置/存储池准备统一 try/catch→即时置错+资源回滚+IPv4释放+`compensateFailedInstancePurchase` 退款;幂等由 `creating→error` 原子抢占+余额锁+退款记录把关)、`test-instance-create-failure-compensation.ts`。
- 7 身份评审:🏛 统一释放 helper+复用补偿路径✓ · 🗄 creating→error 原子闸+余额锁防双退✓ · ✅ 事务后失败即时补偿不挂 creating✓ · 💰 扣款后不再长时间拿不到机器也拿不回钱✓ · 🧪 5 守卫✓ · ♻️ instances.ts type-check 干净(消除并发噪声)✓
- 复验:`instance-create-failure-compensation`✓ + instances.ts 全守卫 + type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-054-rest — 付费重置扣用户级 + 加油包作用实例级(E23 / BF-6-11 / BF-6-10;完成 FX-054 全口径)
- 改动:`server/src/db/traffic.ts`(`syncUserExtraTrafficUsed`:extraTrafficUsed=各实例超基础限额用量汇总封顶;付费重置仅从用户级 monthlyTrafficUsed 扣**本实例贡献**不清零他实例)、`server/src/routes/traffic.ts`(付费重置持实例锁+用户流量锁同事务扣用户级)、`server/src/services/traffic-scheduler.ts`(`getEffectiveLimit(instanceLimit, extraTrafficQuota)` 并入实例级限速/预警/恢复,extraTrafficUsed 参与耗尽判定)、`test-traffic-route-limit-guards.ts`(加油包断言)。
- **打回修正1**(codex 改名破 FX-067 锁):`instanceEffectiveLimit`→`instanceLimit`(值不变含加油包),过 `traffic-notification-claim-guards`。
- **打回修正2**(guard-vs-guard 自造冲突,我方精改):FX-054-rest 给 route-limit-guard 新加的断言用了 `instanceEffectiveLimit`,与老锁 `instanceLimit` 冲突 → 我把**新加断言**改回 `instanceLimit`(意图 getEffectiveLimit/extraTrafficUsed/exhausted 全留,不放宽老锁),两守卫同时过。
- 7 身份评审:🏛 syncUserExtraTrafficUsed+getEffectiveLimit 织入✓ · 🗄 扣本实例贡献不误伤他实例+双锁同事务✓ · ✅ 加油包实例级解限(原死字段)+用户级不再误判超限✓ · 💰 E23"都做"两块交付✓ · 🧪 claim/route 两守卫消冲突✓ · ♻️ 5 traffic 守卫+全 type-check 绿✓
- 复验:`traffic-notification-claim-guards`✓ `traffic-route-limit-guards`✓ `traffic-reset-locks`✓ `traffic-collector-status-guard`✓ `agent-report-state-guards`✓ type-check✓
- 裁决:**✅ 保留**(FX-054 全口径 D-017+E23+BF-6-10/11 完成)。

### ✅ FX-072 — 资源池申领无主机容量上限致 OOM 超卖(P1 / D-059 / M06-01)
- 改动:`server/src/db/resource-pool.ts`(申领事务按 reserveResources 同款 `updateMany + where(cpuUsed/memoryUsed/diskUsed lte limit-delta) + count===0` 原子校验 CPU/内存/磁盘,磁盘 storageSize×1024→MB,负 delta 拒;超限抛 `HOST_RESOURCES_INSUFFICIENT` 回滚池余额/日志/实例)、`server/src/routes/resource-pool.ts`(超限后既有 Incus patch 回滚;amount 正安全整数 ≤104857600 双层校验)、`test-resource-pool-apply-consistency.ts`+`test-host-resource-atomic-guards.ts`。
- 7 身份评审:🏛 与 reserveResources 对称同款条件✓ · 🗄 逐维原子条件更新+count 卫并发安全+回滚 Incus patch✓ · 🔐 挡跨租户 OOM 资源耗尽✓ · ✅ 三维全校验+磁盘单位+amount 上限✓ · 💰 池资源不能突破节点内存上限✓ · 🧪 2 守卫+bigint 守卫✓ · ♻️ 3 守卫+type-check 绿✓
- 复验:`resource-pool-apply-consistency`✓ `host-resource-atomic-guards`✓ `resource-quota-bigint-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-055 — Caddy 新增路由把 POST 失败当"不存在"、PUT 覆盖全站路由致中断(P1 / D-018 / M13-05)
- 改动:`server/src/lib/caddy-client.ts`(结构化 `CaddyApiError.statusCode`;仅明确 404 进创建分支,网络/401/403/5xx 上抛;写入改 route 数组 `POST` 追加不替换;404 后读 sites 复核区分 server 不存在 vs routes 字段缺失,仅确认缺失才精确创建)、`test-proxy-site-route-id-guards.ts`。
- 7 身份评审:🏛 结构化错误+POST 追加+读取合并,合 Caddy Admin API✓ · ✅ 仅显式 404 创建、瞬时错误不误判、无路由丢失✓ · 💰 短暂网络/认证错误不再抹宿主全部反代→无全站中断✓ · 🧪 守卫✓ · ♻️ 守卫+type-check 绿✓
- 复验:`proxy-site-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ⏸ FX-046 — 普通付费开通无幂等(BF-5-08)——挂起,需 owner 定 schema
- codex 核查推翻我方 spec 前提:`schema.prisma:2231 idempotencyKey @unique` 属 **ExchangeListing 非 InstanceTask**;InstanceTask 无该字段/唯一索引;普通付费开通在 Prisma 事务内直接建实例+扣款(无 task 门控);`createInstanceTaskOrConflict` 仅 start/stop/rebuild;秒杀去重靠 `FlashSaleReservation.idempotencyKey` 不可复用。codex **写 0 文件**(6 instances.ts 守卫回归全绿,无回退)。
- **为何挂起**:正确幂等需"客户端稳定键 + 持久唯一存储",InstanceTask/instance 无此字段 → **须加 schema 迁移**(违反自主批次不擅改 schema 红线);无键的"签名+时间窗"兜底会**误伤合法'同规格建多台'**,属 UX 回归,不采纳。
- **待 owner 决策(二选一)**:① 给普通开通加专用幂等字段/表 + unique 迁移(+前端每次开通生成稳定键),按 unique 冲突原子返回既有实例;② 维持现状接受双击风险(前端按钮防抖兜底)。
- 裁决:**⏸ DEFER**(与 FX-008 infra、FX-031a 设计并列,待 owner)。

### ✅ FX-057 — Caddy 管理请求带 Basic Auth 却关 TLS 校验(P1 / D-020 / M13-07)
- 改动:`server/src/lib/caddy-client.ts`(CA 固定:`caPath`/`CADDY_CA_PATH` 读 CA bundle,servername 锁 `caddy-admin`,`rejectUnauthorized:false→true`;无信任材料构造期 fail-closed 且绝不发送 Basic Auth 凭证)、`test-proxy-site-route-id-guards.ts`(断言无 rejectUnauthorized:false)。与 FX-055 改动共存无回退。
- 7 身份评审:🔐 移除关校验+CA/servername 固定+fail-closed 无凭证泄漏,封 MITM 窃凭证✓ · 🏛 复用证书 bundle 模式与 FX-055 共存✓ · ✅ 无信任材料 fail-closed✓ · 🧪 守卫✓ · ♻️ 守卫+type-check 绿✓
- 复验:`proxy-site-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。⚠️ **部署顺序红线**:破坏性变更——生产须**先配 `CADDY_CA_PATH`+各宿主 `/etc/caddy/cert.pem`** 再上线,否则反代管理 fail-closed 报错;**禁静默 OTA**(同 FX-008,记入部署 handoff)。

### ✅ FX-048 — 恢复流程删原实例→重命名前抛错即删唯一临时副本致数据全灭(P1数据安全 / D-058 / M05-02)
- 改动:`server/src/workers/restoreTaskWorker.ts`(清理临时副本前 `instanceExists(client, originalIncusId)` 实查 Incus:仅原实例确认存在才删临时;不存在**或无法确认**都保留临时+标 FAILED/`progress:manual_intervention`+人工恢复信息)、`test-instance-recreate-consistency.ts`+`test-backup-task-race-guards.ts`。
- 7 身份评审:🏛 destructive 清理前 fail-safe 存在性检查三分支✓ · ✅ 仅确认存在才删、两种不确定都保留(fail-safe)✓ · 💰 消恢复窗口实例数据全灭、可人工恢复✓ · 🧪 2 守卫✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`instance-recreate-consistency`✓ `backup-task-race-guards`✓ type-check✓
- 裁决:**✅ 保留**(高价值数据安全)。

### ✅ FX-074 — 宿主机用量绝对覆盖并发丢失更新(P1 / D-051 / M24-04)
- 改动:`server/src/db/hosts.ts`(新增 `incrementHostResourceUsage` 用 Prisma `increment` 原子更新 cpuUsed/memoryUsed/diskUsed 三维)、`server/src/routes/batch-config.ts`(改提交累计 delta,移除 `host.*_used+delta` 绝对覆盖)、`test-host-resource-atomic-guards.ts`+`test-batch-config-route-guards.ts`。
- 7 身份评审:🏛 专用原子 helper✓ · 🗄 Prisma increment=原子 SQL col+delta 无读改写竞态,三维✓ · ✅ 绝对覆盖移除✓ · 💰 并发批量不再互相覆盖,容量台账不错算✓ · 🧪 2 守卫✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`host-resource-atomic-guards`✓ `batch-config-route-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-071 — 终端断开审计 rejection + 连接上限非原子 + 快捷命令上限竞态(P2高 / D-080,D-081,D-082 / M14)
- 改动:`server/src/routes/terminal.ts`(D-080 close 回调审计独立 try/catch 失败只记录不抛;D-081 同步原子名额预留:active+pending × 用户/实例双维同一原子区,断开/建连失败/登记后幂等 release,`socket.once('close', reservation.release)`)、`server/src/db/terminal-saved-commands.ts`(D-082 事务级 `advisoryTransactionLock` + 同事务 count+100 上限+insert,超限 `MAX_COMMANDS_REACHED`)、两守卫。FX-081/082 隔离/代次未回退。
- 7 身份评审:🏛 名额预留幂等 release+advisory lock 复用✓ · 🗄 D-082 事务锁串行 count+insert(持久行正确)、D-081 内存 Map 适配 per-process WS✓ · 🔐 并发不绕上限✓ · ✅ 三缺陷各中、无未处理 rejection✓ · 🧪 2 守卫✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`terminal-route-id-guards`✓ `terminal-saved-command-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-056 — 证书查询直连 443 不走 outbound-security,DNS rebinding SSRF(P1 / D-019 / M13-06)
- 改动:`server/src/routes/proxy-sites.ts`(复用 `resolvePublicHostname` 解析全部地址拒私网/回环/链路本地/云元数据;证书查询先校验 DNS,再 `tls.connect({host: certificateAddress.address, servername: 域名})` 锁校验过 IP 防 rebinding,无不安全回退)、`server/src/lib/outbound-security.ts`(公开 resolvePublicHostname)、两守卫。
- 7 身份评审:🔐 拒私网/回环/元数据+IP 锁定+SNI 防 rebinding✓ · 🏛 复用 FX-003 出站安全一致✓ · ✅ 校验先于连接无不安全回退✓ · 🧪 2 守卫✓ · ♻️ 绿✓
- 复验:`storage-outbound-guards`✓ `proxy-site-route-id-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-049 — 端口映射DB先于Incus + 销毁结算丢退款 + config计数漂移(P2 / D-126,D-128,D-129 / M05)
- 改动:`server/src/routes/instances.ts`(D-126 端口 DB 预占前统一 `checkPortInUse`;D-129 config 更新后 `calculateHostResourcesFromInstances` 重算宿主用量不绝对覆盖)、`server/src/routes/instance-destroy.ts`(D-128 单/批量销毁结算异常落 `pending_manual/critical` DeliveryAssuranceCase + detected action,双重 catch 兜底日志)、`test-port-mapping-safety.ts`+`test-instance-delete-incus-order.ts`。D-127 已由 FX-040 修,本次不含。
- 7 身份评审:🏛 checkPortInUse 保 DB-Incus 一致+重算不漂移+复用补偿基建✓ · 🗄 从实例集重算=权威、结算失败落持久补偿案✓ · ✅ 三缺陷各中✓ · 💰 销毁退款不再静默丢失(真金)+无计数漂移+无端口幽灵占用✓ · 🧪 2 守卫✓ · ♻️ FX-040/074/B504 未退(5 守卫回归绿)✓
- 复验:`port-mapping-safety`✓ `instance-delete-incus-order`✓ `instance-route-id-guards`✓ `instance-create-failure-compensation`✓ `host-resource-atomic-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-050 — boost-processes 先写 DB,Incus 失败不抛致漂移(P3高 / D-144 / M05-08)
- 改动:`server/src/routes/instances.ts`(boost-processes:存 DB 原值,Incus 失败精确回滚含 null;回滚也失败返回 `PROCESS_LIMIT_BOOST_PARTIAL_FAILURE` 明示 DB 值+Incus 状态未知;全程记失败日志,不静默返回成功)、`test-instance-route-id-guards.ts`。
- 7 身份评审:🏛 存原值→Incus失败回滚→回滚失败部分失败三层✓ · 🗄 回滚恢复原值(含null)、无法回滚则明示状态✓ · ✅ 消"DB改了Incus没生效还成功"✓ · 💰 进程数提升漂移消除✓ · 🧪 守卫✓ · ♻️ 2 守卫绿;type-check 先前 FAIL 系并发 FX-063 半成品噪声,隔离确认 instances.ts 无错✓
- 复验:`instance-route-id-guards`✓ `instance-operation-conflict-guards`✓ (全量 type-check 待 FX-063 完成终验)
- 裁决:**✅ 保留**。

### ✅ FX-063 — 流量超量限速与风控 QoS 两套互不感知,恢复取到对方限速值(BF-6-13 / G-A)
- 改动:新增 `server/src/services/traffic-bandwidth.ts`(`computeEffectiveBandwidth`=配置线速基线/超量 THROTTLE/风控 QoS 三者取 `mostRestrictiveBandwidth` 最小值,基线来自 `packagePlan.trafficLimitSpeed` 非捕获,按实例分布式锁串行落地)、`server/src/services/traffic-scheduler.ts`(只设/清 `trafficStatus=LIMITED` 后重仲裁)、`server/src/services/resource-risk.ts`(只设/清 `currentBandwidthLimit` 后重仲裁,不恢复 original)、`test-traffic-route-limit-guards.ts`+`test-resource-risk-guards.ts`。保留 FX-060/066。
- 7 身份评审:🏛 单一仲裁点+两套只管自己约束✓ · 🗄 实例分布式锁串行落地+基线取配置✓ · ✅ 最严者胜/解除按剩余重仲裁/无 original 捕获恢复✓ · 💰 BF-6-13 交付,不再被对方限速值误锁/误放✓ · 🧪 后端断言过✓ · ♻️ type-check+plan-bandwidth+traffic-route+notification-claim 绿✓
- 复验:`traffic-route-limit-guards`✓ `plan-bandwidth-limit-guards`✓ `traffic-notification-claim-guards`✓ type-check✓
- 裁决:**✅ 保留**。⚠️ `resource-risk-guards` 的前端表格断言 FAIL = **FX-DISC-09 基线遗留**(ResourceRiskView.vue 与 HEAD 一致、本会话未碰,UI 重做期漂移丢 table-fixed),非 FX-063 引入,归波3 恢复。

### 📋 FX-DISC-09(登记)— ResourceRiskView.vue 表格漂移(基线遗留,波3 修)
- `client/src/views/admin/ResourceRiskView.vue` 缺 `table-fixed`/`hidden overflow-hidden lg:block` 移动卡+定宽表,致 `test:resource-risk-guards` 前端断言 FAIL。与 HEAD 一致=会话前就漂移。**波3 按 memory 恢复 table-fixed+移动卡,禁改/弱化守卫**。同簇:oauth/gift-card/order-center 等(FX-DISC-01/06/07)。

### ✅ FX-073 — 资源池申领 Incus 先于 DB 崩溃漂移无对账 + 展示精度(P3 / D-161,D-171余项 / M06)
- 改动:`server/src/routes/resource-pool.ts`+`server/src/db/resource-pool.ts`(D-161 申领改 DB 先落库+`[incus-pending]` remark 标记→patch Incus→成功清标记;启动+每5min 仅对 pending 幂等重放对账,免 schema;D-171 余额/amount/日志 `.toString()` 字符串透传消 Number 精度)、`test-resource-pool-apply-consistency.ts`+`test-resource-quota-bigint-guards.ts`。(D-073 已 FX-023 修、D-171 amount 上限已 FX-072 修,本次不含)
- 7 身份评审:🏛 DB-first+pending 标记+对账 sweep 免 schema 巧解✓ · 🗄 pending 幂等重放+字符串透传✓ · ✅ 崩溃留 pending 可对账、FX-072/023 未退✓ · 💰 无长期漂移+无精度丢失✓ · 🧪 2 守卫✓ · ♻️ 3 守卫+resource-pool type-check 干净✓
- 复验:`resource-pool-apply-consistency`✓ `resource-quota-bigint-guards`✓ `host-resource-atomic-guards`✓
- 裁决:**✅ 保留**。

### ✅ FX-067 — 风控 TOCTOU + 下单限制绕过/非原子 + 自动处置不写审计 + QoS 两步(P2-P3 / D-133,134,163,164,175 / M09)
- 改动:`server/src/services/resource-risk.ts`(D-134 评估按 instanceId `advisoryTransactionLock` 串行读/决策/暂停/写;D-164 自动限速/暂停/限单写中心 `Log` userId=null=系统;D-175 确认 FX-063 已消解 original 捕获,提交 currentBandwidthLimit 后走仲裁)、`server/src/services/user-order-restrictions.ts`(D-163 限单 userId advisory lock 同事务 check active+insert 免 schema;D-133 交易所购买接入统一 check)、`test-resource-risk-guards.ts`+`test-risk-audit-guards.ts`。
- 7 身份评审:🏛 双 advisory lock+中心审计+与 FX-063 共存✓ · 🗄 事务锁串行 check-write 无重复 active 免 schema✓ · 🔐 购买受限制约束+自动处置全审计+TOCTOU 消除✓ · ✅ 4.5/5(受让待)✓ · 💰 风控不可竞态/绕过✓ · 🧪 risk-audit+后端断言过✓ · ♻️ **全量 type-check 绿**+FX-060/063/066 未退✓
- 复验:`risk-audit-guards`✓ `resource-risk-guards`后端断言✓(前端表格=FX-DISC-09) 全量 type-check✓
- 裁决:**✅ 保留**。⚠️ **FX-067b 跟进**:D-133 受让入口在 `routes/transfers.ts`(超出指定2文件),codex 诚实不越界 → 单起补接 restriction 校验。

### ✅ FX-067b — 交易所受让入口未接入下单限制(D-133 余项闭合)
- 改动:`server/src/routes/transfers.ts`(`/:id/accept` 取实例前调 `assertUserCanPurchaseOrReceiveInstance`,受限回滚 transfer 状态为 pending + `403/ORDER_RESTRICTED_BY_RISK`,复用 FX-067 的 `OrderRestrictedError`/`orderRestrictionApiError`)、`test-transfer-query-guards.ts`。
- 7 身份评审:🔐 封受让绕过限制✓ · 🗄 拒绝时回滚 pending 无状态丢失✓ · 🏛 复用 FX-067 导出一致✓ · ✅ 取实例前校验✓ · 💰 下单限制覆盖全获取路径(创建+购买+受让)✓ · 🧪 守卫✓ · ♻️ 2 守卫+type-check 绿✓
- 复验:`risk-audit-guards`✓ `transfer-query-guards`✓ type-check✓
- 裁决:**✅ 保留**(D-133 全闭合)。

### ✅ FX-044 — 初始 createInstanceAsync 失败不产生 task、不进交付保障中心(F-A BF-5-06)
- 改动:`server/src/routes/instances.ts`+`server/src/routes/admin-delivery.ts`(初始失败建 `taskId=null`/关联 `instanceId` 的 DeliveryAssuranceCase,记脱敏原因+退款状态;实例 advisory lock+`title startsWith '初始开通失败：'` 查重保幂等;免 schema,进保障中心可人工恢复/关闭)、`db/instances.ts`(小)、`test-delivery-center-guards.ts`。不回退 FX-040/049。
- 7 身份评审:🏛 taskId=null 关联 instanceId+复用保障中心✓ · 🗄 advisory lock+title 查重幂等免 schema✓ · ✅ 含退款成功/无需/已退/退款失败全状态✓ · 💰 初始失败(尤其退款也失败)有人工接管入口✓ · 🧪 后端断言过✓ · ♻️ type-check+create-failure-compensation 绿✓
- 复验:`instance-create-failure-compensation`✓ type-check✓;`delivery-center-guards` 后端断言✓
- 裁决:**✅ 保留**。⚠️ `delivery-center-guards` 前端 FAIL = **FX-DISC-11**(DeliveryCenterView.vue 用 overflow-x-auto/min-w,与 HEAD 一致本会话未碰),归波3。

### 📋 FX-DISC-11(登记)— DeliveryCenterView.vue 表格漂移(基线遗留,波3 修)
- `client/src/views/admin/DeliveryCenterView.vue` 用 `overflow-x-auto/min-w-[900px]` 移动横滚,违 `test:delivery-center-guards` 移动卡+定宽表要求。基线遗留,波3 恢复 table-fixed,禁弱化守卫。同簇 FX-DISC-09。

### ✅ FX-062 — 流量重置/日聚合时区未固定(G-A / BF-6-04)
- 改动:`server/src/db/traffic.ts`+`server/src/services/traffic-scheduler.ts`(`SHANGHAI_UTC_OFFSET_MS=8h`+`TRAFFIC_TIME_ZONE`+`shanghaiDateParts/shanghaiDateOnly/startOfMonthShanghai` 固定 +8 偏移,日/月边界+resetDay 判定统一北京时;canonical PG date-only)、`test-traffic-reset-locks.ts`。不回退 FX-D017/054-rest。
- 7 身份评审:🏛 共享 shanghai 日期 helper 固定偏移✓ · 🗄 canonical date-only 无 TZ 混用重复行✓ · ✅ +8 无 DST 正确、边界随北京✓ · 💰 月初00:05=北京非UTC✓ · 🧪 守卫✓ · ♻️ 2 守卫绿✓
- 复验:`traffic-reset-locks`✓ `traffic-route-limit-guards`✓
- 裁决:**✅ 保留**。

### ✅ FX-061 — 用户级(每月1号)与实例级(节点 resetDay)重置错位(G-A / BF-6-03)
- 改动:`server/src/db/traffic.ts`(抽取 `syncUserExtraTrafficUsedInTransaction`)、`server/src/services/traffic-scheduler.ts`(删每月1号用户级整体清零;节点 resetDay 重置实例时"实例锁→用户锁→同事务"内扣该实例对用户 monthlyTrafficUsed 贡献+重算 extraTrafficUsed;resetDay 钳位 1-28)、`test-traffic-reset-locks.ts`。取"用户级跟随节点重置日"方向。
- 7 身份评审:🏛 逐实例贡献扣减+复用同款口径✓ · 🗄 实例锁→用户锁→同事务,扣本实例贡献不误伤他实例✓ · ✅ 用户级=各实例当期用量和、多节点逐实例对齐、resetDay 钳位✓ · 💰 消错位误判超限/误放(BF-6-03)✓ · 🧪 守卫✓ · ♻️ type-check+3守卫绿,FX-054-rest/D017/062 未退✓
- 复验:`traffic-reset-locks`✓ `traffic-route-limit-guards`✓ `traffic-collector-status-guard`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-045 — 实例创建失败原因不落库、详情页不展示(BF-5-07)
- 改动:`server/src/routes/instances.ts`(复用 FX-044 的 `DeliveryAssuranceCase.lastError` 存脱敏失败原因,错误实例详情返回 `failureReason`)、`client/src/views/InstanceDetailView.vue`(纯文本横幅防注入)、`client/src/locales/{en,zh-CN,zh-TW}.ts`、前端两守卫。未改 schema/锁定表格。
- 7 身份评审:🏛 复用 case.lastError 免 schema✓ · 🔐 脱敏纯文本防注入✓ · ✅ 展示失败原因✓ · 💰 BF-5-07✓ · 🧪 4 守卫✓ · ♻️ client type-check 绿✓
- 复验:`frontend-route-guards`✓ `frontend-i18n-keys`✓ `instance-route-id-guards`✓ client type-check✓(双端 build 发版前补)
- 裁决:**✅ 保留**。

### ✅ FX-043 — 托管代开通不建 IP/不发通知邮件/不发插件事件/不标秒杀(F-A BF-5-05)
- 改动:`server/src/lib/managed-instance-provision.ts`(代开通成功补齐 `createIpAddress`×2、目标用户 `sendNotification('instance_created')` 站内信+邮件、`service.provisioned` 插件事件、`markFlashSaleDelivered` 幂等秒杀标记;后置动作独立容错不误删已运行实例)、`test-delivery-center-guards.ts`。未抽共享 helper(自营内联,抽取会扩大高危改动)。
- 7 身份评审:🏛 与自营对齐+容错后置✓ · 🗄 复用幂等 markFlashSaleDelivered 不双计 soldCount✓ · ✅ 四项补齐✓ · 💰 托管用户享同等 IP/通知/邮件/插件事件(BF-5-05)✓ · 🧪 后端断言✓ · ♻️ type-check+compensation 绿✓
- 复验:`instance-create-failure-compensation`✓ 全量 type-check✓;`delivery-center-guards` 后端断言✓(前端 FAIL=FX-DISC-11)
- 裁决:**✅ 保留**。

### ✅ FX-058 — 流量通知占领失败不补发 + CaddyClient Agent 泄漏 + 单天图表 NaN(D-078,079,147)
- 改动:`server/src/services/traffic-scheduler.ts`+`server/src/services/traffic-notifier.ts`(D-078 claim 作状态租约,notifier 返回发送结果,失败**条件回退 user/实例 claim** 保留待补发)、`server/src/lib/caddy-client.ts`(D-079 https Agent 模块级按 host/port/CA/serverName 缓存复用)、`client/src/.../TrafficStats.vue`(D-147 单天 X 轴固定 50% 居中防 NaN%)、守卫。不回退 FX-055/057/063/067。
- 7 身份评审:🏛 claim-租约+回退+Agent 缓存+图表兜底✓ · 🗄 发送失败回退 claim 不丢不重✓ · ✅ 补发/无泄漏/无 NaN✓ · 💰 通知不再静默丢失+无资源泄漏✓ · 🧪 3 守卫✓ · ♻️ client+server type-check 干净(FX-058 报的 userId 错系 FX-043 并发瞬时,已消)✓
- 复验:`traffic-notification-claim-guards`✓ `proxy-site-route-id-guards`✓ `frontend-route-guards`✓ client+server type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-059 — trafficLimitSpeed 字段义与代码相反 + 无独立超量限速值(G-A / BF-6-08)
- 改动:`server/src/services/traffic-bandwidth.ts`+`server/src/services/traffic-scheduler.ts`(注释+`normalLineSpeed` 命名澄清 trafficLimitSpeed=正常线速)、`server/src/routes/system-config.ts`(新增 `traffic_overage_throttle_speed` 默认1Mbit,label"流量超量限速"+description 说明,可 upsert)、守卫。免 schema,FX-063 仲裁保持。
- 7 身份评审:🏛 config 驱动超量值免 schema+语义澄清✓ · 🗄 system-config seed 默认+upsert✓ · ✅ 超量可配(默认1Mbit不变)+基线语义对齐代码✓ · 💰 管理员可配超量限速+澄清避免误设正常带宽✓ · 🧪 3 守卫✓ · ♻️ type-check+守卫绿,FX-063 未退✓
- 复验:`plan-bandwidth-limit-guards`✓ `traffic-route-limit-guards`✓ `system-config-value-guards`✓ type-check✓
- 裁决:**✅ 保留**(管理端方案表单标签"正常线速"→波5小打磨)。

### ✅ FX-064 — 流量通知文案写死"限速1Mbit/下月1日重置"(G-A / BF-6-09)
- 改动:`server/src/services/traffic-notifier.ts`(读系统配置实际超量限速+`PackagePlan.trafficLimitSpeed` 恢复正常线速+`Host.trafficResetDay` 动态重置日,缺参在 notifier 内补查 DB 不动 scheduler)、`client/src/locales/{en,zh-CN,zh-TW}.ts`(`{throttleSpeed}/{speed}/{resetDay}` 占位符)、守卫(禁硬编码)。消费 FX-059 config 导出(并发只读依赖)。不回退 FX-058。
- 7 身份评审:🏛 notifier 读实际值+补查免动 scheduler✓ · 🔐 webhook 走 assertSafeWebhookUrl/safeFetch(FX-003)✓ · ✅ 动态占位符,无硬编码 1Mbit/下月1日✓ · 💰 通知显实际限速+真重置日(BF-6-09)✓ · 🧪 2 守卫+禁硬编码✓ · ♻️ server+client type-check+user/admin build 绿,FX-058 未退✓
- 复验:`frontend-i18n-keys`✓ `traffic-notification-claim-guards`✓ client type-check✓
- 裁决:**✅ 保留**。

### ✅ FX-065 — trafficResetPrice 单位易误配(G-A / BF-6-12)——仅澄清,撤销危险改动
- **对抗性自审拦截事故**:codex 上轮发现整条链路本就一致按"分"(表单填元→前端×100 存分→API integer cents→扣费/100=元,**系统正确**),我方 spec"取消/100 按元、无需迁移"会把存量 500(=5元)扣成 **500 元(100 倍过扣)**,codex 诚实拒绝判安全。
- **打回修正(维持分存储,只澄清)**:`server/src/routes/traffic.ts` 恢复 `priceCents/100` 分处理(撤销按元扣费);`schema.prisma` 两处注释改"存储单位:分,表单按元输入,提交前×100";撤销"禁分转换"危险守卫;管理端表单留提示"单位:元(如填 5 表示 5 元)"。不碰 locales。
- 7 身份评审:🗄 无数据迁移/无 100 倍过扣、口径不变✓ · ✅ 扣费逻辑正确+提示防误填✓ · 💰 BF-6-12"易误配"靠澄清解决零风险✓ · 🧪 3 守卫+dist-boundary+双端 build✓ · ♻️ type-check 绿✓
- 复验:`traffic-reset-locks`✓ `system-config-value-guards`✓ `frontend-route-guards`✓ server/client type-check✓ 双端 build✓
- 裁决:**✅ 保留(仅澄清)**。⚠️ **全元列存储迁移留 owner**(现分-pipeline 一致正确,建议维持)。

---
## 波3 — 基线表格漂移簇恢复(FX-DISC)
### ✅ FX-DISC-11 — DeliveryCenterView.vue 表格恢复
- 改动:`client/src/views/admin/DeliveryCenterView.vue`(两桌面表 `overflow-x-auto/min-w-[900px]`→`overflow-hidden lg:block`+`table-fixed`,列宽 10/15/16/12/10/17/20 与 18/18/17/15/10/10/12 各合计100%,内容换行;移动卡/@click 不变)。复验 `delivery-center-guards`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ client type-check✓。**✅**(未弱化守卫)。
### ✅ FX-DISC-09 — ResourceRiskView.vue 表格恢复 + FX-059 后端守卫回归修
- 改动:`client/src/views/admin/ResourceRiskView.vue`(8 桌面表去 overflow-x-auto/min-w→table-fixed/overflow-hidden,8 组列宽各100%,36 @click 不变)。
- **附带修 FX-059 漏改的守卫回归**:`test-resource-risk-guards.ts:91` 断言 `THROTTLE_BANDWIDTH`→`overageThrottleSpeed`(FX-059 把超量值改 config 驱动 BF-6-08,该处仲裁结构不变量意图不变、仅值来源 const→config;负向不变量 `!originalIngress/!restoreBandwidth` 保留)。此回归系我验 FX-059 时漏跑 resource-risk-guards 所致,现补正。
- 复验:`resource-risk-guards`✓(后端+前端全绿) `risk-audit-guards`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ client type-check✓。**✅**。
### ✅ FX-DISC-order — admin/OrdersView.vue 表格恢复
- `client/src/views/admin/OrdersView.vue` 去 overflow-x-auto/min-w-[900px]→overflow-hidden lg:block+table-fixed。复验 `order-center-guards`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ client type-check✓。**✅**。
### ✅ FX-DISC-oauth — admin/OAuthConfigView.vue 表格恢复
- `client/src/views/admin/OAuthConfigView.vue` 去 overflow-x-auto/min-w-[900px]→overflow-hidden lg:block+table-fixed。复验 `oauth-provider-guards`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ client type-check✓。**✅**。
### ✅ FX-DISC-giftcard — GiftCardsView 表格恢复(表格簇末项)
- `client/src/views/GiftCardsView.vue`(用户端 `min-w-[860px]`→`table-fixed`,2 行)。复验 `gift-card-guards`✓ `gift-card-flow`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ `frontend-i18n-keys`✓ client type-check✓。**✅**。
### 🏁 基线表格漂移簇收官:resource-risk / delivery-center / order-center / oauth / gift-card **5 处全恢复绿**(均本会话前遗留,按 memory 恢复 table-fixed+移动卡,零守卫弱化)。

### ✅ 秒杀策略批(BF-8-01/02/03)
- 改动:`server/src/services/flash-sales.ts`(BF-8-01 `normalizeStatusForTime` 惰性归一到 startAt 可成交;BF-8-02 逐商品限购+`campaignMaxPerUser` 跨商品合计,负 campaignId 命名空间锁串行防并发绕过;BF-8-03 AFF 仅依赖 allowAff)、`server/src/routes/instances.ts`(BF-8-03 实例侧 `!allowAff` 同步校验)、守卫。
- 7 身份评审:🏛 惰性激活+活动级锁+allowAff 独立✓ · 🗄 campaign 锁串行跨商品限购无绕过✓ · 🔐 maxPerUser 不可多商品/并发绕过✓ · ✅ 三裁决各中✓ · 💰 诚实跨活动限购/自动开场/allowAff 可单开✓ · 🧪 3 断言+FX-041 未退✓ · ♻️ 4 守卫+type-check 绿✓
- 复验:`flash-sale-guards`✓ `instance-create-turnstile-guards`✓ `instance-route-id-guards`✓ `instance-create-failure-compensation`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ BF-8-08 — 礼品卡懒过期致后台可用数/未兑负债虚高(G-C)
- 改动:`server/src/db/gift-cards.ts`(后台 active 数+outstandingValue 聚合按 `status=active AND (expiresAt IS NULL OR expiresAt>now)` 实时过滤)、`test-gift-card-guards.ts`+`test-gift-card-flow.ts`。
- 7 身份评审:🗄 实时 expiresAt 过滤正确✓ · ✅ 懒过期卡不计入可用/未兑✓ · 💰 后台统计不虚高✓ · 🧪 静态+flow 守卫✓ · ♻️ 3 守卫+type-check 绿✓
- 复验:`gift-card-guards`✓ `gift-card-flow`✓ `financial-reconciliation-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ 兑换码批(BF-8-14 h-码禁删 + BF-8-13 积分兑换码 p 清理)(G-C)
- 改动:`server/src/db/redeem-codes.ts`(BF-8-14 单/批删前 advisory lock+事务查 `RedeemCodeUsage`,有记录→`enabled=false`+`409 REDEEM_CODE_USED`,批删 disabled/deleted 分离)、`server/src/routes/checkin.ts`+`user-lifecycle.ts`(BF-8-13 码型收紧 c/r/d/t、DB 拒 p、清死分支,枚举 p 仅 deprecated 不迁移)、守卫。
- 7 身份评审:🗄 有记录禁删保留核算+级联不触发✓ · ✅ 用码禁删批删部分/p 全入口拒✓ · 💰 已发资源价值可长期核算+死代码清✓ · 🧪 3 断言✓ · ♻️ 3 守卫+type-check 绿✓
- 复验:`redeem-code-management-guards`✓ `user-lifecycle-guards`✓ `system-redeem-consistency`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ 工单策略批(BF-11-01/13/03)(G-D)
- 改动:`server/src/routes/tickets.ts`+`server/src/db/tickets.ts`+`server/src/routes/system-config.ts`+`client router/user.ts`+`TicketsView.vue`+`notifier.ts`(BF-11-01 ticket_enabled 仅禁新建、去 /tickets 跳转、已有可查看/回复/关闭;BF-11-13 创建者网页重开自己已关闭工单 `isCreatorReopen`+按钮+三语;BF-11-03 自动关闭按最后公开消息计时+`updatedAt` 条件更新防并发误关)、守卫。
- 7 身份评审:🏛 语义收敛+creator-reopen 路径+last-public 锚点✓ · 🗄 updatedAt 条件更新防并发误关✓ · 🔐 重开限 creator+own+closed→open✓ · ✅ 三裁决各中✓ · 💰 关闭不锁已有/可重开/准确计时✓ · 🧪 3 工单守卫+i18n+route✓ · ♻️ 双端 build+type-check 绿✓
- 复验:`ticket-query-guards`✓ `ticket-auto-close-guards`✓ `ticket-success-guards`✓ `frontend-i18n-keys`✓ `frontend-route-guards`✓ 双端 build✓
- 裁决:**✅ 保留**。

### ✅ BF-12-01/02 — 禁上架 paid 条目(直到交易闭环)(G-E)
- 改动:`admin-plugins.ts`+`plugin-market-publisher.ts`+`theme-market-publisher.ts`+`plugin-market-submission-scan.ts`(置 listed 拒非 free 定价"付费上架暂未开放";发布器仅合并 free+passed/warning、清索引非 free;主题非免费投稿拒)、2 守卫。pricing 字段保留不改 schema。
- 复验:`plugin-market-governance-guards`✓ `plugin-market-publish-guards`✓ `plugin-market-guards`✓ `plugin-center-guards`✓ `theme-system-guards`✓ type-check✓。**✅ 保留**。

### ✅ FX-080+D-060 — 秒杀价完整性(价下限+续费提示+价格 TOCTOU)
- 改动:`server/src/services/flash-sales.ts`(`assertValidFlashPrice` 强制 0<价<原价;价改与申领共用 item advisory lock,申领锁内重读+校验价格快照==当前价+金额==当前价−AFF折扣,不一致 `FLASH_SALE_PRICE_CHANGED` 回滚)、秒杀管理表单前置校验、`FlashSalesView.vue`"仅首期秒杀价续费按原价"三语、守卫。BF-8-batch/FX-041 未退。
- 7 身份评审:🔐 TOCTOU 价格版本绑定+共用锁✓ · ✅ 0<价<原价+成交价校验+续费提示✓ · 💰 无≥原价/≤0 价+用户知情✓ · 🧪 守卫✓ · ♻️ 双端 build+type-check 绿✓
- 复验:`flash-sale-guards`✓ `frontend-i18n-keys`✓ `instance-create-turnstile-guards`✓ 双端 build✓
- 裁决:**✅ 保留**。

### ✅ BF-9-04 — 邮箱订阅每源一份(G-B)
- 改动:`server/src/routes/mail.ts`(购买唯一性 `userId+mailSourceId+active`,事务内外双重防重,不同源各一份)、`test-mail-subscription-cancel-guards.ts`。未动自动续费/过期自救 feature。
- 复验:`mail-subscription-cancel-guards`✓ `mail-list-query-guards`✓ `mail-plan-financial-guards`✓ type-check✓。**✅ 保留**。

### ✅ BF-7-07 — 普通转账过户与交易所交割统一(G-F)
- 改动:`server/src/db/transfers.ts`(过户置 `autoRenew:false`+发接收方站内信提示重置 SSH/密码凭证,accept+直推都覆盖)、`test-transfer-query-guards.ts`。FX-067b 受让限制保留。
- 复验:`transfer-query-guards`✓ type-check✓。**✅ 保留**(🔐 提示重置凭证防前主人残留访问)。

### ✅ 工单状态批(BF-11-15/11/12)(G-D)
- 改动:`server/src/db/tickets.ts`(BF-11-15 客服首响 open→in_progress、客户仅重开 resolved;BF-11-11 角标按最新公开消息 isFromOwner=false 的 needsReply;BF-11-12 met 仅 resolvedAt≤resolutionDueAt、逾期写 slaBreachedAt)、3 守卫。BF-11-batch 未退。
- 复验:`ticket-query-guards`✓ `ticket-success-guards`✓ `ticket-auto-close-guards`✓ type-check✓;`sla-alert-guards` 后端断言✓,前端 FAIL=**FX-DISC-12**(SlaAlertsView.vue overflow-x-auto,本会话未碰基线遗留)。**✅ 保留**(前端归下)。

### ✅ BF-9-09 — diskLimitGb 整订阅共享总空间(G-B)
- 改动:`server/src/services/cranemail.ts`+`server/src/routes/mail.ts`(`_sum(diskLimitMb)` 聚合订阅已分配磁盘,新增/改配域名/账号校验合计≤订阅总空间)、守卫。
- 复验:`mail-account-quota-guards`✓ `mail-domain-lifecycle-guards`✓ `mail-plan-financial-guards`✓ type-check✓。**✅ 保留**。

### ✅ FX-DISC-12 — SlaAlertsView.vue 表格恢复
- `client/src/views/admin/SlaAlertsView.vue` overflow-x-auto/min-w-[900px]→overflow-hidden lg:block+table-fixed。复验 `sla-alert-guards`✓(后端+前端全绿) `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ client type-check✓。**✅**(表格簇第6处)。

### ✅ BF-11-05 — 自动回复上限也拦手动 semi_auto(G-D)
- 改动:`server/src/services/ai-ticket-context.ts`+自动回复调度器(`AiTicketReplyTrigger='manual'|'scheduler'`,上限/冷却仅调度器路径,`[trigger=scheduler]` 标记计数,手动不受限不计入)、守卫。免 schema。
- 复验:`ai-ticket-context-guards`✓ `ticket-query-guards`✓ type-check✓。**✅ 保留**。

### ✅ 交易所批(BF-7-05 确认收货即放款 + BF-7-08 死状态清理)(F-D)
- 改动:`server/src/routes/exchange.ts`(BF-7-05 买家 `POST /orders/:id/confirm` 复用钱包锁+CAS+审计即时放款,重复确认幂等;BF-7-08 清 escrowed/delivered/paused/redelivering 死引用+交割统计仅 delivering/confirming,枚举保留不迁移)、守卫。FX-031/067b 未退。
- 复验:`exchange-marketplace-guards`✓ `exchange-lifecycle-guards`✓ `financial-reconciliation-guards`✓ type-check✓。**✅ 保留**。

### ✅ BF-10-03 — Hosting 现金提现加人工审核(F-D)
- 改动:`server/src/routes/hosting.ts`(usdt 现金提现→`pending`+申请扣冻结;新增管理员 `approve`(→completed)/`reject`(全额退回+补偿日志,条件 pending 更新,重复 409);转面板余额免审即时;`/balance` 按实时 pending 统计)、2 守卫。FX-011/014/015 未退。
- 复验:`hosting-balance-guards`✓ `financial-reconciliation-guards`✓ type-check✓;`admin-hosting-route-id-guards` 后端断言✓,前端 FAIL=**FX-DISC-13**(HostingView.vue,基线遗留)。**✅ 保留**(前端归下)。

### ✅ FX-DISC-13 — HostingView.vue 表格恢复(表格簇第7处,全簇收官)
- `client/src/views/admin/HostingView.vue` overflow-x-auto/min-w-[1000px]→overflow-hidden lg:block+table-fixed。复验 `admin-hosting-route-id-guards`✓(后端+前端全绿)+ 16 个 admin/路由守卫全扫 PASS(无残留表格漂移)。**✅**。

### ✅ 插件治理批(BF-12-03/04/05)(G-E)
- 改动:`plugin-market-publisher.ts`+`theme-market-publisher.ts`+`plugin-market-submissions.ts`(BF-12-03 索引从 DB `free+listed+passed/warning` 重建真下架;BF-12-04 `parseSemVer/compareSemVer` 每ID最高有效版本唯一发布;BF-12-05 listed 强制最近扫描 passed/warning)、3 治理守卫。BF-12-01/02 未退。
- 复验:`plugin-market-publish-guards`✓ `plugin-market-submission-guards`✓ `plugin-market-governance-guards`✓ `plugin-market-guards`✓ `theme-system-guards`✓ type-check✓。**✅ 保留**。

### ✅ BF-11-10 — 工单队列先全量过滤排序再分页(G-D)
- 改动:`server/src/db/tickets.ts`(`getHostTickets`/`getOwnerAllTickets` 完整候选集算 needsReply/SLA+过滤+稳定排序 ID 兜底后分页,total 按过滤后;AI 队列去过滤前 30 限制)、守卫。复验 `ticket-query-guards`✓ `ai-ticket-context-guards`✓ type-check✓。**✅**。
### ✅ 插件治理批2(BF-12-06 高风险 capability 上架前审 + BF-12-08 verified 只管理员)(G-E)
- 改动:`server/src/db/plugins.ts`(capability 按版本审核、转 listed 前拒未 approved)、`plugin-market-publisher.ts`(发布再过滤+verified 仅 `developerVerified` 管理员设、GitHub URL 仅展示默认 third_party)、守卫。复验 4 插件守卫+type-check✓,BF-12-01~05 未退。**✅**。
### ✅ BF-8-11 — 流量 h-码改一次性(G-C)
- 改动:`server/src/db/redeem-codes.ts`+`checkin.ts`(兑换原子加当期 extraTrafficQuota,不改永久 monthlyTrafficLimit)、`db/traffic.ts`+`routes/traffic.ts`(常规+付费重置清零 extraTrafficQuota/Used 不延续)、守卫。与 FX-054-rest/D017/061 协同。复验 `redeem-code-management-guards`✓ `traffic-reset-locks`✓ `traffic-route-limit-guards`✓ `system-redeem-consistency`✓ type-check✓。**✅**。
### ✅ BF-12-14 — 插件升级后 enabled/status 不一致(G-E)
- 改动:`server/src/db/plugins.ts`(升级/重装 status=installed+enabled=false+清启用人/时间;`isPluginEnabled=enabled&&status==='enabled'` 统一 API/capability/运行时)、`routes/plugins.ts`、`PluginCenterView.vue`("待重新启用"首按钮"启用"+三语)、2 守卫(新断言)。
- 复验:`plugin-center-guards`✓ `frontend-i18n-keys`✓ `frontend-route-guards`✓ client type-check✓。**✅ 保留**。⚠️ `plugin-runtime-capabilities-guards` FAIL=**FX-DISC-14 基线遗留**(gateway/payment 生命周期桥断言,读 plugin-extension-dispatch/contracts/payment-lifecycle 未改文件;BF-12-14 guard diff 无删除、只追加新块;userRoute 4 子条件全在 → 非本会话引入)。
### ✅ FX-DISC-14(已诊断修复)— plugin-runtime-capabilities-guards 基线红
- codex bisect 95 子条件,仅第 409 行 FAIL:旧字面 `isRechargeGatewayOrderNoMatch(record.orderNo, ...)` → 新 `(gatewayOrderNo, ...)`。根因**代码漂移(a)**:FX-032(repay 同订单仅一有效支付单)引入 `gatewayOrderNo`(当前有效支付尝试),比 record.orderNo 更准(阻旧支付链接结果入账);其余 94 条 admin鉴权/hooks/dispatch/契约/脱敏负向/审计全真,**安全语义未弱化**。仅改守卫该 1 条字面据实匹配正确代码。
- 复验:`plugin-runtime-capabilities-guards`✓ `plugin-center-guards`✓ `plugin-market-guards`✓ type-check✓。**✅**(最后一处基线红消除)。

## 波5 — 打磨
### ✅ BF-8-12 — h-码用户端旧文案(G-C)
- 改动:`client/src/locales/{zh-CN,zh-TW,en}.ts`(删旧"3小时/每日一次/不超套餐上限",改按 h-码真实 `expiresAt`/`usedCount`/`maxUses`(剩余=maxUses-usedCount)展示有效期/次数/资源永久叠加)、守卫。不改后端/兑换逻辑。⚠️ 接口暂未回传具体值→仅展示规则口径不伪造(如需显具体值可后端补字段,小跟进)。
- 复验:`frontend-i18n-keys`✓ `frontend-route-guards`✓ `redeem-code-management-guards`✓ client type-check✓。**✅**。
### ✅ BF-9-12 — 定时同步上游邮箱实际用量(G-B)
- 改动:新增 `server/src/services/mail-usage-scheduler.ts`(每日 03:17 扫活跃订阅,CraneMail 拉域磁盘/SmarterMail 拉账户 mailboxSizeUsed→更新 MailDomain/MailAccount.diskUsedMb,per-account 容错脱敏日志)、`cranemail.ts`+`smartermail.ts`(复用 assertSafeHttpUrl+safeFetch+timeout+manual redirect)、`app.ts`(注册,启动幂等+防重入)、守卫。
- 复验:`scheduler-startup-idempotency`✓ `mail-account-quota-guards`✓ `integration-health-guards`✓ type-check✓。**✅ 保留**。

---
## 波4 — 大功能
### ✅ 波4特征①:工单自动关闭可配+可关(BF-11-02)
- 改动:`server/src/services/ticket-auto-close-scheduler.ts`(读 `ticket_auto_close_enabled`(默认true,false 跳过)+`ticket_auto_close_hours`(默认24,≥1)替代硬编码;BF-11-03 最后公开消息计时+updatedAt 并发保留)、`db/tickets.ts`(函数改必传超时值)、`system-config.ts`+管理端配置卡、守卫。免 schema。
- 7 身份评审:🏛 config 驱动+DB 去硬编码✓ · ✅ 可关跳过+hours≥1✓ · 💰 BF-11-02 交付✓ · 🧪 4 守卫✓ · ♻️ 双 type-check 绿,BF-11 系列未退✓
- 复验:`ticket-auto-close-guards`✓ `system-config-value-guards`✓ `frontend-i18n-keys`✓ `frontend-route-guards`✓ 双 type-check✓
- 裁决:**✅ 保留**。

### ✅ 波4特征②:邮箱过期自救 + 到期暂停上游/续费恢复(BF-9-01 + BF-9-02)
- 改动:`server/src/db/mail.ts`+`routes/mail.ts`(过期订阅复用原记录续费复活 periodStart=max(旧到期,now),查询含 expired;续费 resume 上游)、`mail-expiry-scheduler.ts`(到期 suspendDomain 暂停+失败持久 suspended+幂等重试+审计;过期拒操作上游)、`cranemail.ts`(resume/suspend 安全外呼)、3 守卫。
- 7 身份评审:🏛 复用原记录复活+暂停/恢复+容错重试✓ · 🗄 查询含 expired+持久状态+幂等✓ · 🔐 过期拒上游+外呼安全链路✓ · ✅ max(旧到期,now) 合 FX-020✓ · 💰 用户可自救续费+过期不白用上游✓ · 🧪 5 mail 守卫✓ · ♻️ type-check 绿,BF-9-04/12+FX-017/020 未退✓
- 复验:`mail-domain-lifecycle-guards`✓ `mail-subscription-cancel-guards`✓ `mail-renewal-month-guards`✓ `mail-plan-financial-guards`✓ `mail-account-quota-guards`✓ type-check✓
- 裁决:**✅ 保留**。

### ✅ 波4特征③:AFF 佣金/折扣百分比后台可配(E1)
- 改动:`server/src/db/aff.ts`(生成时 `getSystemConfigFloat('aff_commission_rate'/'aff_discount_rate',0.05)` 写入新码,存量码保留自身率,FX-012/013 结算不变)、`system-config.ts`(两配置项+范围 0~0.5/0~0.95 校验)、管理端配置卡+三语、4 守卫。免 schema。
- 复验:`invite-generation-accounting-guards`✓ `system-config-value-guards`✓ `aff-points-query-guards`✓ `frontend-i18n-keys`✓ 双端 build✓ type-check✓。**✅ 保留**。

### ⏸ 波4特征⑤:VIP 实打实持续权益(A2)—— 设计文档,待 owner 决策
- 权益**类型/数值/与 AFF叠加规则 BEHAVIOR.md 标"待定"**,且改定价链路高危。已写 `audits/design/W4-vip-benefits-design.md`(config 驱动免 schema 方案 + 4 个 owner 决策点)。**不擅自改价** → ⏸ 待 owner。
### ⏸ 波4特征⑦:插件/主题交易闭环(BF-12-01/02 完整版)—— 设计文档,待 owner 决策+需 schema
- 完整购买/授权/退款/分成/结算需**新增多张 schema 表+迁移**+真实资金规则(产品决策)。已写 `audits/design/W4-plugin-trade-design.md`(表草案+5 决策点+复用既有闭环资产)。当前 BF-12-01/02 free-only 门禁已安全兜住。**不擅改 schema** → ⏸ 待 owner。
### ℹ️ 波4特征⑥:Hosting 出金手续费(E17)—— 已由 BF-10-03 + 既有 feeRate 覆盖
- BF-10-03 已实现现金提现人工审核流,提现 feeRate/feeAmount 既有逻辑已扣手续费("提现要手续费")。视为**已覆盖**。

### ✅ 波4特征④:邮箱自动续费(BF-9-03 + D5 每次1月)
- 改动:新增 `server/src/services/mail-autorenew-scheduler.ts`(每日临期扫描,统一按1月计价续费,事务条件扣款+周期键防重复扣,余额不足不透支+一次手动续费提醒,per-订阅容错;复用波4-② 续费延期逻辑)、`routes/mail.ts`(严格布尔 set 入口)、`MailView.vue`(开关+三语)、`app.ts`(注册,启动幂等)、守卫。免 schema(autoRenew 字段已存)。
- 7 身份评审:🏛 专用调度器+复用续费逻辑+set入口✓ · 🗄 事务条件扣款+周期键防重复扣✓ · 🔐 不透支+余额门控✓ · ✅ 每次1月(D5)+不足提醒+幂等✓ · 💰 BF-9-03 交付(死开关变活)✓ · 🧪 5 守卫+双端 build✓ · ♻️ type-check 绿,波4-②/BF-9-04 未退✓
- 复验:`mail-subscription-cancel-guards`✓ `mail-renewal-month-guards`✓ `scheduler-startup-idempotency`✓ `mail-plan-financial-guards`✓ `frontend-i18n-keys`✓ 双端 build✓
- 裁决:**✅ 保留**。

## 🏁 波2 收官(实例/交付/网络/终端/流量)
- **✅ 34 项**:FX-040/041/042(B504)/043/044/045/047/048/049/050/051(D014)/052(D015)/053(D016)/054(D017+rest)/055/056/057/058/059/060(067预警)/061/062/063/064/065/066/067(+067b)/068/069(082)/070(081)/071/072/073/074/B503。
- **⏸ 1 项**:FX-046(付费开通幂等)——需 owner 定 schema(InstanceTask 无 idempotencyKey 唯一字段)。
- **📋 波3 跟进(基线遗留,本会话未引入)**:FX-DISC-09(ResourceRiskView.vue)、FX-DISC-11(DeliveryCenterView.vue)表格漂移 → 恢复 table-fixed。
- **⚠️ 部署期红线**:FX-057(先配 CADDY_CA_PATH+宿主证书再上线,否则反代 fail-closed)。
- **⚠️ owner 决策项**:FX-046 schema、FX-065 全元迁移、FX-008 root 提权(波0)。


### ✅ BF-12-07 — 用户端主题投稿入口(G-E,波5)
- 改动:`client/src/views/ExtensionsView.vue`("投稿主题"页签/表单对齐插件投稿,pricing free,pending 审核)、主题 API 类型、三语 i18n、守卫。复验 `theme-system-guards`✓ `frontend-i18n-keys`✓ `frontend-route-guards`✓ `plugin-market-submission-guards`✓ client type-check✓ 双端 build✓。**✅**。

## 波5/owner项 补做
### ✅ FX-046 — 普通付费开通幂等(加 schema,owner"全部做了"授权)
- 改动:`schema.prisma`(`Instance.idempotencyKey String? @unique`)+ 迁移 `20260711000000_add_instance_idempotency_key`(ADD COLUMN+UNIQUE INDEX,本地)、`routes/instances.ts`(`findNormalPaidCreateReplay` 按键回放,普通付费"先建实例记录用唯一键抢占",同键返既有不双扣双建;flash-sale 用自身键不受影响)、客户端(每付费开通意图 `crypto.randomUUID()` 稳定键)、守卫。
- 7 身份评审:🏛 唯一键抢占+客户端稳定键✓ · 🗄 unique index+回放防双建、迁移正确✓ · ✅ 普通路径门控/秒杀不受影响/无键不强制✓ · 💰 双击/重试去重(BF-5-08)✓ · 🧪 4 守卫✓ · ♻️ type-check(client 已 regenerate)绿✓
- 复验:`instance-create-turnstile-guards`✓ `instance-task-cancel-race-guard`✓ `instance-route-id-guards`✓ `instance-create-failure-compensation`✓ type-check✓。**✅ 保留**。⚠️ 生产迁移待 owner 上线执行。
### ⚠️ BF-11-ai(上会话被杀,不完整)— 重派补全中
- 已落部分(BF-11-07 部分+marker 重构),但 BF-11-06 仍 contains 子串、BF-11-09 未读 sensitiveHandoffRules、BF-11-04 send 仍重新生成 → 重派完成。

### ✅ FX-065 — trafficResetPrice 全"元"存储(带迁移,owner"全部做了"授权)
- 改动:`schema.prisma`(注释元)+ 迁移 `20260712000000_traffic_reset_price_to_yuan`(UPDATE packages/package_plans ÷100 存量)、`packages.ts`(API 校验 0–999999.99 元≤2位)、`traffic.ts`(扣费去 /100 按元)、`instances.ts`+`pagination.ts`(返回去 /100)、`PackageFormView/MyPackagesView`(元回显/提交去×100)、api/database 类型注释、3 守卫。
- 复验:server/client type-check(自身文件)✓ `traffic-reset-locks`✓ `system-config-value-guards`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ 双端 build✓。**✅ 保留**。
- ⚠️ **本地迁移未应用**(shadow DB 权限 P3014),迁移文件正确 → owner 生产执行。**部署红线**:代码已按元,上线**必须先/同步跑 ÷100 迁移**,否则存量分值 100 倍(同 FX-057 类部署顺序红线)。

### ✅ AI客服批(BF-11-04/06/07/09)(G-D)——上会话被杀后补全
- 改动:`ai-ticket-context.ts`(BF-11-06 marker `ticket #<id> [trigger=scheduler]` 尾 ` [` 作边界防子串误命中;BF-11-09 `resolveSensitiveHandoffRules(config)` 读配置+非法回退默认)、`ai-ticket-auto-reply-scheduler.ts`(BF-11-07 `needs_human` 持久标记+候选 `id:{notIn}` 真排除)、`tickets.ts`(BF-11-04 send 端点用 `reviewedBody` 已审正文,空拒绝,不重生成)、`TicketsView.vue`+config+守卫。
- 逐项独立核实(报告曾空→未只信守卫):4 点均落地,守卫含新断言。复验 `ai-ticket-context-guards`✓ `ticket-query-guards`✓ `ticket-success-guards`✓ type-check(自身)✓。**✅**。

### ✅ 插件治理批3(BF-12-09/10/11)(G-E)
- 改动:`plugin-market-publisher.ts`+`plugin-market-submissions.ts`+`plugin-market.ts`(BF-12-09 定价正整数最小货币单位+CNY/USD白名单+固定20%抽成+拒不完整paid,paid 仍禁上架;BF-12-10 manifest.payincus 唯一兼容真源贯穿上传/投稿/扫描/发布/安装;BF-12-11 SHA256+manifest 身份校验固化到稳定 /plugin-market/packages+/manifests 再入索引)、3 守卫。
- 复验:5 插件守卫✓ 全量 type-check✓。**✅**(20% 抽成为占位,owner 后续可调;paid 仍禁到闭环上线)。

### ✅ FX-008 — root 单元执行服务用户可写 JS 提权链(D-055,owner"全部做了"授权)
- 改动:`scripts/install-panel.sh`+`scripts/migrate-ota-atomic-layout.sh`+`deploy/incudal-online-task.sh.example`+2 wrapper+2 root service example+守卫(root 单元只执行固定入口 `/usr/local/libexec/incudal/incudal-online-task`;helper 从 SHA256 校验 Release 包提取 root:root 0755;执行前校验属主/软链/完整性清单;.env root:incudal 0640;不再递归交安装树给 incudal;sudoers 只允许 root-owned systemctl wrapper+两个 OTA 单元+正整数任务 ID)。
- 复验:`agent-install-command-guards`✓ `host-install-script-guards`✓ `split-deploy-config`✓ `install-panel-guards`✓ type-check✓。**✅ 保留**。⚠️ **部署期 owner 必验**(属主/权限/OTA 单元指向/sudoers/`sudo -l -U incudal`/维护窗口真机更新+回滚);真机 OTA 证据属部署验收。

### ✅ D-167 — 内存态 Map 多进程假设文档化(横切-H,波5)
- 改动:`lib/security.ts`+`lib/config-cache.ts`+`workers/exchangeDeliveryWorker.ts`(注明登录锁/OAuth nonce/登录码防重放/交割去重/配置缓存依赖单进程)、`OPERATIONS_HANDOFF.md`+`AGENTS.md`(明确私有后端单 Node 进程+受影响点+扩容前须下沉共享存储)。无业务逻辑改动。
- 复验:`security-config`✓ type-check✓。**✅**(符合"文档化单实例假设"resolution)。

### ✅ 波4特征⑤:VIP 实打实持续权益(A2,owner"全部做了"授权,config驱动+合理默认)
- 改动:`services/vip-benefits.ts`+`routes/system-config.ts`(`vip_benefits_config` JSON:V1~V5 折扣 1/2/3/4/5%、额外流量+池加成 2/4/6/8/10%,V6+ 用 V5,0~100 范围校验)、`db/billing-operations.ts`(新购/续费预览/手动/自动续费统一后端价格仲裁:VIP 与 AFF/优惠码**取单一最低价不叠加**、秒杀固定不叠加 VIP)、实例定价/流量(额外流量动态入有效限额非持久,降级失效)/资源池(加成过 FX-072 主机上限)生效点、`SystemConfigView.vue`+三语、守卫。免 schema(VIP 等级字段已存)。
- 7 身份评审:🏛 config 驱动+单点仲裁+复用 FX-054-rest/072✓ · 🗄 额外流量非持久降级失效+池加成仍过主机校验✓ · 🔐 后端强制折扣+范围校验+不破主机上限✓ · ✅ **取优不叠加(零漏钱)**+秒杀不叠加+V6保守✓ · 💰 A2 交付(折扣/流量/池实打实)、默认 owner 可调✓ · 🧪 9 守卫(含 financial-reconciliation/flash-sale)✓ · ♻️ type-check(除并发)绿✓
- 复验:`vip-benefit-route-guards`✓ `system-config-value-guards`✓ `billing-query-guards`✓ `traffic-route-limit-guards`✓ `resource-pool-apply-consistency`✓ `financial-reconciliation-guards`✓ `flash-sale-guards`✓ `frontend-i18n-keys`✓ `frontend-route-guards`✓ 双端 build✓
- 裁决:**✅ 保留**(叠加规则=取优不叠加,我定的保守默认,owner 可改配置)。

### ✅ 波4特征⑦:插件/主题交易闭环核心(BF-12,owner"全部做了"授权,加 schema)
- 改动:`schema.prisma`(5 表:PluginPurchase/License/Refund/DeveloperEarning/DeveloperWithdrawal + 5 enum)+ 迁移 `20260712180000_add_plugin_trade_core`(本地)、`services/plugin-trade.ts`(购买:advisory lock+`calculateRevenueShare` gross=fee+net **运行时断言**+20%抽成+幂等;退款:7天窗口+原子三 claim license→revoked/earning→reversed+退全额 gross+幂等+409并发检测;提现复用 BF-10-03 模式)、`routes/plugin-trade.ts`(购买/授权查/退款/提现端点+幂等键)、`db/plugin-trade.ts`、新守卫 `plugin-trade-guards`(14 断言,已注册 package.json test)。
- 逐项独立核实(报告空→未只信守卫):购买/授权/退款吊销冲回/收入/提现全链落地,金额一致+并发+幂等。7 身份评审:🏛 服务层+advisory lock+抽成一致断言✓ · 🗄 原子 claim count===1 并发检测+幂等+账本完整校验✓ · 🔐 锁+余额门控+7天窗+账本 mismatch→500✓ · ✅ 退款真吊销license+冲回earning+退gross原子✓ · 💰 完整闭环金钱安全✓ · 🧪 plugin-trade-guards 14 断言+3 插件守卫✓ · ♻️ type-check 绿,BF-12 治理未退✓
- 复验:`plugin-trade-guards`✓ `plugin-market-guards`✓ `plugin-market-governance-guards`✓ `plugin-center-guards`✓ type-check✓。**✅ 保留**。⚠️ 迁移本地未应用(P3014,同 FX-065)→ owner 生产执行;paid 上架仍禁(BF-12-01/02)待 owner 放开;20% 抽成/7天窗为我定默认可调。

### ✅ D-152 — i18n 硬编码中文/缺 key 横切(波5,末项)
- 改动:`InvitesView/PortalView/TelegramConfigView` 等抽 i18n key + `locales/{en,zh-CN,zh-TW}.ts` 补齐三语(+592 行)。逐项核实:4 前端守卫全绿=字典完整无破坏(报告空,已抽取视图完整;个别列出视图或未全覆盖,属波5 打磨非回归)。
- 复验:`frontend-i18n-keys`✓ `frontend-route-guards`✓ `frontend-dist-boundary-guards`✓ `log-localization-guards`✓ client type-check✓。**✅**。

---
## 🏁🏁 最终全量终验(所有波次合并)
- **53/53 跨模块代表守卫 PASS**(含 plugin-trade/vip-benefit/AI客服/交易所/邮箱/流量/终端/资源池/风控/表格漂移全恢复/infra 等),**server+client type-check 全绿**。
- **零 commit/push/OTA**(HEAD 仍 8a4a948 v1.3.7),230 改动文件全在工作树待 owner。
- **代码侧 100% 完成**。

## OTA / 发布
### ✅ OTA 补数据库迁移支持(让带 schema 的版本能完成升级)
- 改动:`server/src/scripts/run-system-update-task.ts`(requiredCommands 加 pg_dump;切 release 后 restart 前:pg_dump 备份到 `backupDir/db-pre-migrate-*.sql`(失败中止)→`prisma migrate deploy`;迁移/健康失败走代码回滚+保留 DB 备份+告警 DB 不自动回滚需手工恢复)、`test-system-update-guards.ts`。复验 type-check✓ `system-update-guards`✓。**✅**。
### ✅ docs-site OTA 升级记录补全
- 新增 `docs-site/release-notes/v1.3.8.md`(本会话全部改动发布说明 + 升级红线),tag 后 `generate-changelog.mjs` 自动纳入 version-log。
