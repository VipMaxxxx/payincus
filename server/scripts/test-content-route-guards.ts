import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const announcementsSource = readFileSync(resolve(process.cwd(), 'src/routes/announcements.ts'), 'utf8')
const helpSource = readFileSync(resolve(process.cwd(), 'src/routes/help.ts'), 'utf8')
const helpDbSource = readFileSync(resolve(process.cwd(), 'src/db/help.ts'), 'utf8')

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

assert.ok(
  announcementsSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    announcementsSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number, max: number): number') &&
    announcementsSource.includes('function parseOptionalPositiveId(value: string | undefined): number | null | undefined') &&
    announcementsSource.includes('function parseAnnouncementType(value: string | undefined): AnnouncementType | null | undefined'),
  'announcement routes must define strict ID, pagination, optional ID, and type parsers'
)

assert.ok(
  announcementsSource.includes('const announcementId = parsePositiveRouteId(id)') &&
    announcementsSource.includes('if (!announcementId)') &&
    announcementsSource.includes("return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS, 'Invalid announcement type'))") &&
    announcementsSource.includes('const hostId = parseOptionalPositiveId(request.query.hostId)') &&
    announcementsSource.includes('pageSize: parsePositiveInteger(request.query.pageSize, 20, 100)'),
  'announcement routes must reject malformed IDs, host filters, types, and oversized pagination'
)

