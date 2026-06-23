# PayIncus 文档站

这是 PayIncus 的 VitePress 双语文档站源码，目标域名为 `payincus.com`。

- 中文默认路径：`/`
- 英文路径：`/en/`

## 本地运行

```bash
cd docs-site
pnpm install
pnpm dev
```

或从仓库根目录运行：

```bash
pnpm docs:install
pnpm docs:dev
```

## 构建

```bash
pnpm build
```

构建前会自动从 Git tag 和 commit 生成中英文系统版本更新日志：

```text
docs/release/version-log.md
docs/en/release/version-log.md
```

输出目录：

```text
docs/.vitepress/dist
```

## GitHub Pages

文档站通过 GitHub Actions 发布到 GitHub Pages：

```text
.github/workflows/docs-pages.yml
```

发布域名由 CNAME 指定：

```text
docs/public/CNAME
```

当前值：

```text
payincus.com
```

GitHub 仓库需要在 `Settings -> Pages` 中选择 GitHub Actions 作为发布源，并把 Custom domain 设置为 `payincus.com`。

文档站保持为独立 package，不纳入主业务 workspace，避免影响主项目 `pnpm install --frozen-lockfile` 和生产构建。只有执行 `pnpm docs:build` 或 GitHub Pages workflow 时才会生成文档站静态产物。
