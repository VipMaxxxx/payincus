# Release Notes

Release documentation has two layers:

- This page: manually maintained release strategy, OTA capability and production verification notes.
- [System Version Log](/en/release/version-log): automatically generated from Git tags and commits.

The OTA baseline starts from `v0.0.1` and has been proven through the atomic OTA workflow.

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
