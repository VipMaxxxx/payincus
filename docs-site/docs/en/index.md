---
layout: home
title: PayIncus Documentation
description: PayIncus deployment, operations, development, and OTA documentation
---

<main class="docs-home">
  <section class="docs-home-masthead">
    <div class="docs-home-brand">
      <img class="docs-home-logo" src="/incudal_logo.webp" alt="PayIncus">
      <div>
        <p class="docs-home-eyebrow">PayIncus Documentation</p>
        <h1>PayIncus Docs</h1>
        <p class="docs-home-summary">Deployment, operations, extension development, and production maintenance for the PayIncus Incus delivery platform, including the extension marketplace, themes, and admin OTA updates. Start with the task in front of you.</p>
        <div class="docs-home-actions">
          <a class="docs-home-button primary" href="/en/deployment/one-click-install">Deploy PayIncus</a>
          <a class="docs-home-button" href="/en/guide/introduction">Understand the system</a>
          <a class="docs-home-button" href="/en/api/overview">View the API</a>
        </div>
      </div>
    </div>
    <aside class="docs-home-release">
      <span>Production Operations</span>
      <strong>Releases, updates, and acceptance</strong>
      <p>Installation, OTA, and rollback use GitHub Releases with SHA256 verification as the source of truth.</p>
      <a href="/en/release/version-log">Review the version log</a>
      <a href="/en/deployment/production-checklist">Open the production checklist</a>
    </aside>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>Start here</h2>
      <p>Choose the entry closest to your current task.</p>
    </div>
    <div class="docs-home-links">
      <a class="docs-home-link" href="/en/deployment/one-click-install"><span class="docs-home-link-index">01</span><span><strong>One-click install</strong><small>Bootstrap a clean Debian or Ubuntu server.</small></span></a>
      <a class="docs-home-link" href="/en/deployment/manual-install"><span class="docs-home-link-index">02</span><span><strong>Manual install</strong><small>Integrate with existing PostgreSQL, Nginx, systemd, and release operations.</small></span></a>
      <a class="docs-home-link" href="/en/guide/split-deployment"><span class="docs-home-link-index">03</span><span><strong>Split deployment</strong><small>Configure user, admin, API, and domain boundaries.</small></span></a>
      <a class="docs-home-link" href="/en/guide/ota-update"><span class="docs-home-link-index">04</span><span><strong>Admin OTA</strong><small>Verify Releases, switch versions, and run controlled rollback.</small></span></a>
    </div>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>Browse by work</h2>
      <p>The information architecture follows deployment, operations, and development work.</p>
    </div>
    <div class="docs-home-columns">
      <div class="docs-home-column">
        <h3>Deploy and operate</h3>
        <a href="/en/deployment/environment">Environment variables</a>
        <a href="/en/deployment/systemd">systemd service</a>
        <a href="/en/deployment/nginx">Nginx split deployment</a>
        <a href="/en/troubleshooting/common-errors">Common errors</a>
      </div>
      <div class="docs-home-column">
        <h3>Product operations</h3>
        <a href="/en/user/dashboard">User portal</a>
        <a href="/en/admin/overview">Admin console</a>
        <a href="/en/features/billing">Payments and billing</a>
        <a href="/en/features/instances">Instances and delivery</a>
      </div>
      <div class="docs-home-column">
        <h3>Develop and extend</h3>
        <a href="/en/plugins/overview">Extension Center</a>
        <a href="/en/plugins/development">Extension development</a>
        <a href="/en/plugins/sdk">TypeScript SDK</a>
        <a href="/en/api/overview">Public API</a>
      </div>
    </div>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>Project links</h2>
      <p>Source, community, marketplace, and demo environment.</p>
    </div>
    <div class="docs-home-links">
      <a class="docs-home-link" href="https://github.com/VipMaxxxx/payincus"><span class="docs-home-link-index">GH</span><span><strong>GitHub</strong><small>Source, Releases, and issue tracking.</small></span></a>
      <a class="docs-home-link" href="https://t.me/Payincus"><span class="docs-home-link-index">TG</span><span><strong>Telegram</strong><small>Join the PayIncus project group.</small></span></a>
      <a class="docs-home-link" href="/en/plugins/market"><span class="docs-home-link-index">EX</span><span><strong>Extension Market</strong><small>Governed extension listings and installation boundaries.</small></span></a>
      <a class="docs-home-link" href="/en/demo"><span class="docs-home-link-index">DE</span><span><strong>Live Demo</strong><small>Demo accounts and read-only limitations.</small></span></a>
    </div>
  </section>
</main>
