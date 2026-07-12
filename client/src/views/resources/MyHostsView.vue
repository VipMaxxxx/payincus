<script setup>
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import FlagIcon from '@/components/FlagIcon.vue'
import ThemeTemplateSlot from '@/components/theme/ThemeTemplateSlot.vue'
import { translateError } from '@/utils/errorHandler'
import { hostCreatePath, hostDetailPath, isAdminEntry } from '@/utils/app-paths'

// 为 KeepAlive include 匹配定义组件名称（必须在所有 import 之后）
defineOptions({ name: 'MyHostsView' })

const { t, locale } = useI18n()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.user?.role === 'admin')

// 管理员专用：节点范围切换器
const scope = ref('mine') // 'mine' | 'hosted'
const filterUserId = ref('')  // 用于筛选特定用户的托管节点

// 托管准入检查
const showAccessDeniedModal = ref(false)
const accessDeniedDetails = ref(null)
const accessDeniedConditionText = computed(() =>
  accessDeniedDetails.value?.hiddenBySystemSetting
    ? t('hosting.accessDenied.featureHiddenCondition')
    : t('hosting.accessDenied.condition')
)
const accessDeniedStatusText = computed(() =>
  accessDeniedDetails.value?.hiddenBySystemSetting
    ? t('hosting.accessDenied.featureHiddenCurrent')
    : t('hosting.accessDenied.currentInstances', { count: accessDeniedDetails.value?.instanceCount || 0 })
)
const accessDeniedHintText = computed(() =>
  accessDeniedDetails.value?.hiddenBySystemSetting
    ? t('hosting.accessDenied.featureHiddenHint')
    : t('hosting.accessDenied.hint')
)

// 宿主机列表
const hosts = ref([])
const loading = ref(true)
const search = ref('')
const calibratingAll = ref(false)
const page = ref(1)
const pageSize = ref(100)
const total = ref(0)
const totalPages = ref(0)
const takingOverHostId = ref(null)

// 在线节点数量（用于校对按钮禁用状态）
const onlineHostsCount = computed(() => hosts.value.filter(h => h.status === 'online').length)

// 计算可显示的页码列表
const pageNumbers = computed(() => {
  const current = page.value
  const total = totalPages.value
  const pages = []
  
  if (total <= 7) {
    // 总页数少于等于7，全部显示
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    // 始终显示第一页
    pages.push(1)
    
    if (current <= 3) {
      // 当前页靠前，显示 1 2 3 4 5 ... n
      pages.push(2, 3, 4, 5, '...', total)
    } else if (current >= total - 2) {
      // 当前页靠后，显示 1 ... n-4 n-3 n-2 n-1 n
      pages.push('...', total - 4, total - 3, total - 2, total - 1, total)
    } else {
      // 当前页在中间，显示 1 ... c-1 c c+1 ... n
      pages.push('...', current - 1, current, current + 1, '...', total)
    }
  }
  
  return pages
})

// 跳转到指定页码
function goToPage(p) {
  if (typeof p !== 'number') return
  if (p < 1 || p > totalPages.value) return
  page.value = p
  loadHosts()
}

// 修改每页数量
function handlePageSizeChange() {
  page.value = 1
  loadHosts()
}

// 记录是否已经首次加载
let hasInitialLoad = false

// 加载宿主机列表
async function loadHosts() {
  loading.value = true
  try {
    let res
    if (isAdmin.value && scope.value === 'hosted') {
      // 管理员查看托管节点
      res = await api.hosts.listHosted({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        ...(filterUserId.value ? { userId: parseInt(filterUserId.value, 10) } : {})
      })
    } else if (isAdmin.value && scope.value === 'mine') {
      // 管理员查看自己的节点（传 scope: 'mine'）
      res = await api.hosts.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        scope: 'mine'
      })
    } else {
      // 普通用户查看自己的节点
      res = await api.hosts.list({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        mine: true
      })
    }
    hosts.value = res.hosts || []
    total.value = res.total || 0
    totalPages.value = res.totalPages || 1
  } catch (err) {
    toast.error(err.message)
  } finally {
    loading.value = false
  }
}

