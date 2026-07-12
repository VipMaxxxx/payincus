# BF-10-03 规格：Hosting 提现审核是死流程(F-D 全同意)

## 裁决
**现金提现加人工审核**(pending→approved/rejected/completed);**转面板余额免审即时**。

## 现状
`WithdrawalStatus` 有 pending/approved/rejected/completed、/balance 还算"待审核提现"、前端备了状态样式,但 `/withdraw` 永远直写 completed 即时到账,无审批接口 → 三状态与"待审核提现"恒0。证据:hosting.ts:36-41、301-307、613-621。

## 修法(只改 routes/hosting.ts + 必要 db + 守卫;不改 schema 枚举(已有 pending/approved/rejected/completed)/不迁移;不碰 exchange(并行))
1. 先只读:hosting.ts:301-307/613-621 的 /withdraw、/balance 的"待审核提现"计算、WithdrawalStatus 枚举、余额扣减/到账逻辑。
2. **区分提现类型**:
   - **现金提现**(提现到外部/现金):创建为 `pending`,**冻结/扣减对应金额**(避免重复提现),等管理员审批;新增管理员 `approve`(置 completed 并实际放款)/`reject`(置 rejected 并退回冻结金额)接口。
   - **转面板余额**:保持**免审即时**(直接 completed + 入面板余额)。
3. **/balance"待审核提现"**:按 pending 提现实时统计(不再恒0)。
4. 幂等/并发:审批用条件更新(status=pending→...)防重复审批;金额一致性(冻结=放款/退回)。与 hosting 回扣(FX-011/014/015)口径协同,不回退。

## 加守卫
`test:hosting-balance-guards`/`test:admin-hosting-route-id-guards` 追加:现金提现走 pending+审批、转余额免审、待审核统计非0、审批幂等退回一致。不改 package.json。

## 不许动
不碰 exchange(并行)。不回退 FX-011/014/015。不改 schema 枚举/不迁移。不 commit。

## 验收
type-check 通过;`test:hosting-balance-guards`、`test:admin-hosting-route-id-guards`、`test:financial-reconciliation-guards` 通过。交付一段话:现金 vs 余额分流、审批接口、冻结/退回一致、守卫结果。
