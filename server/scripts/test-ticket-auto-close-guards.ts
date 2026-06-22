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
    autoCloseFunction.includes('!latest.resolvedAt') &&
    autoCloseFunction.includes('latest.resolvedAt >= cutoffTime') &&
    autoCloseFunction.includes("latest.messages[0]?.isFromOwner !== true"),
  'ticket auto-close helper must re-check latest status, resolvedAt, and last message before closing'
)
assert.ok(
  autoCloseFunction.includes('tx.ticket.updateMany') &&
    autoCloseFunction.includes("status: 'resolved'") &&
    autoCloseFunction.includes('resolvedAt: { lt: cutoffTime }') &&
    autoCloseFunction.includes('if (result.count === 0)') &&
    autoCloseFunction.includes('return null'),
  'ticket auto-close helper must use a conditional update and skip when another worker already claimed the ticket'
)
assert.ok(
  schedulerSource.includes('const closedTickets = await autoCloseTickets(ticketIds, AUTO_CLOSE_TIMEOUT_MS)') &&
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
