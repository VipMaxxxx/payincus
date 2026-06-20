export type AuditSeverity = 'info' | 'low' | 'medium' | 'high'
export type AuditFindingTarget = 'process' | 'network' | 'startup' | 'capability'
export type AuditRuleTarget = 'process' | 'network' | 'startup'
export type AuditRuleMatchType = 'contains' | 'regex' | 'exact'
export type AuditRuleSource = 'builtin' | 'custom'

export interface AuditProcess {
  pid: number
  ppid: number | null
  user: string
  stat: string
  cpuPercent: number | null
  memoryPercent: number | null
  elapsed: string
  command: string
  args: string
  raw: string
  findings: string[]
}

export interface AuditConnection {
  protocol: string
  state: string
  local: string
  peer: string
  process: string | null
  pid: number | null
  raw: string
}

export interface AuditStartupItem {
  source: string
  command: string
  raw: string
  findings: string[]
}

export interface AuditFinding {
  id: string
  severity: AuditSeverity
  category: string
  title: string
  detail: string
  targetType: AuditFindingTarget
  ruleId?: string
  ruleName?: string
  ruleSource?: AuditRuleSource
  matchedText?: string
  recommendation?: string | null
  pid?: number
  evidence: string
  ignored?: boolean
  ignoreReason?: string | null
}

export interface AuditSummary {
  riskLevel: AuditSeverity
  processCount: number
  connectionCount: number
  listeningCount: number
  startupItemCount: number
  findingCount: number
}

export interface AuditRuleDefinition {
  id: string
  severity: AuditSeverity
  category: string
  name: string
  description?: string | null
  targetTypes: AuditRuleTarget[]
  matchType: AuditRuleMatchType
  patternText: string
  caseSensitive: boolean
  source: AuditRuleSource
  enabled: boolean
  recommendation?: string | null
}

export interface AuditIgnoreDefinition {
  id: number
  ruleId?: string | null
  targetType?: AuditFindingTarget | null
  matchText?: string | null
  reason?: string | null
  expiresAt?: Date | string | null
}

export const BUILTIN_AUDIT_RULES: AuditRuleDefinition[] = [
  {
    id: 'packet-tool-hping',
    severity: 'high',
    category: 'network-abuse',
    name: '疑似发包工具进程',
    description: '匹配常见的发包、构造数据包或压测类工具。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(hping[3]?|nping|mz|mausezahn|mzbench|pktgen|packit|nemesis|tcpreplay|scapy|flood|synflood|udpflood|icmpflood|httpflood|slowloris|goldeneye|hulk|xerxes)\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '请先确认进程归属、流量用途和客户业务背景，再决定是否手动处置。'
  },
  {
    id: 'mass-scan-tool',
    severity: 'high',
    category: 'network-abuse',
    name: '疑似大规模扫描工具',
    description: '匹配常见的公网大范围扫描或高频扫描工具。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(masscan|zmap|zdns|zgrab2?|naabu|rustscan|httpx|nuclei|fscan|kscan|gogo|goscan|scanrs|nmap)\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '请核实扫描是否经过授权，并结合网络连接、工单或客户说明判断。'
  },
  {
    id: 'flood-tool-name',
    severity: 'high',
    category: 'network-abuse',
    name: '疑似 Flood/DDoS 程序',
    description: '匹配常见 Flood、DDoS 工具名称或命令名称。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(syn[-_]?flood|udp[-_]?flood|http[-_]?flood|slowloris|goldeneye|hulk|xerxes|torshammer|ufonet|mhddos|ddosim|layer[47]|flooder|cc[-_]?attack|stress|hammer|python.*(ddos|flood|attack|hammer)|node.*(ddos|flood|attack))\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '建议按高风险处理。手动停止前请先保留进程参数和连接证据。'
  },
  {
    id: 'proxy-panel',
    severity: 'medium',
    category: 'proxy-panel',
    name: '疑似代理面板程序',
    description: '匹配常见代理面板或相关管理面板名称。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(3x-ui|x-ui|v2-ui|s-ui|h-ui|marzban|v2board|sspanel|xboard|trojan-panel|hiddify|nebula|alpine|sub-web|subconverter|bt-panel|aapanel|aa-panel)\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '请确认当前节点规则是否允许此类应用，并结合客户业务说明判断。'
  },
  {
    id: 'proxy-core',
    severity: 'medium',
    category: 'proxy-panel',
    name: '疑似代理核心进程',
    description: '匹配常见代理核心、转发核心或隧道类进程名称。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(xray|v2ray|sing-?box|trojan(-go|rs)?|hysteria2?|naive|brook|gost|ss-server|ss-rust|shadowsocks(-rust)?|tuic|juicity|clash(-meta)?|mihomo|reality|xtls|vless|vmess|frp[cs]?|nps|npc|chisel|ligolo(-ng)?|rathole|bore)\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '处置前请核对客户用途、节点政策和实际流量，避免误伤正常服务。'
  },
  {
    id: 'miner',
    severity: 'high',
    category: 'resource-abuse',
    name: '疑似挖矿进程',
    description: '匹配常见加密货币挖矿进程名称。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(xmrig|xmrig-proxy|xmr-stak|xmrigcc|cpuminer|minerd|ethminer|lolminer|nbminer|teamredminer|t-rex|gminer|bzminer|srbminer|wildrig|rigel|miniZ|SRBMiner|moneroocean)\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '请结合 CPU 占用、运行时间和服务条款人工确认，违规后再执行处置。'
  },
  {
    id: 'bruteforce',
    severity: 'medium',
    category: 'credential-attack',
    name: '疑似爆破/撞库工具',
    description: '匹配常见密码爆破、登录尝试或凭据攻击工具。',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    patternText: '\\b(hydra|thc-hydra|medusa|ncrack|patator|crowbar|brutespray|ffuf|gobuster|dirsearch|dirb|sshpass|brute)\\b',
    caseSensitive: false,
    source: 'builtin',
    enabled: true,
    recommendation: '请检查外连目标、登录尝试记录和客户说明，再决定是否手动处理。'
  }
]

