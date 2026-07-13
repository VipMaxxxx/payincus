-- drop_exchange_marketplace dropped the exchange_* tables but left these enum types orphaned
-- (no column references them, schema.prisma no longer declares them). Drop them now so the DB
-- has no dead enum types. Idempotent + lossless: IF EXISTS, and nothing references these types.
DROP TYPE IF EXISTS "ExchangeDeliveryTaskStatus";
DROP TYPE IF EXISTS "ExchangeDisputeStatus";
DROP TYPE IF EXISTS "ExchangeListingStatus";
DROP TYPE IF EXISTS "ExchangeOrderStatus";
DROP TYPE IF EXISTS "ExchangeWalletLogType";
DROP TYPE IF EXISTS "ExchangeWithdrawalStatus";
