# 系统版本更新日志

<!-- 此文件由 docs-site/scripts/generate-changelog.mjs 自动生成。请不要手动编辑。 -->

该页面从仓库 Git tag 和 commit 自动生成，用于展示系统版本演进。后台 OTA 的“可更新版本”和生产部署仍以 GitHub Release tag 为准。

## 当前源码状态 / Current Source State

- 当前 HEAD / Current HEAD: `a7b1825`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Revert "Add demo login and read-only safeguards / 新增演示登录与只读保护"
- 最新 tag / Latest tag: `v0.2.1`

## 未发布变更 / Unreleased Changes

### 新增能力 / New Capabilities

- Revert "Add demo login and read-only safeguards / 新增演示登录与只读保护" `a7b1825`
- Add demo login and read-only safeguards / 新增演示登录与只读保护 `07592a7`

### 改进与调整 / Improvements and Adjustments

- Update handoff for v0.2.1 OTA proof / 更新 v0.2.1 OTA 证明交接 `b246189`
- Update version log for v0.2.1 / 更新 v0.2.1 版本日志 `7f2ac52`

## 历史版本 / Historical Versions

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

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.1.5 / 更新 v0.1.5 版本日志 `248b05e`

## v0.1.5

- 发布提交 / Release commit: `e865f4d`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Localize operation logs in Chinese / 日志内容中文化

### 其他变更 / Other Changes

- Localize operation logs in Chinese / 日志内容中文化 `e865f4d`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.1.4 / 更新 v0.1.4 版本日志 `dea5d77`

## v0.1.4

- 发布提交 / Release commit: `ac2b679`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定

### 其他变更 / Other Changes

- Prevent incompatible VM package host binding / 阻止不兼容 VM 套餐节点绑定 `ac2b679`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.1.3 / 更新 v0.1.3 版本日志 `8c5bbd8`

## v0.1.3

- 发布提交 / Release commit: `5bec34f`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix instance detail bandwidth rendering / 修复实例详情带宽渲染

### 修复与稳定性 / Fixes and Stability

- Fix instance detail bandwidth rendering / 修复实例详情带宽渲染 `5bec34f`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.1.2 / 更新 v0.1.2 版本日志 `2f265f6`

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

- 将插件市场和安装任务日志整理为更清晰的插件中心内页。

## v0.1.1

- 发布提交 / Release commit: `f2aaefa`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Polish update task and plugin center UI / 优化更新任务和插件中心界面

### 新增能力 / New Capabilities:

- 插件市场在插件中心内作为独立内页呈现，保留 GitHub Release 包和 SHA256 校验上下文。

- Plugin Market is presented as a dedicated in-center page with GitHub Release package and SHA256 verification context.

### 其他变更 / Other Changes:

- 版本更新页在未发现新版本时持续展示当前/latest 版本信息，并将主按钮显示为已更新至最新版本。

- The system update page keeps latest/current version details visible when no newer release exists and marks the primary action as already up to date.

### 改进与调整 / Improvements and Adjustments:

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
- Update handoff audit status / 更新交接审计状态 `3974ea2`
- Update version log for v0.0.22 `847aaa6`

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

### 改进与调整 / Improvements and Adjustments

- Update handoff with live business proof `db4f18b`
- Update handoff after v0.0.21 production proof `ade22e5`
- Update version log for v0.0.21 `517b972`

## v0.0.21

- 发布提交 / Release commit: `71cdcff`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix production OTA CLI start command

### 修复与稳定性 / Fixes and Stability

- Fix production OTA CLI start command `71cdcff`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.0.20 `40a245e`

## v0.0.20

- 发布提交 / Release commit: `301fc2c`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Update version log for static root fix

### 修复与稳定性 / Fixes and Stability

- Update version log for static root fix `301fc2c`
- Fix production split static roots `5afc9a5`

### 改进与调整 / Improvements and Adjustments

- Update handoff after storage pool release `3443585`
- Update version log for v0.0.19 `5d17ef1`

## v0.0.19

- 发布提交 / Release commit: `97f87c5`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix storage pool defaults and error guidance

### 修复与稳定性 / Fixes and Stability

- Fix storage pool defaults and error guidance `97f87c5`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.0.18 `854bb87`

## v0.0.18

- 发布提交 / Release commit: `368d195`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent binary installer cache query

### 修复与稳定性 / Fixes and Stability

- Fix Agent binary installer cache query `368d195`

### 改进与调整 / Improvements and Adjustments

- Update handoff with Incus storage proof `c0f10f7`
- Update handoff with v0.0.17 production verification `78d35cf`
- Update handoff after v0.0.17 production check `e86669f`
- Update version log for v0.0.17 `d93b1ef`

### 其他变更 / Other Changes

- Avoid stale head in handoff `f962435`
- Correct handoff current head `4428fb9`

## v0.0.17

- 发布提交 / Release commit: `60faf9a`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Fix Agent installer manifest parsing

### 修复与稳定性 / Fixes and Stability

- Fix Agent installer manifest parsing `60faf9a`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.0.16 `2466e80`

## v0.0.16

- 发布提交 / Release commit: `a0a35fb`
- 提交日期 / Commit date: 2026-06-24
- 提交说明 / Commit subject: Refresh host panel trust certificate

### 其他变更 / Other Changes

- Refresh host panel trust certificate `a0a35fb`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.0.15 `2a79838`

## v0.0.15

- 发布提交 / Release commit: `a361779`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Fix atomic OTA install root detection

### 修复与稳定性 / Fixes and Stability

- Fix atomic OTA install root detection `a361779`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.0.14 `91e5b32`

## v0.0.14

- 发布提交 / Release commit: `6a0624a`
- 提交日期 / Commit date: 2026-06-23
- 提交说明 / Commit subject: Clarify Debian host install support

### 新增能力 / New Capabilities

- Clarify Debian host install support `6a0624a`

### 改进与调整 / Improvements and Adjustments

- Update version log for v0.0.13 `d458c85`

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
- 提交说明 / Commit subject: Add plugin center

### 新增能力 / New Capabilities

- Add plugin center `0453d5a`
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
