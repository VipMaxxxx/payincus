-- CreateTable
CREATE TABLE "email_verification_codes" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_verification_codes_email_code_idx" ON "email_verification_codes"("email", "code");

-- CreateIndex
CREATE INDEX "email_verification_codes_expires_at_idx" ON "email_verification_codes"("expires_at");

