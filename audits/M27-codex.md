# M27 审计报告
## 结论摘要
文档站主体与校验脚本整体较稳健，但部署外围存在两处高影响信任边界问题：后端运行用户可改写 root 任务代码，以及代理头配置允许客户端伪造来源 IP。Public API SDK 另有两处明确契约偏差，会导致调用参数静默失效或 TypeScript 示例无法编译。

## 发现清单
- [M27-01] P1 | 置信度 高 | scripts/install-panel.sh:1136
  - 问题:root 权限的在线更新单元直接执行 `incudal` 用户可写目录中的 JavaScript，形成从后端服务用户到 root 的提权路径。
  - 证据:`User=root` 的单元使用 `ExecStart=/usr/bin/node ${app_dir}/server/dist/scripts/run-system-update-task.js %i`；安装及升级流程又在第 828、1552 行执行 `chown -R "${RUN_USER}:${RUN_USER}" "$INSTALL_DIR"`，第 1174 行允许该用户免密启动对应单元。`deploy/incudal-backend.service.example:32` 还将 `/opt/incudal/current` 列入 `ReadWritePaths`。
  - 影响:一旦后端进程、扩展代码或 `incudal` 本地账号被攻破，攻击者可替换 root 单元执行的脚本，再通过允许的 `systemctl start` 获得完整 root 权限。
  - 修复建议:由 owner 按 OTA 高危流程专项收紧信任边界，确保 root helper 只执行 root 拥有且服务用户不可写的固定入口及已验证产物。

- [M27-02] P1 | 置信度 高 | deploy/nginx-split-intranet.conf.example:57
  - 问题:Nginx 保留客户端传入的转发头，而安装配置又让 Fastify 无条件信任代理头，外部请求可以伪造 `request.ip`。
  - 证据:Nginx 使用 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`，第 9-16 行还原样优先采用客户端的 `X-Forwarded-Proto`、`X-Forwarded-Host`；`scripts/install-panel.sh:922` 固定生成 `TRUST_PROXY=true`，`server/src/lib/trust-proxy-config.ts:8-10` 将其转换为全量信任。限流键直接使用 `request.ip`（`server/src/app.ts:318-324`），支付回调 IP 白名单也使用该值（`server/src/routes/recharge.ts:3385-3412`）。
  - 影响:攻击者可轮换伪造 IP 绕过全局限流、终端连接限制及登录风控；若支付回调端点可直达该 Nginx，还可绕过回调来源 IP 白名单这一层防护。
  - 修复建议:仅信任明确的代理跳数或地址，并在最外层代理覆盖而非追加客户端提供的转发头。

- [M27-03] P2 | 置信度 高 | docs-site/docs/public/sdk/payincus-public-api.ts:116
  - 问题:余额调整 SDK 暴露了后端不识别的 `externalReference`，同时遗漏实际支持的 `requestType` 和 `orderNo`。
  - 证据:SDK 输入类型在第 119 行声明 `externalReference?: string`，示例也在 `docs-site/docs/public/sdk/examples/balance-adjustment-request.ts:12-16` 传入该字段；后端请求契约实际只读取 `amount`、`requestType`、`reason`、`orderNo`（`server/src/routes/public-api.ts:138-143,1411-1414`）。
  - 影响:第三方以为外部关联号已被保存，实际会被静默忽略，导致对账关联丢失，并可能在重试时产生难以辨认的重复申请。
  - 修复建议:以 OpenAPI 和后端实现为准统一 SDK 输入字段，并避免对未知关键字段静默成功。

- [M27-04] P2 | 置信度 高 | docs-site/docs/public/sdk/payincus-public-api.ts:251
  - 问题:`PayIncusNotificationInput` 将 `template` 声明为必填，但后端和文档均允许只传 `title`、`message`。
  - 证据:SDK 第 254 行定义 `template: PayIncusNotificationTemplateId | null`；文档 `docs-site/docs/plugins/sdk.md:201-206` 的示例调用没有 `template`。后端 `server/src/routes/public-api.ts:2723-2735` 明确在模板缺失时回退读取 `title` 和 `message`。
  - 影响:用户复制官方 TypeScript 示例或按文档发送普通通知时会出现必填属性类型错误，无法通过类型检查。
  - 修复建议:将 SDK 类型建模为“模板通知”与“标题正文通知”的联合类型，使必填条件与后端契约一致。
