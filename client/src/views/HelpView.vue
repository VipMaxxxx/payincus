<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { parseMarkdown } from '@/utils/markdown'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

// 列表视图
interface HelpArticle {
  id: number
  title: string
  slug: string
  content: string
  category: string
  sort_order: number
  published: number
  created_at: string
  updated_at: string
}
const articles = ref<HelpArticle[]>([])
const loading = ref<boolean>(true)
const page = ref<number>(1)
const pageSize = ref<number>(10)
const total = ref<number>(0)
const totalPages = ref<number>(0)

// 详情视图
const currentArticle = ref<HelpArticle | null>(null)
const articleLoading = ref<boolean>(false)
// 标记是否已完成首次加载（用于区分初始状态和真正的404）
const articleLoaded = ref<boolean>(false)

// 分类筛选
interface CategoryWithCount {
  category: string
  count: number
}
const categories = ref<CategoryWithCount[]>([])
const selectedCategory = ref<string>('')

// 分类配置（从服务器加载）
interface Category {
  id: string
  name: string
  color: string
}
const categoryConfig = ref<Category[]>([
  { id: 'general', name: '', color: '#6b7280' },
  { id: 'getting-started', name: '', color: '#22c55e' },
  { id: 'instances', name: '', color: '#3b82f6' },
  { id: 'networking', name: '', color: '#8b5cf6' },
  { id: 'billing', name: '', color: '#f59e0b' },
  { id: 'faq', name: '', color: '#ef4444' }
])

// 计算属性：是否正在查看文章？
const isDetailView = computed<boolean>(() => !!(route.params.slug as string | undefined))

onMounted(async (): Promise<void> => {
  // 并行加载分类配置和分类列表
  await Promise.all([loadCategoryConfig(), loadCategories()])
  
  if (route.params.slug) {
    await loadArticle(route.params.slug as string)
  } else {
    await loadArticles()
  }
})

async function loadCategoryConfig(): Promise<void> {
  try {
    const response = await api.help.categoryConfig()
    if (response.categories && response.categories.length > 0) {
      categoryConfig.value = response.categories
    }
  } catch (err) {
    console.error('Failed to load category config:', err)
    // 加载失败时使用默认配置
  }
}

watch(() => route.params.slug, async (newSlug) => {
  if (newSlug) {
    await loadArticle(newSlug as string)
  } else {
    currentArticle.value = null
    articleLoaded.value = false
    await loadArticles()
  }
})

async function loadCategories(): Promise<void> {
  try {
    const response = await api.help.categories()
    const cats = (response as { categories?: CategoryWithCount[] | string[] }).categories || []
    // 处理 string[] 和 CategoryWithCount[] 两种格式
    if (cats.length > 0 && typeof cats[0] === 'string') {
      // 将 string[] 转换为 CategoryWithCount[]
      categories.value = (cats as string[]).map(cat => ({ category: cat, count: 0 }))
    } else {
      categories.value = cats as CategoryWithCount[]
    }
  } catch (err) {
    console.error('Failed to load categories:', err)
  }
}

async function loadArticles(): Promise<void> {
  loading.value = true
  try {
    const params: { page: number; pageSize: number; category?: string } = { page: page.value, pageSize: pageSize.value }
    if (selectedCategory.value) {
      params.category = selectedCategory.value
    }
    const response = await api.help.list(params)
    const data = response as { articles?: HelpArticle[]; total?: number; totalPages?: number }
    articles.value = data.articles || []
    total.value = data.total || 0
    totalPages.value = data.totalPages || 1
  } catch (err) {
    console.error('Failed to load articles:', err)
  } finally {
    loading.value = false
  }
}

async function loadArticle(slug: string): Promise<void> {
  articleLoading.value = true
  articleLoaded.value = false
  try {
    const response = await api.help.getBySlug(slug)
    currentArticle.value = (response as { article?: HelpArticle }).article || null
  } catch (err) {
    console.error('Failed to load article:', err)
    currentArticle.value = null
  } finally {
    articleLoading.value = false
    articleLoaded.value = true
  }
}

function filterByCategory(cat: string): void {
  selectedCategory.value = cat
  page.value = 1
  loadArticles()
}

function goToArticle(slug: string): void {
  router.push(`/help/${slug}`)
}

function goBack(): void {
  router.push('/help')
}

// 计算文章 HTML
const articleHtml = computed<string>(() => {
  if (!currentArticle.value?.content) return ''
  return parseMarkdown(currentArticle.value.content)
})

