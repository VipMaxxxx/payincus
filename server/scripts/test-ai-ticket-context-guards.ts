import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/tickets.ts'), 'utf8')
const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/ai-ticket-context.ts'), 'utf8')
const autoReplySchedulerSource = readFileSync(resolve(process.cwd(), 'src/services/ai-ticket-auto-reply-scheduler.ts'), 'utf8')
const appSource = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8')
const clientApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const ticketsViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/TicketsView.vue'), 'utf8')
const clientTypesSource = readFileSync(resolve(process.cwd(), '../client/src/types/api.ts'), 'utf8')
const pluginSettingsSource = readFileSync(resolve(process.cwd(), '../plugin-templates/ai-ticket-agent-plugin/dist/admin/settings.html'), 'utf8')
const pluginManifestSource = readFileSync(resolve(process.cwd(), '../plugin-templates/ai-ticket-agent-plugin/payincus.plugin.json'), 'utf8')
const pluginDefaultConfigSource = readFileSync(resolve(process.cwd(), '../plugin-templates/ai-ticket-agent-plugin/templates/default-config.json'), 'utf8')

assert.ok(
    serviceSource.includes("AI_TICKET_AGENT_PLUGIN_ID = 'com.payincus.ai-ticket-agent'") &&
    serviceSource.includes("AI_TICKET_CONTEXT_PERMISSION = 'ticket:ai:read-context'") &&
    serviceSource.includes("AI_TICKET_DRAFT_PERMISSION = 'ticket:ai:generate-draft'") &&
    serviceSource.includes("AI_TICKET_REPLY_PERMISSION = 'ticket:ai:reply'") &&
    serviceSource.includes('getAiTicketPermission(permission') &&
    serviceSource.includes('getAiTicketContextPermission') &&
    serviceSource.includes("plugin.status !== 'enabled'") &&
    serviceSource.includes('permissions.includes(permission)') &&
    serviceSource.includes('return getAiTicketPermission(AI_TICKET_CONTEXT_PERMISSION)'),
  'AI ticket context and draft permissions must require the enabled AI ticket plugin and explicit permissions'
)

assert.ok(
  routeSource.includes("fastify.post<{\n    Params: { id: string }\n  }>('/:id/ai/context'") &&
    routeSource.includes('onRequest: [fastify.authenticate, fastify.requireAdmin]') &&
    routeSource.includes('getAiTicketContextPermission') &&
    routeSource.includes('buildAiTicketContext(ticketId)') &&
    routeSource.includes('auditAiTicketContextRead'),
  'AI ticket context endpoint must be POST-only, admin-authenticated, plugin-gated and audited'
)

assert.ok(
  routeSource.includes("}>('/:id/ai/draft'") &&
    routeSource.includes('getAiTicketPermission(AI_TICKET_DRAFT_PERMISSION)') &&
    routeSource.includes('generateAiTicketDraft(ticketId)') &&
    routeSource.includes("code: 'AI_TICKET_DRAFT_BLOCKED'") &&
    routeSource.includes("action: 'ai_ticket.draft_generate'") === false,
  'AI ticket draft endpoint must be plugin-gated, safety-aware and keep audit logic in the service'
)

assert.ok(
  routeSource.includes("fastify.get('/ai/status'") &&
    routeSource.includes('onRequest: [fastify.authenticate, fastify.requireAdmin]') &&
    routeSource.includes('getAiTicketAutomationStatus()') &&
    routeSource.includes('modelConfigured: automation.modelConfigured') &&
    routeSource.includes('confidenceThreshold: automation.confidenceThreshold') &&
    routeSource.includes('autoReplyActive') &&
    routeSource.includes("'official_system_tickets_only'") &&
    !routeSource.slice(routeSource.indexOf("fastify.get('/ai/status'"), routeSource.indexOf('获取工单详情')).includes('apiBaseUrl') &&
    !routeSource.slice(routeSource.indexOf("fastify.get('/ai/status'"), routeSource.indexOf('获取工单详情')).includes('apiKey'),
  'AI ticket status endpoint must be admin-only, safe, automation-aware, and must not expose model endpoint or API key'
)

