# 波4:插件/主题交易闭环核心(BF-12 完整版,owner"全部做了"授权,加 schema)

## 授权 + 我定的默认决策(owner 后续可调)
owner"全部做了" → 实现购买/授权/退款/分成/结算**核心闭环 + schema**(只本地迁移,不碰生产/不 commit)。设计见 `audits/design/W4-plugin-trade-design.md`。owner 未定产品规则 → 我按保守默认实现并写进交付:
- **抽成**:固定 **20% 平台抽成**(与 BF-12-gov3 一致),币种 CNY/USD 白名单,最小单位整数分。
- **授权模型**:**一次性买断永久**(不订阅);同 ID 升级需重新购买(简单起步)。
- **退款政策**:**7 天内可退**,退款**吊销授权 + 冲回开发者收入**(复用 FX-012 冲回思路)。
- **结算**:开发者收入按 purchase 实时累计到 `PluginDeveloperEarning`;提现复用 **Hosting 出金人工审核(BF-10-03)模式**(pending→approve/reject)。

## 修法(可改 schema.prisma+建迁移(只本地)+ 新增 routes/db 购买/授权/退款/收入 + 复用支付/审计/安全外呼 + 守卫;不碰 traffic/tickets/deploy/instances 幂等段(并行);paid 上架仍由 BF-12-01/02 门禁——闭环就位但**本期仍默认禁 paid 上架**,除非 owner 放开)
1. **schema**(新表,prisma migrate dev 只本地):`PluginPurchase`/`PluginLicense`/`PluginRefund`/`PluginDeveloperEarning` + 提现复用/扩展现有 Withdrawal 或新 `PluginDeveloperWithdrawal`(优先复用)。
2. **购买**:`POST 购买`——校验 pricing 完整(BF-12-09)、扣款(复用充值/余额)、建 PluginPurchase + PluginLicense(永久)+ PluginDeveloperEarning(gross/20%fee/net)、审计;幂等(同用户同插件已授权则拒重复购买)。
3. **授权校验**:插件运行时/安装校验 PluginLicense(接入 `isPluginEnabled`/capability 门禁);未授权 paid 插件不可安装/启用。
4. **退款**:7 天内 `POST 退款`——吊销 License + 冲回 Earning + 退款到余额,条件/幂等,审计。
5. **开发者收入/提现**:收入台账;提现走人工审核(复用 BF-10-03 模式)。
6. **安全**:金额一致性(gross=net+fee)、并发用条件更新/advisory lock、外呼安全、脱敏审计。

## 加守卫
`test:plugin-market-guards`/`test:plugin-market-governance-guards`/新增 `test:plugin-trade-guards`(若需在 package.json 加脚本——**本任务破例允许在 package.json 的 test 脚本区加该守卫条目**)或复用现有插件守卫追加:购买建授权+收入、退款吊销+冲回、抽成一致、授权校验、幂等。
> 注:若必须加 package.json test 脚本条目以注册新守卫,可加(仅此项),不改其它 package 字段。

## 不许动
不碰 traffic/tickets/deploy/instances 幂等抢占段(并行)。不 commit/push/发版。不碰生产库(迁移只本地)。paid 上架门禁(BF-12-01/02)保留,除非另有说明。

## 验收
server/client type-check 通过;`test:plugin-market-guards`、`test:plugin-market-governance-guards`、`test:plugin-center-guards` + 新增交易守卫通过;prisma generate 成功、迁移文件已建;双端 build。交付一段话:表结构、购买/授权/退款/收入/提现流、抽成一致性、幂等、我定的默认规则、迁移文件名、守卫结果。⚠️ 生产迁移待 owner。
