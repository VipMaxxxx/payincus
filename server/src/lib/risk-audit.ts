import { sanitizeTokensInString } from './log-sanitizer.js'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface RiskOperationDefinition {
  action: string
  module?: string
  level: RiskLevel
  title: string
  description: string
  approvalRequired: boolean
  verificationRequired: boolean
  batchSensitive: boolean
}

export interface RiskAuditLogInput {
  module: string
  action: string
  content?: string | null
}

export const RISK_OPERATION_DEFINITIONS: RiskOperationDefinition[] = [
  {
    action: 'system.update.start',
    module: 'system',
    level: 'critical',
    title: '系统在线更新',
    description: '会替换生产运行版本，必须保留 OTA 任务日志和回滚证据。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'system.update.rollback',
    module: 'system',
    level: 'critical',
    title: '系统回滚',
    description: '会切换生产 current 指向，必须确认目标版本和数据库兼容性。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'system.config_update',
    module: 'system',
    level: 'high',
    title: '系统配置变更',
    description: '可能影响注册、支付、邮件、风控或公开站点配置。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'payment_provider.create',
    module: 'billing',
    level: 'critical',
    title: '新增支付通道',
    description: '会影响真实收款链路，配置摘要必须脱敏记录。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'payment_provider.update',
    module: 'billing',
    level: 'critical',
    title: '修改支付通道',
    description: '会影响真实收款链路，密钥和回调配置不得进入日志或导出。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'payment_provider.delete',
    module: 'billing',
    level: 'critical',
    title: '删除支付通道',
    description: '可能导致充值不可用，必须保留操作人和结果。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'payment_provider.status',
    module: 'billing',
    level: 'high',
    title: '支付通道启停',
    description: '会影响用户充值入口和回调可用性。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'balance.adjustment.request',
    module: 'billing',
    level: 'high',
    title: '余额调账申请',
    description: '影响用户资金余额，必须进入审批流。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'balance.adjustment.review',
    module: 'billing',
    level: 'critical',
    title: '余额调账审批',
    description: '审批通过后可能写入余额流水，必须和审批单互相追溯。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'instance.batch_delete',
    module: 'instance',
    level: 'critical',
    title: '批量删除实例',
    description: '会删除用户资源，必须二次确认并记录影响范围。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: true
  },
  {
    action: 'instance.delete',
    module: 'instance',
    level: 'high',
    title: '删除实例',
    description: '会释放或删除用户资源，需要记录实例和执行结果。',
    approvalRequired: false,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'host.delete',
    module: 'host',
    level: 'critical',
    title: '删除节点',
    description: '会影响资源交付和现有实例管理。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'host.update',
    module: 'host',
    level: 'high',
    title: '修改节点',
    description: '可能影响 Agent、Incus 和资源调度配置。',
    approvalRequired: false,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'package.update',
    module: 'package',
    level: 'high',
    title: '修改套餐',
    description: '可能影响价格、资源配额和售卖策略。',
    approvalRequired: true,
    verificationRequired: false,
    batchSensitive: false
  },
  {
    action: 'package.delete',
    module: 'package',
    level: 'high',
    title: '删除套餐',
    description: '会影响用户下单和续费入口。',
    approvalRequired: true,
    verificationRequired: false,
    batchSensitive: false
  },
  {
    action: 'user.role.update',
    module: 'user',
    level: 'critical',
    title: '管理员权限变更',
    description: '会影响后台权限边界，必须记录变更前后摘要。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'user.delete',
    module: 'user',
    level: 'critical',
    title: '删除用户',
    description: '可能影响账号、余额、实例和审计追溯。',
    approvalRequired: true,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'plugin.install',
    module: 'plugin',
    level: 'high',
    title: '安装插件',
    description: '插件可能扩展用户端、后台端或 API 能力，必须记录来源和校验值。',
    approvalRequired: false,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'plugin.enable',
    module: 'plugin',
    level: 'high',
    title: '启用插件',
    description: '会让插件扩展点生效，需要记录操作人与插件版本。',
    approvalRequired: false,
    verificationRequired: true,
    batchSensitive: false
  },
  {
    action: 'plugin.disable',
    module: 'plugin',
    level: 'medium',
    title: '停用插件',
    description: '可能影响插件提供的业务能力。',
    approvalRequired: false,
    verificationRequired: false,
    batchSensitive: false
  },
  {
    action: 'plugin.delete',
    module: 'plugin',
    level: 'high',
    title: '卸载插件',
    description: '可能移除插件资产和配置。',
    approvalRequired: false,
    verificationRequired: true,
    batchSensitive: false
  }
]

const RISK_LEVEL_RANK: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

const MODULE_DEFAULT_RISK: Record<string, RiskLevel> = {
  system: 'medium',
  billing: 'medium',
  host: 'medium',
  package: 'medium',
  plugin: 'medium',
  user: 'medium',
  instance: 'low',
  security: 'low',
  auth: 'low'
}

function getOperationDefinition(log: RiskAuditLogInput): RiskOperationDefinition | undefined {
  return RISK_OPERATION_DEFINITIONS.find(definition =>
    definition.action === log.action &&
    (!definition.module || definition.module === log.module)
  )
}

export function classifyLogRisk(log: RiskAuditLogInput): {
  riskLevel: RiskLevel
  riskTitle: string
  approvalRequired: boolean
  verificationRequired: boolean
  batchSensitive: boolean
} {
  const definition = getOperationDefinition(log)
  if (definition) {
    return {
      riskLevel: definition.level,
      riskTitle: definition.title,
      approvalRequired: definition.approvalRequired,
      verificationRequired: definition.verificationRequired,
      batchSensitive: definition.batchSensitive
    }
  }

  const defaultLevel = MODULE_DEFAULT_RISK[log.module] ?? 'low'
  const isFailed = /failed|失败|error|异常/i.test(log.content ?? '')
  const riskLevel = isFailed && RISK_LEVEL_RANK[defaultLevel] < RISK_LEVEL_RANK.medium ? 'medium' : defaultLevel

  return {
    riskLevel,
    riskTitle: riskLevel === 'low' ? '普通操作' : '需关注操作',
    approvalRequired: false,
    verificationRequired: false,
    batchSensitive: false
  }
}

export function getRiskOperationDefinitions(): RiskOperationDefinition[] {
  return RISK_OPERATION_DEFINITIONS
}

function maskEmail(value: string): string {
  return value.replace(/\b([A-Z0-9._%+-])([A-Z0-9._%+-]*)(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi, (_match, first: string, rest: string, domain: string) => {
    const hidden = rest.length > 1 ? '*'.repeat(Math.min(rest.length, 6)) : '*'
    return `${first}${hidden}${domain}`
  })
}

function maskIpv4(value: string): string {
  return value.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (_match, a: string, b: string, c: string) => {
    return `${a}.${b}.${c}.*`
  })
}

function maskIpv6(value: string): string {
  return value.replace(/\b(?:[a-f0-9]{1,4}:){2,7}[a-f0-9]{1,4}\b/gi, '[IPv6已脱敏]')
}

export function redactAuditText(value: string | null | undefined): string {
  if (!value) return ''
  return maskIpv6(maskIpv4(maskEmail(sanitizeTokensInString(value))))
}

export function isRiskLevelAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_LEVEL_RANK[level] >= RISK_LEVEL_RANK[threshold]
}