const draftRouteIndex = routeSource.indexOf("}>('/:id/ai/draft'")
const nextRouteIndex = routeSource.indexOf('发送管理员已审核/编辑的 AI 草稿', draftRouteIndex)
assert.notEqual(draftRouteIndex, -1, 'AI draft route not found')
assert.notEqual(nextRouteIndex, -1, 'AI draft route end marker not found')
const draftRouteSection = routeSource.slice(draftRouteIndex, nextRouteIndex)
assert.ok(
  draftRouteSection.includes('onRequest: [fastify.authenticate, fastify.requireAdmin]') &&
    draftRouteSection.includes('AI_TICKET_DRAFT_PERMISSION') &&
    !draftRouteSection.includes('ticketDb.addTicketMessage') &&
    !draftRouteSection.includes('updateTicketStatus'),
  'AI draft route must require admin auth and must not send messages or mutate ticket status'
)

assert.ok(
  routeSource.includes("}>('/:id/ai/reply'") &&
    routeSource.includes('getAiTicketPermission(AI_TICKET_REPLY_PERMISSION)') &&
    routeSource.includes('validateAiTicketReviewedReply(ticketId, reviewedBody)') &&
    routeSource.includes("Body: { reviewedBody?: string }") &&
    routeSource.includes("code: 'AI_TICKET_REVIEWED_BODY_REQUIRED'") &&
    routeSource.includes('auditAiTicketReply') &&
    routeSource.includes("AI_TICKET_AGENT_REPLY_MODE_DISABLED") &&
    routeSource.includes("AI_TICKET_REPLY_HANDOFF_REQUIRED") &&
    routeSource.includes("code: 'AI_TICKET_REPLY_BLOCKED'") &&
    routeSource.includes('confidence: result.confidence'),
  'AI reply endpoint must require a reviewed body, the separate reply permission, mode gate, safety checks and audit logging'
)

const replyRouteIndex = routeSource.indexOf("}>('/:id/ai/reply'")
const internalNoteRouteIndex = routeSource.indexOf('创建内部备注', replyRouteIndex)
assert.notEqual(replyRouteIndex, -1, 'AI reply route not found')
assert.notEqual(internalNoteRouteIndex, -1, 'AI reply route end marker not found')
const replyRouteSection = routeSource.slice(replyRouteIndex, internalNoteRouteIndex)
assert.ok(
  replyRouteSection.includes('onRequest: [fastify.authenticate, fastify.requireAdmin]') &&
    replyRouteSection.includes('AI_TICKET_REPLY_PERMISSION') &&
    replyRouteSection.includes('const reviewedBody = sanitizeContent(request.body?.reviewedBody)') &&
    replyRouteSection.includes('validateAiTicketReviewedReply(ticketId, reviewedBody)') &&
    !replyRouteSection.includes('generateAiTicketReply(') &&
    replyRouteSection.includes('ticketDb.addTicketMessage(ticketId, user.id, result.draft, true, [])') &&
    replyRouteSection.includes('sendNotification(ticket.userId') &&
    !replyRouteSection.includes('updateTicketStatus'),
  'AI reply route must send only as an admin support message, notify the user and avoid changing ticket status'
)

assert.ok(
  serviceSource.includes('where: { id: ticketId }') &&
    serviceSource.includes('where: { userId: ticket.userId }') &&
    serviceSource.includes('loadAiVisibleInstances(ticket.userId, ticket.instanceId)') &&
    serviceSource.includes('id: linkedInstanceId,\n          userId,') &&
    !serviceSource.includes('userId: request') &&
    !serviceSource.includes('userId: input') &&
    !serviceSource.includes('userId: body'),
  'AI context queries must derive user scope from ticket.userId, not caller-supplied user IDs'
)

assert.ok(
  serviceSource.includes("dataScope: 'ticket_user_only'") &&
    serviceSource.includes("redaction: 'ai_safe_summary'") &&
    serviceSource.includes('forbiddenData') &&
    serviceSource.includes('admin_internal_notes') &&
    serviceSource.includes('payment_callback_payloads') &&
    serviceSource.includes('root_passwords') &&
    serviceSource.includes('other_users_data'),
  'AI context must declare its scoped, redacted data policy'
)

