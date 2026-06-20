-- Add cert_download_count field to hosts table
ALTER TABLE "hosts" ADD COLUMN "cert_download_count" INTEGER NOT NULL DEFAULT 0;
