# FX-032 规格：repay 重新支付不作废旧单致重复扣款(D3 / BF-2-05)

## owner 裁决(BEHAVIOR.md D3)
同订单仅一个有效支付单 / 作废旧单。

## 根因
recharge.ts:1604-1784 repay 对仍 pending 的订单**重新生成支付链接,但不作废旧链接/旧网关单**;
入账 completeRecharge 幂等只入一次。→ 用户若先后用两个链接各付一次,网关收两笔、平台只入账一次 → 重复扣款、单次到账。

## 修法（改 server/src/routes/recharge.ts repay 与回调匹配;不碰 package.json)
先只读通读 repay 逻辑、订单 paymentDetails 里存了哪些支付会话/tradeNo/session 标识、回调如何匹配订单。做**代码内可达的作废**(网关侧真正 cancel 需各网关 API,属后续,本条尽力做到"旧单失效不再被入账"):
1. **标记当前有效支付尝试**:repay 生成新支付链接/会话时,在订单 paymentDetails 记录一个"当前有效支付尝试标识"(如自增 attempt 序号 或 当前 tradeNo/session id),并把旧的标记为 superseded。
2. **回调/验单只认当前有效尝试**:completeRecharge / 回调处理在匹配订单后,额外校验回调携带的支付尝试标识 == 订单当前有效尝试;若是**已被 supersede 的旧尝试**回调 → 不入账(记日志/告警,或按"该支付单已失效"处理),避免旧链接的迟到回调造成误入账。
   注:completeRecharge 本就按订单幂等(只入一次),本条额外确保"入账的是最新尝试对应的支付",且为后续网关真 cancel 打基础。
3. 前端提示"重新支付后旧链接失效"(若 repay 返回体有相应字段,补一个标志;不改前端)。

## 局限(交付里写明,记为后续)
真正阻止用户在网关侧对旧链接重复付款,需调各网关(heleket/antom/易支付)的订单取消 API——属网关集成,本条不实现,记为 **FX-DISC(网关侧 cancel 集成)**。本条只做"平台侧旧尝试不再被入账 + 有效尝试单一化"。

## 加守卫
在现有 server/scripts/test-recharge-state-transitions.ts 或 recharge 相关守卫追加断言:repay 记录当前有效支付尝试、回调只认最新尝试。不改 package.json。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:recharge-state-transitions、test:recharge-accounting-guards 通过。

## 交付
一段话:有效尝试标识如何记、旧尝试回调如何拒、网关侧 cancel 的后续项、守卫结果。不要 commit。
