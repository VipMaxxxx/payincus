import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const ticketDbSource = readRepoFile('server/src/db/tickets.ts')
const schedulerSource = readRepoFile('server/src/services/ticket-auto-close-scheduler.ts')
const routeSource = readRepoFile('server/src/routes/tickets.ts')
const notifierSource = readRepoFile('server/src/lib/notifier.ts')
const systemConfigRouteSource = readRepoFile('server/src/routes/system-config.ts')
const systemConfigViewSource = readRepoFile('client/src/views/admin/SystemConfigView.vue')

const getTicketsForAutoCloseStart = ticketDbSource.indexOf('export async function getTicketsForAutoClose(')
assert.notEqual(getTicketsForAutoCloseStart, -1, 'ticket auto-close candidate helper must exist')
const getTicketsForAutoCloseEnd = ticketDbSource.indexOf('export async function autoCloseTickets(', getTicketsForAutoCloseStart)
assert.notEqual(getTicketsForAutoCloseEnd, -1, 'ticket auto-close claim helper must follow candidate helper')
const getTicketsForAutoCloseFunction = ticketDbSource.slice(getTicketsForAutoCloseStart, getTicketsForAutoCloseEnd)

const autoCloseFunctionStart = ticketDbSource.indexOf('export async function autoCloseTickets(')
assert.notEqual(autoCloseFunctionStart, -1, 'ticket auto-close helper must exist')

const autoCloseFunction = ticketDbSource.slice(autoCloseFunctionStart)
assert.ok(
  autoCloseFunction.includes('Promise<AutoClosedTicket[]>') &&
    autoCloseFunction.includes('const closedTickets: AutoClosedTicket[] = []') &&
    autoCloseFunction.includes('return closedTickets'),
  'ticket auto-close helper must return the tickets actually closed by this run'
)
assert.ok(
  autoCloseFunction.includes('latest.status !==') &&
    autoCloseFunction.includes("latest.status !== 'resolved'") &&
    autoCloseFunction.includes("latest.messages[0]?.isFromOwner !== true") &&
    autoCloseFunction.includes('latest.messages[0].createdAt >= cutoffTime'),
  'ticket auto-close helper must re-check latest status and last public message timestamp before closing'
)
assert.ok(
  autoCloseFunction.includes('tx.ticket.updateMany') &&
    autoCloseFunction.includes("status: 'resolved'") &&
    autoCloseFunction.includes('updatedAt: latest.updatedAt') &&
    autoCloseFunction.includes('if (result.count === 0)') &&
    autoCloseFunction.includes('return null'),
  'ticket auto-close helper must use an updatedAt conditional claim and skip after a concurrent public reply'
)
assert.ok(
  getTicketsForAutoCloseFunction.includes('createdAt: true') &&
    getTicketsForAutoCloseFunction.includes('ticket.messages[0].createdAt < cutoffTime') &&
    getTicketsForAutoCloseFunction.includes('lastPublicMessageAt: ticket.messages[0]!.createdAt') &&
    !getTicketsForAutoCloseFunction.includes('resolvedAt: {'),
  'ticket auto-close candidates must be timed from the last public message rather than resolvedAt'
)
assert.ok(
  notifierSource.includes('已因距最后回复超过24小时而自动关闭'),
  'ticket auto-close notification must explain the 24-hour timer is measured from the last reply'
)
assert.ok(
  schedulerSource.includes("const TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY = 'ticket_auto_close_enabled'") &&
    schedulerSource.includes('getSystemConfigBoolean(TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY, true)') &&
    schedulerSource.includes('if (!enabled)') &&
    schedulerSource.indexOf('if (!enabled)') < schedulerSource.indexOf('getTicketsForAutoClose('),
  'ticket auto-close scheduler must default to enabled and return before scanning when disabled'
)
assert.ok(
  schedulerSource.includes("const TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY = 'ticket_auto_close_hours'") &&
    schedulerSource.includes('DEFAULT_TICKET_AUTO_CLOSE_HOURS = 24') &&
    schedulerSource.includes('const autoCloseTimeoutMs = autoCloseHours * HOUR_MS') &&
    schedulerSource.includes('getTicketsForAutoClose(autoCloseTimeoutMs)') &&
    schedulerSource.includes('autoCloseTickets(ticketIds, autoCloseTimeoutMs)') &&
    !schedulerSource.includes('AUTO_CLOSE_TIMEOUT_MS'),
  'ticket auto-close scheduler must use configured hours instead of a fixed 24-hour timeout'
)
assert.ok(
  !getTicketsForAutoCloseFunction.includes('timeoutMs: number = 24 * 60 * 60 * 1000') &&
    !autoCloseFunction.includes('timeoutMs: number = 24 * 60 * 60 * 1000'),
  'ticket database helpers must require the scheduler-provided configured timeout'
)
assert.ok(
  systemConfigRouteSource.includes("const TICKET_AUTO_CLOSE_ENABLED_CONFIG_KEY = 'ticket_auto_close_enabled'") &&
    systemConfigRouteSource.includes("const TICKET_AUTO_CLOSE_HOURS_CONFIG_KEY = 'ticket_auto_close_hours'") &&
    systemConfigViewSource.includes("const ticketKeys = ['ticket_enabled', 'ticket_auto_close_enabled', 'ticket_auto_close_hours']") &&
    systemConfigViewSource.includes('v-model.number="form.ticket_auto_close_hours"') &&
    systemConfigViewSource.includes('min="1"'),
  'ticket auto-close enabled and hours settings must be exposed in system config UI'
)
assert.ok(
  schedulerSource.includes('const closedTickets = await autoCloseTickets(ticketIds, autoCloseTimeoutMs)') &&
    schedulerSource.includes('for (const ticket of closedTickets)') &&
    !schedulerSource.includes('for (const ticket of ticketsToClose)'),
  'ticket auto-close scheduler must notify only tickets closed by the current run'
)
assert.ok(
  schedulerSource.includes('成功自动关闭 ${closedTickets.length} 个工单') &&
    !schedulerSource.includes('const closedCount = await autoCloseTickets'),
  'ticket auto-close scheduler logs must be based on actually closed tickets'
)
assert.ok(
  ticketDbSource.includes('export async function addTicketMessage(') &&
    ticketDbSource.includes("status: { not: 'closed' }") &&
    ticketDbSource.includes("status: 'in_progress' as TicketStatus") &&
    ticketDbSource.includes('resolvedAt: null') &&
    ticketDbSource.includes("throw new Error('Cannot reply to a closed ticket')"),
  'ticket replies must atomically reject closed tickets and reopen resolved tickets before inserting messages'
)
assert.ok(
  routeSource.includes("'Cannot reply to a closed ticket'"),
  'ticket reply route must map closed-ticket races to a handled client error'
)

console.log('ticket auto-close guard checks passed')
