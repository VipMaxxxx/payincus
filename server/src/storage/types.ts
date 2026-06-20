/**
 * 存储适配器接口定义
 */

import { Readable } from 'stream'

export interface IStorageProvider {
    /**
     * 上传流到远程存储
     * @param fileStream 文件流
     * @param filename 远程文件名
     */
    uploadStream(fileStream: Readable, filename: string): Promise<void>

    /**
     * 测试连接
     */
    testConnection(): Promise<void>

    /**
     * 删除文件（用于回滚）
     * @param filename 远程文件名
     */
    deleteFile(filename: string): Promise<void>

    /**
     * 列出目录文件（可选）
     * @param path 目录路径
     */
    listFiles?(path?: string): Promise<string[]>
}

export interface StorageConfigData {
    type: 'S3' | 'WEBDAV' | 'FTP' | 'SFTP'
    host: string
    port?: number | null
    username?: string | null
    password?: string | null  // 已解密的密码
    basePath?: string | null
    extra?: Record<string, unknown> | null
}

// S3 扩展配置（预留）
export interface S3ExtraConfig {
    bucket: string
    region: string
    accessKeyId: string
    secretAccessKey: string  // 已解密
    endpoint?: string  // 自定义端点（如 MinIO）
    forcePathStyle?: boolean
}
