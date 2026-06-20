-- Remove historical duplicate destroy markers before adding the guard.
-- Balance remediation for duplicate refunds must be handled separately because
-- those rows already affected user balances.
CREATE TABLE IF NOT EXISTS "user_destroy_records_duplicate_archive" AS
SELECT a.*, now() AS "archived_at"
FROM "user_destroy_records" a
JOIN "user_destroy_records" b
  ON a."instance_id" = b."instance_id"
WHERE a."destroyed_at" < b."destroyed_at"
  OR (a."destroyed_at" = b."destroyed_at" AND a."id" < b."id");

DELETE FROM "user_destroy_records" a
USING "user_destroy_records" b
WHERE a."instance_id" = b."instance_id"
  AND (
    a."destroyed_at" < b."destroyed_at"
    OR (a."destroyed_at" = b."destroyed_at" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX "user_destroy_records_instance_id_key"
ON "user_destroy_records"("instance_id");
