<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import api from '@/api'
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import VipLevelRulesEditor from '@/components/admin/VipLevelRulesEditor.vue'
import VipBenefitHallSettings from '@/components/admin/VipBenefitHallSettings.vue'
import { useToast } from '@/stores/toast'
import { useThemeStore } from '@/stores/theme'
import { useAuthStore } from '@/stores/auth'
import { normalizeCountryName } from '@/utils/countryDisplay'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()
const themeStore = useThemeStore()
const authStore = useAuthStore()
const normalizedCountryLabels = computed(() => ({
  mainlandChina: t('common.countries.cn'),
  hongKong: t('common.countries.hk'),
  macau: t('common.countries.mo'),
  taiwan: t('common.countries.tw')
}))

// Tab 切换
const activeTab = ref('users')

// 用户数据
const USER_SEARCH_FIELDS = ['username', 'id', 'email']
const USER_SEARCH_FIELD_OPTIONS = [
  { value: 'username', label: 'admin.users.searchFieldUsername' },
  { value: 'id', label: 'admin.users.searchFieldId' },
  { value: 'email', label: 'admin.users.searchFieldEmail' }
]
const users = ref([])
const usersLoading = ref(true)
const userSearch = ref('')
const userSearchFields = ref([...USER_SEARCH_FIELDS])
const userSearchExact = ref(false)
const userPage = ref(1)
const userPageSize = ref(100)
const userTotal = ref(0)
const userTotalPages = ref(0)

// 邀请码数据
const invites = ref([])
const invitesLoading = ref(false)
const invitesPage = ref(1)
const invitesPageSize = ref(100)
const invitesTotal = ref(0)
const invitesTotalPages = ref(1)
const inviteStatusFilter = ref('all')
const inviteStatusFilterOptions = computed(() => [
  { value: 'all', label: t('admin.users.inviteFilterAll') },
  { value: 'unused', label: t('admin.users.inviteFilterUnused') },
  { value: 'used', label: t('admin.users.inviteFilterUsed') }
])

// 生成邀请码弹窗
const showInviteModal = ref(false)
const showGenerateModal = ref(false)  // 生成前的配置弹窗
const inviteExpireDays = ref(7)  // 默认7天过期
const inviteCount = ref(1)  // 生成数量
const newInviteCode = ref('')
const newInviteCodes = ref([])  // 批量生成的邀请码
const newInviteExpiresAt = ref('')
const inviteGenerating = ref(false)
const copied = ref(false)

// 重置密码弹窗
const showResetPasswordModal = ref(false)
const showResetPasswordResultModal = ref(false)
const resetPasswordUser = ref(null)
const generatedPassword = ref('')
const resetPasswordLoading = ref(false)
const passwordCopied = ref(false)

// 取消2FA弹窗
const showDisable2FAModal = ref(false)
const disable2FAUser = ref(null)
const disable2FALoading = ref(false)

// 解绑GitHub弹窗
const showUnbindGitHubModal = ref(false)
const unbindGitHubUser = ref(null)
const unbindGitHubLoading = ref(false)

// 登录记录弹窗
const showLoginRecordsModal = ref(false)
const loginRecordsUser = ref(null)
const loginRecords = ref([])
const loginRecordsLoading = ref(false)
const loginRecordsPage = ref(1)
const loginRecordsPageSize = ref(100)
const loginRecordsTotal = ref(0)
const loginRecordsTotalPages = ref(1)

// 发送站内信弹窗
const showSendMessageModal = ref(false)
const sendMessageUser = ref(null)
const sendMessageForm = ref({ title: '', content: '' })
const sendMessageLoading = ref(false)

// 用户余额详情弹窗（包含余额、明细、充值记录、调整余额）
const showBalanceModal = ref(false)
const balanceUser = ref(null)
const balanceTab = ref('overview')  // 'overview' | 'logs' | 'recharge' | 'adjust'
const balanceInfo = ref({ balance: 0, totalRecharge: 0, totalConsume: 0 })
const balanceInfoLoading = ref(false)
const balanceLogs = ref([])
const balanceLogsLoading = ref(false)
const balanceLogsPage = ref(1)
const balanceLogsPageSize = ref(100)
const balanceLogsTotal = ref(0)
const balanceLogsTotalPages = ref(1)
const balanceLogsShowLotteryGiftOnly = ref(false) // 抽奖赠送筛选
const rechargeRecords = ref([])
const rechargeRecordsLoading = ref(false)
const rechargeRecordsPage = ref(1)
const rechargeRecordsPageSize = ref(100)
const rechargeRecordsTotal = ref(0)
const rechargeRecordsTotalPages = ref(1)
const adjustBalanceForm = ref({
  type: 'add',  // 'add' | 'deduct'
  amount: '',
  reason: ''
})
const adjustBalanceLoading = ref(false)

// 用户积分调整弹窗
const showPointsModal = ref(false)
const pointsUser = ref(null)
const adjustPointsForm = ref({
  amount: '',
  reason: ''
})
const adjustPointsLoading = ref(false)

// 托管余额弹窗
const showHostingBalanceModal = ref(false)
const hostingBalanceUser = ref(null)
const hostingBalanceTab = ref('overview')  // 'overview' | 'logs' | 'adjust'
const hostingBalanceInfo = ref({ available: 0, frozen: 0 })
const hostingBalanceInfoLoading = ref(false)
const hostingBalanceLogs = ref([])
const hostingBalanceLogsLoading = ref(false)
const hostingBalanceLogsPage = ref(1)
const hostingBalanceLogsPageSize = ref(50)
const hostingBalanceLogsTotal = ref(0)
const hostingBalanceLogsTotalPages = ref(1)
const adjustHostingBalanceForm = ref({
  type: 'available',  // 'available' | 'frozen'
  operation: 'add',   // 'add' | 'deduct'
  amount: '',
  reason: ''
})
const adjustHostingBalanceLoading = ref(false)

// 关联账号检测
const linkedAccountsData = ref(null)
const linkedAccountsLoading = ref(false)
const linkedAccountsDays = ref(90)
const linkedAccountsExpandedIP = ref(new Set())
const linkedAccountsExpandedEmail = ref(new Set())
const linkedAccountsExpandedUsername = ref(new Set())

// 计算注册链接
const registerLink = computed(() => {
  return `${window.location.origin}/register/${newInviteCode.value}`
})
const normalizedUserSearchFields = computed(() => {
  return USER_SEARCH_FIELDS.filter(field => userSearchFields.value.includes(field))
})

onMounted(async () => {
  await loadUsers()
})

// 搜索防抖
let searchTimer = null
watch([userSearch, userSearchExact, () => normalizedUserSearchFields.value.join(',')], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    userPage.value = 1
    loadUsers()
  }, 300)
})

async function loadUsers() {
  usersLoading.value = true
  try {
    const response = await api.users.list({
      page: userPage.value,
      pageSize: userPageSize.value,
      search: userSearch.value,
      searchFields: normalizedUserSearchFields.value.join(','),
      exact: userSearchExact.value
    })
    users.value = response.users || []
    userTotal.value = response.total || 0
    userTotalPages.value = response.totalPages || 1
  } catch (err) {
    toast.error(t('admin.users.loadFailed') + ': ' + err.message)
  } finally {
    usersLoading.value = false
  }
}

async function loadInvites() {
  invitesLoading.value = true
  try {
    const response = await api.auth.getInvites({
      page: invitesPage.value,
      pageSize: invitesPageSize.value,
      ...(inviteStatusFilter.value !== 'all' ? { status: inviteStatusFilter.value } : {})
    })
    invites.value = response.invites || []
    invitesTotal.value = response.total || 0
    invitesTotalPages.value = response.totalPages || 1
    if (invitesPage.value > invitesTotalPages.value && invitesTotalPages.value > 0) {
      invitesPage.value = invitesTotalPages.value
      await loadInvites()
    }
  } finally {
    invitesLoading.value = false
  }
}

function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'invites' && invites.value.length === 0) {
    loadInvites()
  }
  if (tab === 'linkedAccounts' && !linkedAccountsData.value) {
    loadLinkedAccounts()
  }
}

function openGenerateModal() {
  inviteExpireDays.value = 7
  inviteCount.value = 1
  showGenerateModal.value = true
}

async function generateInvite() {
  inviteGenerating.value = true
  try {
    // 构建请求参数
    const payload = {
      ...(inviteExpireDays.value > 0 ? { expiresInDays: inviteExpireDays.value } : {}),
      count: inviteCount.value
    }
    const response = await api.auth.generateInvite(payload)
    
    // 处理单个或批量返回
    if (response.codes) {
      newInviteCodes.value = response.codes
      newInviteCode.value = ''
    } else {
      newInviteCode.value = response.code
      newInviteCodes.value = []
    }
    newInviteExpiresAt.value = response.expiresAt
    
    showGenerateModal.value = false
    showInviteModal.value = true
    if (activeTab.value === 'invites') {
      loadInvites()
    }
  } catch (err) {
    toast.error(t('admin.users.generateFailed') + ': ' + err.message)
  } finally {
    inviteGenerating.value = false
  }
}

async function deleteInvite(invite) {
  if (!confirm(t('admin.users.confirmDeleteInvite', { code: invite.code }))) return
  
  try {
    await api.auth.deleteInvite(invite.id)
    if (invites.value.length === 1 && invitesPage.value > 1) {
      invitesPage.value = invitesPage.value - 1
    }
    await loadInvites()
    toast.success(t('admin.users.inviteDeleted'))
  } catch (err) {
    toast.error(t('admin.users.deleteFailed') + ': ' + err.message)
  }
}

async function copyCode() {
  // 获取要复制的内容
  const textToCopy = newInviteCodes.value.length > 0 
    ? newInviteCodes.value.join('\n')
    : newInviteCode.value
  
  try {
    await navigator.clipboard.writeText(textToCopy)
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  } catch {
    const input = document.createElement('textarea')
    input.value = textToCopy
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  }
}

function copyLink() {
  navigator.clipboard.writeText(registerLink.value).then(() => {
    copied.value = true
    setTimeout(() => copied.value = false, 2000)
  })
}

// 切换用户状态（封禁/解封）
async function toggleUserStatus(user) {
  const newStatus = user.status === 'active' ? 'banned' : 'active'
  
  const confirmMsg = newStatus === 'banned' 
    ? t('admin.users.confirmBan', { name: user.username })
    : t('admin.users.confirmUnban', { name: user.username })
  
  if (!confirm(confirmMsg)) return

  try {
    await api.users.updateStatus(user.id, newStatus)
    // 立即更新本地状态，提供即时反馈
    const idx = users.value.findIndex(u => u.id === user.id)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], status: newStatus }
    }
    toast.success(newStatus === 'banned' ? t('admin.users.userBanned') : t('admin.users.userUnbanned'))
  } catch (err) {
    toast.error(err.message)
    // 失败时重新加载以恢复正确状态
    await loadUsers()
  }
}

