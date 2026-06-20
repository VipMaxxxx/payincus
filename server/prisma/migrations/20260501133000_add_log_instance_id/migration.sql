ALTER TABLE "logs"
ADD COLUMN "instance_id" INTEGER;

ALTER TABLE "logs"
ADD CONSTRAINT "logs_instance_id_fkey"
FOREIGN KEY ("instance_id") REFERENCES "instances"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "logs_instance_id_idx" ON "logs"("instance_id");

WITH id_matches AS (
  SELECT
    l."id" AS "log_id",
    l."user_id",
    (m."match")[1]::integer AS "instance_id"
  FROM "logs" l
  CROSS JOIN LATERAL regexp_matches(l."content", 'instance[[:space:]]*#([0-9]+)', 'gi') AS m("match")
  WHERE l."instance_id" IS NULL

  UNION ALL

  SELECT
    l."id" AS "log_id",
    l."user_id",
    (m."match")[1]::integer AS "instance_id"
  FROM "logs" l
  CROSS JOIN LATERAL regexp_matches(l."content", 'instance:[[:space:]]*[^()]*\(#([0-9]+)\)', 'gi') AS m("match")
  WHERE l."instance_id" IS NULL

  UNION ALL

  SELECT
    l."id" AS "log_id",
    l."user_id",
    (m."match")[1]::integer AS "instance_id"
  FROM "logs" l
  CROSS JOIN LATERAL regexp_matches(l."content", 'new instance ID:[[:space:]]*([0-9]+)', 'gi') AS m("match")
  WHERE l."instance_id" IS NULL
),
id_candidates AS (
  SELECT
    im."log_id",
    MIN(im."instance_id") AS "instance_id",
    COUNT(DISTINCT im."instance_id") AS "match_count"
  FROM id_matches im
  JOIN "instances" i
    ON i."id" = im."instance_id"
   AND (im."user_id" IS NULL OR i."user_id" = im."user_id")
  GROUP BY im."log_id"
)
UPDATE "logs" l
SET "instance_id" = c."instance_id"
FROM id_candidates c
WHERE l."id" = c."log_id"
  AND c."match_count" = 1;

WITH rename_logs AS (
  SELECT
    l."id",
    l."user_id",
    l."created_at",
    substring(l."content" from 'Renamed instance from "([^"]+)" to "[^"]+"') AS "old_name",
    substring(l."content" from 'Renamed instance from "[^"]+" to "([^"]+)"') AS "new_name"
  FROM "logs" l
  WHERE l."action" = 'instance.rename'
    AND l."instance_id" IS NULL
),
rename_candidates AS (
  SELECT
    r."id" AS "log_id",
    i."id" AS "instance_id",
    COUNT(*) OVER (PARTITION BY r."id") AS "match_count"
  FROM rename_logs r
  JOIN "instances" i
    ON i."user_id" = r."user_id"
   AND i."name" = r."new_name"
   AND i."created_at" <= r."created_at"
  WHERE r."old_name" IS NOT NULL
    AND r."new_name" IS NOT NULL
)
UPDATE "logs" l
SET "instance_id" = c."instance_id"
FROM rename_candidates c
WHERE l."id" = c."log_id"
  AND c."match_count" = 1;

WITH RECURSIVE rename_history AS (
  SELECT
    l."user_id",
    l."instance_id",
    i."created_at" AS "instance_created_at",
    substring(l."content" from 'Renamed instance from "([^"]+)" to "[^"]+"') AS "old_name",
    substring(l."content" from 'Renamed instance from "[^"]+" to "([^"]+)"') AS "new_name",
    l."created_at",
    1 AS "depth"
  FROM "logs" l
  JOIN "instances" i
    ON i."id" = l."instance_id"
  WHERE l."action" = 'instance.rename'
    AND l."instance_id" IS NOT NULL

  UNION ALL

  SELECT
    prev."user_id",
    rh."instance_id",
    rh."instance_created_at",
    substring(prev."content" from 'Renamed instance from "([^"]+)" to "[^"]+"') AS "old_name",
    substring(prev."content" from 'Renamed instance from "[^"]+" to "([^"]+)"') AS "new_name",
    prev."created_at",
    rh."depth" + 1 AS "depth"
  FROM rename_history rh
  JOIN "logs" prev
    ON prev."action" = 'instance.rename'
   AND prev."user_id" = rh."user_id"
   AND prev."created_at" < rh."created_at"
   AND substring(prev."content" from 'Renamed instance from "[^"]+" to "([^"]+)"') = rh."old_name"
  WHERE rh."depth" < 20
),
old_name_candidates AS (
  SELECT
    l."id" AS "log_id",
    r."instance_id",
    COUNT(*) OVER (PARTITION BY l."id") AS "match_count"
  FROM "logs" l
  JOIN rename_history r
    ON r."user_id" = l."user_id"
   AND l."created_at" < r."created_at"
   AND l."created_at" >= r."instance_created_at"
   AND strpos(lower(l."content"), lower('instance "' || r."old_name" || '"')) > 0
  WHERE l."instance_id" IS NULL
    AND r."old_name" IS NOT NULL
    AND r."new_name" IS NOT NULL
)
UPDATE "logs" l
SET "instance_id" = c."instance_id"
FROM old_name_candidates c
WHERE l."id" = c."log_id"
  AND c."match_count" = 1;

WITH current_name_candidates AS (
  SELECT
    l."id" AS "log_id",
    i."id" AS "instance_id",
    COUNT(*) OVER (PARTITION BY l."id") AS "match_count"
  FROM "logs" l
  JOIN "instances" i
    ON i."user_id" = l."user_id"
   AND l."created_at" >= i."created_at"
   AND strpos(lower(l."content"), lower('instance "' || i."name" || '"')) > 0
  WHERE l."instance_id" IS NULL
)
UPDATE "logs" l
SET "instance_id" = c."instance_id"
FROM current_name_candidates c
WHERE l."id" = c."log_id"
  AND c."match_count" = 1;
