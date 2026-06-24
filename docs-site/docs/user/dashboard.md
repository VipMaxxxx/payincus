# 用户端功能

用户端面向普通客户，只提供客户自助能力，不暴露后台入口、后台跳转、后台 API 或管理文案。

入口：

```text
https://panel.example.com
```

## 访问边界

- 普通用户登录后进入客户控制台。
- 管理员账号访问用户端会被拦截，引导使用独立后台。
- 用户端 authenticated routes 均要求普通用户身份。
- 用户端构建产物目录是 `client/dist/user`。

## 核心页面

| 功能 | 路由 | 说明 |
| --- | --- | --- |
| 首页与产品市场 | `/`, `/market` | 展示产品、套餐和站点公开内容。 |
| 控制台 | `/dashboard` | 查看账号概览、实例概览、余额、通知和常用入口。 |
| 实例列表 | `/instances` | 查看名下 LXC / KVM 实例、状态、资源和操作入口。 |
| 创建实例 | `/instances/create` | 按套餐、镜像、节点、资源限制创建实例。 |
| 实例详情 | `/instances/:id` | 启动、停止、重启、删除、查看网络、终端和运行状态。 |
| 集中终端 | `/terminal` | 统一进入 WebSocket 终端，依赖 `/api/ws` 升级。 |
| 钱包 | `/wallet` | 充值、余额、消费记录、订单状态和支付回调结果。 |
| 邀请码 | `/invites` | 邀请关系、返利、邀请记录。 |
| 转移 | `/transfers` | 实例或资源转移相关自助入口。 |
| 工单 | `/tickets` | 提交问题、查看回复、上传附件和关闭工单。 |
| 通知 | `/inbox` | 查看站内通知、系统消息和投递状态。 |
| 日志 | `/logs` | 查看个人相关操作日志；模块、操作、结果和常见日志内容会按中文展示。 |
| 帮助 | `/help` | 查看管理员维护的帮助文章。 |
| 个人设置 | `/profile` | 修改资料、安全项、OAuth 绑定和通知偏好。 |

## 可选自助模块

以下模块会根据系统配置、账号权限或构建边界显示：

- 域名邮箱：`/mail`、`/mail/domains/:id`，用于邮箱套餐、域名和账号管理。
- 托管节点：`/resources/hosts`，允许满足条件的用户提交和管理托管节点。
- 托管套餐：`/resources/packages`，用于托管方维护自己的套餐。
- 托管收益：`/hosting-wallet`，用于查看托管收益和结算记录。
- 娱乐系统：`/entertainment`，用于积分、会员或扩展玩法。

## 关联后端能力

- 实例交付：`instances`、`instance-billing`、`terminal`、`traffic`、`snapshots`。
- 账务支付：`balance`、`recharge`、`redeem-codes`、`aff`、`vip-levels`。
- 工单通知：`tickets`、`inbox`、`notifications`、`help`。
- 邮箱服务：`mail`。
- 托管资源：`hosting`、`resource-pool`、`packages`。

## 验证重点

- 普通用户可以登录用户端并完成常规自助操作。
- 用户端页面不出现 `/admin` 导航、后台 API 入口或后台文案。
- 管理员账号不能进入用户端业务页面。
- `/api/health` 和 `/api/ws` 在用户端域名下可用。
- 支付回调、实例创建、终端连接、通知投递需要做真实线上 proof。