// 切换范围时重新加载
function switchScope(newScope) {
  scope.value = newScope
  filterUserId.value = ''
  page.value = 1
  loadHosts()
}

// 按用户ID筛选时重新加载
let filterTimer = null
watch(filterUserId, () => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    page.value = 1
    loadHosts()
  }, 300)
})

// 搜索防抖
let searchTimer = null
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    loadHosts()
  }, 300)
})

// 跳转到创建页面（需检查托管准入条件）
async function goToCreate() {
  // 管理员直接放行
  if (isAdminEntry || authStore.user?.role === 'admin') {
    router.push(hostCreatePath())
    return
  }

  try {
    const res = await api.hosting.checkAccess()
    if (res.allowed) {
      router.push(hostCreatePath())
    } else {
      accessDeniedDetails.value = res.details || null
      showAccessDeniedModal.value = true
    }
  } catch {
    // 检查失败时也允许跳转，让后端再次校验
    router.push(hostCreatePath())
  }
}

// 跳转到详情页面
function goToDetail(host) {
  router.push(hostDetailPath(host.id))
}

// 测试宿主机连接
async function testHost(host) {
  try {
    const res = await api.hosts.test(host.id)
    if (res.success) {
      toast.success(t('admin.hosts.testSuccess'))
    }
    loadHosts()
  } catch (err) {
    toast.error(t('admin.hosts.testFailed') + ': ' + err.message)
  }
}

// 删除宿主机
async function deleteHost(host) {
  if (!confirm(t('admin.hosts.confirmDelete', { name: host.name }))) return

  try {
    await api.hosts.delete(host.id)
    hosts.value = hosts.value.filter(h => h.id !== host.id)
    total.value = Math.max(0, total.value - 1)
    // 更新总页数
    totalPages.value = Math.max(1, Math.ceil(total.value / pageSize.value))
    // 如果当前页超出范围，跳转到最后一页
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      loadHosts()
    }
    toast.success(t('admin.hosts.hostDeleted'))
  } catch (err) {
    toast.error(t('admin.hosts.deleteFailed') + ': ' + err.message)
  }
}

function formatLocalizedNameList(names, max = 3) {
  const visibleNames = (names || [])
    .slice(0, max)
    .map(name => String(name))
    .filter(Boolean)

  if (visibleNames.length === 0) {
    return '-'
  }

  try {
    return new Intl.ListFormat(locale.value || 'en', {
      style: 'short',
      type: 'conjunction'
    }).format(visibleNames)
  } catch {
    return visibleNames.join(', ')
  }
}

async function takeoverHost(host) {
  if (!isAdmin.value || scope.value !== 'hosted') return

  const confirmed = confirm(t('resources.hosts.takeoverOfficialConfirm', { name: host.name }))
  if (!confirmed) return

  takingOverHostId.value = host.id
  try {
    const res = await api.hosts.takeoverOfficial(host.id)
    const summary = res.summary
    toast.success(t('resources.hosts.takeoverOfficialSuccess', {
      name: summary.newHostName,
      packages: summary.transferredPackageCount,
      instances: summary.instanceCount
    }))
    if (summary.detachedPackageCount > 0) {
      const detachedNames = formatLocalizedNameList(summary.detachedPackageNames)
      toast.info(t('resources.hosts.takeoverOfficialDetached', {
        count: summary.detachedPackageCount,
        names: detachedNames || '-'
      }))
    }
    await loadHosts()
  } catch (err) {
    const takeoverError = err && typeof err === 'object' ? err : null
    if (takeoverError?.code === 'HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT') {
      const packageNames = Array.isArray(takeoverError.packageNames) ? takeoverError.packageNames : []
      toast.error(t('resources.hosts.takeoverOfficialBlocked', {
        count: takeoverError.count || packageNames.length,
        names: formatLocalizedNameList(packageNames)
      }))
      return
    }

    toast.error(translateError(err))
  } finally {
    takingOverHostId.value = null
  }
}

