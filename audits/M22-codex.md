# M22 审计报告
## 结论摘要
主题平台存在多处高风险边界缺陷，整体健康度偏低。最严重问题是主题 HTML 净化可绕过并形成存储型 XSS，以及公开接口直接返回主题密码配置；市场下架和主题安装状态也存在失效窗口。

## 发现清单
- [M22-01] P1 | 置信度 高 | server/src/lib/theme-package.ts:382
  - 问题:模板安全校验使用正则匹配原始 HTML，HTML 实体可绕过 `javascript:` 检查，随后内容通过 `v-html` 注入用户端和管理端页面，形成存储型 XSS。
  - 证据:`if (/javascript:/i.test(html)) ...` 只匹配明文协议；例如 `href="&#x6a;avascript:..."` 可通过校验，并在浏览器解析属性时还原。`client/src/components/theme/ThemeTemplateSlot.vue:70` 使用 `v-html="html"` 直接渲染该片段。
  - 影响:通过市场审核或管理员上传并启用的恶意主题，可在公开页、用户中心乃至账单、OAuth 等管理页面执行脚本，窃取页面数据或冒充敏感操作界面。
  - 修复建议:改用严格白名单 HTML 解析净化器，并对所有 URL 属性做解码后的协议校验，同时加入实体编码、SVG 和样式属性攻击用例守卫。

- [M22-02] P1 | 置信度 高 | server/src/routes/themes.ts:106
  - 问题:无需鉴权的 `/active` 接口返回完整主题序列化对象，其中包含全部 `configValues`，包括主题声明的 `password` 类型配置。
  - 证据:`return { theme: theme ? serializeThemePackage(theme) : null }`；`server/src/db/themes.ts:77` 明确序列化 `configValues: asConfigValues(theme.configValues)`，而 `server/src/lib/theme-package.ts:19` 允许配置字段类型为 `password`。
  - 影响:任何访客均可读取当前主题保存的密码、令牌或其他敏感配置。
  - 修复建议:为公开响应建立专用 DTO，彻底移除密码及秘密字段，并避免在 manifest 默认值中暴露秘密。

- [M22-03] P1 | 置信度 高 | server/src/lib/theme-market-publisher.ts:112
  - 问题:市场发布器先载入旧索引全部条目，再仅覆盖当前 `listed` 投稿；已改为 `delisted`、`rejected` 或扫描失败的历史条目不会从索引删除。
  - 证据:`existingEntries` 在 125–127 行全部写入 `entriesById`，128–130 行只遍历 `listedSubmissions` 覆盖，没有按当前数据库审核状态移除旧投稿。
  - 影响:管理员执行下架或撤销审核后，恶意或存在漏洞的主题仍会继续展示并可被安装。
  - 修复建议:发布时以数据库当前可发布集合重建投稿条目，并仅显式合并有独立来源标识的内置主题。

- [M22-04] P1 | 置信度 高 | server/src/db/themes.ts:135
  - 问题:安装同一主题、同一版本时，代码先删除并替换线上资源目录，之后才更新数据库；当前已启用主题会在未执行 enable 的情况下立即加载新文件。
  - 证据:`await rm(finalPath...)` 和 `await rename(input.stagingDir, finalPath)` 位于 Prisma `upsert` 之前；上传路由在 `server/src/routes/admin-themes.ts:281-287` 直接调用该流程。
  - 影响:上传或市场重装可短暂绕过“安装后未启用”状态；若数据库更新失败，数据库仍显示旧主题已启用，但实际资源已被永久替换。
  - 修复建议:使用版本不可变目录和原子状态切换，数据库失败时回滚文件替换，禁止覆盖当前启用版本。

- [M22-05] P1 | 置信度 高 | server/src/lib/theme-package.ts:350
  - 问题:归档校验只拒绝软链接、硬链接、危险路径和脚本扩展名，未限制解压后总大小、文件数量，也未拒绝 FIFO、设备文件等特殊 tar 条目。
  - 证据:`if (type === 'l' || type === 'h')` 仅阻止两种类型；随后 401 行直接执行 `tar -xzf`，403–405 行对解压文件执行无超时的 `readFile`。
  - 影响:恶意投稿可用小体积压缩炸弹耗尽磁盘，或将 manifest/CSS 制作为 FIFO 使审核扫描请求长期挂起。
  - 修复建议:解压前校验条目类型、数量和声明尺寸，解压过程设置总量配额，并只接受普通文件与目录。

- [M22-06] P2 | 置信度 高 | server/src/db/themes.ts:199
  - 问题:启用主题的事务没有互斥锁或数据库唯一约束，并发请求可能同时留下多个 `enabled=true` 的主题。
  - 证据:每个事务先执行 `updateMany({ where: { enabled: true } })`，再分别启用目标主题；数据库仅有普通 `enabled` 索引，没有“仅一个启用主题”的唯一约束。
  - 影响:并发点击或重复请求后，活跃主题由 `enabledAt` 排序临时决定，可能出现样式漂移、回滚不完整和状态显示错误。
  - 修复建议:通过 advisory lock、串行化事务或数据库约束保证启用切换全局唯一。

- [M22-07] P2 | 置信度 高 | server/src/lib/theme-market-publisher.ts:114
  - 问题:同一主题存在多个已上架版本时，发布器会选中排序结果中的最后一个版本，而不是最新版本。
  - 证据:查询按字符串 `version: 'desc'` 排序，但 128–130 行循环执行 `entriesById.set(...)`，后续旧版本不断覆盖先前版本；版本比较本身也不是 SemVer。
  - 影响:市场可能把旧版本标记为 `latest`，导致用户安装过时或已存在安全缺陷的主题。
  - 修复建议:按合法 SemVer 比较后显式选取最高版本，并为多版本投稿增加守卫用例。

- [M22-08] P2 | 置信度 高 | server/src/routes/admin-themes.ts:138
  - 问题:上传的原始主题包和市场下载包在成功或失败后均未清理，配置图片上传失败或被替换后也会形成孤儿文件。
  - 证据:`writeUploadPackage` 在 159–161 行写入并返回归档路径；280–299 行安装流程没有 `finally` 删除。市场安装的下载路径在 248–270 行同样没有清理。
  - 影响:重复上传、失败安装或恶意操作会持续占用磁盘，最终造成主题安装或整个平台写入失败。
  - 修复建议:所有临时归档和 staging 目录使用 `finally` 清理，并为配置文件建立引用替换与定期回收机制。

- [M22-09] P2 | 置信度 中 | server/src/lib/theme-market-submission-scan.ts:71
  - 问题:扫描外部投稿时虽然调用 `assertSafeHttpUrl` 做首次 DNS 校验，但实际 `fetch` 未使用连接期重新校验 DNS 的 `safeOutboundDispatcher`。
  - 证据:72 行调用 `assertSafeHttpUrl`，77–85 行直接执行全局 `fetch(safeUrl, ...)`；`outbound-security.ts:187-191` 明确要求外呼传入 `safeOutboundDispatcher` 以阻止 DNS rebinding。
  - 影响:控制投稿域名的攻击者可能利用 DNS 重绑定让扫描器尝试访问内网或保留地址，形成服务端请求伪造与网络探测。
  - 修复建议:所有扫描下载统一使用安全 dispatcher，并保留禁止重定向、连接超时和响应大小限制。
