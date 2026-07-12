# BF-8-11 规格：流量 h-码改一次性(G-C 裁决:仅当前周期,不永久增月额度)

## 裁决
流量 h-码(兑换码)**改一次性**:兑换后**只对当前流量周期加额度**,不永久提升月度基础限额。

## 现状(codex 只读确认)
流量类 h-码兑换后可能**永久增加月流量额度**(每周期都多)。应改为一次性:仅当前周期 extraTrafficQuota +量,下周期重置回原额度。

## 修法(只改 redeem-codes 兑换处 + 必要 traffic(extraTrafficQuota 应用)+ 守卫;不改 schema/package;不碰 plugins(并行))
1. 先只读:流量 h-码兑换如何加额度(加到永久 monthlyTrafficLimit?还是 extraTrafficQuota?)、FX-054-rest 的 extraTrafficQuota/extraTrafficUsed 机制、流量重置如何处理 extraTrafficQuota。
2. **改一次性**:流量 h-码兑换加到**当前周期的 extraTrafficQuota**(一次性加油包语义,FX-054-rest 已让加油包作用实例级),**不改永久 monthlyTrafficLimit**;流量重置(FX-D017/061)时 extraTrafficQuota 归零/不延续(即只当期有效)。
3. 与 FX-054-rest/D017/061 的加油包/重置口径协同,勿回退。

## 加守卫
`test:redeem-code-management-guards`/`test:traffic-reset-locks` 追加:流量 h-码只加当期额度、下周期重置不延续、不改永久限额。不改 package.json。

## 不许动
不碰 plugins(并行)。不回退 FX-054-rest/D017/061。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:redeem-code-management-guards`、`test:traffic-reset-locks`、`test:traffic-route-limit-guards`、`test:system-redeem-consistency` 通过。交付一段话:一次性怎么实现(extraTrafficQuota当期)、重置不延续、守卫结果。