function getCategoryLabel(catId: string): string {
  const cat = categoryConfig.value.find(c => c.id === catId)
  if (cat?.name) return cat.name

  const key = `help.categories.${catId.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`
  const label = t(key)
  return label === key ? catId : label
}

function getCategoryColor(catId: string): string {
  const cat = categoryConfig.value.find(c => c.id === catId)
  return cat ? cat.color : '#6b7280'
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  // 支援 zh-CN, zh-TW, en 三種語言
  const localeMap: Record<string, string> = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'en': 'en-US'
  }
  const localeCode = localeMap[locale.value] || 'en-US'
  return new Date(dateStr).toLocaleDateString(localeCode, { 
    year: 'numeric', month: 'long', day: 'numeric'
  })
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- Header -->
    <div class="page-header">
      <div>
        <!-- 详情视图加载中时显示返回按钮和骨架屏 -->
        <template v-if="isDetailView && !articleLoaded">
          <div class="mb-2">
            <button class="flex items-center gap-2 text-themed-muted hover:text-themed transition-colors" @click="goBack">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              <span class="text-sm">{{ $t('help.backToHelp') }}</span>
            </button>
          </div>
          <div class="h-7 w-48 bg-themed-tertiary rounded animate-pulse"></div>
        </template>
        <!-- 详情视图加载完成后显示文章标题 -->
        <template v-else-if="isDetailView && currentArticle">
          <div class="mb-2">
            <button class="flex items-center gap-2 text-themed-muted hover:text-themed transition-colors" @click="goBack">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              <span class="text-sm">{{ $t('help.backToHelp') }}</span>
            </button>
          </div>
          <h1 class="page-title">{{ currentArticle.title }}</h1>
          <p class="text-sm text-themed-muted">
            {{ $t('help.updatedAt', { date: formatDate(currentArticle.updated_at) }) }}
          </p>
        </template>
        <!-- 列表视图 -->
        <template v-else-if="!isDetailView">
          <h1 class="page-title">{{ $t('help.title') }}</h1>
          <p class="page-description">{{ $t('help.description') }}</p>
        </template>
        <!-- 详情视图 404 情况 -->
        <template v-else-if="isDetailView && articleLoaded && !currentArticle">
          <div class="mb-2">
            <button class="flex items-center gap-2 text-themed-muted hover:text-themed transition-colors" @click="goBack">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              <span class="text-sm">{{ $t('help.backToHelp') }}</span>
            </button>
          </div>
          <h1 class="page-title">{{ $t('help.title') }}</h1>
        </template>
      </div>
    </div>

    <!-- Article List View -->
    <template v-if="!isDetailView">
      <!-- Category Filter -->
      <div v-if="categories.length > 0" class="flex flex-wrap gap-2">
        <button
          :class="[
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            !selectedCategory 
              ? 'bg-accent text-white' 
              : 'bg-themed-secondary text-themed-secondary hover:text-themed'
          ]"
          @click="filterByCategory('')"
        >
          {{ $t('help.all') }}
        </button>
        <button
          v-for="cat in categories"
          :key="cat.category"
          :class="[
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            selectedCategory === cat.category 
              ? 'bg-accent text-white' 
              : 'bg-themed-secondary text-themed-secondary hover:text-themed'
          ]"
          @click="filterByCategory(cat.category)"
        >
          {{ getCategoryLabel(cat.category) }}
          <span class="ml-1 opacity-60">({{ cat.count }})</span>
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="card p-8 text-center text-themed-muted">
        <svg class="w-6 h-6 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
      
      <!-- Empty -->
      <div v-else-if="articles.length === 0" class="card p-8 text-center text-themed-muted">
        {{ $t('help.noArticles') }}
      </div>

      <!-- Article List -->
      <div v-else class="space-y-3">
        <div 
          v-for="article in articles" 
          :key="article.id"
          class="card p-4 cursor-pointer hover:border-accent/50 transition-colors"
          @click="goToArticle(article.slug)"
        >
          <div class="flex items-start justify-between">
            <div>
              <h3 class="text-themed font-medium hover:text-accent transition-colors">{{ article.title }}</h3>
              <div class="flex items-center gap-3 mt-1 text-sm text-themed-muted">
                <span 
                  class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-themed-tertiary rounded text-xs"
                >
                  <span 
                    class="w-2 h-2 rounded-full" 
                    :style="{ backgroundColor: getCategoryColor(article.category) }"
                  ></span>
                  {{ getCategoryLabel(article.category) }}
                </span>
                <span>{{ formatDate(article.updated_at) }}</span>
              </div>
            </div>
            <svg class="w-5 h-5 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between text-sm text-themed-muted">
        <span>{{ $t('help.totalArticles', { count: total }) }}</span>
        <div class="flex items-center gap-2">
          <button :disabled="page <= 1" class="btn-ghost btn-sm" @click="page--; loadArticles()">{{ $t('instance.prevPage') }}</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button :disabled="page >= totalPages" class="btn-ghost btn-sm" @click="page++; loadArticles()">{{ $t('instance.nextPage') }}</button>
        </div>
      </div>
    </template>

    <!-- Article Detail View -->
    <template v-else>
      <!-- Loading（加载中或尚未开始加载时显示） -->
      <div v-if="articleLoading || !articleLoaded" class="card p-8 text-center text-themed-muted">
        <svg class="w-6 h-6 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>

      <!-- Not Found（仅在加载完成后且文章为空时显示） -->
      <div v-else-if="articleLoaded && !currentArticle" class="card p-8 text-center">
        <svg class="w-12 h-12 mx-auto text-themed-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-themed-muted mb-4">{{ $t('help.articleNotFound') }}</p>
        <button class="btn-secondary" @click="goBack">{{ $t('help.backToHelp') }}</button>
      </div>

      <!-- Article Content -->
      <div v-else class="card p-6 md:p-8">
        <div class="markdown-body" v-html="articleHtml"></div>
      </div>
    </template>
  </div>
