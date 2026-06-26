# Extension Center Plan

PayIncus Extension Center is designed as a third-party developer platform, live marketplace, and real theme system. Third-party developers can build complete business features through controlled APIs, actions, events, storage, and UI slots. Operators can review, list, delist, install, enable, roll back, and audit extensions and themes.

The platform does not use arbitrary backend code execution as its capability boundary. Extensions enter PayIncus through manifest declarations, Public API, webhook actions, events, scoped storage, and sandboxed UI surfaces.

## Current State

- Private `.tar.gz` extension upload and install.
- Governed live extension marketplace.
- Submission queue, automatic scan, review, and publishing.
- Extension enablement, disablement, uninstall, task logs, and redacted configuration.
- Public API, OpenAPI, API tokens, OAuth Provider, TypeScript SDK, and examples.
- Webhook action runtime, business events, retry, dead letter, dedupe, event health, and alerts.
- Plugin KV, scoped KV, table storage, migrations, backups, local archives, and remote archive targets.
- Gateway Extension and Server Extension lifecycle hooks.
- Theme package upload, marketplace install, submission review, preview, enablement, rollback, config forms, and controlled template slots.

## Marketplace Model

```text
Developer package
  -> submission review
  -> scan and human approval
  -> payincus.com marketplace index
  -> admin marketplace install
  -> SHA256 verification
  -> controlled runtime
```

## Stable Directories

```text
https://payincus.com/plugin-market/index.json
https://payincus.com/theme-market/index.json
```

## High-Risk Boundary

The first Public API version intentionally does not expose direct payment creation, payment callbacks, refunds, direct balance writes, sensitive profile changes, service creation, service deletion, migration, extension management, or theme enablement. These remain inside PayIncus internal state machines or admin review flows until dedicated scopes, OpenAPI contracts, SDK methods, audit logs, rate limits, idempotency, rollback, and production proof are added.
