# PayIncus / Incudal — 项目统一规矩（AGENTS.md）

> 本文件是本仓库**所有 AI agent（Claude Code、codex 等）的统一工作规范**。
> `CLAUDE.md` 通过 `@AGENTS.md` 引用本文件 —— Claude Code 与 codex 读到的是**同一套规矩**，改这一个文件即可。
> 权威运维/发版事实以仓库根的 `OPERATIONS_HANDOFF.md`（操作手册）与 `HANDOFF.md`（版本证据台账）为准。

---

## 0. 沟通语言
- 与 owner 默认用**中文**沟通。

## 1. 这是什么项目
**PayIncus**（内部代号 `incudal`）——商用 Incus（LXC/KVM）NAT VPS 售卖与交付平台，**线上运营中**。当前生产版本 **v1.3.7**。pnpm monorepo：

| 目录 | 技术栈 / 作用 |
|------|----------------|
| `client/` | Vue 3 + Vite SPA。双端构建（`VITE_APP_ENTRY`）→ `dist/user`（pay.payincus.com）+ `dist/admin`（admin.payincus.com）。两端独立源、**不共享 cookie 域**。 |
| `server/` | Fastify 5 + Prisma 7 + PostgreSQL，~300 TS 文件、~70 路由、~15 调度/worker。无 Redis（用 PG advisory lock）。三套鉴权面：Web 的 JWT+refresh cookie、Public API 的 `pat_`/`poa_` token、host agent 的 HMAC。 |
| `agent/` | Go 宿主 agent，只读监控（心跳/资源/实例态/流量），HMAC 签名，自升级。 |
| 其它 | `docs-site/`（VitePress）、`deploy/`（systemd+Nginx）、`scripts/`（安装/校验/OTA）、`plugin-templates/`、`theme-templates/`。 |

部署：三层拆分（user / admin / 私有后端 `127.0.0.1:3001`），装机根 `/opt/incudal`，原子 OTA（`releases/<ver-ts>` + `current` 软链）+ 自动回滚。

### 私有后端必须单实例运行

- 私有后端 `127.0.0.1:3001` 必须且只能运行 **1 个 Node.js 进程实例**；禁止 cluster、多 systemd 副本、进程管理器多 worker、多容器副本或横向扩展。
- 该约束是架构正确性不变量：`server/src/lib/security.ts` 的登录失败锁、OAuth state nonce、一次性登录码防重放与导出任务状态，`server/src/workers/exchangeDeliveryWorker.ts` 的交割 finalize 重入去重，以及 `server/src/lib/config-cache.ts` 的配置缓存/更新失效均为进程内状态。
- PG advisory lock 只协调已落库任务，不会共享上述内存态。未来若要多进程或水平扩展，必须先将相关锁、nonce/防重放、去重和缓存失效下沉到 PostgreSQL 或其它共享存储；在此之前第二个后端副本属于不受支持的部署。

---

## 2. 🔴 硬规矩（不可协商，违反即事故）

1. **不碰生产**：未经 owner 明确要求，**绝不** OTA、发布、push、打 tag、改生产环境。
2. **不做破坏性 git**：未经 owner 明确要求，**绝不** `git reset`、`git checkout --`、强制删除、清理未跟踪文件、`git commit`/`git push`。
3. **高危路径先读后写**：改动以下任一领域，**必须先读相关代码 + 对应守卫测试**再动手：
   > 鉴权 · 支付 · 权限 · 风控 · 资源交付 · 兑换流程 · 实例创建 · OTA
4. **改动最小化**：修 bug / 发版期间**不做大范围重构**，只改必要的。
5. **绝不泄密**：任何 commit、handoff、总结、截图中都**不得**出现凭证 / token / cookie / 密钥。
6. **本地过 ≠ 生产验证**：本地通过、GitHub Actions、Release 资产、OTA、线上实证是**分开的证据**，不可混为一谈。
7. **每次改动必须过对应守卫**（见 §4），否则视为**未完成**。
8. `RUN_DB_CHECKS=0 bash scripts/apply-online-update.sh <ver>` 会**跳过 DB/支付就绪校验**，仅在 owner 明确批准时使用。

---

## 3. 本地怎么跑

- **环境**：Node ≥ 20、pnpm 9.14.2、本地 PostgreSQL 16。
- **装依赖**：`pnpm install`
- **一把起全部（server + user + admin）**：`pnpm dev`
- **分开起**：
  - 后端：`NODE_ENV=development JWT_SECRET=dev-secret-12345678 HOST=127.0.0.1 PORT=3001 pnpm --filter server exec tsx watch src/app.ts`
  - 用户前端：`pnpm dev:user`
  - 管理前端：`pnpm dev:admin`
