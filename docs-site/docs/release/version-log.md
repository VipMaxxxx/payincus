# 系统版本更新日志

<!-- 此文件由 docs-site/scripts/generate-changelog.mjs 自动生成。请不要手动编辑。 -->

该页面从仓库 Git tag 和 commit 自动生成，用于展示系统版本演进。后台 OTA 的“可更新版本”和生产部署仍以 GitHub Release tag 为准。

## 最新发布状态 / Latest Release State

- 最新发布提交 / Latest Release Commit: `6fb574b`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.7
- 最新 tag / Latest tag: `v0.9.7`

## 未发布变更 / Unreleased Changes

### 其他变更 / Other Changes

- Clarify capacity sold-out docs `3ffef07`

## 历史版本 / Historical Versions

## v0.9.7

- 发布提交 / Release commit: `6fb574b`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.7

Fix the admin resource-risk evidence drawer so it renders above the admin chrome with solid light and dark backgrounds.

Keep evidence snapshot cards, tables, and JSON blocks readable instead of inheriting transparent themed surfaces.

## v0.9.6

- 发布提交 / Release commit: `031d93c`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.6

Fix public package sold-out detection to include disk capacity, keeping market availability aligned with backend instance creation checks.

Update production readiness warnings and docs to describe CPU, memory and disk capacity requirements.

## v0.9.5

- 发布提交 / Release commit: `4fb5d03`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.5

Fix themed surface transparency so admin risk evidence drawers and themed cards render with solid backgrounds.

Keep docs version logs focused on real release changes by filtering handoff and version-log sync commits from unreleased changes.

## v0.9.4

- 发布提交 / Release commit: `15e6c63`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Close OTA worker database on skipped duplicate

### 其他变更 / Other Changes

- Close OTA worker database on skipped duplicate `15e6c63`

## v0.9.3

- 发布提交 / Release commit: `d1290ac`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Guard OTA workers against duplicate starts

### 其他变更 / Other Changes

- Guard OTA workers against duplicate starts `d1290ac`

## v0.9.2

- 发布提交 / Release commit: `e67fc89`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Handle Turnstile in split auth smoke

### 其他变更 / Other Changes

- Handle Turnstile in split auth smoke `e67fc89`

## v0.9.1

- 发布提交 / Release commit: `763baaf`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix split auth smoke in production artifacts

### 修复与稳定性 / Fixes and Stability

- Fix split auth smoke in production artifacts `763baaf`

## v0.9.0

- 发布提交 / Release commit: `aa087db`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Release v0.9.0

### 其他变更 / Other Changes

- Document resource risk operations `430d0bc`

## v0.8.9

- 发布提交 / Release commit: `bf3d86e`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.9

Resource risk admin pagination and source-scoped manual order restriction controls.

## v0.8.8

- 发布提交 / Release commit: `359501c`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Update version log for v0.8.8

PayIncus independent baseline release with rebuilt public docs, SDK examples, extension/theme templates, and clean public attribution.

## v0.8.7

- 发布提交 / Release commit: `8df3634`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance plan upgrade capacity checks

### 修复与稳定性 / Fixes and Stability

- Fix instance plan upgrade capacity checks `8df3634`

## v0.8.6

- 发布提交 / Release commit: `20f9209`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add manual resource risk controls

### 新增能力 / New Capabilities

- Add manual resource risk controls `20f9209`

## v0.8.5

- 发布提交 / Release commit: `51e2df0`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden OTA Prisma client generation

### 修复与稳定性 / Fixes and Stability

- Harden OTA Prisma client generation `51e2df0`

## v0.8.4

- 发布提交 / Release commit: `7c476d2`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add instance resource risk center

### 新增能力 / New Capabilities

- Add instance resource risk center `7c476d2`

## v0.8.3

- 发布提交 / Release commit: `1a82f05`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance bandwidth and billing nav display

### 修复与稳定性 / Fixes and Stability

- Fix instance bandwidth and billing nav display `1a82f05`

## v0.8.2

- 发布提交 / Release commit: `4f5bb5e`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Add package traffic reset pricing

### 新增能力 / New Capabilities

- Add package traffic reset pricing `4f5bb5e`

## v0.8.1

- 发布提交 / Release commit: `4a131d7`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Harden storage readiness and traffic reset

### 修复与稳定性 / Fixes and Stability

- Harden storage readiness and traffic reset `4a131d7`