function normalizeCommandText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseNumber(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseProcesses(output: string, limit = 300): AuditProcess[] {
  const rows: AuditProcess[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue
    const match = raw.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/)
    if (!match) continue

    const pid = Number(match[1])
    if (!Number.isInteger(pid)) continue
    const args = normalizeCommandText(match[9] || match[8] || '')
    rows.push({
      pid,
      ppid: parseNumber(match[2]),
      user: match[3],
      stat: match[4],
      cpuPercent: parseNumber(match[5]),
      memoryPercent: parseNumber(match[6]),
      elapsed: match[7],
      command: match[8],
      args,
      raw,
      findings: []
    })
    if (rows.length >= limit) break
  }
  return rows
}

function parsePidFromProcessColumn(value: string): number | null {
  const match = value.match(/\bpid=(\d+)/)
  if (!match) return null
  const pid = Number(match[1])
  return Number.isInteger(pid) ? pid : null
}

export function parseConnections(output: string, limit = 300): AuditConnection[] {
  const rows: AuditConnection[] = []
  for (const rawLine of output.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue
    const fields = raw.split(/\s+/)
    if (fields.length < 5) continue

    const processText = fields.length > 6 ? fields.slice(6).join(' ') : null
    rows.push({
      protocol: fields[0] || '',
      state: fields[1] || '',
      local: fields[4] || '',
      peer: fields[5] || '',
      process: processText,
      pid: processText ? parsePidFromProcessColumn(processText) : null,
      raw
    })
    if (rows.length >= limit) break
  }
  return rows
}

export function parseStartupItems(output: string, limit = 200): AuditStartupItem[] {
  const rows: AuditStartupItem[] = []
  let source = 'startup'
  for (const rawLine of output.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue
    const sourceMatch = raw.match(/^\[(.+)\]$/)
    if (sourceMatch) {
      source = sourceMatch[1]
      continue
    }
    rows.push({
      source,
      command: normalizeCommandText(raw),
      raw,
      findings: []
    })
    if (rows.length >= limit) break
  }
  return rows
}

function severityRank(severity: AuditSeverity): number {
  return { info: 0, low: 1, medium: 2, high: 3 }[severity]
}

