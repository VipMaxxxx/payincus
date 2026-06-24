---
layout: home

hero:
  name: PayIncus
  text: Incus NAT VPS sales, delivery and management platform
  tagline: Production documentation for the user portal, admin console, Incus delivery, Agent reporting, payment callbacks and admin OTA updates.
  image:
    src: /incudal_logo.webp
    alt: PayIncus
  actions:
    - theme: brand
      text: Start deployment
      link: /en/deployment/one-click-install
    - theme: alt
      text: Architecture
      link: /en/guide/architecture
    - theme: alt
      text: Admin OTA
      link: /en/guide/ota-update
    - theme: alt
      text: Version log
      link: /en/release/version-log

features:
  - title: Split frontends
    details: The user portal and admin console are separate Vite entries, built into client/dist/user and client/dist/admin.
  - title: Incus delivery
    details: Covers LXC / KVM NAT VPS plans, hosts, images, instances, terminal access and traffic accounting.
  - title: Admin OTA
    details: Supports GitHub Release manifests, SHA256 checks, atomic current/releases switching and rollback.
  - title: Agent reporting
    details: The host Agent reports heartbeat, resources, instance status, traffic and binary release metadata.
  - title: Production checks
    details: Includes split host verification, production preflight, security header checks and live acceptance gates.
  - title: Plugin Center
    details: Supports upload installs, GitHub market installs, enablement, user extension slots and templates.
---

## Quick Links

<div class="payincus-links">
  <a class="payincus-link" href="/en/demo">
    <strong>Online Demo</strong>
    Try the user portal and admin console
  </a>
  <a class="payincus-link" href="/en/deployment/one-click-install">
    <strong>Start deployment</strong>
    One-click install and production settings
  </a>
  <a class="payincus-link" href="https://t.me/Payincus">
    <strong>Telegram group</strong>
    t.me/Payincus
  </a>
  <a class="payincus-link" href="https://github.com/VipMaxxxx/payincus">
    <strong>GitHub</strong>
    VipMaxxxx/payincus
  </a>
</div>

## Recommended Reading Order

1. Read [Architecture](/en/guide/architecture) and [Split Deployment](/en/guide/split-deployment).
2. Deploy with [One-click Install](/en/deployment/one-click-install) or [Manual Install](/en/deployment/manual-install).
3. Complete the [Production Checklist](/en/deployment/production-checklist) before going live.
4. Use [Admin OTA](/en/guide/ota-update) for upgrades and review the [System Version Log](/en/release/version-log).

## Feature Documentation

- [User Portal](/en/user/dashboard): dashboard, instances, terminal, wallet, invites, tickets, notifications and self-service modules.
- [Admin Console](/en/admin/overview): users, instances, billing, payments, notifications, system settings and OTA.
- [Plugin Development](/en/plugins/overview): plugin center, manifest, admin and user slots, templates and third-party workflow.
- [Instances and Delivery](/en/features/instances): the full path from order, billing and Incus creation to Agent reporting.
- [Billing and Payments](/en/features/billing): recharge, callbacks, balance, affiliate rewards, redeem codes and audit.
- [Communication](/en/features/communication): inbox, SMTP, Telegram, Lsky, tickets and help center.
- [Hosting and Resource Pools](/en/features/resource-hosting): hosts, resource pools, hosted plans, revenue and Agent integration.
