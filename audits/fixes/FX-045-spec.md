# FX-045 规格：实例创建失败原因不落库、详情页不展示(BF-5-07)

## owner 裁决
把创建失败原因**落库**并在**详情页展示**。

## 现状
实例 error 前端只显红字;失败原因仅走站内信/邮件,**实例表未存 errorMessage**。证据:InstancesView.vue:859-860、InstanceDetailView.vue:488-491。

## 前置事实(重要,查证)
`Instance` 模型**是否已有 errorMessage/failReason 字段**?**优先复用现有字段**;若无且需持久化,**不擅自加 schema**——若确需新字段,报告标注待 owner(类似 FX-046),代码侧先把"详情页展示已有失败信息(如从 DeliveryAssuranceCase/日志取)"做掉。FX-044 已把初始失败原因写入 DeliveryAssuranceCase,可作为详情页失败原因来源之一。

## 修法(只改 routes/instances.ts + client InstanceDetailView.vue(+i18n)+ 守卫;不碰 traffic(并行 FX-061);不改 schema——除非报告标注待 owner)
1. 先只读:Instance 模型字段(有无 errorMessage)、失败原因当前写哪(站内信/邮件/DeliveryAssuranceCase)、InstanceDetailView 现有 error 展示。
2. **落库**:实例创建/交付失败时把**脱敏失败原因**写入实例的现有字段(若有 errorMessage/statusMessage 之类)或复用 FX-044 的 DeliveryAssuranceCase;不新增 schema。
3. **详情页展示**:InstanceDetailView 失败态展示具体失败原因(从落库字段/DeliveryAssuranceCase 取),补 i18n key(en/zh/zh-TW 齐全,过 frontend-i18n-keys)。**不改任何锁定表格布局**(详情页非锁定表)。

## 加守卫
`test:frontend-route-guards`/`test:frontend-i18n-keys` 相关断言随改动通过(不弱化)。不改 package.json。

## 不许动
不碰 traffic(并行 FX-061)。不改锁定表格布局。不改 schema(除非报告标注待 owner)。不 commit。

## 验收
双端 build 或 client type-check 通过;`test:frontend-route-guards`、`test:frontend-i18n-keys`、`test:instance-route-id-guards` 通过。交付一段话:失败原因存哪(现有字段/DeliveryAssuranceCase/是否需 schema)、详情页展示点、i18n key、守卫结果。
