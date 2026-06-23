import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const agentRouteSource = readFileSync(resolve(__dirname, '../src/routes/agent.ts'), 'utf8')
const installScriptSource = readFileSync(resolve(__dirname, '../templates/agent-install.sh'), 'utf8')
const hostAgentCredentialsSource = readFileSync(resolve(__dirname, '../src/lib/host-agent-credentials.ts'), 'utf8')
const agentBuildReleaseScriptSource = readFileSync(resolve(__dirname, '../../agent/scripts/build-release.sh'), 'utf8')
const agentReleaseWorkflowSource = readFileSync(resolve(__dirname, '../../.github/workflows/agent-release.yml'), 'utf8')

assert.ok(
  agentRouteSource.includes("const defaultAgentReleaseRepository = 'VipMaxxxx/payincus'"),
  'Agent release proxy must default to the current repository'
)
assert.ok(
  !agentRouteSource.includes('qwer-xyz/incudal_classic'),
  'Agent release proxy must not default to the retired repository'
)
assert.ok(
  agentRouteSource.includes('const maxAgentInstallUrlLength = 2048'),
  'Agent install URL inputs must be bounded before command generation'
)
assert.ok(
  agentRouteSource.includes('function normalizeAgentBinaryUrl'),
  'Agent custom binary URLs must be normalized and protocol validated'
)
assert.ok(
  agentRouteSource.includes("parsed.protocol !== 'http:' && parsed.protocol !== 'https:'"),
  'Agent install URLs must reject non-HTTP(S) protocols'
)
assert.ok(
  agentRouteSource.includes("code: 'INVALID_AGENT_BASE_URL'"),
  'admin Agent install-command must reject invalid explicit baseUrl instead of silently falling back'
)
assert.ok(
  agentRouteSource.includes("code: 'INVALID_AGENT_BINARY_URL'"),
  'admin Agent install-command must reject invalid custom binaryUrl'
)
assert.ok(
  agentRouteSource.includes('if (binaryUrl && !isSha256(request.body.binarySha256))'),
  'admin Agent install-command must require sha256 only for a validated custom binary URL'
)
assert.ok(
  agentRouteSource.includes('binaryUrl,'),
  'Agent install command must use the normalized custom binary URL'
)
assert.ok(
  installScriptSource.includes('fail "INCUDAL_AGENT_BINARY_SHA256 is required when INCUDAL_AGENT_BINARY_URL is set"'),
  'Agent install script must refuse custom binary downloads without sha256'
)
assert.ok(
  installScriptSource.includes('verify_sha256 "${target}.download" "${expected_sha256}"'),
  'Agent install script must verify custom and manifest binary checksums before install'
)
assert.ok(
  /manifest_value\(\)[\s\S]*compact="\$\(tr -d '\\n\\r' < "\$\{manifest_path\}"\)"[\s\S]*sed -nE[\s\S]*\$\{platform\}[\s\S]*\$\{key\}/.test(installScriptSource),
  'Agent install script must parse compact single-line Agent manifests served by the panel'
)
assert.ok(
  installScriptSource.includes('MANIFEST_URL="$(append_query_param "${MANIFEST_URL}" "v" "${BINARY_CACHE_BUSTER}")"') &&
    installScriptSource.includes('BINARY_URL="$(append_query_param "${BINARY_URL}" "cache_bust" "${BINARY_CACHE_BUSTER}")"') &&
    !installScriptSource.includes('BINARY_URL="$(append_query_param "${BINARY_URL}" "v" "${BINARY_CACHE_BUSTER}")"'),
  'Agent install script must not use the binary proxy reserved v query parameter for cache busting'
)
assert.ok(
  installScriptSource.includes('download_binary_once "${fallback_url}" "${target}" "${expected_sha256}"'),
  'Agent install script fallback binary downloads must keep the same sha256 verification requirement'
)
assert.ok(
  agentRouteSource.includes('interface AgentBinaryQuery') &&
    agentRouteSource.includes('Querystring: AgentBinaryQuery'),
  'Agent binary proxy must type and read version/checksum query parameters'
)
assert.ok(
  agentRouteSource.includes('function normalizeAgentBinaryVersion') &&
    agentRouteSource.includes("code: 'AGENT_BINARY_QUERY_INCOMPLETE'"),
  'Agent binary proxy must reject incomplete or malformed version/checksum query parameters'
)
assert.ok(
  agentRouteSource.includes('const requestedVersion = typeof request.query?.v') &&
    agentRouteSource.includes('const requestedSha256 = typeof request.query?.sha256'),
  'Agent binary proxy must honor the version and sha256 carried by upgrade URLs'
)
assert.ok(
  agentRouteSource.includes('expectedSha256 = file.sha256.toLowerCase()') &&
    agentRouteSource.includes('expectedSha256'),
  'Agent binary proxy must only fall back to latest manifest sha256 when no exact query is supplied'
)
assert.ok(
  agentRouteSource.includes('const agentReleaseFetchTimeoutMs = 15 * 1000'),
  'Agent release GitHub requests must use a bounded timeout'
)
assert.equal(
  (agentRouteSource.match(/signal: AbortSignal\.timeout\(agentReleaseFetchTimeoutMs\)/g) ?? []).length,
  3,
  'Agent release API, checksum, and binary fetch paths must all use the bounded timeout'
)
assert.ok(
  agentRouteSource.includes('function getLocalAgentReleaseDir') &&
    agentRouteSource.includes('INCUDAL_AGENT_RELEASE_DIR') &&
    agentRouteSource.includes('readLocalAgentUpgradeManifest') &&
    agentRouteSource.includes('Local Agent release binary sha256 mismatch'),
  'Agent release proxy must support a checksum-verified local release directory before falling back to GitHub releases'
)
assert.ok(
  agentRouteSource.includes('const agentBinaryNamePattern = /^incudal-agent-linux-(amd64|arm64)(?:\\.gz)?$/'),
  'Agent binary proxy must accept gzip local release artifacts referenced by the manifest'
)
assert.ok(
  agentBuildReleaseScriptSource.includes('build_one amd64') &&
    agentBuildReleaseScriptSource.includes('build_one arm64') &&
    agentBuildReleaseScriptSource.includes('incudal-agent-linux-amd64') &&
    agentBuildReleaseScriptSource.includes('incudal-agent-linux-arm64'),
  'Agent release build script must produce linux-amd64 and linux-arm64 binaries'
)
assert.ok(
  agentReleaseWorkflowSource.includes('cp agent/dist/incudal-agent-linux-amd64 "agent/release/incudal-agent-x86_64-${VERSION}"') &&
    agentReleaseWorkflowSource.includes('cp agent/dist/incudal-agent-linux-arm64 "agent/release/incudal-agent-aarch64-${VERSION}"'),
  'Agent release workflow must rename local build outputs to the release asset names expected by the panel proxy'
)
assert.ok(
  agentReleaseWorkflowSource.includes('tag_name: agent-${{ needs.version.outputs.version }}') &&
    agentReleaseWorkflowSource.includes('agent-release/incudal-agent-x86_64-${{ needs.version.outputs.version }}') &&
    agentReleaseWorkflowSource.includes('agent-release/incudal-agent-aarch64-${{ needs.version.outputs.version }}'),
  'Agent release workflow must publish agent-v* releases with both expected architecture assets'
)

