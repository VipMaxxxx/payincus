# 项目介绍

PayIncus 是面向 Incus hosting 业务的 NAT VPS 销售、交付、计费和运营平台。它把用户购买、余额扣费、实例创建、NAT 网络、流量统计、工单通知、支付回调、宿主机 Agent、Public API 和后台 OTA 放进一套可审计流程。

## 适用场景

- 销售 LXC / KVM NAT VPS、IPv6 VPS 或轻量容器实例。
- 使用 Incus 作为实例运行时，需要用户自助购买、续费、升级和终端访问。
- 需要管理套餐、节点、存储池、流量、带宽、支付渠道、订单和余额。
- 需要宿主机 Agent 上报资源、实例状态和流量。
- 需要 OAuth Provider、Public API 和开发者 SDK。
- 需要后台在线更新、Release artifact 校验和自动回滚。

## 角色

- 用户：注册登录、购买套餐、管理实例、使用 Web 终端、续费升级、充值、提交工单、查看通知和兑换礼品卡。
- 管理员：管理用户、套餐、方案、节点、存储池、镜像、订单、账务、支付、通知、资源池和版本更新。
- 宿主机 Agent：安装在 Incus 节点上，负责心跳、资源、实例状态、流量和交付辅助数据上报。
- 开发者：使用 OAuth、Public API 和 SDK 接入第三方业务。

## 当前产品边界

PayIncus 是非 Docker split 部署优先的生产系统：

- 用户端和管理端是两个 Vite 构建入口。
- 用户端产物目录是 `client/dist/user`。
- 管理端产物目录是 `client/dist/admin`.
- 后端入口是 `server/dist/app.js`。
- Nginx 托管两个前端，并只把 `/api` 和 `/api/ws` 反代到后端。
- PostgreSQL 是核心持久化来源。
- Redis 由安装脚本保留，用于部署兼容和后续分布式状态扩展。
- 默认安装目录是 `/opt/incudal`，这是当前脚本、systemd、OTA 和线上 release 布局使用的真实路径。

## 入口

- 用户端：`https://panel.example.com`
- 管理后台：`https://admin.example.com`
- 在线 Demo：[/demo](/demo)
- 一键安装：[/deployment/one-click-install](/deployment/one-click-install)
- 生产部署：[/deployment/manual-install](/deployment/manual-install)
- API 文档：[/api/overview](/api/overview)

## 下一步

如果你是首次部署，按顺序阅读：

1. [系统架构](/guide/architecture)
2. [一键安装](/deployment/one-click-install)
3. [Nginx 分离部署](/deployment/nginx)
4. [环境变量](/deployment/environment)
如果你要开发第三方功能，从 [Public API](/api/overview) 开始。
