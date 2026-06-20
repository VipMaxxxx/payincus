-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "release_channel_id" INTEGER;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_release_channel_id_fkey" FOREIGN KEY ("release_channel_id") REFERENCES "notification_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
