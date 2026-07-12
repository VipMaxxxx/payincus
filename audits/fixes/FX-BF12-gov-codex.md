已按规格完成：插件与主题公开索引改为从 DB 当前 `free + listed + passed/warning` 状态完全重建，实现真实下架；每个 ID 通过完整 SemVer 比较仅发布最高有效版本，确保 `10.0.0 > 2.0.0`；插件置为 `listed` 前强制最近扫描为 `passed/warning`。已补齐三组治理守卫并同步主题守卫。

验收全部通过：server type-check、`test:plugin-market-publish-guards`、`test:plugin-market-submission-guards`、`test:plugin-market-governance-guards`、`test:plugin-market-guards`、`test:theme-system-guards`。`git diff --check` 通过。未触碰 hosting，未改 schema/package，未 commit/push/发版。