</template>

<style>
/* ============ Markdown 基础样式 ============ */
.markdown-body {
  color: var(--text-primary);
  line-height: 1.7;
}

.markdown-body > *:first-child {
  margin-top: 0 !important;
}

.markdown-body > *:last-child {
  margin-bottom: 0 !important;
}

/* 标题 */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  color: var(--text-primary);
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body h1 { font-size: 1.75em; }
.markdown-body h2 { 
  font-size: 1.5em; 
  border-bottom: 1px solid var(--border-color); 
  padding-bottom: 0.3em; 
}
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1.1em; }
.markdown-body h5 { font-size: 1em; }
.markdown-body h6 { font-size: 0.9em; color: var(--text-secondary); }

/* 段落 */
.markdown-body p {
  margin: 1em 0;
}

/* 链接 */
.markdown-body a {
  color: var(--accent);
  text-decoration: none;
  transition: color 0.15s;
}

.markdown-body a:hover {
  text-decoration: underline;
}

/* 图片 */
.markdown-body img {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-body figure {
  margin: 1.5em 0;
}

/* 列表 */
.markdown-body ul,
.markdown-body ol {
  padding-left: 1.5em;
  margin: 1em 0;
}

.markdown-body ul {
  list-style-type: disc;
}

.markdown-body ol {
  list-style-type: decimal;
}

.markdown-body li {
  margin: 0.5em 0;
}

.markdown-body li > ul,
.markdown-body li > ol {
  margin: 0.25em 0;
}

/* 任务列表 */
.markdown-body ul:has(li > span:first-child > svg) {
  list-style: none;
  padding-left: 0;
}

/* 行内代码 */
.markdown-body code {
  background: var(--bg-tertiary);
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

/* 代码块 */
.markdown-body pre {
  background: var(--bg-tertiary);
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1em 0;
  border: 1px solid var(--border-color);
}

.markdown-body pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
  line-height: 1.6;
}

/* 引用块 */
.markdown-body blockquote {
  border-left: 4px solid var(--accent);
  padding-left: 1em;
  margin: 1em 0;
  color: var(--text-secondary);
}

.markdown-body blockquote p {
  margin: 0.5em 0;
}

/* 表格 */
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.9em;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border-color);
  padding: 0.6em 1em;
  text-align: left;
}

.markdown-body th {
  background: var(--bg-tertiary);
  font-weight: 600;
}

.markdown-body tr:hover td {
  background: var(--bg-secondary);
}

/* 水平线 */
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 2em 0;
}

/* 删除线 */
.markdown-body del {
  color: var(--text-tertiary);
}

