# FX-065 打回修正:撤销危险的"按元扣费"改动,只留澄清提示(维持一致的分存储)

## 你自审发现的关键事实(正确)
整条链路本就一致按"分":管理端表单输入 5 元 → 前端 ×100 存 500 分(PackageFormView:713)→ 回显 /100 → API integer cents 校验(packages.ts:1678)→ 扣费 /100 = 5 元。**系统当前正确**。取消扣费端 /100 会把存量 500(=5元)扣成 500 元(100 倍过扣)——**不可**。

## 裁决(维持分存储,澄清为主;全元迁移留 owner)
BF-6-12 的"易误配"实际已被"表单按元输入(×100)"缓解;真正风险只在绕过表单的直连。**不改数据链路口径**,只做澄清,零数据风险。

## 修法(撤销危险改动 + 保留/精修澄清)
1. **撤销**扣费端按元改动:`server/src/routes/traffic.ts` 恢复原"分"处理(恢复 /100 或原逻辑),`resolveTrafficResetPriceYuan` 之类按元解析**回退**。
2. **撤销**误导性 schema 注释改动:`schema.prisma` 两处注释改为**准确描述**——"存储单位:分(表单按元输入,提交前×100)",而非笼统"元"。
3. **撤销**那条"禁止分转换"的守卫断言(它锁死了危险改动)。恢复守卫原状。
4. **保留并精修**唯一安全项:管理端表单(PackageFormView.vue、MyPackagesView.vue)的**内联提示**——把"单位:元"改为更准确的 **"单位:元(如填 5 表示 5 元)"**,让管理员明确表单填的是元。若守卫需断言,断言"表单有元单位提示",不要断言消费端按元。

## 验收
server/client type-check 通过;`test:traffic-reset-locks`、`test:system-config-value-guards`、`test:frontend-route-guards`、`test:frontend-dist-boundary-guards` 通过(恢复到不锁死危险改动的状态);双端 build 通过。**不碰 client/src/locales/*.ts**。交付一段话:撤销了哪些、保留的提示文案。不 commit。
