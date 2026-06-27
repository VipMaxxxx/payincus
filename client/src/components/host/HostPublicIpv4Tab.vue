<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import { useToast } from '@/stores/toast'

const props = defineProps<{
  hostId: number
}>()

type PublicIpv4AddressStatus = 'free' | 'assigned' | 'disabled'

interface PublicIpv4Address {
  id: number
  address: string
  prefixLength: number
  gateway: string | null
  status: PublicIpv4AddressStatus
  instanceId: number | null
}

interface PublicIpv4Pool {
  id: number
  name: string
  cidr: string | null
  gateway: string
  prefixLength: number
  dns: string[]
  enabled: boolean
  stats: { total: number; free: number; assigned: number; disabled: number }
  addresses: PublicIpv4Address[]
}

const toast = useToast()
const loading = ref(false)
const actionLoading = ref('')
const pools = ref<PublicIpv4Pool[]>([])
const showCreate = ref(false)
const addAddressPoolId = ref<number | null>(null)
const addAddressText = ref('')

const form = ref({
  name: '',
  cidr: '',
  gateway: '',
  prefixLength: 32,
  dns: '1.1.1.1\n8.8.8.8',
  addresses: ''
})

const totals = computed(() => pools.value.reduce((acc, pool) => {
  acc.total += pool.stats.total
  acc.free += pool.stats.free
  acc.assigned += pool.stats.assigned
  acc.disabled += pool.stats.disabled
  return acc
}, { total: 0, free: 0, assigned: 0, disabled: 0 }))

function splitLines(value: string): string[] {
  return value.split(/[\n,\s]+/).map(item => item.trim()).filter(Boolean)
}

