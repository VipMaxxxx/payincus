-- FX-065: traffic_reset_price 统一从“分”换算为“元”。
UPDATE "packages"
SET "traffic_reset_price" = "traffic_reset_price" / 100
WHERE "traffic_reset_price" IS NOT NULL;

UPDATE "package_plans"
SET "traffic_reset_price" = "traffic_reset_price" / 100
WHERE "traffic_reset_price" IS NOT NULL;
