# FX-049 规格：端口映射DB先于Incus + 销毁结算丢退款 + config计数漂移(P2 / D-126,D-128,D-129 / M05)

## 三根因(D-127 已由 FX-040 修,本修不含)
- **D-126** `routes/instances.ts:4462`:端口映射先写 DB 再调 Incus,仅靠唯一约束兜底 → 自动分配前未统一 `checkPortInUse`,可能 DB 占了 Incus 没占/冲突。
- **D-128** `routes/instance-destroy.ts:655`:销毁后结算抛错**丢退款不回滚** → 用户销毁应退的钱丢失。修:结算失败落**待补偿队列/告警**。
- **D-129** `routes/instances.ts:5301`:config 更新读**旧的** host 资源值覆写 → 计数漂移。修:用 `calculateHostResourcesFromInstances` 重算(勿绝对覆盖旧值)。

## 前置事实
FX-040 已做事务后同步失败即时补偿;FX-074 已让宿主用量原子 increment;FX-B504/041 已建实例失败补偿。本修与之协同,勿回退。

## 修法(只改 routes/instances.ts + routes/instance-destroy.ts + 守卫;不改 schema/package;不碰 proxy-sites(并行))
1. **D-126**:端口映射自动分配前统一调 `checkPortInUse`(或等价),确保 DB 与 Incus 一致占用,不只靠唯一约束兜底;冲突明确拒绝。
2. **D-128**:instance-destroy 结算(退款)若抛错,不能静默丢失——落**待补偿队列/告警**(参照既有补偿队列/DeliveryAssuranceCase/告警机制),保证退款最终一致或人工可见。
3. **D-129**:config 更新宿主用量改用 `calculateHostResourcesFromInstances` 按实例集合**重算**,或用 FX-074 的原子 increment 语义,消除"读旧值覆写"漂移。
4. 改动最小,不重构交付/销毁主链路。

## 加守卫
`test:port-mapping-safety`/`test:instance-delete-incus-order` 追加:端口自动分配前 checkPortInUse、销毁结算失败落补偿、config 用量重算不绝对覆盖。不改 package.json。

## 不许动
不碰 proxy-sites(并行)。不回退 FX-040/074/B504。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:port-mapping-safety`、`test:instance-delete-incus-order`、`test:instance-route-id-guards`、`test:instance-create-failure-compensation`、`test:host-resource-atomic-guards` 通过(确认不回退前序)。交付一段话:三点各改法、守卫结果。
