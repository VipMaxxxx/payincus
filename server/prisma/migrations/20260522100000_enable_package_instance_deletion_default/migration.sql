-- This setting is no longer exposed in the package form. Keep the column for
-- compatibility, but make the hidden default consistently allow deletion.
UPDATE "packages" SET "allow_instance_deletion" = true WHERE "allow_instance_deletion" = false;
ALTER TABLE "packages" ALTER COLUMN "allow_instance_deletion" SET DEFAULT true;