- **端口**：后端 API **3001** · 用户前端 **3000** · 管理前端 **3002**（前端 dev 经 proxy 打到 3001）。

---

## 4. 🛡️ 守卫测试纪律（本仓库的命门）

`server/package.json` 里有 **200+ 个独立 `test-*-guards.ts`**。它们把关键业务/前端结构“钉死”，`pnpm test` 会跑全套（client+server type-check + 全部守卫）。**任何改动必须让相关守卫通过。**

- **全量**（慢，发版前跑）：`pnpm test`
- **单个**：`pnpm --filter server test:<guard-name>`
- **前端最常用三个**：
  - `test:frontend-route-guards` —— 路由 / **表格布局** / `@click` 路径断言
  - `test:frontend-dist-boundary-guards` —— 双端 dist 边界
  - `test:frontend-i18n-keys` —— i18n key 完整性
- **Go agent**：`pnpm test:agent`

### ⚠️ 表格布局守卫（最容易踩雷）
一批表被守卫**锁定**为“**移动卡 + PC 定宽表（`table-fixed` / `overflow-hidden`），绝不横向滚动**”，并**反向禁止** `overflow-x-auto` / `min-w-[...]` / 去掉 `table-fixed`。
- 想修“宽表挤压”时：**先判断该表是否在守卫清单里**。锁定表**只能在 `table-fixed` 内平衡列宽**（列宽百分比合计 = 100%）+ 允许单元格换行 + 靠移动卡应对窄屏；**不能**改成横向滚动。
- 受锁定的表（用户端）：`MyPackagesView`、`MyHostsView`、`TransfersView`、`OrdersView`、`InvitesView`、`FlashSalesView`、`HostingWalletView`、`InstancesView`、`LogsView`、`EntertainmentView`；（管理端）`admin/BillingView`、`admin/ImagesView`、`admin/HelpManageView`、`admin/MailView`、`admin/PluginCenterView`；（组件）`HostPublicIpv4Tab`、`InstanceLogsTab`、`ConfigEditModal`。
- 改任一前端文件后**必跑** `test:frontend-route-guards`。

---

## 5. 构建 / 校验命令

| 目的 | 命令 |
|------|------|
| 构建（含 dist 边界守卫）| `pnpm build` |
| 只构建前端 / 后端 | `pnpm build:client` / `pnpm build:server` |
| Lint（检查 / 自动修）| `pnpm lint` / `pnpm lint:fix` |
| 类型检查 | `pnpm --filter client type-check` · `pnpm --filter server type-check` |
| 全套守卫 | `pnpm test` |
| 文档站开发 / 构建 | `pnpm docs:dev` / `pnpm docs:build` |

---

## 6. UI 改动约束（单色重做进行中）

- **方向**：苹果式**纯黑白单色**（浅色=白底黑字，深色=黑底白字），去二次元/吉祥物/立绘。状态色**只保留绿/琥珀/红**三种（运行/待处理/失败）。
- **红线**：只改**样式 / 布局 / 文案层级**，**不碰**后端接口、权限、支付/订单/实例创建/OTA 等业务逻辑与路由行为——**功能 100% 不变**。
- **配色走 token 层**（`client/tailwind.config.js`）：一堆彩色 ramp 已映射到中性灰；`rose → 真红`（危险/亏损语义）**保留不可灰化**；游戏化模块（成就/签到/抽奖/稀有度）彩色**刻意保留**。
- `kawaii-cloud.css` **渐进改造、不重写**；单页去色用页面 `<style scoped>`。
- 动效可用 **GSAP**（已装 gsap-skills，见 `.claude/skills/`）；尊重 `prefers-reduced-motion`。

---

## 7. 协作模型（Claude Code ⇄ codex）

- **Claude Code = 技术负责人 / 集成方**：定根因、切任务、写规格、守不变量、审 diff、跑守卫、真机验证、管 git（**仅在 owner 同意时** commit / push）。
- **codex = 实现工人**：按 Claude 给的规格实现改动，尤其**低/中危、自包含、可并行**的块。
- **风险分档**：高危路径由 Claude 定根因 + 收紧规格；低/中危 codex 可端到端修。**任何一方改完都要跑相关守卫，Claude 统一审查后才进入下一步。**
- **避免冲突**：同一批文件一次只让一个 agent 改。

---

## 8. 一个改动的「完成」定义

1. 相关 **type-check** 通过；
2. 相关 **守卫测试** 通过；
3. 若动前端 → **双端 build** 通过；
4. **真机跑过**受影响流程（不是只看测试）；
5. **报告**：改了哪些文件 / 为什么 / 风险 / 怎么验证的。

以上任一未满足 = **未完成**。
