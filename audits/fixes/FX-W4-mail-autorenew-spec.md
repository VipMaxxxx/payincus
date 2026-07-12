# 波4:邮箱自动续费(F-C BF-9-03,全同意 + D5 自动续费也限每次1月)

## 裁决
邮箱**正式支持自动续费**(现 autoRenew 是死开关:字段存/返回、有临期查询,但无设置入口、无自动扣款执行器)。D5:自动续费也**限每次1月**。

## 现状
`schema.prisma:4897` autoRenew 字段已存;有临期查询函数;但无 set 入口、无执行器。证据:schema.prisma:4897、mail.ts:970、db/mail.ts:741-754。

## 前置事实
波4-② 已实现续费复活逻辑(periodStart=max(旧到期,now)、resume 上游);BF-9-05/FX-018 已限年付12月整数倍。本执行器**复用续费逻辑**,勿另造。

## 修法(只改 routes/mail.ts(set 入口)+ 新增 services/mail-autorenew-scheduler.ts + db/mail.ts(临期查询/续费复用)+ app.ts 注册 + 客户端 autoRenew 开关 UI + 守卫;不改 schema(字段已存)/不迁移;不碰 aff(并行))
1. **set 入口**:用户可设置订阅 autoRenew on/off(routes/mail.ts + 客户端 MailView 开关,i18n)。
2. **自动扣款执行器**(新 scheduler,低频如每日):扫描 autoRenew=true 且**临期(如到期前N天)**的活跃订阅,**从用户余额扣费自动续费**:
   - 复用波4-② 的续费逻辑(1 个月,D5 每次1月;年付按 FX-018 规则——若原是年付则按其周期,但 D5"每次1月"针对自动续费统一按1月);
   - 余额不足 → 不续费,发通知提醒手动续费(不透支);
   - 幂等:同订阅同周期不重复扣;失败容错记录。
3. 调度器启动幂等+防重入,app.ts 注册(参考 BF-9-12 mail-usage-scheduler)。与波4-②/BF-9-04 协同。

## 加守卫
`test:mail-subscription-cancel-guards`/`test:mail-renewal-month-guards`/`test:scheduler-startup-idempotency` 追加:autoRenew set 入口、自动续费执行器每次1月、余额不足提醒不透支、幂等。不改 package.json。

## 不许动
不碰 aff(并行)。不改 schema/不迁移。不回退波4-②/BF-9-04/FX-018。不 commit。

## 验收
type-check/client type-check 通过;`test:mail-subscription-cancel-guards`、`test:mail-renewal-month-guards`、`test:scheduler-startup-idempotency`、`test:mail-plan-financial-guards`、`test:frontend-i18n-keys` 通过。交付一段话:set 入口、执行器扣费/每次1月/余额不足处理/幂等、守卫结果。
