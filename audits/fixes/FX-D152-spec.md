# D-152 规格：i18n 硬编码中文/缺 key 横切(前端多页+后端文案)

## 裁决
抽取 i18n key 补齐 en/zh-TW,后端改错误码,扩展守卫递归比对词典与实际使用 key。

## 现状
多页硬编码中文/缺 en/zh-TW:M02-04(后端硬编码文案)、M02-05(UserLifecycleView)、M11-07(PortalView)、M12-07(FlashSalesView)、M13-11(HostPublicIpv4Tab)、M14-07(TerminalView)、M15-08(InvitesView)、M18-07(TelegramConfigView)、M26-07(三语词典不完整+强制回退简中)。

## 修法(改上述前端视图 + client/src/locales/{en,zh-CN,zh-TW}.ts + 必要后端错误码 + 守卫;不改 schema/package;不碰已完成的并行——现无并行)
1. 先只读 `test:frontend-i18n-keys` 现有校验、各视图硬编码中文、locale 词典结构。
2. **前端**:把上述视图硬编码中文抽成 `t('...')` key,补齐 en/zh-CN/zh-TW 三语(语义一致);去掉强制回退简中(让缺 key 显 key 或走 i18n fallback,由守卫兜底不缺 key)。
3. **后端**:M02-04 硬编码用户可见文案改**错误码 + i18n**(前端按错误码显文案)或结构化;不破坏 apiError(FX-006)脱敏。
4. **守卫**:确保 `test:frontend-i18n-keys` 递归比对三语词典与实际 use 的 key 完整(补齐后应全绿)。
5. 只动文案层,**功能 100% 不变**;不碰锁定表格布局。

## 不许动
不改 schema/package/业务逻辑/锁定表格。不 commit。

## 验收
client type-check 通过;`test:frontend-i18n-keys`、`test:frontend-route-guards`、`test:frontend-dist-boundary-guards`、`test:log-localization-guards` 通过;双端 build。交付一段话:抽了哪些页/多少 key、后端错误码、守卫结果。
