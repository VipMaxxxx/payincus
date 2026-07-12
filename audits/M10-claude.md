# M10 审计报告

## 结论摘要
M10 的 OTA 主链路(版本校验、artifact sha256/尺寸校验、原子发布/回滚、路径穿越防护、任务原子认领、磁盘预检、生产就绪快照脱敏)工程质量很高,守卫覆盖密集,未发现命令注入或可被匿名利用的 RCE。最突出的问题是权限模型不自洽:OTA/插件/主题等"高危能力白名单"本身可被任意普通管理员通过系统配置写入接口改写,从而自行提权为 OTA 超管——这直接击穿了 AGENTS.md 所声明的"OTA owner-only"边界。其余为若干配置项缺少取值/协议校验导致的存储型 XSS 与降级面。

## 发现清单

- [M10-01] P1 | 置信度 高 | server/src/routes/system-config.ts:291-292、382、527-538 ; server/src/routes/system-update.ts:43-53 ; server/src/app.ts:442-448,474
  - 问题:OTA 管理权限由 canManageSystemUpdates 通过 system_update_allowed_admin_ids 白名单判定,但该白名单本身是普通系统配置项,PUT /api/admin/system-config 只要求 authenticateAdmin(=任意 role==='admin' 活跃账号),没有"超管"二次校验。任意普通管理员可把自己 UID 写入该配置,随后即可通过 OTA 权限校验发起 /start、/rollback。同理适用于 plugin_manager_allowed_admin_ids、theme_manager_allowed_admin_ids、payincus_gift_card_admin_ids。
  - 证据:配置路由 `fastify.put('/', { onRequest:[fastify.authenticateAdmin] })`,validKeys 含 system_update_allowed_admin_ids 且仅做 normalizeAdminIdCsv 归一化写库;门禁 `if (allowedIds.size>0) return allowedIds.has(user.id); return user.username==='admin'`;authenticateAdmin 仅校验 role!=='admin'。
  - 影响:普通管理员越权自我提权到"OTA 超管",可在生产触发全站更新/回滚(最高危路径);把白名单只写成自己 UID 还会因 allowedIds.size>0 分支把仅靠用户名 admin 兜底的 owner 反向锁死出 OTA,形成能力接管/拒绝服务。
  - 修复建议:对 *_allowed_admin_ids 这类"高危能力白名单"配置键的写入单独收敛到超管级校验(与 OTA 同一门禁),不允许普通管理员改。

- [M10-02] P2 | 置信度 中 | server/src/routes/system-config.ts:401-407(stringKeys 无校验) ; client/src/components/layout/SideNav.vue:42-45,477-478
  - 问题:footer_telegram_link 属 stringKeys,后端仅按字符串保存,无协议/格式校验(对照 brand_logo_url、popup_promo_image_url 均做 isHttpImageUrl),前端直接绑定为 `<a :href="footerTelegramLink">` 展示给所有公开访客。
  - 影响:管理员(含被 M10-01 提权者)可写入 `javascript:...` 造成面向全体用户的存储型 XSS,或写入任意外链钓鱼/开放重定向。
  - 修复建议:后端对 footer_telegram_link 增加 http/https 协议白名单校验后再落库。

- [M10-03] P3 | 置信度 中 | server/src/lib/system-version.ts:66-68 ; server/src/routes/system-update.ts:184-198
  - 问题:/start 仅用 isValidReleaseTag(纯格式正则)与"tag 存在/是 Git 工作区"校验目标版本,不比较目标与当前版本先后,允许 OTA 到更旧 release tag。
  - 影响:可将生产降级到已修复漏洞的旧版本(降级攻击面),重新引入已修补的安全问题。
  - 修复建议:/start 增加"目标版本需不低于当前版本"语义比较,确需降级走单独显式确认路径。

- [M10-04] P3 | 置信度 中 | server/src/routes/system-config.ts:404(avatar_api_base 无校验) ; client/src/components/UserAvatar.vue:89-90
  - 问题:avatar_api_base 无 URL/协议/长度校验,前端作为所有用户头像图片 URL 基址拼接并在 /public 下发。
  - 影响:管理员误配/恶意配置可让全体用户浏览器向任意主机发起图片请求(客户端 SSRF/追踪/混合内容)或头像整体失效。
  - 修复建议:后端对 avatar_api_base 增加 https URL 校验与长度上限。

- [M10-05] P3 | 置信度 高 | server/src/db/system-config.ts:14-20,185-201 ; server/src/routes/system-config.ts:719-731
  - 问题:telegram_group_chat_id、telegram_vip_group_chat_id 在审计日志中被当 sensitiveKeys 脱敏,但不在 SENSITIVE_CONFIG_KEYS 中,既不加密也不在 GET / 返回时打码,而是明文回给任意管理员。脱敏口径前后不一致。
  - 影响:私有群/高级群 chat_id 在管理端接口明文暴露且不加密存储,信息泄露面较低但口径应统一。
  - 修复建议:将两个 chat_id 纳入 SENSITIVE_CONFIG_KEYS(或从审计敏感集移除),使加密/打码/审计三处口径一致。

- [M10-06] P3 | 置信度 低 | server/src/lib/config-cache.ts:16-70 ; server/src/db/system-config.ts:208-249,308-339
  - 问题:配置缓存是纯进程内 Map 且会缓存 null/空值(TTL 5 分钟)。API 写路径 invalidateAllConfigCache 能即时失效,单进程部署一致;但带外写(直接改库/脚本/迁移)或未来多进程扩容会有最长 5 分钟读旧值窗口(敏感键不走缓存无此问题)。
  - 影响:带外配置变更或多实例部署下 /public 与业务读到过期配置,表现为"改了配置不生效"。
  - 修复建议:架构文档标注该缓存为进程内单实例假设,横向扩容前改共享缓存或引入变更通知失效。

补充:OTA 执行链(run-system-update-task.ts / rollback-system-update-task.ts / apply-online-update.sh)未发现可注入点——targetVersion 全程 isValidReleaseTag 收敛、artifact 经 sha256+size 校验、回滚 backupPath 限定在 installDir.bak.* 或 releases/ 内且 existsSync 校验、任务用 tryMarkSystemUpdateTaskRunning 原子认领、日志读取限定 logDir 内,均符合不变量。
