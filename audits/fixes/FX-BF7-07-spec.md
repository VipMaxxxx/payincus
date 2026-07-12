# BF-7-07 规格：普通转账过户与交易所交割换主人模型不一致(G-F 同意)

## 裁决
普通转账过户**默认关 autoRenew + 提示重置凭证**,与交易所统一。

## 现状
普通转账不重装、不重置 autoRenew、不重建计费,接收方继承发起方续费开关/计费价/磁盘既有凭证;交易所交割强制重装且 autoRenew=false。证据:db/transfers.ts:557-611。

## 修法(只改 db/transfers.ts(过户换主人处 557-611)+ 必要通知 + 守卫;不改 schema/package;不碰 mail(并行))
1. 先只读:db/transfers.ts:557-611 过户换主人逻辑、交易所交割如何置 autoRenew=false、凭证重置提示机制。
2. **过户默认关 autoRenew**:普通转账完成过户时把实例 `autoRenew=false`(与交易所统一),接收方需自行重开。
3. **提示重置凭证**:过户后给接收方站内信/通知**提示重置 SSH 密钥/密码等凭证**(沿用现有通知机制;不强制重装,只提示——除非 owner 要求重装,本条只关 autoRenew+提示)。
4. 保持转账其它逻辑(FX-067b 受让限制校验)不回归。

## 加守卫
`test:transfer-query-guards` 追加:过户置 autoRenew=false + 发凭证重置提示。不改 package.json。

## 不许动
不碰 mail(并行)。不回退 FX-067b。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:transfer-query-guards` 通过。交付一段话:autoRenew 置位点、提示怎么发、守卫结果。
