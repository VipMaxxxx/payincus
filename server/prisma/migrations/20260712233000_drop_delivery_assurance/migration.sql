-- DropTable
DROP TABLE IF EXISTS "delivery_assurance_actions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "delivery_assurance_cases" CASCADE;

-- DropEnum
DROP TYPE IF EXISTS "DeliveryAssuranceActionType";

-- DropEnum
DROP TYPE IF EXISTS "DeliveryAssuranceIssueType";

-- DropEnum
DROP TYPE IF EXISTS "DeliveryAssuranceCaseStatus";

-- Remove delivery-case ticket links before narrowing the enum.
DELETE FROM "ticket_object_links" WHERE "object_type" = 'delivery_case';

-- AlterEnum
ALTER TYPE "TicketObjectLinkType" RENAME TO "TicketObjectLinkType_old";
CREATE TYPE "TicketObjectLinkType" AS ENUM (
  'recharge_record',
  'order_operation_case',
  'instance',
  'host',
  'sla_alert',
  'plugin_task'
);
ALTER TABLE "ticket_object_links"
  ALTER COLUMN "object_type" TYPE "TicketObjectLinkType"
  USING ("object_type"::text::"TicketObjectLinkType");
DROP TYPE IF EXISTS "TicketObjectLinkType_old";
