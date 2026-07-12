# M25 审计报告
## 结论摘要
日志访问的用户归属隔离、分页上限和管理员导出鉴权整体较完整，但敏感信息处理与外呼安全仍存在明显缺口。最严重的是 outbound-security 的 DNS 校验与实际连接相分离，以及自由文本脱敏覆盖不足，可能分别导致 SSRF 和凭证进入日志或错误响应。

## 发现清单
- [M25-01] P1 | 置信度 高 | server/src/lib/outbound-security.ts:149
  - 问题:外呼目标只在请求前解析并校验一次，连接期防 DNS rebinding 的 `safeOutboundDispatcher` 是可选导出，没有被安全 API 强制使用。
  - 证据:`assertSafeHttpUrl()` 在 `await assertPublicHostname(parsed.hostname)` 后直接返回 URL；连接期校验仅存在于独立的 `safeOutboundDispatcher`。实际调用如 `server/src/routes/tickets.ts:381-385` 随后直接使用默认 `fetch()`，未传 dispatcher。
  - 影响:攻击者控制的域名可在校验时解析到公网地址、连接时改解析到内网地址，使服务端访问回环、私网或云元数据目标。
  - 修复建议:将校验和请求封装成不可绕过的安全 fetch，并强制连接期 DNS 校验，禁止调用方只使用预检 URL。

- [M25-02] P1 | 置信度 高 | server/src/lib/log-sanitizer.ts:85
  - 问题:自由文本脱敏仅识别 JWT 和字符集很窄的 Bearer Token，无法识别裸 `pat_`/`poa_` token、Basic 凭证、URL 查询参数中的密钥及含点号、加号、斜杠或等号的 Bearer 值；递归深度超过 10 后还会原样返回对象。
  - 证据:`TOKEN_PATTERNS` 只有 JWT 与 `/Bearer\s+[A-Za-z0-9_-]+/`；`sanitizeObject()` 在 `depth > 10` 时执行 `return obj`。错误 serializer 又把任意 `err.message`、`err.stack` 交给该有限的字符串函数。
  - 影响:异常消息、上游响应或深层对象中携带的 API Token、Cookie、签名和密钥可能进入 Pino 日志、审计记录或运维输出。
  - 修复建议:统一采用覆盖项目全部凭证格式的字符串脱敏器，并在达到递归上限时整体替换而不是返回原值。

- [M25-03] P2 | 置信度 高 | server/src/lib/errors.ts:700
  - 问题:`apiError()` 无条件把调用方提供的 `details` 返回客户端，绕过了 `app.ts` 对生产环境 5xx 错误的统一隐藏策略。
  - 证据:返回体直接包含 `details`；例如 `server/src/routes/mail.ts:1588`、`:1618` 将捕获的 `err.message` 放入 502 响应，而上游服务错误可包含原始响应内容。
  - 影响:已认证用户可能看到上游实现、内部状态、供应商响应内容，且结合脱敏缺口可能泄露凭证或内部地址。
  - 修复建议:区分内部诊断信息与公开错误详情，生产环境的 5xx 响应只返回稳定错误码和通用文案。

- [M25-04] P2 | 置信度 高 | server/src/db/logs.ts:203
  - 问题:审计日志写入失败被完全吞掉，没有重试、告警、指标或让高风险操作失败关闭。
  - 证据:`createLog()` 用整体 `try/catch` 包住实例推断和 `prisma.log.create()`，失败后仅执行 `console.error`，随后正常返回。
  - 影响:数据库瞬时故障、实例关联查询失败或内容异常时，支付、权限、实例和系统更新等操作仍可成功，但审计轨迹永久缺失。
  - 修复建议:为关键操作采用事务内审计或可靠 outbox，并对无法落库的审计事件产生可监控告警。

- [M25-05] P2 | 置信度 高 | server/src/lib/instance-audit.ts:235
  - 问题:连接解析器固定按 `ss` 的列布局解析，但采集命令会回退到列布局不同的 `netstat`。
  - 证据:解析器固定使用 `state: fields[1]`、`local: fields[4]`、`peer: fields[5]`；而 `buildConnectionAuditCommand()` 为 `(ss ... || netstat -tunap ...)`。`netstat` 的状态、Local Address、Foreign Address 分别通常位于第 6、4、5 列。
  - 影响:缺少 `ss` 的实例会得到错位的连接数据，监听端口统计失真，基于网络连接的安全规则也可能漏报。
  - 修复建议:识别输出来源并分别解析 `ss` 与 `netstat` 格式，无法识别的行应显式记录采集异常。

- [M25-06] P2 | 置信度 中 | server/src/routes/logs.ts:35
  - 问题:CSV 导出只处理逗号、引号和换行，没有中和以 `=`、`+`、`-`、`@` 开头的公式单元格。
  - 证据:`csvEscape()` 对不含 `",\n\r` 的文本直接返回；导出行包含 `username`、`content` 等可能承载外部或历史数据的字段。
  - 影响:管理员用 Excel 等软件打开包含恶意单元格的审计 CSV 时，可能触发公式执行、外部请求或数据外带。
  - 修复建议:对所有可变 CSV 单元格实施公式注入防护，再进行标准 CSV 转义。

- [M25-07] P2 | 置信度 中 | server/src/lib/origin-config.ts:8
  - 问题:CORS/WebSocket Origin 规范化未限制协议，也未拒绝序列化结果为 `null` 的不透明 Origin。
  - 证据:`normalizeOrigin()` 对任意可被 `new URL()` 解析的值直接返回 `.origin`；`file:`、`data:`、`javascript:` 等 URL 可产生字符串 `null`，随后进入允许列表。
  - 影响:错误配置上述 scheme 时，来自沙箱 iframe、本地文件等不透明来源的 `Origin: null` 请求可能被 CORS 和 WebSocket 校验共同放行。
  - 修复建议:只接受明确的 `http:`/`https:` Origin，并拒绝 `null`、包含凭证或非标准来源的配置值。