## v0.6.19

- 发布提交 / Release commit: `d60bf6d`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Fix instance transfer path release guard

- 继续发布用户端实例产品卡片和创建实例自动命名能力。
- 修复实例卡片 PUSH 跳转的前后台构建边界，避免后台包包含用户端固定转让路径。
- 更新 route guard 以覆盖新的 transfersPath helper 形态。

## v0.6.18

- 发布提交 / Release commit: `5c8668a`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish instance cards and creation naming

- 用户端实例卡片改为产品信息卡样式，集中展示地区、节点、套餐、配置、网络、流量、价格、到期时间和自动续费。
- 实例卡片新增管理、PUSH、续费入口，并复用现有单实例续费/自动续费能力。
- 创建实例时自动生成安全实例名称，支持手动覆盖和重新生成；后端 API 在 name 缺省时也会兜底生成。
- 侧边栏分组标题增加翻译兜底，避免显示裸 key。

## v0.6.17

- 发布提交 / Release commit: `e9c266e`
- 提交日期 / Commit date: 2026-06-27
- 提交说明 / Commit subject: Polish UI structure and docs for v0.6.17

- Keep public market and help pages in the public site shell.
- Add collapsible user/admin sidebar groups.
- Improve help center search, links, and error states.
- Improve gift card user/admin UI safety, code masking, copy, and responsive layout.
- Deep-link Extension Center tabs and align theme market styling.
- Refresh Extension Center docs and OTA guard coverage.

## v0.6.16

- 发布提交 / Release commit: `69ac384`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile body verification

### Fixes and Stability / 修复与稳定性

- Move user gift card Turnstile verification from onRequest to preHandler so body turnstileToken is available.

- Keep authentication in onRequest and add guard coverage to prevent body-token verification regressions.

- Let the gift-card flow test check the active database schema for isolated test runs.

## v0.6.15

- 发布提交 / Release commit: `e3963e0`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Persist expired gift card state

### 其他变更 / Other Changes

- Persist expired gift card state `e3963e0`

## v0.6.14

- 发布提交 / Release commit: `370be98`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix gift card Turnstile token flow

### 修复与稳定性 / Fixes and Stability

- Fix gift card Turnstile token flow `370be98`

## v0.6.13

- 发布提交 / Release commit: `f28e860`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix user gift card Turnstile verification

### 修复与稳定性 / Fixes and Stability

- Fix user gift card Turnstile verification `f28e860`

## v0.6.12

- 发布提交 / Release commit: `f754493`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix admin gift card generation Turnstile gate

### 修复与稳定性 / Fixes and Stability

- Fix admin gift card generation Turnstile gate `f754493`

## v0.6.11

- 发布提交 / Release commit: `4db8d45`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Add operations settings center

### 新增能力 / New Capabilities

- Add operations settings center `4db8d45`

## v0.6.10

- 发布提交 / Release commit: `11ecc4b`
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

- 发布提交 / Release commit: `369212f`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix extension market public domain

- Point extension, theme, and SDK public URLs to payincus.com

- Trust the real docs-site host for market index and package downloads

- Keep market guard coverage aligned with the live docs domain

## v0.6.8

- 发布提交 / Release commit: `809db50`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Fix extension platform release guards

- Keep plugin market review APIs in the admin API client

- Preserve user/admin SideNav build-time route separation

- Add frontend route guard to extension platform verification

## v0.6.7

- 发布提交 / Release commit: `d173746`
- 提交日期 / Commit date: 2026-06-26
- 提交说明 / Commit subject: Build extension platform and theme system

- Upgrade Extension Center product wording to Extension Center

- Add OAuth Provider, Public API, SDK, action runtime, events, scoped plugin storage, market review, and theme package system

- Add governed live extension/theme market assets and development documentation

- Add extension platform guard coverage and verification scripts

## v0.6.6

- 发布提交 / Release commit: `9fcbe28`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Skip source smoke in artifact acceptance / 验收脚本跳过产物源码 smoke

### 其他变更 / Other Changes

- Skip source smoke in artifact acceptance / 验收脚本跳过产物源码 smoke `9fcbe28`

## v0.6.5

- 发布提交 / Release commit: `cefd77a`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update final proof scope waiver / 更新最终验收豁免口径

### 改进与调整 / Improvements and Adjustments

- Update final proof scope waiver / 更新最终验收豁免口径 `cefd77a`

