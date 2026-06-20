/**
 * WebDAV 存储适配器
 */

import { createClient, WebDAVClient } from 'webdav'
import { Readable } from 'stream'
import type { IStorageProvider, StorageConfigData } from '../types.js'
import { assertSafeStorageTarget } from '../../lib/outbound-security.js'

export class WebDavProvider implements IStorageProvider {
    private client: WebDAVClient
    private basePath: string
    private rawHost: string

    constructor(config: StorageConfigData) {
        // 构建 WebDAV URL
        const port = config.port ? `:${config.port}` : ''
        const baseUrl = config.host.includes('://')
            ? `${config.host}${port}`
            : `https://${config.host}${port}`

        this.rawHost = config.host

        this.basePath = config.basePath?.endsWith('/')
            ? config.basePath
            : `${config.basePath || ''}/`

        this.client = createClient(baseUrl, {
            username: config.username || undefined,
            password: config.password || undefined,
            // 大文件上传需要更长的超时时间
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        })
    }

    async uploadStream(fileStream: Readable, filename: string): Promise<void> {
        await assertSafeStorageTarget('WEBDAV', this.rawHost)
        const remotePath = this.basePath + filename

        // 确保目录存在
        try {
            const dirExists = await this.client.exists(this.basePath)
            if (!dirExists) {
                await this.client.createDirectory(this.basePath, { recursive: true })
            }
        } catch {
            // 忽略目录创建错误，可能已存在
        }

        // 使用 putFileContents 的流模式
        const writeStream = this.client.createWriteStream(remotePath)

        return new Promise((resolve, reject) => {
            fileStream.pipe(writeStream)
            writeStream.on('finish', resolve)
            writeStream.on('error', reject)
            fileStream.on('error', reject)
        })
    }

    async testConnection(): Promise<void> {
        try {
            await assertSafeStorageTarget('WEBDAV', this.rawHost)
            // 尝试获取根目录内容来测试连接
            await this.client.getDirectoryContents('/')
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`WebDAV 连接测试失败: ${message}`)
        }
    }

    async deleteFile(filename: string): Promise<void> {
        await assertSafeStorageTarget('WEBDAV', this.rawHost)
        const remotePath = this.basePath + filename
        try {
            await this.client.deleteFile(remotePath)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`删除文件失败: ${message}`)
        }
    }

    async listFiles(path?: string): Promise<string[]> {
        await assertSafeStorageTarget('WEBDAV', this.rawHost)
        const targetPath = path || this.basePath
        try {
            const contents = await this.client.getDirectoryContents(targetPath)
            if (Array.isArray(contents)) {
                return contents.map(item => item.basename)
            }
            return []
        } catch {
            return []
        }
    }
}
