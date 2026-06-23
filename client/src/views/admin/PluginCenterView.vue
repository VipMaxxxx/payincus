<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import PluginFrame from '@/components/plugins/PluginFrame.vue'
import type { PluginConfigValue, PluginMarketEntry, PluginRecord, PluginTask } from '@/types/api'

const toast = useToast()

const loading = ref(true)
const marketLoading = ref(false)
const uploading = ref(false)
const taskLogsLoading = ref(false)
const activeTab = ref<'installed' | 'market' | 'tasks'>('installed')
const selectedPluginId = ref<string | null>(null)
const selectedFile = ref<File | null>(null)
const plugins = ref<PluginRecord[]>([])
const market = ref<PluginMarketEntry[]>([])
const tasks = ref<PluginTask[]>([])
const taskLogs = ref('')
const selectedTaskId = ref<number | null>(null)
const taskPage = ref(1)
const configs = ref<PluginConfigValue[]>([])
const configDraft = ref('')
const TASKS_PER_PAGE = 7
const tabs = [
  { key: 'installed', label: '已安装', description: '上传插件包、启用停用、维护配置和查看插件页面。' },
  { key: 'market', label: '插件市场', description: '从已配置的 GitHub 市场索引读取插件并安装。' },
  { key: 'tasks', label: '安装任务', description: '查看上传安装、市场安装、启用、禁用和卸载任务日志。' }
] as const

const selectedPlugin = computed(() =>
  plugins.value.find(plugin => plugin.pluginId === selectedPluginId.value) || plugins.value[0] || null
)

const selectedTask = computed(() =>
  tasks.value.find(task => task.id === selectedTaskId.value) || null
)

const stats = computed(() => ({
  installed: plugins.value.length,
  enabled: plugins.value.filter(plugin => plugin.enabled).length,
  failed: plugins.value.filter(plugin => plugin.status === 'failed').length,
  market: market.value.length
}))

const taskSummary = computed(() => ({
  total: tasks.value.length,
  running: tasks.value.filter(task => task.status === 'pending' || task.status === 'running').length,
  failed: tasks.value.filter(task => task.status === 'failed').length
}))

const activeTabMeta = computed(() =>
  tabs.find(tab => tab.key === activeTab.value) || tabs[0]
)

const totalTaskPages = computed(() =>
  Math.max(1, Math.ceil(tasks.value.length / TASKS_PER_PAGE))
)

