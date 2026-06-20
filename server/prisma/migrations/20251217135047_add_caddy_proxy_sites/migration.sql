-- CreateEnum
CREATE TYPE "ProxySiteStatus" AS ENUM ('pending', 'active', 'error');

-- AlterTable
ALTER TABLE "hosts" ADD COLUMN     "caddy_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "caddy_password" TEXT,
ADD COLUMN     "caddy_port" INTEGER NOT NULL DEFAULT 8444,
ADD COLUMN     "caddy_username" TEXT;

-- CreateTable
CREATE TABLE "proxy_sites" (
    "id" SERIAL NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "host_id" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "target_port" INTEGER NOT NULL,
    "status" "ProxySiteStatus" NOT NULL DEFAULT 'pending',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxy_sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proxy_sites_instance_id_idx" ON "proxy_sites"("instance_id");

-- CreateIndex
CREATE INDEX "proxy_sites_host_id_idx" ON "proxy_sites"("host_id");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_sites_host_id_domain_key" ON "proxy_sites"("host_id", "domain");

-- AddForeignKey
ALTER TABLE "proxy_sites" ADD CONSTRAINT "proxy_sites_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_sites" ADD CONSTRAINT "proxy_sites_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