// 切换用户管理员角色
async function toggleUserRole(user) {
  const newRole = user.role === 'admin' ? 'user' : 'admin'

  if (newRole === 'admin' && user.status !== 'active') {
    toast.error(t('admin.users.onlyActiveCanBeAdmin'))
    return
  }

  const confirmMsg = newRole === 'admin'
    ? t('admin.users.confirmPromoteAdmin', { name: user.username })
    : t('admin.users.confirmDemoteAdmin', { name: user.username })

  if (!confirm(confirmMsg)) return

  try {
    await api.users.updateRole(user.id, newRole)
    const idx = users.value.findIndex(u => u.id === user.id)
    if (idx !== -1) {
      users.value[idx] = { ...users.value[idx], role: newRole }
    }
    toast.success(newRole === 'admin' ? t('admin.users.userPromotedAdmin') : t('admin.users.userDemotedAdmin'))
  } catch (err) {
    toast.error(err.details || err.message)
    await loadUsers()
  }
}

// 查看用户实例
function viewUserInstances(user) {
  router.push({ path: '/instances', query: { userId: user.id } })
}

// 打开重置密码确认弹窗
function openResetPasswordModal(user) {
  resetPasswordUser.value = user
  showResetPasswordModal.value = true
}

// 重置密码（自动生成）
async function resetPassword() {
  resetPasswordLoading.value = true
  
  try {
    const result = await api.users.resetPassword(resetPasswordUser.value.id)
    generatedPassword.value = result.newPassword
    showResetPasswordModal.value = false
    showResetPasswordResultModal.value = true
    passwordCopied.value = false
  } catch (err) {
    toast.error(err.message)
  } finally {
    resetPasswordLoading.value = false
  }
}

// 复制生成的密码
async function copyGeneratedPassword() {
  try {
    await navigator.clipboard.writeText(generatedPassword.value)
    passwordCopied.value = true
    setTimeout(() => passwordCopied.value = false, 2000)
  } catch {
    // 降级方案
    const input = document.createElement('textarea')
    input.value = generatedPassword.value
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    passwordCopied.value = true
    setTimeout(() => passwordCopied.value = false, 2000)
  }
}

// 打开取消2FA弹窗
function openDisable2FAModal(user) {
  disable2FAUser.value = user
  showDisable2FAModal.value = true
}

// 取消2FA
async function disable2FA() {
  disable2FALoading.value = true
  
  try {
    await api.users.disable2FA(disable2FAUser.value.id)
    showDisable2FAModal.value = false
    toast.success(t('admin.users.twoFADisabled'))
    await loadUsers()
  } catch (err) {
    toast.error(err.message)
  } finally {
    disable2FALoading.value = false
  }
}

// 打开解绑GitHub弹窗
function openUnbindGitHubModal(user) {
  unbindGitHubUser.value = user
  showUnbindGitHubModal.value = true
}

// 解绑GitHub
async function unbindGitHub() {
  unbindGitHubLoading.value = true
  
  try {
    await api.users.unbindOAuth(unbindGitHubUser.value.id, 'github')
    showUnbindGitHubModal.value = false
    toast.success(t('admin.users.githubUnbound'))
    await loadUsers()
  } catch (err) {
    toast.error(err.message)
  } finally {
    unbindGitHubLoading.value = false
  }
}

// 打开登录记录弹窗
async function openLoginRecordsModal(user) {
  loginRecordsUser.value = user
  loginRecordsPage.value = 1
  loginRecords.value = []
  showLoginRecordsModal.value = true
  await loadLoginRecords()
}

// 加载登录记录
async function loadLoginRecords() {
  if (!loginRecordsUser.value) return
  
  loginRecordsLoading.value = true
  try {
    const response = await api.users.getLoginRecords(loginRecordsUser.value.id, {
      page: loginRecordsPage.value,
      pageSize: loginRecordsPageSize.value
    })
    loginRecords.value = response.records || []
    loginRecordsTotal.value = response.total || 0
    loginRecordsTotalPages.value = response.totalPages || 1
  } catch (err) {
    toast.error(t('admin.users.loadLoginRecordsFailed') + ': ' + err.message)
  } finally {
    loginRecordsLoading.value = false
  }
}

// 加载关联账号检测数据
async function loadLinkedAccounts() {
  linkedAccountsLoading.value = true
  try {
    const response = await api.users.detectLinkedAccounts(linkedAccountsDays.value)
    linkedAccountsData.value = response
    // 重置展开状态
    linkedAccountsExpandedIP.value = new Set()
    linkedAccountsExpandedEmail.value = new Set()
    linkedAccountsExpandedUsername.value = new Set()
  } catch (err) {
    toast.error(t('admin.users.loadLinkedAccountsFailed') + ': ' + err.message)
  } finally {
    linkedAccountsLoading.value = false
  }
}

// 切换IP组展开状态
function toggleIPGroup(ip) {
  if (linkedAccountsExpandedIP.value.has(ip)) {
    linkedAccountsExpandedIP.value.delete(ip)
  } else {
    linkedAccountsExpandedIP.value.add(ip)
  }
}

// 切换邮箱组展开状态
function toggleEmailGroup(pattern) {
  if (linkedAccountsExpandedEmail.value.has(pattern)) {
    linkedAccountsExpandedEmail.value.delete(pattern)
  } else {
    linkedAccountsExpandedEmail.value.add(pattern)
  }
}

// 切换用户名组展开状态
function toggleUsernameGroup(pattern) {
  if (linkedAccountsExpandedUsername.value.has(pattern)) {
    linkedAccountsExpandedUsername.value.delete(pattern)
  } else {
    linkedAccountsExpandedUsername.value.add(pattern)
  }
}

// 打开发送站内信弹窗
function openSendMessageModal(user) {
  sendMessageUser.value = user
  sendMessageForm.value = { title: '', content: '' }
  showSendMessageModal.value = true
}

// 发送站内信
async function sendMessage() {
  if (!sendMessageUser.value) return
  
  if (!sendMessageForm.value.title.trim()) {
    toast.error(t('admin.users.messageTitleRequired'))
    return
  }
  if (!sendMessageForm.value.content.trim()) {
    toast.error(t('admin.users.messageContentRequired'))
    return
  }

  sendMessageLoading.value = true
  try {
    await api.inbox.sendToUser(sendMessageUser.value.id, {
      title: sendMessageForm.value.title.trim(),
      content: sendMessageForm.value.content.trim()
    })
    toast.success(t('admin.users.messageSent'))
    showSendMessageModal.value = false
    sendMessageForm.value = { title: '', content: '' }
    sendMessageUser.value = null
  } catch (err) {
    toast.error(t('admin.users.messageSendFailed') + ': ' + err.message)
  } finally {
    sendMessageLoading.value = false
  }
}

// 打开用户余额详情弹窗
async function openBalanceModal(user) {
  balanceUser.value = user
  balanceTab.value = 'overview'
  balanceInfo.value = { balance: user.balance || 0, totalRecharge: 0, totalConsume: 0 }
  balanceLogs.value = []
  balanceLogsPage.value = 1
  balanceLogsShowLotteryGiftOnly.value = false // 重置抽奖筛选状态
  rechargeRecords.value = []
  rechargeRecordsPage.value = 1
  adjustBalanceForm.value = { type: 'add', amount: '', reason: '' }
  showBalanceModal.value = true
  await loadBalanceInfo()
}

// 加载用户余额信息
async function loadBalanceInfo() {
  if (!balanceUser.value) return
  balanceInfoLoading.value = true
  try {
    const res = await api.admin.getUserBalance(balanceUser.value.id)
    balanceInfo.value = {
      balance: res.balance,
      totalRecharge: res.totalRecharge,
      totalConsume: res.totalConsume
    }
  } catch (err) {
    toast.error(t('admin.users.loadBalanceFailed') + ': ' + err.message)
  } finally {
    balanceInfoLoading.value = false
  }
}

// 加载余额明细
async function loadBalanceLogs() {
  if (!balanceUser.value) return
  balanceLogsLoading.value = true
  try {
    const res = await api.admin.getUserBalanceLogs(balanceUser.value.id, {
      page: balanceLogsPage.value,
      pageSize: balanceLogsPageSize.value,
      lotteryGift: balanceLogsShowLotteryGiftOnly.value ? 'only' : 'exclude'
    })
    balanceLogs.value = res.logs || []
    balanceLogsTotal.value = res.total || 0
    balanceLogsTotalPages.value = Math.ceil(res.total / balanceLogsPageSize.value) || 1
  } catch (err) {
    toast.error(t('admin.users.loadBalanceLogsFailed') + ': ' + err.message)
  } finally {
    balanceLogsLoading.value = false
  }
}

// 加载充值记录
async function loadRechargeRecords() {
  if (!balanceUser.value) return
  rechargeRecordsLoading.value = true
  try {
    const res = await api.admin.getRechargeOrders({
      page: rechargeRecordsPage.value,
      pageSize: rechargeRecordsPageSize.value,
      userId: balanceUser.value.id
    })
    rechargeRecords.value = res.records || []
    rechargeRecordsTotal.value = res.total || 0
    rechargeRecordsTotalPages.value = Math.ceil(res.total / rechargeRecordsPageSize.value) || 1
  } catch (err) {
    toast.error(t('admin.users.loadRechargeRecordsFailed') + ': ' + err.message)
  } finally {
    rechargeRecordsLoading.value = false
  }
}

// 切换余额弹窗TAB
function switchBalanceTab(tab) {
  balanceTab.value = tab
  if (tab === 'logs' && balanceLogs.value.length === 0) {
    loadBalanceLogs()
  } else if (tab === 'recharge' && rechargeRecords.value.length === 0) {
    loadRechargeRecords()
  }
}

// 提交调整余额
async function submitAdjustBalance() {
  if (!balanceUser.value) return

  const amount = parseFloat(adjustBalanceForm.value.amount)
  if (isNaN(amount) || amount <= 0) {
    toast.error(t('admin.users.invalidAmount'))
    return
  }

  if (!adjustBalanceForm.value.reason.trim()) {
    toast.error(t('admin.users.reasonRequired'))
    return
  }

  // 根据类型计算实际金额
  const finalAmount = adjustBalanceForm.value.type === 'add' ? amount : -amount

  adjustBalanceLoading.value = true
  try {
    await api.admin.adjustUserBalance(
      balanceUser.value.id,
      finalAmount,
      adjustBalanceForm.value.reason.trim()
    )
    toast.success(t('admin.users.balanceAdjusted'))
    adjustBalanceForm.value = { type: 'add', amount: '', reason: '' }
    // 刷新余额信息和明细
    await loadBalanceInfo()
    if (balanceLogs.value.length > 0) {
      await loadBalanceLogs()
    }
    // 刷新用户列表
    await loadUsers()
    // 切换到概览TAB
    balanceTab.value = 'overview'
  } catch (err) {
    toast.error(t('admin.users.balanceAdjustFailed') + ': ' + err.message)
  } finally {
    adjustBalanceLoading.value = false
  }
}

// 打开积分调整弹窗
function openPointsModal(user) {
  pointsUser.value = user
  adjustPointsForm.value = { amount: '', reason: '' }
  showPointsModal.value = true
}

// 提交调整积分
async function submitAdjustPoints() {
  if (!pointsUser.value) return

  const amount = parseInt(adjustPointsForm.value.amount)
  if (isNaN(amount) || amount === 0) {
    toast.error(t('admin.users.invalidPointsAmount'))
    return
  }

  if (!adjustPointsForm.value.reason.trim()) {
    toast.error(t('admin.users.reasonRequired'))
    return
  }

  adjustPointsLoading.value = true
  try {
    await api.entertainment.adminAdjustPoints(
      pointsUser.value.id,
      amount,
      adjustPointsForm.value.reason.trim()
    )
    toast.success(t('admin.users.pointsAdjusted'))
    showPointsModal.value = false
    // 刷新用户列表
    await loadUsers()
  } catch (err) {
    toast.error(t('admin.users.pointsAdjustFailed') + ': ' + err.message)
  } finally {
    adjustPointsLoading.value = false
  }
}

