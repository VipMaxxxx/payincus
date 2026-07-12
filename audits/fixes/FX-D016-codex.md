已完成 FX-D016，未 commit/push/发版，未触碰 `instances.ts`、schema 或 package。

改动：

- [ipv6-subnets.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/ipv6-subnets.ts)
  - CIDR 规范化为网络地址及 128-bit BigInt `[start, end]`。
  - 使用 `startA <= endB && startB <= endA` 检查所有已分配子网。
  - 事务内通过 PostgreSQL advisory lock 串行执行“查重 + 插入”，避免并发双分配。
- [ip-addresses.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/ip-addresses.ts)
  - 自定义及自动分配统一强制 `/112、/120、/124`。
  - 规范化后再检查宿主网段包含关系并存储。
  - 重叠返回 HTTP 409；非法 CIDR/前缀返回 HTTP 400。
- [test-ip-address-route-guards.ts](C:/Users/Administrator/Desktop/payinces/server/scripts/test-ip-address-route-guards.ts)
  - 增加规范化、嵌套重叠、相邻不重叠、非法前缀及事务锁顺序守卫。

验证结果：

- `pnpm --filter server type-check`：通过
- `pnpm --filter server test:ip-address-route-guards`：通过
- 三个目标文件 `git diff --check`：通过

前缀集合复用了原路由已有的 `{112,120,124}`，提取为统一常量，未擅自放宽。工作区原有其他未提交改动均保持不动。