assert.ok(
  serviceSource.includes('decryptSensitiveData') &&
    serviceSource.includes("configs.set(row.key, row.isSecret ? parseSecretConfigValue(row.valueEncrypted) : row.valueJson)") &&
    serviceSource.includes("apiKey: getConfigString(configs, 'apiKey')") &&
    serviceSource.includes('Authorization: `Bearer ${config.apiKey}`') &&
    serviceSource.includes('inspectAiDraftSafety') &&
    serviceSource.includes('inspectAiReplySendEligibility') &&
    serviceSource.includes("autoReplyCategories: getConfigStringArray(configs, 'autoReplyCategories'") &&
    serviceSource.includes("confidenceThreshold: Math.min(Math.max(getConfigNumber(configs, 'confidenceThreshold'") &&
    serviceSource.includes("sensitiveHandoffRules: resolveSensitiveHandoffRules(configs.get('sensitiveHandoffRules'))") &&
    serviceSource.includes('for (const rule of config.sensitiveHandoffRules)') &&
    serviceSource.includes('SENSITIVE_HANDOFF_RULES[rule]') &&
    serviceSource.includes('buildAiTicketDecisionPrompt') &&
    serviceSource.includes('parseAiDecisionJson') &&
    serviceSource.includes('handoffWhenInsufficientContext') &&
    serviceSource.includes('AI_TICKET_MODEL_DECISION_INVALID') &&
    serviceSource.includes('confidence_below_threshold') &&
    serviceSource.includes('model_handoff_required') &&
    serviceSource.includes("dailyAutoReplyLimit: Math.max(Math.floor(getConfigNumber(configs, 'dailyAutoReplyLimit'") &&
    serviceSource.includes("ticketAutoReplyLimit: Math.max(Math.floor(getConfigNumber(configs, 'ticketAutoReplyLimit'") &&
    serviceSource.includes("cooldownSeconds: Math.max(Math.floor(getConfigNumber(configs, 'cooldownSeconds'") &&
    serviceSource.includes('category_not_allowed_for_auto_reply') &&
    serviceSource.includes('inspectAiReplySendLimits') &&
    serviceSource.includes('daily_auto_reply_limit_reached') &&
    serviceSource.includes('ticket_auto_reply_limit_reached') &&
    serviceSource.includes('ticket_auto_reply_cooldown_active') &&
    serviceSource.includes('refund_or_dispute_requires_handoff') &&
    serviceSource.includes('credential_or_backend_request_requires_handoff') &&
    serviceSource.includes('generateAiTicketDraft') &&
    serviceSource.includes('generateAiTicketReply'),
  'AI draft and reply generation must read encrypted plugin config server-side, safety-check output, and enforce handoff rules before sending'
)

assert.ok(
  serviceSource.includes('export function resolveSensitiveHandoffRules(value: unknown)') &&
    serviceSource.includes('if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_SENSITIVE_HANDOFF_RULES]') &&
    serviceSource.includes("normalized.some(item => !Object.prototype.hasOwnProperty.call(SENSITIVE_HANDOFF_RULES, item))") &&
    serviceSource.includes('return Array.from(new Set(normalized)) as SensitiveHandoffRule[]'),
  'sensitiveHandoffRules must be configurable and malformed values must fall back to the complete default rule set'
)

assert.ok(
  pluginManifestSource.includes('"sensitiveHandoffRules"') &&
    pluginManifestSource.includes('"credential_or_backend_request"') &&
    pluginDefaultConfigSource.includes('"sensitiveHandoffRules"') &&
    pluginDefaultConfigSource.includes('"credential_or_backend_request"'),
  'AI ticket plugin configuration must expose the complete sensitive handoff rule defaults'
)

const forbiddenSelections = [
  'callbackData',
  'providerConfigSnapshot',
  'paymentDetails',
  'tradeNo',
  'failReason',
  'rootPassword',
  'incusId',
  'hostId: true',
  'host: {',
  'twoFactorSecret',
  'twoFactorRecoveryCodes',
  'email: true',
  'ip: true',
  'userAgent: true',
  'ticketInternalNote',
  'internalNotes',
  'lastError'
]

for (const forbidden of forbiddenSelections) {
  assert.ok(
    !serviceSource.includes(forbidden),
    `AI context service must not select or expose sensitive field marker: ${forbidden}`
  )
}

const forbiddenOperations = [
  'adjustBalance',
  'changeBalance',
  'deleteInstance',
  'destroyInstance',
  'createInstanceAsync',
  'updateTicketStatus(',
  'addTicketMessage('
]

for (const operation of forbiddenOperations) {
  assert.ok(
    !serviceSource.includes(operation),
    `AI context service must stay read-only and avoid operation marker: ${operation}`
  )
}

