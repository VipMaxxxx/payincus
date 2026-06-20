<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { parseMarkdown } from '@/utils/markdown'

const { t } = useI18n()
const toast = useToast()
const themeStore = useThemeStore()

// Article list
interface HelpArticle {
  id: number
  title: string
  slug: string
  content: string
  category: string
  sort_order: number
  published: number
  pinned?: number
  created_at: string
  updated_at: string
}
const articles = ref<HelpArticle[]>([])
const loading = ref<boolean>(true)
const page = ref<number>(1)
const pageSize = ref<number>(100)
const total = ref<number>(0)
const totalPages = ref<number>(0)

// Editor
const showEditor = ref<boolean>(false)
type EditorMode = 'create' | 'edit'
const editorMode = ref<EditorMode>('create')
const editingId = ref<number | null>(null)
interface ArticleForm {
  title: string
  slug: string
  content: string
  category: string
  sortOrder: number
  published: boolean
  pinned: boolean
}
const form = ref<ArticleForm>({
  title: '',
  slug: '',
  content: '',
  category: 'general',
  sortOrder: 0,
  published: true,
  pinned: false
})
const formLoading = ref<boolean>(false)
const formError = ref<string>('')
const previewMode = ref<boolean>(false)
const showMarkdownHelp = ref<boolean>(false)

// Tab
type TabType = 'articles' | 'categories'
const activeTab = ref<TabType>('articles')

// Categories - now dynamic
interface Category {
  id: string
  name: string
  color: string
}
const categories = ref<Category[]>([
  { id: 'general', name: '常规', color: '#6b7280' },
  { id: 'getting-started', name: '快速开始', color: '#22c55e' },
  { id: 'instances', name: '实例管理', color: '#3b82f6' },
  { id: 'networking', name: '网络配置', color: '#8b5cf6' },
  { id: 'billing', name: '计费相关', color: '#f59e0b' },
  { id: 'faq', name: '常见问题', color: '#ef4444' }
])

// Category editor
const showCategoryModal = ref<boolean>(false)
type CategoryMode = 'create' | 'edit'
const categoryMode = ref<CategoryMode>('create')
const editingCategoryId = ref<string | null>(null)
const categoryForm = ref<Category>({ id: '', name: '', color: '#3b82f6' })
const categoryError = ref<string>('')

// Predefined colors for categories
const categoryColors = [
  '#6b7280', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', 
  '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
]

onMounted(async (): Promise<void> => {
  // 并行加载分类配置和文章列表
  await Promise.all([loadCategoriesFromServer(), loadArticles()])
})

// Load categories from server
async function loadCategoriesFromServer(): Promise<void> {
  try {
    const response = await api.help.categoryConfig()
    if (response.categories && response.categories.length > 0) {
      categories.value = response.categories
    }
  } catch (err) {
    console.error('Failed to load category config:', err)
    // 加载失败时使用默认配置
  }
}

// Save categories to server
async function saveCategoriesToServer(): Promise<void> {
  try {
    await api.help.saveCategoryConfig(categories.value)
  } catch (err: any) {
    toast.error(t('admin.helpManage.saveFailed') + ': ' + (err?.message || String(err)))
    throw err
  }
}

// Category management functions
function openAddCategory(): void {
  categoryMode.value = 'create'
  editingCategoryId.value = null
  categoryForm.value = { id: '', name: '', color: '#3b82f6' }
  categoryError.value = ''
  showCategoryModal.value = true
}

function openEditCategory(cat: Category): void {
  categoryMode.value = 'edit'
  editingCategoryId.value = cat.id
  categoryForm.value = { id: cat.id, name: cat.name, color: cat.color }
  categoryError.value = ''
  showCategoryModal.value = true
}

