import '../src/config/env.js'
import assert from 'node:assert/strict'

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

async function fetchText(path: string): Promise<FetchResult> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Accept: '*/*',
      'User-Agent': 'incudal-agent-release-smoke/1.0'
    }
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

function assertJsonError(result: FetchResult, status: number, code: string, label: string): void {
  assert.equal(result.response.status, status, `${label} expected ${status}, got ${result.response.status}: ${result.text}`)
  assert.equal(result.data.code, code, `${label} must return ${code}`)
}

async function main(): Promise<void> {
  const health = await fetchText('/api/health')
  assert.equal(health.response.status, 200, `backend health expected 200, got ${health.response.status}: ${health.text}`)

  const installScript = await fetchText('/api/agent/install.sh')
  assert.equal(installScript.response.status, 200, `agent install script expected 200, got ${installScript.response.status}: ${installScript.text}`)
  assert.match(
    installScript.response.headers.get('content-type') || '',
    /text\/x-shellscript/i,
    'agent install script must be served as shellscript text'
  )
  assert.match(installScript.text, /INCUDAL_AGENT_BINARY_SHA256 is required when INCUDAL_AGENT_BINARY_URL is set/)
  assert.match(installScript.text, /verify_sha256 "\$\{target\}\.download" "\$\{expected_sha256\}"/)

  const invalidBinaryName = await fetchText('/api/agent/binary/incudal-agent-linux-x86')
  assertJsonError(invalidBinaryName, 400, 'INVALID_AGENT_BINARY_NAME', 'invalid binary name')

  const validSha256 = 'a'.repeat(64)
  const missingSha256 = await fetchText('/api/agent/binary/incudal-agent-linux-amd64?v=v0.0.1')
  assertJsonError(missingSha256, 400, 'AGENT_BINARY_QUERY_INCOMPLETE', 'agent binary missing sha256')

  const missingVersion = await fetchText(`/api/agent/binary/incudal-agent-linux-amd64?sha256=${validSha256}`)
  assertJsonError(missingVersion, 400, 'AGENT_BINARY_QUERY_INCOMPLETE', 'agent binary missing version')

  const malformedVersion = await fetchText(`/api/agent/binary/incudal-agent-linux-amd64?v=latest&sha256=${validSha256}`)
  assertJsonError(malformedVersion, 400, 'AGENT_BINARY_QUERY_INCOMPLETE', 'agent binary malformed version')

  const malformedSha256 = await fetchText('/api/agent/binary/incudal-agent-linux-amd64?v=v0.0.1&sha256=not-a-sha')
  assertJsonError(malformedSha256, 400, 'AGENT_BINARY_QUERY_INCOMPLETE', 'agent binary malformed sha256')

  console.log('[smoke-agent-release] passed', {
    apiBaseUrl,
    installScript: installScript.response.status,
    invalidBinaryName: invalidBinaryName.response.status,
    incompleteBinaryQuery: missingSha256.response.status
  })
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
