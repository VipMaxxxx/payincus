# 波4:VIP 实打实持续权益(A2,owner"全部做了"授权,config 驱动+我定合理默认)

## 裁决 + 我的默认决策(owner 后续可调)
A2:VIP 要带实打实持续权益(现纯荣誉)。owner 未定权益类型 → 我按**保守合理默认**实现,写进交付,owner 可改配置:
- **权益类型**:①下单/续费**折扣%** ②**额外流量%**(实例级 extraTrafficQuota 加成) ③**资源池加成%**。
- **默认数值**(config,可改):V1~V5 折扣 1/2/3/4/5%,额外流量 2/4/6/8/10%,资源池加成 2/4/6/8/10%。
- **叠加规则(关键决策,取保守)**:VIP 折扣与 AFF 码/秒杀价/优惠码**不叠加,取对用户更优惠的单一折扣**(避免过度打折漏钱)。秒杀价(FX-080)本身是特价,VIP 折扣**不再叠加**到秒杀价。

## 修法(可改 routes/system-config.ts(vip_benefits_config JSON)+ services/vip-benefits.ts + 下单/续费定价单点 + 流量/资源池生效点 + 管理端配置UI + 守卫;不改 schema(用户 VIP 等级已存)/不迁移;不碰 instances 创建幂等段(FX-046 已改,读为主)/tickets/plugin/deploy(并行))
1. **config**:`vip_benefits_config` JSON(per-level 折扣/流量/池加成),管理端可视化编辑+范围校验(0~上限),i18n。
2. **折扣单点仲裁**:下单/续费定价处,VIP 折扣与其它折扣**取更优惠者**(min 最终价),**后端强制**(不信前端);秒杀价不叠加 VIP。经守卫钉死叠加规则。
3. **额外流量**:VIP 等级给实例级 extraTrafficQuota 加成(复用 FX-054-rest 机制,按等级持续,重置口径与 FX-061 一致)。
4. **资源池加成**:申领上限按 VIP 等级提高(复用 FX-072 容量校验,仍不超主机上限)。
5. **实时生效/失效**:降级即失效;权益不可为负/不 >100%。

## 加守卫
`test:vip-benefit-route-guards`/`test:system-config-value-guards`/`test:billing-query-guards` 追加:VIP 折扣后端生效+取优不叠加+秒杀不叠加、额外流量/池加成生效、范围校验。不改 package.json。

## 不许动
不碰 tickets/plugin/deploy(并行)。不动 instances 创建幂等抢占段(读 VIP 可以)。不改 schema/不迁移。不改锁定表格。不 commit。

## 验收
server/client type-check 通过;`test:vip-benefit-route-guards`、`test:system-config-value-guards`、`test:billing-query-guards`、`test:traffic-route-limit-guards`、`test:resource-pool-apply-consistency`、`test:frontend-i18n-keys` 通过;双端 build。交付一段话:权益类型/默认值/叠加规则(取优不叠加)、各生效点、守卫结果。
