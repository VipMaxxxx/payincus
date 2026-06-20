<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import type { SshKey, SystemImage } from '@/types/api'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'

defineOptions({
  name: 'HostOpsTab'
})

interface Props {
  hostId: number
  hostName?: string
}

interface DiscoverManagedItem {
  incusName: string
  incusType: string
  incusStatus: string
  dbId: number
  dbStatus: string
  userId: number
}

interface DiscoverOrphanedItem {
  incusName: string
  incusType: string
  incusStatus: string
}

interface DiscoverMissingItem {
  dbId: number
  dbName: string
  incusId: string
  dbStatus: string
}

interface DiscoverResult {
  managed: DiscoverManagedItem[]
  orphaned: DiscoverOrphanedItem[]
  missing: DiscoverMissingItem[]
  summary: {
    totalIncus: number
    totalDb: number
    managedCount: number
    orphanedCount: number
    missingCount: number
  }
}

interface BaselineSyncResult {
  message: string
  resources: {
    cpuUsed: number
    memoryUsed: number
    diskUsed: number
  }
  instanceSync: {
    total: number
    synced: number
    ipChanged: number
  }
}

interface NetworkRepairRow {
  id: number
  name: string
  success: boolean
  statusChanged?: boolean
  oldStatus?: string
  newStatus?: string
  ipv4Changed?: boolean
  oldIpv4?: string | null
  newIpv4?: string | null
  ipv6Changed?: boolean
  oldIpv6?: string | null
  newIpv6?: string | null
  error?: string
}

interface NetworkRepairResult {
  message: string
  results: NetworkRepairRow[]
  summary: {
    total: number
    success: number
    failed: number
    changed: number
  }
}

interface InstanceOpsPreview {
  instanceId: number
  instanceName: string
  incusId: string
  instanceStatus: string
  hostName: string
  hostId: number
  imageAlias?: string | null
  canSync: boolean
  canRestart: boolean
  canForceRestart: boolean
  canRebuild: boolean
  canRecreate: boolean
  activeTask?: {
    id: number
    taskType: string
    status: string
  } | null
  risk: {
    status: string
    isStopped: boolean
    hasActiveTask: boolean
    suggestedAction: 'rebuild' | 'recreate' | 'sync' | 'restart' | 'none'
    notes: string[]
  }
}

interface InstanceOpsActionResult {
  success?: boolean
  message?: string
  taskId?: number
  status?: string
  statusChanged?: boolean
  from?: string
  to?: string
  currentStatus?: string
  ipv4Changed?: boolean
  oldIpv4?: string | null
  newIpv4?: string | null
  ipv6Changed?: boolean
  oldIpv6?: string | null
  newIpv6?: string | null
}

interface AvailableInitCommand {
  id: number
  name: string
  commandLineCount: number
  distros: string[]
  description: string | null
}

type AuditSeverity = 'info' | 'low' | 'medium' | 'high'

interface InstanceAuditFinding {
  id: string
  severity: AuditSeverity
  category: string
  title: string
  detail: string
  targetType: 'process' | 'network' | 'startup' | 'capability'
  ruleId?: string
  ruleName?: string
  ruleSource?: 'builtin' | 'custom'
  matchedText?: string
  recommendation?: string | null
  pid?: number
  evidence: string
  ignored?: boolean
  ignoreReason?: string | null
}

