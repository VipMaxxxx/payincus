/**
 * Incus 备份恢复服务
 * 实现从备份流恢复实例、重命名实例等功能
 */

import { Agent, request } from 'undici'
import { readFileSync } from 'fs'
import type { Readable } from 'stream'
import type { IncusClient } from './incus-client.js'
import type { IncusApiResponse } from '../../types/incus.js'

/**
 * 生成临时实例名称
 * 格式: {originalName}-restore-{timestamp}
 */
export function generateTempInstanceName(originalName: string): string {
    const timestamp = Date.now()
    return `${originalName}-restore-${timestamp}`
}

/**
 * 等待 Incus 异步操作完成（用于恢复操作，超时 5 分钟）
 */
async function waitForRestoreOperation(
    baseUrl: string,
    operationUrl: string,
    agent: Agent,
    timeout: number = 300000 // 5 分钟
): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
        const waitTimeout = Math.min(30, Math.floor((timeout - (Date.now() - startTime)) / 1000))
        if (waitTimeout <= 0) break

        try {
            const waitUrl = `${baseUrl}${operationUrl}/wait?timeout=${waitTimeout}`

            const response = await request(waitUrl, {
                method: 'GET',
                dispatcher: agent,
                headers: { 'Content-Type': 'application/json' }
            })

            const text = await response.body.text()
            
            let data: IncusApiResponse
            try {
                data = JSON.parse(text) as IncusApiResponse
            } catch {
                console.error(`[Incus Restore] 解析响应失败: ${text.substring(0, 200)}`)
                throw new Error(`无效的响应: ${text.substring(0, 100)}`)
            }

            const metadata = data.metadata as { status?: string; status_code?: number; err?: string; error?: string } | undefined
            const status = metadata?.status || 'unknown'
            const statusCode = metadata?.status_code

            if (status === 'Success' || statusCode === 200) {
                return
            }

            if (status === 'Failure' || (statusCode && statusCode >= 400)) {
                const errMsg = metadata?.err || metadata?.error || '操作失败'
                console.error(`[Incus Restore] 操作失败: ${errMsg}`)
                throw new Error(errMsg)
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            if (errorMessage.includes('操作失败') || errorMessage.includes('Failure')) {
                throw err
            }
            console.error(`[Incus Restore] 轮询出错: ${errorMessage}`)
            await new Promise(r => setTimeout(r, 2000))
        }
    }

    throw new Error('恢复操作超时 (5 分钟)')
}

interface RestoreFromStreamParams {
    client: IncusClient
    backupStream: Readable
    targetName: string
    poolName?: string
}

/**
 * 从备份流恢复实例
 * 使用二进制流直接 POST 到 Incus API
 */
export async function restoreFromStream({
    client,
    backupStream,
    targetName,
    poolName
}: RestoreFromStreamParams): Promise<void> {
    if (!client.certPath || !client.keyPath) {
        throw new Error('Certificate path not configured')
    }

    const cert = readFileSync(client.certPath)
    const key = readFileSync(client.keyPath)

    // 创建专用 Agent，设置长超时
    const restoreAgent = new Agent({
        connect: {
            cert,
            key,
            rejectUnauthorized: false,
            timeout: 60000
        },
        bodyTimeout: 0, // 禁用 body 超时
        headersTimeout: 60000
    })

    try {
        const url = `${client.baseUrl}/1.0/instances`

        // 构建 headers
        // Incus 使用 X-Incus-* headers，但也兼容 X-LXD-* (向后兼容)
        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'X-Incus-name': targetName
        }
        if (poolName) {
            headers['X-Incus-pool'] = poolName
        }

        const response = await request(url, {
            method: 'POST',
            dispatcher: restoreAgent,
            headers,
            body: backupStream
        })

        const text = await response.body.text()
        
        let data: IncusApiResponse
        try {
            data = JSON.parse(text) as IncusApiResponse
        } catch {
            console.error(`[Incus Restore] 解析响应失败: ${text.substring(0, 200)}`)
            throw new Error(`无效的响应: ${text.substring(0, 200)}`)
        }

        if (data.type === 'error') {
            console.error(`[Incus Restore] 恢复失败: ${data.error}`)
            throw new Error(data.error || '恢复失败')
        }

        // 异步操作，等待完成
        if (data.type === 'async' && data.operation) {
            await waitForRestoreOperation(client.baseUrl, data.operation, restoreAgent)
        }
    } finally {
        await restoreAgent.close().catch(() => { })
    }
}

/**
 * 重命名实例
 */
export async function renameInstance(
    client: IncusClient,
    oldName: string,
    newName: string
): Promise<void> {
    await client.request('POST', `/1.0/instances/${oldName}`, {
        name: newName
    })
}

/**
 * 检查实例是否存在
 */
export async function instanceExists(
    client: IncusClient,
    instanceName: string
): Promise<boolean> {
    try {
        await client.request('GET', `/1.0/instances/${instanceName}`)
        return true
    } catch {
        return false
    }
}
