/**
 * 系统健康监控服务
 * 
 * 高可用特性：
 * - 定期输出系统健康状态
 * - 监控各调度器运行情况
 * - Webhook 告警异常情况
 */

import { schedule } from 'node-cron'
import { getDbPoolStats, prisma } from '../db/prisma.js'
import { getPoolStatus } from '../lib/incus/incus-pool.js'
import { assertSafeWebhookUrl } from '../lib/outbound-security.js'

// 系统启动时间
const systemStartTime = Date.now()

// 告警配置
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || ''
const ALERT_COOLDOWN_MS = 10 * 60 * 1000  // 10分钟告警冷却
const ALERT_TIMEOUT_MS = 10 * 1000  // 10秒请求超时
let lastAlertTime = 0
let schedulerStarted = false

// 监控指标
interface SystemMetrics {
  uptime: number
  instanceCount: number
  hostCount: number
  onlineHostCount: number
  pendingTasks: number
  processingTasks: number
  pendingRestoreTasks: number
  processingRestoreTasks: number
  pendingUploadTasks: number
  processingUploadTasks: number
  incusConnectionPoolSize: number
  dbPoolTotalCount: number
  dbPoolIdleCount: number
  dbPoolWaitingCount: number
  avgResponseTime: number
  errorHosts: number
  memoryUsageMB: number
}

/**
 * 收集系统指标
 */
async function collectMetrics(): Promise<SystemMetrics> {
  const [
    instanceCount,
    hostStats,
    pendingTasks,
    processingTasks,
    pendingRestoreTasks,
    processingRestoreTasks,
    pendingUploadTasks,
    processingUploadTasks
  ] = await Promise.all([
    prisma.instance.count({ where: { status: { not: 'deleted' } } }),
    prisma.host.groupBy({
      by: ['status'],
      _count: { id: true }
    }),
    prisma.instanceTask.count({ where: { status: 'PENDING' } }),
    prisma.instanceTask.count({ where: { status: 'PROCESSING' } }),
    prisma.restoreTask.count({ where: { status: 'PENDING' } }),
    prisma.restoreTask.count({ where: { status: 'PROCESSING' } }),
    prisma.backupUploadTask.count({ where: { status: 'PENDING' } }),
    prisma.backupUploadTask.count({ where: { status: 'PROCESSING' } })
  ])
  
  // 计算宿主机统计
  const hostCount = hostStats.reduce((sum, h) => sum + h._count.id, 0)
  const onlineHostCount = hostStats.find(h => h.status === 'online')?._count.id || 0
  
  // 获取连接池状态
  const poolStatus = getPoolStatus()
  let totalResponseTime = 0
  let responseTimeCount = 0
  let errorHosts = 0
  
  for (const [_, status] of poolStatus) {
    if (status.lastResponseTime > 0) {
      totalResponseTime += status.lastResponseTime
      responseTimeCount++
    }
    if (status.errorCount >= 3) {
      errorHosts++
    }
  }
  
  const avgResponseTime = responseTimeCount > 0 
    ? Math.round(totalResponseTime / responseTimeCount) 
    : 0

  const dbPoolStats = getDbPoolStats()
  
  // 获取内存使用情况
  const memoryUsage = process.memoryUsage()
  const memoryUsageMB = Math.round(memoryUsage.heapUsed / 1024 / 1024)
  
  return {
    uptime: Math.round((Date.now() - systemStartTime) / 1000 / 60), // 分钟
    instanceCount,
    hostCount,
    onlineHostCount,
    pendingTasks,
    processingTasks,
    pendingRestoreTasks,
    processingRestoreTasks,
    pendingUploadTasks,
    processingUploadTasks,
    incusConnectionPoolSize: poolStatus.size,
    dbPoolTotalCount: dbPoolStats.totalCount,
    dbPoolIdleCount: dbPoolStats.idleCount,
    dbPoolWaitingCount: dbPoolStats.waitingCount,
    avgResponseTime,
    errorHosts,
    memoryUsageMB
  }
}

/**
 * 发送告警到 Webhook
 */