// 打开托管余额弹窗
async function openHostingBalanceModal(user) {
  hostingBalanceUser.value = user
  hostingBalanceTab.value = 'overview'
  hostingBalanceInfo.value = { 
    available: user.hostingBalance || 0, 
    frozen: user.hostingBalanceFrozen || 0 
  }
  hostingBalanceLogs.value = []
  adjustHostingBalanceForm.value = { type: 'available', operation: 'add', amount: '', reason: '' }
  showHostingBalanceModal.value = true
  // 加载详细信息
  await loadHostingBalanceInfo()
}

// 加载托管余额详情
async function loadHostingBalanceInfo() {
  if (!hostingBalanceUser.value) return
  hostingBalanceInfoLoading.value = true
  try {
    const res = await api.admin.getHostingBalanceLogs(hostingBalanceUser.value.id, { page: 1, pageSize: 1 })
    hostingBalanceInfo.value = {
      available: res.available,
      frozen: res.frozen
    }
  } catch (err) {
    console.error('Failed to load hosting balance info:', err)
  } finally {
    hostingBalanceInfoLoading.value = false
  }
}

// 加载托管余额明细
async function loadHostingBalanceLogs() {
  if (!hostingBalanceUser.value) return
  hostingBalanceLogsLoading.value = true
  try {
    const res = await api.admin.getHostingBalanceLogs(hostingBalanceUser.value.id, {
      page: hostingBalanceLogsPage.value,
      pageSize: hostingBalanceLogsPageSize.value
    })
    hostingBalanceLogs.value = res.logs
    hostingBalanceLogsTotal.value = res.total
    hostingBalanceLogsTotalPages.value = res.totalPages
    // 同步更新余额信息
    hostingBalanceInfo.value = {
      available: res.available,
      frozen: res.frozen
    }
  } catch (err) {
    toast.error(t('admin.users.loadHostingLogsFailed') + ': ' + err.message)
  } finally {
    hostingBalanceLogsLoading.value = false
  }
}

// 切换托管余额弹窗TAB
function switchHostingBalanceTab(tab) {
  hostingBalanceTab.value = tab
  if (tab === 'logs' && hostingBalanceLogs.value.length === 0) {
    hostingBalanceLogsPage.value = 1
    loadHostingBalanceLogs()
  }
}

// 托管余额明细翻页
function changeHostingBalanceLogsPage(page) {
  hostingBalanceLogsPage.value = page
  loadHostingBalanceLogs()
}

// 提交调整托管余额
async function submitAdjustHostingBalance() {
  if (!hostingBalanceUser.value) return

  const amount = parseFloat(adjustHostingBalanceForm.value.amount)
  if (isNaN(amount) || amount <= 0) {
    toast.error(t('admin.users.invalidAmount'))
    return
  }

  if (!adjustHostingBalanceForm.value.reason.trim()) {
    toast.error(t('admin.users.reasonRequired'))
    return
  }

  // 根据操作类型计算实际金额
  const finalAmount = adjustHostingBalanceForm.value.operation === 'add' ? amount : -amount

  adjustHostingBalanceLoading.value = true
  try {
    const res = await api.admin.adjustHostingBalance(
      hostingBalanceUser.value.id,
      adjustHostingBalanceForm.value.type,
      finalAmount,
      adjustHostingBalanceForm.value.reason.trim()
    )
    toast.success(t('admin.users.hostingBalanceAdjusted'))
    // 更新显示
    hostingBalanceInfo.value = {
      available: res.available,
      frozen: res.frozen
    }
    // 重置表单
    adjustHostingBalanceForm.value = { type: 'available', operation: 'add', amount: '', reason: '' }
    // 刷新明细
    if (hostingBalanceLogs.value.length > 0) {
      await loadHostingBalanceLogs()
    }
    // 刷新用户列表
    await loadUsers()
    // 切换到概览TAB
    hostingBalanceTab.value = 'overview'
  } catch (err) {
    toast.error(t('admin.users.hostingBalanceAdjustFailed') + ': ' + err.message)
  } finally {
    adjustHostingBalanceLoading.value = false
  }
}

// 获取托管余额记录类型标签
function getHostingLogTypeLabel(type, actionType) {
  if (actionType === 'admin_adjust') return t('admin.users.hostingLogType.admin_adjust')
  const labels = {
    income: t('admin.users.hostingLogType.income'),
    deduction: t('admin.users.hostingLogType.deduction'),
    unfreeze: t('admin.users.hostingLogType.unfreeze'),
    withdraw: t('admin.users.hostingLogType.withdraw')
  }
  return labels[type] || type
}

// 获取余额记录类型标签
function getBalanceLogTypeLabel(type) {
  const labels = {
    recharge: t('admin.users.balanceType.recharge'),
    consume: t('admin.users.balanceType.consume'),
    refund: t('admin.users.balanceType.refund'),
    admin_adjust: t('admin.users.balanceType.admin_adjust'),
    gift: t('admin.users.balanceType.gift'),
    transfer_fee: t('admin.users.balanceType.transfer_fee'),
    transfer_refund: t('admin.users.balanceType.transfer_refund')
  }
  return labels[type] || type
}

// 获取充值记录状态样式
function getRechargeStatusStyle(status) {
  const styles = {
    completed: 'badge-success',
    pending: 'badge-warning',
    failed: 'badge-error',
    cancelled: 'badge-default',
    expired: 'badge-default'
  }
  return styles[status] || 'badge-default'
}

