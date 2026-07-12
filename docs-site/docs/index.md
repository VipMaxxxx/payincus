---
layout: home
title: PayIncus 文档
description: PayIncus 部署、运营、开发与 OTA 文档
---

<main class="docs-home">
  <section class="docs-home-masthead">
    <div class="docs-home-brand">
      <img class="docs-home-logo" src="/incudal_logo.webp" alt="PayIncus">
      <div>
        <p class="docs-home-eyebrow">PayIncus Documentation</p>
        <h1>PayIncus 文档</h1>
        <p class="docs-home-summary">面向 Incus 商业化交付平台的部署、运营、API 接入和生产维护手册，覆盖用户端、管理后台和后台 OTA。按工作目标查找步骤，不需要先了解整个系统。</p>
        <div class="docs-home-actions">
          <a class="docs-home-button primary" href="/deployment/one-click-install">部署 PayIncus</a>
          <a class="docs-home-button" href="/guide/introduction">了解系统</a>
          <a class="docs-home-button" href="/api/overview">查看 API</a>
        </div>
      </div>
    </div>
    <aside class="docs-home-release">
      <span>Production Operations</span>
      <strong>发布与更新</strong>
      <p>安装包、OTA 和回滚均以 GitHub Release 与 SHA256 校验结果为准。</p>
      <a href="/release/version-log">查看版本日志</a>
    </aside>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>从这里开始</h2>
      <p>选择与你当前任务最接近的入口。</p>
    </div>
    <div class="docs-home-links">
      <a class="docs-home-link" href="/deployment/one-click-install"><span class="docs-home-link-index">01</span><span><strong>一键安装</strong><small>在 Debian 或 Ubuntu 新服务器上完成首次部署。</small></span></a>
      <a class="docs-home-link" href="/deployment/manual-install"><span class="docs-home-link-index">02</span><span><strong>手工部署</strong><small>接入已有 PostgreSQL、Nginx、systemd 和发布流程。</small></span></a>
      <a class="docs-home-link" href="/guide/split-deployment"><span class="docs-home-link-index">03</span><span><strong>前后台分离</strong><small>配置用户端、管理端、API 和域名边界。</small></span></a>
      <a class="docs-home-link" href="/guide/ota-update"><span class="docs-home-link-index">04</span><span><strong>后台 OTA</strong><small>校验 Release、切换版本并执行受控回滚。</small></span></a>
    </div>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>按工作查找</h2>
      <p>文档结构对应部署、日常运营和开发工作。</p>
    </div>
    <div class="docs-home-columns">
      <div class="docs-home-column">
        <h3>部署与运维</h3>
        <a href="/deployment/environment">环境变量</a>
        <a href="/deployment/systemd">systemd 服务</a>
        <a href="/deployment/nginx">Nginx 分离部署</a>
        <a href="/troubleshooting/common-errors">常见错误</a>
      </div>
      <div class="docs-home-column">
        <h3>产品与运营</h3>
        <a href="/user/dashboard">用户端功能</a>
        <a href="/admin/overview">管理后台功能</a>
        <a href="/features/billing">支付与账务</a>
        <a href="/features/instances">实例与资源交付</a>
      </div>
      <div class="docs-home-column">
        <h3>API 与接入</h3>
        <a href="/api/overview">Public API</a>
        <a href="/api/overview#oauth">OAuth Provider</a>
      </div>
    </div>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>项目入口</h2>
      <p>源码、交流与在线环境。</p>
    </div>
    <div class="docs-home-links">
      <a class="docs-home-link" href="https://github.com/VipMaxxxx/payincus"><span class="docs-home-link-index">GH</span><span><strong>GitHub</strong><small>查看源码、Release 和问题记录。</small></span></a>
      <a class="docs-home-link" href="https://t.me/Payincus"><span class="docs-home-link-index">TG</span><span><strong>Telegram</strong><small>加入 PayIncus 项目交流群。</small></span></a>
      <a class="docs-home-link" href="/demo"><span class="docs-home-link-index">DE</span><span><strong>在线 Demo</strong><small>了解演示环境的账号和只读限制。</small></span></a>
    </div>
  </section>
</main>
