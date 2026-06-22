/**
 * FTP 存储适配器
 */

import * as ftp from 'basic-ftp'
import { Readable } from 'stream'
import type { IStorageProvider, StorageConfigData } from '../types.js'
import { assertSafeStorageTarget } from '../../lib/outbound-security.js'
import { joinStorageRemoteDirectory, joinStorageRemotePath, normalizeStorageBasePath } from '../path.js'

// FTP 超时配置（6小时，适合大型备份）
const FTP_TIMEOUT = 6 * 60 * 60 * 1000

export class FtpProvider implements IStorageProvider {
    private config: StorageConfigData
    private basePath: string

    constructor(config: StorageConfigData) {
        this.config = config
        this.basePath = normalizeStorageBasePath(config.basePath)
    }

    private async getClient(): Promise<ftp.Client> {
        await assertSafeStorageTarget('FTP', this.config.host)
        const client = new ftp.Client(FTP_TIMEOUT)
        client.ftp.verbose = false

        await client.access({
            host: this.config.host.replace(/^ftp:\/\//, ''),
            port: this.config.port || 21,
            user: this.config.username || 'anonymous',
            password: this.config.password || '',
            secure: false  // 普通 FTP
        })

        return client
    }

    async uploadStream(fileStream: Readable, filename: string): Promise<void> {
        const client = await this.getClient()

        try {
            // 确保目录存在
            if (this.basePath && this.basePath !== '/') {
                await client.ensureDir(this.basePath)
            }

            // 上传文件
            const remotePath = joinStorageRemotePath(this.basePath, filename)
            await client.uploadFrom(fileStream, remotePath)
        } finally {
            client.close()
        }
    }

    async testConnection(): Promise<void> {
        const client = await this.getClient()

        try {
            // 尝试列出目录来测试连接
            await client.list('/')
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`FTP 连接测试失败: ${message}`)
        } finally {
            client.close()
        }
    }

    async deleteFile(filename: string): Promise<void> {
        const client = await this.getClient()

        try {
            const remotePath = joinStorageRemotePath(this.basePath, filename)
            await client.remove(remotePath)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`删除文件失败: ${message}`)
        } finally {
            client.close()
        }
    }

    async listFiles(path?: string): Promise<string[]> {
        const client = await this.getClient()

        try {
            const targetPath = joinStorageRemoteDirectory(this.basePath, path)
            const list = await client.list(targetPath)
            return list.map(item => item.name)
        } catch {
            return []
        } finally {
            client.close()
        }
    }
}
