DROP TABLE IF EXISTS "flash_sale_audit_logs" CASCADE;
DROP TABLE IF EXISTS "flash_sale_reservations" CASCADE;
DROP TABLE IF EXISTS "flash_sale_items" CASCADE;
DROP TABLE IF EXISTS "flash_sale_campaigns" CASCADE;

DROP TYPE IF EXISTS "FlashSaleAuditAction";
DROP TYPE IF EXISTS "FlashSaleReservationStatus";
DROP TYPE IF EXISTS "FlashSaleCampaignStatus";