## v0.6.4

- 发布提交 / Release commit: `5eff38f`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update production proof workspace status / 更新生产验收工作台状态

### 改进与调整 / Improvements and Adjustments

- Update production proof workspace status / 更新生产验收工作台状态 `5eff38f`

## v0.6.3

- 发布提交 / Release commit: `54aa45a`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查

### 修复与稳定性 / Fixes and Stability

- Harden Lsky commit proof permissions / 加固 Lsky 提交证明权限检查 `54aa45a`

## v0.6.2

- 发布提交 / Release commit: `0f67f1d`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Force artifact OTA dependency install / 强制重建 OTA 制品依赖

### 其他变更 / Other Changes

- Force artifact OTA dependency install / 强制重建 OTA 制品依赖 `0f67f1d`

## v0.6.1

- 发布提交 / Release commit: `0b408cc`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出

### 修复与稳定性 / Fixes and Stability

- Harden Lsky proof and artifact install output / 加固 Lsky proof 与制品安装输出 `0b408cc`

## v0.6.0

- 发布提交 / Release commit: `50f0f8b`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限

### 其他变更 / Other Changes

- Summarize Lsky proof token abilities / 汇总 Lsky proof token 权限 `50f0f8b`

## v0.5.9

- 发布提交 / Release commit: `800c509`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden artifact OTA install directory handling

### 修复与稳定性 / Fixes and Stability

- Harden artifact OTA install directory handling `800c509`

## v0.5.8

- 发布提交 / Release commit: `976a38a`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update production proof workspace status

### 改进与调整 / Improvements and Adjustments

- Update production proof workspace status `976a38a`

### 其他变更 / Other Changes

- Document safe Lsky cleanup proof boundary `813d8c0`

## v0.5.7

- 发布提交 / Release commit: `d470e7b`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden online update runner environment

### 修复与稳定性 / Fixes and Stability

- Harden online update runner environment `d470e7b`

### 其他变更 / Other Changes

- Record latest Lsky proof access attempt `6c086cd`

## v0.5.6

- 发布提交 / Release commit: `79d00de`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky production proof script

### 新增能力 / New Capabilities

- Add Lsky production proof script `79d00de`

### 其他变更 / Other Changes

- Document Lsky cleanup blocker evidence `9c04f22`

## v0.5.5

- 发布提交 / Release commit: `80d353e`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Expose SMTP provider proof metadata

### 其他变更 / Other Changes

- Expose SMTP provider proof metadata `80d353e`

## v0.5.4

- 发布提交 / Release commit: `bbae57c`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Update production proof workspace status

### 改进与调整 / Improvements and Adjustments

- Update production proof workspace status `bbae57c`

## v0.5.3

- 发布提交 / Release commit: `2e99abc`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add production DB restore drill proof

Add a repeatable production database restore drill script and update the production proof workspace to 8/13 after the temporary restore proof.

## v0.5.2

- 发布提交 / Release commit: `4f5b3f0`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add Lsky delete diagnostics

Log non-sensitive Lsky delete status/body/error diagnostics and avoid treating provider status:false responses as successful cleanup.

## v0.5.1

- 发布提交 / Release commit: `b8eabc0`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky v2 image deletion

Preserve numeric Lsky v2 photo IDs and delete images through the official batch /user/photos endpoint.

## v0.5.0

- 发布提交 / Release commit: `cd8797b`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix production proof workspace progress

Use the ledger-backed 7/13 Category 13 proof count in the admin production proof workspace instead of deriving progress from grouped display rows.

## v0.4.9

- 发布提交 / Release commit: `7ae4967`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix Lsky upload cleanup identifier / 修复 Lsky 上传清理标识

Preserve Lsky pathname/path fallback provider IDs so uploaded ticket images can be cleaned up when provider responses omit id/key/hash.

## v0.4.8

- 发布提交 / Release commit: `326cab1`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add production proof workspace / 新增生产验收工作台

### 新增能力 / New Capabilities

- Add production proof workspace / 新增生产验收工作台 `326cab1`

### 其他变更 / Other Changes

- Document v0.4.7 cache deployment notes / 记录 v0.4.7 缓存部署说明 `4ce40ba`

## v0.4.7

- 发布提交 / Release commit: `4f5995d`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI runtime calls and SPA cache headers / 修复工单 AI 运行时调用与 SPA 缓存头

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI runtime calls and SPA cache headers / 修复工单 AI 运行时调用与 SPA 缓存头 `4f5995d`