// 校对全部宿主机资源（校对用户的所有节点，而不是当前页面）
async function calibrateAll() {
  calibratingAll.value = true
  let successCount = 0
  let changedCount = 0
  
  try {
    // 先获取用户的所有节点（不分页）
    const res = await api.hosts.list({
      mine: true,
      pageSize: 1000  // 获取所有节点
    })
    const allHosts = res.hosts || []
    
    // 只校对在线的节点
    const onlineHosts = allHosts.filter(h => h.status === 'online')
    if (onlineHosts.length === 0) {
      toast.info(t('resources.hosts.noOnlineHosts'))
      return
    }
    
    for (const host of onlineHosts) {
      try {
        const res = await api.hosts.recalculateResources(host.id)
        successCount++
        if (res.hasChanges) changedCount++
      } catch {
        // 单个失败不影响其他
      }
    }
    
    if (changedCount > 0) {
      toast.success(t('resources.hosts.calibrateAllDone', { total: successCount, changed: changedCount }))
    } else {
      toast.success(t('resources.hosts.calibrateAllNoChange', { total: successCount }))
    }
    
    // 重新加载列表以显示最新数据
    await loadHosts()
  } finally {
    calibratingAll.value = false
  }
}

// 格式化内存
function formatMemory(mb) {
  if (!mb) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(0) + ' GB'
  return mb + ' MB'
}

// 获取状态样式
function getStatusClass(status) {
  const map = {
    online: 'bg-green-500',
    offline: 'bg-gray-600',
    maintenance: 'bg-yellow-500'
  }
  return map[status] || 'bg-gray-600'
}

onMounted(() => {
  loadHosts()
  hasInitialLoad = true
})

// 当组件从 KeepAlive 缓存中激活时，重新加载数据
// 解决从创建页面返回后需要手动刷新的问题
onActivated(() => {
  // 避免与 onMounted 重复加载
  if (hasInitialLoad) {
    loadHosts()
  }
})
</script>

