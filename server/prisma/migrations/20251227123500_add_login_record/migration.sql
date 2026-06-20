-- CreateTable
CREATE TABLE "login_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "isp" TEXT,
    "timezone" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_records_user_id_created_at_idx" ON "login_records"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "login_records_user_id_ip_idx" ON "login_records"("user_id", "ip");

-- AddForeignKey
ALTER TABLE "login_records" ADD CONSTRAINT "login_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