function maxSeverity(items: AuditFinding[]): AuditSeverity {
  return items.reduce<AuditSeverity>((current, item) =>
    severityRank(item.severity) > severityRank(current) ? item.severity : current,
    items.length > 0 ? 'low' : 'info'
  )
}

function buildFindingId(prefix: string, index: number, ruleId: string): string {
  return `${prefix}-${index}-${ruleId}`
}

function findMatch(rule: AuditRuleDefinition, text: string): string | null {
  if (!rule.enabled) return null
  const patternText = rule.patternText.trim()
  if (!patternText) return null

  if (rule.matchType === 'regex') {
    try {
      const regex = new RegExp(patternText, rule.caseSensitive ? '' : 'i')
      const match = text.match(regex)
      return match?.[0] || null
    } catch {
      return null
    }
  }

  const haystack = rule.caseSensitive ? text : text.toLowerCase()
  const needle = rule.caseSensitive ? patternText : patternText.toLowerCase()
  if (rule.matchType === 'exact') {
    return haystack.trim() === needle.trim() ? patternText : null
  }
  return haystack.includes(needle) ? patternText : null
}

function isIgnoreActive(ignore: AuditIgnoreDefinition, now: Date): boolean {
  if (!ignore.expiresAt) return true
  const expiresAt = ignore.expiresAt instanceof Date ? ignore.expiresAt : new Date(ignore.expiresAt)
  return Number.isNaN(expiresAt.getTime()) || expiresAt > now
}

function applyIgnore(finding: AuditFinding, ignores: AuditIgnoreDefinition[], now: Date): AuditFinding {
  for (const ignore of ignores) {
    if (!isIgnoreActive(ignore, now)) continue
    if (ignore.ruleId && ignore.ruleId !== finding.ruleId) continue
    if (ignore.targetType && ignore.targetType !== finding.targetType) continue
    if (ignore.matchText) {
      const needle = ignore.matchText.toLowerCase()
      const text = `${finding.title} ${finding.detail} ${finding.evidence}`.toLowerCase()
      if (!text.includes(needle)) continue
    }
    return {
      ...finding,
      ignored: true,
      ignoreReason: ignore.reason || null
    }
  }
  return finding
}

function localizeFindingSubject(targetType: AuditFindingTarget, subject: string): string {
  if (targetType === 'startup') return `启动项 ${subject}`
  if (targetType === 'network') return `网络连接 ${subject}`
  return subject
}

function buildRuleFinding(params: {
  id: string
  rule: AuditRuleDefinition
  targetType: AuditFindingTarget
  pid?: number
  subject: string
  matchedText: string
  evidence: string
}): AuditFinding {
  return {
    id: params.id,
    severity: params.rule.severity,
    category: params.rule.category,
    title: params.rule.name,
    detail: `${localizeFindingSubject(params.targetType, params.subject)} 命中审查规则 ${params.rule.id}。`,
    targetType: params.targetType,
    ruleId: params.rule.id,
    ruleName: params.rule.name,
    ruleSource: params.rule.source,
    matchedText: params.matchedText,
    recommendation: params.rule.recommendation || null,
    pid: params.pid,
    evidence: params.evidence.slice(0, 800)
  }
}

