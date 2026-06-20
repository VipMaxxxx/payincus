ALTER TABLE "ip_addresses"
  ADD COLUMN IF NOT EXISTS "host_id" INTEGER;

UPDATE "ip_addresses" AS ip
SET "host_id" = i."host_id"
FROM "instances" AS i
WHERE ip."instance_id" = i."id"
  AND (ip."host_id" IS NULL OR ip."host_id" IS DISTINCT FROM i."host_id");

DELETE FROM "ip_addresses"
WHERE "instance_id" IN (
  SELECT "id"
  FROM "instances"
  WHERE "status" = 'deleted'
);

WITH duplicate_ipv4_instances AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "host_id", "ipv4"
      ORDER BY "id" ASC
    ) AS rn
  FROM "instances"
  WHERE "status" <> 'deleted'
    AND "ipv4" IS NOT NULL
)
UPDATE "instances" AS i
SET "ipv4" = NULL
FROM duplicate_ipv4_instances AS d
WHERE i."id" = d."id"
  AND d.rn > 1;

WITH duplicate_ipv6_instances AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "ipv6"
      ORDER BY "id" ASC
    ) AS rn
  FROM "instances"
  WHERE "status" <> 'deleted'
    AND "ipv6" IS NOT NULL
)
UPDATE "instances" AS i
SET "ipv6" = NULL
FROM duplicate_ipv6_instances AS d
WHERE i."id" = d."id"
  AND d.rn > 1;

WITH duplicate_ipv4_rows AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "host_id", "address"
      ORDER BY "is_primary" DESC, "instance_id" ASC, "created_at" ASC, "id" ASC
    ) AS rn
  FROM "ip_addresses"
  WHERE "type" = 'inet4'
)
DELETE FROM "ip_addresses" AS ip
USING duplicate_ipv4_rows AS d
WHERE ip."id" = d."id"
  AND d.rn > 1;

WITH duplicate_ipv6_rows AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "address"
      ORDER BY "is_primary" DESC, "instance_id" ASC, "created_at" ASC, "id" ASC
    ) AS rn
  FROM "ip_addresses"
  WHERE "type" = 'inet6'
)
DELETE FROM "ip_addresses" AS ip
USING duplicate_ipv6_rows AS d
WHERE ip."id" = d."id"
  AND d.rn > 1;

DELETE FROM "ip_addresses" AS ip
USING "instances" AS i
WHERE ip."instance_id" = i."id"
  AND ip."type" = 'inet4'
  AND ip."is_primary" = true
  AND (i."ipv4" IS NULL OR ip."address" <> i."ipv4");

DELETE FROM "ip_addresses" AS ip
USING "instances" AS i
WHERE ip."instance_id" = i."id"
  AND ip."type" = 'inet6'
  AND ip."is_primary" = true
  AND (i."ipv6" IS NULL OR ip."address" <> i."ipv6");

DELETE FROM "ip_addresses" AS ip
WHERE ip."type" = 'inet6'
  AND ip."is_primary" = false
  AND EXISTS (
    SELECT 1
    FROM "instances" AS i
    WHERE i."status" <> 'deleted'
      AND i."ipv6" = ip."address"
  );

INSERT INTO "ip_addresses" ("address", "type", "is_primary", "is_custom", "device", "host_id", "instance_id")
SELECT
  i."ipv4",
  'inet4',
  true,
  false,
  'eth0',
  i."host_id",
  i."id"
FROM "instances" AS i
LEFT JOIN "ip_addresses" AS ip
  ON ip."instance_id" = i."id"
 AND ip."type" = 'inet4'
 AND ip."is_primary" = true
 AND ip."is_custom" = false
WHERE i."status" <> 'deleted'
  AND i."ipv4" IS NOT NULL
  AND ip."id" IS NULL;

INSERT INTO "ip_addresses" ("address", "type", "is_primary", "is_custom", "device", "host_id", "instance_id")
SELECT
  i."ipv6",
  'inet6',
  true,
  false,
  'eth1',
  i."host_id",
  i."id"
FROM "instances" AS i
LEFT JOIN "ip_addresses" AS ip
  ON ip."instance_id" = i."id"
 AND ip."type" = 'inet6'
 AND ip."is_primary" = true
 AND ip."is_custom" = false
WHERE i."status" <> 'deleted'
  AND i."ipv6" IS NOT NULL
  AND ip."id" IS NULL;

ALTER TABLE "ip_addresses"
  ALTER COLUMN "host_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ip_addresses_host_id_fkey'
  ) THEN
    ALTER TABLE "ip_addresses"
      ADD CONSTRAINT "ip_addresses_host_id_fkey"
      FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ip_addresses_host_id_idx" ON "ip_addresses"("host_id");
CREATE INDEX IF NOT EXISTS "ip_addresses_host_id_address_idx" ON "ip_addresses"("host_id", "address");

DROP INDEX IF EXISTS "ip_addresses_address_key";
DROP INDEX IF EXISTS "ip_addresses_ipv6_address_key";
DROP INDEX IF EXISTS "ip_addresses_host_id_address_inet4_key";
DROP INDEX IF EXISTS "instances_active_ipv6_key";
DROP INDEX IF EXISTS "instances_active_host_id_ipv4_key";

CREATE UNIQUE INDEX "ip_addresses_ipv6_address_key"
  ON "ip_addresses"("address")
  WHERE "type" = 'inet6';

CREATE UNIQUE INDEX "ip_addresses_host_id_address_inet4_key"
  ON "ip_addresses"("host_id", "address")
  WHERE "type" = 'inet4';

CREATE UNIQUE INDEX "instances_active_ipv6_key"
  ON "instances"("ipv6")
  WHERE "status" <> 'deleted'
    AND "ipv6" IS NOT NULL;

CREATE UNIQUE INDEX "instances_active_host_id_ipv4_key"
  ON "instances"("host_id", "ipv4")
  WHERE "status" <> 'deleted'
    AND "ipv4" IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_ip_address_host_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT "host_id"
  INTO NEW."host_id"
  FROM "instances"
  WHERE "id" = NEW."instance_id";

  IF NEW."host_id" IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve host_id for instance %', NEW."instance_id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ip_addresses_sync_host_id" ON "ip_addresses";

CREATE TRIGGER "ip_addresses_sync_host_id"
BEFORE INSERT OR UPDATE
ON "ip_addresses"
FOR EACH ROW
EXECUTE FUNCTION sync_ip_address_host_id();

CREATE OR REPLACE FUNCTION sync_instance_ip_addresses()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."host_id" IS DISTINCT FROM OLD."host_id" THEN
    UPDATE "ip_addresses"
    SET "host_id" = NEW."host_id"
    WHERE "instance_id" = NEW."id";
  END IF;

  IF NEW."status" = 'deleted' AND OLD."status" IS DISTINCT FROM 'deleted' THEN
    DELETE FROM "ip_addresses"
    WHERE "instance_id" = NEW."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "instances_sync_ip_addresses" ON "instances";

CREATE TRIGGER "instances_sync_ip_addresses"
AFTER UPDATE OF "host_id", "status"
ON "instances"
FOR EACH ROW
EXECUTE FUNCTION sync_instance_ip_addresses();
