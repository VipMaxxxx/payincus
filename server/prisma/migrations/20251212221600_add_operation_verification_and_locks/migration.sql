-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('change_password', 'disable_2fa', 'change_email', 'delete_account', 'delete_instance', 'reinstall_instance', 'transfer_instance', 'delete_snapshot', 'delete_backup');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('email', 'telegram', 'discord', 'webhook');

-- AlterTable
ALTER TABLE "hosts" ADD COLUMN "cert_download_expire" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "operation_verifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "operation_type" "OperationType" NOT NULL,
    "code" TEXT NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "resource_id" INTEGER,
    "resource_type" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributed_locks" (
    "id" SERIAL NOT NULL,
    "lock_key" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "acquired_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributed_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operation_verifications_user_id_operation_type_code_idx" ON "operation_verifications"("user_id", "operation_type", "code");

-- CreateIndex
CREATE INDEX "operation_verifications_expires_at_idx" ON "operation_verifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "distributed_locks_lock_key_key" ON "distributed_locks"("lock_key");

-- CreateIndex
CREATE INDEX "distributed_locks_expires_at_idx" ON "distributed_locks"("expires_at");

-- AddForeignKey
ALTER TABLE "operation_verifications" ADD CONSTRAINT "operation_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
