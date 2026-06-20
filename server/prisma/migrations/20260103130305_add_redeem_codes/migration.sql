-- CreateTable
CREATE TABLE "redeem_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "host_id" INTEGER NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "code_type" "RedeemCodeType" NOT NULL,
    "code_value" INTEGER NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redeem_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redeem_code_usages" (
    "id" SERIAL NOT NULL,
    "redeem_code_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redeem_code_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "redeem_codes_code_key" ON "redeem_codes"("code");

-- CreateIndex
CREATE INDEX "redeem_codes_host_id_idx" ON "redeem_codes"("host_id");

-- CreateIndex
CREATE INDEX "redeem_codes_created_by_id_idx" ON "redeem_codes"("created_by_id");

-- CreateIndex
CREATE INDEX "redeem_codes_enabled_idx" ON "redeem_codes"("enabled");

-- CreateIndex
CREATE INDEX "redeem_code_usages_redeem_code_id_idx" ON "redeem_code_usages"("redeem_code_id");

-- CreateIndex
CREATE INDEX "redeem_code_usages_user_id_idx" ON "redeem_code_usages"("user_id");

-- CreateIndex
CREATE INDEX "redeem_code_usages_instance_id_idx" ON "redeem_code_usages"("instance_id");

-- AddForeignKey
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redeem_codes" ADD CONSTRAINT "redeem_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redeem_code_usages" ADD CONSTRAINT "redeem_code_usages_redeem_code_id_fkey" FOREIGN KEY ("redeem_code_id") REFERENCES "redeem_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redeem_code_usages" ADD CONSTRAINT "redeem_code_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redeem_code_usages" ADD CONSTRAINT "redeem_code_usages_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
