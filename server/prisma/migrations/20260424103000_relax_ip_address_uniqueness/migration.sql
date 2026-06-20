DROP INDEX IF EXISTS "ip_addresses_address_key";

CREATE INDEX IF NOT EXISTS "ip_addresses_address_idx" ON "ip_addresses"("address");