for (const forbiddenPattern of [
  'const announcementId = Number(id)',
  'isNaN(announcementId)',
  'page: parseInt(page, 10) || 1',
  'pageSize: parseInt(pageSize, 10) || 20',
  'hostId: hostId ? parseInt(hostId, 10) : undefined',
  'type: type as any'
]) {
  assert.ok(
    !announcementsSource.includes(forbiddenPattern),
    `announcement routes must not keep loose parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  helpSource.includes('function parsePositiveRouteId(value: string): number | null') &&
    helpSource.includes('function parsePositiveInteger(value: string | undefined, fallback: number, max: number): number') &&
    helpSource.includes('const POSITIVE_ROUTE_ID_PATTERN = /^[1-9]\\d*$/') &&
    helpSource.includes('Number.isSafeInteger(parsed)') &&
    helpSource.includes('const HELP_SLUG_PATTERN = /^[a-z0-9-]+$/') &&
    helpSource.includes('function getBodyRecord(body: unknown): Record<string, unknown> | null') &&
    helpSource.includes('function normalizeRequiredText(value: unknown, maxLength: number): string | null') &&
    helpSource.includes('function normalizeSortOrder(value: unknown): number') &&
    helpSource.includes('function normalizeOptionalBoolean(value: unknown): boolean | undefined | null'),
  'help routes must define strict safe-integer and content normalization helpers'
)

assert.equal(
  helpSource.match(/const articleId = parsePositiveRouteId\(id\)/g)?.length ?? 0,
  3,
  'help admin detail/update/delete routes must strictly validate article IDs'
)

const publicListRoute = sectionBetween(
  helpSource,
  'fastify.get<{',
  '  /**\n   * 获取置顶的帮助文档'
)
const pinnedRoute = sectionBetween(
  helpSource,
  "fastify.get('/pinned'",
  '  /**\n   * 获取帮助分类配置'
)
const adminListRoute = sectionBetween(
  helpSource,
  "}>('/admin', {",
  '  /**\n   * 获取帮助文档详情（管理员）'
)
const categoryConfigRoute = sectionBetween(
  helpSource,
  "fastify.put<{ Body: { categories:",
  '  /**\n   * 获取所有帮助文档列表（管理员，包括未发布）'
)
const createRoute = sectionBetween(
  helpSource,
  "fastify.post<{ Body:",
  '  /**\n   * 更新帮助文档（管理员）'
)
const updateRoute = sectionBetween(
  helpSource,
  "fastify.patch<{",
  '  /**\n   * 删除帮助文档（管理员）'
)

assert.ok(
  publicListRoute.includes('page: parsePositiveInteger(request.query.page, 1, 100000)') &&
    publicListRoute.includes('pageSize: parsePositiveInteger(request.query.pageSize, 20, 100)') &&
    pinnedRoute.includes('const limitNum = parsePositiveInteger(request.query.limit, 6, 20)') &&
    adminListRoute.includes('page: parsePositiveInteger(request.query.page, 1, 100000)') &&
    adminListRoute.includes('pageSize: parsePositiveInteger(request.query.pageSize, 20, 100)'),
  'help list routes must sanitize pagination and pinned limits before DB helpers'
)

for (const forbiddenPattern of [
  'const articleId = Number(id)',
  'isNaN(articleId)',
  'page: parseInt(page, 10)',
  'pageSize: parseInt(pageSize, 10)',
  'Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20)',
  'const existing = await db.getHelpArticleBySlug(slug)',
  'const existing = await db.getHelpArticleBySlug(normalizedSlug)',
  'sortOrder: sortOrder || 0'
]) {
  assert.ok(
    !helpSource.includes(forbiddenPattern),
    `help routes must not keep loose parsing: ${forbiddenPattern}`
  )
}

assert.ok(
  helpSource.includes('function normalizeHelpCategoryConfigInput(body: unknown)') &&
    helpSource.includes('const record = getBodyRecord(body)') &&
    helpSource.includes('!record || !Array.isArray(record.categories)') &&
    helpSource.includes('record.categories.length > MAX_HELP_CATEGORY_CONFIG_ITEMS') &&
    helpSource.includes('const category = getBodyRecord(item)') &&
    helpSource.includes('const id = normalizeCategoryId(category.id)') &&
    helpSource.includes('const name = normalizeRequiredText(category.name, MAX_HELP_CATEGORY_NAME_LENGTH)') &&
    helpSource.includes("!/^#[0-9a-fA-F]{6}$/.test(color)") &&
    helpSource.includes('categoryIds.has(id)') &&
    categoryConfigRoute.includes('maxItems: MAX_HELP_CATEGORY_CONFIG_ITEMS') &&
    categoryConfigRoute.includes('maxLength: MAX_HELP_CATEGORY_LENGTH') &&
    categoryConfigRoute.includes('maxLength: MAX_HELP_CATEGORY_NAME_LENGTH') &&
    categoryConfigRoute.includes('const categories = normalizeHelpCategoryConfigInput(request.body)') &&
    categoryConfigRoute.includes('if (!categories)') &&
    categoryConfigRoute.includes('return reply.code(400).send(apiError(ErrorCode.INVALID_PARAMS))'),
  'help category config route must bound category payloads and reject empty/duplicate IDs after trimming'
)

for (const [name, route] of [
  ['create route', createRoute],
  ['update route', updateRoute]
] as const) {
  assert.ok(
    route.includes('maxLength: MAX_HELP_TITLE_LENGTH') &&
      route.includes('maxLength: MAX_HELP_SLUG_LENGTH') &&
      route.includes('maxLength: MAX_HELP_CONTENT_LENGTH') &&
      route.includes('maxLength: MAX_HELP_CATEGORY_LENGTH') &&
      route.includes('minimum: 0, maximum: MAX_HELP_SORT_ORDER') &&
      route.includes('normalizeSortOrder'),
    `help ${name} must bound article fields and normalize sort inputs`
  )
}

assert.ok(
  createRoute.includes('const body = getBodyRecord(request.body)') &&
    createRoute.includes('if (!body)') &&
    createRoute.includes('normalizeRequiredText(body.title, MAX_HELP_TITLE_LENGTH)') &&
    createRoute.includes('normalizeSlug(body.slug)') &&
    createRoute.includes('normalizeRequiredText(body.content, MAX_HELP_CONTENT_LENGTH)') &&
    createRoute.includes('normalizeOptionalText(body.category, MAX_HELP_CATEGORY_LENGTH) ?? \'general\'') &&
    createRoute.includes('const published = normalizeOptionalBoolean(body.published)') &&
    createRoute.includes('const pinned = normalizeOptionalBoolean(body.pinned)'),
  'help create route must validate body shape and require normalized title, slug, content, category, and boolean values'
)

assert.ok(
  updateRoute.includes('const body = getBodyRecord(request.body)') &&
    updateRoute.includes('if (!body)') &&
    updateRoute.includes('normalizeOptionalText(body.title, MAX_HELP_TITLE_LENGTH)') &&
    updateRoute.includes('normalizeOptionalSlug(body.slug)') &&
    updateRoute.includes('normalizeOptionalText(body.content, MAX_HELP_CONTENT_LENGTH)') &&
    updateRoute.includes('normalizeOptionalText(body.category, MAX_HELP_CATEGORY_LENGTH)') &&
    updateRoute.includes('const published = normalizeOptionalBoolean(body.published)') &&
    updateRoute.includes('const pinned = normalizeOptionalBoolean(body.pinned)'),
  'help update route must validate body shape and normalize optional title, slug, content, category, and boolean values'
)

assert.ok(
  createRoute.includes('const existing = await db.getAnyHelpArticleBySlug(normalizedSlug)') &&
    updateRoute.includes('const existing = await db.getAnyHelpArticleBySlug(normalizedSlug)'),
  'help create/update routes must check slug uniqueness against published and unpublished articles'
)

assert.ok(
  helpDbSource.includes('function clampHelpPagination(page: number | undefined, pageSize: number | undefined)') &&
    helpDbSource.includes('function normalizeHelpCategory(value: string | null | undefined): string | null') &&
    helpDbSource.includes('const { page, pageSize } = clampHelpPagination(options.page, options.pageSize)') &&
    helpDbSource.includes('const category = normalizeHelpCategory(options.category)') &&
    helpDbSource.includes('const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 6') &&
    helpDbSource.includes('export async function getAnyHelpArticleBySlug(slug: string): Promise<HelpArticle | null>'),
  'help DB helpers must defensively clamp pagination, normalize category filters, cap pinned limits, and expose all-status slug lookup'
)

console.log('content route guard tests passed')
