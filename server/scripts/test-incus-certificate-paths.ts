import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import assert from 'assert'
import { resolveCertificatePair, resolveCertificatePath } from '../src/lib/incus/certificate-paths.js'

const tmpRoot = mkdtempSync(join(tmpdir(), 'payincus-cert-paths-'))
const previousInstallDir = process.env.INCUDAL_INSTALL_DIR
const previousPanelCert = process.env.PANEL_CRT_PATH
const previousPanelKey = process.env.PANEL_KEY_PATH

try {
  const stableCertDir = join(tmpRoot, 'server/certs')
  mkdirSync(stableCertDir, { recursive: true })
  const stableCert = join(stableCertDir, 'client.crt')
  const stableKey = join(stableCertDir, 'client.key')
  writeFileSync(stableCert, 'cert')
  writeFileSync(stableKey, 'key')
  process.env.INCUDAL_INSTALL_DIR = tmpRoot
  delete process.env.PANEL_CRT_PATH
  delete process.env.PANEL_KEY_PATH

  const oldReleaseCert = join(tmpRoot, 'releases/v0.6.16/server/certs/client.crt')
  const oldReleaseKey = join(tmpRoot, 'releases/v0.6.16/server/certs/client.key')
  const resolvedPair = resolveCertificatePair(oldReleaseCert, oldReleaseKey)
  assert.strictEqual(resolvedPair.certPath, stableCert)
  assert.strictEqual(resolvedPair.keyPath, stableKey)

  const explicitCert = join(tmpRoot, 'explicit-client.crt')
  writeFileSync(explicitCert, 'explicit-cert')
  process.env.PANEL_CRT_PATH = explicitCert
  assert.strictEqual(resolveCertificatePath(oldReleaseCert), explicitCert)

  assert.strictEqual(resolveCertificatePath(null), null)
  assert.strictEqual(resolveCertificatePath(stableCert), stableCert)
  console.log('incus certificate path checks passed')
} finally {
  if (previousInstallDir === undefined) delete process.env.INCUDAL_INSTALL_DIR
  else process.env.INCUDAL_INSTALL_DIR = previousInstallDir
  if (previousPanelCert === undefined) delete process.env.PANEL_CRT_PATH
  else process.env.PANEL_CRT_PATH = previousPanelCert
  if (previousPanelKey === undefined) delete process.env.PANEL_KEY_PATH
  else process.env.PANEL_KEY_PATH = previousPanelKey
  rmSync(tmpRoot, { recursive: true, force: true })
}
