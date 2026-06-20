/**
 * 帮助文档路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { getSystemConfig, updateSystemConfig } from '../db/system-config.js'
import { prisma } from '../db/prisma.js'
import { invalidateCachedConfig } from '../lib/config-cache.js'

// 默认分类配置
const DEFAULT_CATEGORIES = [
  { id: 'general', name: '常规', color: '#6b7280' },
  { id: 'getting-started', name: '快速开始', color: '#22c55e' },
  { id: 'instances', name: '实例管理', color: '#3b82f6' },
  { id: 'networking', name: '网络配置', color: '#8b5cf6' },
  { id: 'billing', name: '计费相关', color: '#f59e0b' },
  { id: 'faq', name: '常见问题', color: '#ef4444' }
]

export default async function helpRoutes(fastify: FastifyInstance) {

  // ==================== 公开 API ====================

  /**
   * 获取帮助文档列表（公开，只显示已发布）
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      category?: string
    }
  }>('/', async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      category?: string
    }
  }>) => {
    const { page = '1', pageSize = '20', category } = request.query

    const result = await db.getHelpArticles({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      publishedOnly: true,
      category: category || undefined
    })

    return {
      articles: result.items.map(a => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        category: a.category,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }
  })

  /**
   * 获取置顶的帮助文档（公开，用于首页显示）
   */
  fastify.get('/pinned', async (request: FastifyRequest<{
    Querystring: {
      limit?: string
    }
  }>) => {
    const { limit = '6' } = request.query
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 20) // 限制在 1-20 之间

    const articles = await db.getPinnedHelpArticles(limitNum)
    return { articles }
  })

  /**
   * 获取帮助分类配置（公开）
   */
  fastify.get('/category-config', async () => {
    const configStr = await getSystemConfig('help_categories', false)
    if (configStr) {
      try {
        return { categories: JSON.parse(configStr) }
      } catch {
        // 解析失败，返回默认
      }
    }
    return { categories: DEFAULT_CATEGORIES }
  })

  /**
   * 获取帮助分类列表（公开）
   */
  fastify.get('/categories', async () => {
    const categories = await db.getHelpCategories()
    return { categories }
  })

  /**
   * 通过 slug 获取帮助文档详情（公开）
   */
  fastify.get<{ Params: { slug: string } }>('/article/:slug', async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const { slug } = request.params

    const article = await db.getHelpArticleBySlug(slug)
    if (!article) {
      return reply.code(404).send(apiError(ErrorCode.ARTICLE_NOT_FOUND))
    }

    return {
      article: {
        id: article.id,
        title: article.title,
        slug: article.slug,
        content: article.content,
        category: article.category,
        created_at: article.created_at,
        updated_at: article.updated_at
      }
    }
  })

  // ==================== 管理 API ====================

  /**
   * 保存帮助分类配置（管理员）
   */
  fastify.put<{ Body: { categories: Array<{ id: string; name: string; color: string }> } }>('/admin/category-config', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['categories'],
        properties: {
          categories: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name', 'color'],
              properties: {
                id: { type: 'string', pattern: '^[a-z0-9-]+$' },
                name: { type: 'string', minLength: 1 },
                color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { categories: Array<{ id: string; name: string; color: string }> } }>) => {
    const { categories } = request.body
    
    // 检查配置是否已存在
    const existing = await prisma.systemConfig.findUnique({ where: { key: 'help_categories' } })
    
    if (existing) {
      await updateSystemConfig('help_categories', JSON.stringify(categories))
    } else {
      // 创建新配置
      await prisma.systemConfig.create({
        data: {
          key: 'help_categories',
          value: JSON.stringify(categories),
          type: 'json',
          label: '帮助中心分类配置',
          description: '帮助文档的分类配置（ID、名称、颜色）'
        }
      })
      // 清除缓存（可能缓存了 null）
      invalidateCachedConfig('help_categories')
    }
    
    await createLog(
      request.user.id,
      'system',
      'help.category_config',
      `Updated help category config (${categories.length} categories)`,
      'success'
    )
    
    return { message: 'Category config saved' }
  })

  /**
   * 获取所有帮助文档列表（管理员，包括未发布）
   */
  fastify.get<{
    Querystring: {
      page?: string
      pageSize?: string
      category?: string
    }
  }>('/admin', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{
    Querystring: {
      page?: string
      pageSize?: string
      category?: string
    }
  }>, _reply: FastifyReply) => {
    const { page = '1', pageSize = '20', category } = request.query

    const result = await db.getHelpArticles({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      publishedOnly: false,
      category: category || undefined
    })

    return {
      articles: result.items.map(a => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        category: a.category,
        sort_order: a.sort_order,
        published: a.published, // 已经是 0 或 1
        pinned: a.pinned, // 已经是 0 或 1
        created_at: a.created_at,
        updated_at: a.updated_at
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages
    }
  })

  /**
   * 获取帮助文档详情（管理员）
   */
  fastify.get<{ Params: { id: string } }>('/admin/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const articleId = Number(id)

    if (isNaN(articleId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const article = await db.getHelpArticleById(articleId)

    if (!article) {
      return reply.code(404).send(apiError(ErrorCode.ARTICLE_NOT_FOUND))
    }

    return {
      article: {
        id: article.id,
        title: article.title,
        slug: article.slug,
        content: article.content,
        category: article.category,
        sort_order: article.sort_order,
        published: article.published, // 已经是 0 或 1
        pinned: article.pinned, // 已经是 0 或 1
        created_at: article.created_at,
        updated_at: article.updated_at
      }
    }
  })

  /**
   * 创建帮助文档（管理员）
   */
  fastify.post<{ Body: { title: string; slug: string; content: string; category?: string; sortOrder?: number; published?: boolean; pinned?: boolean } }>('/admin', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['title', 'slug', 'content'],
        properties: {
          title: { type: 'string', minLength: 1 },
          slug: { type: 'string', minLength: 1, pattern: '^[a-z0-9-]+$' },
          content: { type: 'string' },
          category: { type: 'string' },
          sortOrder: { type: 'integer' },
          published: { type: 'boolean' },
          pinned: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { title: string; slug: string; content: string; category?: string; sortOrder?: number; published?: boolean; pinned?: boolean } }>, reply: FastifyReply) => {
    const { title, slug, content, category, sortOrder, published, pinned } = request.body

    // Check slug uniqueness
    const existing = await db.getHelpArticleBySlug(slug)
    if (existing) {
      return reply.code(400).send(apiError(ErrorCode.SLUG_EXISTS))
    }

    const articleId = await db.createHelpArticle({
      title,
      slug,
      content,
      category: category || 'general',
      sortOrder: sortOrder || 0,
      published: published !== false,
      pinned: pinned === true,
      createdBy: request.user.id
    })

    await createLog(
      request.user.id,
      'system',
      'help.create',
      `Created help article "${title}" (ID: ${articleId})`,
      'success'
    )

    return {
      message: 'Article created',
      article: { id: articleId, title, slug }
    }
  })

  /**
   * 更新帮助文档（管理员）
   */
  fastify.patch<{
    Params: { id: string }
    Body: { title?: string; slug?: string; content?: string; category?: string; sortOrder?: number; published?: boolean; pinned?: boolean }
  }>('/admin/:id', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          slug: { type: 'string', minLength: 1, pattern: '^[a-z0-9-]+$' },
          content: { type: 'string' },
          category: { type: 'string' },
          sortOrder: { type: 'integer' },
          published: { type: 'boolean' },
          pinned: { type: 'boolean' }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: { title?: string; slug?: string; content?: string; category?: string; sortOrder?: number; published?: boolean; pinned?: boolean }
  }>, reply: FastifyReply) => {
    const { id } = request.params
    const articleId = Number(id)

    if (isNaN(articleId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const { title, slug, content, category, sortOrder, published, pinned } = request.body

    const article = await db.getHelpArticleById(articleId)
    if (!article) {
      return reply.code(404).send(apiError(ErrorCode.ARTICLE_NOT_FOUND))
    }

    // Check slug uniqueness if changed
    if (slug && slug !== article.slug) {
      const existing = await db.getHelpArticleBySlug(slug)
      if (existing) {
        return reply.code(400).send(apiError(ErrorCode.SLUG_EXISTS))
      }
    }

    await db.updateHelpArticle(articleId, { title, slug, content, category, sortOrder, published, pinned })

    await createLog(
      request.user.id,
      'system',
      'help.update',
      `Updated help article "${article.title}" (ID: ${articleId})`,
      'success'
    )

    return { message: 'Article updated' }
  })

  /**
   * 删除帮助文档（管理员）
   */
  fastify.delete<{ Params: { id: string } }>('/admin/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const articleId = Number(id)

    if (isNaN(articleId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const article = await db.getHelpArticleById(articleId)
    if (!article) {
      return reply.code(404).send(apiError(ErrorCode.ARTICLE_NOT_FOUND))
    }

    await db.deleteHelpArticle(articleId)

    await createLog(
      request.user.id,
      'system',
      'help.delete',
      `Deleted help article "${article.title}" (ID: ${articleId})`,
      'success'
    )

    return { message: 'Article deleted' }
  })
}