const paginatedTasks = computed(() => {
  const start = (taskPage.value - 1) * TASKS_PER_PAGE
  return tasks.value.slice(start, start + TASKS_PER_PAGE)
})

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusClass(plugin: PluginRecord): string {
  if (plugin.enabled) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (plugin.status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function statusText(plugin: PluginRecord): string {
  if (plugin.enabled) return '已启用'
  if (plugin.status === 'failed') return '异常'
  return '未启用'
}

function taskStatusText(status: PluginTask['status']): string {
  const labels: Record<PluginTask['status'], string> = {
    pending: '等待中',
    running: '执行中',
    success: '成功',
    failed: '失败'
  }
  return labels[status]
}

function taskActionText(action: PluginTask['action']): string {
  const labels: Record<PluginTask['action'], string> = {
    upload_install: '上传安装',
    market_install: '市场安装',
    enable: '启用',
    disable: '禁用',
    uninstall: '卸载'
  }
  return labels[action]
}

function taskStatusClass(status: PluginTask['status']): string {
  if (status === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'running') return 'bg-blue-50 text-blue-700 border-blue-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

async function refreshAll() {
  loading.value = true
  try {
    const [pluginResponse, taskResponse] = await Promise.all([
      api.plugins.list(),
      api.plugins.listTasks()
    ])
    plugins.value = pluginResponse.plugins
    tasks.value = taskResponse.tasks
    if (!selectedPluginId.value && plugins.value.length > 0) selectedPluginId.value = plugins.value[0].pluginId
    if (selectedTaskId.value && !tasks.value.some(task => task.id === selectedTaskId.value)) selectedTaskId.value = null
    if (!selectedTaskId.value && tasks.value.length > 0) selectedTaskId.value = tasks.value[0].id
    ensureSelectedTaskVisible()
    await loadSelectedPluginConfig()
  } catch (err: any) {
    toast.error('加载插件中心失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function loadMarket() {
  activeTab.value = 'market'
  marketLoading.value = true
  try {
    const response = await api.plugins.market()
    market.value = response.plugins
    if (market.value.length === 0) toast.success('插件市场暂无可安装插件')
  } catch (err: any) {
    toast.error('加载插件市场失败：' + (err?.message || String(err)))
  } finally {
    marketLoading.value = false
  }
}

async function loadSelectedPluginConfig() {
  if (!selectedPlugin.value) {
    configs.value = []
    configDraft.value = ''
    return
  }
  const response = await api.plugins.getConfig(selectedPlugin.value.pluginId)
  configs.value = response.configs
  configDraft.value = JSON.stringify(Object.fromEntries(configs.value.map(config => [config.key, config.value])), null, 2)
}

async function selectPlugin(plugin: PluginRecord) {
  selectedPluginId.value = plugin.pluginId
  await loadSelectedPluginConfig()
}

async function uploadPlugin() {
  if (!selectedFile.value) return
  uploading.value = true
  try {
    const response = await api.plugins.upload(selectedFile.value)
    toast.success('插件安装任务已完成')
    selectedFile.value = null
    if (response.task?.id) selectedTaskId.value = response.task.id
    activeTab.value = 'tasks'
    await refreshAll()
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('上传安装失败：' + (err?.message || String(err)))
  } finally {
    uploading.value = false
  }
}

async function installMarketPlugin(entry: PluginMarketEntry) {
  if (!window.confirm(`确认从市场安装 ${entry.name} ${entry.latest}？`)) return
  try {
    const response = await api.plugins.installFromMarket(entry.id)
    toast.success('市场插件安装完成')
    if (response.task?.id) selectedTaskId.value = response.task.id
    activeTab.value = 'tasks'
    await refreshAll()
    await loadSelectedTaskLogs()
  } catch (err: any) {
    toast.error('市场安装失败：' + (err?.message || String(err)))
  }
}

async function togglePlugin(plugin: PluginRecord) {
  try {
    if (plugin.enabled) {
      await api.plugins.disable(plugin.pluginId)
      toast.success('插件已禁用')
    } else {
      await api.plugins.enable(plugin.pluginId)
      toast.success('插件已启用')
    }
    await refreshAll()
  } catch (err: any) {
    toast.error('插件状态更新失败：' + (err?.message || String(err)))
  }
}

async function uninstallSelectedPlugin() {
  if (!selectedPlugin.value) return
  if (!window.confirm(`确认卸载 ${selectedPlugin.value.name}？卸载后静态资源将不可访问。`)) return
  try {
    await api.plugins.uninstall(selectedPlugin.value.pluginId)
    toast.success('插件已卸载')
    selectedPluginId.value = null
    await refreshAll()
  } catch (err: any) {
    toast.error('卸载失败：' + (err?.message || String(err)))
  }
}

async function saveConfig() {
  if (!selectedPlugin.value) return
  try {
    const parsed = JSON.parse(configDraft.value || '{}') as Record<string, unknown>
    const updates = Object.entries(parsed).map(([key, value]) => ({ key, value, isSecret: /token|secret|password|key/i.test(key) }))
    await api.plugins.updateConfig(selectedPlugin.value.pluginId, updates)
    toast.success('插件配置已保存')
    await loadSelectedPluginConfig()
  } catch (err: any) {
    toast.error('保存配置失败：' + (err?.message || String(err)))
  }
}

async function selectTask(task: PluginTask) {
  selectedTaskId.value = task.id
  activeTab.value = 'tasks'
  ensureSelectedTaskVisible()
  await loadSelectedTaskLogs()
}

async function loadSelectedTaskLogs() {
  if (!selectedTaskId.value) {
    taskLogs.value = ''
    return
  }
  taskLogsLoading.value = true
  try {
    const response = await api.plugins.getTaskLogs(selectedTaskId.value)
    taskLogs.value = response.logs
  } catch {
    taskLogs.value = ''
  } finally {
    taskLogsLoading.value = false
  }
}

function setTaskPage(page: number) {
  taskPage.value = Math.min(Math.max(page, 1), totalTaskPages.value)
}

function ensureSelectedTaskVisible() {
  if (!selectedTaskId.value) {
    setTaskPage(taskPage.value)
    return
  }
  const index = tasks.value.findIndex(task => task.id === selectedTaskId.value)
  if (index >= 0) {
    taskPage.value = Math.floor(index / TASKS_PER_PAGE) + 1
  } else {
    setTaskPage(taskPage.value)
  }
}

function openMarketTab() {
  if (market.value.length === 0 && !marketLoading.value) {
    void loadMarket()
    return
  }
  activeTab.value = 'market'
}

function openTasksTab() {
  activeTab.value = 'tasks'
  void loadSelectedTaskLogs()
}

function setActiveTab(tab: typeof activeTab.value) {
  if (tab === 'market') {
    openMarketTab()
    return
  }
  if (tab === 'tasks') {
    openTasksTab()
    return
  }
  activeTab.value = tab
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
}

onMounted(async () => {
  await refreshAll()
})
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-themed">插件中心</h1>
        <p class="mt-1 text-sm text-themed-muted">上传、安装、启用和管理 PayIncus 插件。插件通过受控扩展点接入后台和用户端。</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="refreshAll">刷新</button>
        <button
          v-if="activeTab === 'market'"
          class="btn-primary"
          :disabled="marketLoading"
          @click="loadMarket"
        >
          {{ marketLoading ? '加载中...' : '刷新市场' }}
        </button>
        <button
          v-else-if="activeTab === 'tasks'"
          class="btn-primary"
          :disabled="!selectedTask || taskLogsLoading"
          @click="loadSelectedTaskLogs"
        >
          {{ taskLogsLoading ? '加载中...' : '刷新日志' }}
        </button>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-4">
      <div class="card p-4">
        <div class="text-sm text-themed-muted">已安装</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.installed }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">已启用</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.enabled }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">异常</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.failed }}</div>
      </div>
      <div class="card p-4">
        <div class="text-sm text-themed-muted">市场插件</div>
        <div class="mt-2 text-2xl font-semibold text-themed">{{ stats.market }}</div>
      </div>
    </div>

    <div v-if="loading" class="py-16 text-center text-themed-muted">加载中...</div>

    <template v-else>
      <div class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-4 border-b border-themed px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">{{ activeTabMeta.label }}</h2>
            <p class="mt-1 text-sm text-themed-muted">{{ activeTabMeta.description }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="rounded border px-3 py-2 text-sm font-medium transition"
              :class="activeTab === tab.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-themed text-themed-muted hover:bg-themed-hover hover:text-themed'"
              @click="setActiveTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
      </div>

      <section v-if="activeTab === 'installed'" class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div class="rounded-lg border border-themed bg-themed-surface p-5">
          <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 class="text-lg font-semibold text-themed">已安装插件</h2>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="file" accept=".tar.gz" class="max-w-full text-sm" @change="onFileChange" />
              <button class="btn-primary" :disabled="!selectedFile || uploading" @click="uploadPlugin">{{ uploading ? '安装中...' : '上传安装' }}</button>
            </div>
          </div>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="text-left text-themed-muted">
                <tr>
                  <th class="py-2 pr-4">插件</th>
                  <th class="py-2 pr-4">版本</th>
                  <th class="py-2 pr-4">来源</th>
                  <th class="py-2 pr-4">状态</th>
                  <th class="py-2 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="plugin in plugins" :key="plugin.pluginId" class="border-t border-themed">
                  <td class="py-3 pr-4">
                    <button class="text-left font-medium text-themed hover:underline" @click="selectPlugin(plugin)">{{ plugin.name }}</button>
                    <div class="font-mono text-xs text-themed-muted">{{ plugin.pluginId }}</div>
                  </td>
                  <td class="py-3 pr-4 text-themed">{{ plugin.currentVersion || '-' }}</td>
                  <td class="py-3 pr-4 text-themed">{{ plugin.sourceType === 'market' ? '市场' : '上传' }}</td>
                  <td class="py-3 pr-4">
                    <span class="rounded border px-2 py-1 text-xs" :class="statusClass(plugin)">{{ statusText(plugin) }}</span>
                  </td>
                  <td class="py-3 pr-4">
                    <button class="btn-secondary mr-2" @click="togglePlugin(plugin)">{{ plugin.enabled ? '禁用' : '启用' }}</button>
                    <button class="btn-secondary" @click="selectPlugin(plugin)">详情</button>
                  </td>
                </tr>
                <tr v-if="plugins.length === 0">
                  <td colspan="5" class="py-8 text-center text-themed-muted">暂无插件</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <aside class="rounded-lg border border-themed bg-themed-surface p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-themed">插件详情</h2>
              <p class="mt-1 text-sm text-themed-muted">{{ selectedPlugin?.pluginId || '未选择插件' }}</p>
            </div>
            <button v-if="selectedPlugin" class="btn-secondary" @click="uninstallSelectedPlugin">卸载</button>
          </div>

          <template v-if="selectedPlugin?.latestVersion">
            <dl class="mt-4 space-y-3 text-sm">
              <div>
                <dt class="text-themed-muted">描述</dt>
                <dd class="text-themed">{{ selectedPlugin.latestVersion.manifest.description || '-' }}</dd>
              </div>
              <div>
                <dt class="text-themed-muted">权限</dt>
                <dd class="text-themed">{{ selectedPlugin.latestVersion.manifest.permissions?.join(', ') || '-' }}</dd>
              </div>
              <div>
                <dt class="text-themed-muted">客户端影响</dt>
                <dd class="space-y-1 text-themed">
                  <div v-for="page in selectedPlugin.latestVersion.manifest.entrypoints.userPages || []" :key="page.slot">
                    {{ page.slot }} · {{ page.title }}
                  </div>
                  <span v-if="!(selectedPlugin.latestVersion.manifest.entrypoints.userPages || []).length">无</span>
                </dd>
              </div>
            </dl>

            <div class="mt-5">
              <h3 class="text-sm font-medium text-themed">配置 JSON</h3>
              <textarea v-model="configDraft" class="mt-2 h-44 w-full rounded border border-themed bg-transparent p-3 font-mono text-xs text-themed"></textarea>
              <button class="btn-primary mt-3" @click="saveConfig">保存配置</button>
            </div>

            <div v-if="selectedPlugin.enabled && (selectedPlugin.latestVersion.manifest.entrypoints.adminPages || []).length" class="mt-5 space-y-3">
              <h3 class="text-sm font-medium text-themed">后台页面预览</h3>
              <PluginFrame
                v-for="page in selectedPlugin.latestVersion.manifest.entrypoints.adminPages || []"
                :key="page.entry"
                :title="page.title"
                :url="`/api/plugins/assets/${encodeURIComponent(selectedPlugin.pluginId)}/${page.entry}`"
              />
            </div>
          </template>
        </aside>
      </section>

      <section v-else-if="activeTab === 'market'" class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
        <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 class="text-lg font-semibold text-themed">GitHub 插件市场</h2>
            <p class="mt-1 text-sm text-themed-muted">仅安装市场索引中的 GitHub Release 包，并使用 SHA256 校验。</p>
          </div>
          <button class="btn-primary" :disabled="marketLoading" @click="loadMarket">{{ marketLoading ? '加载中...' : '刷新市场' }}</button>
        </div>

        <div v-if="market.length === 0" class="px-5 py-16 text-center">
          <div class="mx-auto max-w-md">
            <h3 class="text-base font-semibold text-themed">暂无市场插件</h3>
            <p class="mt-2 text-sm leading-6 text-themed-muted">请确认已配置插件市场索引地址，然后刷新市场读取 GitHub Release 插件包。</p>
            <button class="btn-secondary mt-4" :disabled="marketLoading" @click="loadMarket">{{ marketLoading ? '加载中...' : '刷新市场' }}</button>
          </div>
        </div>
        <div v-else class="grid gap-4 p-5 lg:grid-cols-2 2xl:grid-cols-3">
          <article v-for="entry in market" :key="entry.id" class="flex min-h-[260px] flex-col rounded border border-themed bg-themed p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="font-medium text-themed">{{ entry.name }}</h3>
                <p class="mt-1 truncate font-mono text-xs text-themed-muted">{{ entry.id }}</p>
              </div>
              <span class="rounded border border-themed px-2 py-1 text-xs text-themed-muted">{{ entry.latest }}</span>
            </div>
            <p class="mt-3 line-clamp-3 min-h-[72px] text-sm leading-6 text-themed-muted">{{ entry.description || entry.repo }}</p>
            <dl class="mt-4 grid gap-2 text-xs text-themed-muted sm:grid-cols-2">
              <div>
                <dt>作者</dt>
                <dd class="mt-1 text-themed">{{ entry.author || '-' }}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd class="mt-1 truncate text-themed">{{ entry.repo }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt>SHA256</dt>
                <dd class="mt-1 font-mono text-themed">{{ entry.sha256.slice(0, 16) }}...</dd>
              </div>
            </dl>
            <button class="btn-primary mt-auto w-full" @click="installMarketPlugin(entry)">安装</button>
          </article>
        </div>
      </section>

      <section v-else class="grid gap-6 xl:grid-cols-[minmax(300px,440px)_1fr]">
        <div class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
          <div class="flex items-center justify-between gap-3 border-b border-themed px-5 py-4">
            <div>
              <h2 class="text-lg font-semibold text-themed">安装任务</h2>
              <p class="mt-1 text-xs text-themed-muted">每页最多显示 7 条，选择任务后查看右侧日志。</p>
            </div>
            <div class="flex gap-2 text-xs">
              <span class="rounded border border-themed px-2 py-1 text-themed-muted">{{ taskSummary.total }} 条</span>
              <span v-if="taskSummary.running" class="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{{ taskSummary.running }} 运行中</span>
              <span v-if="taskSummary.failed" class="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{{ taskSummary.failed }} 失败</span>
            </div>
          </div>
          <div v-if="tasks.length === 0" class="px-5 py-10 text-center text-sm text-themed-muted">暂无安装任务。</div>
          <div v-else class="divide-y divide-themed">
            <button
              v-for="task in paginatedTasks"
              :key="task.id"
              class="block h-[76px] w-full overflow-hidden px-5 py-3 text-left transition hover:bg-themed-hover"
              :class="task.id === selectedTaskId ? 'bg-themed-hover' : ''"
              @click="selectTask(task)"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="truncate font-medium text-themed">#{{ task.id }} {{ taskActionText(task.action) }}</span>
                <span class="rounded border px-2 py-0.5 text-xs" :class="taskStatusClass(task.status)">
                  {{ taskStatusText(task.status) }}
                </span>
              </div>
              <div class="mt-1 text-xs text-themed-muted">{{ task.pluginId || '-' }} · {{ formatDate(task.createdAt) }}</div>
              <p v-if="task.errorMessage" class="mt-1 truncate text-xs text-red-600">{{ task.errorMessage }}</p>
            </button>
          </div>
          <div class="flex min-h-[54px] items-center justify-between border-t border-themed px-5 py-3 text-xs text-themed-muted">
            <span>第 {{ taskPage }} / {{ totalTaskPages }} 页 · 共 {{ tasks.length }} 个任务</span>
            <div class="flex gap-2">
              <button class="btn-secondary" :disabled="taskPage <= 1" @click="setTaskPage(taskPage - 1)">上一页</button>
              <button class="btn-secondary" :disabled="taskPage >= totalTaskPages" @click="setTaskPage(taskPage + 1)">下一页</button>
            </div>
          </div>
        </div>

        <div class="overflow-hidden rounded-lg border border-themed bg-themed-surface">
          <div class="flex flex-col gap-3 border-b border-themed px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-themed">任务日志</h2>
              <p class="mt-1 text-xs text-themed-muted">{{ selectedTask ? `任务 #${selectedTask.id} · ${taskStatusText(selectedTask.status)}` : '请选择任务' }}</p>
            </div>
            <button class="btn-secondary" :disabled="!selectedTask || taskLogsLoading" @click="loadSelectedTaskLogs">
              {{ taskLogsLoading ? '加载中...' : '刷新日志' }}
            </button>
          </div>
          <pre class="min-h-[460px] max-h-[620px] overflow-auto whitespace-pre-wrap bg-gray-950 p-5 text-xs leading-5 text-gray-100">{{ taskLogs || '暂无日志。' }}</pre>
        </div>
      </section>
    </template>
  </div>
</template>
