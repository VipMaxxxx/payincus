/*
  Warnings:

  - A unique constraint covering the columns `[host_id,protocol,public_port]` on the table `port_mappings` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "port_mappings_host_id_protocol_public_port_key" ON "port_mappings"("host_id", "protocol", "public_port");
