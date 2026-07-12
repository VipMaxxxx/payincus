已完成 VIP 持续权益实现，未 commit/push/发版，未改 schema/迁移，也未改实例幂等抢占逻辑。

- `vip_benefits_config` 支持管理端可视化配置及后端 0~100 范围强校验。默认 V1~V5：折扣 1/2/3/4/5%，额外流量与资源池加成 2/4/6/8/10%；V6+ 保守沿用 V5，owner 可在管理端调整 V1~V5。
- 新购、续费预览、手动续费、自动续费统一走后端价格仲裁：VIP 与 AFF/优惠码取单一最低价，不叠加；秒杀固定使用秒杀价，不再叠加 VIP。
- 额外流量按当前 VIP 动态加入实例有效限额，不持久化权益额度，降级后自动失效。
- 资源池加成表现为提升池余额购买力；完整申领量仍进入 FX-072 主机容量原子校验，不会突破主机上限。
- 管理端 UI 与中/英/繁 i18n 已加入。

主要改动集中在 [vip-benefits.ts](C:/Users/Administrator/Desktop/payinces/server/src/services/vip-benefits.ts)、[system-config.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/system-config.ts)、[billing-operations.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/billing-operations.ts)、[SystemConfigView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/admin/SystemConfigView.vue)，以及实例定价、流量、资源池生效点和对应守卫。

验证结果：

- server/client type-check：通过
- 指定 7 个守卫：全部通过
- frontend route、dist boundary 守卫：通过
- VIP 仲裁/流量/资源池行为冒烟：通过
- user/admin 双端 Vite 构建：通过
- `git diff --check`：通过

本次只做了本地验证，未连接生产或执行线上真实扣款/申领流程。
