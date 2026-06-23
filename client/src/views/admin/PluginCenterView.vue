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
const selectedPluginId = ref<string | null>(null)
const selectedFile = ref<File | null>(null)
const plugins = ref<PluginRecord[]>([])
const market = ref<PluginMarketEntry[]>([])
const tasks = ref<PluginTask[]>([])
const taskLogs = ref('')
const selectedTaskId = ref<number | null>(null)
const configs = ref<PluginConfigValue[]>([])
const configDraft = ref('')

const selectedPlugin = computed(() =>
  plugins.value.find(plugin => plugin.pluginId === selectedPluginId.value) || plugins.value[0] || null
)

const stats = computed(() => ({
  installed: plugins.value.length,
  enabled: plugins.value.filter(plugin => plugin.enabled).length,
  failed: plugins.value.filter(plugin => plugin.status === 'failed').length,
  market: market.value.length
}))

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
    await loadSelectedPluginConfig()
  } catch (err: any) {
    toast.error('加载插件中心失败：' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function loadMarket() {
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
    await api.plugins.upload(selectedFile.value)
    toast.success('插件安装任务已完成')
    selectedFile.value = null
    await refreshAll()
  } catch (err: any) {
    toast.error('上传安装失败：' + (err?.message || String(err)))
  } finally {
    uploading.value = false
  }
}

async function installMarketPlugin(entry: PluginMarketEntry) {
  if (!window.confirm(`确认从市场安装 ${entry.name} ${entry.latest}？`)) return
  try {
    await api.plugins.installFromMarket(entry.id)
    toast.success('市场插件安装完成')
    await refreshAll()
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
  try {
    const response = await api.plugins.getTaskLogs(task.id)
    taskLogs.value = response.logs
  } catch {
    taskLogs.value = ''
  }
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
        <button class="btn-primary" :disabled="marketLoading" @click="loadMarket">{{ marketLoading ? '加载中...' : '刷新市场' }}</button>
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
      <section class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div class="space-y-6">
          <div class="card p-5">
            <div class="flex items-center justify-between gap-4">
              <h2 class="text-lg font-semibold text-themed">已安装插件</h2>
              <div class="flex items-center gap-2">
                <input type="file" accept=".tar.gz" class="text-sm" @change="onFileChange" />
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
                    <td class="py-3 pr-4 text-themed">{{ plugin.sourceType }}</td>
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

          <div class="card p-5">
            <h2 class="text-lg font-semibold text-themed">插件市场</h2>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <div v-for="entry in market" :key="entry.id" class="rounded border border-themed p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h3 class="font-medium text-themed">{{ entry.name }}</h3>
                    <p class="mt-1 font-mono text-xs text-themed-muted">{{ entry.id }}</p>
                  </div>
                  <span class="rounded border border-themed px-2 py-1 text-xs text-themed-muted">{{ entry.latest }}</span>
                </div>
                <p class="mt-3 text-sm text-themed-muted">{{ entry.description || entry.repo }}</p>
                <div class="mt-3 text-xs text-themed-muted">SHA256 {{ entry.sha256.slice(0, 12) }}...</div>
                <button class="btn-primary mt-4" @click="installMarketPlugin(entry)">安装</button>
              </div>
              <div v-if="market.length === 0" class="text-sm text-themed-muted">点击“刷新市场”读取 GitHub 插件市场。</div>
            </div>
          </div>

          <div class="card p-5">
            <h2 class="text-lg font-semibold text-themed">安装任务</h2>
            <div class="mt-4 grid gap-4 lg:grid-cols-2">
              <div class="space-y-2">
                <button
                  v-for="task in tasks"
                  :key="task.id"
                  class="block w-full rounded border border-themed px-3 py-2 text-left text-sm"
                  :class="task.id === selectedTaskId ? 'bg-gray-100 dark:bg-gray-900' : ''"
                  @click="selectTask(task)"
                >
                  <div class="font-medium text-themed">#{{ task.id }} {{ task.action }} · {{ task.status }}</div>
                  <div class="text-xs text-themed-muted">{{ task.pluginId || '-' }} · {{ formatDate(task.createdAt) }}</div>
                </button>
              </div>
              <pre class="min-h-[220px] overflow-auto rounded bg-gray-950 p-3 text-xs text-gray-100">{{ taskLogs || '选择任务查看日志' }}</pre>
            </div>
          </div>
        </div>

        <aside class="space-y-6">
          <div class="card p-5">
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
          </div>
        </aside>
      </section>
    </template>
  </div>
</template>