interface InstanceAuditProcess {
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

interface InstanceAuditConnection {
  protocol: string
  state: string
  local: string
  peer: string
  process: string | null
  pid: number | null
  raw: string
}

interface InstanceAuditStartupItem {
  source: string
  command: string
  raw: string
  findings: string[]
}

interface InstanceAuditResult {
  success: boolean
  scanId: number
  scannedAt: string
  capability: string
  instance: {
    id: number
    name: string
    incusId: string
    type: string
    status: string
  }
  summary: {
    riskLevel: AuditSeverity
    processCount: number
    connectionCount: number
    listeningCount: number
    startupItemCount: number
    findingCount: number
  }
  ignoredCount?: number
  rules?: InstanceAuditRule[]
  findings: InstanceAuditFinding[]
  processes: InstanceAuditProcess[]
  connections: InstanceAuditConnection[]
  startupItems: InstanceAuditStartupItem[]
  stderr?: string[]
}

interface InstanceAuditRule {
  id: string | number
  ruleId?: string
  source: 'builtin' | 'custom'
  scope?: 'builtin' | 'global' | 'host'
  readOnly?: boolean
  hostId?: number | null
  overridden?: boolean
  overrideId?: number | null
  originalName?: string | null
  originalSeverity?: AuditSeverity
  originalCategory?: string | null
  originalTargetTypes?: Array<'process' | 'network' | 'startup'>
  originalMatchType?: 'contains' | 'regex' | 'exact'
  originalPattern?: string | null
  originalCaseSensitive?: boolean
  originalRecommendation?: string | null
  name: string
  description?: string | null
  severity: AuditSeverity
  category: string
  targetTypes: Array<'process' | 'network' | 'startup'>
  matchType: 'contains' | 'regex' | 'exact'
  pattern: string
  caseSensitive: boolean
  recommendation?: string | null
  enabled: boolean
}

interface AuditRuleTemplate {
  name: string
  severity: AuditSeverity
  category: string
  targetTypes: Array<'process' | 'network' | 'startup'>
  matchType: 'contains' | 'regex' | 'exact'
  pattern: string
  recommendation: string
}

interface InstanceAuditIgnore {
  id: number
  ruleId?: string | null
  targetType?: string | null
  matchText?: string | null
  scope: string
  reason?: string | null
  enabled: boolean
  expiresAt?: string | null
}

interface InstanceAuditHistory {
  scans: Array<any>
  actions: Array<any>
}

const props = defineProps<Props>()

const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()

const activeOpsMenu = ref<'actions' | 'audit'>('actions')
const loadingAction = ref<'discover' | 'baseline' | 'network' | 'preview' | 'instanceSync' | 'instanceRestart' | 'instanceDanger' | 'auditScan' | 'auditKill' | ''>('')
const lastAction = ref<'discover' | 'baseline' | 'network' | 'preview' | 'instanceSync' | 'instanceRestart' | 'instanceDanger' | 'auditScan' | 'auditKill' | ''>('')
const lastRunAt = ref<string>('')

const discoverResult = ref<DiscoverResult | null>(null)
const baselineResult = ref<BaselineSyncResult | null>(null)
const networkResult = ref<NetworkRepairResult | null>(null)
const previewResult = ref<InstanceOpsPreview | null>(null)
const latestInstanceActionResult = ref<InstanceOpsActionResult | null>(null)
const auditResult = ref<InstanceAuditResult | null>(null)
const auditPanel = ref<'scan' | 'rules' | 'whitelist' | 'history'>('scan')
const auditRules = ref<InstanceAuditRule[]>([])
const auditIgnores = ref<InstanceAuditIgnore[]>([])
const auditHistory = ref<InstanceAuditHistory>({ scans: [], actions: [] })
const loadingAuditMeta = ref(false)
const expandedAuditFindingIds = ref<string[]>([])

const selectedManagedDbId = ref<number | null>(null)
const selectedManaged = computed(() => {
  if (!discoverResult.value || selectedManagedDbId.value === null) return null
  return discoverResult.value.managed.find(item => item.dbId === selectedManagedDbId.value) || null
})

const dangerousAction = ref<'rebuild' | 'recreate'>('recreate')
const selectedImageId = ref<number | null>(null)
const selectedSshKeyId = ref<number | null>(null)
const selectedCustomInitCommandIds = ref<number[]>([])
const confirmationText = ref('')
const riskAccepted = ref(false)
const selectedAuditPid = ref<number | null>(null)
const selectedAuditProcess = ref<InstanceAuditProcess | null>(null)
const auditSignal = ref<'TERM' | 'KILL'>('TERM')
const auditReason = ref('')
const auditConfirmationText = ref('')
const auditRuleForm = ref({
  id: null as number | null,
  builtinRuleId: '' as string,
  scope: 'host' as 'host' | 'global',
  name: '',
  severity: 'medium' as AuditSeverity,
  category: 'custom',
  targetTypes: ['process'] as Array<'process' | 'network' | 'startup'>,
  matchType: 'contains' as 'contains' | 'regex' | 'exact',
  pattern: '',
  caseSensitive: false,
  recommendation: '',
  enabled: true
})
const ignoreForm = ref({
  scope: 'instance' as 'instance' | 'host',
  ruleId: '',
  targetType: '',
  matchText: '',
  reason: '',
  expiresInDays: 30
})
const auditRuleTemplates: AuditRuleTemplate[] = [
  {
    name: '疑似代理核心进程',
    severity: 'medium',
    category: '代理/面板',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    pattern: '\\b(xray|v2ray|sing-box|trojan|hysteria2?|shadowsocks|gost)\\b',
    recommendation: '请结合客户用途、节点政策和实际流量人工确认。'
  },
  {
    name: '疑似挖矿进程',
    severity: 'high',
    category: '资源滥用',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    pattern: '\\b(xmrig|xmr-stak|cpuminer|minerd|ethminer|lolminer|nbminer)\\b',
    recommendation: '请核对 CPU 占用和运行时间，确认违规后再处置。'
  },
  {
    name: '疑似发包或扫描工具',
    severity: 'high',
    category: '网络滥用',
    targetTypes: ['process', 'startup'],
    matchType: 'regex',
    pattern: '\\b(hping3?|nping|masscan|zmap|udp[-_]?flood|syn[-_]?flood)\\b',
    recommendation: '请保留进程参数和连接证据，并核实是否有授权测试场景。'
  },
  {
    name: '命中特定关键词',
    severity: 'medium',
    category: '自定义',
    targetTypes: ['process'],
    matchType: 'contains',
    pattern: '请替换为需要匹配的关键词',
    recommendation: '请结合实例用途和业务背景人工确认。'
  }
]

// 镜像下拉数据
const availableImages = ref<SystemImage[]>([])
const loadingImages = ref(false)
const availableSshKeys = ref<SshKey[]>([])
const loadingSshKeys = ref(false)
const availableInitCommands = ref<AvailableInitCommand[]>([])
const loadingInitCommands = ref(false)

// 二次确认弹窗
const showDangerConfirmModal = ref(false)
const dangerConfirmStep = ref(1) // 1 = 第一次确认, 2 = 第二次确认

const hasResult = computed(() => {
  return !!discoverResult.value || !!baselineResult.value || !!networkResult.value || !!previewResult.value || !!latestInstanceActionResult.value
})

const confirmationExpectedText = computed(() => previewResult.value?.incusId || '')

// 当前选中镜像的 remoteAlias
const selectedImage = computed(() => {
  if (!selectedImageId.value) return null
  return availableImages.value.find(img => img.id === selectedImageId.value) || null
})

const selectedImageDistro = computed(() => {
  const alias = selectedImage.value?.remoteAlias || ''
  if (!alias) return ''
  return getImageDistroFromAlias(alias)
})

const selectedImageAlias = computed(() => {
  return selectedImage.value?.remoteAlias || ''
})

const isDangerFormValid = computed(() => {
  if (!previewResult.value) return false
  if (!selectedImageId.value) return false
  if (!riskAccepted.value) return false
  return confirmationText.value.trim() === confirmationExpectedText.value
})

type OpsActionKey = 'discover' | 'baseline' | 'network' | 'preview' | 'instanceSync' | 'instanceRestart' | 'instanceDanger' | 'auditScan' | 'auditKill'

// 精简镜像名称展示：只显示系统名，不显示 remoteAlias
function simplifyImageLabel(image: SystemImage): string {
  // 优先使用 name 字段
  const raw = (image.name || image.remoteAlias || '').trim()
  if (!raw) return `Image #${image.id}`
  // 去除 remoteAlias 格式中的路径前缀（如 images:debian/12/cloud → Debian 12）
  return raw
    .replace(/\s*\(.*?\)\s*$/, '') // 去掉括号内容（如 "(images:debian/12/cloud)"）
    .trim()
}

// 实例类型中文映射
function localizeType(type: string): string {
  if (type === 'container') return '容器'
  if (type === 'virtual-machine') return '虚拟机'
  return type
}

// 实例状态中文映射
function localizeStatus(status: string): string {
  const map: Record<string, string> = {
    Running: '运行中',
    Stopped: '已停止',
    Frozen: '已冻结',
    Error: '异常',
    running: '运行中',
    stopped: '已停止',
    suspended: '已封停',
    creating: '创建中',
    error: '异常',
    deleted: '已删除',
  }
  return map[status] || status
}

// 建议动作中文映射
function localizeSuggestedAction(action: string): string {
  const map: Record<string, string> = {
    sync: '同步实例',
    restart: '重启实例',
    rebuild: '重装实例',
    recreate: '重建实例',
    none: '无需操作',
  }
  return map[action] || action
}

function touchLastRun(action: OpsActionKey) {
  lastAction.value = action
  lastRunAt.value = new Date().toLocaleString()
}

function resetDangerState() {
  dangerousAction.value = 'recreate'
  selectedImageId.value = null
  selectedSshKeyId.value = null
  selectedCustomInitCommandIds.value = []
  confirmationText.value = ''
  riskAccepted.value = false
  showDangerConfirmModal.value = false
  dangerConfirmStep.value = 1
}

function getImageDistroFromAlias(imageAlias: string): string {
  const alias = imageAlias.toLowerCase()

  if (alias.includes('ubuntu')) return 'ubuntu'
  if (alias.includes('debian') || alias.includes('kali')) return 'debian'
  if (alias.includes('alpine')) return 'alpine'
  if (alias.includes('arch')) return 'arch'
  if (alias.includes('opensuse') || alias.includes('suse') || alias.includes('tumbleweed') || alias.includes('leap')) return 'suse'
  if (alias.includes('alma') || alias.includes('rocky') || alias.includes('oracle') || alias.includes('centos') || alias.includes('rhel') || alias.includes('fedora')) return 'rhel'

  return 'other'
}

function toggleInitCommand(cmdId: number): void {
  const next = [...selectedCustomInitCommandIds.value]
  const index = next.indexOf(cmdId)
  if (index >= 0) next.splice(index, 1)
  else next.push(cmdId)
  selectedCustomInitCommandIds.value = next
}

function getDistroName(distro: string): string {
  const key = `extensions.initCommands.distroNames.${distro}`
  const translated = t(key)
  return translated !== key ? translated : distro
}

function formatValue(value: string | null | undefined) {
  return value || '-'
}

function resultTitle() {
  if (lastAction.value === 'discover') return t('admin.hosts.ops.resultInventory')
  if (lastAction.value === 'baseline') return t('admin.hosts.ops.resultBaseline')
  if (lastAction.value === 'network') return t('admin.hosts.ops.resultNetwork')
  if (lastAction.value === 'preview') return t('admin.hosts.ops.resultPreview')
  if (lastAction.value === 'instanceSync') return t('admin.hosts.ops.resultInstanceSync')
  if (lastAction.value === 'instanceRestart') return t('admin.hosts.ops.resultInstanceRestart')
  if (lastAction.value === 'instanceDanger') return t('admin.hosts.ops.resultDanger')
  if (lastAction.value === 'auditScan') return '实例审查结果'
  if (lastAction.value === 'auditKill') return '手动处置结果'
  return t('admin.hosts.ops.sectionReport')
}

function localizeSeverity(severity: AuditSeverity): string {
  const map: Record<AuditSeverity, string> = {
    info: '信息',
    low: '低',
    medium: '中',
    high: '高'
  }
  return map[severity] || severity
}

function severityClass(severity: AuditSeverity): string {
  if (severity === 'high') return 'text-red-500'
  if (severity === 'medium') return 'text-amber-500'
  if (severity === 'low') return 'text-blue-500'
  return 'text-themed-muted'
}

function localizeRuleSource(source?: string): string {
  if (source === 'builtin') return '系统内置'
  if (source === 'custom') return '自定义'
  return '-'
}

function localizeRuleScope(scope?: string): string {
  if (scope === 'global') return '管理员全局'
  if (scope === 'host') return '当前节点'
  if (scope === 'builtin') return '系统内置'
  if (scope === 'instance') return '当前实例'
  return scope || '-'
}

function localizeAuditCategory(category?: string): string {
  const map: Record<string, string> = {
    'network-abuse': '网络滥用',
    'proxy-panel': '代理/面板',
    'resource-abuse': '资源滥用',
    'credential-attack': '凭据攻击',
    'network-anomaly': '网络异常',
    'resource-anomaly': '资源异常',
    custom: '自定义'
  }
  return category ? (map[category] || category) : '-'
}

function localizeAuditMatchType(matchType?: string): string {
  if (matchType === 'contains') return '包含关键词'
  if (matchType === 'regex') return '正则表达式'
  if (matchType === 'exact') return '精确匹配'
  return matchType || '-'
}

function localizeAuditTarget(target?: string | null): string {
  if (target === 'process') return '进程'
  if (target === 'network') return '网络连接'
  if (target === 'startup') return '启动项'
  if (target === 'capability') return '执行能力'
  return target || '全部'
}

function localizeAuditTargets(targets?: string[]): string {
  if (!targets?.length) return '-'
  return targets.map(target => localizeAuditTarget(target)).join('、')
}

const legacyFindingTextMap: Record<string, string> = {
  'Packet generation tool detected': '疑似发包工具进程',
  'Mass scanning tool detected': '疑似大规模扫描工具',
  'Flood program name detected': '疑似 Flood/DDoS 程序',
  'Proxy or panel process detected': '疑似代理面板程序',
  'Proxy core process detected': '疑似代理核心进程',
  'Mining process detected': '疑似挖矿进程',
  'Credential attack tool detected': '疑似爆破/撞库工具',
  'High UDP connection count': 'UDP 连接数量偏高',
  'High CPU process': 'CPU 占用偏高的进程',
  'Confirm the process owner and traffic purpose before taking manual action.': '请先确认进程归属、流量用途和客户业务背景，再决定是否手动处置。',
  'Review whether the scan is authorized. Check network connections and customer intent.': '请核实扫描是否经过授权，并结合网络连接、工单或客户说明判断。',
  'Treat as high risk. Capture evidence before any manual process stop.': '建议按高风险处理。手动停止前请先保留进程参数和连接证据。',
  'Confirm whether the node policy allows this application.': '请确认当前节点规则是否允许此类应用，并结合客户业务说明判断。',
  'Check the customer use case and host policy before manual disposal.': '处置前请核对客户用途、节点政策和实际流量，避免误伤正常服务。',
  'Review CPU usage and suspend policy manually if the behavior violates terms.': '请结合 CPU 占用、运行时间和服务条款人工确认，违规后再执行处置。',
  'Check outbound connections and account activity before taking manual action.': '请检查外连目标、登录尝试记录和客户说明，再决定是否手动处理。'
}

function localizeAuditText(text?: string | null): string {
  if (!text) return '-'
  return legacyFindingTextMap[text] || text
}

function localizeFindingDetail(detail?: string | null): string {
  if (!detail) return '-'
  const ruleMatch = detail.match(/^(.+) matched audit rule (.+)\.$/)
  if (ruleMatch) {
    const subject = ruleMatch[1]
      .replace(/^Startup item from /, '启动项来源 ')
      .replace(/^([A-Z]+ .+ -> .+)$/, '网络连接 $1')
    return `${subject} 命中审查规则 ${ruleMatch[2]}。`
  }
  const udpMatch = detail.match(/^(\d+) UDP rows were returned by ss\/netstat during the scan\.$/)
  if (udpMatch) return `本次扫描从 ss/netstat 返回 ${udpMatch[1]} 条 UDP 连接记录，请结合业务用途判断是否异常。`
  const cpuMatch = detail.match(/^PID (\d+) is using ([\d.]+)% CPU\.$/)
  if (cpuMatch) return `PID ${cpuMatch[1]} 当前 CPU 占用为 ${cpuMatch[2]}%。`
  return detail
}

function localizeProcessFindings(findings: string[]): string {
  return findings.map(item => localizeAuditText(item)).join('、')
}

function localizeAuditStatus(status?: string): string {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  return status || '-'
}

function localizeAuditActionType(actionType?: string): string {
  if (actionType === 'kill_process') return '停止进程'
  return actionType || '-'
}

function localizeAuditActionResult(result?: string): string {
  if (result === 'success') return '成功'
  if (result === 'failed') return '失败'
  return result || '-'
}

function localizeAuditSignal(signal?: string | null): string {
  if (signal === 'TERM') return '安全停止（TERM）'
  if (signal === 'KILL') return '强制停止（KILL）'
  return signal || '-'
}

function resetAuditRuleForm() {
  auditRuleForm.value = {
    id: null,
    builtinRuleId: '',
    scope: 'host',
    name: '',
    severity: 'medium',
    category: 'custom',
    targetTypes: ['process'],
    matchType: 'contains',
    pattern: '',
    caseSensitive: false,
    recommendation: '',
    enabled: true
  }
}

function fillAuditRuleForm(params: {
  id?: number | null
  builtinRuleId?: string
  scope?: 'host' | 'global'
  name: string
  severity: AuditSeverity
  category: string
  targetTypes: Array<'process' | 'network' | 'startup'>
  matchType: 'contains' | 'regex' | 'exact'
  pattern: string
  caseSensitive?: boolean
  recommendation?: string | null
  enabled?: boolean
}) {
  auditRuleForm.value = {
    id: params.id ?? null,
    builtinRuleId: params.builtinRuleId || '',
    scope: params.scope || 'host',
    name: localizeAuditText(params.name),
    severity: params.severity,
    category: params.category ? localizeAuditCategory(params.category) : '自定义',
    targetTypes: [...params.targetTypes],
    matchType: params.matchType,
    pattern: params.pattern,
    caseSensitive: Boolean(params.caseSensitive),
    recommendation: params.recommendation ? localizeAuditText(params.recommendation) : '',
    enabled: params.enabled ?? true
  }
  auditPanel.value = 'rules'
}

function editAuditRule(rule: InstanceAuditRule) {
  if (rule.readOnly || rule.source !== 'custom') return
  fillAuditRuleForm({
    id: Number(rule.id),
    scope: rule.scope === 'global' ? 'global' : 'host',
    name: rule.name,
    severity: rule.severity,
    category: rule.category,
    targetTypes: [...rule.targetTypes],
    matchType: rule.matchType,
    pattern: rule.pattern,
    caseSensitive: rule.caseSensitive,
    recommendation: rule.recommendation || '',
    enabled: rule.enabled
  })
}

function editBuiltinRuleOverride(rule: InstanceAuditRule) {
  if (rule.source !== 'builtin') return
  fillAuditRuleForm({
    builtinRuleId: String(rule.id),
    scope: 'host',
    name: localizeAuditText(rule.name),
    severity: rule.severity,
    category: rule.category,
    targetTypes: [...rule.targetTypes],
    matchType: rule.matchType,
    pattern: rule.pattern,
    caseSensitive: rule.caseSensitive,
    recommendation: rule.recommendation || '',
    enabled: rule.enabled
  })
  toast.success('已载入本节点覆盖配置，保存后只影响当前节点')
}

function createRuleFromExisting(rule: InstanceAuditRule) {
  fillAuditRuleForm({
    name: localizeAuditText(rule.name),
    severity: rule.severity,
    category: rule.category,
    targetTypes: [...rule.targetTypes],
    matchType: rule.matchType,
    pattern: rule.pattern,
    caseSensitive: rule.caseSensitive,
    recommendation: rule.recommendation || '',
    enabled: true
  })
  toast.success('已填入规则编辑表单，调整后可另存为自定义规则')
}

async function resetBuiltinRuleOverride(rule: InstanceAuditRule) {
  if (!props.hostId || rule.source !== 'builtin') return
  loadingAuditMeta.value = true
  try {
    await api.hosts.opsAuditResetBuiltinRule(props.hostId, String(rule.id))
    toast.success('已恢复系统默认规则')
    if (auditRuleForm.value.builtinRuleId === String(rule.id)) resetAuditRuleForm()
    await loadAuditRules()
  } catch (err: any) {
    toast.error('恢复系统默认失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

function applyAuditRuleTemplate(template: AuditRuleTemplate) {
  fillAuditRuleForm({
    name: template.name,
    severity: template.severity,
    category: template.category,
    targetTypes: [...template.targetTypes],
    matchType: template.matchType,
    pattern: template.pattern,
    recommendation: template.recommendation,
    enabled: true
  })
}

function isAuditEvidenceExpanded(id: string): boolean {
  return expandedAuditFindingIds.value.includes(id)
}

function toggleAuditEvidence(id: string) {
  const next = new Set(expandedAuditFindingIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedAuditFindingIds.value = Array.from(next)
}

function toggleRuleTarget(target: 'process' | 'network' | 'startup') {
  const next = [...auditRuleForm.value.targetTypes]
  const index = next.indexOf(target)
  if (index >= 0) next.splice(index, 1)
  else next.push(target)
  auditRuleForm.value.targetTypes = next.length ? next : ['process']
}

function resetAuditActionState() {
  selectedAuditPid.value = null
  selectedAuditProcess.value = null
  auditSignal.value = 'TERM'
  auditReason.value = ''
  auditConfirmationText.value = ''
}

function selectAuditProcess(process: InstanceAuditProcess) {
  selectedAuditPid.value = process.pid
  selectedAuditProcess.value = process
  auditConfirmationText.value = ''
}

async function loadImages() {
  if (!props.hostId) return
  loadingImages.value = true
  try {
    const res = await api.images.getSystemImages(undefined, undefined, props.hostId)
    availableImages.value = res.images.filter(img => !img.hidden)
    // 若已有 previewResult 的 imageAlias，尝试自动匹配
    if (previewResult.value?.imageAlias && !selectedImageId.value) {
      const matched = availableImages.value.find(img => img.remoteAlias === previewResult.value!.imageAlias)
      if (matched) selectedImageId.value = matched.id
    }
  } catch {
    // 静默处理，用户可手动选择
  } finally {
    loadingImages.value = false
  }
}

async function loadOperationSshKeys() {
  if (!props.hostId || !selectedManaged.value) {
    availableSshKeys.value = []
    return
  }
  loadingSshKeys.value = true
  try {
    const res = await api.hosts.opsInstanceSshKeys(props.hostId, selectedManaged.value.dbId)
    availableSshKeys.value = res.keys || []
    if (selectedSshKeyId.value && !availableSshKeys.value.some(key => key.id === selectedSshKeyId.value)) {
      selectedSshKeyId.value = null
    }
  } catch {
    availableSshKeys.value = []
  } finally {
    loadingSshKeys.value = false
  }
}

async function loadOperationInitCommands() {
  if (!props.hostId || !selectedManaged.value || !selectedImageDistro.value) {
    availableInitCommands.value = []
    selectedCustomInitCommandIds.value = []
    return
  }
  loadingInitCommands.value = true
  try {
    const res = await api.hosts.opsInstanceInitCommands(props.hostId, selectedManaged.value.dbId, selectedImageDistro.value)
    availableInitCommands.value = res.commands || []
    const availableIds = new Set(availableInitCommands.value.map(cmd => cmd.id))
    selectedCustomInitCommandIds.value = selectedCustomInitCommandIds.value.filter(id => availableIds.has(id))
  } catch {
    availableInitCommands.value = []
    selectedCustomInitCommandIds.value = []
  } finally {
    loadingInitCommands.value = false
  }
}

watch(selectedImageId, () => {
  if (!previewResult.value) return
  void loadOperationInitCommands()
})

watch(selectedManagedDbId, () => {
  auditResult.value = null
  expandedAuditFindingIds.value = []
  resetAuditActionState()
  if (auditPanel.value === 'whitelist') void loadAuditIgnores()
  if (auditPanel.value === 'history') void loadAuditHistory()
})

watch(auditPanel, (panel) => {
  if (panel === 'rules') void loadAuditRules()
  if (panel === 'whitelist') void loadAuditIgnores()
  if (panel === 'history') void loadAuditHistory()
})

watch(activeOpsMenu, (menu) => {
  if (menu === 'audit' && auditPanel.value === 'rules') void loadAuditRules()
})

async function runDiscover() {
  if (!props.hostId || loadingAction.value) return
  loadingAction.value = 'discover'
  try {
    const result = await api.hosts.opsDiscover(props.hostId)
    discoverResult.value = result
    if (!selectedManagedDbId.value && result.managed.length > 0) {
      selectedManagedDbId.value = result.managed[0].dbId
    }
    touchLastRun('discover')
    toast.success(t('admin.hosts.ops.runSuccess'))
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function runBaselineSync() {
  if (!props.hostId || loadingAction.value) return
  loadingAction.value = 'baseline'
  try {
    baselineResult.value = await api.hosts.opsBaselineSync(props.hostId)
    touchLastRun('baseline')
    toast.success(t('admin.hosts.ops.runSuccess'))
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function runNetworkRepair() {
  if (!props.hostId || loadingAction.value) return
  loadingAction.value = 'network'
  try {
    networkResult.value = await api.hosts.opsNetworkRepair(props.hostId)
    touchLastRun('network')
    toast.success(t('admin.hosts.ops.runSuccess'))
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function refreshLastResult() {
  if (lastAction.value === 'discover') await runDiscover()
  else if (lastAction.value === 'baseline') await runBaselineSync()
  else if (lastAction.value === 'network') await runNetworkRepair()
  else if (lastAction.value === 'preview') await loadPreview()
  else if (lastAction.value === 'auditScan') await runAuditScan()
}

async function loadPreview() {
  if (!props.hostId || !selectedManaged.value || loadingAction.value) return
  loadingAction.value = 'preview'
  try {
    previewResult.value = await api.hosts.opsInstancePreview(props.hostId, selectedManaged.value.dbId)
    latestInstanceActionResult.value = null
    resetDangerState()
    touchLastRun('preview')
    // 加载当前节点可用镜像
    await loadImages()
    await Promise.all([loadOperationSshKeys(), loadOperationInitCommands()])
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function runInstanceSync() {
  if (!props.hostId || !selectedManaged.value || loadingAction.value) return
  loadingAction.value = 'instanceSync'
  try {
    latestInstanceActionResult.value = await api.hosts.opsInstanceSync(props.hostId, selectedManaged.value.dbId)
    touchLastRun('instanceSync')
    toast.success(t('admin.hosts.ops.runSuccess'))
    loadingAction.value = ''
    await loadPreview()
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function runInstanceRestart(force: boolean) {
  if (!props.hostId || !selectedManaged.value || loadingAction.value) return
  loadingAction.value = 'instanceRestart'
  try {
    latestInstanceActionResult.value = await api.hosts.opsInstanceRestart(props.hostId, selectedManaged.value.dbId, force)
    touchLastRun('instanceRestart')
    toast.success(t('admin.hosts.ops.runSuccess'))
    loadingAction.value = ''
    await loadPreview()
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

// 第一步：点击"执行高风险动作"弹出二次确认弹窗
function openDangerConfirm() {
  if (!isDangerFormValid.value) return
  dangerConfirmStep.value = 1
  showDangerConfirmModal.value = true
}

// 第二步：第一次确认后进入第二次确认
function advanceDangerConfirm() {
  dangerConfirmStep.value = 2
}

// 第三步：第二次确认后真正执行
async function executeDangerConfirmed() {
  showDangerConfirmModal.value = false
  dangerConfirmStep.value = 1
  await runDangerousAction()
}

function cancelDangerConfirm() {
  showDangerConfirmModal.value = false
  dangerConfirmStep.value = 1
}

async function runDangerousAction() {
  if (!props.hostId || !selectedManaged.value || !previewResult.value || loadingAction.value || !isDangerFormValid.value) return
  loadingAction.value = 'instanceDanger'
  try {
    latestInstanceActionResult.value = await api.hosts.opsInstanceDangerousAction(props.hostId, selectedManaged.value.dbId, {
      action: dangerousAction.value,
      imageAlias: selectedImageAlias.value,
      sshKeyId: selectedSshKeyId.value || undefined,
      customInitCommandIds: selectedCustomInitCommandIds.value.length > 0 ? selectedCustomInitCommandIds.value : undefined,
      confirmationText: confirmationText.value.trim(),
      riskConfirmed: riskAccepted.value
    })
    touchLastRun('instanceDanger')
    toast.success(t('admin.hosts.ops.runSuccess'))
    resetDangerState()
    loadingAction.value = ''
    await runDiscover()
    await loadPreview()
  } catch (err: any) {
    toast.error(t('admin.hosts.ops.runFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function ensureInventoryForAudit() {
  if (discoverResult.value) return
  await runDiscover()
}

async function loadAuditRules() {
  if (!props.hostId) return
  loadingAuditMeta.value = true
  try {
    const res = await api.hosts.opsAuditRules(props.hostId)
    auditRules.value = [...(res.builtin || []), ...(res.custom || [])]
  } catch (err: any) {
    toast.error('加载审查规则失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function saveAuditRule() {
  if (!props.hostId || !auditRuleForm.value.name.trim() || !auditRuleForm.value.pattern.trim()) {
    toast.error('请填写规则名称和匹配内容')
    return
  }
  loadingAuditMeta.value = true
  const payload = {
    scope: auditRuleForm.value.builtinRuleId ? 'host' : auditRuleForm.value.scope,
    name: auditRuleForm.value.name.trim(),
    severity: auditRuleForm.value.severity,
    category: auditRuleForm.value.category.trim() || 'custom',
    targetTypes: auditRuleForm.value.targetTypes,
    matchType: auditRuleForm.value.matchType,
    pattern: auditRuleForm.value.pattern.trim(),
    caseSensitive: auditRuleForm.value.caseSensitive,
    recommendation: auditRuleForm.value.recommendation.trim() || undefined,
    enabled: auditRuleForm.value.enabled
  }
  try {
    if (auditRuleForm.value.builtinRuleId) await api.hosts.opsAuditUpdateBuiltinRule(props.hostId, auditRuleForm.value.builtinRuleId, payload)
    else if (auditRuleForm.value.id) await api.hosts.opsAuditUpdateRule(props.hostId, auditRuleForm.value.id, payload)
    else await api.hosts.opsAuditCreateRule(props.hostId, payload)
    toast.success(auditRuleForm.value.builtinRuleId ? '本节点内置规则配置已保存' : '审查规则已保存')
    resetAuditRuleForm()
    await loadAuditRules()
  } catch (err: any) {
    toast.error('保存审查规则失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function deleteAuditRule(rule: InstanceAuditRule) {
  if (!props.hostId || rule.readOnly || rule.source !== 'custom') return
  loadingAuditMeta.value = true
  try {
    await api.hosts.opsAuditDeleteRule(props.hostId, Number(rule.id))
    toast.success('审查规则已删除')
    if (auditRuleForm.value.id === Number(rule.id)) resetAuditRuleForm()
    await loadAuditRules()
  } catch (err: any) {
    toast.error('删除审查规则失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function loadAuditIgnores() {
  if (!props.hostId) return
  loadingAuditMeta.value = true
  try {
    const res = await api.hosts.opsAuditIgnores(props.hostId, selectedManaged.value ? { instanceId: selectedManaged.value.dbId } : undefined)
    auditIgnores.value = res.ignores || []
  } catch (err: any) {
    toast.error('加载白名单失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function addIgnoreFromFinding(finding?: InstanceAuditFinding) {
  if (finding) {
    ignoreForm.value.ruleId = finding.ruleId || ''
    ignoreForm.value.targetType = finding.targetType || ''
    ignoreForm.value.matchText = finding.matchedText || ''
    ignoreForm.value.reason = finding.ignoreReason || ''
    auditPanel.value = 'whitelist'
  }
}

async function saveAuditIgnore() {
  if (!props.hostId) return
  const scope = ignoreForm.value.scope
  if (scope === 'instance' && !selectedManaged.value) {
    toast.error('请先选择实例')
    return
  }
  if (!ignoreForm.value.ruleId.trim() && !ignoreForm.value.matchText.trim()) {
    toast.error('请填写规则编号或匹配文本')
    return
  }
  loadingAuditMeta.value = true
  try {
    await api.hosts.opsAuditCreateIgnore(props.hostId, {
      scope,
      instanceId: scope === 'instance' ? selectedManaged.value?.dbId : undefined,
      ruleId: ignoreForm.value.ruleId.trim() || undefined,
      targetType: ignoreForm.value.targetType || undefined,
      matchText: ignoreForm.value.matchText.trim() || undefined,
      reason: ignoreForm.value.reason.trim() || undefined,
      expiresInDays: ignoreForm.value.expiresInDays || undefined
    })
    toast.success('白名单已保存')
    ignoreForm.value = { scope: 'instance', ruleId: '', targetType: '', matchText: '', reason: '', expiresInDays: 30 }
    await loadAuditIgnores()
  } catch (err: any) {
    toast.error('保存白名单失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function deleteAuditIgnore(ignore: InstanceAuditIgnore) {
  if (!props.hostId) return
  loadingAuditMeta.value = true
  try {
    await api.hosts.opsAuditDeleteIgnore(props.hostId, ignore.id)
    toast.success('白名单已停用')
    await loadAuditIgnores()
  } catch (err: any) {
    toast.error('停用白名单失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function loadAuditHistory() {
  if (!props.hostId) return
  loadingAuditMeta.value = true
  try {
    auditHistory.value = await api.hosts.opsAuditHistory(props.hostId, selectedManaged.value ? { instanceId: selectedManaged.value.dbId, pageSize: 20 } : { pageSize: 20 })
  } catch (err: any) {
    toast.error('加载审查历史失败: ' + (err?.message || String(err)))
  } finally {
    loadingAuditMeta.value = false
  }
}

async function runAuditScan() {
  if (!props.hostId || loadingAction.value) return
  if (!selectedManaged.value) {
    await ensureInventoryForAudit()
    if (!selectedManaged.value) {
      toast.error('请先盘点并选择一个已纳管实例')
      return
    }
  }

  loadingAction.value = 'auditScan'
  try {
    auditResult.value = await api.hosts.opsInstanceAuditScan(props.hostId, selectedManaged.value.dbId)
    expandedAuditFindingIds.value = []
    resetAuditActionState()
    touchLastRun('auditScan')
    void loadAuditHistory()
    toast.success('实例审查扫描完成')
  } catch (err: any) {
    toast.error('实例审查失败: ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}

async function runAuditKillProcess() {
  if (!props.hostId || !selectedManaged.value || !selectedAuditPid.value || loadingAction.value) return
  if (!auditReason.value.trim()) {
    toast.error('请填写处置原因')
    return
  }
  if (auditConfirmationText.value.trim() !== selectedManaged.value.incusName) {
    toast.error('确认文本不匹配实例名称')
    return
  }

  loadingAction.value = 'auditKill'
  try {
    await api.hosts.opsInstanceAuditKillProcess(props.hostId, selectedManaged.value.dbId, {
      pid: selectedAuditPid.value,
      signal: auditSignal.value,
      reason: auditReason.value.trim(),
      confirmationText: auditConfirmationText.value.trim(),
      scanId: auditResult.value?.scanId,
      expectedCommand: selectedAuditProcess.value?.command
    })
    touchLastRun('auditKill')
    toast.success('手动处置命令已发送')
    resetAuditActionState()
    loadingAction.value = ''
    await runAuditScan()
  } catch (err: any) {
    toast.error('手动处置失败: ' + (err?.message || String(err)))
  } finally {
    loadingAction.value = ''
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="card p-5 space-y-4">
      <div>
        <h3 class="text-lg font-semibold text-themed">{{ t('admin.hosts.ops.title') }}</h3>
        <p class="text-sm text-themed-muted mt-1">{{ t('admin.hosts.ops.description') }}</p>
      </div>

      <div class="inline-flex rounded-lg border p-1" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-md transition"
          :class="activeOpsMenu === 'actions' ? 'bg-blue-600 text-white' : 'text-themed-muted hover:text-themed'"
          @click="activeOpsMenu = 'actions'"
        >
          实例操作
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-md transition"
          :class="activeOpsMenu === 'audit' ? 'bg-blue-600 text-white' : 'text-themed-muted hover:text-themed'"
          @click="activeOpsMenu = 'audit'"
        >
          实例审查
        </button>
      </div>

      <div v-if="activeOpsMenu === 'actions'" class="grid gap-4 lg:grid-cols-3">
        <div class="rounded-xl border p-4 space-y-3" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-gray-50'">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-themed">{{ t('admin.hosts.ops.discover') }}</div>
              <div class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.discoverHint') }}</div>
            </div>
            <span class="badge badge-info">Incus</span>
          </div>
          <button class="btn-primary btn-sm w-full" :disabled="loadingAction !== ''" @click="runDiscover">
            <span>{{ loadingAction === 'discover' ? '...' : t('admin.hosts.ops.discover') }}</span>
          </button>
        </div>

        <div class="rounded-xl border p-4 space-y-3" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-gray-50'">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-themed">{{ t('admin.hosts.ops.baselineSync') }}</div>
              <div class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.baselineHint') }}</div>
            </div>
            <span class="badge badge-warning">Safe</span>
          </div>
          <button class="btn-secondary btn-sm w-full" :disabled="loadingAction !== ''" @click="runBaselineSync">
            <span>{{ loadingAction === 'baseline' ? '...' : t('admin.hosts.ops.baselineSync') }}</span>
          </button>
        </div>

        <div class="rounded-xl border p-4 space-y-3" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900/40' : 'border-gray-200 bg-gray-50'">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-themed">{{ t('admin.hosts.ops.networkRepair') }}</div>
              <div class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.networkHint') }}</div>
            </div>
            <span class="badge badge-success">IP</span>
          </div>
          <button class="btn-secondary btn-sm w-full" :disabled="loadingAction !== ''" @click="runNetworkRepair">
            <span>{{ loadingAction === 'network' ? '...' : t('admin.hosts.ops.networkRepair') }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="activeOpsMenu === 'actions' && discoverResult" class="card p-5 space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 class="text-base font-semibold text-themed">{{ t('admin.hosts.ops.sectionInventory') }}</h3>
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.selectInstanceHint') }}</p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
          <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.totalIncus') }}</div>
          <div class="text-2xl font-semibold mt-1 text-themed">{{ discoverResult.summary.totalIncus }}</div>
        </div>
        <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
          <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.totalDb') }}</div>
          <div class="text-2xl font-semibold mt-1 text-themed">{{ discoverResult.summary.totalDb }}</div>
        </div>
        <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
          <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.managedCount') }}</div>
          <div class="text-2xl font-semibold mt-1 text-themed">{{ discoverResult.summary.managedCount }}</div>
        </div>
        <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
          <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.orphanedCount') }}</div>
          <div class="text-2xl font-semibold mt-1 text-themed">{{ discoverResult.summary.orphanedCount }}</div>
        </div>
        <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
          <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.missingCount') }}</div>
          <div class="text-2xl font-semibold mt-1 text-themed">{{ discoverResult.summary.missingCount }}</div>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <div class="rounded-xl border p-4 space-y-3" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <div class="font-medium text-themed">{{ t('admin.hosts.ops.managed') }}</div>
          <div v-if="discoverResult.managed.length" class="space-y-2 max-h-96 overflow-auto">
            <button
              v-for="item in discoverResult.managed"
              :key="`${item.dbId}-${item.incusName}`"
              type="button"
              class="w-full rounded-lg px-3 py-2 text-left text-sm border transition"
              :class="selectedManagedDbId === item.dbId
                ? (themeStore.isDark ? 'border-blue-500 bg-blue-500/10' : 'border-blue-500 bg-blue-50')
                : (themeStore.isDark ? 'border-gray-800 bg-gray-900 hover:border-gray-700' : 'border-gray-200 bg-gray-50 hover:border-gray-300')"
              @click="selectedManagedDbId = item.dbId"
            >
              <div class="font-medium text-themed">{{ item.incusName }}</div>
              <div class="text-xs text-themed-muted mt-1">
                {{ t('admin.hosts.ops.instanceType') }}: {{ localizeType(item.incusType) }} · {{ t('admin.hosts.ops.incusStatus') }}: {{ localizeStatus(item.incusStatus) }} · {{ t('admin.hosts.ops.dbStatus') }}: {{ localizeStatus(item.dbStatus) }} · 用户 ID: {{ item.userId }}
              </div>
            </button>
          </div>
          <div v-else class="text-sm text-themed-muted">{{ t('admin.hosts.ops.noManaged') }}</div>
        </div>

        <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <div class="font-medium text-themed mb-3">{{ t('admin.hosts.ops.orphaned') }}</div>
          <div v-if="discoverResult.orphaned.length" class="space-y-2 max-h-96 overflow-auto">
            <div v-for="item in discoverResult.orphaned" :key="item.incusName" class="rounded-lg px-3 py-2 text-sm" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
              <div class="font-medium text-themed">{{ item.incusName }}</div>
              <div class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.instanceType') }}: {{ localizeType(item.incusType) }} · {{ t('admin.hosts.ops.incusStatus') }}: {{ localizeStatus(item.incusStatus) }}</div>
            </div>
          </div>
          <div v-else class="text-sm text-themed-muted">{{ t('admin.hosts.ops.noOrphaned') }}</div>
        </div>

        <div class="rounded-xl border p-4" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <div class="font-medium text-themed mb-3">{{ t('admin.hosts.ops.missing') }}</div>
          <div v-if="discoverResult.missing.length" class="space-y-2 max-h-96 overflow-auto">
            <div v-for="item in discoverResult.missing" :key="`${item.dbId}-${item.incusId}`" class="rounded-lg px-3 py-2 text-sm" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
              <div class="font-medium text-themed">{{ item.dbName }}</div>
              <div class="text-xs text-themed-muted mt-1">ID #{{ item.dbId }} · Incus: {{ item.incusId }} · {{ t('admin.hosts.ops.dbStatus') }}: {{ item.dbStatus }}</div>
            </div>
          </div>
          <div v-else class="text-sm text-themed-muted">{{ t('admin.hosts.ops.noMissing') }}</div>
        </div>
      </div>
    </div>

    <div v-if="activeOpsMenu === 'actions' && selectedManaged" class="grid gap-6 xl:grid-cols-2">
      <div class="card p-5 space-y-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 class="text-base font-semibold text-themed">{{ t('admin.hosts.ops.instancePanel') }}</h3>
            <p class="text-xs text-themed-muted mt-1">{{ selectedManaged.incusName }} · #{{ selectedManaged.dbId }}</p>
          </div>
          <button class="btn-ghost btn-sm" :disabled="loadingAction !== ''" @click="loadPreview">{{ t('admin.hosts.ops.loadPreview') }}</button>
        </div>

        <div v-if="previewResult" class="rounded-xl p-4 space-y-2" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
          <div class="text-sm text-themed"><strong>{{ t('admin.hosts.ops.dbStatus') }}:</strong> {{ localizeStatus(previewResult.instanceStatus) }}</div>
          <div class="text-sm text-themed"><strong>{{ t('admin.hosts.ops.suggestedAction') }}:</strong> {{ localizeSuggestedAction(previewResult.risk.suggestedAction) }}</div>
          <div class="text-sm text-themed"><strong>{{ t('admin.hosts.ops.activeTask') }}:</strong> {{ previewResult.activeTask ? `${previewResult.activeTask.taskType} #${previewResult.activeTask.id}` : '-' }}</div>
          <ul class="text-xs text-themed-muted list-disc pl-5 space-y-1">
            <li v-for="note in previewResult.risk.notes" :key="note">{{ note }}</li>
          </ul>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <button class="btn-secondary btn-sm" :disabled="loadingAction !== '' || !previewResult?.canSync" @click="runInstanceSync">{{ t('admin.hosts.ops.syncInstance') }}</button>
          <button class="btn-secondary btn-sm" :disabled="loadingAction !== '' || !previewResult?.canRestart" @click="runInstanceRestart(false)">{{ t('admin.hosts.ops.safeRestart') }}</button>
          <button class="btn-secondary btn-sm" :disabled="loadingAction !== '' || !previewResult?.canForceRestart" @click="runInstanceRestart(true)">{{ t('admin.hosts.ops.forceRestart') }}</button>
        </div>
      </div>

      <div class="card p-5 space-y-4">
        <div>
          <h3 class="text-base font-semibold text-themed">{{ t('admin.hosts.ops.dangerZone') }}</h3>
          <p class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.dangerHint') }}</p>
        </div>

        <div v-if="previewResult" class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="rounded-xl border p-3 cursor-pointer" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <input v-model="dangerousAction" type="radio" class="mr-2" value="rebuild" :disabled="!previewResult.canRebuild" />
              {{ t('admin.hosts.ops.rebuild') }}
            </label>
            <label class="rounded-xl border p-3 cursor-pointer" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <input v-model="dangerousAction" type="radio" class="mr-2" value="recreate" :disabled="!previewResult.canRecreate" />
              {{ t('admin.hosts.ops.recreate') }}
            </label>
          </div>

          <!-- 镜像选择下拉 -->
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ops.selectImage') }}</label>
            <div v-if="loadingImages" class="text-xs text-themed-muted">{{ t('admin.hosts.ops.loadingImages') }}</div>
            <select
              v-else
              v-model="selectedImageId"
              class="input"
            >
              <option :value="null" disabled>{{ t('admin.hosts.ops.imagePlaceholder') }}</option>
              <option v-for="img in availableImages" :key="img.id" :value="img.id">
                {{ simplifyImageLabel(img) }}
              </option>
            </select>
            <div v-if="availableImages.length === 0 && !loadingImages" class="text-xs text-themed-muted mt-1">
              {{ t('admin.hosts.ops.noImagesAvailable') }}
            </div>
          </div>

          <!-- 可选恢复参数 -->
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ops.selectSshKey') }}</label>
            <div v-if="loadingSshKeys" class="text-xs text-themed-muted">{{ t('admin.hosts.ops.loadingSshKeys') }}</div>
            <select v-else v-model="selectedSshKeyId" class="input">
              <option :value="null">{{ t('admin.hosts.ops.sshKeyPlaceholder') }}</option>
              <option v-for="key in availableSshKeys" :key="key.id" :value="key.id">
                {{ key.name }}{{ key.fingerprint ? ` (${key.fingerprint})` : '' }}
              </option>
            </select>
            <div class="text-xs text-themed-muted mt-1">
              {{ availableSshKeys.length === 0 && !loadingSshKeys ? t('admin.hosts.ops.noSshKeysAvailable') : t('admin.hosts.ops.sshKeyOptionalHint') }}
            </div>
          </div>

          <div>
            <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ops.selectInitCommands') }}</label>
            <div v-if="loadingInitCommands" class="text-xs text-themed-muted">{{ t('admin.hosts.ops.loadingInitCommands') }}</div>
            <div v-else-if="availableInitCommands.length > 0" class="space-y-2 max-h-48 overflow-auto rounded-xl border p-2" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
              <label
                v-for="cmd in availableInitCommands"
                :key="cmd.id"
                class="flex items-start gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer transition"
                :class="selectedCustomInitCommandIds.includes(cmd.id)
                  ? (themeStore.isDark ? 'bg-blue-500/10' : 'bg-blue-50')
                  : (themeStore.isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50')"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 rounded"
                  :checked="selectedCustomInitCommandIds.includes(cmd.id)"
                  @change="toggleInitCommand(cmd.id)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block font-medium text-themed">{{ cmd.name }}</span>
                  <span class="block text-xs text-themed-muted mt-0.5">
                    {{ t('extensions.initCommands.lineCount', { count: cmd.commandLineCount }) }}
                    <span v-if="cmd.distros.length"> · {{ cmd.distros.map(getDistroName).join(', ') }}</span>
                  </span>
                  <span v-if="cmd.description" class="block text-xs text-themed-muted mt-0.5 truncate">{{ cmd.description }}</span>
                </span>
              </label>
            </div>
            <div v-else class="text-xs text-themed-muted">{{ t('admin.hosts.ops.noInitCommandsAvailable') }}</div>
            <div class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.optionalField') }}</div>
          </div>

          <div class="rounded-xl border p-4 space-y-3" :class="themeStore.isDark ? 'border-red-900 bg-red-950/20' : 'border-red-200 bg-red-50'">
            <div class="text-sm font-medium text-red-500">{{ t('admin.hosts.ops.confirmDangerTitle') }}</div>
            <label class="flex items-start gap-2 text-sm text-themed">
              <input v-model="riskAccepted" type="checkbox" class="mt-0.5" />
              <span>{{ t('admin.hosts.ops.riskCheckbox') }}</span>
            </label>
            <div>
              <label class="block text-xs text-themed-muted mb-1.5">{{ t('admin.hosts.ops.confirmTextHint') }}</label>
              <input v-model="confirmationText" type="text" class="input" :placeholder="confirmationExpectedText" />
            </div>
            <div class="flex justify-end">
              <button
                class="btn-danger btn-sm"
                type="button"
                :disabled="loadingAction !== '' || !isDangerFormValid"
                @click="openDangerConfirm"
              >
                {{ t('admin.hosts.ops.executeDangerAction') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="activeOpsMenu === 'audit'" class="space-y-6">
      <div class="inline-flex rounded-lg border p-1" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
        <button type="button" class="px-3 py-1.5 rounded-md text-sm font-medium transition" :class="auditPanel === 'scan' ? 'bg-blue-600 text-white' : 'text-themed-muted hover:text-themed'" @click="auditPanel = 'scan'">审查扫描</button>
        <button type="button" class="px-3 py-1.5 rounded-md text-sm font-medium transition" :class="auditPanel === 'rules' ? 'bg-blue-600 text-white' : 'text-themed-muted hover:text-themed'" @click="auditPanel = 'rules'">规则库</button>
        <button type="button" class="px-3 py-1.5 rounded-md text-sm font-medium transition" :class="auditPanel === 'whitelist' ? 'bg-blue-600 text-white' : 'text-themed-muted hover:text-themed'" @click="auditPanel = 'whitelist'">白名单</button>
        <button type="button" class="px-3 py-1.5 rounded-md text-sm font-medium transition" :class="auditPanel === 'history' ? 'bg-blue-600 text-white' : 'text-themed-muted hover:text-themed'" @click="auditPanel = 'history'">审查历史</button>
      </div>

      <div v-if="auditPanel === 'scan'" class="card p-5 space-y-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 class="text-base font-semibold text-themed">实例审查</h3>
            <p class="text-xs text-themed-muted mt-1">人工扫描进程、网络连接和启动项，发现可疑项后由运维人员手动处置。</p>
          </div>
          <button class="btn-secondary btn-sm" :disabled="loadingAction !== ''" @click="runDiscover">
            {{ loadingAction === 'discover' ? '...' : '刷新实例列表' }}
          </button>
        </div>

        <div v-if="discoverResult" class="grid gap-4 xl:grid-cols-[minmax(260px,360px)_1fr]">
          <div class="rounded-xl border p-4 space-y-3" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
            <div class="font-medium text-themed">选择审查实例</div>
            <div v-if="discoverResult.managed.length" class="space-y-2 max-h-96 overflow-auto">
              <button
                v-for="item in discoverResult.managed"
                :key="`audit-${item.dbId}-${item.incusName}`"
                type="button"
                class="w-full rounded-lg px-3 py-2 text-left text-sm border transition"
                :class="selectedManagedDbId === item.dbId
                  ? (themeStore.isDark ? 'border-blue-500 bg-blue-500/10' : 'border-blue-500 bg-blue-50')
                  : (themeStore.isDark ? 'border-gray-800 bg-gray-900 hover:border-gray-700' : 'border-gray-200 bg-gray-50 hover:border-gray-300')"
                @click="selectedManagedDbId = item.dbId"
              >
                <div class="font-medium text-themed">{{ item.incusName }}</div>
                <div class="text-xs text-themed-muted mt-1">
                  {{ localizeType(item.incusType) }} · {{ localizeStatus(item.incusStatus) }} · 用户 ID: {{ item.userId }}
                </div>
              </button>
            </div>
            <div v-else class="text-sm text-themed-muted">当前没有已纳管实例。</div>
          </div>

          <div class="rounded-xl border p-4 space-y-4" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div class="font-medium text-themed">{{ selectedManaged?.incusName || '未选择实例' }}</div>
                <div class="text-xs text-themed-muted mt-1">扫描不会自动封禁，也不会自动停止进程。</div>
              </div>
              <button class="btn-primary btn-sm" :disabled="loadingAction !== '' || !selectedManaged" @click="runAuditScan">
                {{ loadingAction === 'auditScan' ? '扫描中...' : '开始审查扫描' }}
              </button>
            </div>

            <div v-if="auditResult" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div class="rounded-xl p-3" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
                <div class="text-xs text-themed-muted">风险等级</div>
                <div class="text-lg font-semibold mt-1" :class="severityClass(auditResult.summary.riskLevel)">{{ localizeSeverity(auditResult.summary.riskLevel) }}</div>
              </div>
              <div class="rounded-xl p-3" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
                <div class="text-xs text-themed-muted">发现项</div>
                <div class="text-lg font-semibold mt-1 text-themed">{{ auditResult.summary.findingCount }}</div>
              </div>
              <div class="rounded-xl p-3" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
                <div class="text-xs text-themed-muted">进程</div>
                <div class="text-lg font-semibold mt-1 text-themed">{{ auditResult.summary.processCount }}</div>
              </div>
              <div class="rounded-xl p-3" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
                <div class="text-xs text-themed-muted">连接</div>
                <div class="text-lg font-semibold mt-1 text-themed">{{ auditResult.summary.connectionCount }}</div>
              </div>
              <div class="rounded-xl p-3" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
                <div class="text-xs text-themed-muted">监听端口</div>
                <div class="text-lg font-semibold mt-1 text-themed">{{ auditResult.summary.listeningCount }}</div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="rounded-xl border border-dashed p-8 text-center text-sm text-themed-muted" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          请先刷新实例列表，选择一个已纳管实例后再进行人工审查。
        </div>
      </div>

      <div v-if="auditPanel === 'scan' && auditResult" class="grid gap-6 xl:grid-cols-2">
        <div class="card p-5 space-y-4">
          <div>
            <h3 class="text-base font-semibold text-themed">可疑发现</h3>
            <p class="text-xs text-themed-muted mt-1">结果只作为人工判断线索，处置前请结合进程参数和业务背景确认。</p>
          </div>
          <div v-if="auditResult.findings.length" class="space-y-3 max-h-[32rem] overflow-auto">
            <div v-for="finding in auditResult.findings" :key="finding.id" class="rounded-xl border p-3 text-sm" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <div class="flex items-center justify-between gap-3">
                <div class="font-medium text-themed">{{ localizeAuditText(finding.title) }}</div>
                <span class="text-xs font-semibold" :class="severityClass(finding.severity)">{{ localizeSeverity(finding.severity) }}</span>
              </div>
              <div class="text-xs text-themed-muted mt-1">{{ localizeFindingDetail(finding.detail) }}</div>
              <div class="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div class="text-themed-muted">规则：{{ localizeAuditText(finding.ruleName || finding.ruleId) }} / {{ localizeRuleSource(finding.ruleSource) }}</div>
                <div class="text-themed-muted">分类：{{ localizeAuditCategory(finding.category) }} / 命中：{{ finding.matchedText || '-' }}</div>
                <div v-if="finding.recommendation" class="text-themed-muted sm:col-span-2">建议：{{ localizeAuditText(finding.recommendation) }}</div>
                <div v-if="finding.ignored" class="text-blue-500 sm:col-span-2">已被白名单忽略：{{ finding.ignoreReason || '-' }}</div>
              </div>
              <div class="mt-2 flex justify-between gap-2">
                <button class="btn-ghost btn-sm" @click="toggleAuditEvidence(finding.id)">
                  {{ isAuditEvidenceExpanded(finding.id) ? '收起原始证据' : '查看原始证据' }}
                </button>
                <button v-if="!finding.ignored" class="btn-ghost btn-sm" @click="addIgnoreFromFinding(finding)">加入白名单</button>
              </div>
              <pre v-if="isAuditEvidenceExpanded(finding.id)" class="mt-2 text-xs whitespace-pre-wrap break-all text-themed-muted rounded-lg p-3" :class="themeStore.isDark ? 'bg-gray-950' : 'bg-white'">{{ finding.evidence }}</pre>
            </div>
          </div>
          <div v-else class="text-sm text-themed-muted">未命中当前启用的审查规则。</div>
        </div>

        <div class="card p-5 space-y-4">
          <div>
            <h3 class="text-base font-semibold text-themed">手动停止进程</h3>
            <p class="text-xs text-themed-muted mt-1">仅对选中的 PID 发送信号，不会自动封禁实例或用户。</p>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="block text-xs text-themed-muted mb-1.5">PID</label>
              <input v-model.number="selectedAuditPid" type="number" min="2" class="input" placeholder="选择或输入 PID" />
            </div>
            <div>
              <label class="block text-xs text-themed-muted mb-1.5">信号</label>
              <select v-model="auditSignal" class="input">
                <option value="TERM">安全停止（TERM）</option>
                <option value="KILL">强制停止（KILL）</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">处置原因</label>
            <textarea v-model="auditReason" class="input min-h-20" placeholder="记录判断依据，便于后续追溯" />
          </div>
          <div>
            <label class="block text-xs text-themed-muted mb-1.5">确认实例名称</label>
            <input v-model="auditConfirmationText" type="text" class="input" :placeholder="selectedManaged?.incusName || ''" />
          </div>
          <div class="flex justify-end">
            <button class="btn-danger btn-sm" :disabled="loadingAction !== '' || !selectedAuditPid || auditConfirmationText.trim() !== selectedManaged?.incusName" @click="runAuditKillProcess">
              {{ loadingAction === 'auditKill' ? '处理中...' : '发送停止信号' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="auditPanel === 'scan' && auditResult" class="card p-5 space-y-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 class="text-base font-semibold text-themed">进程列表</h3>
            <p class="text-xs text-themed-muted mt-1">优先显示命中规则或 CPU 较高的进程。</p>
          </div>
          <button class="btn-ghost btn-sm" :disabled="loadingAction !== '' || !selectedManaged" @click="runAuditScan">
            {{ loadingAction === 'auditScan' ? '刷新中...' : '刷新进程' }}
          </button>
        </div>
        <div class="overflow-x-auto rounded-xl border" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <table class="min-w-full text-sm">
            <thead :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-themed">PID</th>
                <th class="px-4 py-3 text-left font-medium text-themed">用户</th>
                <th class="px-4 py-3 text-left font-medium text-themed">CPU</th>
                <th class="px-4 py-3 text-left font-medium text-themed">内存</th>
                <th class="px-4 py-3 text-left font-medium text-themed">命令</th>
                <th class="px-4 py-3 text-left font-medium text-themed">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="process in auditResult.processes" :key="process.pid" class="border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
                <td class="px-4 py-3 font-mono text-themed">{{ process.pid }}</td>
                <td class="px-4 py-3 text-themed-muted">{{ process.user }}</td>
                <td class="px-4 py-3 text-themed-muted">{{ process.cpuPercent ?? '-' }}</td>
                <td class="px-4 py-3 text-themed-muted">{{ process.memoryPercent ?? '-' }}</td>
                <td class="px-4 py-3">
                  <div class="font-medium text-themed">{{ process.command }}</div>
                  <div class="text-xs text-themed-muted max-w-xl truncate">{{ process.args }}</div>
                  <div v-if="process.findings.length" class="text-xs text-amber-500 mt-1">{{ localizeProcessFindings(process.findings) }}</div>
                </td>
                <td class="px-4 py-3">
                  <button class="btn-ghost btn-sm" @click="selectAuditProcess(process)">选择</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="auditPanel === 'scan' && auditResult" class="grid gap-6 xl:grid-cols-2">
        <div class="card p-5 space-y-4">
          <h3 class="text-base font-semibold text-themed">网络连接</h3>
          <div class="space-y-2 max-h-96 overflow-auto">
            <div v-for="(connection, index) in auditResult.connections" :key="`${connection.raw}-${index}`" class="rounded-lg px-3 py-2 text-xs" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
              <div class="font-mono text-themed">{{ connection.protocol }} {{ connection.state }} {{ connection.local }} -> {{ connection.peer }}</div>
              <div v-if="connection.process" class="text-themed-muted mt-1">{{ connection.process }}</div>
            </div>
          </div>
        </div>

        <div class="card p-5 space-y-4">
          <h3 class="text-base font-semibold text-themed">启动项摘要</h3>
          <div class="space-y-2 max-h-96 overflow-auto">
            <div v-for="(item, index) in auditResult.startupItems" :key="`${item.source}-${index}`" class="rounded-lg px-3 py-2 text-xs" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
              <div class="text-themed-muted">{{ item.source }}</div>
              <div class="font-mono text-themed break-all">{{ item.command }}</div>
              <div v-if="item.findings.length" class="text-amber-500 mt-1">{{ localizeProcessFindings(item.findings) }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="auditPanel === 'rules'" class="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div class="card p-5 space-y-4">
          <div>
            <h3 class="text-base font-semibold text-themed">规则编辑</h3>
            <p class="text-xs text-themed-muted mt-1">
              {{ auditRuleForm.builtinRuleId ? '正在调整系统内置规则的本节点覆盖配置，只影响当前节点。' : '节点所有者可创建当前节点规则，管理员还可以创建全局规则。' }}
            </p>
          </div>
          <div class="rounded-xl border p-3 space-y-2" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
            <div class="text-xs font-medium text-themed">快速模板</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="template in auditRuleTemplates"
                :key="template.name"
                type="button"
                class="btn-ghost btn-sm"
                @click="applyAuditRuleTemplate(template)"
              >
                {{ template.name }}
              </button>
            </div>
          </div>
          <div class="grid gap-3">
            <input v-model="auditRuleForm.name" class="input" placeholder="规则名称" />
            <div class="grid gap-3 sm:grid-cols-2">
              <select v-model="auditRuleForm.scope" class="input" :disabled="!!auditRuleForm.builtinRuleId">
                <option value="host">当前节点</option>
                <option value="global">管理员全局</option>
              </select>
              <select v-model="auditRuleForm.severity" class="input">
                <option value="info">信息</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
            <input v-model="auditRuleForm.category" class="input" placeholder="分类，例如 网络滥用、代理面板" />
            <div class="flex flex-wrap gap-2">
              <label class="inline-flex items-center gap-2 text-sm text-themed-muted"><input type="checkbox" :checked="auditRuleForm.targetTypes.includes('process')" @change="toggleRuleTarget('process')" />进程</label>
              <label class="inline-flex items-center gap-2 text-sm text-themed-muted"><input type="checkbox" :checked="auditRuleForm.targetTypes.includes('network')" @change="toggleRuleTarget('network')" />网络</label>
              <label class="inline-flex items-center gap-2 text-sm text-themed-muted"><input type="checkbox" :checked="auditRuleForm.targetTypes.includes('startup')" @change="toggleRuleTarget('startup')" />启动项</label>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <select v-model="auditRuleForm.matchType" class="input">
                <option value="contains">包含关键词</option>
                <option value="regex">正则表达式</option>
                <option value="exact">精确匹配</option>
              </select>
              <label class="inline-flex items-center gap-2 text-sm text-themed-muted"><input v-model="auditRuleForm.caseSensitive" type="checkbox" />区分大小写</label>
            </div>
            <textarea v-model="auditRuleForm.pattern" class="input min-h-20" placeholder="匹配内容或正则" />
            <textarea v-model="auditRuleForm.recommendation" class="input min-h-20" placeholder="处理建议，可选" />
            <label class="inline-flex items-center gap-2 text-sm text-themed-muted"><input v-model="auditRuleForm.enabled" type="checkbox" />启用规则</label>
          </div>
          <div class="flex justify-between gap-3">
            <button class="btn-ghost btn-sm" @click="resetAuditRuleForm">清空</button>
            <button class="btn-primary btn-sm" :disabled="loadingAuditMeta" @click="saveAuditRule">
              {{ auditRuleForm.builtinRuleId ? '保存本节点覆盖' : (auditRuleForm.id ? '保存修改' : '新增规则') }}
            </button>
          </div>
        </div>

        <div class="card p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold text-themed">规则库</h3>
            <button class="btn-ghost btn-sm" :disabled="loadingAuditMeta" @click="loadAuditRules">刷新</button>
          </div>
          <div class="space-y-3 max-h-[42rem] overflow-auto">
            <div v-for="rule in auditRules" :key="`${rule.source}-${rule.id}`" class="rounded-xl border p-3 text-sm" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <div class="flex items-center justify-between gap-3">
                <div class="font-medium text-themed">{{ localizeAuditText(rule.name) }}</div>
                <span class="text-xs font-semibold" :class="severityClass(rule.severity)">{{ localizeSeverity(rule.severity) }}</span>
              </div>
              <div class="text-xs text-themed-muted mt-1">
                {{ localizeRuleSource(rule.source) }} / {{ localizeRuleScope(rule.scope) }} / {{ localizeAuditCategory(rule.category) }} / {{ localizeAuditMatchType(rule.matchType) }}
              </div>
              <div class="text-xs mt-1" :class="rule.enabled ? 'text-emerald-500' : 'text-red-500'">
                {{ rule.enabled ? '当前启用' : '当前已停用' }}{{ rule.overridden ? ' / 本节点已覆盖' : '' }}
              </div>
              <div class="text-xs text-themed-muted mt-1">检查对象：{{ localizeAuditTargets(rule.targetTypes) }}</div>
              <div class="text-xs font-mono text-themed-muted mt-2 break-all">{{ rule.pattern }}</div>
              <div v-if="rule.recommendation" class="text-xs text-themed-muted mt-2">建议：{{ localizeAuditText(rule.recommendation) }}</div>
              <div class="mt-3 flex justify-end gap-2">
                <button v-if="rule.source === 'builtin'" class="btn-ghost btn-sm" @click="editBuiltinRuleOverride(rule)">调整本节点</button>
                <button v-if="rule.source === 'builtin' && rule.overridden" class="btn-ghost btn-sm" @click="resetBuiltinRuleOverride(rule)">恢复默认</button>
                <button v-if="!rule.readOnly" class="btn-ghost btn-sm" @click="editAuditRule(rule)">编辑</button>
                <button class="btn-ghost btn-sm" @click="createRuleFromExisting(rule)">基于此规则新建</button>
                <button v-if="!rule.readOnly" class="btn-danger btn-sm" @click="deleteAuditRule(rule)">删除</button>
              </div>
            </div>
            <div v-if="!auditRules.length" class="text-sm text-themed-muted">暂无规则，点击刷新加载系统内置规则。</div>
          </div>
        </div>
      </div>

      <div v-if="auditPanel === 'whitelist'" class="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div class="card p-5 space-y-4">
          <h3 class="text-base font-semibold text-themed">新增白名单</h3>
          <select v-model="ignoreForm.scope" class="input">
            <option value="instance">当前实例</option>
            <option value="host">当前节点</option>
          </select>
          <input v-model="ignoreForm.ruleId" class="input" placeholder="规则编号，例如 proxy-core 或 custom:1" />
          <select v-model="ignoreForm.targetType" class="input">
            <option value="">所有目标</option>
            <option value="process">进程</option>
            <option value="network">网络</option>
            <option value="startup">启动项</option>
          </select>
          <input v-model="ignoreForm.matchText" class="input" placeholder="匹配文本，可选" />
          <textarea v-model="ignoreForm.reason" class="input min-h-20" placeholder="忽略原因" />
          <input v-model.number="ignoreForm.expiresInDays" type="number" min="0" max="365" class="input" placeholder="有效天数，0 表示永久" />
          <button class="btn-primary btn-sm" :disabled="loadingAuditMeta" @click="saveAuditIgnore">保存白名单</button>
        </div>

        <div class="card p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold text-themed">白名单列表</h3>
            <button class="btn-ghost btn-sm" :disabled="loadingAuditMeta" @click="loadAuditIgnores">刷新</button>
          </div>
          <div class="space-y-3">
            <div v-for="ignore in auditIgnores" :key="ignore.id" class="rounded-xl border p-3 text-sm" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <div class="font-medium text-themed">{{ localizeRuleScope(ignore.scope) }} / {{ ignore.ruleId || '任意规则' }}</div>
              <div class="text-xs text-themed-muted mt-1">目标：{{ localizeAuditTarget(ignore.targetType) }} / 文本：{{ ignore.matchText || '-' }}</div>
              <div class="text-xs text-themed-muted mt-1">原因：{{ ignore.reason || '-' }}</div>
              <div class="text-xs text-themed-muted mt-1">到期：{{ ignore.expiresAt ? new Date(ignore.expiresAt).toLocaleString() : '永久' }}</div>
              <div class="mt-3 flex justify-end">
                <button class="btn-danger btn-sm" @click="deleteAuditIgnore(ignore)">停用</button>
              </div>
            </div>
            <div v-if="!auditIgnores.length" class="text-sm text-themed-muted">暂无白名单。</div>
          </div>
        </div>
      </div>

      <div v-if="auditPanel === 'history'" class="grid gap-6 xl:grid-cols-2">
        <div class="card p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold text-themed">扫描历史</h3>
            <button class="btn-ghost btn-sm" :disabled="loadingAuditMeta" @click="loadAuditHistory">刷新</button>
          </div>
          <div class="space-y-3">
            <div v-for="scan in auditHistory.scans" :key="scan.id" class="rounded-xl border p-3 text-sm" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <div class="flex justify-between gap-3">
                <div class="font-medium text-themed">#{{ scan.id }} / {{ localizeAuditStatus(scan.status) }}</div>
                <span :class="severityClass(scan.riskLevel)">{{ localizeSeverity(scan.riskLevel) }}</span>
              </div>
              <div class="text-xs text-themed-muted mt-1">{{ new Date(scan.createdAt).toLocaleString() }} / {{ scan.user?.username || scan.userId }}</div>
              <div class="text-xs text-themed-muted mt-1">发现 {{ scan.findingCount }}，忽略 {{ scan.ignoredCount }}，进程 {{ scan.processCount }}，连接 {{ scan.connectionCount }}</div>
            </div>
            <div v-if="!auditHistory.scans.length" class="text-sm text-themed-muted">暂无扫描历史。</div>
          </div>
        </div>

        <div class="card p-5 space-y-4">
          <h3 class="text-base font-semibold text-themed">处置历史</h3>
          <div class="space-y-3">
            <div v-for="action in auditHistory.actions" :key="action.id" class="rounded-xl border p-3 text-sm" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
              <div class="font-medium text-themed">#{{ action.id }} / {{ localizeAuditActionType(action.actionType) }} / {{ localizeAuditActionResult(action.result) }}</div>
              <div class="text-xs text-themed-muted mt-1">{{ new Date(action.createdAt).toLocaleString() }} / {{ action.user?.username || action.userId }}</div>
              <div class="text-xs text-themed-muted mt-1">PID {{ action.pid || '-' }} / {{ localizeAuditSignal(action.signal) }}</div>
              <div class="text-xs text-themed-muted mt-1">原因：{{ action.reason }}</div>
              <div v-if="action.processCommand" class="text-xs font-mono text-themed-muted mt-1 break-all">{{ action.processCommand }}</div>
            </div>
            <div v-if="!auditHistory.actions.length" class="text-sm text-themed-muted">暂无处置历史。</div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="activeOpsMenu === 'actions'" class="card p-5 space-y-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 class="text-base font-semibold text-themed">{{ resultTitle() }}</h3>
          <p v-if="lastRunAt" class="text-xs text-themed-muted mt-1">{{ t('admin.hosts.ops.lastRunAt') }}：{{ lastRunAt }}</p>
        </div>
        <button class="btn-ghost btn-sm" :disabled="!lastAction || loadingAction !== ''" @click="refreshLastResult">{{ t('admin.hosts.ops.refresh') }}</button>
      </div>

      <template v-if="!hasResult">
        <div class="rounded-xl border border-dashed p-8 text-center text-sm text-themed-muted" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          {{ t('admin.hosts.ops.empty') }}
        </div>
      </template>

      <template v-else>
        <div v-if="baselineResult" class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
            <div class="text-xs text-themed-muted">已用 CPU</div>
            <div class="text-xl font-semibold mt-1 text-themed">{{ baselineResult.resources.cpuUsed }}</div>
          </div>
          <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
            <div class="text-xs text-themed-muted">已用内存</div>
            <div class="text-xl font-semibold mt-1 text-themed">{{ baselineResult.resources.memoryUsed }}</div>
          </div>
          <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
            <div class="text-xs text-themed-muted">已用磁盘</div>
            <div class="text-xl font-semibold mt-1 text-themed">{{ baselineResult.resources.diskUsed }}</div>
          </div>
          <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
            <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.synced') }}</div>
            <div class="text-xl font-semibold mt-1 text-themed">{{ baselineResult.instanceSync.synced }} / {{ baselineResult.instanceSync.total }}</div>
          </div>
          <div class="rounded-xl p-4" :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
            <div class="text-xs text-themed-muted">{{ t('admin.hosts.ops.changes') }}</div>
            <div class="text-xl font-semibold mt-1 text-themed">{{ baselineResult.instanceSync.ipChanged }}</div>
          </div>
        </div>

        <div v-if="networkResult" class="overflow-x-auto rounded-xl border" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
          <table class="min-w-full text-sm">
            <thead :class="themeStore.isDark ? 'bg-gray-900' : 'bg-gray-50'">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-themed">ID</th>
                <th class="px-4 py-3 text-left font-medium text-themed">{{ t('admin.hosts.ops.instanceName') }}</th>
                <th class="px-4 py-3 text-left font-medium text-themed">{{ t('admin.hosts.ops.dbStatus') }}</th>
                <th class="px-4 py-3 text-left font-medium text-themed">{{ t('admin.hosts.ops.ipv4') }}</th>
                <th class="px-4 py-3 text-left font-medium text-themed">{{ t('admin.hosts.ops.ipv6') }}</th>
                <th class="px-4 py-3 text-left font-medium text-themed">{{ t('admin.hosts.ops.details') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in networkResult.results" :key="row.id" class="border-t" :class="themeStore.isDark ? 'border-gray-800' : 'border-gray-200'">
                <td class="px-4 py-3 text-themed">{{ row.id }}</td>
                <td class="px-4 py-3 text-themed">{{ row.name }}</td>
                <td class="px-4 py-3 text-themed">{{ row.newStatus || row.oldStatus || '-' }}</td>
                <td class="px-4 py-3 text-themed-muted">{{ row.ipv4Changed ? `${formatValue(row.oldIpv4)} → ${formatValue(row.newIpv4)}` : '-' }}</td>
                <td class="px-4 py-3 text-themed-muted">{{ row.ipv6Changed ? `${formatValue(row.oldIpv6)} → ${formatValue(row.newIpv6)}` : '-' }}</td>
                <td class="px-4 py-3">
                  <span v-if="row.success" class="text-xs text-themed-muted">{{ row.statusChanged ? `${formatValue(row.oldStatus)} → ${formatValue(row.newStatus)}` : '-' }}</span>
                  <span v-else class="text-xs text-red-500">{{ row.error }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="latestInstanceActionResult" class="rounded-xl border p-4 text-sm" :class="themeStore.isDark ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'">
          <div class="font-medium text-themed mb-2">{{ t('admin.hosts.ops.latestInstanceAction') }}</div>
          <div class="space-y-1 text-themed-muted">
            <div v-if="latestInstanceActionResult.message">{{ latestInstanceActionResult.message }}</div>
            <div v-if="latestInstanceActionResult.taskId">Task #{{ latestInstanceActionResult.taskId }}</div>
            <div v-if="latestInstanceActionResult.currentStatus">{{ t('admin.hosts.ops.dbStatus') }}: {{ latestInstanceActionResult.currentStatus }}</div>
            <div v-if="latestInstanceActionResult.from || latestInstanceActionResult.to">{{ formatValue(latestInstanceActionResult.from) }} → {{ formatValue(latestInstanceActionResult.to) }}</div>
          </div>
        </div>
      </template>
    </div>

    <!-- 二次确认弹窗 -->
    <div
      v-if="showDangerConfirmModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="cancelDangerConfirm" />
      <div
        class="relative w-full max-w-md rounded-2xl p-6 space-y-5 shadow-2xl"
        :class="themeStore.isDark ? 'bg-gray-900 border border-gray-800' : 'bg-white border border-gray-200'"
      >
        <!-- 警告图标 -->
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <svg class="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <div class="font-semibold text-themed">
              {{ dangerConfirmStep === 1 ? t('admin.hosts.ops.dangerConfirm1Title') : t('admin.hosts.ops.dangerConfirm2Title') }}
            </div>
            <div class="text-xs text-themed-muted mt-0.5">
              {{ dangerConfirmStep === 1 ? t('admin.hosts.ops.dangerConfirm1Hint') : t('admin.hosts.ops.dangerConfirm2Hint') }}
            </div>
          </div>
        </div>

        <!-- 操作摘要 -->
        <div class="rounded-xl p-4 space-y-1.5 text-sm" :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-50'">
          <div class="flex items-center justify-between">
            <span class="text-themed-muted">{{ t('admin.hosts.ops.instanceName') }}</span>
            <span class="font-mono font-medium text-themed">{{ previewResult?.instanceName }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-themed-muted">{{ t('admin.hosts.ops.dangerActionType') }}</span>
            <span class="font-medium text-red-500">{{ dangerousAction === 'rebuild' ? t('admin.hosts.ops.rebuild') : t('admin.hosts.ops.recreate') }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-themed-muted">{{ t('admin.hosts.ops.selectImage') }}</span>
            <span class="text-themed text-xs font-mono">{{ selectedImageAlias }}</span>
          </div>
        </div>

        <!-- 步骤指示 -->
        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 rounded-full" :class="dangerConfirmStep >= 1 ? 'bg-red-500' : (themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200')" />
          <div class="flex-1 h-1.5 rounded-full" :class="dangerConfirmStep >= 2 ? 'bg-red-500' : (themeStore.isDark ? 'bg-gray-700' : 'bg-gray-200')" />
        </div>
        <div class="text-xs text-themed-muted text-center">
          {{ t('admin.hosts.ops.dangerConfirmStep', { step: dangerConfirmStep, total: 2 }) }}
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-3 justify-end">
          <button class="btn-ghost btn-sm" @click="cancelDangerConfirm">{{ t('common.cancel') }}</button>
          <button
            v-if="dangerConfirmStep === 1"
            class="btn-danger btn-sm"
            @click="advanceDangerConfirm"
          >
            {{ t('admin.hosts.ops.dangerConfirm1Btn') }}
          </button>
          <button
            v-else
            class="btn-danger btn-sm"
            :disabled="loadingAction !== ''"
            @click="executeDangerConfirmed"
          >
            {{ loadingAction === 'instanceDanger' ? '...' : t('admin.hosts.ops.dangerConfirm2Btn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
