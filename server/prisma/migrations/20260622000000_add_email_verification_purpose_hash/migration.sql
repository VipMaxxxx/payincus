ALTER TABLE "email_verification_codes"
ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'general';

DROP INDEX IF EXISTS "email_verification_codes_email_code_idx";

CREATE INDEX IF NOT EXISTS "email_verification_codes_email_purpose_code_idx"
ON "email_verification_codes"("email", "purpose", "code");
