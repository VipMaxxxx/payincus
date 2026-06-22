-- Track failed verification attempts per sensitive-operation code.
ALTER TABLE "operation_verifications"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