async function sendAlert(alerts: string[]): Promise<void> {
  if (!ALERT_WEBHOOK_URL) return
  
  // 告警冷却检查
  const now = Date.now()
  if (now - lastAlertTime < ALERT_COOLDOWN_MS) {
    console.log('[Monitor] Alert cooldown, skipping webhook')
    return
  }
  
  try {
    const payload = {
      type: 'system_alert',
      timestamp: new Date().toISOString(),
      alerts,
      source: 'incudal-monitor'
    }
    
    // 设置请求超时
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS)
    
    try {
      const webhookUrl = await assertSafeWebhookUrl(ALERT_WEBHOOK_URL)
      const response = await fetch(webhookUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'manual'
      })
      
      if (response.ok) {
        lastAlertTime = now
        console.log('[Monitor] Alert sent successfully')
      } else {
        console.error(`[Monitor] Alert webhook failed: ${response.status}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[Monitor] Alert webhook timeout')
    } else {
      console.error('[Monitor] Failed to send alert:', error)
    }
  }
}

/**
 * 输出健康报告
 */
async function reportHealth(): Promise<void> {
  try {
    const metrics = await collectMetrics()
    
    // 构建健康状态
    const status = []
    if (metrics.errorHosts > 0) {
      status.push(`⚠️ ${metrics.errorHosts} hosts with errors`)
    }
    if (metrics.processingTasks > 10) {
      status.push(`⚠️ High task load: ${metrics.processingTasks} processing`)
    }
    if (metrics.avgResponseTime > 1000) {
      status.push(`⚠️ Slow response: ${metrics.avgResponseTime}ms avg`)
    }
    if (metrics.memoryUsageMB > 512) {
      status.push(`⚠️ High memory: ${metrics.memoryUsageMB}MB`)
    }
    
    const healthStatus = status.length > 0 ? status.join(', ') : '✓ All systems healthy'
    
    // 如果有异常且配置了 Webhook，发送告警
    if (status.length > 0 && ALERT_WEBHOOK_URL) {
      await sendAlert(status)
    }
    
    // 计算总任务数
    const totalPending = metrics.pendingTasks + metrics.pendingRestoreTasks + metrics.pendingUploadTasks
    const totalProcessing = metrics.processingTasks + metrics.processingRestoreTasks + metrics.processingUploadTasks
    
    console.log(`[Monitor] Health Report:
  Uptime: ${metrics.uptime} min | Memory: ${metrics.memoryUsageMB}MB
  Instances: ${metrics.instanceCount}
  Hosts: ${metrics.onlineHostCount}/${metrics.hostCount} online
  Tasks: ${totalPending} pending, ${totalProcessing} processing
    - Instance: ${metrics.pendingTasks}/${metrics.processingTasks}
    - Restore: ${metrics.pendingRestoreTasks}/${metrics.processingRestoreTasks}
    - Upload: ${metrics.pendingUploadTasks}/${metrics.processingUploadTasks}
  DB Pool: total=${metrics.dbPoolTotalCount}, idle=${metrics.dbPoolIdleCount}, waiting=${metrics.dbPoolWaitingCount}
  Incus Pool: ${metrics.incusConnectionPoolSize} connections, ${metrics.avgResponseTime}ms avg
  Status: ${healthStatus}`)
  } catch (error) {
    console.error('[Monitor] Failed to collect metrics:', error)
  }
}

/**
 * 启动系统监控
 */
export function startSystemMonitor(): void {
  if (schedulerStarted) {
    return
  }

  schedulerStarted = true

  // 启动时输出一次
  setTimeout(() => {
    reportHealth().catch(console.error)
  }, 5000) // 延迟5秒，等系统初始化完成
  
  // 每10分钟输出健康报告
  schedule('*/10 * * * *', () => {
    reportHealth().catch(console.error)
  })
  
  console.log('[Monitor] System monitor started')
}

/**
 * 获取系统指标（API 用）
 */
export async function getSystemMetrics(): Promise<SystemMetrics> {
  return collectMetrics()
}
