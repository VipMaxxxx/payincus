# Release Notes

Release documentation has two layers:

- This page: manually maintained release strategy, OTA capability and production verification notes.
- [System Version Log](/en/release/version-log): automatically generated from Git tags and commits.

The OTA baseline starts from `v0.0.1` and has been proven through the atomic OTA workflow.

## Versioning Rule / 版本号规则

- Use three-part semantic versions: `vMAJOR.MINOR.PATCH` / 后续版本按三段语义版本递进：`v主版本.次版本.修订版本`.
- Patch numbers are limited to `0` through `9`; after `v0.0.9`, the next version is `v0.1.0`, not `v0.0.10` / 修订版本只从 `0` 到 `9`，`v0.0.9` 之后进位为 `v0.1.0`，不要继续发布 `v0.0.10`.
- After `v0.9.9`, roll over to `v1.0.0` / 当 `v0.9.9` 之后继续进位时，发布 `v1.0.0`.
- Existing historical tags remain unchanged; apply this rule to future releases / 既有历史 tag 保留不改；新规则从下一次发布开始执行.

## OTA Release Frequency / OTA 发布频率

- Do not publish an OTA for every tiny change / 不要每修一个小点就发 OTA.
- Publish one OTA after a feature, complete bugfix, or coherent fix bundle is implemented and verified / 一个功能、一个完整 bugfix、或一组相关修复完成并通过验收后，再发布一个 OTA.
- Handoff-only, audit-only, and non-behavior documentation changes usually do not need an OTA, but the public docs site should stay current / 纯交接文档、审计记录、非行为性文档补充通常不发 OTA；但公开文档站仍要保持最新.
- Emergency production fixes may ship separately, but must include a clear commit subject, verification evidence, and version log updates / 紧急生产修复可以单独发 OTA，但必须包含明确提交说明、测试证据和版本日志.

## Verified Capabilities

- GitHub Release artifact.
- OTA manifest.
- SHA256 verification.
- Atomic `current` / `releases` switching.
- Rollback to the previous release.
- Updating forward again after rollback.

The detailed production audit record lives in:

```text
docs/production-audit.md
```

## Git Changelog

The documentation build automatically runs:

```bash
pnpm docs:changelog
```

It reads Git tags and commits and generates:

```text
docs-site/docs/release/version-log.md
docs-site/docs/en/release/version-log.md
```

Readable public release notes still depend on clear commit messages or GitHub Release copy.
