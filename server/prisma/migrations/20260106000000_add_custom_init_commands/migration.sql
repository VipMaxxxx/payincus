-- CreateTable
CREATE TABLE "custom_init_commands" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "distros" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_init_commands_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Add custom_init_command_ids to instance_tasks
ALTER TABLE "instance_tasks" ADD COLUMN "custom_init_command_ids" TEXT;

-- CreateIndex
CREATE INDEX "custom_init_commands_user_id_idx" ON "custom_init_commands"("user_id");

-- CreateIndex
CREATE INDEX "custom_init_commands_user_id_enabled_idx" ON "custom_init_commands"("user_id", "enabled");

-- AddForeignKey
ALTER TABLE "custom_init_commands" ADD CONSTRAINT "custom_init_commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
