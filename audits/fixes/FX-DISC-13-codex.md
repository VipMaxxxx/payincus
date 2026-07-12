FX-DISC-13 指定验收已完成。

修改 [HostingView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/admin/HostingView.vue:459)：

- 保留两组移动卡 `lg:hidden`
- 两张桌面表恢复 `overflow-hidden + table-fixed`
- 移除表格的 `overflow-x-auto` 与 `min-w-[1000px]`
- owner/zones 列宽均合计 100%
- 单元格允许换行
- 所有 `@click`、排序、删除行为不变
- 未修改守卫、后端或其他文件，未 commit

验收结果：

- `test:admin-hosting-route-id-guards` ✅（含 BF-10-03）
- `test:frontend-route-guards` ✅
- `test:frontend-dist-boundary-guards` ✅
- client type-check ✅
- `git diff --check` ✅

额外尝试双端构建，但当前 Windows 脚本不兼容 POSIX 环境变量语法；改用 PowerShell 后又被沙箱禁止读取工作区上级目录，未取得 build 通过证据。工作区原有大量未提交改动，均未触碰。
