# 发布说明

发布文档分为两类：

- 本页：人工维护的发布策略、OTA 能力和生产验证说明。
- [系统版本更新日志](/release/version-log)：从 Git tag 和 commit 自动生成的版本记录。

当前 OTA 基线从 `v0.0.1` 开始，已经完成到原子 OTA proof。

## 版本号规则 / Versioning Rule

- 后续版本按三段语义版本递进：`v主版本.次版本.修订版本` / Use three-part semantic versions: `vMAJOR.MINOR.PATCH`.
- 修订版本只从 `0` 到 `9`。例如 `v0.0.8` 的下一次修订是 `v0.0.9`，`v0.0.9` 之后进位为 `v0.1.0`，不要继续发布 `v0.0.10` / Patch numbers are limited to `0` through `9`; after `v0.0.9`, the next version is `v0.1.0`, not `v0.0.10`.
- 当 `v0.9.9` 之后继续进位时，发布 `v1.0.0` / After `v0.9.9`, roll over to `v1.0.0`.
- 既有历史 tag 保留不改；新规则从下一次发布开始执行 / Existing historical tags remain unchanged; apply this rule to future releases.

## OTA 发布频率 / OTA Release Frequency

- 不要每修一个小点就发 OTA / Do not publish an OTA for every tiny change.
- 一个功能、一个完整 bugfix、或一组相关修复完成并通过验收后，再发布一个 OTA / Publish one OTA after a feature, complete bugfix, or coherent fix bundle is implemented and verified.
- 纯交接文档、审计记录、非行为性文档补充通常不发 OTA；但公开文档站仍要保持最新 / Handoff-only, audit-only, and non-behavior documentation changes usually do not need an OTA, but the public docs site should stay current.
- 紧急生产修复可以单独发 OTA，但必须包含明确提交说明、测试证据和版本日志 / Emergency production fixes may ship separately, but must include a clear commit subject, verification evidence, and version log updates.

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
