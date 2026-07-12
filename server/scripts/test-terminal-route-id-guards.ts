import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const routeSource = readFileSync(resolve(__dirname, '../src/routes/terminal.ts'), 'utf8')
const proxySource = readFileSync(resolve(__dirname, '../src/lib/terminal-proxy.ts'), 'utf8')

assert.ok(
  routeSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    routeSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    routeSource.includes('Number.isSafeInteger(parsed)'),
  'terminal routes must define strict positive safe-integer route ID parsing'
)

assert.equal(
  routeSource.match(/parsePositiveRouteId\(request\.params\.id\)/g)?.length ?? 0,
  1,
  'terminal ticket route must strictly validate instance IDs before ticket issuance'
)

assert.equal(
  routeSource.match(/parsePositiveRouteId\(id\)/g)?.length ?? 0,
  1,
  'terminal WebSocket route must strictly validate instance IDs before ticket consumption'
)

for (const forbiddenPattern of [
  'const instanceId = Number(request.params.id)',
  'const instanceId = Number(id)',
  'isNaN(instanceId)',
  'Number.isNaN(instanceId)',
  'parseInt(request.params.id',
  'parseInt(id'
] as const) {
  assert.ok(
    !routeSource.includes(forbiddenPattern),
    `terminal routes must not use loose path ID parsing: ${forbiddenPattern}`
  )
}

const invalidIdCheckIndex = routeSource.indexOf('if (instanceId === null)')
const consumeTicketIndex = routeSource.indexOf('consumeTerminalAccessTicket(ticket, instanceId)')
assert.notEqual(invalidIdCheckIndex, -1, 'terminal route must reject invalid IDs')
assert.notEqual(consumeTicketIndex, -1, 'terminal route must consume one-time tickets')
assert.ok(
  invalidIdCheckIndex < consumeTicketIndex,
  'terminal WebSocket route must reject malformed IDs before consuming one-time tickets'
)

const connectionAuditStart = routeSource.indexOf("            try {\n                await createLog(\n                    user.id,\n                    'terminal',\n                    'terminal.connect',")
const connectionAuditFailure = routeSource.indexOf('[Terminal] Failed to record connection audit log for instance', connectionAuditStart)
const closeHandlerStart = routeSource.indexOf("socket.on('close', async () => {", connectionAuditFailure)
assert.notEqual(connectionAuditStart, -1, 'terminal connection audit must be isolated in its own try/catch')
assert.notEqual(connectionAuditFailure, -1, 'terminal connection audit failures must be caught and reported')
assert.notEqual(closeHandlerStart, -1, 'terminal close handler must remain registered after connection audit')

const connectionAuditIsolation = routeSource.slice(connectionAuditStart, closeHandlerStart)
assert.ok(
  connectionAuditIsolation.includes('} catch (error) {'),
  'terminal connection audit failures must not escape into the connection lifecycle catch'
)
assert.ok(
  !connectionAuditIsolation.includes('safeSend(socket') && !connectionAuditIsolation.includes('socket.close('),
  'terminal connection audit failures must not report connection failure or close an established terminal'
)

const closeHandlerEnd = routeSource.indexOf("\n            })", closeHandlerStart)
assert.notEqual(closeHandlerEnd, -1, 'terminal close handler must have a bounded callback body')
const closeHandler = routeSource.slice(closeHandlerStart, closeHandlerEnd)
assert.ok(
  closeHandler.includes("try {\n                    await createLog(") &&
    closeHandler.includes("'terminal.disconnect'") &&
    closeHandler.includes('} catch (error) {') &&
    closeHandler.includes('[Terminal] Failed to record disconnection audit log for instance'),
  'terminal close audit must catch logging failures to prevent unhandled promise rejections'
)

const atomicClaimStart = routeSource.indexOf('function claimTerminalConnection(')
const atomicClaimEnd = routeSource.indexOf('\n}\n\nconst POSITIVE_ROUTE_ID_PATTERN', atomicClaimStart)
assert.notEqual(atomicClaimStart, -1, 'terminal route must define an atomic connection reservation claim')
assert.notEqual(atomicClaimEnd, -1, 'terminal connection reservation claim must have a bounded body')
const atomicClaim = routeSource.slice(atomicClaimStart, atomicClaimEnd)
assert.ok(
  atomicClaim.includes('getActiveSessionStats()') &&
    atomicClaim.includes('pendingTerminalConnectionsByUser.get(userId)') &&
    atomicClaim.includes('pendingTerminalConnectionsByInstance.get(instanceId)') &&
    atomicClaim.includes('pendingTerminalConnectionsByUser.set(userId') &&
    atomicClaim.includes('pendingTerminalConnectionsByInstance.set('),
  'terminal reservation must atomically check active plus pending counts and reserve both user and instance slots'
)
assert.ok(
  atomicClaim.includes('let released = false') &&
    atomicClaim.includes('if (released) return') &&
    atomicClaim.includes('decrementPendingConnectionCount(pendingTerminalConnectionsByUser, userId)') &&
    atomicClaim.includes('decrementPendingConnectionCount(pendingTerminalConnectionsByInstance, instanceId)'),
  'terminal reservation release must be idempotent and release both limit dimensions'
)

