# 发布说明

发布文档分为两类：

- 本页：人工维护的发布策略、OTA 能力和生产验证说明。
- [系统版本更新日志](/release/version-log)：从 Git tag 和 commit 自动生成的版本记录。

当前 OTA 基线从 `v0.0.1` 开始，已经完成到原子 OTA proof。

## 已验证能力

- GitHub Release artifact。
- OTA manifest。
- SHA256 校验。
- `current` / `releases` 原子切换。
- 回滚到上一版 release。
- 回滚后再更新回最新版。

详细生产审计记录见仓库内：

```text
docs/production-audit.md
```

## Git 更新日志

文档站构建时会自动运行：

```bash
pnpm docs:changelog
```

该命令读取本仓库 Git tag 和 commit，生成：

```text
docs-site/docs/release/version-log.md
```

适合公开展示的发布说明建议继续使用清晰的 commit message 或 GitHub Release 文案。原始 Git log 可以自动收集，但如果提交信息过于工程化，用户看到的更新内容也会偏工程化。
