/**
 * 帮助文档相关数据库操作
 * 使用 Prisma ORM
 */

import { prisma } from './prisma.js'
import type { HelpArticle } from '../types/database.js'

/**
 * 获取帮助文档列表（分页）
 */
export async function getHelpArticles(options: {
  page?: number
  pageSize?: number
  publishedOnly?: boolean
  category?: string | null
  pinnedOnly?: boolean  // 只获取置顶文章
} = {}): Promise<{
  items: Array<Pick<HelpArticle, 'id' | 'title' | 'slug' | 'category' | 'sort_order' | 'published' | 'pinned' | 'created_at' | 'updated_at'>>
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const { page = 1, pageSize = 20, publishedOnly = true, category = null, pinnedOnly = false } = options

  const where: any = {}

  if (publishedOnly) {
    where.published = true
  }

  if (category) {
    where.category = category
  }

  if (pinnedOnly) {
    where.pinned = true
  }

  // 获取总数
  const total = await prisma.helpArticle.count({ where })

  // 获取数据
  const articles = await prisma.helpArticle.findMany({
    where,
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
      sortOrder: true,
      published: true,
      pinned: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: pinnedOnly ? [
      { sortOrder: 'asc' },
      { createdAt: 'desc' }
    ] : [
      { pinned: 'desc' },  // 置顶文章优先
      { sortOrder: 'asc' },
      { createdAt: 'desc' }
    ],
    skip: (page - 1) * pageSize,
    take: pageSize
  })

  return {
    items: articles.map(a => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      category: a.category,
      sort_order: a.sortOrder,
      published: a.published ? 1 : 0,
      pinned: a.pinned ? 1 : 0,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString()
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  }
}

/**
 * 获取置顶的帮助文档（用于首页显示）
 */
export async function getPinnedHelpArticles(limit: number = 6): Promise<Array<Pick<HelpArticle, 'id' | 'title' | 'slug' | 'category'>>> {
  const articles = await prisma.helpArticle.findMany({
    where: {
      published: true,
      pinned: true
    },
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
      sortOrder: true
    },
    orderBy: [
      { sortOrder: 'asc' },
      { createdAt: 'desc' }
    ],
    take: limit
  })

  return articles.map(a => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    category: a.category
  }))
}

/**
 * 通过 ID 获取帮助文档
 */
export async function getHelpArticleById(id: number): Promise<HelpArticle | null> {
  const article = await prisma.helpArticle.findUnique({
    where: { id }
  })

  if (!article) return null

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    content: article.content,
    category: article.category,
    sort_order: article.sortOrder,
    published: article.published ? 1 : 0,
    pinned: article.pinned ? 1 : 0,
    created_by: article.createdBy,
    created_at: article.createdAt.toISOString(),
    updated_at: article.updatedAt.toISOString()
  }
}

/**
 * 通过 slug 获取帮助文档（公开，只返回已发布的）
 */
export async function getHelpArticleBySlug(slug: string): Promise<HelpArticle | null> {
  const article = await prisma.helpArticle.findFirst({
    where: {
      slug,
      published: true
    }
  })

  if (!article) return null

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    content: article.content,
    category: article.category,
    sort_order: article.sortOrder,
    published: article.published ? 1 : 0,
    pinned: article.pinned ? 1 : 0,
    created_by: article.createdBy,
    created_at: article.createdAt.toISOString(),
    updated_at: article.updatedAt.toISOString()
  }
}

/**
 * 创建帮助文档
 */
export async function createHelpArticle(data: {
  title: string
  slug: string
  content: string
  category?: string
  sortOrder?: number
  published?: boolean
  pinned?: boolean
  createdBy?: number | null
}): Promise<number> {
  const article = await prisma.helpArticle.create({
    data: {
      title: data.title,
      slug: data.slug,
      content: data.content,
      category: data.category ?? 'general',
      sortOrder: data.sortOrder ?? 0,
      published: data.published !== false,
      pinned: data.pinned === true,
      createdBy: data.createdBy ?? null
    }
  })

  return article.id
}

/**
 * 更新帮助文档
 */
export async function updateHelpArticle(id: number, data: {
  title?: string
  slug?: string
  content?: string
  category?: string
  sortOrder?: number
  published?: boolean
  pinned?: boolean
}): Promise<void> {
  const updateData: {
    title?: string
    slug?: string
    content?: string
    category?: string
    sortOrder?: number
    published?: boolean
    pinned?: boolean
  } = {}

  if (data.title !== undefined) updateData.title = data.title
  if (data.slug !== undefined) updateData.slug = data.slug
  if (data.content !== undefined) updateData.content = data.content
  if (data.category !== undefined) updateData.category = data.category
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder
  if (data.published !== undefined) updateData.published = data.published
  if (data.pinned !== undefined) updateData.pinned = data.pinned

  if (Object.keys(updateData).length === 0) return

  await prisma.helpArticle.update({
    where: { id },
    data: updateData
  })
}

/**
 * 删除帮助文档
 */
export async function deleteHelpArticle(id: number): Promise<void> {
  await prisma.helpArticle.delete({
    where: { id }
  })
}

/**
 * 获取帮助分类列表
 */
export async function getHelpCategories(): Promise<Array<{ category: string; count: number }>> {
  const categories = await prisma.helpArticle.groupBy({
    by: ['category'],
    where: {
      published: true
    },
    _count: {
      id: true
    },
    orderBy: {
      category: 'asc'
    }
  })

  return categories.map(c => ({
    category: c.category,
    count: c._count.id
  }))
}
