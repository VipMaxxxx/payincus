import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const manifest = read('server/src/lib/plugin-manifest.ts')
const pkg = read('server/src/lib/plugin-package.ts')
const adminRoute = read('server/src/routes/admin-plugins.ts')

assert.ok(
  manifest.includes('PLUGIN_ID_PATTERN') &&
    manifest.includes('PLUGIN_VERSION_PATTERN') &&
    manifest.includes('ADMIN_PLUGIN_SLOTS') &&
    manifest.includes('USER_PLUGIN_SLOTS') &&
    manifest.includes('User entrypoints cannot point to admin assets') &&
    manifest.includes('Plugin entrypoints must be local package assets') &&
    manifest.includes('must be under /plugins/'),
  'plugin manifest validation must enforce id/version, slot whitelist, local assets, and user plugin paths'
)

assert.ok(
  pkg.includes("execFileAsync('tar', ['-tvf', path]") &&
    pkg.includes("type === 'l' || type === 'h'") &&
    pkg.includes('name.includes') &&
    pkg.includes('payincus.plugin.json') &&
    pkg.includes('sha256File') &&
    pkg.includes('resolveInside') &&
    pkg.includes('getPluginPackageMaxBytes'),
  'plugin package validation must inspect tar entries, reject unsafe paths/links, require manifest, and hash packages'
)

assert.ok(
  adminRoute.includes("filename.endsWith('.tar.gz')") &&
    adminRoute.includes('Plugin package exceeds') &&
    adminRoute.includes("part.fieldname !== 'package'") &&
    adminRoute.includes('validateAndExtractPluginPackage'),
  'upload route must only accept bounded .tar.gz plugin package uploads'
)

console.log('plugin package guard tests passed')
