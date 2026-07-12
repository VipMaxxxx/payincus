已按 FX-065 打回规格修正：

- `traffic.ts` 恢复分存储扣费：`priceCents / 100` 后按元扣余额。
- schema 两处注释改为“存储单位：分，表单按元输入，提交前 ×100”。
- 撤销“禁止分转换”的危险守卫断言。
- 两处管理端提示改为“单位:元(如填 5 表示 5 元)”。
- 未触碰已有 locales 改动，未 commit。

验收全部通过：

- server/client type-check
- `test:traffic-reset-locks`
- `test:system-config-value-guards`
- `test:frontend-route-guards`
- `test:frontend-dist-boundary-guards`
- user/admin 生产构建
- server build

备注：根 `pnpm build` 因 Windows 不支持脚本中的 POSIX 环境变量写法而未直接运行；已用等价 PowerShell 环境变量分别完成 user/admin 构建。
