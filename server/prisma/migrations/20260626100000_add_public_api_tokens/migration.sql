-- CreateTable
CREATE TABLE "public_api_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_api_tokens_token_hash_key" ON "public_api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "public_api_tokens_user_id_idx" ON "public_api_tokens"("user_id");

-- CreateIndex
CREATE INDEX "public_api_tokens_token_prefix_idx" ON "public_api_tokens"("token_prefix");

-- CreateIndex
CREATE INDEX "public_api_tokens_revoked_at_idx" ON "public_api_tokens"("revoked_at");

-- CreateIndex
CREATE INDEX "public_api_tokens_expires_at_idx" ON "public_api_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "public_api_tokens" ADD CONSTRAINT "public_api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