assert.ok(
  hostAgentCredentialsSource.includes("const agentInstallTokenPrefix = 'ait_'") &&
    hostAgentCredentialsSource.includes('const agentInstallTokenTtlMs = 30 * 60 * 1000'),
  'Agent install tokens must use a distinct prefix and bounded 30-minute TTL'
)
assert.ok(
  hostAgentCredentialsSource.includes("return createHash('sha256').update(token).digest('hex')") &&
    hostAgentCredentialsSource.includes('installTokenHash: hashAgentInstallToken(installToken)'),
  'Agent install tokens must be hashed before persistence'
)
assert.ok(
  hostAgentCredentialsSource.includes('where: { installTokenHash: tokenHash }') &&
    hostAgentCredentialsSource.includes('installTokenUsedAt: null') &&
    hostAgentCredentialsSource.includes('installTokenExpiresAt: { gte: new Date() }') &&
    hostAgentCredentialsSource.includes('if (updated.count !== 1)'),
  'Agent install-token consumption must be conditional on unused and unexpired state'
)
assert.ok(
  hostAgentCredentialsSource.includes('installTokenHash: null') &&
    hostAgentCredentialsSource.includes('installTokenExpiresAt: null') &&
    hostAgentCredentialsSource.includes('installTokenUsedAt: new Date()'),
  'Agent install-token consumption must clear the token hash and mark used-at'
)

console.log('agent install command guard tests passed')
