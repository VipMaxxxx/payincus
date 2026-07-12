FX-056 已完成，未 commit。

- 复用并公开了 `outbound-security` 的 `resolvePublicHostname`：解析全部地址并拒绝私网、回环、链路本地、云元数据及其他保留 IP。
- 证书查询先校验 DNS，再以 `certificateAddress.address` 作为 `tls.connect.host` 锁定已校验 IP；保留原域名作为 `servername`（SNI），防止 DNS rebinding。
- 无不安全直连回退，原超时和证书信息逻辑保持不变。
- 两组守卫已补充私网拒绝、校验先于连接及 IP 锁定断言。

验证结果：

- `test:storage-outbound-guards`：通过
- `test:proxy-site-route-id-guards`：通过
- server `type-check`：通过
- `git diff --check`：通过

`instances`、schema、package 均未改动；状态中相关既有修改来自并行工作。
