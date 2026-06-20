-- Add host architecture field
ALTER TABLE "hosts"
ADD COLUMN "architecture" TEXT NOT NULL DEFAULT 'x86_64';

-- Add host-level allowed image whitelist
CREATE TABLE "host_allowed_images" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "image_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_allowed_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "host_allowed_images_host_id_idx" ON "host_allowed_images"("host_id");
CREATE INDEX "host_allowed_images_image_id_idx" ON "host_allowed_images"("image_id");
CREATE UNIQUE INDEX "host_allowed_images_host_id_image_id_key" ON "host_allowed_images"("host_id", "image_id");

ALTER TABLE "host_allowed_images"
ADD CONSTRAINT "host_allowed_images_host_id_fkey"
FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_allowed_images"
ADD CONSTRAINT "host_allowed_images_image_id_fkey"
FOREIGN KEY ("image_id") REFERENCES "system_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
