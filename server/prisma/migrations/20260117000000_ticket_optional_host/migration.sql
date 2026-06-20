-- AlterTable: Make host_id optional in tickets table
-- This allows users to create tickets without selecting an instance
-- (e.g., for billing/recharge issues before having any instances)

ALTER TABLE "tickets" ALTER COLUMN "host_id" DROP NOT NULL;
