# 波4:邮箱过期自救 + 到期暂停上游/续费恢复(F-C BF-9-01 + BF-9-02,全同意)

## 两条裁决
- **BF-9-01**:邮箱过期后**允许用户续费并恢复原订阅**(现过期订阅被隐藏、续费报"无订阅"、购买又因历史订阅拒绝,复活分支不可达)。证据:mail.ts(db):334-349、mail.ts:1095-1100、1213-1216。
- **BF-9-02**:到期**同步暂停所有上游域名**,续费后恢复(现到期只 active→expired 不调 suspendDomain();过期后仍可操作上游)。证据:mail-expiry-scheduler.ts:17-45、cranemail.ts:202-236、mail.ts:1383-1435。

## 修法(只改 db/mail.ts + routes/mail.ts + services/mail-expiry-scheduler.ts + services/cranemail.ts(suspend/resume)+ 守卫;不改 schema 列(字段已存)/不迁移;不碰 tickets(并行))
1. **BF-9-01 过期自救**:
   - `getUserMailSubscription`/续费查询让**过期订阅可见**(用于续费),或续费接口按 userId+source 查最近订阅(含 expired);
   - 续费**过期订阅**时**从当前时间复活**(periodStart=max(旧到期,now),与 FX-020 口径一致),恢复 active;
   - 购买事务:同源已有 expired 订阅时走**续费/复活**而非拒绝新购(与 BF-9-04 每源一份口径协同)。
2. **BF-9-02 到期暂停上游+续费恢复**:
   - mail-expiry-scheduler active→expired 时**调 suspendDomain()** 暂停该订阅所有上游域名;
   - 续费/复活成功后**resume/unsuspend** 上游;
   - 过期订阅的域名/账号增删接口**校验订阅状态**(过期拒绝操作上游,除续费恢复路径)。
3. 幂等/容错:暂停/恢复上游失败不阻断本地状态但记录待重试/告警;外呼走安全链路(FX-003/056)。与 BF-9-12 用量同步、FX-017/020 计费口径协同,勿回退。

## 加守卫
`test:mail-domain-lifecycle-guards`/`test:mail-subscription-cancel-guards`/`test:mail-renewal-month-guards` 追加:过期可续费复活、到期暂停上游、续费恢复、过期拒操作上游。不改 package.json。

## 不许动
不碰 tickets(并行)。不改 schema/不迁移。不回退 BF-9-04/12、FX-017/020。不 commit。

## 验收
type-check 通过;`test:mail-domain-lifecycle-guards`、`test:mail-subscription-cancel-guards`、`test:mail-renewal-month-guards`、`test:mail-plan-financial-guards`、`test:mail-account-quota-guards` 通过。交付一段话:自救复活口径、暂停/恢复上游、幂等容错、守卫结果。
