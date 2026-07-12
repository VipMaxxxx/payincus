# M26 审计报告
## 结论摘要
前端基座整体具备刷新锁、路由鉴权和 SW 防循环措施，但跨标签页身份同步仍存在较严重的状态错配。另发现异步轮询竞态、功能开关失败开放、SW 越界清缓存及全局错误仅写控制台等问题。

## 发现清单
- [M26-01] P1 | 置信度 高 | client/src/stores/auth.ts:16
  - 问题:跨标签页 token 变化时只更新 `token`，没有清除或重载 `user`、`quota`；路由守卫又只在 `user` 为空时重新获取用户，导致账号切换后身份长期错配。
  - 证据:`storage` 监听器仅执行 `token.value = e.newValue`；`client/src/router/user.ts:350` 使用 `authStore.isAuthenticated && !authStore.user` 决定是否刷新用户；请求层 `client/src/api/index.ts:502` 则直接使用新 `localStorage.token`。
  - 影响:一个标签页切换账号后，其他标签页可能仍显示旧账号、旧角色和旧配额，但实际 API 操作已由新账号执行，存在误操作其他账号资源的风险。
  - 修复建议:token 发生跨标签页变化时原子清空身份相关状态，并立即重新获取当前用户或整页重载。

- [M26-02] P2 | 置信度 高 | client/src/stores/restoreTask.ts:91
  - 问题:恢复任务使用异步 `setInterval` 每两秒轮询，没有进行中锁或请求序号，慢请求会重叠并乱序写回状态。
  - 证据:`setInterval(async () => ...)` 可在前次请求未完成时再次执行；每个响应都会无条件执行 `activeTask.value.status = status`，只有收到完成或失败响应后才停止后续定时触发。
  - 影响:较新的 `failed`/`completed` 状态可能被较早发出的 `processing` 响应覆盖；失败任务会丢失可回滚状态，界面也可能显示错误进度。
  - 修复建议:改为串行递归轮询或加入单飞锁和单调状态/响应序号校验。

- [M26-03] P2 | 置信度 高 | client/src/stores/config.ts:49
  - 问题:公共配置加载失败后吞掉异常并保留“功能开启”默认值，依赖该配置的路由守卫因此失败开放。
  - 证据:`ticketEnabled`、`mailAvailable` 默认均为 `true`；`loadPublicConfig()` 在第 79–81 行捕获错误后正常完成；`client/src/router/user.ts:373-390` 等待该函数后直接依据这些默认值放行工单和邮箱路由。
  - 影响:网络故障或配置接口异常时，管理员已关闭的入口仍会向用户开放，随后页面请求失败或被后端拒绝，形成前后端状态不一致。
  - 修复建议:显式区分“已加载”“加载失败”“已启用”，受配置控制的入口在状态未知时采用安全降级或展示重试页。

- [M26-04] P2 | 置信度 高 | client/public/sw.js:42
  - 问题:新 Service Worker 激活时删除除当前缓存外的全部同源 Cache Storage，而非仅删除 PayIncus 自己的旧缓存。
  - 证据:`cacheNames.filter(cacheName => cacheName !== CACHE_NAME).map(cacheName => caches.delete(cacheName))` 没有检查 `incudal-cache-` 前缀；静态资源恢复逻辑则正确使用了该前缀过滤。
  - 影响:同源插件、主题或其他子应用创建的缓存会在每次 SW 更新时被误删，造成离线资源消失、额外流量或其他功能异常。
  - 修复建议:激活清理时只删除属于 `incudal-cache-` 命名空间且不是当前版本的缓存。

- [M26-05] P2 | 置信度 中 | client/src/main.ts:115
  - 问题:用户端和管理端的六天定时刷新直接调用 `fetch`，未复用请求层的刷新锁，也没有与登出流程共享取消信号或会话世代。
  - 证据:定时器在响应成功后无条件执行 `localStorage.setItem('token', data.token)`；`client/src/stores/auth.ts:84-97` 的登出流程仅调用后端后清除本地状态，不会取消已经发出的定时刷新。管理端在 `client/src/admin/AdminApp.vue:72-94` 存在同样逻辑。
  - 影响:定时刷新与用户登出重叠时，较晚返回的刷新响应可能在登出完成后重新写入 token，使页面短暂或持续恢复为已登录状态。
  - 修复建议:所有刷新统一走同一单飞服务，并在登出时取消刷新及使用会话世代校验丢弃过期响应。

- [M26-06] P2 | 置信度 高 | client/src/main.ts:27
  - 问题:全局 Vue 错误处理对非静态资源错误只写控制台，没有错误页、用户提示或可恢复动作。
  - 证据:`app.config.errorHandler` 除 `console.error` 外只处理 `isStaleAssetLoadError`；`client/src/App.vue:98-105` 将其他组件错误继续传播到该处理器。管理端入口同样仅记录日志。
  - 影响:组件运行时异常会表现为空白区域、按钮无响应或残缺页面，用户不知道发生了什么，也无法主动重试。
  - 修复建议:为非 stale-asset 异常提供统一错误边界、友好提示和受控重试，同时保留脱敏诊断信息。

- [M26-07] P3 | 置信度 高 | client/src/locales/index.ts:60
  - 问题:三语词典并不完整，缺失项会被强制回退为简体中文，且入口标题仍有硬编码中文。
  - 证据:缺失回调固定执行 `resolveMessageFallback(zhCN, key)`；英文词典缺少已使用的 `publicSite.market.checkoutExtensionTitle/Description` 和 `instance.servicePanelExtensionTitle/Description`，繁体词典缺少 `admin.broadcast`、`admin.helpManage`、`admin.oauth` 命名空间；`client/src/App.vue:50` 和 `client/src/admin/AdminApp.vue:34` 仍使用中文标题回退。
  - 影响:英文或繁体中文用户会在市场、实例服务面板和部分管理页面看到简体中文，文档标题也可能混用语言。
  - 修复建议:补齐三语 key 并将标题回退文案纳入 i18n，同时扩展守卫以递归比较完整词典结构和实际使用 key。
