# M03 审计报告

## 结论摘要
支付充值模块整体防护扎实：入账金额一律取服务端计算值而非网关上报值、`completeRecharge` 用 advisory lock + 条件 updateMany + paymentCallback 唯一索引三重保证幂等与防重放、Antom/Heleket/易支付 V2 均有签名校验、外呼有 SSRF 校验与连接期防 rebinding、密钥有 AES-GCM 加密与响应脱敏。**未发现 P0/P1 级的真金白银漏洞。** 发现集中在若干处校验被弱化、非常量时间比较、以及默认放开的纵深防御项，均为 P2/P3。

## 发现清单

- [M03-01] P2 | 置信度 中 | server/src/routes/recharge.ts:2196
  - 问题：易支付 verify 主动验单路径的金额一致性校验被 `paidAmount > 0` 短路。网关返回 money 为空/"0"(parseFloat 得 0)时直接跳过与订单金额比对即放行完成充值。
  - 证据：`const paidAmount = queryResult.money ? parseFloat(queryResult.money) : 0` 后 `if (paidAmount > 0 && Math.abs(paidAmount-orderAmount) > TOLERANCE) {拒绝}`。对照异步回调路径对 actualAmount<=0 是硬拒绝,verify 路径更松。
  - 影响：削弱金额一致性验证；因入账仍取服务端 creditedAmount 且要求 paid=true,实际资损面很窄,但违反"金额必须逐笔核对"不变量。
  - 修复建议：verify 路径金额校验改为与回调一致的硬校验(money 缺失或<=0 即拒绝,不短路)。

- [M03-02] P2 | 置信度 中 | server/src/routes/recharge.ts:1216-1243
  - 问题：verifyCallbackSignature 的通用/wechat_direct 分支手写 MD5 拼接签名且用 === /.toLowerCase() 直接比较(非常量时间),alipay_direct/stripe 直接返回 false。
  - 影响：当前白名单只放行 yipay/heleket/antom/plugin_gateway/manual,验签前已拒绝上述类型,为"死代码/潜伏风险";一旦有人把新类型加入白名单就会启用弱验签。
  - 修复建议：删除未实现且非常量时间的兜底验签分支,或改为显式抛错。

- [M03-03] P3 | 置信度 中 | server/src/lib/epay.ts:123, 137
  - 问题：易支付 V1(MD5)验签用普通字符串比较,非常量时间。对照 Heleket 用了 crypto.timingSafeEqual。
  - 影响：理论计时侧信道,实际对 MD5 伪造帮助有限,有 DB 防重放兜底。
  - 修复建议：改用等长后 crypto.timingSafeEqual。

- [M03-04] P3 | 置信度 中 | server/src/routes/recharge.ts:341-369
  - 问题：回调 IP 白名单对 yipay、antom 默认为空即"全部放行"(isIpInWhitelist 中 length===0 return true),仅 heleket 有硬编码默认 IP;PAYMENT_CALLBACK_IP_WHITELIST 一旦配置会对所有渠道套用同一份列表。
  - 影响：纵深防御项缺失(真正防护靠签名),统一列表会误伤多渠道并存场景。
  - 修复建议：为每渠道提供独立可配置官方回调 IP 段,默认不因空列表放行。

- [M03-05] P3 | 置信度 低 | server/src/routes/recharge.ts:3021-3046
  - 问题：管理员手动完成充值时 actualAmount 仅校验 >0,无上限、不与订单 amount/payableAmount 比对,直接作为入账金额。
  - 影响：可凭手动完成给用户入账任意金额;是管理员权限且有审计,等价于既有调账能力,非越权,但缺护栏。
  - 修复建议：对手动入账金额设上限并默认取订单应入账金额,偏离时二次确认。

- [M03-06] P3 | 置信度 低 | server/src/lib/security.ts:1083-1087
  - 问题：decryptSensitiveData 解密失败时静默返回原密文(console.warn),支付渠道配置(含密钥)走此路径解密。
  - 影响：ENCRYPTION_KEY 变更或数据损坏时配置被当明文/垃圾解析导致渠道校验被静默忽略(可用性风险);返回密文本身不直接泄密,但错误被吞。
  - 修复建议：解密失败区分"合法明文旧数据"与"真实失败",后者显式报错并告警。
