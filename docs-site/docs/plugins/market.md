# 扩展市场

PayIncus 扩展市场是扩展中心的稳定在线目录。后台扩展中心应固定读取机器可读索引：

```text
https://payincus.com/plugin-market/index.json
```

这个地址不跟随 PayIncus Release 版本变化。PayIncus 升级、回滚或 OTA 后，后台仍读取同一个在线目录。

## 当前上架扩展

| 扩展 | 类型 | 状态 | 下载源 | 安全策略 |
| --- | --- | --- | --- | --- |
| AI 工单助手 | 官方扩展 | 已上架 | 文档站稳定扩展市场 | 安装时校验 SHA256 |

## 目录文件

- 市场索引：[/plugin-market/index.json](/plugin-market/index.json)
- AI 工单助手 manifest：[/plugin-market/manifests/com.payincus.ai-ticket-agent/0.1.1.json](/plugin-market/manifests/com.payincus.ai-ticket-agent/0.1.1.json)
- AI 工单助手扩展包：[/plugin-market/packages/com.payincus.ai-ticket-agent/0.1.1/plugin.tar.gz](/plugin-market/packages/com.payincus.ai-ticket-agent/0.1.1/plugin.tar.gz)

## 审核规则

只有 `reviewStatus = listed` 的扩展会出现在默认市场。第三方扩展提交后先进入审核队列，必须通过包结构、manifest、SHA256、权限、兼容范围和高风险能力审查，才能写入稳定市场索引。

## 安装规则

后台安装扩展时必须重新下载扩展包并校验 SHA256。市场目录提供展示和发现能力，不替代服务端安装校验。
