---
layout: home
title: PayIncus

hero:
  name: PayIncus
  text: Commercial delivery and billing for Incus hosting
  tagline: Manage NAT VPS sales, resource delivery, billing, tickets, notifications, Agent reporting, extension marketplace, themes, and admin OTA updates.
  image:
    src: /incudal_logo.webp
    alt: PayIncus
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/introduction
    - theme: alt
      text: Live Demo
      link: /en/demo
    - theme: alt
      text: Marketplace
      link: /en/plugins/market

features:
  - title: Automation
    details: Orders, billing, instance lifecycle, rollback, notifications, and OTA updates run through auditable workflows.
  - title: Responsive
    details: The user portal and admin console are separate builds for focused desktop and mobile workflows.
  - title: Performant
    details: Static frontends, same-origin API, split Nginx deployment, and production preflight checks keep delivery stable.
  - title: Personalization
    details: The Extension Center and theme system support controlled third-party capabilities and brand surfaces.
  - title: Open Operation
    details: Key production paths are backed by version logs, OTA tasks, production proof, and redacted audit records.
  - title: Extensible
    details: Public API, OAuth Provider, SDK, events, action runtime, and extension storage form the developer platform.
---

::: info Extension Center
[Extension Development](/en/plugins/overview): Extension Center, online marketplace, themes, OAuth Provider, Public API, and SDK entrypoints for third-party developers.
:::

<section class="payincus-section">
  <p class="payincus-kicker">What is PayIncus?</p>
  <h2>A delivery, billing, and operations console for hosting businesses</h2>
  <p>PayIncus connects user purchases, balance billing, Incus instance delivery, web terminal access, tickets, notifications, payment callbacks, Agent reporting, and admin upgrades in one controlled platform.</p>
  <div class="payincus-grid">
    <div class="payincus-card">
      <strong>User Portal</strong>
      <span>Marketplace, instances, terminal, wallet, orders, tickets, notifications, invites, and self-service actions.</span>
    </div>
    <div class="payincus-card">
      <strong>Admin Console</strong>
      <span>Users, packages, hosts, images, orders, payment providers, finance, support, resource pools, SLA, alerts, and OTA.</span>
    </div>
    <div class="payincus-card">
      <strong>Production Ops</strong>
      <span>Atomic current/releases deployment, Release artifact verification, production preflight, rollback, and redacted proof records.</span>
    </div>
  </div>
</section>

<section class="payincus-section payincus-split">
  <div>
    <p class="payincus-kicker">Extensions</p>
    <h2>Live marketplace and third-party developer platform</h2>
    <p>The Extension Center supports upload installs, online marketplace installs, submission review, scanning, publishing, enable/disable/uninstall, configuration forms, event delivery, webhook actions, extension storage, Gateway Extensions, Server Extensions, and SDK examples.</p>
    <div class="payincus-links">
      <a class="payincus-link" href="/en/plugins/overview"><strong>Extensions</strong> Capabilities and security boundaries</a>
      <a class="payincus-link" href="/en/plugins/market"><strong>Marketplace</strong> Stable online market directory</a>
      <a class="payincus-link" href="/en/plugins/development"><strong>Extension Development</strong> Development guide, manifest, events, actions, storage, and themes</a>
    </div>
  </div>
  <div class="payincus-code-panel">
    GET https://payincus.com/plugin-market/index.json<br>
    GET https://payincus.com/theme-market/index.json<br>
    GET https://payincus.com/sdk/payincus-public-api.ts<br>
    POST /api/v1/plugins/:pluginId/actions/:action
  </div>
</section>

<section class="payincus-section payincus-split">
  <div>
    <p class="payincus-kicker">PayIncus API</p>
    <h2>Automate the platform with OAuth, API tokens, and SDKs</h2>
    <p>The Public API provides `/api/v1`, OpenAPI, Bearer tokens, scopes, pagination, sorting, allowlisted filters, and a unified error model. Integrations can read the authorized user's products, services, orders, billing records, tickets, notifications, and controlled extension actions.</p>
    <div class="payincus-links">
      <a class="payincus-link" href="/en/api/overview"><strong>API Reference</strong> Public API and permissions</a>
      <a class="payincus-link" href="/en/plugins/sdk"><strong>SDK</strong> TypeScript SDK and examples</a>
    </div>
  </div>
  <div class="payincus-code-panel">
    Authorization: Bearer pat_xxx<br>
    GET /api/v1/me<br>
    GET /api/v1/services?include=product<br>
    POST /api/v1/services/:id/actions<br>
    POST /api/v1/tickets/:id/replies
  </div>
</section>

<section class="payincus-section">
  <p class="payincus-kicker">Deploy</p>
  <h2>A fixed path from installation to production acceptance</h2>
  <p>The documentation is organized around installation, split deployment, environment variables, systemd, Nginx, production acceptance, and admin OTA updates.</p>
  <div class="payincus-grid">
    <a class="payincus-link" href="/en/deployment/one-click-install"><strong>One-click Install</strong> Panel installation and bootstrap</a>
    <a class="payincus-link" href="/en/guide/split-deployment"><strong>Split Deployment</strong> User, admin, and API boundaries</a>
    <a class="payincus-link" href="/en/guide/ota-update"><strong>Admin OTA</strong> Release artifact updates and rollback</a>
  </div>
</section>

<section class="payincus-section">
  <p class="payincus-kicker">Community</p>
  <h2>Connect project, releases, and production proof</h2>
  <div class="payincus-links">
    <a class="payincus-link" href="https://t.me/Payincus"><strong>Telegram</strong> Join the PayIncus group</a>
    <a class="payincus-link" href="https://github.com/VipMaxxxx/payincus"><strong>GitHub</strong> View source and releases</a>
    <a class="payincus-link" href="/en/release/version-log"><strong>Releases</strong> Review the system version log</a>
    <a class="payincus-link" href="/en/deployment/production-checklist"><strong>Production Proof</strong> Go-live acceptance rules</a>
  </div>
</section>
