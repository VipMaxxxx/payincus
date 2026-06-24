# 插件中心

PayIncus 插件中心用于安装和管理第三方插件。插件可以提供后台配置页，也可以通过受控客户端扩展点向用户端增加入口或页面。

插件不会直接修改 PayIncus 源码。安装后的文件保存在运行态目录：

```text
/opt/incudal/plugins
/opt/incudal/plugin-data
/opt/incudal/plugin-logs
/opt/incudal/plugin-staging
```

这些目录会在 OTA 更新和回滚时保留。

## 能力

- 上传 `.tar.gz` 插件包安装
- 从 GitHub 插件市场安装
- 启用、禁用和卸载插件
- 查看安装任务日志
- 通过 `configSchema` 管理插件配置
- 通过 sandbox iframe 加载后台或用户端插件页面
- 使用内置模板开发插件，例如 `plugin-templates/ai-ticket-agent-plugin` 提供 AI 工单草稿插件模板

## 后台界面

插件中心在后台内部分为三个页面：

- 已安装：上传插件包、查看插件列表、启用/禁用/卸载插件、维护插件配置。
- 插件市场：单独展示 GitHub 市场索引，管理员可以刷新市场并安装市场插件。
- 安装任务：查看上传安装、市场安装、启用、禁用和卸载任务；任务列表固定每页最多 7 条，更多任务通过分页查看，右侧日志面板显示所选任务输出。

## AI 工单插件模板

`plugin-templates/ai-ticket-agent-plugin` 是官方插件模板，用于第三方开发 AI 工单辅助插件。模板要求 PayIncus `v0.3.2` 或更高版本。

启用后，后台工单详情页可以生成 AI 回复草稿。草稿只会填入回复框，不会自动发送；管理员必须人工确认后再提交。

模板依赖两个受控接口：

```text
POST /api/tickets/:id/ai/context
POST /api/tickets/:id/ai/draft
```

这些接口只允许管理员访问，必须启用 `com.payincus.ai-ticket-agent` 插件并授予对应权限。上下文只读取当前工单所属用户的脱敏摘要，不返回管理员内部备注、支付回调、密钥、root 密码或其他用户数据。

## 安全边界

- 只有超级管理员可以安装、启用、禁用和卸载插件。
- 用户端插件不能访问 `/api/admin/*`。
- 插件包不能包含绝对路径、`../` 路径、软链接或硬链接。
- 市场插件必须来自 GitHub Release artifact，并校验 SHA256。
- 当前版本不执行插件自带 shell 脚本，也不加载任意后端代码。
- AI 工单草稿只能生成待审文本，不能直接回复用户、改工单状态、调账、删除实例或执行其他业务操作。
