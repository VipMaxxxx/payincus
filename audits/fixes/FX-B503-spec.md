# FX-B503 规格：免费套餐后端不校验规格上限,绕 API 可超额领资源(E3 护栏 / BF-5-03)

## owner 裁决(BEHAVIOR.md E3)
免费套餐规格 ≤ 套餐 max(后端强制)。(h-码校验容量/额度/禁付费实例=另一条 FX;本条只做免费套餐规格上限。)

## 根因
server/src/routes/instances.ts:1444-1449 免费套餐(无 selectedPlan)时 requestedCpu=cpu||15 / memory||128 / disk||512 直接采用**用户输入**,
后端**从不校验**套餐 cpu_max/memory_max/disk_max(仅共享套餐且设了 quotaMultiplier 才卡 CPU/内存,磁盘任何情况都不卡)。
约束只剩 host 资源与 JSON schema 上限(CPU≤10000%/内存≤512GB/盘≤100GB)。前端有 clamp 但绕过 API 即失效。

## 修法（只改 server/src/routes/instances.ts 免费套餐资源确定段;不碰 package.json)
1. 先只读:免费套餐资源确定(1444-1449)、套餐对象上的规格上限字段(cpu_max/memory_max/disk_max 或类似)。
2. 对**免费套餐**:requestedCpu/Memory/Disk 必须 ≤ 套餐对应 max(cpu_max/memory_max/disk_max)。超出 → 返回明确 400(或 clamp 到 max——优先**拒绝并提示**,避免静默改用户请求;二选一并说明)。默认值(15/128/512)也须 ≤ max。
3. 不改付费套餐(付费用 selectedPlan 固定值,已守恒);不改共享套餐 quotaMultiplier 逻辑(在其基础上叠加 max 校验即可)。

## 加守卫
在现有 server/scripts/test-instance-quota-zero-guards.ts 或 instance 相关守卫追加断言:免费套餐后端强制 requested ≤ 套餐 max。不改 package.json。

## 不许动
- 不改付费开通、不改 host 资源预留/条件扣减。不做大重构。

## 验收
- pnpm --filter server type-check 通过;pnpm --filter server test:instance-quota-zero-guards、test:instance-route-id-guards 通过。

## 交付
一段话:免费套餐 max 字段来源、拒绝还是 clamp、守卫结果。不要 commit。