async function saveCategory(): Promise<void> {
  if (!categoryForm.value.id || !categoryForm.value.name) {
    categoryError.value = t('admin.helpManage.fillCategoryIdAndName')
    return
  }
  
  // Validate ID format
  if (!/^[a-z0-9-]+$/.test(categoryForm.value.id)) {
    categoryError.value = t('admin.helpManage.invalidCategoryId')
    return
  }
  
  if (categoryMode.value === 'create') {
    // Check duplicate ID
    if (categories.value.some(c => c.id === categoryForm.value.id)) {
      categoryError.value = t('admin.helpManage.duplicateCategoryId')
      return
    }
    categories.value.push({ ...categoryForm.value })
  } else {
    const index = categories.value.findIndex(c => c.id === editingCategoryId.value)
    if (index !== -1) {
      categories.value[index] = { ...categoryForm.value }
    }
  }
  
  try {
    await saveCategoriesToServer()
    showCategoryModal.value = false
    toast.success(categoryMode.value === 'create' ? t('admin.helpManage.categoryAdded') : t('admin.helpManage.categoryUpdated'))
  } catch {
    // 保存失败，回滚操作
    await loadCategoriesFromServer()
  }
}

async function deleteCategory(cat: Category): Promise<void> {
  // Check if category is in use
  const inUse = articles.value.some(a => a.category === cat.id)
  if (inUse) {
    toast.error(t('admin.helpManage.categoryInUse'))
    return
  }
  
  if (!confirm(t('admin.helpManage.confirmDeleteCategory', { name: cat.name }))) return
  
  categories.value = categories.value.filter(c => c.id !== cat.id)
  try {
    await saveCategoriesToServer()
    toast.success(t('admin.helpManage.categoryDeleted'))
  } catch {
    // 保存失败，回滚操作
    await loadCategoriesFromServer()
  }
}

