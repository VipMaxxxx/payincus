/**
 * 全局恢复任务状态管理
 * 用于在页面切换时保持恢复任务的轮询状态
 */
import { ref, type Ref } from 'vue'
import api from '@/api'
import { useToast } from './toast'

export type RestoreTaskStatus =
    | 'idle'
    | 'pending'
    | 'processing'
    | 'stopping'
    | 'restoring'
    | 'replacing'
    | 'completed'
    | 'failed'
    | 'rolled_back'

export interface RestoreTask {
    instanceId: number
    backupId: number
    backupName: string
    taskId: string
    status: RestoreTaskStatus
    error?: string
    notificationId: number | null
    queuePosition?: number
    duration?: number | null
    createdAt?: string
    startedAt?: string | null
    finishedAt?: string | null
}

// 全局状态 - 在模块级别定义，所有组件共享
const activeTask: Ref<RestoreTask | null> = ref(null)
let pollInterval: ReturnType<typeof setInterval> | null = null

export function useRestoreTask() {
    const toast = useToast()

    /**
     * 开始恢复任务
     */
    async function startRestore(
        instanceId: number,
        backupId: number,
        backupName: string,
        t: (key: string, params?: Record<string, unknown>) => string
    ): Promise<boolean> {
        // 检查是否已有进行中的任务
        if (activeTask.value && !['completed', 'failed', 'rolled_back', 'idle'].includes(activeTask.value.status)) {
            toast.warning(t('backup.messages.restoreInProgress'))
            return false
        }

        try {
            const res = await api.instances.restoreBackup(instanceId, backupId)

            // 显示持久通知
            const notificationId = toast.show(
                t('backup.messages.restoreStarted', { name: backupName }),
                'info',
                0 // 不自动消失
            )

            activeTask.value = {
                instanceId,
                backupId,
                backupName,
                taskId: res.taskId,
                status: 'pending',
                notificationId
            }

            // 开始轮询
            startPolling(t)
            return true
        } catch (err: any) {
            toast.error(t('backup.messages.restoreFailed') + ': ' + (err?.message || String(err)))
            return false
        }
    }

    /**
     * 开始轮询任务状态
     */
    function startPolling(t: (key: string, params?: Record<string, unknown>) => string): void {
        stopPolling()

        pollInterval = setInterval(async () => {
            if (!activeTask.value || !activeTask.value.taskId) {
                stopPolling()
                return
            }

            try {
                const res = await api.instances.getRestoreStatus(
                    activeTask.value.instanceId,
                    activeTask.value.taskId
                )

                // 后端返回大写状态，转为小写
                const status = res.status.toLowerCase() as RestoreTaskStatus
                activeTask.value.status = status
                if (res.error) {
                    activeTask.value.error = res.error
                }
                // 更新任务时间信息
                if (res.queuePosition !== undefined) activeTask.value.queuePosition = res.queuePosition
                if (res.duration !== undefined) activeTask.value.duration = res.duration
                if (res.createdAt) activeTask.value.createdAt = res.createdAt
                if (res.startedAt !== undefined) activeTask.value.startedAt = res.startedAt
                if (res.finishedAt !== undefined) activeTask.value.finishedAt = res.finishedAt

                // 处理完成状态
                if (status === 'completed') {
                    if (activeTask.value.notificationId !== null) {
                        toast.remove(activeTask.value.notificationId)
                    }
                    toast.success(t('backup.messages.restoreCompleted'))
                    stopPolling()
                    // 刷新页面以显示恢复后的实例
                    setTimeout(() => {
                        window.location.reload()
                    }, 1500)
                } else if (status === 'failed') {
                    if (activeTask.value.notificationId !== null) {
                        toast.remove(activeTask.value.notificationId)
                    }
                    toast.error(t('backup.messages.restoreFailed') + ': ' + (res.error || ''))
                    stopPolling()
                }
            } catch (err) {
                console.error('Failed to poll restore status:', err)
            }
        }, 2000)
    }

    /**
     * 停止轮询
     */
    function stopPolling(): void {
        if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
        }
    }

    /**
     * 回滚恢复操作
     */
    async function rollback(t: (key: string, params?: Record<string, unknown>) => string): Promise<boolean> {
        if (!activeTask.value || activeTask.value.status !== 'failed') {
            return false
        }

        try {
            await api.instances.rollbackRestore(activeTask.value.instanceId, activeTask.value.taskId)
            activeTask.value.status = 'rolled_back'
            toast.success(t('backup.messages.rollbackCompleted'))
            return true
        } catch (err: any) {
            toast.error(t('backup.messages.rollbackFailed') + ': ' + (err?.message || String(err)))
            return false
        }
    }

    /**
     * 清除任务状态
     */
    function clearTask(): void {
        stopPolling()
        if (activeTask.value && activeTask.value.notificationId !== null) {
            toast.remove(activeTask.value.notificationId)
        }
        activeTask.value = null
    }

    /**
     * 获取指定实例的恢复状态
     */
    function getTaskForInstance(instanceId: number): RestoreTask | null {
        if (activeTask.value && activeTask.value.instanceId === instanceId) {
            return activeTask.value
        }
        return null
    }

    /**
     * 检查指定备份是否正在恢复
     */
    function isBackupRestoring(instanceId: number, backupId: number): boolean {
        if (!activeTask.value) return false
        return activeTask.value.instanceId === instanceId &&
            activeTask.value.backupId === backupId &&
            ['pending', 'processing', 'stopping', 'restoring', 'replacing'].includes(activeTask.value.status)
    }

    /**
     * 检查指定备份是否恢复失败（可回滚）
     */
    function canRollbackBackup(instanceId: number, backupId: number): boolean {
        if (!activeTask.value) return false
        return activeTask.value.instanceId === instanceId &&
            activeTask.value.backupId === backupId &&
            activeTask.value.status === 'failed'
    }

    return {
        activeTask,
        startRestore,
        rollback,
        clearTask,
        getTaskForInstance,
        isBackupRestoring,
        canRollbackBackup
    }
}
