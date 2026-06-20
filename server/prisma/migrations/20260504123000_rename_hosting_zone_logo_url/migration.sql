ALTER TABLE "hosting_zones"
RENAME COLUMN "logo_data_url" TO "logo_url";

UPDATE "hosting_zones"
SET "logo_url" = 'https://example.com/hosting-zone-logo-migration-required.png'
WHERE "logo_url" !~* '^https?://';

ALTER TABLE "hosting_zones"
ADD CONSTRAINT "hosting_zones_logo_url_http_check"
CHECK ("logo_url" ~* '^https?://[^[:space:]]+$');
