-- AlterTable: Add is_global column to notification_channels
ALTER TABLE "notification_channels" ADD COLUMN "is_global" BOOLEAN NOT NULL DEFAULT false;
