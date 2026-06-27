---
layout: home
title: PayIncus

hero:
  name: PayIncus
  text: 面向 Incus 的商业化交付与计费平台
  tagline: 管理 NAT VPS 销售、资源交付、支付账务、工单通知、Agent 上报、扩展市场、主题系统和后台 OTA。
  image:
    src: /incudal_logo.webp
    alt: PayIncus
  actions:
    - theme: brand
      text: 开始使用
      link: /guide/introduction
    - theme: alt
      text: 在线 Demo
      link: /demo
    - theme: alt
      text: 扩展市场
      link: /plugins/market

features:
  - title: 自动化
    details: 订单、计费、实例生命周期、资源回滚、通知和 OTA 都进入可审计流程。
  - title: 响应式
    details: 用户端和管理后台分离构建，适配桌面与移动端常用操作。
  - title: 高性能
    details: 静态前端、同源 API、Nginx 分离部署和生产预检脚本用于保持稳定交付。
  - title: 品牌化
    details: 扩展中心和主题系统支持第三方能力、受控 UI 和品牌化视觉。
  - title: 开放运营
    details: 关键链路有版本日志、生产 proof、后台 OTA 任务和脱敏审计记录。
  - title: 可扩展
    details: Public API、OAuth Provider、SDK、事件、action runtime 和扩展存储组成开发平台。
---

::: info 扩展中心
[扩展开发](/plugins/overview)：扩展中心、在线扩展市场、主题系统、OAuth Provider、Public API 和 SDK 组成第三方开发入口。
:::

<section class="payincus-section">
  <p class="payincus-kicker">项目定位</p>
  <h2>给 hosting 业务使用的交付、计费和运营控制台</h2>
  <p>PayIncus 把用户购买、余额扣费、Incus 实例创建、Web terminal、工单通知、支付回调、Agent 上报和后台升级放进同一个受控平台。它不是只提供面板页面，而是围绕真实生产运营建立审计、权限和恢复链路。</p>
  <div class="payincus-grid">
    <div class="payincus-card">
      <strong>用户端</strong>
      <span>套餐市场、实例列表、实例详情、终端、钱包、订单、工单、通知、邀请和自助操作。</span>
    </div>
    <div class="payincus-card">
      <strong>管理后台</strong>
      <span>用户、套餐、节点、镜像、订单、支付渠道、财务、客服、资源池、SLA、告警和 OTA。</span>
    </div>
    <div class="payincus-card">
      <strong>生产运维</strong>
      <span>原子 current/releases 发布、Release artifact 校验、生产预检、回滚和脱敏 proof 记录。</span>
    </div>
  </div>
</section>

<section class="payincus-section payincus-split">
  <div>
    <p class="payincus-kicker">扩展中心</p>
    <h2>实时扩展市场与第三方开发平台</h2>
    <p>扩展中心支持上传安装、在线扩展市场安装、投稿审核、扫描、发布、启用、停用、卸载、配置表单、事件投递、webhook action、扩展存储、Gateway Extension、Server Extension 和开发者 SDK。</p>
    <div class="payincus-links">
      <a class="payincus-link" href="/plugins/overview"><strong>扩展总览</strong> 扩展中心能力和安全边界</a>
      <a class="payincus-link" href="/plugins/market"><strong>扩展市场</strong> 稳定在线市场目录</a>
      <a class="payincus-link" href="/plugins/development"><strong>扩展开发</strong> 开发指南、Manifest、事件、Action、存储和主题系统</a>
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
    <p class="payincus-kicker">API</p>
    <h2>通过 OAuth、API Token 和 SDK 自动化平台能力</h2>
    <p>Public API 提供 `/api/v1`、OpenAPI、Bearer token、scope、分页、排序、白名单过滤和统一错误模型。第三方系统可以读取当前授权用户的产品、服务、订单、账单、工单、通知，并触发受控服务动作或扩展 action。</p>
    <div class="payincus-links">
      <a class="payincus-link" href="/api/overview"><strong>API 参考</strong> 公共 API 和权限边界</a>
      <a class="payincus-link" href="/plugins/sdk"><strong>SDK</strong> TypeScript SDK 与示例</a>
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
  <p class="payincus-kicker">部署</p>
  <h2>从安装到生产验收的固定路径</h2>
  <p>文档按安装、分离部署、环境变量、systemd、Nginx、生产验收和后台 OTA 组织。上线后可通过后台读取 Release manifest，下载 artifact，校验 SHA256，并切换到新的 release 目录。</p>
  <div class="payincus-grid">
    <a class="payincus-link" href="/deployment/one-click-install"><strong>一键安装</strong> 面板安装与初始化</a>
    <a class="payincus-link" href="/guide/split-deployment"><strong>前后台分离</strong> 用户端、后台端和 API 边界</a>
    <a class="payincus-link" href="/guide/ota-update"><strong>后台 OTA</strong> Release artifact 更新和回滚</a>
  </div>
</section>

<section class="payincus-section">
  <p class="payincus-kicker">社区</p>
  <h2>连接项目、版本和运营证据</h2>
  <div class="payincus-links">
    <a class="payincus-link" href="https://t.me/Payincus"><strong>Telegram</strong> 加入 PayIncus 交流群</a>
    <a class="payincus-link" href="https://github.com/VipMaxxxx/payincus"><strong>GitHub</strong> 查看源码与 Release</a>
    <a class="payincus-link" href="/release/version-log"><strong>版本日志</strong> 查看系统版本更新日志</a>
    <a class="payincus-link" href="/deployment/production-checklist"><strong>生产验收</strong> 上线验收和 proof 规则</a>
  </div>
</section>
