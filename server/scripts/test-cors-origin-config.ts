import assert from 'node:assert/strict'
import {
  getAllowedWebSocketOrigins,
  getConfiguredOrigins,
  getCorsOrigins,
  normalizeOrigin
} from '../src/lib/origin-config.js'

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  FRONTEND_URL: process.env.FRONTEND_URL,
  CORS_ORIGINS: process.env.CORS_ORIGINS
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

try {
  assert.equal(normalizeOrigin('https://panel.example.com/app/'), 'https://panel.example.com')
  assert.equal(normalizeOrigin('https://panel.example.com/'), 'https://panel.example.com')
  assert.equal(normalizeOrigin('not a url'), null)

  process.env.NODE_ENV = 'production'
  process.env.FRONTEND_URL = 'https://panel.example.com/app, https://alt.example.com/'
  delete process.env.CORS_ORIGINS

  assert.deepEqual(getConfiguredOrigins(), ['https://panel.example.com', 'https://alt.example.com'])
  assert.deepEqual(getCorsOrigins(), ['https://panel.example.com', 'https://alt.example.com'])
  assert.deepEqual(getAllowedWebSocketOrigins(), ['https://panel.example.com', 'https://alt.example.com'])

  process.env.CORS_ORIGINS = 'https://cors.example.com/path, invalid, https://cors.example.com/'
  assert.deepEqual(getCorsOrigins(), ['https://cors.example.com'])
  assert.deepEqual(getAllowedWebSocketOrigins(), ['https://cors.example.com'])

  delete process.env.FRONTEND_URL
  delete process.env.CORS_ORIGINS
  assert.equal(getCorsOrigins(), false)
  assert.deepEqual(getAllowedWebSocketOrigins(), [])

  process.env.NODE_ENV = 'development'
  process.env.FRONTEND_URL = 'https://panel.example.com/app'
  delete process.env.CORS_ORIGINS
  assert.deepEqual(getCorsOrigins(), [
    'https://panel.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ])
  assert.deepEqual(getAllowedWebSocketOrigins(), [
    'https://panel.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ])

  console.log('CORS origin config tests passed')
} finally {
  restoreEnv()
}
