ALTER TABLE "host_agents"
ADD COLUMN "install_token_hash" TEXT,
ADD COLUMN "install_token_expires_at" TIMESTAMP(3),
ADD COLUMN "install_token_used_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "host_agents_install_token_hash_key" ON "host_agents"("install_token_hash");
CREATE INDEX "host_agents_install_token_expires_at_idx" ON "host_agents"("install_token_expires_at");
