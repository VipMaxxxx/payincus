import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsSiteDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(docsSiteDir, '..')

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

function requireText(content, expected, label) {
  if (!content.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`)
  }
}

function rejectText(content, rejected, label) {
  if (content.includes(rejected)) {
    throw new Error(`${label}: contains forbidden ${JSON.stringify(rejected)}`)
  }
}

const installer = read('scripts/install-panel.sh')
for (const expected of [
  'is_atomic_layout()',
  'verify_release_checksum()',
  'validate_release_archive()',
  '检测到原子 OTA 布局'
]) {
  requireText(installer, expected, 'installer')
}

for (const path of [
  'docs-site/docs/deployment/manual-install.md',
  'docs-site/docs/en/deployment/manual-install.md'
]) {
  const manual = read(path)
  requireText(manual, '${PACKAGE}.sha256', path)
  requireText(manual, 'sha256sum -c', path)
  requireText(manual, '/opt/incudal/releases/.next-current', path)
}

for (const path of [
  'docs-site/docs/deployment/systemd.md',
  'docs-site/docs/en/deployment/systemd.md'
]) {
  const systemd = read(path)
  rejectText(systemd, 'ExecStartPre=cd ', path)
  requireText(systemd, "ExecStartPre=/usr/bin/bash -lc", path)
}

const config = read('docs-site/docs/.vitepress/config.ts')
requireText(config, "const siteOrigin = 'https://payincus.com'", 'VitePress config')
requireText(config, 'transformHead({ pageData })', 'VitePress config')
requireText(config, 'hostname: siteOrigin', 'VitePress config')

const changelogGenerator = read('docs-site/scripts/generate-changelog.mjs')
requireText(changelogGenerator, "--format=%H%x09%cs%x09%s", 'changelog generator')
requireText(changelogGenerator, 'fullHash.slice(0, 9)', 'changelog generator')
requireText(changelogGenerator, 'normalizeEmbeddedReleaseNoteHeadings', 'changelog generator')

const cname = read('docs-site/docs/public/CNAME').trim()
if (cname !== 'payincus.com') {
  throw new Error(`CNAME must be payincus.com, received ${JSON.stringify(cname)}`)
}

const robots = read('docs-site/docs/public/robots.txt')
requireText(robots, 'Sitemap: https://payincus.com/sitemap.xml', 'robots.txt')

const workflow = read('.github/workflows/docs-pages.yml')
requireText(workflow, '- main', 'docs workflow')
rejectText(workflow, "- 'v*'", 'docs workflow')
requireText(workflow, 'check:deployment', 'docs workflow')

console.log('Deployment documentation guards passed.')
