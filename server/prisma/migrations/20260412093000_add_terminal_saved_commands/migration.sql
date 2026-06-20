-- CreateTable
CREATE TABLE "terminal_saved_commands" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_saved_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terminal_saved_commands_user_id_updated_at_idx" ON "terminal_saved_commands"("user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "terminal_saved_commands" ADD CONSTRAINT "terminal_saved_commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