<template>
  <div class="kawaii-page space-y-6 animate-fade-in">
    <ThemeTemplateSlot slot-name="user.hosts.banner" container-class="overflow-hidden rounded-lg border border-themed bg-themed-surface" />

    <div class="page-header">
      <div>
        <h1 class="page-title">{{ t('resources.hosts.title') }}</h1>
        <p class="page-description">{{ t('resources.hosts.description') }}</p>
      </div>
      <div v-if="scope === 'mine'" class="flex items-center gap-2">
        <button
          class="btn-secondary btn-sm sm:btn"
          :disabled="calibratingAll || onlineHostsCount === 0"
          @click="calibrateAll"
        >
          <svg v-if="calibratingAll" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {{ t('resources.hosts.calibrateAll') }}
        </button>
        <button class="btn-primary btn-sm sm:btn" @click="goToCreate">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('resources.hosts.create') }}
        </button>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
      <div class="relative flex-1 sm:max-w-xs">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="search"
          type="text"
          :placeholder="t('admin.hosts.searchPlaceholder')"
          class="input pl-9 w-full"
        />
      </div>
      <!-- 管理员专用：节点范围切换器 -->
      <div v-if="isAdmin" class="inline-flex rounded-lg border border-themed bg-themed-secondary p-1">
        <button
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="scope === 'mine' ? 'bg-themed-surface text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
          @click="switchScope('mine')"
        >
          {{ t('resources.hosts.mine') }}
        </button>
        <button
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="scope === 'hosted' ? 'bg-themed-surface text-themed shadow-sm' : 'text-themed-muted hover:text-themed'"
          @click="switchScope('hosted')"
        >
          {{ t('resources.hosts.hosted') }}
        </button>
      </div>
      <!-- 托管节点用户ID筛选 -->
      <div v-if="isAdmin && scope === 'hosted'" class="relative sm:w-40">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <input
          v-model="filterUserId"
          type="text"
          :placeholder="t('resources.hosts.filterByUserId')"
          class="input pl-9 w-full"
        />
      </div>
    </div>

    <!-- 宿主机列表 -->
    <SkeletonLoader v-if="loading" type="table" />

    <div v-else-if="hosts.length === 0" class="card p-12 text-center">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-themed-secondary">
        <svg class="h-7 w-7 icon-themed-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
      </div>
      <p class="text-themed-secondary">{{ t('resources.hosts.noHosts') }}</p>
      <p class="text-xs text-themed-muted mt-2">{{ t('resources.hosts.noHostsHint') }}</p>
    </div>

    <template v-else>
      <div class="grid gap-3 lg:hidden">
        <div
          v-for="host in hosts"
          :key="host.id"
          role="button"
          tabindex="0"
          class="nimbus-card w-full rounded-xl border border-themed bg-themed-surface p-4 text-left transition-all hover:bg-themed-hover"
          @click="goToDetail(host)"
          @keydown.enter.prevent="goToDetail(host)"
          @keydown.space.prevent="goToDetail(host)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <FlagIcon :code="host.countryCode" size="sm" />
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-themed">
                  {{ host.name?.toUpperCase() || host.name }}
                </div>
                <div class="mt-0.5 truncate font-mono text-xs text-themed-muted">
                  {{ host.location || host.url }}
                </div>
              </div>
            </div>
            <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-themed px-2 py-1 text-xs font-mono text-themed-secondary">
              <span :class="['h-1.5 w-1.5 rounded-full', getStatusClass(host.status)]"></span>
              {{ host.status }}
            </span>
          </div>

          <div v-if="isAdmin && scope === 'hosted'" class="mt-4 rounded-lg border border-themed bg-themed-secondary px-3 py-2">
            <div class="mb-1 text-[11px] font-medium uppercase tracking-wide text-themed-muted">
              {{ t('resources.hosts.owner') }}
            </div>
            <div v-if="host.owner" class="flex items-center gap-2">
              <UserAvatar :avatar-style="host.owner.avatarStyle" :badge-id="host.owner.avatarBadgeId || null" :size="28" :username="host.owner.username" />
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-themed">{{ host.owner.username }}</div>
                <div class="font-mono text-xs text-themed-muted">UID: {{ host.owner.id }}</div>
              </div>
            </div>
            <span v-else class="text-sm text-themed-muted">-</span>
          </div>

          <div class="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div class="rounded-lg border border-themed bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ t('admin.hosts.cpu') }}</div>
              <div class="mt-1 font-mono font-semibold tabular-nums text-themed">{{ host.cpuAllowanceMax || 0 }}%</div>
            </div>
            <div class="rounded-lg border border-themed bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ t('admin.hosts.memory') }}</div>
              <div class="mt-1 font-mono font-semibold tabular-nums text-themed">{{ formatMemory(host.memoryMax || 0) }}</div>
            </div>
            <div class="rounded-lg border border-themed bg-themed-secondary px-3 py-2">
              <div class="text-[11px] font-medium uppercase tracking-wide text-themed-muted">{{ t('admin.hosts.instances') }}</div>
              <div class="mt-1 font-mono font-semibold tabular-nums text-themed">{{ host.instanceCount }}</div>
            </div>
          </div>

          <div v-if="scope === 'mine' || (isAdmin && scope === 'hosted')" class="mt-4 flex items-center justify-end gap-2 border-t border-themed pt-3" @click.stop>
            <template v-if="scope === 'mine'">
              <button type="button" class="btn-ghost btn-sm" @click.stop="testHost(host)">{{ t('admin.hosts.test') }}</button>
              <button type="button" class="btn-ghost btn-sm text-error" @click.stop="deleteHost(host)">{{ t('admin.hosts.delete') }}</button>
            </template>
            <template v-else-if="isAdmin && scope === 'hosted'">
              <button
                type="button"
                class="btn-ghost btn-sm text-primary"
                :disabled="takingOverHostId === host.id"
                @click.stop="takeoverHost(host)"
              >
                {{ takingOverHostId === host.id ? t('resources.hosts.takeoverOfficialLoading') : t('resources.hosts.takeoverOfficial') }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <div class="card hidden overflow-hidden lg:block">
        <table class="w-full table-fixed">
          <thead class="border-b border-themed bg-themed-secondary">
            <tr>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.hosts.name') }}</th>
              <th v-if="isAdmin && scope === 'hosted'" class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('resources.hosts.owner') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.hosts.status') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.hosts.resources') }}</th>
              <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.hosts.instances') }}</th>
              <th v-if="scope === 'mine' || (isAdmin && scope === 'hosted')" class="text-right text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.hosts.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-themed">
            <tr
              v-for="host in hosts"
              :key="host.id"
              class="cursor-pointer transition-colors hover:bg-themed-hover"
              @click="goToDetail(host)"
            >
              <td class="px-4 py-3 whitespace-nowrap">
                <div class="flex items-center gap-2">
                  <FlagIcon :code="host.countryCode" size="sm" />
                  <div class="min-w-0">
                    <div class="truncate font-medium text-themed">
                      {{ host.name?.toUpperCase() || host.name }}
                    </div>
                    <div class="truncate font-mono text-xs text-themed-muted">
                      {{ host.location || host.url }}
                    </div>
                  </div>
                </div>
              </td>
              <!-- 托管节点所有者信息 -->
              <td v-if="isAdmin && scope === 'hosted'" class="px-4 py-3 whitespace-nowrap">
                <div v-if="host.owner" class="flex items-center gap-2">
                  <UserAvatar :avatar-style="host.owner.avatarStyle" :badge-id="host.owner.avatarBadgeId || null" :size="28" :username="host.owner.username" />
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-themed">{{ host.owner.username }}</div>
                    <div class="font-mono text-xs text-themed-muted">UID: {{ host.owner.id }}</div>
                  </div>
                </div>
                <span v-else class="text-themed-muted">-</span>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5 rounded-full border border-themed px-2 py-0.5 text-xs font-mono text-themed-secondary">
                  <span :class="['h-1.5 w-1.5 rounded-full', getStatusClass(host.status)]"></span>
                  {{ host.status }}
                </span>
              </td>
              <td class="px-4 py-3 text-themed-secondary whitespace-nowrap">
                <div class="font-mono text-xs tabular-nums">
                  {{ t('admin.hosts.cpu') }}: {{ host.cpuAllowanceMax || 0 }}%
                </div>
                <div class="font-mono text-xs tabular-nums">
                  {{ t('admin.hosts.memory') }}: {{ formatMemory(host.memoryMax || 0) }}
                </div>
              </td>
              <td class="px-4 py-3 text-sm font-mono tabular-nums text-themed-secondary whitespace-nowrap">{{ host.instanceCount }}</td>
              <td v-if="scope === 'mine' || (isAdmin && scope === 'hosted')" class="px-4 py-3 text-right whitespace-nowrap" @click.stop>
                <div class="flex items-center justify-end gap-2">
                  <template v-if="scope === 'mine'">
                    <button class="btn-ghost btn-sm" @click.stop="testHost(host)">{{ t('admin.hosts.test') }}</button>
                    <button class="btn-ghost btn-sm text-error" @click.stop="deleteHost(host)">{{ t('admin.hosts.delete') }}</button>
                  </template>
                  <template v-else-if="isAdmin && scope === 'hosted'">
                    <button
                      class="btn-ghost btn-sm text-primary"
                      :disabled="takingOverHostId === host.id"
                      @click.stop="takeoverHost(host)"
                    >
                      {{ takingOverHostId === host.id ? t('resources.hosts.takeoverOfficialLoading') : t('resources.hosts.takeoverOfficial') }}
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 分页 -->
    <div v-if="total > 0" class="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-themed-muted">
      <div class="flex items-center gap-3">
        <span>{{ t('admin.users.totalRecords', { count: total }) }}</span>
        <select
          v-model="pageSize"
          class="cursor-pointer rounded-md border border-themed bg-themed-surface py-1 pl-2 pr-7 text-sm text-themed-secondary focus:outline-none focus:ring-2 focus:ring-primary-500"
          @change="handlePageSizeChange"
        >
          <option :value="10">10 / {{ t('common.page') }}</option>
          <option :value="30">30 / {{ t('common.page') }}</option>
          <option :value="50">50 / {{ t('common.page') }}</option>
          <option :value="100">100 / {{ t('common.page') }}</option>
        </select>
      </div>
      <div v-if="totalPages > 1" class="flex items-center gap-1">
        <!-- 上一页 -->
        <button
          :disabled="page <= 1"
          class="rounded-md p-1.5 transition-colors hover:bg-themed-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          @click="goToPage(page - 1)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <!-- 页码按钮 -->
        <template v-for="(p, idx) in pageNumbers" :key="idx">
          <span v-if="p === '...'" class="px-2 py-1 text-themed-muted">…</span>
          <button
            v-else
            class="min-w-[32px] rounded-md px-2 py-1 text-sm font-mono tabular-nums transition-colors"
            :class="p === page ? 'bg-primary-500 text-white' : 'text-themed-secondary hover:bg-themed-hover'"
            @click="goToPage(p)"
          >
            {{ p }}
          </button>
        </template>

        <!-- 下一页 -->
        <button
          :disabled="page >= totalPages"
          class="rounded-md p-1.5 transition-colors hover:bg-themed-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          @click="goToPage(page + 1)"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- 托管准入条件不满足弹窗 -->
  <div
    v-if="showAccessDeniedModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    @click.self="showAccessDeniedModal = false"
  >
    <div class="w-full max-w-md rounded-xl border border-themed bg-themed-surface p-6 shadow-2xl">
      <div class="flex items-center gap-3 mb-4">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full"
          :class="themeStore.isDark ? 'bg-amber-500/15' : 'bg-amber-100'"
        >
          <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-themed">{{ t('hosting.accessDenied.title') }}</h3>
      </div>

      <p class="text-sm text-themed-muted mb-4">{{ t('hosting.accessDenied.description') }}</p>

      <div class="space-y-3 mb-6">
        <!-- 条件：至少拥有过1台实例 -->
        <div class="flex items-center gap-3 rounded-lg border border-themed bg-themed-secondary p-3">
          <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-themed-hover text-themed-muted">
            <span class="text-xs font-medium">!</span>
          </div>
          <div class="flex-1">
            <div class="text-sm font-medium text-themed">{{ accessDeniedConditionText }}</div>
            <div class="text-xs text-themed-muted">
              {{ accessDeniedStatusText }}
            </div>
          </div>
        </div>
      </div>

      <p class="text-xs text-themed-muted mb-4">{{ accessDeniedHintText }}</p>

      <button
        class="btn-primary w-full"
        @click="showAccessDeniedModal = false"
      >
        {{ t('common.confirm') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Nimbus interactive card: subtle hover-lift */
.nimbus-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.nimbus-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgb(16 24 40 / 0.08);
}

@media (prefers-reduced-motion: reduce) {
  .nimbus-card {
    transition: none;
  }

  .nimbus-card:hover {
    transform: none;
  }
}
</style>
