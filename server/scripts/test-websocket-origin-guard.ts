import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getAllowedWebSocketOrigins, validateWebSocketOrigin } from '../src/lib/websocket-security.js'
import type { FastifyRequest } from 'fastify'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL,
  CORS_ORIGINS: process.env.CORS_ORIGINS
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function requestWithOrigin(origin?: string): FastifyRequest {
  return { headers: origin === undefined ? {} : { origin } } as FastifyRequest
}

try {
  process.env.NODE_ENV = 'production'
  process.env.FRONTEND_URL = 'https://panel.example.com, https://alt.example.com/app'
  delete process.env.CORS_ORIGINS

  assert.deepEqual(getAllowedWebSocketOrigins(), [
    'https://panel.example.com',
    'https://alt.example.com'
  ])
  assert.equal(validateWebSocketOrigin(requestWithOrigin('https://panel.example.com')).allowed, true)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('https://alt.example.com/path')).allowed, true)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('https://evil.example.com')).allowed, false)
  assert.equal(validateWebSocketOrigin(requestWithOrigin()).allowed, false)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('not a url')).allowed, false)

  process.env.CORS_ORIGINS = 'https://cors.example.com'
  assert.deepEqual(getAllowedWebSocketOrigins(), ['https://cors.example.com'])
  assert.equal(validateWebSocketOrigin(requestWithOrigin('https://panel.example.com')).allowed, false)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('https://cors.example.com')).allowed, true)

  process.env.NODE_ENV = 'development'
  delete process.env.CORS_ORIGINS
  delete process.env.FRONTEND_URL
  assert.equal(validateWebSocketOrigin(requestWithOrigin()).allowed, true)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('http://127.0.0.1:3000')).allowed, true)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('http://127.0.0.1:3001')).allowed, true)
  assert.equal(validateWebSocketOrigin(requestWithOrigin('https://evil.example.com')).allowed, false)

  const terminalSource = readFileSync(resolve(__dirname, '../src/routes/terminal.ts'), 'utf8')
  const originGuardIndex = terminalSource.indexOf('validateWebSocketOrigin(request)')
  const consumeTicketIndex = terminalSource.indexOf('consumeTerminalAccessTicket(ticket, instanceId)')
  assert.notEqual(originGuardIndex, -1, 'terminal route must validate WebSocket Origin')
  assert.notEqual(consumeTicketIndex, -1, 'terminal route must consume terminal ticket')
  assert.ok(originGuardIndex < consumeTicketIndex, 'terminal Origin guard must run before ticket consumption')
  assert.ok(terminalSource.includes("code: 'ORIGIN_NOT_ALLOWED'"), 'terminal route must return a stable origin error code')

  console.log('websocket origin guard tests passed')
} finally {
  restoreEnv()
}
