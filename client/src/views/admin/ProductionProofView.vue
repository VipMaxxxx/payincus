<script setup lang="ts">
import { computed, ref } from 'vue'
import { useToast } from '@/stores/toast'

type ProofStatus = 'verified' | 'partial' | 'pending' | 'operator' | 'waived'
type RiskLevel = 'low' | 'medium' | 'high'

type ProofItem = {
  key: string
  title: string
  status: ProofStatus
  risk: RiskLevel
  evidence: string
  safeNote: string
}

type CommandItem = {
  title: string
  description: string
  command: string
}

const toast = useToast()
const copiedKey = ref<string | null>(null)

const proofItems: ProofItem[] = [
  {
    key: 'payment',
    title: '真实支付下单与回调',
    status: 'verified',
    risk: 'high',
    evidence: '生产账本已有真实充值、provider 交易号、回调时间和处理记录 proof；新增或变更支付渠道后必须复核。',
    safeNote: '只记录订单状态、金额匹配、回调处理结果和脱敏引用。'
  },
  {
    key: 'incus',
    title: 'Incus 完整生命周期',
    status: 'verified',
    risk: 'high',
    evidence: '专用生产测试实例已完成 stop、start、restart、recreate、delete、清理和资源释放 proof。',
    safeNote: '只记录测试实例、任务/日志编号和清理结果；不触碰客户实例。'
  },
  {
    key: 'terminal',
    title: 'Web terminal /api/ws',
    status: 'verified',
    risk: 'medium',
    evidence: '生产审计已记录 WebSocket terminal connect/disconnect proof，公开 invalid-ticket verifier 也通过。',
    safeNote: '只记录连接成功和会话引用，不记录终端敏感输出。'
  },
  {
    key: 'agent',
    title: '生产 Agent 心跳与上报',
    status: 'verified',
    risk: 'medium',
    evidence: '生产审计已记录 Agent 在线、资源、实例和流量上报 proof；新增宿主机需复核。',
    safeNote: '不记录 Agent secret、安装 Token、宿主机 URL 或证书路径。'
  },
  {
    key: 'smtp',
    title: 'SMTP 真实投递',
    status: 'verified',
    risk: 'medium',
    evidence: '生产 SMTP provider reference 已记录，投递侧证据已从最终 blocker 中移除。',
    safeNote: '记录测试收件引用、发送时间和成功状态，不记录 SMTP 密码。'
  },
  {
    key: 'lsky',
    title: 'Lsky 图片上传',
    status: 'waived',
    risk: 'medium',
    evidence: '上传和 providerFileId 保留已证明；删除/清理 proof 按运营方决定不纳入最终 Go 阻塞项。最新 preflight 仍显示 token 仅有 upload:write，缺 user:photo:read / user:photo:write，user-gallery API 返回 403。',
    safeNote: '不要记录为已删除；如后续重新纳入范围，先配置 delete-capable token 或 provider 侧清理证明。'
  },
  {
    key: 'notification',
    title: 'Telegram / 站内通知投递',
    status: 'verified',
    risk: 'medium',
    evidence: 'Telegram 生产机器人已向公开群组 @Payincus 投递 proof 消息并返回 message_id。',
    safeNote: '记录渠道名称或脱敏 ID、发送时间、后台状态和外部回执。'
  },
  {
    key: 'turnstile',
    title: 'Turnstile 与登录会话',
    status: 'verified',
    risk: 'high',
    evidence: '已完成经授权的临时 disable-and-restore 登录 smoke；用户和管理员页面均通过会话渲染，配置已恢复。',
    safeNote: '不记录密码、Turnstile token、session cookie 或 JWT。'
  },
  {
    key: 'rollback',
    title: 'OTA 后回滚复核',
    status: 'operator',
    risk: 'high',
    evidence: '只在维护窗口执行，不能在业务高峰临时触发。',
    safeNote: '记录任务编号、from/to 版本、结果和健康检查，不记录服务器凭据。'
  },
  {
    key: 'exchange',
    title: '交易所真实交割闭环',
    status: 'operator',
    risk: 'high',
    evidence: '本地构建、全站守卫和交易所专项守卫已通过；生产仍需实际跑通暂停实例挂牌、余额购买、托管、强制重装、匿名交割、确认期结算、提现审核和争议/退款路径。',
    safeNote: '只记录测试实例、订单/任务/流水编号、脱敏状态截图或日志引用；不得记录买卖双方身份、实例原数据、root 密码、SSH 私钥或完整回调内容。'
  },
  {
    key: 'backup',
    title: '备份恢复演练',
    status: 'verified',
    risk: 'high',
    evidence: '已通过临时数据库完成生产 DB 备份恢复演练，恢复后校验表和关键记录计数，并清理临时库。',
    safeNote: '后续只需在重大数据库结构变更后重新演练；不能覆盖生产数据。'
  }
]

