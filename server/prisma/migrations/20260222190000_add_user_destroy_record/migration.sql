-- CreateTable
CREATE TABLE "user_destroy_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "instance_name" TEXT NOT NULL,
    "destroyed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refund_amount" DECIMAL(10,2) NOT NULL,
    "fee_amount" DECIMAL(10,2) NOT NULL,
    "is_first_time" BOOLEAN NOT NULL,

    CONSTRAINT "user_destroy_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_destroy_records_user_id_idx" ON "user_destroy_records"("user_id");

-- CreateIndex
CREATE INDEX "user_destroy_records_user_id_host_id_idx" ON "user_destroy_records"("user_id", "host_id");

-- AddForeignKey
ALTER TABLE "user_destroy_records" ADD CONSTRAINT "user_destroy_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_destroy_records" ADD CONSTRAINT "user_destroy_records_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_destroy_records" ADD CONSTRAINT "user_destroy_records_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