export function analyzeAuditData(input: {
  processes: AuditProcess[]
  connections: AuditConnection[]
  startupItems: AuditStartupItem[]
  rules?: AuditRuleDefinition[]
  ignores?: AuditIgnoreDefinition[]
}): { findings: AuditFinding[]; summary: AuditSummary } {
  const findings: AuditFinding[] = []
  const now = new Date()
  const rules = (input.rules?.length ? input.rules : BUILTIN_AUDIT_RULES).filter(rule => rule.enabled)
  const ignores = input.ignores || []

  input.processes.forEach((process, index) => {
    const text = `${process.command} ${process.args}`
    for (const rule of rules.filter(rule => rule.targetTypes.includes('process'))) {
      const matchedText = findMatch(rule, text)
      if (!matchedText) continue
      process.findings.push(rule.name)
      findings.push(buildRuleFinding({
        id: buildFindingId('process', index, rule.id),
        rule,
        targetType: 'process',
        pid: process.pid,
        subject: `PID ${process.pid} (${process.command})`,
        matchedText,
        evidence: process.raw
      }))
    }
  })

  input.startupItems.forEach((item, index) => {
    for (const rule of rules.filter(rule => rule.targetTypes.includes('startup'))) {
      const matchedText = findMatch(rule, item.command)
      if (!matchedText) continue
      item.findings.push(rule.name)
      findings.push(buildRuleFinding({
        id: buildFindingId('startup', index, rule.id),
        rule,
        targetType: 'startup',
        subject: `来源 ${item.source}`,
        matchedText,
        evidence: item.raw
      }))
    }
  })

  input.connections.forEach((connection, index) => {
    for (const rule of rules.filter(rule => rule.targetTypes.includes('network'))) {
      const matchedText = findMatch(rule, connection.raw)
      if (!matchedText) continue
      findings.push(buildRuleFinding({
        id: buildFindingId('network', index, rule.id),
        rule,
        targetType: 'network',
        pid: connection.pid || undefined,
        subject: `${connection.protocol} ${connection.local} -> ${connection.peer}`,
        matchedText,
        evidence: connection.raw
      }))
    }
  })

  const udpConnections = input.connections.filter(row => /^udp/i.test(row.protocol)).length
  if (udpConnections >= 100) {
    findings.push({
      id: 'network-high-udp-connection-count',
      severity: 'medium',
      category: 'network-anomaly',
      title: 'UDP 连接数量偏高',
      detail: `本次扫描从 ss/netstat 返回 ${udpConnections} 条 UDP 连接记录，请结合业务用途判断是否异常。`,
      targetType: 'network',
      evidence: input.connections.filter(row => /^udp/i.test(row.protocol)).slice(0, 5).map(row => row.raw).join('\n')
    })
  }

  const highCpuProcesses = input.processes.filter(process => (process.cpuPercent ?? 0) >= 80)
  for (const process of highCpuProcesses.slice(0, 5)) {
    findings.push({
      id: `process-${process.pid}-high-cpu`,
      severity: 'low',
      category: 'resource-anomaly',
      title: 'CPU 占用偏高的进程',
      detail: `PID ${process.pid} 当前 CPU 占用为 ${process.cpuPercent}%。`,
      targetType: 'process',
      pid: process.pid,
      evidence: process.raw.slice(0, 500)
    })
  }

  const listeningCount = input.connections.filter(row => row.state.toUpperCase() === 'LISTEN').length
  const annotatedFindings = findings.map(finding => applyIgnore(finding, ignores, now))
  const activeFindings = annotatedFindings.filter(finding => !finding.ignored)

  return {
    findings: annotatedFindings.sort((a, b) => Number(a.ignored) - Number(b.ignored) || severityRank(b.severity) - severityRank(a.severity)),
    summary: {
      riskLevel: maxSeverity(activeFindings),
      processCount: input.processes.length,
      connectionCount: input.connections.length,
      listeningCount,
      startupItemCount: input.startupItems.length,
      findingCount: activeFindings.length
    }
  }
}

export function buildProcessAuditCommand(): string {
  return 'ps -eo pid,ppid,user,stat,pcpu,pmem,etime,comm,args --no-headers 2>/dev/null | head -n 300 || true'
}

export function buildConnectionAuditCommand(): string {
  return '(ss -H -tunap 2>/dev/null || netstat -tunap 2>/dev/null || true) | head -n 300'
}

export function buildStartupAuditCommand(): string {
  return [
    'printf "[systemd]\\n"',
    '(systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | head -n 80 || true)',
    'printf "[cron]\\n"',
    '(crontab -l 2>/dev/null || true)',
    'printf "[rc-local]\\n"',
    '(test -f /etc/rc.local && sed -n "1,120p" /etc/rc.local || true)',
    'printf "[supervisor]\\n"',
    '(command -v supervisorctl >/dev/null 2>&1 && supervisorctl status 2>/dev/null || true)',
    'printf "[pm2]\\n"',
    '(command -v pm2 >/dev/null 2>&1 && pm2 list --no-color 2>/dev/null || true)'
  ].join('; ')
}
