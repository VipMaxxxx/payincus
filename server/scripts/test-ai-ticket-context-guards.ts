import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/tickets.ts'), 'utf8')
const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/ai-ticket-context.ts'), 'utf8')
const clientApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const ticketsViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/TicketsView.vue'), 'utf8')
const clientTypesSource = readFileSync(resolve(process.cwd(), '../client/src/types/api.ts'), 'utf8')

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

const draftRouteIndex = routeSource.indexOf("}>('/:id/ai/draft'")
const nextRouteIndex = routeSource.indexOf('由 AI 工单插件生成并发送一条客服回复', draftRouteIndex)
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
    routeSource.includes('generateAiTicketReply(ticketId)') &&
    routeSource.includes('auditAiTicketReply') &&
    routeSource.includes("code: 'AI_TICKET_AGENT_REPLY_MODE_DISABLED'") &&
    routeSource.includes("code: 'AI_TICKET_REPLY_BLOCKED'"),
  'AI reply endpoint must require the separate reply permission, mode gate, safety checks and audit logging'
)

const replyRouteIndex = routeSource.indexOf("}>('/:id/ai/reply'")
const internalNoteRouteIndex = routeSource.indexOf('创建内部备注', replyRouteIndex)
assert.notEqual(replyRouteIndex, -1, 'AI reply route not found')
assert.notEqual(internalNoteRouteIndex, -1, 'AI reply route end marker not found')
const replyRouteSection = routeSource.slice(replyRouteIndex, internalNoteRouteIndex)
assert.ok(
  replyRouteSection.includes('onRequest: [fastify.authenticate, fastify.requireAdmin]') &&
    replyRouteSection.includes('AI_TICKET_REPLY_PERMISSION') &&
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
    serviceSource.includes('generateAiTicketDraft') &&
    serviceSource.includes('generateAiTicketReply'),
  'AI draft generation must read encrypted plugin config server-side and safety-check model output'
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
  clientTypesSource.includes('export interface TicketAiDraftResponse') &&
    clientTypesSource.includes('export interface TicketAiReplyResponse') &&
    clientApiSource.includes('generateAiDraft') &&
    clientApiSource.includes("http.post(`/tickets/${id}/ai/draft`, {}, { timeout: TIMEOUT.MEDIUM })") &&
    clientApiSource.includes('sendAiReply') &&
    clientApiSource.includes("http.post(`/tickets/${id}/ai/reply`, {}, { timeout: TIMEOUT.MEDIUM })") &&
    ticketsViewSource.includes('aiDraftLoading') &&
    ticketsViewSource.includes('aiReplyLoading') &&
    ticketsViewSource.includes('generateAiDraft') &&
    ticketsViewSource.includes('sendAiReply') &&
    ticketsViewSource.includes('replyContent.value = result.draft') &&
    ticketsViewSource.includes('ticket-reply-textarea') &&
    !ticketsViewSource.includes('api.tickets.reply(selectedTicket.value.id, result.draft'),
  'Admin ticket UI must keep draft generation separate from explicit AI takeover replies'
)

console.log('AI ticket context guard tests passed')
