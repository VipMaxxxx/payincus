# 兑换码批:BF-8-14 已用 h-码禁物理删除 + BF-8-13 积分兑换码 p 正式取消清理(G-C 同意)

## 两条裁决
- **BF-8-14**:有使用记录的 h-码**禁止物理删除,只允许禁用/归档**(现宿主主人可删已用 h-码、DB 级联删使用记录,无法长期核算)。证据:redeem-codes.ts:457、schema.prisma:3818。
- **BF-8-13〔Q-C3〕**:**正式取消积分兑换码 p** 并清理死代码(枚举与旧代码保留 p,但 h-码创建/核销均已排除 p,积分只走每日签到)。证据:user-lifecycle.ts:24、checkin.ts。

## 修法(只改 redeem-codes.ts + user-lifecycle.ts + checkin.ts + 必要枚举/类型 + 守卫;不改 DB schema 列/不迁移;不碰 gift-cards(并行 BF-8-08))
1. **BF-8-14**:删除 h-码前查是否有使用记录(RedeemCodeUsage 之类):
   - 有使用记录 → **拒绝物理删除**,返回明确错误,改为**禁用/归档**(置状态 disabled/archived,保留记录);
   - 无使用记录 → 可删。
   - 若当前 DB 是级联删,**代码层拦截**(删前校验),不依赖改 schema;级联约束不动(仅代码禁止触发)。
2. **BF-8-13**:
   - 代码层**正式移除积分兑换码 p 的创建/核销入口**(若还有残留可达分支);清理 user-lifecycle.ts:24、checkin.ts 的死逻辑/死分支。
   - 枚举 p **保留定义**(避免 DB 存量值/schema 迁移),但标注 deprecated 且所有业务路径拒绝 p;不做 schema 迁移。
   - 积分只走每日签到(现状),不回归。
3. 改动最小,清理死代码不动活逻辑。

## 加守卫
`test:redeem-code-management-guards`/`test:user-lifecycle-guards` 追加:有使用记录 h-码禁物理删除、p 兑换码所有入口拒绝。不改 package.json。

## 不许动
不碰 gift-cards(并行)。不改 schema 列/不迁移。不 commit。

## 验收
type-check 通过;`test:redeem-code-management-guards`、`test:user-lifecycle-guards`、`test:system-redeem-consistency` 通过。交付一段话:h-码删前校验点、p 清理了哪些死代码、守卫结果。