## v0.4.6

- 发布提交 / Release commit: `b92a5a0`
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

- 发布提交 / Release commit: `d0d0c06`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI cached API fallback / 修复工单 AI 缓存 API 兜底

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI cached API fallback / 修复工单 AI 缓存 API 兜底 `d0d0c06`

## v0.4.4

- 发布提交 / Release commit: `68abb17`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add capacity and cost operations view / 新增容量与成本运营视图

### 新增能力 / New Capabilities

- Add capacity and cost operations view / 新增容量与成本运营视图 `68abb17`

## v0.4.3

- 发布提交 / Release commit: `b186fa8`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI runtime fallback / 修复工单 AI 运行时兜底

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI runtime fallback / 修复工单 AI 运行时兜底 `b186fa8`

## v0.4.2

- 发布提交 / Release commit: `7f574ae`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Fix ticket AI actions and panel cert paths / 修复工单 AI 与面板证书路径

### 修复与稳定性 / Fixes and Stability

- Fix ticket AI actions and panel cert paths / 修复工单 AI 与面板证书路径 `7f574ae`

## v0.4.1

- 发布提交 / Release commit: `dfb4900`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Show installed plugin settings in sidebar / 安装后显示插件设置入口

### 其他变更 / Other Changes

- Show installed plugin settings in sidebar / 安装后显示插件设置入口 `dfb4900`

## v0.4.0

- 发布提交 / Release commit: `b4d4cce`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add standalone plugin settings pages / 新增独立插件设置页

### 新增能力 / New Capabilities

- Add standalone plugin settings pages / 新增独立插件设置页 `b4d4cce`

## v0.3.9

- 发布提交 / Release commit: `f009c7e`
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

- 发布提交 / Release commit: `92cda32`
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

- 发布提交 / Release commit: `bbf36c9`
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

- 发布提交 / Release commit: `8b5ad55`
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

- 发布提交 / Release commit: `a28cf91`
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

- 发布提交 / Release commit: `2babf9d`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Require AI ticket reply confidence checks / 增加 AI 工单回复置信度检查

### 其他变更 / Other Changes

- Require AI ticket reply confidence checks / 增加 AI 工单回复置信度检查 `2babf9d`

## v0.3.3

- 发布提交 / Release commit: `28dd2de`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Harden AI ticket takeover safeguards / 加固 AI 工单接管安全边界

### 修复与稳定性 / Fixes and Stability

- Harden AI ticket takeover safeguards / 加固 AI 工单接管安全边界 `28dd2de`

## v0.3.2

- 发布提交 / Release commit: `651f0ba`
- 提交日期 / Commit date: 2026-06-25
- 提交说明 / Commit subject: Add user lifecycle operations center / 新增用户生命周期运营中心

### 新增能力 / New Capabilities

- Add user lifecycle operations center / 新增用户生命周期运营中心 `651f0ba`

## v0.3.1

- 发布提交 / Release commit: `c71ade8`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add customer success ticket workspace / 新增客服成功工单工作台

### 新增能力 / New Capabilities

- Add customer success ticket workspace / 新增客服成功工单工作台 `c71ade8`

## v0.3.0

- 发布提交 / Release commit: `a721de8`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add SLA alert center / 新增 SLA 告警中心

### 新增能力 / New Capabilities

- Add SLA alert center / 新增 SLA 告警中心 `a721de8`

## v0.2.9

- 发布提交 / Release commit: `62825b8`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add delivery assurance operations workflow / 新增交付保障运营闭环

### 新增能力 / New Capabilities

- Add delivery assurance operations workflow / 新增交付保障运营闭环 `62825b8`

## v0.2.8

- 发布提交 / Release commit: `dc95c91`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add financial reconciliation workflow / 新增财务对账闭环

### 新增能力 / New Capabilities

- Add financial reconciliation workflow / 新增财务对账闭环 `dc95c91`

## v0.2.7

- 发布提交 / Release commit: `5de795a`
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

- 发布提交 / Release commit: `e282b63`
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

- 发布提交 / Release commit: `49959a2`
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

- 发布提交 / Release commit: `0eb2178`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add balance adjustment approval / 新增调账审批流

### 新增能力 / New Capabilities

- Add balance adjustment approval / 新增调账审批流 `0eb2178`

