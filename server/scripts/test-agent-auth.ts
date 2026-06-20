import assert from 'node:assert/strict'
import {
  createAgentBodyHash,
  createAgentSignature,
  generateAgentSecret,
  isAgentTimestampFresh,
  stableStringifyAgentBody,
  verifyAgentSignature
} from '../src/lib/agent-auth.js'

const bodyA = {
  version: '0.1.0',
  resources: {
    memory: 1024,
    cpu: 8
  },
  capabilities: ['heartbeat', 'report']
}

const bodyB = {
  capabilities: ['heartbeat', 'report'],
  resources: {
    cpu: 8,
    memory: 1024
  },
  version: '0.1.0'
}

assert.equal(stableStringifyAgentBody(bodyA), stableStringifyAgentBody(bodyB))
assert.equal(createAgentBodyHash(bodyA), createAgentBodyHash(bodyB))

const secret = generateAgentSecret()
const payload = {
  method: 'POST',
  path: '/api/agent/heartbeat',
  timestamp: String(Date.now()),
  nonce: 'nonce-123456',
  bodyHash: createAgentBodyHash(bodyA)
}
const signature = createAgentSignature(secret, payload)

assert.equal(verifyAgentSignature(secret, payload, signature), true)
assert.equal(verifyAgentSignature(secret, { ...payload, path: '/api/agent/report' }, signature), false)
assert.equal(isAgentTimestampFresh(payload.timestamp), true)
assert.equal(isAgentTimestampFresh(String(Date.now() - 10 * 60 * 1000)), false)

console.log('agent-auth self-test passed')
