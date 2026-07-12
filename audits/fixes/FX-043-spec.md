# FX-043 规格：托管/代开通不建 IP 记录/不发通知邮件/不发插件事件/不标秒杀(F-A BF-5-05)

## owner 裁决
BF-5-05(全同意):托管代开通**补齐通知/邮件/IP记录/插件事件**(与自营一致)。

## 现状
`provisionManagedInstanceAsync` 交付成功**不建 ip_addresses、不发创建站内信/邮件、不发 service.provisioned 插件事件、不标记秒杀**;自营(instances.ts:6759-6879)全做。证据:managed-instance-provision.ts:139-158 vs instances.ts:6759-6879。

## 修法(只改 services/managed-instance-provision.ts(+必要复用 instances 的交付后置 helper)+ 守卫;不改 schema/package;不碰 traffic/caddy(并行 FX-058))
1. 先只读:自营 instances.ts:6759-6879 交付成功后做的四件事(建 ip_addresses、发站内信/邮件、发 service.provisioned、标记秒杀)如何实现;managed-instance-provision.ts:139-158 现状缺哪些。
2. **补齐与自营一致**:managed 代开通交付成功后:
   - 建 `ip_addresses` 记录(与自营同口径);
   - 给**目标用户**发创建站内信 + 邮件;
   - 发 `service.provisioned` 插件事件;
   - 若来自秒杀则标记秒杀(soldCount 等,与 FX-041 语义一致,勿双计)。
   - **优先复用**自营已有的交付后置函数/helper,避免复制粘贴分叉;若自营是内联代码,抽取共享 helper 供两者调用(改动最小)。
3. 保持 managed 代开通既有成功/失败路径不回归;与 FX-040/044/049 补偿协同。

## 加守卫
`test:delivery-center-guards` 或托管交付相关守卫追加:managed 代开通补齐 ip/通知/邮件/插件事件/秒杀标记。不改 package.json。

## 不许动
不碰 traffic/caddy(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:delivery-center-guards`、`test:instance-create-failure-compensation` 通过。交付一段话:补齐了哪四项、是否抽了共享 helper、秒杀不双计、守卫结果。
