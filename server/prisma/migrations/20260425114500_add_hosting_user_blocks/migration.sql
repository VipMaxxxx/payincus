-- CreateTable
CREATE TABLE "hosting_user_blocks" (
    "id" SERIAL NOT NULL,
    "blocker_id" INTEGER NOT NULL,
    "blocked_user_id" INTEGER NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosting_user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosting_user_blocks_blocker_id_blocked_user_id_key" ON "hosting_user_blocks"("blocker_id", "blocked_user_id");

-- CreateIndex
CREATE INDEX "hosting_user_blocks_blocked_user_id_idx" ON "hosting_user_blocks"("blocked_user_id");

-- CreateIndex
CREATE INDEX "hosting_user_blocks_blocker_id_idx" ON "hosting_user_blocks"("blocker_id");

-- AddForeignKey
ALTER TABLE "hosting_user_blocks" ADD CONSTRAINT "hosting_user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosting_user_blocks" ADD CONSTRAINT "hosting_user_blocks_blocked_user_id_fkey" FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
