# FX-065 完整实现:trafficResetPrice 全"元"存储(带数据迁移)

## 授权变更
owner 指令"全部做了" → **允许全链改"元"+数据迁移(只本地 dev 库,不碰生产、不 commit)**;owner 已裁决 BF-6-12"以元存储"。

## 现状(已确认)
整条链路一致按"分":表单填 5 元→前端×100 存 500(分)→API integer cents→扣费 /100=5 元。字段 `traffic_reset_price Decimal(10,2)`。

## 目标口径
统一以"元"存储(Decimal(10,2) 天然是元 X.XX),去掉前端 ×100 / 后端 /100 的分处理,存量数据 ÷100 迁移。

## 修法(改 schema 注释 + 建数据迁移 + PackageFormView/MyPackagesView(去×100) + packages.ts(API 改按元校验 Decimal) + traffic 扣费(去/100) + 守卫)
1. **schema**:`traffic_reset_price` 注释改"(元)";字段类型 Decimal(10,2) 不变。
2. **数据迁移**(migration SQL,只本地执行):`UPDATE package_plans SET traffic_reset_price = traffic_reset_price / 100 WHERE traffic_reset_price IS NOT NULL`(及套餐覆盖表同处理);把存量"分"值换算成"元"。`prisma migrate dev --name traffic_reset_price_to_yuan`。
3. **前端**:PackageFormView/MyPackagesView 去掉提交 ×100 与回显 /100(直接按元);提示"单位:元(如填5表示5元)"保留。
4. **API**:packages.ts 校验从 integer cents 改为**元 Decimal(≥0,两位小数)**。
5. **扣费**:traffic 重置扣费去掉 /100,直接按元扣余额(与其它金额口径一致)。
6. 全链一致按元,无分/元混用。

## 加守卫
`test:traffic-reset-locks`/`test:system-config-value-guards`/`test:frontend-route-guards` 追加:全链按元、无 ×100//100、扣费按元。

## 不许动
不 commit/push/发版。不碰生产库(迁移只本地)。

## 验收
server/client type-check 通过;`test:traffic-reset-locks`、`test:system-config-value-guards`、`test:frontend-route-guards`、`test:frontend-dist-boundary-guards` 通过;双端 build;迁移文件已建。交付:全链改点、迁移 SQL、守卫结果。⚠️ 生产迁移需 owner 上线时执行(交付里标注)。