## v0.2.3

- 发布提交 / Release commit: `21a678c`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add order exception handling / 新增订单异常处理

### 新增能力 / New Capabilities

- Add order exception handling / 新增订单异常处理 `21a678c`

## v0.2.2

- 发布提交 / Release commit: `3c641c9`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add unified order center / 新增统一订单中心

### 新增能力 / New Capabilities

- Add unified order center / 新增统一订单中心 `3c641c9`
- Revert "Add demo login and read-only safeguards / 新增演示登录与只读保护" `a7b1825`
- Add demo login and read-only safeguards / 新增演示登录与只读保护 `07592a7`

### 其他变更 / Other Changes

- Separate demo docs from production guides / 区分演示文档与生产指南 `458dad6`

## v0.2.1

- 发布提交 / Release commit: `e8cca39`
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

- 发布提交 / Release commit: `01731f6`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix installer static asset permissions / 修复安装器静态资源权限

### 修复与稳定性 / Fixes and stability

- Keep the install root traversable for Nginx so one-click installs can serve frontend static assets.
- 保持安装根目录可被 Nginx 穿透，确保一键安装后可正常提供前端静态资源。

### 改进与调整 / Improvements and adjustments

- Preserve owner-only permissions for .env after install and upgrade permission repair.
- Add split deployment guard coverage for installer static asset permissions.

## v0.1.9

- 发布提交 / Release commit: `8f2d2f3`
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

- 发布提交 / Release commit: `65dbc9d`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix delivery nav icon / 修复交付保障导航图标

### 修复与稳定性 / Fixes and stability

- 修复后台交付保障菜单没有侧边栏小图标的问题。

- Fixed the missing sidebar icon for the admin Delivery Assurance menu item.

### 改进与调整 / Improvements and adjustments

- 扩展交付保障守卫，确保菜单使用的 pulse 图标已被侧边栏组件支持。

- Extended the Delivery Assurance guard to ensure the pulse menu icon is supported by the sidebar component.

## v0.1.7

- 发布提交 / Release commit: `1e7a738`
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

- 发布提交 / Release commit: `474ae02`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix admin instance detail loading / 修复后台实例详情加载

### 修复与稳定性 / Fixes and Stability

- Fix admin instance detail loading / 修复后台实例详情加载 `474ae02`

## v0.1.5

- 发布提交 / Release commit: `e865f4d`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Localize operation logs in Chinese / 日志内容中文化

### 其他变更 / Other Changes

- Localize operation logs in Chinese / 日志内容中文化 `e865f4d`

## v0.1.4

- 发布提交 / Release commit: `ac2b679`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定

### 其他变更 / Other Changes

- Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定 `ac2b679`

## v0.1.3

- 发布提交 / Release commit: `5bec34f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix instance detail bandwidth rendering / 修复实例详情带宽渲染

### 修复与稳定性 / Fixes and Stability

- Fix instance detail bandwidth rendering / 修复实例详情带宽渲染 `5bec34f`

## v0.1.2

- 发布提交 / Release commit: `004c84f`
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

- 发布提交 / Release commit: `f2aaefa`
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

- 发布提交 / Release commit: `6c06bd8`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Polish update and plugin admin UI / 优化更新与插件后台界面

### 改进与调整 / Improvements and Adjustments

- Polish update and plugin admin UI / 优化更新与插件后台界面 `6c06bd8`

### 其他变更 / Other Changes

- Document bilingual versioning and OTA cadence rules `7fe3601`

## v0.0.22

- 发布提交 / Release commit: `9f638d8`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Add redacted production proof snapshot

### 新增能力 / New Capabilities

- Add redacted production proof snapshot `9f638d8`

### 其他变更 / Other Changes

- Record public production revalidation `f9ed41e`

## v0.0.21

- 发布提交 / Release commit: `71cdcff`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix production OTA CLI start command

### 修复与稳定性 / Fixes and Stability

- Fix production OTA CLI start command `71cdcff`

## v0.0.20

- 发布提交 / Release commit: `301fc2c`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Update version log for static root fix

### 修复与稳定性 / Fixes and Stability

- Fix production split static roots `5afc9a5`

## v0.0.19

- 发布提交 / Release commit: `97f87c5`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix storage pool defaults and error guidance

### 修复与稳定性 / Fixes and Stability

- Fix storage pool defaults and error guidance `97f87c5`

## v0.0.18

- 发布提交 / Release commit: `368d195`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent binary installer cache query

### 修复与稳定性 / Fixes and Stability

- Fix Agent binary installer cache query `368d195`

## v0.0.17

- 发布提交 / Release commit: `60faf9a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent installer manifest parsing

