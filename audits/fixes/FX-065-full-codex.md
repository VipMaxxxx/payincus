FX-065 代码与迁移文件已完成；本地数据库迁移因 shadow DB 权限不足未实际应用。未 commit、push、发版，也未接触生产环境。

### 全链改点

- Schema 注释统一为“元”：
  [schema.prisma](C:/Users/Administrator/Desktop/payinces/server/prisma/schema.prisma:1327)
- 新增数据迁移：
  [migration.sql](C:/Users/Administrator/Desktop/payinces/server/prisma/migrations/20260712000000_traffic_reset_price_to_yuan/migration.sql:1)
- API 改为校验 0–999999.99 元、最多两位小数，不再要求整数分：
  [packages.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/packages.ts:281)
- 扣费直接使用元，移除 `/100`：
  [traffic.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/traffic.ts:417)
- 实例详情、分页返回值移除 `/100`：
  [instances.ts](C:/Users/Administrator/Desktop/payinces/server/src/routes/instances.ts:2496)、
  [pagination.ts](C:/Users/Administrator/Desktop/payinces/server/src/db/pagination.ts:574)
- 套餐及方案表单直接按元回显和提交：
  [PackageFormView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/resources/PackageFormView.vue:309)、
  [MyPackagesView.vue](C:/Users/Administrator/Desktop/payinces/client/src/views/resources/MyPackagesView.vue:530)
- API 类型注释同步为元：
  [client api.ts](C:/Users/Administrator/Desktop/payinces/client/src/types/api.ts:2606)、
  [database.ts](C:/Users/Administrator/Desktop/payinces/server/src/types/database.ts:155)
- 三组守卫已追加元口径、无换算及扣费断言。

迁移 SQL：

```sql
UPDATE "packages"
SET "traffic_reset_price" = "traffic_reset_price" / 100
WHERE "traffic_reset_price" IS NOT NULL;

UPDATE "package_plans"
SET "traffic_reset_price" = "traffic_reset_price" / 100
WHERE "traffic_reset_price" IS NOT NULL;
```

### 验证结果

- Server type-check：通过
- Client type-check：通过
- `test:traffic-reset-locks`：通过
- `test:system-config-value-guards`：通过
- `test:frontend-route-guards`：通过
- `test:frontend-dist-boundary-guards`：通过
- User 生产构建：通过
- Admin 生产构建：通过
- `prisma generate`：通过
- `git diff --check`：通过

`prisma migrate dev --name traffic_reset_price_to_yuan` 已针对 `127.0.0.1:5432/incudal` 尝试，但当前数据库用户无 `CREATE DATABASE` 权限，无法创建 shadow database，报 Prisma `P3014`。因此本地库未迁移，也无法进行迁移后的真机扣费流程验证。

生产上线时必须由 owner 在正式发布流程中执行该迁移；当前没有对生产库执行任何操作。