const commands: CommandItem[] = [
  {
    title: '只读 proof 快照',
    description: '在生产服务器执行，输出可分享的脱敏 JSON，用于确认支付、Agent、实例、流量、SMTP/Lsky 配置和缺失动作。',
    command: [
      'cd /opt/incudal/current',
      'ENV_FILE=/opt/incudal/.env PROOF_SINCE_HOURS=24 pnpm verify:production-proof-snapshot'
    ].join('\n')
  },
  {
    title: '生产预检',
    description: '确认生产配置、健康检查和基础安全项。执行结果可作为最终验收 report 的自动检查部分。',
    command: [
      'cd /opt/incudal/current',
      'ENV_FILE=/opt/incudal/.env FRONTEND_URL=https://pay.payincus.com BACKEND_URL=https://pay.payincus.com pnpm verify:production'
    ].join('\n')
  },
  {
    title: 'Lsky 只读预检',
    description: '可选复核：仅当 Lsky 删除/清理 proof 重新纳入范围时，确认 token 是否具备 user:photo:read / user:photo:write。',
    command: [
      'cd /opt/incudal/current',
      'ENV_FILE=/opt/incudal/.env NODE_ENV=production node server/dist/scripts/lsky-production-proof.js'
    ].join('\n')
  },
  {
    title: '交易所 live E2E 记录模板',
    description: '在维护窗口用测试账号和测试实例执行。先完成生产预检和数据库检查，再记录交易所真实交割闭环的脱敏 proof。',
    command: [
      'cd /opt/incudal/current',
      'ENV_FILE=/opt/incudal/.env pnpm verify:production',
      'ENV_FILE=/opt/incudal/.env pnpm --filter server verify:production-db',
      '# 记录以下脱敏 proof：',
      '# 1. 卖家测试实例已暂停并通过交易所检测',
      '# 2. 挂牌创建成功，实例显示交易所挂牌中且启动/重装/删除/续费/快照/网络变更被锁定',
      '# 3. 买家余额购买成功，买家扣款和托管流水存在',
      '# 4. 交割任务完成强制重装、匿名重命名、owner 转移、买家账单重建，并确认已用流量和剩余额度原样保留',
      '# 5. 确认期结束后托管款扣费放款到卖家交易所余额',
      '# 6. 提现进入人工审核；争议、退款、重试或人工接管路径至少完成一条测试 proof'
    ].join('\n')
  },
  {
    title: '最终验收 report 模板',
    description: '把真实 proof refs 填成脱敏工单、日志或截图编号。占位符不能用于最终通过。',
    command: [
      'cd /opt/incudal/current',
      'FRONTEND_URL=https://pay.payincus.com \\',
      'BACKEND_URL="$PRODUCTION_BACKEND_LOOPBACK_URL" \\',
      'LIVE_ACCEPTANCE_REPORT=/tmp/incudal-proof/final-acceptance.md \\',
      'LIVE_PAYMENT_PROOF_REF="payment proof ref" \\',
      'LIVE_INCUS_PROOF_REF="incus lifecycle proof ref" \\',
      'LIVE_AGENT_PROOF_REF="agent report proof ref" \\',
      'LIVE_MAIL_PROOF_REF="smtp/notification proof ref" \\',
      'LIVE_LSKY_CLEANUP_WAIVER_REF="operator waiver ref" \\',
      'LIVE_LOG_HEADER_PROOF_REF="log/header proof ref" \\',
      'REQUIRE_LIVE_PROOF_REFS=1 pnpm verify:live-acceptance'
    ].join('\n')
  }
]

