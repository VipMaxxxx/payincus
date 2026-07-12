已完成 GiftCardsView 锁定表恢复，未 commit。

改动：

- [GiftCardsView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/GiftCardsView.vue:328)
  - `overflow-x-auto` → `overflow-hidden`
  - 移除 `min-w-[720px]`
  - 恢复 `w-full table-fixed text-sm`
- 管理页及三语 i18n key 已满足守卫，无需修改。
- 功能、事件与业务逻辑未变。

验证全部通过：

- `test:gift-card-guards`
- `test:frontend-route-guards`
- `test:frontend-dist-boundary-guards`
- `test:frontend-i18n-keys`
- client type-check
- user/admin 双端生产构建
- `git diff --check`

备注：仓库原始构建脚本的 POSIX 环境变量写法不兼容 PowerShell，已用等价环境变量及 Vite runner 模式完成双端构建。工作区其他既有改动均未触碰。
