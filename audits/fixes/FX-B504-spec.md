# FX-B504 规格：静态IP分配失败仍标 running 交付(可能拿到不通网的机器)(F-A / BF-5-04)

## owner 裁决(BEHAVIOR.md F-A)
静态IP分配失败视为交付失败(退款+回收)。

## 根因
server/src/routes/instances.ts:2081-2107、2137-2162:NAT 内网IPv4 试50次失败→staticIPv4=null 仅打日志"使用动态IP",实例照常交付 running;
routed IPv6 子网耗尽→staticIPv6=null 仅告警。二者都无硬失败/退款/回收。ipv6_only 套餐拿不到 IPv6→实例完全无可用地址,但已付费标 running。

## 修法（只改 server/src/routes/instances.ts 相关 IP 分配段;复用现有创建失败补偿;不碰 package.json)
1. 先只读:NAT 内网IPv4(2081-2107)、routed IPv6(2137-2162)分配失败现状;以及创建失败时现成的补偿路径(compensateFailedInstancePurchase / 回滚资源+退款+释放 IP+置 error 的逻辑,如 6882 附近 catch)。
2. 静态IP分配失败按**网络模式**判定是否致命:
   - 需要该地址才能通网的模式(NAT 需内网IPv4 做端口转发目标;ipv6_only/需 routed IPv6 的模式需 IPv6)→ 分配失败视为**交付失败**:走现成补偿(置 error + 回滚宿主机资源 + 释放已占 IP/端口 + 退款),返回明确失败,而非静默降级仍标 running。
   - 确实允许动态IP的模式(若存在)→ 保持现状。
3. 复用现成补偿函数,不重造;确保回滚/退款与创建失败路径口径一致。

## 加守卫
在现有 server/scripts/test-instance-create-failure-compensation.ts 追加断言:静态IP分配失败(致命模式)走补偿+退款,不静默交付 running。不改 package.json。

## 不许动
- 不改付费扣款/主机预留;不改其它创建步骤。不做大重构。不碰 instance-traffic-collector(并行)。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:instance-create-failure-compensation、test:instance-route-id-guards 通过。

## 交付
一段话:哪些模式视为致命、复用了哪个补偿、守卫结果。不要 commit。
