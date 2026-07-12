已完成 BF-12-01/02：插件审核置 `listed` 时会拒绝非 `free` 定价并返回“付费上架暂未开放(交易闭环未上线)”；主题保持无定价模型，但投稿显式携带非免费 pricing 时直接拒绝。插件发布器仅合并 free 且 `passed/warning` 的投稿，并清除旧索引中的非 free 条目；主题发布器也会排除旧索引中带非 free 定价的条目。改动仅涉及 4 个市场代码文件和 2 个守卫文件，未改 schema/package，未碰 flash-sales/tickets，未 commit。

验证全部通过：

- `pnpm --filter server type-check`
- `test:plugin-market-governance-guards`
- `test:plugin-market-publish-guards`
- `test:plugin-market-guards`
- `test:plugin-center-guards`
- `test:theme-system-guards`
- 定向 `git diff --check` 通过。
