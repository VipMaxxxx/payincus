import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getGeoIpInfo } from '../src/lib/geoip.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const invalid = await getGeoIpInfo('127.0.0.1?fields=query')
assert.equal(invalid.ip, '127.0.0.1?fields=query', 'invalid GeoIP input must be returned as an empty local result')
assert.equal(invalid.country, null, 'invalid GeoIP input must not be queried externally')

const local = await getGeoIpInfo('127.0.0.1')
assert.equal(local.ip, '127.0.0.1', 'local IP must be returned as-is')
assert.equal(local.country, null, 'local IP must not be queried externally')

const source = readFileSync(resolve(__dirname, '../src/lib/geoip.ts'), 'utf8')
assert.ok(source.includes("import { isIP } from 'net'"), 'GeoIP lookup must validate IP strings with net.isIP')
assert.ok(source.includes('function normalizeIpForGeoLookup'), 'GeoIP lookup must normalize and reject invalid inputs')
assert.ok(source.includes('encodeURIComponent(ip)'), 'GeoIP lookup URL path must encode the IP value')
assert.ok(source.includes('const MAX_QUEUE_SIZE = 1000'), 'GeoIP lookup queue must have a hard cap')
assert.ok(source.includes('requestQueue.length >= MAX_QUEUE_SIZE'), 'GeoIP lookup must reject work when the queue is full')

console.log('geoip guard tests passed')
