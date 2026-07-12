# FX-007 规格：任意管理员写高危白名单自提权 OTA 超管(P1 / D-007 / M10-01)

## 根因
PUT /api/admin/system-config(server/src/routes/system-config.ts:291)仅 authenticateAdmin。
validKeys 含 4 个高危能力白名单键:system_update_allowed_admin_ids、payincus_gift_card_admin_ids、
plugin_manager_allowed_admin_ids、theme_manager_allowed_admin_ids。写这些键(第527-535行)无任何超管校验 →
任意 role=admin 用户可把自己 UID 写进 system_update_allowed_admin_ids,通过 OTA 权限门(canManageSystemUpdates:
allowedIds.size>0 时 allowedIds.has(user.id))自提权为 OTA 超管,发起 /start /rollback;反之只写自己 UID 还能把
仅靠 username==='admin' 兜底的 owner 反锁出 OTA。

## 修法（只改 server/src/routes/system-config.ts + 加断言到现有守卫,勿动 package.json）
1. 先 grep 确认"超管/owner"的既有判定口径:看 canManageSystemUpdates / OTA 门禁(server/src/app.ts 或 system-update.ts)如何判定——预计是 request.user.username === 'admin'(内建 owner,不可经本 API 篡改)。若仓库已有 isOwner/isSuperAdmin 之类 helper 就复用;没有就用 username === 'admin' 作为超管锚点(必要时叠加 ENV owner,如已有)。
2. 在 PUT / 处理器写库前,定义高危键集合 HIGH_RISK_ADMIN_ID_KEYS = 上述 4 个键。若本次 body 含其中任一键,且请求者**不是超管**(按步1口径),立即 return reply.code(403).send(apiError(合适的权限码,如 ErrorCode.PERMISSION_DENIED / FORBIDDEN)),**整批拒绝、不写任何配置**。
3. 普通管理员仍可改其它非高危键(不受影响)。保留 normalizeAdminIdCsv 校验不变。
4. 确认 request.user 上有 username 字段可用(authenticateAdmin 注入);若类型上没有,按既有取用户信息的方式获取。

## 加守卫
在现有 server/scripts/test-system-config-value-guards.ts 追加断言:PUT 处理器源码包含 4 个高危键集合 + 写这些键前的超管校验(如 username === 'admin' 判定 + 403 拒绝)。不改 package.json。

## 不许动
- 不改 OTA 门禁逻辑本身、不改其它路由。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:system-config-value-guards 通过;pnpm --filter server test:system-update-guards 通过。

## 交付
一段话:超管口径来源(复用了哪个 helper/字段)、拒绝逻辑、守卫结果。不要 commit。
