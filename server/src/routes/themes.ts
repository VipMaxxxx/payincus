import { readFile } from 'fs/promises'
import { extname, join } from 'path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getActiveThemePackage, getThemePackage, getThemePackageForAsset, serializeThemePackage } from '../db/themes.js'
import { getThemeDataDir, resolveThemeAsset, type PayIncusThemeManifest } from '../lib/theme-package.js'

function normalizeThemeId(value: string): string | null {
  const trimmed = value.trim()
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(trimmed) ? trimmed : null
}

function normalizeVersion(value: string): string | null {
  const trimmed = value.trim()
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed) ? trimmed : null
}

function normalizeThemeConfigKey(value: string): string | null {
  const trimmed = value.trim()
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(trimmed) ? trimmed : null
}

function normalizeThemeConfigFilename(value: string): string | null {
  const trimmed = value.trim()
  return /^[0-9]+-[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(trimmed) ? trimmed : null
}

function contentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.json') return 'application/json; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.woff') return 'font/woff'
  if (ext === '.woff2') return 'font/woff2'
  return 'application/octet-stream'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function previewHtml(input: { name: string; themeId: string; version: string; cssUrl: string; description?: string | null }): string {
  const name = escapeHtml(input.name)
  const description = escapeHtml(input.description || 'PayIncus theme preview')
  const themeId = escapeHtml(input.themeId)
  const version = escapeHtml(input.version)
  const cssUrl = escapeHtml(input.cssUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${name} - Theme Preview</title>
  <link rel="stylesheet" href="${cssUrl}">
  <style>
    body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--color-bg,#f7f8fa);color:var(--color-text,#111827)}
    .shell{min-height:100vh;display:grid;grid-template-columns:260px 1fr}
    .side{background:var(--color-sidebar,#111827);color:var(--color-sidebar-text,#fff);padding:28px 20px}
    .brand{font-size:18px;font-weight:700}
    .nav{margin-top:28px;display:grid;gap:10px}
    .nav span{display:block;border-radius:8px;padding:10px 12px;background:rgba(255,255,255,.08)}
    .main{padding:32px}
    .hero,.card{border:1px solid var(--color-border,#e5e7eb);border-radius:8px;background:var(--color-surface,#fff);box-shadow:0 10px 30px rgba(15,23,42,.06)}
    .hero{padding:28px}
    .title{font-size:28px;font-weight:750;margin:0}
    .muted{color:var(--color-muted,#6b7280)}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:18px}
    .card{padding:18px}
    .button{display:inline-flex;margin-top:18px;border-radius:8px;padding:10px 14px;background:var(--color-primary,#111827);color:var(--color-primary-text,#fff)}
    @media(max-width:720px){.shell{grid-template-columns:1fr}.side{display:none}.grid{grid-template-columns:1fr}.main{padding:18px}}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="side">
      <div class="brand">PayIncus</div>
      <div class="nav"><span>仪表盘</span><span>实例</span><span>订单</span><span>工单</span></div>
    </aside>
    <main class="main">
      <section class="hero">
        <p class="muted">${themeId}@${version}</p>
        <h1 class="title">${name}</h1>
        <p class="muted">${description}</p>
        <span class="button">主要操作</span>
      </section>
      <section class="grid">
        <div class="card"><strong>用户中心</strong><p class="muted">余额、服务和通知样式预览。</p></div>
        <div class="card"><strong>产品卡片</strong><p class="muted">套餐、价格和状态标签预览。</p></div>
        <div class="card"><strong>后台面板</strong><p class="muted">表格、按钮和边框样式预览。</p></div>
      </section>
    </main>
  </div>
</body>
</html>`
}

export default async function themeRoutes(fastify: FastifyInstance) {
  fastify.get('/active', async () => {
    const theme = await getActiveThemePackage()
    return { theme: theme ? serializeThemePackage(theme) : null }
  })

  fastify.get('/:themeId/config-files/:key/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { themeId?: string; key?: string; filename?: string }
    const themeId = params.themeId ? normalizeThemeId(params.themeId) : null
    const key = params.key ? normalizeThemeConfigKey(params.key) : null
    const filename = params.filename ? normalizeThemeConfigFilename(params.filename) : null
    if (!themeId || !key || !filename) {
      return reply.code(400).send({ error: 'Invalid theme config file path', code: 'INVALID_THEME_CONFIG_FILE_PATH' })
    }
    const theme = await getActiveThemePackage()
    if (!theme || theme.themeId !== themeId || !theme.enabled) {
      return reply.code(404).send({ error: 'Theme config file not found', code: 'THEME_CONFIG_FILE_NOT_FOUND' })
    }
    const manifest = theme.manifest as unknown as PayIncusThemeManifest
    const configValues = theme.configValues as Record<string, unknown>
    const field = manifest.configSchema?.[key]
    if (!field || field.type !== 'file') {
      return reply.code(404).send({ error: 'Theme config file not found', code: 'THEME_CONFIG_FILE_NOT_FOUND' })
    }
    const expectedValue = `/api/themes/${encodeURIComponent(themeId)}/config-files/${encodeURIComponent(key)}/${encodeURIComponent(filename)}`
    if (configValues[key] !== expectedValue) {
      return reply.code(404).send({ error: 'Theme config file not found', code: 'THEME_CONFIG_FILE_NOT_FOUND' })
    }
    try {
      const filePath = resolveThemeAsset(getThemeDataDir(), join('config-files', themeId, key, filename))
      const body = await readFile(filePath)
      reply
        .type(contentTypeForPath(filename))
        .header('Cache-Control', 'public, max-age=300')
        .header('Referrer-Policy', 'same-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Robots-Tag', 'noindex')
        .send(body)
    } catch {
      return reply.code(404).send({ error: 'Theme config file not found', code: 'THEME_CONFIG_FILE_NOT_FOUND' })
    }
  })

  fastify.get<{ Params: { themeId: string } }>('/preview/:themeId', async (request, reply) => {
    const themeId = normalizeThemeId(request.params.themeId)
    if (!themeId) return reply.code(400).send({ error: 'Invalid theme id', code: 'INVALID_THEME_ID' })
    const theme = await getThemePackage(themeId)
    if (!theme) return reply.code(404).send({ error: 'Theme not found', code: 'THEME_NOT_FOUND' })
    const serialized = serializeThemePackage(theme)
    reply
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'private, no-store')
      .header('X-Robots-Tag', 'noindex')
      .send(previewHtml({
        name: serialized.name,
        themeId: serialized.themeId,
        version: serialized.version,
        cssUrl: serialized.cssUrl,
        description: serialized.description
      }))
  })

  fastify.get('/assets/:themeId/:version/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { themeId?: string; version?: string; '*': string }
    const themeId = params.themeId ? normalizeThemeId(params.themeId) : null
    const version = params.version ? normalizeVersion(params.version) : null
    const assetPath = params['*'] || ''
    if (!themeId || !version || !assetPath || assetPath.startsWith('/') || assetPath.includes('..') || assetPath.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid theme asset path', code: 'INVALID_THEME_ASSET_PATH' })
    }
    const theme = await getThemePackageForAsset(themeId, version)
    if (!theme) return reply.code(404).send({ error: 'Theme asset not found', code: 'THEME_ASSET_NOT_FOUND' })

    try {
      const filePath = resolveThemeAsset(theme.installPath, assetPath)
      const body = await readFile(filePath)
      reply
        .type(contentTypeForPath(assetPath))
        .header('Cache-Control', theme.enabled ? 'public, max-age=300' : 'private, max-age=60')
        .header('Referrer-Policy', 'same-origin')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Robots-Tag', 'noindex')
        .send(body)
    } catch {
      return reply.code(404).send({ error: 'Theme asset not found', code: 'THEME_ASSET_NOT_FOUND' })
    }
  })
}
