ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "has_created_host_before" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" AS u
SET "has_created_host_before" = true
WHERE EXISTS (
  SELECT 1
  FROM "hosts" AS h
  WHERE h."user_id" = u."id"
)
OR EXISTS (
  SELECT 1
  FROM "packages" AS p
  WHERE p."user_id" = u."id"
)
OR EXISTS (
  SELECT 1
  FROM "logs" AS l
  WHERE l."user_id" = u."id"
    AND l."action" = 'host.create'
);
