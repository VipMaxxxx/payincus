已完成，仅修改 [OAuthConfigView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/admin/OAuthConfigView.vue:581)，未改守卫、后端或 `@click`，未 commit。

改动：

- 保留两组移动卡 `lg:hidden`
- 两张桌面表恢复 `overflow-hidden + table-fixed`
- 删除 `overflow-x-auto`、`min-w-[...]`
- 两表列宽分别合计 100%
- Client ID、URI、邮箱允许换行

验证全部通过：

- `test:oauth-provider-guards`
- `test:frontend-route-guards`
- `test:frontend-dist-boundary-guards`
- `client type-check`
- user/admin 双端生产构建
- `git diff --check`

构建时因 Windows/POSIX 脚本兼容性，使用等价的 PowerShell 环境变量及 Vite `--configLoader runner` 完成。未做浏览器真机交互验证。
