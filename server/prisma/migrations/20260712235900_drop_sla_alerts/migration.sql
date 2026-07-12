-- Remove SLA alert ticket links before narrowing the enum.
DELETE FROM "ticket_object_links" WHERE "object_type" = 'sla_alert';

-- DropTable
DROP TABLE IF EXISTS "sla_alert_actions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "sla_alert_events" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "sla_alert_rules" CASCADE;

-- AlterEnum
ALTER TYPE "TicketObjectLinkType" RENAME TO "TicketObjectLinkType_old";
CREATE TYPE "TicketObjectLinkType" AS ENUM (
  'recharge_record',
  'order_operation_case',
  'instance',
  'host'
);
ALTER TABLE "ticket_object_links"
  ALTER COLUMN "object_type" TYPE "TicketObjectLinkType"
  USING ("object_type"::text::"TicketObjectLinkType");
DROP TYPE IF EXISTS "TicketObjectLinkType_old";

-- DropEnum
DROP TYPE IF EXISTS "SlaAlertActionType";

-- DropEnum
DROP TYPE IF EXISTS "SlaAlertObjectType";

-- DropEnum
DROP TYPE IF EXISTS "SlaAlertStatus";

-- DropEnum
DROP TYPE IF EXISTS "SlaAlertSeverity";
