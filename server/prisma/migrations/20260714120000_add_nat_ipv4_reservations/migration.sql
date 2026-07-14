-- NAT 内网 IPv4 的分配预留表。
-- 分配到落库之间隔着实例交付的数分钟，此前这段窗口里已分配的 IP 对查重完全隐形，
-- 同一宿主机上并发创建的实例会拿到同一个内网 IP。预留行让「已分配未落地」的地址立刻可见。
-- 纯新增，不改动任何既有数据。
CREATE TABLE "nat_ipv4_reservations" (
    "id" SERIAL NOT NULL,
    "host_id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nat_ipv4_reservations_pkey" PRIMARY KEY ("id")
);

-- 同一宿主机上同一个地址只能有一条有效预留：这是防止并发重复分配的数据库级兜底。
CREATE UNIQUE INDEX "nat_ipv4_reservations_host_id_address_key" ON "nat_ipv4_reservations"("host_id", "address");
CREATE INDEX "nat_ipv4_reservations_expires_at_idx" ON "nat_ipv4_reservations"("expires_at");

ALTER TABLE "nat_ipv4_reservations" ADD CONSTRAINT "nat_ipv4_reservations_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
