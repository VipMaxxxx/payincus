# M07 审计报告

## 结论摘要
M07 的 HMAC 鉴权核心(签名/时间窗/nonce 重放/timingSafe 比较)实现严谨,未发现签名绕过或重放缺口;Agent 上报的状态/流量对业务状态做了良好的最小权限约束。主要风险集中在信任边界外的完整性假设:Go 自升级链路允许明文 http 且面板响应无签名(MITM 可投毒 root 二进制)、宿主机 certPath/keyPath 由普通用户任意指定(面板被诱导读取任意服务端文件并作为 mTLS 身份连接用户可控端点)、以及被攻陷/恶意宿主机可无上限伪造跨租户流量计数造成计费/封停。其余为低危信息泄漏与硬化项。

## 发现清单

- [M07-01] P2 | 置信度 中 | agent/internal/config/config.go:78 · agent/internal/upgrade/upgrade.go:140-150 · agent/internal/panel/client.go:106-109
  - 问题:Agent 自升级/心跳的完整性完全依赖 TLS,但代码允许 http,且面板响应体不做任何签名校验,二进制也没有独立于面板的签名(面板即信任根)。
  - 证据:config.go 接受 http;upgrade.go validateUpgradeURL 仅校验 scheme/host 与 AllowedBaseURL 一致(同样允许 http);client.go 心跳返回后直接取 Upgrade 无来源认证;runner.Apply 只校验 sha256==instruction.SHA256(两值均来自同一未认证响应)。
  - 影响:panel_url 为 http 或链路可 MITM 时,攻击者可伪造心跳响应投递任意二进制并给出匹配 sha256,Agent 以 root 下载替换并 systemctl restart → 全体宿主机 RCE。HTTPS 部署由 TLS 缓解,但代码层无强制。
  - 修复建议:强制 panel_url 与升级 URL 必须 https,或对升级指令引入独立于传输层的签名校验。

- [M07-02] P2 | 置信度 中 | server/src/routes/hosts.ts:974-975,1021,1204-1205,1261-1267 · server/src/lib/incus/certificate-paths.ts:19 · server/src/lib/incus/incus-client.ts:72-79
  - 问题:普通用户在创建/更新宿主机时可任意指定服务端文件系统路径 certPath/keyPath,无任何路径校验;面板随后以该文件作为 mTLS 客户端身份连接用户可控的 url。
  - 证据:schema certPath/keyPath 仅 {type:'string'} 直接落库;resolveCertificatePath 对已存在的任意路径原样返回;incus-client connect() readFileSync(certPath/keyPath) 并 rejectUnauthorized:false 连向 baseUrl。storagePath 有正则校验,certPath/keyPath 却没有。
  - 影响:SSRF + 本地文件读取原语——面板被诱导读取任意可读文件当 TLS 证书并向攻击者服务器握手,可用作文件探针并外泄面板 Incus 客户端证书(公钥部分)。
  - 修复建议:certPath/keyPath 改为服务端内部赋值(或严格白名单到 server/certs 目录),禁止用户在请求中提交。

- [M07-03] P2 | 置信度 中 | server/src/services/agent-instance-report.ts:78,255-268,385-397 · server/src/services/traffic-utils.ts:11-16
  - 问题:被攻陷或恶意的宿主机 Agent(持有 secret)可对该宿主机上任意租户实例上报无上限的流量计数,直接累加计费。
  - 证据:parseCounter 允许 ^\d{1,30}$(最大 10^30);calculateIncrement 对 current-last 不设上限;applyReportedTrafficCounters 无封顶 increment,实例集合仅按 {hostId, incusId in ...} 匹配不区分 userId(宿主机主人≠实例买家)。
  - 影响:宿主机主人可跨租户抬高其托管买家实例流量用量,触发流量封停(LIMITED)或超额计费,属计费完整性问题。
  - 修复建议:对单次上报增量设置基于心跳间隔与链路带宽的合理性上限,超限丢弃并告警。

- [M07-04] P3 | 置信度 高 | server/src/routes/hosts.ts:2033-2034(对比 902)
  - 问题:GET /hosts/:id 向节点所有者(非管理员)返回内部证书文件路径 certPath/keyPath,与列表接口"敏感、已移除"策略不一致。
  - 影响:向普通用户泄漏面板部署内部绝对路径(信息泄漏/策略不一致),辅助侦察。
  - 修复建议:详情接口对齐列表接口,去除 certPath/keyPath 字段。

- [M07-05] P3 | 置信度 中 | server/src/routes/agent.ts:236-256,280-286
  - 问题:lastHeartbeatIp 在面板处于反代之后时可被 Agent 通过转发头伪造。
  - 影响:仅影响展示/审计用的心跳来源 IP,可误导溯源;无鉴权绕过。
  - 修复建议:仅信任由自有反代设置的单一可信头,或在反代层强制覆盖客户端转发头。

- [M07-06] P3 | 置信度 中 | server/src/routes/agent.ts:1036-1074
  - 问题:一次性安装口令置于 URL 路径,/install-config/:token 无鉴权(仅凭 token)即返回明文 agentSecret。
  - 影响:口令为一次性/30分钟/落库哈希/原子消费(缓解充分),但 URL 路径 token 与同信道明文 secret 存在日志泄漏面。
  - 修复建议:改用 Authorization 头或 POST body 传 token,并对该路径禁用访问日志。

- [M07-07] P3 | 置信度 低 | server/src/routes/agent.ts:325-354,356-378
  - 问题:FRONTEND_URL 未配置时,安装命令 panelUrl 由请求 Host/X-Forwarded-Host/Origin/Referer 推导,影响 curl <panelUrl>/api/agent/install.sh | sudo bash 的下载目标。
  - 影响:无 shell 注入(已转义);但 FRONTEND_URL 缺省且转发头可影响时,可能诱导 operator 从被篡改 URL 拉取并 root 执行(社工层面)。
  - 修复建议:生产强制以 FRONTEND_URL 为唯一可信来源,忽略请求头推导。

补充(已验证正确,未发现问题):HMAC 规范化 JSON 与 stableStringify 一致、timingSafeEqual 常量时间、±5min 时间窗 + 10min nonce TTL + @@unique([agentId,nonce]) 无重放缝隙、reserveResources/rollbackResources 条件原子自增与 GREATEST 原子自减、上报状态机严格限制 running/stopped 且事务内二次校验、GitHub 下载 URL 经 assertTrustedAgentReleaseDownloadUrl 域名白名单、安装脚本对二进制强制 sha256 校验。