/* 强调 */
.markdown-body strong {
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-body em {
  font-style: italic;
}

/* 键盘按键 */
.markdown-body kbd {
  display: inline-block;
  padding: 0.2em 0.4em;
  font-size: 0.85em;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 1px 0 var(--border-color);
}

/* ============ 自定义 Alert 样式 ============ */
.md-alert {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  margin: 1rem 0;
  border-radius: 0.5rem;
  border-width: 1px;
}

.md-alert svg {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
}

.md-alert > div {
  flex: 1;
  font-size: 0.875rem;
  line-height: 1.5;
}

/* Alert 颜色变体 - 暗色主题 */
.dark .md-alert-info {
  background-color: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
}
.dark .md-alert-info svg,
.dark .md-alert-info > div {
  color: #60a5fa;
}

.dark .md-alert-success {
  background-color: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.3);
}
.dark .md-alert-success svg,
.dark .md-alert-success > div {
  color: #4ade80;
}

.dark .md-alert-warning {
  background-color: rgba(234, 179, 8, 0.15);
  border-color: rgba(234, 179, 8, 0.3);
}
.dark .md-alert-warning svg,
.dark .md-alert-warning > div {
  color: #facc15;
}

.dark .md-alert-danger {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
}
.dark .md-alert-danger svg,
.dark .md-alert-danger > div {
  color: #f87171;
}

.dark .md-alert-note {
  background-color: rgba(107, 114, 128, 0.15);
  border-color: rgba(107, 114, 128, 0.3);
}
.dark .md-alert-note svg,
.dark .md-alert-note > div {
  color: #9ca3af;
}

/* Alert 颜色变体 - 亮色主题 */
.light .md-alert-info {
  background-color: #eff6ff;
  border-color: rgba(59, 130, 246, 0.3);
}
.light .md-alert-info svg,
.light .md-alert-info > div {
  color: #2563eb;
}

.light .md-alert-success {
  background-color: #f0fdf4;
  border-color: rgba(34, 197, 94, 0.3);
}
.light .md-alert-success svg,
.light .md-alert-success > div {
  color: #16a34a;
}

.light .md-alert-warning {
  background-color: #fefce8;
  border-color: rgba(234, 179, 8, 0.3);
}
.light .md-alert-warning svg,
.light .md-alert-warning > div {
  color: #ca8a04;
}

.light .md-alert-danger {
  background-color: #fef2f2;
  border-color: rgba(239, 68, 68, 0.3);
}
.light .md-alert-danger svg,
.light .md-alert-danger > div {
  color: #dc2626;
}

.light .md-alert-note {
  background-color: #f9fafb;
  border-color: rgba(107, 114, 128, 0.3);
}
.light .md-alert-note svg,
.light .md-alert-note > div {
  color: #4b5563;
}

/* ============ 代码高亮主题适配 ============ */
/* 暗色主题代码高亮 */
.dark .markdown-body pre {
  background: #0d1117;
  border-color: #30363d;
}

.dark .markdown-body .hljs {
  color: #c9d1d9;
  background: transparent;
}

.dark .markdown-body .hljs-keyword,
.dark .markdown-body .hljs-selector-tag,
.dark .markdown-body .hljs-title {
  color: #ff7b72;
}

.dark .markdown-body .hljs-string,
.dark .markdown-body .hljs-attr {
  color: #a5d6ff;
}

.dark .markdown-body .hljs-comment {
  color: #8b949e;
}

.dark .markdown-body .hljs-number,
.dark .markdown-body .hljs-literal {
  color: #79c0ff;
}

.dark .markdown-body .hljs-function,
.dark .markdown-body .hljs-built_in {
  color: #d2a8ff;
}

.dark .markdown-body .hljs-variable,
.dark .markdown-body .hljs-template-variable {
  color: #ffa657;
}

/* 亮色主题代码高亮 */
.light .markdown-body pre {
  background: #f6f8fa;
  border-color: #d0d7de;
}

.light .markdown-body .hljs {
  color: #24292f;
  background: transparent;
}

.light .markdown-body .hljs-keyword,
.light .markdown-body .hljs-selector-tag,
.light .markdown-body .hljs-title {
  color: #cf222e;
}

.light .markdown-body .hljs-string,
.light .markdown-body .hljs-attr {
  color: #0a3069;
}

.light .markdown-body .hljs-comment {
  color: #6e7781;
}

.light .markdown-body .hljs-number,
.light .markdown-body .hljs-literal {
  color: #0550ae;
}

.light .markdown-body .hljs-function,
.light .markdown-body .hljs-built_in {
  color: #8250df;
}

.light .markdown-body .hljs-variable,
.light .markdown-body .hljs-template-variable {
  color: #953800;
}
</style>
