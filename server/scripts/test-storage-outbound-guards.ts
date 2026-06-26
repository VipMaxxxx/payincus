import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  joinStorageRemoteDirectory,
  joinStorageRemotePath,
  normalizeStorageBasePath,
  normalizeStorageFilename
} from '../src/storage/path.js'
import {
  OutboundTargetValidationError,
  assertSafeHttpUrl,
  assertSafeStorageTarget,
  isIpPrivateOrReserved
} from '../src/lib/outbound-security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function assertThrowsOutbound(fn: () => Promise<unknown>): Promise<void> {
  return assert.rejects(fn, OutboundTargetValidationError)
}

assert.equal(normalizeStorageBasePath(''), '')
assert.equal(normalizeStorageBasePath('backups'), 'backups/')
assert.equal(normalizeStorageBasePath('/backups/incudal'), '/backups/incudal/')
assert.equal(normalizeStorageFilename('backup.tar.gz'), 'backup.tar.gz')
assert.equal(joinStorageRemotePath('/backups', 'backup.tar.gz'), '/backups/backup.tar.gz')
assert.equal(joinStorageRemoteDirectory('/backups', undefined), '/backups/')
assert.equal(joinStorageRemoteDirectory('/backups', 'daily'), '/backups/daily/')
assert.equal(joinStorageRemoteDirectory('backups', 'daily/20260622'), 'backups/daily/20260622/')

for (const unsafeBasePath of ['../x', 'safe/../x', './x', 'safe\\x', 'safe\0x']) {
  assert.throws(
    () => normalizeStorageBasePath(unsafeBasePath),
    /Storage base path/,
    `unsafe base path must be rejected: ${unsafeBasePath}`
  )
}

for (const unsafeFilename of ['', '../backup.tar.gz', 'a/b.tar.gz', 'a\\b.tar.gz', '.', '..', 'x\0y']) {
  assert.throws(
    () => normalizeStorageFilename(unsafeFilename),
    /Storage filename/,
    `unsafe filename must be rejected: ${unsafeFilename}`
  )
}

for (const unsafeSubPath of ['/etc', '../x', 'safe/../x', './x', 'safe\\x', 'safe\0x']) {
  assert.throws(
    () => joinStorageRemoteDirectory('/backups', unsafeSubPath),
    /Storage (base path|sub path)/,
    `unsafe storage list sub path must be rejected: ${unsafeSubPath}`
  )
}

assert.equal(isIpPrivateOrReserved('127.0.0.1'), true)
assert.equal(isIpPrivateOrReserved('10.0.0.1'), true)
assert.equal(isIpPrivateOrReserved('172.16.0.1'), true)
assert.equal(isIpPrivateOrReserved('192.168.1.1'), true)
assert.equal(isIpPrivateOrReserved('169.254.169.254'), true)
assert.equal(isIpPrivateOrReserved('::1'), true)
assert.equal(isIpPrivateOrReserved('fc00::1'), true)

await assertThrowsOutbound(() => assertSafeHttpUrl('http://127.0.0.1:8080'))
await assertThrowsOutbound(() => assertSafeHttpUrl('http://localhost:8080'))
await assertThrowsOutbound(() => assertSafeHttpUrl('file:///etc/passwd'))
await assertThrowsOutbound(() => assertSafeStorageTarget('FTP', '10.0.0.2'))
await assertThrowsOutbound(() => assertSafeStorageTarget('SFTP', 'localhost'))
await assertThrowsOutbound(() => assertSafeStorageTarget('WEBDAV', 'http://169.254.169.254'))
await assertThrowsOutbound(() => assertSafeStorageTarget('S3', 'http://169.254.169.254'))

const ftpSource = readFileSync(resolve(__dirname, '../src/storage/providers/FtpProvider.ts'), 'utf8')
const sftpSource = readFileSync(resolve(__dirname, '../src/storage/providers/SftpProvider.ts'), 'utf8')
const webdavSource = readFileSync(resolve(__dirname, '../src/storage/providers/WebDavProvider.ts'), 'utf8')
const s3Source = readFileSync(resolve(__dirname, '../src/storage/providers/S3Provider.ts'), 'utf8')
const factorySource = readFileSync(resolve(__dirname, '../src/storage/factory.ts'), 'utf8')
const storageConfigRoutes = readFileSync(resolve(__dirname, '../src/routes/storage-configs.ts'), 'utf8')

for (const [label, source] of [
  ['FTP', ftpSource],
  ['SFTP', sftpSource],
  ['WebDAV', webdavSource],
  ['S3', s3Source]
] as const) {
  assert.ok(source.includes('assertSafeStorageTarget'), `${label} provider must validate outbound storage host`)
  assert.ok(source.includes('joinStorageRemotePath(this.basePath, filename)'), `${label} provider must validate remote filenames`)
  assert.ok(source.includes('joinStorageRemoteDirectory(this.basePath, path)'), `${label} provider must scope directory listing to configured base path`)
  assert.ok(source.includes('normalizeStorageBasePath(config.basePath)'), `${label} provider must normalize configured base path`)
}

assert.ok(factorySource.includes('new S3Provider'), 'storage factory must create S3 providers')
assert.ok(storageConfigRoutes.includes('normalizeS3Extra'), 'storage routes must validate S3 bucket metadata')
assert.ok(!storageConfigRoutes.includes('S3 存储暂未实现'), 'storage routes must not reject S3 configs as unimplemented')

console.log('storage outbound guard tests passed')
