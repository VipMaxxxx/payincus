-- CreateTable
CREATE TABLE "inbox_messages" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_messages_user_id_is_read_idx" ON "inbox_messages"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "inbox_messages_user_id_created_at_idx" ON "inbox_messages"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
