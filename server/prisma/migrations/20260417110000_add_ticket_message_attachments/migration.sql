CREATE TABLE "ticket_message_attachments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "message_id" INTEGER NOT NULL,
    "uploader_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'lsky',
    "provider_version" TEXT NOT NULL DEFAULT 'v1',
    "provider_file_id" TEXT,
    "filename" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_message_attachments_ticket_id_created_at_idx" ON "ticket_message_attachments"("ticket_id", "created_at");
CREATE INDEX "ticket_message_attachments_message_id_idx" ON "ticket_message_attachments"("message_id");
CREATE INDEX "ticket_message_attachments_uploader_id_idx" ON "ticket_message_attachments"("uploader_id");

ALTER TABLE "ticket_message_attachments"
ADD CONSTRAINT "ticket_message_attachments_ticket_id_fkey"
FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_message_attachments"
ADD CONSTRAINT "ticket_message_attachments_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_message_attachments"
ADD CONSTRAINT "ticket_message_attachments_uploader_id_fkey"
FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
