# PayIncus 文档站

这是 PayIncus 的 VitePress 双语文档站源码，目标域名为 `docs.payincus.com`。

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

## Cloudflare Pages

推荐配置：

```text
Root directory: docs-site
Build command: pnpm install --no-frozen-lockfile && pnpm build
Build output directory: docs/.vitepress/dist
```

文档站保持为独立 package，不纳入主业务 workspace，避免影响主项目 `pnpm install --frozen-lockfile` 和生产构建。只有执行 `pnpm docs:build` 或 Cloudflare Pages 构建时才会生成文档站静态产物。
