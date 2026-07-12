# 文档覆盖能力

本页定义 PayIncus 文档站的可用标准。文档不是品牌介绍页，而是安装、部署、API 接入和生产运维的操作入口。所有公开文档必须以当前仓库代码、脚本、路由、环境变量和生产部署结构为准。

## 可用标准

| 范围 | 必须达到的结果 | 权威来源 |
| --- | --- | --- |
| 安装 | 新用户可以按文档完成一键安装、域名配置、后台启动和首次访问 | `scripts/install-panel.sh` |
| 手动部署 | 运维可以按文档构建用户端、管理端、后端并配置 systemd/Nginx | `package.json`、`deploy/`、`scripts/verify-split-host.sh` |
| 环境变量 | 文档中的变量必须被代码或脚本实际读取，默认值和风险说明要准确 | `scripts/install-panel.sh`、`server/src/config`、`server/src/lib/runtime-settings.ts` |
| OTA | 管理员可以理解 Release artifact、SHA256、任务、日志、回滚和原子 release 布局 | `server/src/routes/system-update.ts`、`server/src/scripts/run-system-update-task.ts` |
| Agent | 节点管理员可以安装 Agent、理解证书、心跳、资源上报和常见故障 | `server/templates/`、`agent/`、`server/src/routes/agent*.ts` |
| 资源交付 | 套餐、方案、存储池、库存、带宽、流量、实例升级和容量限制必须与当前实现一致 | `server/src/routes/instances.ts`、`server/src/routes/instance-billing.ts`、`server/src/db/hosts.ts` |
| 支付账务 | 充值、余额、账单、回调、对账、调账和退款说明必须保持高风险边界 | `server/src/routes/orders.ts`、`server/src/routes/admin-billing.ts` |
| Public API | 接口、认证、scope、分页、排序、错误模型和 SDK 示例必须与路由一致 | `server/src/routes/public-api.ts`、`server/src/lib/public-api-openapi.ts` |
| 排障 | 常见故障必须给出检查命令、日志路径和安全处理方式 | `scripts/verify-*`、systemd、Nginx、OTA 日志 |

## 当前覆盖

PayIncus 文档站当前覆盖：

- 产品定位、角色、架构和生产 split 部署。
- 一键安装、手动部署、Nginx、systemd 和环境变量。
- 用户端、管理后台、实例交付、账务支付、通知工单、托管和资源池。
- 宿主机 Agent 安装、心跳、资源上报和交付边界。
- 后台 OTA、Release artifact、SHA256、原子 `current/releases` 布局和回滚。
- 全站能力矩阵，用于对齐后台入口、用户入口、API、代码来源、守卫和下一批缺口。
- OAuth Provider、Public API、OpenAPI、Bearer token、scope、分页、排序、错误模型和 SDK。
- 常见问题和排障路径。

## 维护规则

每次改动以下内容，必须同步更新文档：

- 新增或修改环境变量。
- 新增或修改公开 API、OAuth scope、SDK 方法。
- 修改一键安装、Nginx、systemd、OTA、Agent 安装脚本。
- 修改套餐、资源、实例交付、余额、支付、退款和权限。
- 修改任何后台入口、用户入口、公开 API、OAuth scope、资源交付或支付账务能力时，同步更新全站能力矩阵。

涉及认证、支付、权限、资源交付、余额和 OTA 的文档变更，必须同时写清风险、边界和验证方式。

## 验证命令

文档发布前至少执行：

```bash
pnpm --dir docs-site --ignore-workspace build
pnpm --filter server test:frontend-i18n-keys
rg "旧来源关键词或旧贡献者名称" README.md docs-site
```

涉及部署、OTA 或 API 的文档，还应按变更范围运行对应守卫：

```bash
pnpm --filter server test:system-update-guards
pnpm --filter server test:public-api-openapi-guards
```
