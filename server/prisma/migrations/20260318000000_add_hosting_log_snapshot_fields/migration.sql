-- AlterTable
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_buyer_name" TEXT;
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_buyer_email" TEXT;
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_buyer_avatar" TEXT;
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_instance_name" TEXT;
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_host_name" TEXT;
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_package_name" TEXT;
ALTER TABLE "hosting_balance_logs" ADD COLUMN "snapshot_plan_name" TEXT;

-- Backfill snapshot data from existing instances
UPDATE "hosting_balance_logs" AS hbl
SET
  "snapshot_buyer_name" = u.username,
  "snapshot_buyer_email" = u.email,
  "snapshot_buyer_avatar" = u.avatar_style,
  "snapshot_instance_name" = i.name,
  "snapshot_host_name" = h.name,
  "snapshot_package_name" = pkg.name,
  "snapshot_plan_name" = pp.name
FROM "instances" i
LEFT JOIN "users" u ON i.user_id = u.id
LEFT JOIN "hosts" h ON i.host_id = h.id
LEFT JOIN "packages" pkg ON i.package_id = pkg.id
LEFT JOIN "package_plans" pp ON i.package_plan_id = pp.id
WHERE hbl.related_id = i.id
  AND hbl.related_id IS NOT NULL
  AND hbl.type IN ('income', 'deduction')
  AND hbl.snapshot_instance_name IS NULL;