const proofStats = computed(() => {
  const total = proofItems.length
  const verified = proofItems.filter(item => item.status === 'verified').length
  const partial = proofItems.filter(item => item.status === 'partial').length
  const pending = proofItems.filter(item => item.status === 'pending').length
  const operator = proofItems.filter(item => item.status === 'operator').length
  const waived = proofItems.filter(item => item.status === 'waived').length
  return { total, verified, partial, pending, operator, waived }
})

const closedProofItems = computed(() => proofStats.value.verified + proofStats.value.waived)
const remainingProofItems = computed(() => proofStats.value.partial + proofStats.value.pending)
const attentionProofItems = computed(() => remainingProofItems.value + proofStats.value.operator)
const progressPercent = computed(() => Math.round((closedProofItems.value / proofStats.value.total) * 100))

function statusLabel(status: ProofStatus): string {
  const labels: Record<ProofStatus, string> = {
    verified: '已证明',
    partial: '部分证明',
    pending: '待补证据',
    operator: '需操作窗口',
    waived: '已豁免'
  }
  return labels[status]
}

function statusClass(status: ProofStatus): string {
  const classes: Record<ProofStatus, string> = {
    verified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    partial: 'border-blue-200 bg-blue-50 text-blue-700',
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    operator: 'border-rose-200 bg-rose-50 text-rose-700',
    waived: 'border-slate-200 bg-slate-50 text-slate-700'
  }
  return classes[status]
}

function riskLabel(risk: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险'
  }
  return labels[risk]
}

function riskClass(risk: RiskLevel): string {
  const classes: Record<RiskLevel, string> = {
    low: 'text-emerald-600',
    medium: 'text-amber-600',
    high: 'text-rose-600'
  }
  return classes[risk]
}

async function copyCommand(key: string, command: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(command)
    copiedKey.value = key
    toast.success('命令已复制')
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 1600)
  } catch {
    toast.error('复制失败，请手动选择命令')
  }
}
</script>

