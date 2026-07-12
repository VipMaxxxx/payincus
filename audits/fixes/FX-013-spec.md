# FX-013 规格：禁用优惠码仍照发续费佣金/仍可用(E5③ / BF-3-05 / M15-01)

## owner 裁决(BEHAVIOR.md E5③)
禁用码应停止续费佣金(并停止折扣)。

## 根因
实例优惠码校验 validateAffCode(server/src/db/aff.ts:443-468)不检查 enabled;续费扣费 performRenewal 的 AFF 佣金路径也不检查;
而邮箱码校验已含 `if (!affCode.enabled) ...`(db/aff.ts:1101-1104)。故禁用码在实例新购/续费仍给折扣+返利,口径不一致。
注:当前无入口把 enabled 置 false(那是 Q-C2 的禁用能力,另立项);本条只做**强制 enabled 检查**,让"一旦禁用即全链失效"成立(现有数据 enabled 均为 true,本改动对现网行为无影响、纯纵深与前置)。

## 修法（改 server/src/db/aff.ts + 续费佣金路径;不碰 package.json)
1. 在 validateAffCode(实例新购校验,443-468)中,与邮箱校验一致地加 `if (!affCode.enabled) return { valid:false, ... }`(用该函数现有的返回失败结构)。
2. 在续费的 AFF 佣金/折扣路径(performRenewal 相关,预计在 server/src/db/billing-operations.ts 里取 affCode/算 processAffCommission 处;先 grep 定位)加同样的 enabled 检查:禁用码 → 续费不打折、不发佣金(跳过 commission)。
3. 保持邮箱码已有的 enabled 检查不变;保证四处口径(实例新购/实例续费/邮箱新购/邮箱续费)对 enabled 一致。

## 加守卫
在现有 server/scripts/test-aff-review-ui-guards.ts 或最贴近 aff 的守卫追加断言:validateAffCode 与续费佣金路径均检查 affCode.enabled。不改 package.json。

## 不许动
- 不加"禁用入口"(属 Q-C2 另立项);不改返利比例/折扣数值。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:aff-review-ui-guards、test:aff-points-query-guards 通过;test:invite-generation-accounting-guards 通过。

## 交付
一段话:在哪几处加了 enabled 检查、四处口径是否一致、守卫结果。不要 commit。
