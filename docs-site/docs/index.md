---
layout: home

hero:
  name: PayIncus
  text: Incus NAT VPS 销售、交付与管理平台
  tagline: 用户端、管理后台、Incus 资源交付、Agent 上报、支付回调和后台 OTA 的生产文档。
  image:
    src: /incudal_logo.webp
    alt: PayIncus
  actions:
    - theme: brand
      text: 开始部署
      link: /deployment/one-click-install
    - theme: alt
      text: 查看架构
      link: /guide/architecture
    - theme: alt
      text: 后台 OTA
      link: /guide/ota-update
    - theme: alt
      text: 版本日志
      link: /release/version-log

features:
  - title: 前后台分离
    details: 用户端和管理端是两个 Vite entry，分别构建到 client/dist/user 和 client/dist/admin。
  - title: Incus 交付
    details: 面向 LXC / KVM NAT VPS 场景，覆盖套餐、节点、镜像、实例、终端和流量。
  - title: 后台 OTA
    details: 支持 GitHub Release manifest、SHA256 校验、原子 current/releases 切换和回滚。
  - title: Agent 上报
    details: 宿主机 Agent 提供心跳、资源、实例、流量和二进制下载代理链路。
  - title: 生产预检
    details: 内置 split host、生产配置、响应头、日志暴露和最终验收脚本。
  - title: 插件中心
    details: 支持上传安装、GitHub 插件市场、启用管理、用户端扩展点和开发模板。
---

## 快速入口

<div class="payincus-links">
  <a class="payincus-link" href="/demo">
    <strong>在线 Demo</strong>
    体验用户端和管理后台
  </a>
  <a class="payincus-link" href="/deployment/one-click-install">
    <strong>开始部署</strong>
    一键安装与生产配置
  </a>
  <a class="payincus-link" href="https://t.me/Payincus">
    <strong>Telegram 交流群</strong>
    t.me/Payincus
  </a>
  <a class="payincus-link" href="https://github.com/VipMaxxxx/payincus">
    <strong>GitHub</strong>
    VipMaxxxx/payincus
  </a>
</div>

## 推荐阅读顺序

1. 先读 [系统架构](/guide/architecture) 和 [前后台分离](/guide/split-deployment)。
2. 部署时按 [一键安装](/deployment/one-click-install) 或 [手动部署](/deployment/manual-install) 执行。
3. 上线前完成 [生产验收](/deployment/production-checklist)。
4. 升级维护时使用 [后台 OTA](/guide/ota-update)，查看 [系统版本更新日志](/release/version-log)。

## 功能文档

- [用户端功能](/user/dashboard)：客户控制台、实例、终端、钱包、邀请、工单、通知和自助模块。
- [管理后台功能](/admin/overview)：用户、实例、账务、支付、通知、系统配置和 OTA。
- [插件开发](/plugins/overview)：插件中心、manifest、前后台扩展点、安装模板和第三方开发流程。
- [实例与资源交付](/features/instances)：从下单、计费、Incus 创建到 Agent 上报的完整链路。
- [支付与账务](/features/billing)：充值、回调、余额、返利、兑换码和后台账务审计。
- [通知、工单与帮助](/features/communication)：站内信、SMTP、Telegram、Lsky、工单和帮助中心。
- [托管与资源池](/features/resource-hosting)：宿主机、资源池、托管套餐、收益和 Agent 关联。