const reservationUse = routeSource.indexOf('const reservation = claimTerminalConnection(user.id, instanceId)')
const createSessionCall = routeSource.indexOf('const session = await createTerminalSession(', reservationUse)
assert.ok(
  reservationUse > atomicClaimEnd && createSessionCall > reservationUse,
  'terminal route must claim a slot before creating the asynchronous terminal session'
)
const connectionLifecycle = routeSource.slice(reservationUse, closeHandlerStart)
assert.ok(
  connectionLifecycle.includes("socket.once('close', reservation.release)") &&
    connectionLifecycle.includes('// createTerminalSession 返回前已登记 activeSessions，pending 可安全释放。\n            reservation.release()'),
  'terminal route must release pending reservations on disconnect and after active-session registration'
)
const connectionFailureCatch = routeSource.slice(
  routeSource.indexOf('        } catch (error) {', createSessionCall),
  routeSource.indexOf('            // 内部错误信息仅记录日志', createSessionCall)
)
assert.ok(
  connectionFailureCatch.includes('reservation.release()'),
  'terminal route must release the reservation when connection setup fails'
)

const createSessionStart = proxySource.indexOf('export async function createTerminalSession(')
const createConnectionIndex = proxySource.indexOf('await createIncusConsoleConnection(', createSessionStart)
const earlyClientCloseIndex = proxySource.indexOf("clientWs.on('close'", createSessionStart)
const earlyClientErrorIndex = proxySource.indexOf("clientWs.on('error'", createSessionStart)
const postConnectClientCheck = proxySource.indexOf(
  'if (clientDisconnected || clientWs.readyState !== clientWs.OPEN)',
  createConnectionIndex
)
const activeSessionRegistration = proxySource.indexOf('activeSessions.set(sessionId, session)', createSessionStart)
assert.notEqual(createSessionStart, -1, 'terminal proxy must define session creation')
assert.notEqual(createConnectionIndex, -1, 'terminal proxy must open the Incus connection')
assert.ok(
  earlyClientCloseIndex > createSessionStart && earlyClientCloseIndex < createConnectionIndex &&
    earlyClientErrorIndex > createSessionStart && earlyClientErrorIndex < createConnectionIndex,
  'terminal proxy must listen for client close/error before asynchronous Incus connection setup'
)
assert.ok(
  postConnectClientCheck > createConnectionIndex && postConnectClientCheck < activeSessionRegistration,
  'terminal proxy must recheck that the client is OPEN before registering the session'
)
const postConnectGuard = proxySource.slice(postConnectClientCheck, activeSessionRegistration)
assert.ok(
  postConnectGuard.includes('closeIncusConnectionPair(dataWs, controlWs)') &&
    postConnectGuard.includes("throw new Error('Client disconnected while terminal backend connection was opening')"),
  'terminal proxy must close newly opened Incus sockets and abort when the client disconnected early'
)

assert.ok(
  proxySource.includes('reconnectGeneration: number') &&
    proxySource.includes('const reconnectGeneration = ++session.reconnectGeneration') &&
    proxySource.includes('session.reconnectGeneration += 1'),
  'terminal reconnects must use a close-invalidated generation token'
)
assert.ok(
  proxySource.includes('activeSessions.get(sessionId) !== session') &&
    proxySource.includes('session.reconnectGeneration !== reconnectGeneration'),
  'terminal reconnects must recheck active session identity and generation after asynchronous work'
)
assert.ok(
  (proxySource.match(/session\.reconnectGeneration !== reconnectGeneration/g)?.length ?? 0) >= 2 &&
    proxySource.includes('closeIncusConnectionPair(dataWs, controlWs)'),
  'terminal reconnects must recheck after backoff and connection, closing sockets when the generation is stale'
)

console.log('terminal route ID guard tests passed')