assert.ok(
  serviceSource.includes('orderRef: maskIdentifier(payment.orderNo)') &&
    serviceSource.includes('providerName: payment.provider.name') &&
    !serviceSource.includes('config: true'),
  'Payment context must expose masked order references and provider display names only'
)

assert.ok(
  serviceSource.includes('export async function getAiTicketAutomationStatus') &&
    serviceSource.includes('mode: config.mode') &&
    serviceSource.includes('modelConfigured: Boolean(config.apiBaseUrl && config.apiKey)') &&
    serviceSource.includes('autoReplyCategories: config.autoReplyCategories') &&
    serviceSource.includes('confidenceThreshold: config.confidenceThreshold') &&
    serviceSource.includes('dailyAutoReplyLimit: config.dailyAutoReplyLimit'),
  'AI ticket service must expose safe automation status without exposing model secrets'
)

assert.ok(
  serviceSource.includes("export type AiTicketReplyTrigger = 'manual' | 'scheduler'") &&
    serviceSource.includes('generateAiTicketReplyCandidate(ticketId: number, trigger: AiTicketReplyTrigger)') &&
    serviceSource.includes("trigger: AiTicketReplyTrigger = 'manual'") &&
    serviceSource.includes("trigger === 'scheduler' && config.mode !== 'draft' ? await inspectAiReplySendLimits(ticketId, config) : []") &&
    serviceSource.includes("const schedulerMarker = '[trigger=scheduler]'") &&
    serviceSource.includes('const ticketMarker = getAiTicketSchedulerAuditMarker(ticketId)') &&
    serviceSource.includes('return `ticket #${ticketId} [trigger=scheduler]`') &&
    serviceSource.includes("const triggerDetail = input.trigger === 'scheduler' ? ' [trigger=scheduler]' : ''") &&
    (serviceSource.match(/action: 'ai_ticket\.reply_send'/g) ?? []).length === 3 &&
    (autoReplySchedulerSource.match(/trigger: 'scheduler'/g) ?? []).length === 4 &&
    replyRouteSection.includes('validateAiTicketReviewedReply(ticketId, reviewedBody)') &&
    !replyRouteSection.includes('generateAiTicketReply(') &&
    autoReplySchedulerSource.includes("generateAiTicketReply(ticketId, 'scheduler')") &&
    autoReplySchedulerSource.includes("trigger: 'scheduler'"),
  'Auto reply limits and cooldown must apply and count scheduler sends only, while admin-triggered replies stay manual and unlimited'
)

const ticketOneMarker = 'ticket #1 [trigger=scheduler]'
for (const otherTicketId of [10, 100]) {
  assert.equal(
    `AI ticket reply success for ticket #${otherTicketId} [trigger=scheduler]`.includes(ticketOneMarker),
    false,
    `scheduler ticket #1 quota/cooldown marker must not match ticket #${otherTicketId}`
  )
}

assert.ok(
  pluginSettingsSource.includes('/api/tickets/ai/status') &&
    pluginSettingsSource.includes("window.localStorage.getItem('token')") &&
    pluginSettingsSource.includes('function escapeHtml') &&
    pluginSettingsSource.includes('${escapeHtml(value)}') &&
    pluginSettingsSource.includes('状态接口不会返回模型地址、密钥、后台路径或用户数据') &&
    pluginSettingsSource.includes('自动接管激活') &&
    pluginSettingsSource.includes('置信度阈值'),
  'AI ticket plugin settings page must show safe operational status without exposing secrets'
)

