# FX-056 规格：证书查询直连 443 不走 outbound-security,DNS rebinding SSRF(P1 / D-019 / M13-06)

## 根因
`server/src/routes/proxy-sites.ts:953`:证书查询直接 `tls.connect` 站点域名 443,**不走 outbound-security**,连接时未复限解析结果为宿主公网 → 租户把 DNS 改到回环/私网/云元数据,后端被诱导探测内网 443(SSRF/DNS rebinding)。

## 前置事实
FX-003(波0)已建统一出站安全(safeFetch / assertSafeHttpUrl / safeOutboundDispatcher / IP 校验),但证书查询用**原始 tls.connect**(非 fetch),需把同款 IP 校验/锁定应用到 tls.connect 路径。

## 修法(只改 routes/proxy-sites.ts(+ 必要复用 lib/outbound-security)+ 守卫;不改 schema/package;不碰 instances(并行))
1. 先只读:proxy-sites.ts:953 的 tls.connect 用法、FX-003 outbound-security 暴露的 IP 解析/校验 API(是否有可复用的"解析域名→校验每个 IP 是公网→拒私网/回环/元数据"函数)。
2. **连接前解析并锁定允许地址**:
   - 解析目标域名 → 得到 IP 列表;**校验每个/选定 IP 为公网**(拒回环 127/::1、私网 10/172.16/192.168/fc00::、链路本地 169.254、云元数据 169.254.169.254 等),复用 FX-003 的校验逻辑。
   - **锁定连接到已校验的 IP**(`tls.connect({ host: 校验过的IP, servername: 域名, ... })`),防止解析→连接之间的 DNS rebinding(连接用的 IP 与校验的 IP 必须是同一个)。
   - 保留超时;证书查询失败明确报错,不回退到不安全直连。
3. 不改证书查询的正常功能(拿到证书链/有效期等)。

## 加守卫
`test:storage-outbound-guards`/`test:proxy-site-route-id-guards` 追加:证书查询经出站安全校验+IP 锁定,拒私网/回环、防 rebinding。不改 package.json。

## 不许动
不碰 instances(并行)。不改 schema/package。不 commit。

## 验收
type-check 通过;`test:storage-outbound-guards`、`test:proxy-site-route-id-guards` 通过。交付一段话:复用了哪个校验 API、如何锁定 IP 防 rebinding、守卫结果。
