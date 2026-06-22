import '../src/config/env.js'
import assert from 'node:assert/strict'
import {
  closePrismaDatabase,
  createHost,
  createUser,
  deleteHost,
  deleteUser,
  prisma
} from '../src/db/index.js'
import {
  createAgentBodyHash,
  createAgentSignature
} from '../src/lib/agent-auth.js'
import { rotateHostAgentCredentials } from '../src/lib/host-agent-credentials.js'

type JsonObject = Record<string, unknown>

interface FetchResult {
  response: Response
  data: JsonObject
  text: string
}

const apiBaseUrl = trimSlash(
  process.env.SMOKE_API_BASE_URL ||
    process.env.SMOKE_FRONTEND_URL ||
    process.env.FRONTEND_URL ||
    process.env.BACKEND_URL ||
    'http://127.0.0.1:3001'
)

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

async function postAgentHeartbeat(input: {
  agentId: string
  agentSecret: string
  nonce: string
  body: JsonObject
  signatureOverride?: string
}): Promise<FetchResult> {
  const timestamp = String(Date.now())
  const bodyHash = createAgentBodyHash(input.body)
  const signature = input.signatureOverride ?? createAgentSignature(input.agentSecret, {
    method: 'POST',
    path: '/api/agent/heartbeat',
    timestamp,
    nonce: input.nonce,
    bodyHash
  })

  const response = await fetch(`${apiBaseUrl}/api/agent/heartbeat`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'incudal-agent-heartbeat-smoke/1.0',
      'x-incudal-agent-id': input.agentId,
      'x-incudal-timestamp': timestamp,
      'x-incudal-nonce': input.nonce,
      'x-incudal-body-sha256': bodyHash,
      'x-incudal-signature': signature
    },
    body: JSON.stringify(input.body)
  })
  const text = await response.text()
  let data: JsonObject = {}
  try {
    data = text ? JSON.parse(text) as JsonObject : {}
  } catch {
    data = {}
  }
  return { response, data, text }
}

async function main(): Promise<void> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let userId: number | null = null
  let hostId: number | null = null
  let agentId: string | null = null

  async function cleanup(): Promise<void> {
    try {
      if (agentId) {
        await prisma.hostAgentNonce.deleteMany({ where: { agentId } })
      }
      if (hostId) {
        await deleteHost(hostId)
      }
      if (userId) {
        await deleteUser(userId)
      }
    } catch (error) {
      console.warn('[smoke-agent-heartbeat] cleanup failed', {
        userId,
        hostId,
        agentId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  try {
    const health = await fetch(`${apiBaseUrl}/api/health`, {
      headers: { Accept: 'application/json', 'User-Agent': 'incudal-agent-heartbeat-smoke/1.0' }
    })
    assert.equal(health.status, 200, `backend health expected 200, got ${health.status}`)

    userId = await createUser(
      `smoke-agent-${suffix}`,
      `smoke-agent-${suffix}@incudal-smoke.local`,
      'not-used-by-agent-heartbeat-smoke',
      'user'
    )
    hostId = await createHost({
      userId,
      name: `smoke-agent-host-${suffix}`,
      url: 'https://127.0.0.1:8443',
      location: 'smoke'
    })

    const credentials = await rotateHostAgentCredentials(hostId, true)
    agentId = credentials.agentId

    const heartbeatBody: JsonObject = {
      version: 'smoke-0.0.1',
      capabilities: ['heartbeat', 'report', 'traffic-counters'],
      runtime: { os: 'linux', arch: 'amd64' },
      incus: { available: false },
      instances: { available: false, items: [] },
      resources: { cpu: { total: 1 }, memory: { totalBytes: 1024 } },
      metrics: { heartbeatIntervalSeconds: 30 }
    }

    const nonce = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const accepted = await postAgentHeartbeat({
      agentId,
      agentSecret: credentials.agentSecret,
      nonce,
      body: heartbeatBody
    })
    assert.equal(accepted.response.status, 200, `valid heartbeat expected 200, got ${accepted.response.status}: ${accepted.text}`)
    assert.equal(accepted.data.ok, true, 'valid heartbeat must return ok=true')

    const persistedAgent = await prisma.hostAgent.findUnique({ where: { agentId } })
    assert.equal(persistedAgent?.status, 'online', 'valid heartbeat must mark agent online')
    assert.equal(persistedAgent?.version, 'smoke-0.0.1', 'valid heartbeat must persist version')
    assert.ok(persistedAgent?.lastSeenAt, 'valid heartbeat must persist lastSeenAt')

    const replay = await postAgentHeartbeat({
      agentId,
      agentSecret: credentials.agentSecret,
      nonce,
      body: heartbeatBody
    })
    assert.equal(replay.response.status, 401, `replayed nonce expected 401, got ${replay.response.status}: ${replay.text}`)
    assert.equal(replay.data.code, 'AGENT_NONCE_REPLAY', 'replayed heartbeat must be rejected as nonce replay')

    const badSignature = await postAgentHeartbeat({
      agentId,
      agentSecret: credentials.agentSecret,
      nonce: `smoke-bad-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      body: heartbeatBody,
      signatureOverride: '0'.repeat(64)
    })
    assert.equal(badSignature.response.status, 401, `bad signature expected 401, got ${badSignature.response.status}: ${badSignature.text}`)
    assert.equal(badSignature.data.code, 'AGENT_SIGNATURE_INVALID', 'wrong-signature heartbeat must be rejected')

    console.log('[smoke-agent-heartbeat] passed', {
      apiBaseUrl,
      hostId,
      agentId,
      replayStatus: replay.response.status,
      badSignatureStatus: badSignature.response.status
    })
  } finally {
    await cleanup()
    await closePrismaDatabase()
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