assert.ok(
  autoReplySchedulerSource.includes('let schedulerStarted = false') &&
    autoReplySchedulerSource.includes('export function startAiTicketAutoReplyScheduler') &&
    autoReplySchedulerSource.includes("schedule('*/2 * * * *'") &&
    autoReplySchedulerSource.includes('getAiTicketPermission(AI_TICKET_REPLY_PERMISSION)') &&
    autoReplySchedulerSource.includes("status.mode !== 'auto'") &&
    autoReplySchedulerSource.includes("role: 'admin'") &&
    autoReplySchedulerSource.includes("status: 'active'") &&
    autoReplySchedulerSource.includes("OR: [\n        { hostId: null },\n        { host: { user: { role: 'admin' } } }") &&
    autoReplySchedulerSource.includes("ticket.messages[0]?.isFromOwner === false") &&
    autoReplySchedulerSource.includes('isStillAutoReplyEligible(ticketId)') &&
    autoReplySchedulerSource.includes("generateAiTicketReply(ticketId, 'scheduler')") &&
    autoReplySchedulerSource.includes("where: { action: 'ai_ticket.needs_human' }") &&
    autoReplySchedulerSource.includes('id: { notIn: needsHumanTicketIds }') &&
    (autoReplySchedulerSource.match(/await markTicketNeedsHuman\(actor\.id, ticketId, reason\)/g) ?? []).length === 2 &&
    autoReplySchedulerSource.includes('ticketDb.addTicketMessage(ticketId, actor.id, result.draft, true, [])') &&
    autoReplySchedulerSource.includes('sendNotification(ticket.userId') &&
    autoReplySchedulerSource.includes('ai_ticket.auto_reply') &&
    !autoReplySchedulerSource.includes('updateTicketStatus'),
  'AI auto reply scheduler must be idempotent, plugin-gated, auto-mode-only, official-ticket-only, last-message-checked, audited and status-neutral'
)

assert.ok(
  appSource.includes("import('./services/ai-ticket-auto-reply-scheduler.js')") &&
    appSource.includes('startAiTicketAutoReplyScheduler()'),
  'Server startup must register the AI ticket auto reply scheduler'
)

assert.ok(
  clientTypesSource.includes('export interface TicketAiDraftResponse') &&
    clientTypesSource.includes('export interface TicketAiReplyResponse') &&
    clientTypesSource.includes('confidence: number') &&
    clientTypesSource.includes('confidenceThreshold: number') &&
    clientApiSource.includes('generateAiDraft') &&
    clientApiSource.includes("http.post(`/tickets/${id}/ai/draft`, {}, { timeout: TIMEOUT.MEDIUM })") &&
    clientApiSource.includes('sendAiReply') &&
    clientApiSource.includes("http.post(`/tickets/${id}/ai/reply`, {}, { timeout: TIMEOUT.MEDIUM })") &&
    adminApiSource.includes('generateAiDraft') &&
    adminApiSource.includes("http.post(`/tickets/${id}/ai/draft`, {}, { timeout: TIMEOUT.MEDIUM })") &&
    adminApiSource.includes('sendAiReply') &&
    adminApiSource.includes("http.post(`/tickets/${id}/ai/reply`, {}, { timeout: TIMEOUT.MEDIUM })") &&
    ticketsViewSource.includes('aiDraftLoading') &&
    ticketsViewSource.includes('aiReplyLoading') &&
    ticketsViewSource.includes('generateAiDraft') &&
    ticketsViewSource.includes('sendAiReply') &&
    ticketsViewSource.includes('requestAiDraft(selectedTicket.value.id)') &&
    ticketsViewSource.includes('requestAiReply(selectedTicket.value.id, reviewedBody)') &&
    ticketsViewSource.includes("postTicketAiAction<TicketAiDraftResponse>(ticketId, 'draft')") &&
    ticketsViewSource.includes("postTicketAiAction<TicketAiReplyResponse>(ticketId, 'reply', { reviewedBody })") &&
    ticketsViewSource.includes('body: JSON.stringify(body)') &&
    ticketsViewSource.includes('const reviewedBody = replyContent.value.trim()') &&
    ticketsViewSource.includes('!selectedTicket || !replyContent.trim()') &&
    ticketsViewSource.includes("buildApiUrl(`/tickets/${ticketId}/ai/${action}`)") &&
    ticketsViewSource.includes('Authorization: `Bearer ${authStore.token}`') &&
    ticketsViewSource.includes("code === 'AI_TICKET_REPLY_HANDOFF_REQUIRED'") &&
    ticketsViewSource.includes('replyContent.value = result.draft') &&
    ticketsViewSource.includes('ticket-reply-textarea') &&
    !ticketsViewSource.includes('ticketsApi.tickets?.generateAiDraft') &&
    !ticketsViewSource.includes('ticketsApi.tickets?.sendAiReply') &&
    !ticketsViewSource.includes('api.tickets.generateAiDraft') &&
    !ticketsViewSource.includes('api.tickets.sendAiReply') &&
    !ticketsViewSource.includes('api.tickets.reply(selectedTicket.value.id, result.draft'),
  'Admin ticket UI must keep draft generation separate from explicit AI takeover replies and avoid cached API method mismatches'
)

console.log('AI ticket context guard tests passed')
