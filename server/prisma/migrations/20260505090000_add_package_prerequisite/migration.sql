ALTER TABLE "packages"
ADD COLUMN "required_package_id" INTEGER;

CREATE INDEX "packages_required_package_id_idx"
ON "packages"("required_package_id");

ALTER TABLE "packages"
ADD CONSTRAINT "packages_required_package_id_fkey"
FOREIGN KEY ("required_package_id")
REFERENCES "packages"("id")
ON DELETE NO ACTION
ON UPDATE CASCADE;
