# FX-055 规格：Caddy 新增路由把 POST 失败当"不存在",PUT 覆盖全站路由致中断(P1 / D-018 / M13-05)

## 根因
`server/src/lib/caddy-client.ts:159`:新增反代路由时,把**任意 POST 失败**都当作"服务器不存在",随后用**仅含当前一条路由**的配置 `PUT` 整个 `sites` 服务器 → 短暂网络/认证错误后若 PUT 成功,会**覆盖该宿主全部反代路由,所有站点中断**。

## 修法(只改 server/src/lib/caddy-client.ts + 其守卫;不改 schema/package;不碰 resource-pool(并行))
1. 先只读:caddy-client 新增/更新路由的逻辑、Caddy admin API 的错误码语义、现有读取/写入配置的方式。
2. **仅在明确 404 时创建服务器**:POST 失败要**区分错误类型**——只有 Caddy 明确返回"服务器/路径不存在(404)"才走创建分支;网络错误、5xx、认证 401/403 等**一律不当作不存在**,应报错重试/上抛,绝不触发全量覆盖。
3. **条件写入 / 读取合并,禁止盲目全量覆盖**:
   - 需要新增路由时,先**读取现有 sites 配置**,把新路由**合并**进现有路由集合,再写回;或使用 Caddy 的**追加/条件**接口(如对具体 route 路径 POST/PATCH)而非用单条路由 PUT 覆盖整个 server。
   - 保证任何写入都不会丢失该宿主已有的其它路由。
4. 保持正常"新增单条反代路由"功能不回归。

## 加守卫
`test:proxy-site-route-id-guards` 追加:非 404 失败不触发创建/全量覆盖、写入走读取合并而非单路由全量 PUT。不改 package.json。

## 不许动
不碰 resource-pool(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:proxy-site-route-id-guards` 通过。交付一段话:如何区分 404、如何读取合并/条件写、守卫结果。
