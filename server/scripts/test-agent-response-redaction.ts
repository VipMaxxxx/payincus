import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const agentRouteSource = readFileSync(resolve(__dirname, '../src/routes/agent.ts'), 'utf8')

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = agentRouteSource.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = agentRouteSource.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return agentRouteSource.slice(start, end)
}

const adminSerializer = sectionBetween(
  'async function serializeAgent(agent: HostAgentRecord)',
  'async function serializeAgentStatus(agent: HostAgentRecord)'
)
const statusSerializer = sectionBetween(
  'async function serializeAgentStatus(agent: HostAgentRecord)',
  'function buildHeartbeatReport(body: AgentHeartbeatBody)'
)

for (const [label, serializer] of [
  ['admin serializer', adminSerializer],
  ['status serializer', statusSerializer]
] as const) {
  assert.ok(serializer.includes('agentId: agent.agentId'), `${label}: must keep non-secret Agent identity visible`)
  assert.ok(!serializer.includes('secretHash'), `${label}: must not expose Agent secret hash`)
  assert.ok(!serializer.includes('secretEncrypted'), `${label}: must not expose encrypted Agent secret`)
  assert.ok(!serializer.includes('installTokenHash'), `${label}: must not expose Agent install-token hash`)
  assert.ok(!serializer.includes('installTokenExpiresAt'), `${label}: must not expose Agent install-token expiry through status`)
}

const credentialResponse = sectionBetween(
  "fastify.post<{ Params: AgentCredentialsParams; Body: AgentCredentialsBody }>('/admin/hosts/:hostId/credentials'",
  "fastify.post<{ Params: AgentCredentialsParams; Body: AgentInstallCommandBody }>('/admin/hosts/:hostId/install-command'"
)
assert.ok(
  credentialResponse.includes('credentials:') &&
    credentialResponse.includes('agentSecret: result.agentSecret'),
  'admin credential rotation must return the one-time plaintext Agent secret only in the credentials block'
)

console.log('agent response redaction tests passed')
