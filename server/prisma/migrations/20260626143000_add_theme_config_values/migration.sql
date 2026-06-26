-- AlterTable
ALTER TABLE "theme_packages" ADD COLUMN "config_values" JSONB NOT NULL DEFAULT '{}';
