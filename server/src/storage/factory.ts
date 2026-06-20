/**
 * 存储适配器工厂
 */

import type { StorageConfig } from '@prisma/client'
import { decryptSensitiveData } from '../lib/security.js'
import type { IStorageProvider, StorageConfigData } from './types.js'
import { WebDavProvider } from './providers/WebDavProvider.js'
import { FtpProvider } from './providers/FtpProvider.js'
import { SftpProvider } from './providers/SftpProvider.js'

export class StorageFactory {
    /**
     * 根据存储配置创建对应的适配器实例
     */
    static create(config: StorageConfig): IStorageProvider {
        // 解密密码
        const decryptedPassword = config.password
            ? decryptSensitiveData(config.password)
            : null

        const secureConfig: StorageConfigData = {
            type: config.type,
            host: config.host,
            port: config.port,
            username: config.username,
            password: decryptedPassword,
            basePath: config.basePath,
            extra: config.extra as Record<string, unknown> | null
        }

        switch (config.type) {
            case 'WEBDAV':
                return new WebDavProvider(secureConfig)
            case 'FTP':
                return new FtpProvider(secureConfig)
            case 'SFTP':
                return new SftpProvider(secureConfig)
            case 'S3':
                throw new Error('S3 存储暂未实现，敬请期待')
            default:
                throw new Error(`未知的存储类型: ${config.type}`)
        }
    }

    /**
     * 测试存储配置连接（不需要保存到数据库）
     */
    static async testConnection(config: StorageConfigData): Promise<void> {
        let provider: IStorageProvider

        switch (config.type) {
            case 'WEBDAV':
                provider = new WebDavProvider(config)
                break
            case 'FTP':
                provider = new FtpProvider(config)
                break
            case 'SFTP':
                provider = new SftpProvider(config)
                break
            case 'S3':
                throw new Error('S3 存储暂未实现，敬请期待')
            default:
                throw new Error(`未知的存储类型: ${config.type}`)
        }

        await provider.testConnection()
    }
}
