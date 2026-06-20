CREATE TABLE "host_agents" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "agent_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "version" TEXT,
    "capabilities" JSONB DEFAULT '[]',
    "last_report" JSONB DEFAULT '{}',
    "last_seen_at" TIMESTAMP(3),
    "last_heartbeat_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "host_agent_nonces" (
    "id" SERIAL NOT NULL,
    "agent_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_agent_nonces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "host_agents_host_id_key" ON "host_agents"("host_id");
CREATE UNIQUE INDEX "host_agents_agent_id_key" ON "host_agents"("agent_id");
CREATE INDEX "host_agents_enabled_idx" ON "host_agents"("enabled");
CREATE INDEX "host_agents_status_idx" ON "host_agents"("status");
CREATE INDEX "host_agents_last_seen_at_idx" ON "host_agents"("last_seen_at");
CREATE UNIQUE INDEX "host_agent_nonces_agent_id_nonce_key" ON "host_agent_nonces"("agent_id", "nonce");
CREATE INDEX "host_agent_nonces_agent_id_idx" ON "host_agent_nonces"("agent_id");
CREATE INDEX "host_agent_nonces_expires_at_idx" ON "host_agent_nonces"("expires_at");

ALTER TABLE "host_agents"
    ADD CONSTRAINT "host_agents_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "host_agent_nonces"
    ADD CONSTRAINT "host_agent_nonces_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "host_agents"("agent_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
