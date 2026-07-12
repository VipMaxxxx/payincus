# 波4:AFF 佣金/折扣百分比后台可配(E1:要抽成就是aff,后台可自己设置百分比)

## 裁决
AFF 抽成(佣金)+折扣百分比**后台可配置**(现 aff.ts:303-304 硬编码 0.05/0.05 于生成时)。

## 现状
生成 AFF 码时 `discountRate=0.05`/`commissionRate=0.05` 硬编码写入该码;`affCode.discountRate/commissionRate` 是**每码存储字段**(schema 已有),后续计算读各码存值。证据:aff.ts:303-304、470-471、535、`processAffCommission`。

## 修法(只改 db/aff.ts + routes/system-config.ts + 管理端配置 UI + 守卫;不改 schema(字段已存)/不迁移;不碰 mail(并行))
1. **新增系统配置**:`aff_commission_rate`(默认 0.05,合理范围如 0~0.5)+ `aff_discount_rate`(默认 0.05,0~0.95),百分比语义;管理端可设。
2. **生成时取配置**:AFF 码生成(aff.ts:303-304 等所有生成点)把硬编码 0.05 改为**读上述配置的当前值**写入新码;**存量码保留自身存储率**(不改历史码,无迁移)。
3. **管理端 UI**:系统配置页加这两项(内联提示"如 0.05=5%",复用现有配置卡,不新增锁定表格,i18n 齐);校验范围。
4. 与 FX-012(退款冲回佣金)/FX-013(禁用码停佣金)协同,佣金计算仍读各码存储率,勿回退。

## 加守卫
`test:invite-generation-accounting-guards`/`test:system-config-value-guards` 追加:生成取配置率、存量码保留、范围校验。不改 package.json。

## 不许动
不碰 mail(并行)。不回退 FX-012/013。不改 schema/不迁移。不改锁定表格。不 commit。

## 验收
type-check/client type-check 通过;`test:invite-generation-accounting-guards`、`test:system-config-value-guards`、`test:aff-points-query-guards`、`test:frontend-i18n-keys` 通过。交付一段话:两配置项+范围、生成取配置、存量保留、守卫结果。