### 修复与稳定性 / Fixes and Stability

- Fix Agent installer manifest parsing `60faf9a`

## v0.0.16

- 发布提交 / Release commit: `a0a35fb`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Refresh host panel trust certificate

### 其他变更 / Other Changes

- Refresh host panel trust certificate `a0a35fb`

## v0.0.15

- 发布提交 / Release commit: `a361779`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix atomic OTA install root detection

### 修复与稳定性 / Fixes and Stability

- Fix atomic OTA install root detection `a361779`

## v0.0.14

- 发布提交 / Release commit: `6a0624a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Clarify Debian host install support

### 新增能力 / New Capabilities

- Clarify Debian host install support `6a0624a`

## v0.0.13

- 发布提交 / Release commit: `5bf4e9a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Update version log for HSTS hardening

- Add HSTS to split Nginx templates and installer-generated static frontend blocks.

- Guard HSTS in split deployment and security header checks.

- Document the public Strict-Transport-Security production requirement.

## v0.0.12

- 发布提交 / Release commit: `0453d5a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Add extension center

### 新增能力 / New Capabilities

- Add extension center `0453d5a`
- Add bilingual PayIncus documentation site `8d89da3`

### 修复与稳定性 / Fixes and Stability

- Fix GitHub Pages docs workflow `9b9b40f`

### 其他变更 / Other Changes

- Deploy docs site with GitHub Pages `9d6cd2b`

### 改进与调整 / Improvements and Adjustments

- Update split deployment docs `878fc93`
- Update README with OTA and community links `86c6234`

## v0.0.11

- 发布提交 / Release commit: `6229369`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.10

- 发布提交 / Release commit: `6229369`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Support atomic OTA release layout

### 新增能力 / New Capabilities

- Support atomic OTA release layout `6229369`

## v0.0.9

- 发布提交 / Release commit: `2924080`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Auto rollback failed online updates

### 修复与稳定性 / Fixes and Stability

- Auto rollback failed online updates `2924080`

## v0.0.8

- 发布提交 / Release commit: `b601030`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.7

- 发布提交 / Release commit: `b601030`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Prefer verified OTA artifacts for online updates

### 改进与调整 / Improvements and Adjustments

- Prefer verified OTA artifacts for online updates `b601030`

## v0.0.6

- 发布提交 / Release commit: `e691ffa`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Stabilize OTA restart verification

### 修复与稳定性 / Fixes and Stability

- Stabilize OTA restart verification `e691ffa`

## v0.0.5

- 发布提交 / Release commit: `674c0d8`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix OTA manifest release workflow checkout

### 修复与稳定性 / Fixes and Stability

- Fix OTA manifest release workflow checkout `674c0d8`

## v0.0.4

- 发布提交 / Release commit: `21c398f`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Add OTA release manifest metadata

### 新增能力 / New Capabilities

- Add OTA release manifest metadata `21c398f`

## v0.0.3

- 发布提交 / Release commit: `edac4e9`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make OTA worker tolerate production git ownership

### 修复与稳定性 / Fixes and Stability

- Make OTA worker tolerate production git ownership `edac4e9`

## v0.0.2

- 发布提交 / Release commit: `19391c9`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Make online updates asynchronous and build-ready

### 改进与调整 / Improvements and Adjustments

- Make online updates asynchronous and build-ready `19391c9`

## v0.0.1

- 发布提交 / Release commit: `c7629e6`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Allow online update worker sudo under systemd

### 新增能力 / New Capabilities

- Allow online update worker sudo under systemd `c7629e6`

### 改进与调整 / Improvements and Adjustments

- Prepare v0.0.1 online update baseline `6a9854c`
- Make release installs reproducible `fb02c8c`
- Update Agent release repository default `108efe2`
- Rewrite PayIncus README `063fbaf`
- Update payincus deployment checks `3540072`
- Update README.md `fb92971`
- Prepare host deployment package `52e1af4`

### 修复与稳定性 / Fixes and Stability

- Harden release production verification `8b23a8f`

### 其他变更 / Other Changes

- first commit `c249891`

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