async function loadArticles(): Promise<void> {
  loading.value = true
  try {
    const response = await api.help.adminList({ page: page.value, pageSize: pageSize.value })
    const data = response as { articles?: HelpArticle[]; total?: number; totalPages?: number }
    articles.value = data.articles || []
    total.value = data.total || 0
    totalPages.value = data.totalPages || 1
  } catch (err: any) {
    toast.error(t('admin.helpManage.loadFailed') + ': ' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editorMode.value = 'create'
  editingId.value = null
  form.value = {
    title: '',
    slug: '',
    content: '',
    category: 'general',
    sortOrder: 0,
    published: true,
    pinned: false
  }
  formError.value = ''
  previewMode.value = false
  showEditor.value = true
}

async function openEdit(article: HelpArticle): Promise<void> {
  editorMode.value = 'edit'
  editingId.value = article.id
  formLoading.value = true
  formError.value = ''
  previewMode.value = false
  showEditor.value = true
  
  try {
    const response = await api.help.adminGet(article.id)
    const data = response as { article?: HelpArticle }
    const a = data.article
    if (!a) throw new Error('Article not found')
    form.value = {
      title: a.title,
      slug: a.slug,
      content: a.content,
      category: a.category || 'general',
      sortOrder: a.sort_order || 0,
      published: a.published === 1,
      pinned: a.pinned === 1
    }
  } catch (err: any) {
    toast.error(t('admin.helpManage.loadFailed') + ': ' + (err?.message || String(err)))
    showEditor.value = false
  } finally {
    formLoading.value = false
  }
}

async function saveArticle(): Promise<void> {
  if (!form.value.title || !form.value.slug || !form.value.content) {
    formError.value = t('admin.helpManage.fillRequired')
    return
  }
  
  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(form.value.slug)) {
    formError.value = t('admin.helpManage.invalidSlug')
    return
  }
  
  formLoading.value = true
  formError.value = ''
  
  try {
    if (editorMode.value === 'create') {
      await api.help.create({
        title: form.value.title,
        slug: form.value.slug,
        content: form.value.content,
        category: form.value.category,
        sortOrder: form.value.sortOrder,
        published: form.value.published,
        pinned: form.value.pinned
      })
      toast.success(t('admin.helpManage.articleCreated'))
    } else {
      if (editingId.value === null) throw new Error('Invalid article ID')
      await api.help.update(editingId.value, {
        title: form.value.title,
        slug: form.value.slug,
        content: form.value.content,
        category: form.value.category,
        sortOrder: form.value.sortOrder,
        published: form.value.published,
        pinned: form.value.pinned
      })
      toast.success(t('admin.helpManage.articleUpdated'))
    }
    showEditor.value = false
    await loadArticles()
  } catch (err: any) {
    formError.value = err?.message || String(err)
  } finally {
    formLoading.value = false
  }
}

async function deleteArticle(article: HelpArticle): Promise<void> {
  if (!confirm(t('admin.helpManage.confirmDelete', { title: article.title }))) return
  
  try {
    await api.help.delete(article.id)
    toast.success(t('admin.helpManage.articleDeleted'))
    await loadArticles()
  } catch (err: any) {
    toast.error(t('admin.helpManage.deleteFailed') + ': ' + (err?.message || String(err)))
  }
}

async function togglePublished(article: HelpArticle): Promise<void> {
  try {
    await api.help.update(article.id, { published: article.published === 0 })
    toast.success(article.published === 1 ? t('admin.helpManage.articleHidden') : t('admin.helpManage.articlePublished'))
    await loadArticles()
  } catch (err: any) {
    toast.error(t('admin.helpManage.operationFailed') + ': ' + (err?.message || String(err)))
  }
}

// Auto-generate slug from title
function generateSlug(): void {
  if (editorMode.value === 'create' && form.value.title && !form.value.slug) {
    form.value.slug = form.value.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
  }
}

// Computed preview HTML
const previewHtml = computed<string>(() => {
  return parseMarkdown(form.value.content || '')
})

function getCategoryLabel(catId: string): string {
  const cat = categories.value.find(c => c.id === catId)
  return cat ? cat.name : catId
}

function getCategoryColor(catId: string): string {
  const cat = categories.value.find(c => c.id === catId)
  return cat ? cat.color : '#6b7280'
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN', { 
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
  })
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <div class="page-header flex-col sm:flex-row gap-4 sm:gap-0">
      <div>
        <h1 class="page-title">{{ t('admin.helpManage.title') }}</h1>
        <p class="page-description">{{ t('admin.helpManage.description') }}</p>
      </div>
      <div class="flex gap-2 w-full sm:w-auto">
        <button v-if="activeTab === 'categories'" class="btn-secondary flex-1 sm:flex-none justify-center" @click="openAddCategory">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('admin.helpManage.addCategory') }}
        </button>
        <button v-if="activeTab === 'articles'" class="btn-primary flex-1 sm:flex-none justify-center" @click="openCreate">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('admin.helpManage.create') }}
        </button>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="border-b border-themed overflow-x-auto">
      <nav class="flex gap-4 sm:gap-6 min-w-max">
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
            activeTab === 'articles'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="activeTab = 'articles'"
        >
          {{ t('admin.helpManage.articlesTab') }}
          <span class="ml-1.5 px-1.5 py-0.5 text-xs rounded bg-themed-secondary">{{ total }}</span>
        </button>
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
            activeTab === 'categories'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="activeTab = 'categories'"
        >
          {{ t('admin.helpManage.categoriesTab') }}
          <span class="ml-1.5 px-1.5 py-0.5 text-xs rounded bg-themed-secondary">{{ categories.length }}</span>
        </button>
      </nav>
    </div>

    <!-- Categories Tab -->
    <div v-if="activeTab === 'categories'" class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div 
          v-for="cat in categories" 
          :key="cat.id"
          class="card p-4 hover:border-themed-secondary transition-colors"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div 
                class="w-4 h-4 rounded-full" 
                :style="{ backgroundColor: cat.color }"
              ></div>
              <div>
                <div class="text-themed font-medium">{{ cat.name }}</div>
                <div class="text-xs text-themed-muted font-mono">{{ cat.id }}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-ghost btn-sm" @click="openEditCategory(cat)">{{ t('common.edit') }}</button>
              <button class="btn-ghost btn-sm text-error" @click="deleteCategory(cat)">{{ t('common.delete') }}</button>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="categories.length === 0" class="card p-8 text-center text-themed-muted">
        {{ t('admin.helpManage.noCategories') }}
      </div>
    </div>

    <!-- Article List -->
    <div v-if="activeTab === 'articles' && loading" class="card p-8 text-center text-themed-muted">
      <svg class="w-6 h-6 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p class="mt-2">{{ t('common.loading') }}</p>
    </div>
    
    <div v-else-if="activeTab === 'articles' && articles.length === 0" class="card p-8 text-center">
      <div class="text-themed-muted text-sm mb-4">{{ t('admin.helpManage.noArticles') }}</div>
      <button class="btn-secondary btn-sm" @click="openCreate">{{ t('admin.helpManage.createFirst') }}</button>
    </div>

    <div v-else-if="activeTab === 'articles'" class="space-y-4">
      <div class="card overflow-x-auto">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[800px]">
            <thead class="bg-themed-tertiary border-b border-themed">
              <tr>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.helpManage.articleTitleCol') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.helpManage.categoryCol') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.helpManage.statusCol') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.helpManage.updatedAtCol') }}</th>
                <th class="text-right text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.helpManage.actionsCol') }}</th>
              </tr>
            </thead>
            <tbody class="divide-themed">
              <tr v-for="article in articles" :key="article.id" class="hover:bg-themed-hover">
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="text-themed font-medium">{{ article.title }}</div>
                  <div class="text-xs text-themed-muted font-mono">/help/{{ article.slug }}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex items-center gap-2">
                    <span 
                      class="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                      :style="{ backgroundColor: getCategoryColor(article.category) }"
                    ></span>
                    <span class="text-sm text-themed-secondary">{{ getCategoryLabel(article.category) }}</span>
                  </div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span :class="['badge whitespace-nowrap', article.published ? 'badge-success' : 'badge-default']">
                    {{ article.published ? t('admin.helpManage.published') : t('admin.helpManage.draft') }}
                  </span>
                </td>
                <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">{{ formatDate(article.updated_at) }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <div class="flex items-center justify-end gap-2">
                    <button class="btn-ghost btn-sm" @click="openEdit(article)">{{ t('common.edit') }}</button>
                    <button class="btn-ghost btn-sm" @click="togglePublished(article)">
                      {{ article.published ? t('admin.helpManage.hide') : t('admin.helpManage.publish') }}
                    </button>
                    <button class="btn-ghost btn-sm text-error" @click="deleteArticle(article)">{{ t('common.delete') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between text-sm text-themed-muted">
        <span>{{ t('admin.helpManage.totalArticles', { count: total }) }}</span>
        <div class="flex items-center gap-2">
          <button :disabled="page <= 1" class="btn-ghost btn-sm" @click="page--; loadArticles()">{{ t('admin.helpManage.prevPage') }}</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button :disabled="page >= totalPages" class="btn-ghost btn-sm" @click="page++; loadArticles()">{{ t('admin.helpManage.nextPage') }}</button>
        </div>
      </div>
    </div>

    <!-- Editor Modal -->
    <Teleport to="body">
      <div v-if="showEditor" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showEditor = false"></div>
        
        <div class="relative w-full max-w-5xl h-[90vh] bg-themed border border-themed rounded-xl shadow-2xl animate-fade-in flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-themed">
            <h3 class="text-lg font-semibold text-themed">
              {{ editorMode === 'create' ? t('admin.helpManage.createArticle') : t('admin.helpManage.editArticle') }}
            </h3>
            <div class="flex items-center gap-3">
              <button
                :class="['btn-ghost btn-sm', previewMode && 'bg-themed-secondary']"
                @click="previewMode = !previewMode"
              >
                {{ previewMode ? t('common.edit') : t('admin.helpManage.preview') }}
              </button>
              <button class="text-themed-muted hover:text-themed" @click="showEditor = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <!-- Content -->
          <div class="flex-1 overflow-hidden flex">
            <!-- Left: Form -->
            <div v-if="!previewMode" class="flex-1 overflow-y-auto p-6 space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.articleTitle') }} *</label>
                  <input 
                    v-model="form.title" 
                    type="text"
                    class="input" 
                    :placeholder="t('admin.helpManage.titlePlaceholder')" 
                    @blur="generateSlug"
                  />
                </div>
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.urlSlug') }} *</label>
                  <input 
                    v-model="form.slug" 
                    type="text" 
                    class="input font-mono" 
                    :placeholder="t('admin.helpManage.urlSlugPlaceholder')"
                  />
                  <p class="text-xs text-themed-muted mt-1">{{ t('admin.helpManage.urlSlugHint') }}</p>
                </div>
              </div>
              
              <div class="grid grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.category') }}</label>
                  <select v-model="form.category" class="input">
                    <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.sortOrder') }}</label>
                  <input v-model.number="form.sortOrder" type="number" class="input" min="0" />
                </div>
                <div class="flex items-end">
                  <label class="flex items-center gap-3 cursor-pointer select-none">
                    <div class="relative">
                      <input 
                        v-model="form.published" 
                        type="checkbox" 
                        class="sr-only peer"
                      />
                      <div 
                        class="w-10 h-6 rounded-full transition-colors peer-checked:bg-green-500"
                        :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-300'"
                      ></div>
                      <div 
                        class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4"
                      ></div>
                    </div>
                    <span class="text-sm text-themed-secondary">
                      {{ form.published ? t('admin.helpManage.published') : t('admin.helpManage.draft') }}
                    </span>
                  </label>
                  
                  <!-- 置顶开关 -->
                  <label class="flex items-center gap-3 cursor-pointer select-none ml-4">
                    <div class="relative">
                      <input
                        v-model="form.pinned"
                        type="checkbox"
                        class="sr-only peer"
                      />
                      <div 
                        class="w-10 h-6 rounded-full transition-colors peer-checked:bg-blue-500"
                        :class="themeStore.isDark ? 'bg-gray-700' : 'bg-gray-300'"
                      ></div>
                      <div 
                        class="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4"
                      ></div>
                    </div>
                    <span class="text-sm text-themed-secondary">
                      {{ form.pinned ? t('admin.helpManage.pinned') : t('admin.helpManage.notPinned') }}
                    </span>
                  </label>
                </div>
              </div>
              
              <div class="flex-1">
                <div class="flex items-center justify-between mb-1.5">
                  <label class="block text-sm text-themed-secondary">{{ t('admin.helpManage.contentMarkdown') }} *</label>
                  <button 
                    type="button"
                    class="text-xs text-themed-muted hover:text-themed transition-colors"
                    @click="showMarkdownHelp = !showMarkdownHelp"
                  >
                    {{ showMarkdownHelp ? t('admin.helpManage.hideMarkdownHelp') : t('admin.helpManage.showMarkdownHelp') }}
                  </button>
                </div>
                
                <!-- Markdown 语法帮助 -->
                <div v-if="showMarkdownHelp" class="mb-3 p-3 bg-themed-tertiary rounded-lg text-xs text-themed-secondary space-y-2">
                  <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div><code class="bg-themed-secondary px-1 rounded"># Title</code> {{ t('admin.helpManage.markdownHeading1') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">## Title</code> {{ t('admin.helpManage.markdownHeading2') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">**bold**</code> {{ t('admin.helpManage.markdownBold') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">*italic*</code> {{ t('admin.helpManage.markdownItalic') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">[link](url)</code> {{ t('admin.helpManage.markdownLink') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">![image](url)</code> {{ t('admin.helpManage.markdownImage') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">- item</code> {{ t('admin.helpManage.markdownUnorderedList') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">1. item</code> {{ t('admin.helpManage.markdownOrderedList') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">`code`</code> {{ t('admin.helpManage.markdownInlineCode') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">```code```</code> {{ t('admin.helpManage.markdownCodeBlock') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">> quote</code> {{ t('admin.helpManage.markdownQuote') }}</div>
                    <div><code class="bg-themed-secondary px-1 rounded">---</code> {{ t('admin.helpManage.markdownHr') }}</div>
                  </div>
                  <div class="pt-2 border-t border-themed">
                    <div class="font-medium text-themed mb-1">{{ t('admin.helpManage.customAlerts') }}</div>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                      <div><code class="bg-themed-secondary px-1 rounded">?{info}[text]</code> {{ t('admin.helpManage.alertInfo') }}</div>
                      <div><code class="bg-themed-secondary px-1 rounded">?{success}[text]</code> {{ t('admin.helpManage.alertSuccess') }}</div>
                      <div><code class="bg-themed-secondary px-1 rounded">?{warning}[text]</code> {{ t('admin.helpManage.alertWarning') }}</div>
                      <div><code class="bg-themed-secondary px-1 rounded">?{danger}[text]</code> {{ t('admin.helpManage.alertDanger') }}</div>
                      <div><code class="bg-themed-secondary px-1 rounded">?{note}[text]</code> {{ t('admin.helpManage.alertNote') }}</div>
                    </div>
                  </div>
                </div>
                
                <textarea 
                  v-model="form.content" 
                  class="input w-full font-mono text-sm resize-none"
                  style="height: calc(100vh - 400px); min-height: 300px;"
                  placeholder="# 标题&#10;&#10;正文内容...&#10;&#10;```javascript&#10;// 代码示例&#10;console.log('Hello')&#10;```&#10;&#10;?{info}[提示信息]&#10;?{success}[成功信息]&#10;?{warning}[警告信息]&#10;?{danger}[危险信息]"
                ></textarea>
              </div>
              
              <div v-if="formError" class="text-sm text-error">{{ formError }}</div>
            </div>
            
            <!-- Right: Preview -->
            <div v-else class="flex-1 overflow-y-auto p-6">
              <div class="prose prose-invert max-w-none">
                <h1 class="text-themed">{{ form.title || t('admin.helpManage.noTitle') }}</h1>
                <div class="markdown-body" v-html="previewHtml"></div>
              </div>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-themed">
            <button class="btn-secondary" @click="showEditor = false">{{ t('common.cancel') }}</button>
            <button :disabled="formLoading" class="btn-primary" @click="saveArticle">
              {{ formLoading ? t('common.loading') : t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Category Modal -->
    <Teleport to="body">
      <div v-if="showCategoryModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showCategoryModal = false"></div>
        
        <div class="relative w-full max-w-md bg-themed border border-themed rounded-xl shadow-2xl animate-fade-in">
          <div class="flex items-center justify-between px-6 py-4 border-b border-themed">
            <h3 class="text-lg font-semibold text-themed">
              {{ categoryMode === 'create' ? t('admin.helpManage.addCategory') : t('common.edit') }}
            </h3>
            <button class="text-themed-muted hover:text-themed" @click="showCategoryModal = false">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="p-6 space-y-4">
            <div>
              <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.categoryId') }} *</label>
              <input 
                v-model="categoryForm.id" 
                type="text" 
                class="input font-mono" 
                placeholder="getting-started"
                :disabled="categoryMode === 'edit'"
              />
              <p class="text-xs text-themed-muted mt-1">{{ t('admin.helpManage.categoryIdHint') }}</p>
            </div>
            
            <div>
              <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.categoryName') }} *</label>
              <input 
                v-model="categoryForm.name" 
                type="text" 
                class="input" 
                placeholder="Getting Started"
              />
            </div>
            
            <div>
              <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.helpManage.categoryColor') }}</label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="color in categoryColors"
                  :key="color"
                  class="w-8 h-8 rounded-lg transition-all"
                  :class="categoryForm.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''"
                  :style="{ backgroundColor: color }"
                  @click="categoryForm.color = color"
                ></button>
              </div>
            </div>
            
            <div v-if="categoryError" class="text-sm text-error">{{ categoryError }}</div>
          </div>
          
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-themed">
            <button class="btn-secondary" @click="showCategoryModal = false">{{ t('common.cancel') }}</button>
            <button class="btn-primary" @click="saveCategory">{{ t('common.save') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
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

/* 强调 */
.markdown-body strong {
  font-weight: 600;
  color: var(--text-primary);
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
</style>