function formatLocation(record) {
  const parts = [
    normalizeCountryName(record.country, normalizedCountryLabels.value),
    record.region,
    record.city
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '-'
}

// 解析 User-Agent 获取设备信息
function formatDevice(userAgent) {
  if (!userAgent) return '-'
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Mac OS')) return 'macOS'
  if (userAgent.includes('Linux') && !userAgent.includes('Android')) return 'Linux'
  if (userAgent.includes('Android')) return 'Android'
  if (userAgent.includes('iPhone')) return 'iPhone'
  if (userAgent.includes('iPad')) return 'iPad'
  return '-'
}

// 解析 User-Agent 获取浏览器信息
function formatBrowser(userAgent) {
  if (!userAgent) return '-'
  if (userAgent.includes('Edg')) return 'Edge'
  if (userAgent.includes('Chrome')) return 'Chrome'
  if (userAgent.includes('Firefox')) return 'Firefox'
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari'
  if (userAgent.includes('Opera') || userAgent.includes('OPR')) return 'Opera'
  return '-'
}

function handleUserPageSizeChange() {
  userPage.value = 1
  loadUsers()
}

function handleInvitesPageSizeChange() {
  invitesPage.value = 1
  loadInvites()
}

function handleInviteStatusFilterChange(status) {
  if (inviteStatusFilter.value === status) return
  inviteStatusFilter.value = status
  invitesPage.value = 1
  loadInvites()
}

function getInviteStatus(invite) {
  if (invite.used_by || invite.usedBy) {
    return { label: t('admin.users.inviteUsed'), class: 'badge-success' }
  }
  if (invite.expires_at || invite.expiresAt) {
    const expiry = new Date(invite.expires_at || invite.expiresAt)
    if (expiry < new Date()) {
      return { label: t('admin.users.inviteExpired'), class: 'badge-error' }
    }
  }
  return { label: t('admin.users.inviteUnused'), class: 'badge-warning' }
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatRegisteredAge(createdAt) {
  if (!createdAt) return '-'
  const createdDate = new Date(createdAt)
  if (Number.isNaN(createdDate.getTime())) return '-'

  const today = new Date()
  const msPerDay = 24 * 60 * 60 * 1000
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / msPerDay
  const createdDay = Date.UTC(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate()) / msPerDay
  const days = Math.max(0, Math.floor(todayDay - createdDay))

  return days === 0
    ? t('admin.users.registeredNew')
    : t('admin.users.registeredDays', { days })
}

function _formatMemory(mb) {
  if (!mb) return '0'
  if (mb >= 1024) return (mb / 1024).toFixed(0) + ' GB'
  return mb + ' MB'
}

function _getQuotaPercent(used, limit) {
  if (!limit) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}
</script>

<template>
  <div class="space-y-6 animate-fade-in">
    <!-- 页面头部 -->
    <div class="page-header flex-col sm:flex-row gap-4 sm:gap-0">
      <div>
        <h1 class="page-title">{{ t('admin.users.title') }}</h1>
        <p class="page-description">{{ t('admin.users.description') }}</p>
      </div>
      <button class="btn-primary w-full sm:w-auto justify-center" @click="openGenerateModal">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        {{ t('admin.users.generateInvite') }}
      </button>
    </div>

    <!-- Tab 切换 -->
    <div class="border-b border-themed overflow-x-auto">
      <nav class="flex flex-nowrap gap-3 sm:gap-4 md:gap-6 min-w-max">
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0',
            activeTab === 'users'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="switchTab('users')"
        >
          {{ t('nav.users') }}
          <span class="ml-1.5 px-1.5 py-0.5 text-xs rounded count-badge">
            {{ userTotal }}
          </span>
        </button>
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0',
            activeTab === 'invites'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="switchTab('invites')"
        >
          {{ t('admin.users.invites') }}
          <span v-if="invitesTotal" class="ml-1.5 px-1.5 py-0.5 text-xs rounded count-badge">
            {{ invitesTotal }}
          </span>
        </button>
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0',
            activeTab === 'linkedAccounts'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="switchTab('linkedAccounts')"
        >
          {{ t('admin.users.linkedAccounts') }}
        </button>
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0',
            activeTab === 'userVipLevels'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="switchTab('userVipLevels')"
        >
          {{ t('admin.users.userVipLevels') }}
        </button>
        <button
          :class="[
            'pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0',
            activeTab === 'vipBenefits'
              ? (themeStore.isDark ? 'border-white text-white' : 'border-gray-900 text-gray-900')
              : 'border-transparent text-themed-muted hover:text-themed-secondary'
          ]"
          @click="switchTab('vipBenefits')"
        >
          {{ t('admin.users.vipBenefits') }}
        </button>
      </nav>
    </div>

    <!-- 用户列表 -->
    <div v-if="activeTab === 'users'" class="space-y-4">
      <!-- 搜索栏 -->
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="relative w-full xl:max-w-sm">
          <input 
            v-model="userSearch" 
            type="text" 
            :placeholder="t('admin.users.searchPlaceholder')" 
            class="input pl-9 w-full"
          />
          <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 icon-themed" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm text-themed-secondary whitespace-nowrap">{{ t('admin.users.searchRange') }}</span>
            <label
              v-for="field in USER_SEARCH_FIELD_OPTIONS"
              :key="field.value"
              class="inline-flex items-center gap-2 text-sm text-themed-secondary whitespace-nowrap cursor-pointer select-none"
            >
              <input
                v-model="userSearchFields"
                :value="field.value"
                type="checkbox"
                class="h-4 w-4 shrink-0 rounded border accent-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                :class="themeStore.isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'"
                :disabled="normalizedUserSearchFields.length === 1 && normalizedUserSearchFields.includes(field.value)"
              />
              <span>{{ t(field.label) }}</span>
            </label>
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-themed-secondary whitespace-nowrap cursor-pointer select-none">
            <input
              v-model="userSearchExact"
              type="checkbox"
              class="h-4 w-4 shrink-0 rounded border accent-accent focus:ring-2 focus:ring-accent/20"
              :class="themeStore.isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'"
            />
            <span>{{ t('admin.users.exactMatch') }}</span>
          </label>
        </div>
      </div>

      <SkeletonLoader v-if="usersLoading" type="list" />
      
      <div v-else-if="users.length === 0" class="card p-8 text-center text-themed-muted text-sm">
        {{ userSearch ? t('admin.users.noMatchingUsers') : t('admin.users.noUsers') }}
      </div>
      
      <!-- 用户表格 -->
      <div v-else class="card overflow-x-auto">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[800px]">
            <thead class="bg-themed-tertiary border-b border-themed">
              <tr>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">ID</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.userInfo') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.role') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.status') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.balance') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.points') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.hostingBalance') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.allInstances') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.userActivity') }}</th>
                <th class="text-right text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-themed">
              <tr v-for="user in users" :key="user.id" class="hover:bg-themed-hover transition-colors">
                <!-- 用户 ID -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span class="text-sm font-mono text-themed-muted">#{{ user.id }}</span>
                </td>
                <!-- 用户信息 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex items-center gap-3">
                    <UserAvatar 
                      :username="user.username" 
                      :email="user.email"
                      :avatar-style="user.avatarStyle || 'bigSmile'"
                      :badge-id="user.avatarBadgeId || null"
                      :size="36"
                    />
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-themed truncate">{{ user.username }}</div>
                      <div class="text-xs text-themed-muted truncate">{{ user.email || t('admin.users.noEmail') }}</div>
                    </div>
                  </div>
                </td>
                <!-- 角色 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span :class="['badge whitespace-nowrap', user.role === 'admin' ? 'badge-default' : 'badge-default']">
                    {{ user.role === 'admin' ? t('admin.users.admin') : t('admin.users.user') }}
                  </span>
                </td>
                <!-- 状态 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span :class="['badge whitespace-nowrap', user.status === 'active' ? 'badge-success' : 'badge-error']">
                    {{ user.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}
                  </span>
                </td>
                <!-- 余额 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex flex-col gap-0.5">
                    <button 
                      class="text-sm font-medium hover:text-primary transition-colors text-left"
                      :class="user.balance > 0 ? 'text-success' : 'text-themed-muted'"
                      :title="t('admin.users.viewBalance')"
                      @click="openBalanceModal(user)"
                    >
                      ¥{{ (user.balance || 0).toFixed(2) }}
                    </button>
                    <span 
                      v-if="user.totalConsume > 0" 
                      class="text-xs text-themed-muted"
                      :title="t('admin.users.totalConsumed')"
                    >
                      {{ t('admin.users.consumed') }} ¥{{ (user.totalConsume || 0).toFixed(2) }}
                    </span>
                  </div>
                </td>
                <!-- 积分 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex flex-col gap-0.5">
                    <button 
                      class="text-sm font-medium hover:text-primary transition-colors text-left"
                      :class="user.points > 0 ? 'text-amber-500' : 'text-themed-muted'"
                      :title="t('admin.users.adjustPoints')"
                      @click="openPointsModal(user)"
                    >
                      {{ user.points || 0 }}
                    </button>
                    <span 
                      v-if="(user.totalEarnedPoints - user.points) > 0" 
                      class="text-xs text-themed-muted"
                      :title="t('admin.users.spentPoints')"
                    >
                      {{ t('admin.users.spent') }} {{ user.totalEarnedPoints - user.points }}
                    </span>
                  </div>
                </td>
                <!-- 托管余额 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="flex flex-col gap-0.5">
                    <button 
                      class="text-sm font-medium hover:text-primary transition-colors text-left"
                      :class="user.hostingBalance > 0 ? 'text-success' : 'text-themed-muted'"
                      :title="t('admin.users.viewHostingBalance')"
                      @click="openHostingBalanceModal(user)"
                    >
                      ¥{{ (user.hostingBalance || 0).toFixed(2) }}
                    </button>
                    <span 
                      v-if="user.hostingBalanceFrozen > 0" 
                      class="text-xs text-themed-muted"
                      :title="t('admin.users.frozenHostingBalance')"
                    >
                      {{ t('admin.users.frozen') }} ¥{{ (user.hostingBalanceFrozen || 0).toFixed(2) }}
                    </span>
                  </div>
                </td>
                <!-- 所有实例 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div v-if="user.quota" class="flex items-center gap-1.5">
                    <span class="text-sm text-themed-secondary">{{ user.instanceCount || 0 }} {{ t('admin.users.instances') }}</span>
                    <button 
                      v-if="user.instanceCount > 0"
                      class="btn-ghost btn-xs p-1 text-themed-muted hover:text-themed"
                      :title="t('admin.users.viewInstances')"
                      @click="viewUserInstances(user)"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </button>
                  </div>
                  <span v-else class="text-sm text-themed-muted">-</span>
                </td>
                <!-- 用户活动 -->
                <td class="px-4 py-3 whitespace-nowrap align-middle">
                  <button 
                    v-if="user.lastLogin"
                    class="-mx-1.5 -my-0.5 flex min-h-[40px] w-full flex-col justify-center rounded px-1.5 py-0.5 text-left transition-colors hover:bg-themed-hover"
                    :title="t('admin.users.viewLoginRecords')"
                    @click="openLoginRecordsModal(user)"
                  >
                    <div class="flex items-center gap-1.5 text-xs leading-4 text-themed-secondary">
                      <span :title="t('admin.users.createdAt') + ' ' + formatDate(user.createdAt)">
                        {{ formatRegisteredAge(user.createdAt) }}
                      </span>
                      <span class="text-themed-muted">·</span>
                      <span>{{ formatDate(user.lastLogin.createdAt) }}</span>
                    </div>
                    <div class="text-xs text-themed-muted truncate max-w-[120px]" :title="user.lastLogin.ip">
                      {{ user.lastLogin.ip }}
                    </div>
                  </button>
                  <button 
                    v-else
                    class="-mx-1.5 -my-0.5 flex min-h-[40px] w-full flex-col justify-center rounded px-1.5 py-0.5 text-left transition-colors hover:bg-themed-hover"
                    :title="t('admin.users.viewLoginRecords')"
                    @click="openLoginRecordsModal(user)"
                  >
                    <span class="text-xs leading-4 text-themed-secondary" :title="t('admin.users.createdAt') + ' ' + formatDate(user.createdAt)">
                      {{ formatRegisteredAge(user.createdAt) }}
                    </span>
                    <span class="text-xs text-themed-muted">{{ t('admin.users.noLoginRecord') }}</span>
                  </button>
                </td>
                <!-- 操作 -->
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-ghost btn-sm" :title="t('admin.users.viewInstances')" @click="viewUserInstances(user)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                      </svg>
                    </button>
                    <!-- 发送站内信 -->
                    <button 
                      v-if="user.id !== authStore.user?.id"
                      class="btn-ghost btn-sm" 
                      :title="t('admin.users.sendMessage')" 
                      @click="openSendMessageModal(user)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <!-- 重置密码 -->
                    <button class="btn-ghost btn-sm" :title="t('admin.users.resetPassword')" @click="openResetPasswordModal(user)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </button>
                    <!-- 管理员角色 -->
                    <button
                      v-if="user.id !== authStore.user?.id"
                      class="btn-ghost btn-sm"
                      :class="user.role === 'admin' ? 'text-warning' : 'text-info'"
                      :title="user.role === 'admin' ? t('admin.users.demoteAdmin') : t('admin.users.promoteAdmin')"
                      @click="toggleUserRole(user)"
                    >
                      <svg v-if="user.role === 'admin'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" />
                      </svg>
                      <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3.75l7.5 3v5.25c0 4.35-2.94 8.4-7.5 9.75-4.56-1.35-7.5-5.4-7.5-9.75V6.75l7.5-3z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 12.25l1.5 1.5 3.5-3.75" />
                      </svg>
                    </button>
                    <!-- 取消2FA -->
                    <button 
                      v-if="user.twoFAEnabled"
                      class="btn-ghost btn-sm text-warning" 
                      :title="t('admin.users.disable2FA')" 
                      @click="openDisable2FAModal(user)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </button>
                    <!-- 解绑GitHub -->
                    <button 
                      v-if="user.hasGithubBinding"
                      class="btn-ghost btn-sm text-info" 
                      :title="t('admin.users.unbindGitHub')" 
                      @click="openUnbindGitHubModal(user)"
                    >
                      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                      </svg>
                    </button>
                    <button 
                      v-if="user.role !== 'admin'"
                      class="btn-ghost btn-sm"
                      :class="user.status === 'active' ? 'text-warning' : 'text-success'"
                      :title="user.status === 'active' ? t('admin.users.ban') : t('admin.users.unban')"
                      @click="toggleUserStatus(user)"
                    >
                      <svg v-if="user.status === 'active'" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 分页 -->
      <div 
        v-if="userTotal > 0" 
        class="flex items-center justify-between px-4 py-3 border-t border-themed"
      >
        <div class="flex items-center gap-3">
          <span class="text-sm" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ t('admin.users.totalRecords', { count: userTotal }) }}
          </span>
          <select
            v-model="userPageSize"
            class="text-sm rounded-md border-0 py-1 pl-2 pr-7 ring-1 ring-inset focus:ring-2 focus:ring-primary cursor-pointer"
            :class="themeStore.isDark 
              ? 'bg-gray-800 text-gray-300 ring-gray-700' 
              : 'bg-gray-50 text-gray-700 ring-gray-200'"
            @change="handleUserPageSizeChange"
          >
            <option :value="10">10 / {{ t('common.page') }}</option>
            <option :value="30">30 / {{ t('common.page') }}</option>
            <option :value="50">50 / {{ t('common.page') }}</option>
            <option :value="100">100 / {{ t('common.page') }}</option>
          </select>
        </div>
        <div v-if="userTotalPages > 1" class="flex items-center gap-1">
          <button
            :disabled="userPage <= 1"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              userPage <= 1 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="userPage--; loadUsers()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div 
            class="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium"
            :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
          >
            <span>{{ userPage }}</span>
            <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'">/</span>
            <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ userTotalPages }}</span>
          </div>
          <button
            :disabled="userPage >= userTotalPages"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              userPage >= userTotalPages 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="userPage++; loadUsers()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 邀请码列表 -->
    <div v-if="activeTab === 'invites'" class="space-y-4">
      <div class="flex justify-end">
        <div
          class="inline-flex items-center gap-1 rounded-lg p-1"
          :class="themeStore.isDark ? 'bg-gray-800' : 'bg-gray-100'"
        >
          <button
            v-for="option in inviteStatusFilterOptions"
            :key="option.value"
            type="button"
            :disabled="invitesLoading"
            class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="inviteStatusFilter === option.value
              ? themeStore.isDark
                ? 'bg-gray-700 text-white shadow-sm'
                : 'bg-white text-gray-900 shadow-sm'
              : themeStore.isDark
                ? 'text-gray-400 hover:text-gray-200'
                : 'text-gray-600 hover:text-gray-900'"
            @click="handleInviteStatusFilterChange(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <SkeletonLoader v-if="invitesLoading" type="list" />
      
      <div v-else-if="invites.length === 0" class="card p-8 text-center text-themed-muted text-sm">
        {{ inviteStatusFilter === 'all' ? t('admin.users.noInvites') : t('admin.users.noMatchingInvites') }}
      </div>

      <div v-else class="card overflow-x-auto">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[800px]">
            <thead class="bg-themed-tertiary border-b border-themed">
              <tr>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.inviteCode') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.createdBy') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.inviteStatus') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.usedBy') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.createdAt') }}</th>
                <th class="text-left text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('admin.users.usedExpireAt') }}</th>
                <th class="text-right text-xs font-medium text-themed-muted uppercase tracking-wider px-4 py-3 whitespace-nowrap">{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-themed">
              <tr v-for="invite in invites" :key="invite.id" class="hover:bg-themed-hover">
                <td class="px-4 py-3 font-mono text-sm text-themed-secondary whitespace-nowrap">{{ invite.code }}</td>
                <td class="px-4 py-3 text-sm whitespace-nowrap">
                  <div v-if="invite.createdByUsername" class="flex items-center gap-2">
                    <UserAvatar
                      v-if="invite.createdByAvatarStyle"
                      :username="invite.createdByUsername"
                      :email="invite.createdByEmail"
                      :avatar-style="invite.createdByAvatarStyle"
                      :badge-id="invite.createdByAvatarBadgeId || null"
                      :size="24"
                    />
                    <span class="text-themed">{{ invite.createdByUsername }}</span>
                  </div>
                  <span v-else class="text-themed-muted">-</span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span :class="['badge whitespace-nowrap', getInviteStatus(invite).class]">{{ getInviteStatus(invite).label }}</span>
                </td>
                <td class="px-4 py-3 text-sm whitespace-nowrap">
                  <div v-if="invite.usedByUsername" class="flex items-center gap-2">
                    <UserAvatar
                      v-if="invite.usedByAvatarStyle"
                      :username="invite.usedByUsername"
                      :email="invite.usedByEmail"
                      :avatar-style="invite.usedByAvatarStyle"
                      :badge-id="invite.usedByAvatarBadgeId || null"
                      :size="24"
                    />
                    <span class="text-themed">{{ invite.usedByUsername }}</span>
                  </div>
                  <span v-else class="text-themed-muted">-</span>
                </td>
                <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">{{ formatDate(invite.createdAt) }}</td>
                <td class="px-4 py-3 text-sm text-themed-muted whitespace-nowrap">
                  <span v-if="invite.usedAt">{{ formatDate(invite.usedAt) }}</span>
                  <span v-else-if="invite.expiresAt">{{ formatDate(invite.expiresAt) }}</span>
                  <span v-else class="text-themed-faint">{{ t('admin.users.permanent') }}</span>
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button 
                    class="btn-ghost btn-sm text-error"
                    @click="deleteInvite(invite)"
                  >
                    {{ t('admin.users.deleteInvite') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div 
        v-if="invitesTotal > 0" 
        class="flex items-center justify-between px-4 py-3 border-t border-themed"
      >
        <div class="flex items-center gap-3">
          <span class="text-sm" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ t('admin.users.totalRecords', { count: invitesTotal }) }}
          </span>
          <select
            v-model="invitesPageSize"
            class="text-sm rounded-md border-0 py-1 pl-2 pr-7 ring-1 ring-inset focus:ring-2 focus:ring-primary cursor-pointer"
            :class="themeStore.isDark 
              ? 'bg-gray-800 text-gray-300 ring-gray-700' 
              : 'bg-gray-50 text-gray-700 ring-gray-200'"
            @change="handleInvitesPageSizeChange"
          >
            <option :value="10">10 / {{ t('common.page') }}</option>
            <option :value="30">30 / {{ t('common.page') }}</option>
            <option :value="50">50 / {{ t('common.page') }}</option>
            <option :value="100">100 / {{ t('common.page') }}</option>
          </select>
        </div>
        <div v-if="invitesTotalPages > 1" class="flex items-center gap-1">
          <button
            :disabled="invitesPage <= 1"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              invitesPage <= 1 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="invitesPage--; loadInvites()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div 
            class="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium"
            :class="themeStore.isDark ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'"
          >
            <span>{{ invitesPage }}</span>
            <span :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-400'">/</span>
            <span :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">{{ invitesTotalPages }}</span>
          </div>
          <button
            :disabled="invitesPage >= invitesTotalPages"
            class="inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-colors"
            :class="[
              invitesPage >= invitesTotalPages 
                ? 'opacity-40 cursor-not-allowed' 
                : themeStore.isDark 
                  ? 'hover:bg-gray-800 text-gray-400' 
                  : 'hover:bg-gray-100 text-gray-600'
            ]"
            @click="invitesPage++; loadInvites()"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 关联账号检测 -->
    <div v-if="activeTab === 'linkedAccounts'" class="space-y-4">
      <!-- 操作栏 -->
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <div class="flex items-center gap-3">
          <label class="text-sm text-themed-secondary whitespace-nowrap">{{ t('admin.users.detectDays') }}</label>
          <select v-model.number="linkedAccountsDays" class="input w-auto flex-1 sm:flex-none">
            <option :value="30">30 {{ t('admin.users.daysUnit') }}</option>
            <option :value="60">60 {{ t('admin.users.daysUnit') }}</option>
            <option :value="90">90 {{ t('admin.users.daysUnit') }}</option>
            <option :value="180">180 {{ t('admin.users.daysUnit') }}</option>
            <option :value="365">365 {{ t('admin.users.daysUnit') }}</option>
          </select>
        </div>
        <button 
          class="btn-primary w-full sm:w-auto justify-center" 
          :disabled="linkedAccountsLoading"
          @click="loadLinkedAccounts"
        >
          <svg v-if="linkedAccountsLoading" class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <svg v-else class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {{ linkedAccountsLoading ? t('admin.users.detecting') : t('admin.users.startDetect') }}
        </button>
      </div>

      <!-- 加载中 -->
      <div v-if="linkedAccountsLoading" class="card p-8 text-center">
        <svg class="w-8 h-8 animate-spin mx-auto text-themed-muted" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="text-sm text-themed-muted mt-3">{{ t('admin.users.detectingHint') }}</p>
      </div>

      <!-- 未检测 -->
      <div v-else-if="!linkedAccountsData" class="card p-8 text-center text-themed-muted text-sm">
        <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        {{ t('admin.users.clickToDetect') }}
      </div>

      <!-- 检测结果 -->
      <template v-else>
        <!-- 摘要信息 -->
        <div class="card p-4">
          <div class="flex flex-wrap items-center gap-4 text-sm">
            <div class="flex items-center gap-2">
              <span class="text-themed-muted">{{ t('admin.users.detectTime') }}:</span>
              <span class="text-themed-secondary">{{ formatDate(linkedAccountsData.detectedAt) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-themed-muted">{{ t('admin.users.detectDuration') }}:</span>
              <span class="text-themed-secondary">{{ linkedAccountsData.durationMs }}ms</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-themed-muted">{{ t('admin.users.detectRange') }}:</span>
              <span class="text-themed-secondary">{{ linkedAccountsData.days }} {{ t('admin.users.daysUnit') }}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-4 mt-3 pt-3 border-t border-themed">
            <div class="flex items-center gap-2">
              <span class="badge badge-warning">{{ linkedAccountsData.summary.ipGroups }}</span>
              <span class="text-sm text-themed-secondary">{{ t('admin.users.ipGroupCount') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge badge-info">{{ linkedAccountsData.summary.emailGroups }}</span>
              <span class="text-sm text-themed-secondary">{{ t('admin.users.emailGroupCount') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge badge-default">{{ linkedAccountsData.summary.usernameGroups }}</span>
              <span class="text-sm text-themed-secondary">{{ t('admin.users.usernameGroupCount') }}</span>
            </div>
          </div>
        </div>

        <!-- IP 关联组 -->
        <div v-if="linkedAccountsData.ipGroups.length > 0" class="space-y-2">
          <h3 class="text-sm font-medium text-themed flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            {{ t('admin.users.ipLinkedGroups') }} ({{ linkedAccountsData.ipGroups.length }})
          </h3>
          <div class="space-y-2">
            <div 
              v-for="group in linkedAccountsData.ipGroups" 
              :key="group.ip" 
              class="card overflow-hidden"
            >
              <button 
                class="w-full px-4 py-3 flex items-center justify-between hover:bg-themed-hover transition-colors text-left"
                @click="toggleIPGroup(group.ip)"
              >
                <div class="flex items-center gap-3">
                  <span class="font-mono text-sm text-themed">{{ group.ip }}</span>
                  <span class="badge badge-warning">{{ group.userCount }} {{ t('admin.users.usersCount') }}</span>
                  <span class="text-xs text-themed-muted">{{ group.totalLogins }} {{ t('admin.users.loginsCount') }}</span>
                </div>
                <svg 
                  class="w-4 h-4 text-themed-muted transition-transform" 
                  :class="{ 'rotate-180': linkedAccountsExpandedIP.has(group.ip) }"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-if="linkedAccountsExpandedIP.has(group.ip)" class="border-t border-themed">
                <div class="divide-y divide-themed">
                  <div 
                    v-for="user in group.users" 
                    :key="user.id" 
                    class="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 text-sm hover:bg-themed-hover"
                  >
                    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span class="font-mono text-themed-muted">#{{ user.id }}</span>
                      <span class="font-medium text-themed">{{ user.username }}</span>
                      <span v-if="user.email" class="text-themed-muted truncate max-w-[200px]">{{ user.email }}</span>
                      <span :class="['badge', user.status === 'active' ? 'badge-success' : 'badge-error']">{{ user.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}</span>
                    </div>
                    <div class="text-xs text-themed-muted whitespace-nowrap">
                      {{ user.loginCount }} {{ t('admin.users.loginsCount') }} · {{ t('admin.users.lastLoginAt') }} {{ formatDate(user.lastLogin) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 邮箱相似组 -->
        <div v-if="linkedAccountsData.emailGroups.length > 0" class="space-y-2">
          <h3 class="text-sm font-medium text-themed flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {{ t('admin.users.emailSimilarGroups') }} ({{ linkedAccountsData.emailGroups.length }})
          </h3>
          <div class="space-y-2">
            <div 
              v-for="group in linkedAccountsData.emailGroups" 
              :key="group.pattern" 
              class="card overflow-hidden"
            >
              <button 
                class="w-full px-4 py-3 flex items-center justify-between hover:bg-themed-hover transition-colors text-left"
                @click="toggleEmailGroup(group.pattern)"
              >
                <div class="flex items-center gap-3">
                  <span class="font-mono text-sm text-themed">{{ group.pattern }}*</span>
                  <span class="badge badge-info">{{ group.userCount }} {{ t('admin.users.usersCount') }}</span>
                </div>
                <svg 
                  class="w-4 h-4 text-themed-muted transition-transform" 
                  :class="{ 'rotate-180': linkedAccountsExpandedEmail.has(group.pattern) }"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-if="linkedAccountsExpandedEmail.has(group.pattern)" class="border-t border-themed">
                <div class="divide-y divide-themed">
                  <div 
                    v-for="user in group.users" 
                    :key="user.id" 
                    class="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 text-sm hover:bg-themed-hover"
                  >
                    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span class="font-mono text-themed-muted">#{{ user.id }}</span>
                      <span class="font-medium text-themed">{{ user.username }}</span>
                      <span class="text-themed-secondary truncate max-w-[200px]">{{ user.email }}</span>
                      <span :class="['badge', user.status === 'active' ? 'badge-success' : 'badge-error']">{{ user.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}</span>
                    </div>
                    <div class="text-xs text-themed-muted whitespace-nowrap">
                      {{ t('admin.users.createdAt') }} {{ formatDate(user.createdAt) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 用户名相似组 -->
        <div v-if="linkedAccountsData.usernameGroups.length > 0" class="space-y-2">
          <h3 class="text-sm font-medium text-themed flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {{ t('admin.users.usernameSimilarGroups') }} ({{ linkedAccountsData.usernameGroups.length }})
          </h3>
          <div class="space-y-2">
            <div 
              v-for="group in linkedAccountsData.usernameGroups" 
              :key="group.pattern" 
              class="card overflow-hidden"
            >
              <button 
                class="w-full px-4 py-3 flex items-center justify-between hover:bg-themed-hover transition-colors text-left"
                @click="toggleUsernameGroup(group.pattern)"
              >
                <div class="flex items-center gap-3">
                  <span class="font-mono text-sm text-themed">{{ group.pattern }}*</span>
                  <span class="badge badge-default">{{ group.userCount }} {{ t('admin.users.usersCount') }}</span>
                </div>
                <svg 
                  class="w-4 h-4 text-themed-muted transition-transform" 
                  :class="{ 'rotate-180': linkedAccountsExpandedUsername.has(group.pattern) }"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div v-if="linkedAccountsExpandedUsername.has(group.pattern)" class="border-t border-themed">
                <div class="divide-y divide-themed">
                  <div 
                    v-for="user in group.users" 
                    :key="user.id" 
                    class="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 text-sm hover:bg-themed-hover"
                  >
                    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span class="font-mono text-themed-muted">#{{ user.id }}</span>
                      <span class="font-medium text-themed">{{ user.username }}</span>
                      <span v-if="user.email" class="text-themed-muted truncate max-w-[200px]">{{ user.email }}</span>
                      <span :class="['badge', user.status === 'active' ? 'badge-success' : 'badge-error']">{{ user.status === 'active' ? t('admin.users.active') : t('admin.users.banned') }}</span>
                    </div>
                    <div class="text-xs text-themed-muted whitespace-nowrap">
                      {{ t('admin.users.createdAt') }} {{ formatDate(user.createdAt) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 无检测结果 -->
        <div 
          v-if="linkedAccountsData.ipGroups.length === 0 && linkedAccountsData.emailGroups.length === 0 && linkedAccountsData.usernameGroups.length === 0" 
          class="card p-8 text-center text-themed-muted text-sm"
        >
          <svg class="w-12 h-12 mx-auto mb-3 text-success opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {{ t('admin.users.noLinkedAccounts') }}
        </div>
      </template>
    </div>

    <VipLevelRulesEditor v-if="activeTab === 'userVipLevels'" type="user" />
    <VipBenefitHallSettings v-if="activeTab === 'vipBenefits'" />

    <!-- 生成邀请码配置弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showGenerateModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showGenerateModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.generateInviteTitle') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showGenerateModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body space-y-4">
              <div>
                <label class="block text-sm text-themed-secondary mb-2">{{ t('admin.users.inviteCount') }}</label>
                <select v-model.number="inviteCount" class="input">
                  <option :value="1">1 {{ t('admin.users.countUnit') }}</option>
                  <option :value="5">5 {{ t('admin.users.countUnit') }}</option>
                  <option :value="20">20 {{ t('admin.users.countUnit') }}</option>
                  <option :value="50">50 {{ t('admin.users.countUnit') }}</option>
                  <option :value="100">100 {{ t('admin.users.countUnit') }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm text-themed-secondary mb-2">{{ t('admin.users.expireDays') }}</label>
                <select v-model.number="inviteExpireDays" class="input">
                  <option :value="1">{{ t('admin.users.day1') }}</option>
                  <option :value="3">{{ t('admin.users.day3') }}</option>
                  <option :value="7">{{ t('admin.users.day7') }}</option>
                  <option :value="14">{{ t('admin.users.day14') }}</option>
                  <option :value="30">{{ t('admin.users.day30') }}</option>
                  <option :value="0">{{ t('admin.users.permanentValid') }}</option>
                </select>
                <p class="text-xs text-themed-muted mt-1.5">{{ t('admin.users.expireHint') }}</p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showGenerateModal = false">{{ t('common.cancel') }}</button>
              <button :disabled="inviteGenerating" class="btn-primary" @click="generateInvite">
                <svg v-if="inviteGenerating" class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ inviteGenerating ? t('admin.users.generating') : t('admin.users.generate') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 邀请码生成结果弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showInviteModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showInviteModal = false"></div>
          <div class="modal-content" :class="{ 'max-w-lg': newInviteCodes.length > 0 }">
            <div class="modal-header">
              <h3 class="modal-title">
                {{ t('admin.users.inviteGenerated') }}
                <span v-if="newInviteCodes.length > 0" class="text-themed-muted font-normal text-sm ml-2">
                  ({{ newInviteCodes.length }} {{ t('admin.users.countUnit') }})
                </span>
              </h3>
              <button class="text-themed-muted hover:text-themed" @click="showInviteModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <!-- 单个邀请码 -->
              <template v-if="newInviteCode">
                <div class="bg-themed-tertiary rounded-lg p-4 font-mono text-lg text-center text-themed tracking-wider mb-3">
                  {{ newInviteCode }}
                </div>
              </template>
              <!-- 批量邀请码 -->
              <template v-else-if="newInviteCodes.length > 0">
                <div class="bg-themed-tertiary rounded-lg p-3 font-mono text-sm text-themed max-h-64 overflow-y-auto mb-3">
                  <div v-for="(code, index) in newInviteCodes" :key="code" class="py-1 px-2 hover:bg-themed-hover rounded flex items-center justify-between">
                    <span>{{ index + 1 }}. {{ code }}</span>
                  </div>
                </div>
              </template>
              <div v-if="newInviteExpiresAt" class="text-center text-sm text-themed-muted mb-4">
                {{ t('admin.users.validUntil') }}: {{ formatDate(newInviteExpiresAt) }}
              </div>
              <div v-else class="text-center text-sm text-themed-muted mb-4">{{ t('admin.users.permanentValid') }}</div>
              <div class="flex gap-2">
                <button class="btn-primary flex-1" @click="copyCode">
                  {{ copied ? t('admin.users.copied') : (newInviteCodes.length > 0 ? t('admin.users.copyAllCodes') : t('admin.users.copyCode')) }}
                </button>
                <button v-if="newInviteCode" class="btn-secondary flex-1" @click="copyLink">{{ t('admin.users.copyLink') }}</button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 重置密码确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showResetPasswordModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showResetPasswordModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.resetPassword') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showResetPasswordModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="text-themed-secondary">
                {{ t('admin.users.resetPasswordConfirm', { name: resetPasswordUser?.username }) }}
              </p>
              <p class="text-sm text-themed-muted mt-2">{{ t('admin.users.resetPasswordHint') }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showResetPasswordModal = false">{{ t('common.cancel') }}</button>
              <button :disabled="resetPasswordLoading" class="btn-primary" @click="resetPassword">
                <svg v-if="resetPasswordLoading" class="w-4 h-4 animate-spin mr-1" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ resetPasswordLoading ? t('admin.users.resetting') : t('admin.users.confirmResetPassword') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 重置密码结果弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showResetPasswordResultModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showResetPasswordResultModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.passwordResetSuccess') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showResetPasswordResultModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="text-sm text-themed-secondary mb-3">{{ t('admin.users.newPasswordFor', { name: resetPasswordUser?.username }) }}</p>
              <div class="bg-themed-tertiary rounded-lg p-4 font-mono text-lg text-center text-themed tracking-wider mb-3 select-all">
                {{ generatedPassword }}
              </div>
              <p class="text-xs text-themed-muted text-center">{{ t('admin.users.copyPasswordHint') }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showResetPasswordResultModal = false">{{ t('common.close') }}</button>
              <button class="btn-primary" @click="copyGeneratedPassword">
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {{ passwordCopied ? t('admin.users.copied') : t('admin.users.copyPassword') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 取消2FA确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showDisable2FAModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showDisable2FAModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.disable2FA') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showDisable2FAModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="text-themed-secondary">
                {{ t('admin.users.disable2FAConfirm', { name: disable2FAUser?.username }) }}
              </p>
              <p class="text-sm text-themed-muted mt-2">{{ t('admin.users.disable2FAWarning') }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showDisable2FAModal = false">{{ t('common.cancel') }}</button>
              <button :disabled="disable2FALoading" class="btn-danger" @click="disable2FA">
                {{ disable2FALoading ? t('admin.system.saving') : t('common.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 解绑GitHub确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showUnbindGitHubModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showUnbindGitHubModal = false"></div>
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.unbindGitHub') }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showUnbindGitHubModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <p class="text-themed-secondary">
                {{ t('admin.users.unbindGitHubConfirm', { name: unbindGitHubUser?.username }) }}
              </p>
              <p class="text-sm text-themed-muted mt-2">{{ t('admin.users.unbindGitHubWarning') }}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showUnbindGitHubModal = false">{{ t('common.cancel') }}</button>
              <button :disabled="unbindGitHubLoading" class="btn-danger" @click="unbindGitHub">
                {{ unbindGitHubLoading ? t('admin.system.saving') : t('common.confirm') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 登录记录弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showLoginRecordsModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showLoginRecordsModal = false"></div>
          <div class="modal-content max-w-2xl">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.loginRecords') }} - {{ loginRecordsUser?.username }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showLoginRecordsModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="modal-body">
              <!-- 加载中 -->
              <div v-if="loginRecordsLoading" class="flex items-center justify-center py-8">
                <svg class="w-6 h-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <!-- 无记录 -->
              <div v-else-if="loginRecords.length === 0" class="text-center py-8 text-themed-muted text-sm">
                {{ t('admin.users.noLoginRecords') }}
              </div>
              <!-- 记录列表 -->
              <div v-else class="space-y-2 max-h-96 overflow-y-auto">
                <div 
                  v-for="record in loginRecords" 
                  :key="record.id" 
                  class="bg-themed-tertiary rounded-lg p-3 text-sm"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 flex-1 space-y-1">
                      <!-- IP 地址 -->
                      <div class="font-mono text-themed">{{ record.ip }}</div>
                      <!-- 地理位置 -->
                      <div v-if="record.country" class="text-xs text-themed-muted">
                        {{ formatLocation(record) }}
                        <span v-if="record.isp" class="text-themed-faint"> · {{ record.isp }}</span>
                      </div>
                      <div v-else-if="record.isp" class="text-xs text-themed-muted">{{ record.isp }}</div>
                      <!-- 设备和浏览器 -->
                      <div v-if="record.userAgent" class="text-xs text-themed-faint">
                        {{ formatDevice(record.userAgent) }} · {{ formatBrowser(record.userAgent) }}
                      </div>
                    </div>
                    <div class="text-xs text-themed-muted whitespace-nowrap flex-shrink-0">
                      {{ formatDate(record.createdAt) }}
                    </div>
                  </div>
                </div>
              </div>
              <!-- 分页/记录数 -->
              <div v-if="loginRecords.length > 0" class="flex items-center justify-between text-sm text-themed-muted mt-4 pt-4 border-t border-themed">
                <span>{{ t('admin.users.totalRecords', { count: loginRecordsTotal }) }}</span>
                <div v-if="loginRecordsTotalPages > 1" class="flex items-center gap-2">
                  <button 
                    :disabled="loginRecordsPage <= 1" 
                    class="btn-ghost btn-sm"
                    @click="loginRecordsPage--; loadLoginRecords()"
                  >
                    {{ t('admin.users.prevPage') }}
                  </button>
                  <span>{{ loginRecordsPage }} / {{ loginRecordsTotalPages }}</span>
                  <button 
                    :disabled="loginRecordsPage >= loginRecordsTotalPages" 
                    class="btn-ghost btn-sm"
                    @click="loginRecordsPage++; loadLoginRecords()"
                  >
                    {{ t('admin.users.nextPage') }}
                  </button>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showLoginRecordsModal = false">{{ t('common.close') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 发送站内信弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showSendMessageModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showSendMessageModal = false"></div>
          <div class="modal-content max-w-lg">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.sendMessageTo', { username: sendMessageUser?.username }) }}</h3>
              <button class="modal-close" @click="showSendMessageModal = false">&times;</button>
            </div>
            <div class="modal-body space-y-4">
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.messageTitle') }}</label>
                <input 
                  v-model="sendMessageForm.title" 
                  type="text" 
                  class="input" 
                  :placeholder="t('admin.users.messageTitlePlaceholder')"
                  maxlength="200"
                />
                <p class="mt-1 text-xs text-themed-muted">{{ sendMessageForm.title.length }}/200</p>
              </div>
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.messageContent') }}</label>
                <textarea 
                  v-model="sendMessageForm.content" 
                  class="input min-h-[120px]" 
                  :placeholder="t('admin.users.messageContentPlaceholder')"
                  maxlength="5000"
                ></textarea>
                <p class="mt-1 text-xs text-themed-muted">{{ sendMessageForm.content.length }}/5000</p>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showSendMessageModal = false">{{ t('common.cancel') }}</button>
              <button 
                class="btn-primary" 
                :disabled="sendMessageLoading || !sendMessageForm.title.trim() || !sendMessageForm.content.trim()"
                @click="sendMessage"
              >
                <svg v-if="sendMessageLoading" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                {{ sendMessageLoading ? t('common.sending') : t('common.send') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 用户余额详情弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showBalanceModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showBalanceModal = false"></div>
          <div class="modal-content max-w-2xl">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.balanceDetails') }} - {{ balanceUser?.username }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showBalanceModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <!-- TAB 切换 -->
            <div class="flex gap-1 border-b border-themed px-4">
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="balanceTab === 'overview' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchBalanceTab('overview')"
              >
                {{ t('admin.users.balanceOverview') }}
              </button>
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="balanceTab === 'logs' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchBalanceTab('logs')"
              >
                {{ t('admin.users.balanceLogs') }}
              </button>
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="balanceTab === 'recharge' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchBalanceTab('recharge')"
              >
                {{ t('admin.users.rechargeRecords') }}
              </button>
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="balanceTab === 'adjust' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchBalanceTab('adjust')"
              >
                {{ t('admin.users.adjustBalance') }}
              </button>
            </div>
            <div class="modal-body">
              <!-- 余额概览 TAB -->
              <div v-if="balanceTab === 'overview'">
                <div v-if="balanceInfoLoading" class="flex items-center justify-center py-8">
                  <svg class="w-6 h-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div v-else class="grid grid-cols-3 gap-4">
                  <div class="bg-themed-tertiary rounded-lg p-4 text-center">
                    <div class="text-2xl font-semibold" :class="balanceInfo.balance > 0 ? 'text-success' : 'text-themed'">
                      ¥{{ balanceInfo.balance.toFixed(2) }}
                    </div>
                    <div class="text-xs text-themed-muted mt-1">{{ t('admin.users.currentBalance') }}</div>
                  </div>
                  <div class="bg-themed-tertiary rounded-lg p-4 text-center">
                    <div class="text-2xl font-semibold text-info">
                      ¥{{ balanceInfo.totalRecharge.toFixed(2) }}
                    </div>
                    <div class="text-xs text-themed-muted mt-1">{{ t('admin.users.totalRecharge') }}</div>
                  </div>
                  <div class="bg-themed-tertiary rounded-lg p-4 text-center">
                    <div class="text-2xl font-semibold text-warning">
                      ¥{{ balanceInfo.totalConsume.toFixed(2) }}
                    </div>
                    <div class="text-xs text-themed-muted mt-1">{{ t('admin.users.totalConsume') }}</div>
                  </div>
                </div>
              </div>

              <!-- 余额明细 TAB -->
              <div v-if="balanceTab === 'logs'">
                <!-- 抽奖筛选按钮 -->
                <div class="flex justify-end mb-3">
                  <button
                    class="btn btn-xs"
                    :class="balanceLogsShowLotteryGiftOnly ? 'btn-primary' : 'btn-ghost'"
                    @click="balanceLogsShowLotteryGiftOnly = !balanceLogsShowLotteryGiftOnly; balanceLogsPage = 1; loadBalanceLogs()"
                  >
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    {{ balanceLogsShowLotteryGiftOnly ? t('wallet.showingLotteryGift') : t('wallet.showLotteryGift') }}
                  </button>
                </div>
                <div v-if="balanceLogsLoading" class="flex items-center justify-center py-8">
                  <svg class="w-6 h-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div v-else-if="balanceLogs.length === 0" class="text-center py-8 text-themed-muted text-sm">
                  {{ t('admin.users.noBalanceLogs') }}
                </div>
                <div v-else>
                  <div class="space-y-2 max-h-80 overflow-y-auto">
                    <div 
                      v-for="log in balanceLogs" 
                      :key="log.id" 
                      class="bg-themed-tertiary rounded-lg p-3 text-sm flex items-center justify-between"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="badge" :class="log.amount > 0 ? 'badge-success' : 'badge-error'">
                            {{ getBalanceLogTypeLabel(log.type) }}
                          </span>
                          <span class="font-medium" :class="log.amount > 0 ? 'text-success' : 'text-error'">
                            {{ log.amount > 0 ? '+' : '' }}¥{{ log.amount.toFixed(2) }}
                          </span>
                        </div>
                        <div v-if="log.remark" class="text-xs text-themed-muted mt-1 truncate">{{ log.remark }}</div>
                      </div>
                      <div class="text-xs text-themed-muted whitespace-nowrap ml-4">{{ formatDate(log.createdAt) }}</div>
                    </div>
                  </div>
                  <!-- 分页 -->
                  <div v-if="balanceLogsTotalPages > 1" class="flex items-center justify-between text-sm text-themed-muted mt-4 pt-4 border-t border-themed">
                    <span>{{ t('admin.users.totalRecords', { count: balanceLogsTotal }) }}</span>
                    <div class="flex items-center gap-2">
                      <button 
                        :disabled="balanceLogsPage <= 1" 
                        class="btn-ghost btn-sm"
                        @click="balanceLogsPage--; loadBalanceLogs()"
                      >
                        {{ t('admin.users.prevPage') }}
                      </button>
                      <span>{{ balanceLogsPage }} / {{ balanceLogsTotalPages }}</span>
                      <button 
                        :disabled="balanceLogsPage >= balanceLogsTotalPages" 
                        class="btn-ghost btn-sm"
                        @click="balanceLogsPage++; loadBalanceLogs()"
                      >
                        {{ t('admin.users.nextPage') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 充值记录 TAB -->
              <div v-if="balanceTab === 'recharge'">
                <div v-if="rechargeRecordsLoading" class="flex items-center justify-center py-8">
                  <svg class="w-6 h-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div v-else-if="rechargeRecords.length === 0" class="text-center py-8 text-themed-muted text-sm">
                  {{ t('admin.users.noRechargeRecords') }}
                </div>
                <div v-else>
                  <div class="space-y-2 max-h-80 overflow-y-auto">
                    <div 
                      v-for="record in rechargeRecords" 
                      :key="record.id" 
                      class="bg-themed-tertiary rounded-lg p-3 text-sm flex items-center justify-between"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-themed">¥{{ record.amount.toFixed(2) }}</span>
                          <span :class="['badge', getRechargeStatusStyle(record.status)]">
                            {{ t('wallet.status.' + record.status) }}
                          </span>
                        </div>
                        <div class="text-xs text-themed-muted mt-1">
                          {{ record.orderNo }}
                          <span v-if="record.provider"> · {{ record.provider.name }}</span>
                        </div>
                      </div>
                      <div class="text-xs text-themed-muted whitespace-nowrap ml-4">{{ formatDate(record.createdAt) }}</div>
                    </div>
                  </div>
                  <!-- 分页 -->
                  <div v-if="rechargeRecordsTotalPages > 1" class="flex items-center justify-between text-sm text-themed-muted mt-4 pt-4 border-t border-themed">
                    <span>{{ t('admin.users.totalRecords', { count: rechargeRecordsTotal }) }}</span>
                    <div class="flex items-center gap-2">
                      <button 
                        :disabled="rechargeRecordsPage <= 1" 
                        class="btn-ghost btn-sm"
                        @click="rechargeRecordsPage--; loadRechargeRecords()"
                      >
                        {{ t('admin.users.prevPage') }}
                      </button>
                      <span>{{ rechargeRecordsPage }} / {{ rechargeRecordsTotalPages }}</span>
                      <button 
                        :disabled="rechargeRecordsPage >= rechargeRecordsTotalPages" 
                        class="btn-ghost btn-sm"
                        @click="rechargeRecordsPage++; loadRechargeRecords()"
                      >
                        {{ t('admin.users.nextPage') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 调整余额 TAB -->
              <div v-if="balanceTab === 'adjust'" class="space-y-4">
                <!-- 调整类型 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-2">{{ t('admin.users.adjustType') }}</label>
                  <div class="flex gap-3">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input 
                        v-model="adjustBalanceForm.type" 
                        type="radio" 
                        value="add" 
                        class="w-4 h-4 text-primary"
                      />
                      <span class="text-sm text-success">{{ t('admin.users.addBalance') }}</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input 
                        v-model="adjustBalanceForm.type" 
                        type="radio" 
                        value="deduct" 
                        class="w-4 h-4 text-primary"
                      />
                      <span class="text-sm text-error">{{ t('admin.users.deductBalance') }}</span>
                    </label>
                  </div>
                </div>
                <!-- 金额 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.amount') }}</label>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-themed-muted">¥</span>
                    <input 
                      v-model="adjustBalanceForm.amount" 
                      type="number" 
                      step="0.01"
                      min="0.01"
                      class="input pl-8" 
                      :placeholder="t('admin.users.amountPlaceholder')"
                    />
                  </div>
                </div>
                <!-- 理由 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.adjustReason') }} <span class="text-error">*</span></label>
                  <textarea 
                    v-model="adjustBalanceForm.reason" 
                    class="input min-h-[80px]" 
                    :placeholder="t('admin.users.adjustReasonPlaceholder')"
                    maxlength="500"
                  ></textarea>
                  <p class="mt-1 text-xs text-themed-muted">{{ adjustBalanceForm.reason.length }}/500</p>
                </div>
                <!-- 提交按钮 -->
                <div class="pt-2">
                  <button 
                    class="btn-primary w-full" 
                    :disabled="adjustBalanceLoading || !adjustBalanceForm.amount || !adjustBalanceForm.reason.trim()"
                    @click="submitAdjustBalance"
                  >
                    <svg v-if="adjustBalanceLoading" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    {{ adjustBalanceLoading ? t('common.submitting') : t('common.confirm') }}
                  </button>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showBalanceModal = false">{{ t('common.close') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    
    <!-- 积分调整弹窗 -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div 
          v-if="showPointsModal" 
          class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          @click.self="showPointsModal = false"
        >
          <div class="card p-6 w-full max-w-md">
            <h3 class="text-lg font-semibold text-themed mb-4">
              {{ t('admin.users.adjustPoints') }} - {{ pointsUser?.username }}
            </h3>
            <div class="space-y-4">
              <!-- 当前积分 -->
              <div class="flex items-center justify-between py-2 px-3 bg-themed-tertiary rounded-lg">
                <span class="text-sm text-themed-muted">{{ t('admin.users.currentPoints') }}</span>
                <span class="text-lg font-semibold text-amber-500">{{ pointsUser?.points || 0 }}</span>
              </div>
              <!-- 调整数量 -->
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">
                  {{ t('admin.users.pointsAmount') }}
                  <span class="text-themed-muted text-xs">({{ t('admin.users.pointsAmountHint') }})</span>
                </label>
                <input 
                  v-model="adjustPointsForm.amount" 
                  type="number" 
                  class="input" 
                  :placeholder="t('admin.users.pointsAmountPlaceholder')"
                />
              </div>
              <!-- 理由 -->
              <div>
                <label class="block text-sm text-themed-secondary mb-1.5">
                  {{ t('admin.users.adjustReason') }} <span class="text-error">*</span>
                </label>
                <textarea 
                  v-model="adjustPointsForm.reason" 
                  class="input min-h-[80px]" 
                  :placeholder="t('admin.users.pointsReasonPlaceholder')"
                  maxlength="200"
                ></textarea>
              </div>
              <!-- 按钮 -->
              <div class="flex justify-end gap-2 pt-2">
                <button class="btn btn-ghost" @click="showPointsModal = false">{{ t('common.cancel') }}</button>
                <button 
                  class="btn btn-primary" 
                  :disabled="adjustPointsLoading || !adjustPointsForm.amount || !adjustPointsForm.reason.trim()"
                  @click="submitAdjustPoints"
                >
                  <svg v-if="adjustPointsLoading" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  {{ adjustPointsLoading ? t('common.submitting') : t('common.confirm') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 托管余额弹窗 -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showHostingBalanceModal" class="modal-overlay">
          <div class="modal-backdrop" @click="showHostingBalanceModal = false"></div>
          <div class="modal-content max-w-2xl">
            <div class="modal-header">
              <h3 class="modal-title">{{ t('admin.users.hostingBalanceDetails') }} - {{ hostingBalanceUser?.username }}</h3>
              <button class="text-themed-muted hover:text-themed" @click="showHostingBalanceModal = false">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <!-- TAB 切换 -->
            <div class="flex gap-1 border-b border-themed px-4">
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="hostingBalanceTab === 'overview' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchHostingBalanceTab('overview')"
              >
                {{ t('admin.users.hostingBalanceOverview') }}
              </button>
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="hostingBalanceTab === 'logs' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchHostingBalanceTab('logs')"
              >
                {{ t('admin.users.hostingBalanceLogs') }}
              </button>
              <button
                class="px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
                :class="hostingBalanceTab === 'adjust' ? 'border-blue-500 text-blue-500' : 'border-transparent text-themed-muted hover:text-themed'"
                @click="switchHostingBalanceTab('adjust')"
              >
                {{ t('admin.users.adjustHostingBalance') }}
              </button>
            </div>
            <div class="modal-body">
              <!-- 概览 TAB -->
              <div v-if="hostingBalanceTab === 'overview'">
                <div v-if="hostingBalanceInfoLoading" class="flex items-center justify-center py-8">
                  <svg class="w-6 h-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div v-else class="grid grid-cols-2 gap-4">
                  <div class="bg-themed-tertiary rounded-lg p-4 text-center">
                    <div class="text-2xl font-semibold" :class="hostingBalanceInfo.available > 0 ? 'text-success' : 'text-themed'">
                      ¥{{ hostingBalanceInfo.available.toFixed(2) }}
                    </div>
                    <div class="text-xs text-themed-muted mt-1">{{ t('admin.users.availableBalance') }}</div>
                  </div>
                  <div class="bg-themed-tertiary rounded-lg p-4 text-center">
                    <div class="text-2xl font-semibold text-warning">
                      ¥{{ hostingBalanceInfo.frozen.toFixed(2) }}
                    </div>
                    <div class="text-xs text-themed-muted mt-1">{{ t('admin.users.frozenBalance') }}</div>
                  </div>
                </div>
              </div>
              <!-- 明细 TAB -->
              <div v-else-if="hostingBalanceTab === 'logs'">
                <div v-if="hostingBalanceLogsLoading" class="flex items-center justify-center py-8">
                  <svg class="w-6 h-6 animate-spin text-themed-muted" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div v-else-if="hostingBalanceLogs.length === 0" class="text-center py-8 text-themed-muted">
                  {{ t('common.noData') }}
                </div>
                <div v-else>
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="text-xs text-themed-muted uppercase border-b border-themed">
                        <tr>
                          <th class="text-left py-2 px-2">{{ t('admin.users.logTime') }}</th>
                          <th class="text-left py-2 px-2">{{ t('admin.users.logType') }}</th>
                          <th class="text-right py-2 px-2">{{ t('admin.users.logAmount') }}</th>
                          <th class="text-left py-2 px-2">{{ t('admin.users.logStatus') }}</th>
                          <th class="text-left py-2 px-2">{{ t('admin.users.logDescription') }}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-themed">
                        <tr v-for="log in hostingBalanceLogs" :key="log.id" class="hover:bg-themed-tertiary">
                          <td class="py-2 px-2 whitespace-nowrap text-themed-muted">
                            {{ new Date(log.createdAt).toLocaleString() }}
                          </td>
                          <td class="py-2 px-2 whitespace-nowrap">
                            <span class="badge badge-default">{{ getHostingLogTypeLabel(log.type, log.actionType) }}</span>
                          </td>
                          <td class="py-2 px-2 text-right whitespace-nowrap" :class="log.type === 'income' || log.type === 'unfreeze' ? 'text-success' : 'text-error'">
                            {{ log.type === 'income' || log.type === 'unfreeze' ? '+' : '-' }}¥{{ log.amount.toFixed(2) }}
                          </td>
                          <td class="py-2 px-2 whitespace-nowrap">
                            <span v-if="log.frozen" class="badge badge-warning">{{ t('admin.users.frozen') }}</span>
                            <span v-else class="badge badge-success">{{ t('admin.users.available') }}</span>
                          </td>
                          <td class="py-2 px-2 text-themed-muted max-w-xs truncate" :title="log.description">
                            {{ log.description || '-' }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <!-- 分页 -->
                  <div v-if="hostingBalanceLogsTotalPages > 1" class="flex justify-center mt-4 gap-1">
                    <button 
                      class="btn btn-xs btn-ghost" 
                      :disabled="hostingBalanceLogsPage <= 1"
                      @click="changeHostingBalanceLogsPage(hostingBalanceLogsPage - 1)"
                    >
                      {{ t('common.prev') }}
                    </button>
                    <span class="px-2 text-sm text-themed-muted">
                      {{ hostingBalanceLogsPage }} / {{ hostingBalanceLogsTotalPages }}
                    </span>
                    <button 
                      class="btn btn-xs btn-ghost" 
                      :disabled="hostingBalanceLogsPage >= hostingBalanceLogsTotalPages"
                      @click="changeHostingBalanceLogsPage(hostingBalanceLogsPage + 1)"
                    >
                      {{ t('common.next') }}
                    </button>
                  </div>
                </div>
              </div>
              <!-- 调整 TAB -->
              <div v-else-if="hostingBalanceTab === 'adjust'" class="space-y-4">
                <!-- 当前余额 -->
                <div class="grid grid-cols-2 gap-4 py-2 px-3 bg-themed-tertiary rounded-lg">
                  <div class="text-center">
                    <div class="text-lg font-semibold text-success">¥{{ hostingBalanceInfo.available.toFixed(2) }}</div>
                    <div class="text-xs text-themed-muted">{{ t('admin.users.availableBalance') }}</div>
                  </div>
                  <div class="text-center">
                    <div class="text-lg font-semibold text-warning">¥{{ hostingBalanceInfo.frozen.toFixed(2) }}</div>
                    <div class="text-xs text-themed-muted">{{ t('admin.users.frozenBalance') }}</div>
                  </div>
                </div>
                <!-- 调整类型 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.adjustType') }}</label>
                  <div class="flex gap-4">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input v-model="adjustHostingBalanceForm.type" type="radio" value="available" class="radio" />
                      <span class="text-sm">{{ t('admin.users.availableBalance') }}</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input v-model="adjustHostingBalanceForm.type" type="radio" value="frozen" class="radio" />
                      <span class="text-sm">{{ t('admin.users.frozenBalance') }}</span>
                    </label>
                  </div>
                </div>
                <!-- 操作类型 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.operation') }}</label>
                  <div class="flex gap-4">
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input v-model="adjustHostingBalanceForm.operation" type="radio" value="add" class="radio" />
                      <span class="text-sm text-success">{{ t('admin.users.operationAdd') }}</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input v-model="adjustHostingBalanceForm.operation" type="radio" value="deduct" class="radio" />
                      <span class="text-sm text-error">{{ t('admin.users.operationDeduct') }}</span>
                    </label>
                  </div>
                </div>
                <!-- 金额 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.amount') }} <span class="text-error">*</span></label>
                  <input 
                    v-model="adjustHostingBalanceForm.amount" 
                    type="number" 
                    step="0.01"
                    min="0"
                    class="input" 
                    :placeholder="t('admin.users.amountPlaceholder')"
                  />
                </div>
                <!-- 理由 -->
                <div>
                  <label class="block text-sm text-themed-secondary mb-1.5">{{ t('admin.users.adjustReason') }} <span class="text-error">*</span></label>
                  <textarea 
                    v-model="adjustHostingBalanceForm.reason" 
                    class="input min-h-[80px]" 
                    :placeholder="t('admin.users.hostingReasonPlaceholder')"
                    maxlength="200"
                  ></textarea>
                  <p class="mt-1 text-xs text-themed-muted">{{ adjustHostingBalanceForm.reason.length }}/200</p>
                </div>
                <!-- 按钮 -->
                <div class="flex justify-end gap-2 pt-2">
                  <button class="btn btn-ghost" @click="hostingBalanceTab = 'overview'">{{ t('common.cancel') }}</button>
                  <button 
                    class="btn btn-primary" 
                    :disabled="adjustHostingBalanceLoading || !adjustHostingBalanceForm.amount || !adjustHostingBalanceForm.reason.trim()"
                    @click="submitAdjustHostingBalance"
                  >
                    <svg v-if="adjustHostingBalanceLoading" class="w-4 h-4 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    {{ adjustHostingBalanceLoading ? t('common.submitting') : t('common.confirm') }}
                  </button>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" @click="showHostingBalanceModal = false">{{ t('common.close') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
