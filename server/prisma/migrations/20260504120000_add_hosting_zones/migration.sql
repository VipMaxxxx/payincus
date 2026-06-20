CREATE TABLE "hosting_zones" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "logo_data_url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosting_zones_owner_id_key" ON "hosting_zones"("owner_id");
CREATE INDEX "hosting_zones_active_sort_order_idx" ON "hosting_zones"("active", "sort_order");

ALTER TABLE "hosting_zones"
ADD CONSTRAINT "hosting_zones_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
