/**
 * SFTP 存储适配器
 */

import SftpClient from 'ssh2-sftp-client'
import { Readable } from 'stream'
import type { IStorageProvider, StorageConfigData } from '../types.js'
import { assertSafeStorageTarget } from '../../lib/outbound-security.js'

// SFTP 超时配置（6小时，适合大型备份）
const SFTP_TIMEOUT = 6 * 60 * 60 * 1000

export class SftpProvider implements IStorageProvider {
    private config: StorageConfigData
    private basePath: string

    constructor(config: StorageConfigData) {
        this.config = config
        this.basePath = config.basePath?.endsWith('/')
            ? config.basePath
            : `${config.basePath || ''}/`
    }

    private async getClient(): Promise<SftpClient> {
        await assertSafeStorageTarget('SFTP', this.config.host)
        const client = new SftpClient()

        await client.connect({
            host: this.config.host.replace(/^sftp:\/\//, ''),
            port: this.config.port || 22,
            username: this.config.username || '',
            password: this.config.password || '',
            // 大文件上传需要更长的超时时间
            readyTimeout: SFTP_TIMEOUT,
            retries: 3,
            retry_minTimeout: 2000
        })

        return client
    }

    async uploadStream(fileStream: Readable, filename: string): Promise<void> {
        const client = await this.getClient()

        try {
            // 确保目录存在
            if (this.basePath && this.basePath !== '/') {
                try {
                    await client.mkdir(this.basePath, true)
                } catch {
                    // 目录可能已存在
                }
            }

            // 上传文件
            const remotePath = this.basePath + filename
            await client.put(fileStream, remotePath)
        } finally {
            await client.end()
        }
    }

    async testConnection(): Promise<void> {
        const client = await this.getClient()

        try {
            // 尝试列出根目录来测试连接
            await client.list('/')
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`SFTP 连接测试失败: ${message}`)
        } finally {
            await client.end()
        }
    }

    async deleteFile(filename: string): Promise<void> {
        const client = await this.getClient()

        try {
            const remotePath = this.basePath + filename
            await client.delete(remotePath)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`删除文件失败: ${message}`)
        } finally {
            await client.end()
        }
    }

    async listFiles(path?: string): Promise<string[]> {
        const client = await this.getClient()

        try {
            const targetPath = path || this.basePath
            const list = await client.list(targetPath)
            return list.map(item => item.name)
        } catch {
            return []
        } finally {
            await client.end()
        }
    }
}
