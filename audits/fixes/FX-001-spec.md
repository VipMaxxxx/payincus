# FX-001 规格：插件 iframe 同源会话接管(P0 / D-001)

## 根因
client/src/components/plugins/PluginFrame.vue 的 <iframe> 同时设置 sandbox="allow-forms allow-scripts allow-same-origin",
而插件内容经 /api/plugins/assets/ 从**主站同源**加载 → allow-scripts + allow-same-origin 组合使插件脚本获得主站同源权限,
可读取主站 cookie/localStorage、以当前用户(含管理员)身份调用站点 API → 会话接管。

## 修法(最小、自包含)
1. PluginFrame.vue 的 iframe sandbox 去掉 allow-same-origin：改为 sandbox="allow-forms allow-scripts"。
   → 插件运行在不透明(opaque)源,无法访问父窗口 cookie/DOM/会话。
2. 因 iframe 变为 opaque 源,postPluginConfig 的 postMessage targetOrigin 从 window.location.origin 改为 '*'
   (传的是非敏感插件配置;frame src 由我们控制)。仅改这一处 targetOrigin,不改消息结构。
3. 若插件运行时/模板侧有监听 'payincus:plugin-config' 的代码按 event.origin 校验主站源,
   需改为按 event.data.type + event.source===window.parent 校验(因父源不变、子源变 opaque)。
   先在 plugin-templates/ 与 client 内 grep 该消息监听,若存在按此调整;若不存在则跳过。

## 不许动
- 不改插件资产鉴权(assetToken)逻辑;不改后端 /api/plugins/assets 路由。
- 不动其它 iframe/组件。不做大重构。

## 验收
- client type-check 通过;client build(user+admin)通过。
- 跑 server 守卫:pnpm --filter server test:plugin-client-boundary-guards;若该守卫断言了 sandbox 串,需同步更新守卫断言为新值(不含 allow-same-origin),并**新增/加强一条断言:PluginFrame.vue 必须不含 'allow-same-origin'**,把该修复钉死。
- 同时跑 pnpm --filter server test:plugin-center-guards 与 test:frontend-route-guards,确保未破坏。

## 交付
改完用一段话说明:改了哪些文件、postMessage 与消息监听如何处理、跑了哪些守卫及结果。不要 commit。