<template>
  <div class="kawaii-page page-container animate-fade-in">
    <div class="page-header">
      <div>
        <h1 class="page-title">生产验收</h1>
        <p class="page-description">按真实业务链路收口生产 proof。此页面只读，不会执行支付、资源删除、Turnstile 变更或 OTA 回滚。</p>
      </div>
      <RouterLink to="/admin/system-update" class="btn-secondary">
        查看版本更新
      </RouterLink>
    </div>

    <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
      <div class="rounded-lg border border-themed bg-themed-surface p-5">
        <div class="text-sm text-themed-muted">生产 proof 收口</div>
        <div class="mt-2 text-3xl font-semibold text-themed">{{ progressPercent }}%</div>
        <div class="mt-2 h-2 rounded-full bg-themed-muted">
          <div class="h-2 rounded-full bg-blue-500" :style="{ width: `${progressPercent}%` }"></div>
        </div>
        <div class="mt-2 text-xs text-themed-muted">{{ closedProofItems }}/{{ proofStats.total }} 项已证明或已豁免</div>
      </div>
      <div class="rounded-lg border border-themed bg-themed-surface p-5">
        <div class="text-sm text-themed-muted">已证明证据</div>
        <div class="mt-2 text-3xl font-semibold text-themed">{{ proofStats.verified }}</div>
        <div class="mt-2 text-xs text-themed-muted">历史 proof 仍需跟随版本和配置变化复核</div>
      </div>
      <div class="rounded-lg border border-themed bg-themed-surface p-5">
        <div class="text-sm text-themed-muted">待补 / 需操作</div>
        <div class="mt-2 text-3xl font-semibold text-themed">{{ attentionProofItems }}</div>
        <div class="mt-2 text-xs text-themed-muted">不等同于最终 Go blocker，需按状态分账处理</div>
      </div>
      <div class="rounded-lg border border-themed bg-themed-surface p-5">
        <div class="text-sm text-themed-muted">已豁免 / 维护窗口</div>
        <div class="mt-2 text-3xl font-semibold text-themed">{{ proofStats.waived }} / {{ proofStats.operator }}</div>
        <div class="mt-2 text-xs text-themed-muted">豁免项和维护窗口不得写成已执行 proof</div>
      </div>
    </section>

    <section class="mt-6 rounded-lg border border-themed bg-themed-surface">
      <div class="border-b border-themed px-5 py-4">
        <h2 class="text-lg font-semibold text-themed">执行顺序</h2>
        <p class="mt-1 text-sm text-themed-muted">先只读，再低风险投递，最后处理会产生费用、资源或会话影响的操作。</p>
      </div>
      <div class="grid grid-cols-1 divide-y divide-themed md:grid-cols-3 md:divide-x md:divide-y-0">
        <div class="p-5">
          <div class="text-sm font-semibold text-themed">1. 只读快照</div>
          <p class="mt-2 text-sm text-themed-muted">运行脱敏 proof 快照、生产预检、日志和安全头检查，确认当前环境基线。</p>
        </div>
        <div class="p-5">
          <div class="text-sm font-semibold text-themed">2. 真实投递 proof</div>
          <p class="mt-2 text-sm text-themed-muted">SMTP 与 Telegram 已证明；Lsky 删除清理 proof 已按运营方决定排除出最终阻塞项。</p>
        </div>
        <div class="p-5">
          <div class="text-sm font-semibold text-themed">3. 高风险业务 proof</div>
          <p class="mt-2 text-sm text-themed-muted">支付、Incus 生命周期和终端已有测试证据；交易所真实交割和回滚复核只在维护窗口执行。</p>
        </div>
      </div>
    </section>

    <section class="mt-6 rounded-lg border border-themed bg-themed-surface">
      <div class="border-b border-themed px-5 py-4">
        <h2 class="text-lg font-semibold text-themed">Proof 清单</h2>
        <p class="mt-1 text-sm text-themed-muted">状态只代表当前账本口径，最终通过必须以生产日志、后台页面、数据库脱敏摘要或用户提供输出为准。</p>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-themed text-sm">
          <thead class="bg-themed-muted/40 text-left text-xs uppercase text-themed-muted">
            <tr>
              <th class="px-5 py-3">项目</th>
              <th class="px-5 py-3">状态</th>
              <th class="px-5 py-3">风险</th>
              <th class="px-5 py-3">当前证据口径</th>
              <th class="px-5 py-3">记录要求</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr v-for="item in proofItems" :key="item.key" class="align-top">
              <td class="px-5 py-4 font-medium text-themed">{{ item.title }}</td>
              <td class="px-5 py-4">
                <span class="inline-flex rounded-full border px-2.5 py-1 text-xs font-medium" :class="statusClass(item.status)">
                  {{ statusLabel(item.status) }}
                </span>
              </td>
              <td class="px-5 py-4 font-medium" :class="riskClass(item.risk)">{{ riskLabel(item.risk) }}</td>
              <td class="max-w-md px-5 py-4 text-themed-muted">{{ item.evidence }}</td>
              <td class="max-w-md px-5 py-4 text-themed-muted">{{ item.safeNote }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div v-for="command in commands" :key="command.title" class="rounded-lg border border-themed bg-themed-surface">
        <div class="border-b border-themed px-5 py-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold text-themed">{{ command.title }}</h3>
              <p class="mt-1 text-sm text-themed-muted">{{ command.description }}</p>
            </div>
            <button class="btn-secondary whitespace-nowrap" @click="copyCommand(command.title, command.command)">
              {{ copiedKey === command.title ? '已复制' : '复制' }}
            </button>
          </div>
        </div>
        <pre class="m-0 overflow-x-auto rounded-b-lg bg-black p-4 text-xs leading-6 text-green-100"><code>{{ command.command }}</code></pre>
      </div>
    </section>

    <section class="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <h2 class="font-semibold">禁止写入审计记录的内容</h2>
      <p class="mt-2">
        不要记录服务器密码、API secret、支付密钥、SMTP 密码、Telegram token、Lsky token、完整回调 payload、
        Turnstile token、session cookie、JWT、实例 root 密码、宿主机 URL、证书路径或用户隐私明文。
      </p>
    </section>
  </div>
</template>
