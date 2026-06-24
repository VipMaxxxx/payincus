CREATE TYPE "TicketObjectLinkType" AS ENUM (
  'recharge_record',
  'order_operation_case',
  'instance',
  'host',
  'delivery_case',
  'sla_alert',
  'plugin_task'
);

ALTER TABLE "tickets"
  ADD COLUMN "first_response_due_at" TIMESTAMP(3),
  ADD COLUMN "resolution_due_at" TIMESTAMP(3),
  ADD COLUMN "first_responded_at" TIMESTAMP(3),
  ADD COLUMN "sla_breached_at" TIMESTAMP(3);

CREATE TABLE "ticket_internal_notes" (
  "id" SERIAL NOT NULL,
  "ticket_id" INTEGER NOT NULL,
  "actor_user_id" INTEGER NOT NULL,
  "actor_username" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ticket_internal_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ticket_object_links" (
  "id" SERIAL NOT NULL,
  "ticket_id" INTEGER NOT NULL,
  "object_type" "TicketObjectLinkType" NOT NULL,
  "object_id" INTEGER NOT NULL,
  "object_label" TEXT,
  "created_by_user_id" INTEGER NOT NULL,
  "created_by_username" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ticket_object_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tickets_status_first_response_due_at_idx" ON "tickets"("status", "first_response_due_at");
CREATE INDEX "tickets_status_resolution_due_at_idx" ON "tickets"("status", "resolution_due_at");
CREATE INDEX "ticket_internal_notes_ticket_id_created_at_idx" ON "ticket_internal_notes"("ticket_id", "created_at" DESC);
CREATE INDEX "ticket_internal_notes_actor_user_id_idx" ON "ticket_internal_notes"("actor_user_id");
CREATE INDEX "ticket_object_links_ticket_id_created_at_idx" ON "ticket_object_links"("ticket_id", "created_at" DESC);
CREATE INDEX "ticket_object_links_object_type_object_id_idx" ON "ticket_object_links"("object_type", "object_id");
CREATE UNIQUE INDEX "ticket_object_links_ticket_id_object_type_object_id_key" ON "ticket_object_links"("ticket_id", "object_type", "object_id");

ALTER TABLE "ticket_internal_notes"
  ADD CONSTRAINT "ticket_internal_notes_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_object_links"
  ADD CONSTRAINT "ticket_object_links_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