async function loadPools(): Promise<void> {
  loading.value = true
  try {
    const res = await api.hosts.getPublicIpv4Pools(props.hostId)
    pools.value = res.pools
  } catch (err: any) {
    toast.error('加载独立 IPv4 地址池失败: ' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function createPool(): Promise<void> {
  if (!form.value.name.trim() || !form.value.gateway.trim()) {
    toast.error('请填写地址池名称和网关')
    return
  }
  actionLoading.value = 'create'
  try {
    await api.hosts.createPublicIpv4Pool(props.hostId, {
      name: form.value.name.trim(),
      cidr: form.value.cidr.trim() || undefined,
      gateway: form.value.gateway.trim(),
      prefixLength: form.value.prefixLength,
      dns: splitLines(form.value.dns),
      addresses: splitLines(form.value.addresses)
    })
    toast.success('独立 IPv4 地址池已创建')
    showCreate.value = false
    form.value = { name: '', cidr: '', gateway: '', prefixLength: 32, dns: '1.1.1.1\n8.8.8.8', addresses: '' }
    await loadPools()
  } catch (err: any) {
    toast.error('创建地址池失败: ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

async function addAddresses(poolId: number): Promise<void> {
  const addresses = splitLines(addAddressText.value)
  if (addresses.length === 0) {
    toast.error('请输入要添加的 IPv4 地址')
    return
  }
  actionLoading.value = `add:${poolId}`
  try {
    const result = await api.hosts.addPublicIpv4Addresses(props.hostId, poolId, { addresses })
    toast.success(`已添加 ${result.count} 个地址`)
    addAddressText.value = ''
    addAddressPoolId.value = null
    await loadPools()
  } catch (err: any) {
    toast.error('添加地址失败: ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

async function toggleAddress(address: PublicIpv4Address): Promise<void> {
  if (address.status === 'assigned') return
  const nextStatus: PublicIpv4AddressStatus = address.status === 'disabled' ? 'free' : 'disabled'
  actionLoading.value = `status:${address.id}`
  try {
    await api.hosts.updatePublicIpv4AddressStatus(props.hostId, address.id, nextStatus)
    await loadPools()
  } catch (err: any) {
    toast.error('更新地址状态失败: ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

async function deleteAddress(address: PublicIpv4Address): Promise<void> {
  if (address.status === 'assigned') return
  if (!confirm(`删除 IPv4 地址 ${address.address}？`)) return
  actionLoading.value = `delete:${address.id}`
  try {
    await api.hosts.deletePublicIpv4Address(props.hostId, address.id)
    await loadPools()
  } catch (err: any) {
    toast.error('删除地址失败: ' + (err?.message || String(err)))
  } finally {
    actionLoading.value = ''
  }
}

onMounted(loadPools)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-lg font-medium text-themed">独立 IPv4 地址池</h3>
        <p class="text-sm text-themed-secondary mt-1">为独立 IPv4 套餐提供 routed 公网 IPv4 分配、回收和容量校验。</p>
      </div>
      <button class="btn-primary btn-sm" @click="showCreate = true">新增地址池</button>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="card p-4"><div class="text-xs text-themed-muted">总地址</div><div class="text-2xl font-semibold text-themed">{{ totals.total }}</div></div>
      <div class="card p-4"><div class="text-xs text-themed-muted">可用</div><div class="text-2xl font-semibold text-green-600">{{ totals.free }}</div></div>
      <div class="card p-4"><div class="text-xs text-themed-muted">已分配</div><div class="text-2xl font-semibold text-blue-600">{{ totals.assigned }}</div></div>
      <div class="card p-4"><div class="text-xs text-themed-muted">禁用</div><div class="text-2xl font-semibold text-gray-500">{{ totals.disabled }}</div></div>
    </div>

    <div v-if="loading" class="card p-8 text-center text-themed-muted">加载中...</div>
    <div v-else-if="pools.length === 0" class="card p-8 text-center text-themed-muted">暂无独立 IPv4 地址池。</div>

    <div v-for="pool in pools" :key="pool.id" class="card p-5 space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <h4 class="font-semibold text-themed">{{ pool.name }}</h4>
            <span :class="['px-2 py-0.5 rounded text-xs', pool.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600']">{{ pool.enabled ? '启用' : '停用' }}</span>
          </div>
          <p class="text-sm text-themed-secondary mt-1">网关 {{ pool.gateway }} · /{{ pool.prefixLength }} · DNS {{ pool.dns.join(', ') || '-' }}</p>
        </div>
        <button class="btn-secondary btn-sm" @click="addAddressPoolId = pool.id">添加地址</button>
      </div>

      <div v-if="addAddressPoolId === pool.id" class="border border-themed rounded-lg p-3 space-y-3">
        <textarea v-model="addAddressText" class="input w-full min-h-24 font-mono text-sm" placeholder="每行一个 IPv4 地址"></textarea>
        <div class="flex justify-end gap-2">
          <button class="btn-secondary btn-sm" @click="addAddressPoolId = null">取消</button>
          <button class="btn-primary btn-sm" :disabled="!!actionLoading" @click="addAddresses(pool.id)">添加</button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-themed-muted border-b border-themed">
            <tr>
              <th class="py-2">地址</th>
              <th class="py-2">状态</th>
              <th class="py-2">实例</th>
              <th class="py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="address in pool.addresses" :key="address.id" class="border-b border-themed/60">
              <td class="py-2 font-mono">{{ address.address }}/{{ address.prefixLength }}</td>
              <td class="py-2">{{ address.status === 'free' ? '可用' : address.status === 'assigned' ? '已分配' : '禁用' }}</td>
              <td class="py-2">{{ address.instanceId ? `#${address.instanceId}` : '-' }}</td>
              <td class="py-2 text-right space-x-2">
                <button v-if="address.status !== 'assigned'" class="btn-secondary btn-xs" :disabled="!!actionLoading" @click="toggleAddress(address)">
                  {{ address.status === 'disabled' ? '启用' : '禁用' }}
                </button>
                <button v-if="address.status !== 'assigned'" class="btn-danger btn-xs" :disabled="!!actionLoading" @click="deleteAddress(address)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="showCreate" class="modal-overlay">
      <div class="modal-backdrop" @click="showCreate = false"></div>
      <div class="modal-content max-w-2xl">
        <div class="modal-header">
          <h3 class="modal-title">新增独立 IPv4 地址池</h3>
          <button class="text-themed-muted hover:text-themed" @click="showCreate = false">×</button>
        </div>
        <div class="modal-body space-y-4">
          <div class="grid md:grid-cols-2 gap-4">
            <label class="block"><span class="text-xs text-themed-muted">名称</span><input v-model="form.name" class="input w-full mt-1" placeholder="HK IPv4 Pool" /></label>
            <label class="block"><span class="text-xs text-themed-muted">CIDR（可选）</span><input v-model="form.cidr" class="input w-full mt-1" placeholder="203.0.113.0/29" /></label>
            <label class="block"><span class="text-xs text-themed-muted">网关</span><input v-model="form.gateway" class="input w-full mt-1" placeholder="203.0.113.1" /></label>
            <label class="block"><span class="text-xs text-themed-muted">前缀长度</span><input v-model.number="form.prefixLength" type="number" min="1" max="32" class="input w-full mt-1" /></label>
          </div>
          <label class="block"><span class="text-xs text-themed-muted">DNS</span><textarea v-model="form.dns" class="input w-full mt-1 min-h-20 font-mono text-sm"></textarea></label>
          <label class="block"><span class="text-xs text-themed-muted">初始地址列表</span><textarea v-model="form.addresses" class="input w-full mt-1 min-h-32 font-mono text-sm" placeholder="每行一个 IPv4 地址"></textarea></label>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="showCreate = false">取消</button>
          <button class="btn-primary" :disabled="actionLoading === 'create'" @click="createPool">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>
