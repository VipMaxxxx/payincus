# FX-057 规格：Caddy 管理请求带 Basic Auth 却关 TLS 校验(P1 / D-020 / M13-07)

## 根因
`server/src/lib/caddy-client.ts:39,66`:Caddy 管理请求携带 Basic Auth,但 TLS `rejectUnauthorized:false` 关闭证书校验 → 宿主↔后端链路被劫持时可窃取 Caddy 管理凭证并篡改全部反代配置。

## 修法(只改 server/src/lib/caddy-client.ts + 守卫;不改 schema/package;不碰 instances(并行))
1. 先只读:caddy-client 如何建 HTTPS 连接、Basic Auth 从哪来、宿主是否已配 Caddy 管理端 CA/证书/指纹(host 记录里 certPath/caPath/fingerprint 之类)、其它出站(如 Incus)如何做证书固定可参照。
2. **禁止对携带管理凭证的连接关闭证书校验**:
   - 移除/禁用 `rejectUnauthorized:false`;改为**受信 CA 固定**或**证书指纹固定(pinning)**或 **mTLS**(优先复用宿主已有的信任材料,如与 Incus 相同的 cert/key/CA 机制)。
   - **fail-closed**:若某宿主没有可用的信任材料(CA/指纹),则**报错拒绝连接**,绝不退回到"关闭校验"。
3. 若确需部署期补充信任材料(如宿主端 Caddy 自签证书的 CA/指纹入库),在交付说明里**明确标注需要 owner 部署期提供**(类似 FX-008 处理),代码侧先实现"有信任材料则校验、无则 fail-closed"。

## 加守卫
`test:proxy-site-route-id-guards` 追加:caddy-client 不得出现 `rejectUnauthorized:false`/不得对带凭证连接关校验;走 CA/指纹/mTLS。不改 package.json。

## 不许动
不碰 instances(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:proxy-site-route-id-guards` 通过。交付一段话:用了 CA 固定/指纹/mTLS 哪种、信任材料来源、是否需要 owner 部署期补充、fail-closed 行为、守卫结果。
