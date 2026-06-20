/*
  Warnings:

  - The `status` column on the `host_images` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- DropForeignKey
ALTER TABLE "host_images" DROP CONSTRAINT "fk_host_images_host";

-- AlterTable
ALTER TABLE "host_images" ALTER COLUMN "image_id" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "os_type" SET DATA TYPE TEXT,
ALTER COLUMN "remote_alias" SET DATA TYPE TEXT,
ALTER COLUMN "icon" SET DATA TYPE TEXT,
ALTER COLUMN "fingerprint" SET DATA TYPE TEXT,
ALTER COLUMN "alias" SET DATA TYPE TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "HostImageStatus" NOT NULL DEFAULT 'pending',
ALTER COLUMN "synced_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "boot_autostart" BOOLEAN,
ADD COLUMN     "boot_autostart_delay" INTEGER,
ADD COLUMN     "boot_autostart_priority" INTEGER,
ADD COLUMN     "boot_host_shutdown_timeout" INTEGER,
ADD COLUMN     "limits_cpu_priority" INTEGER,
ADD COLUMN     "limits_egress" TEXT,
ADD COLUMN     "limits_ingress" TEXT,
ADD COLUMN     "limits_processes" INTEGER,
ADD COLUMN     "limits_read" TEXT,
ADD COLUMN     "limits_read_iops" INTEGER,
ADD COLUMN     "limits_write" TEXT,
ADD COLUMN     "limits_write_iops" INTEGER;

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "boot_autostart" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "boot_autostart_delay" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "boot_autostart_priority" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "boot_host_shutdown_timeout" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "limits_cpu_priority" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "limits_egress" TEXT NOT NULL DEFAULT '300Mbit',
ADD COLUMN     "limits_ingress" TEXT NOT NULL DEFAULT '300Mbit',
ADD COLUMN     "limits_processes" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "limits_read" TEXT NOT NULL DEFAULT '100MB',
ADD COLUMN     "limits_read_iops" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "limits_write" TEXT NOT NULL DEFAULT '100MB',
ADD COLUMN     "limits_write_iops" INTEGER NOT NULL DEFAULT 500;

-- AddForeignKey
ALTER TABLE "host_images" ADD CONSTRAINT "host_images_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_host_images_host_id" RENAME TO "host_images_host_id_idx";

-- RenameIndex
ALTER INDEX "uq_host_images_host_image" RENAME TO "host_images_host_id_image_id_key";
