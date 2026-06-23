# 系统版本更新日志

<!-- 此文件由 docs-site/scripts/generate-changelog.mjs 自动生成。请不要手动编辑。 -->

该页面从仓库 Git tag 和 commit 自动生成，用于展示系统版本演进。后台 OTA 的“可更新版本”和生产部署仍以 GitHub Release tag 为准。

## 当前源码状态

- 当前 HEAD: `5bf4e9a`
- 提交日期: 2026-06-23
- 提交说明: Update version log for HSTS hardening
- 最新 tag: `v0.0.13`

## 未发布变更

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## 历史版本

## v0.0.13

- 发布提交: `5bf4e9a`
- 提交日期: 2026-06-23
- 提交说明: Update version log for HSTS hardening

### 修复与稳定性

- Update version log for HSTS hardening `5bf4e9a`
- Harden split deployment HSTS headers `79df25b`

### 改进与调整

- Update version log for production domain docs `b9b724f`
- Update handoff for plugin release `7cd2baa`
- Update version log for v0.0.12 `6e8ce21`

### 其他变更

- Align docs with production domains `bafe353`

## v0.0.12

- 发布提交: `0453d5a`
- 提交日期: 2026-06-23
- 提交说明: Add plugin center

### 新增能力

- Add plugin center `0453d5a`
- Add bilingual PayIncus documentation site `8d89da3`

### 修复与稳定性

- Fix GitHub Pages docs workflow `9b9b40f`

### 其他变更

- Deploy docs site with GitHub Pages `9d6cd2b`

### 改进与调整

- Update split deployment docs `878fc93`
- Update README with OTA and community links `86c6234`

## v0.0.11

- 发布提交: `6229369`
- 提交日期: 2026-06-23
- 提交说明: Support atomic OTA release layout

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.10

- 发布提交: `6229369`
- 提交日期: 2026-06-23
- 提交说明: Support atomic OTA release layout

### 新增能力

- Support atomic OTA release layout `6229369`

## v0.0.9

- 发布提交: `2924080`
- 提交日期: 2026-06-23
- 提交说明: Auto rollback failed online updates

### 修复与稳定性

- Auto rollback failed online updates `2924080`

## v0.0.8

- 发布提交: `b601030`
- 提交日期: 2026-06-23
- 提交说明: Prefer verified OTA artifacts for online updates

- 该 tag 与相邻 tag 指向同一提交，未产生额外 Git commit。

## v0.0.7

- 发布提交: `b601030`
- 提交日期: 2026-06-23
- 提交说明: Prefer verified OTA artifacts for online updates

### 改进与调整

- Prefer verified OTA artifacts for online updates `b601030`

## v0.0.6

- 发布提交: `e691ffa`
- 提交日期: 2026-06-23
- 提交说明: Stabilize OTA restart verification

### 修复与稳定性

- Stabilize OTA restart verification `e691ffa`

## v0.0.5

- 发布提交: `674c0d8`
- 提交日期: 2026-06-23
- 提交说明: Fix OTA manifest release workflow checkout

### 修复与稳定性

- Fix OTA manifest release workflow checkout `674c0d8`

## v0.0.4

- 发布提交: `21c398f`
- 提交日期: 2026-06-23
- 提交说明: Add OTA release manifest metadata

### 新增能力

- Add OTA release manifest metadata `21c398f`

## v0.0.3

- 发布提交: `edac4e9`
- 提交日期: 2026-06-23
- 提交说明: Make OTA worker tolerate production git ownership

### 修复与稳定性

- Make OTA worker tolerate production git ownership `edac4e9`

## v0.0.2

- 发布提交: `19391c9`
- 提交日期: 2026-06-23
- 提交说明: Make online updates asynchronous and build-ready

### 改进与调整

- Make online updates asynchronous and build-ready `19391c9`

## v0.0.1

- 发布提交: `c7629e6`
- 提交日期: 2026-06-23
- 提交说明: Allow online update worker sudo under systemd

### 新增能力

- Allow online update worker sudo under systemd `c7629e6`

### 改进与调整

- Prepare v0.0.1 online update baseline `6a9854c`
- Make release installs reproducible `fb02c8c`
- Update Agent release repository default `108efe2`
- Rewrite PayIncus README `063fbaf`
- Update payincus deployment checks `3540072`
- Update README.md `fb92971`
- Prepare host deployment package `52e1af4`

### 修复与稳定性

- Harden release production verification `8b23a8f`

### 其他变更

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

