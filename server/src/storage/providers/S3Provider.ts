/**
 * S3-compatible storage adapter.
 */

import {
    DeleteObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client
} from '@aws-sdk/client-s3'
import { Readable } from 'stream'
import type { IStorageProvider, StorageConfigData } from '../types.js'
import { assertSafeStorageTarget } from '../../lib/outbound-security.js'
import { joinStorageRemoteDirectory, joinStorageRemotePath, normalizeStorageBasePath } from '../path.js'

interface NormalizedS3Config {
    bucket: string
    region: string
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`S3 ${field} is required`)
    }
    return value.trim()
}

function buildEndpoint(host: string, port?: number | null): string {
    const trimmed = host.trim()
    if (!trimmed) {
        throw new Error('S3 endpoint host is required')
    }
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    if (port) url.port = String(port)
    return url.toString().replace(/\/$/, '')
}

function toObjectKey(path: string): string {
    return path.replace(/^\/+/, '')
}

function normalizeS3Config(config: StorageConfigData): NormalizedS3Config {
    const extra = config.extra || {}
    const bucket = requiredString(extra.bucket, 'bucket')
    const region = typeof extra.region === 'string' && extra.region.trim() ? extra.region.trim() : 'auto'
    const accessKeyId = requiredString(config.username, 'access key')
    const secretAccessKey = requiredString(config.password, 'secret key')
    const forcePathStyle = extra.forcePathStyle === true

    return {
        bucket,
        region,
        endpoint: buildEndpoint(config.host, config.port),
        accessKeyId,
        secretAccessKey,
        forcePathStyle
    }
}

export class S3Provider implements IStorageProvider {
    private readonly rawHost: string
    private readonly basePath: string
    private readonly s3Config: NormalizedS3Config
    private readonly client: S3Client

    constructor(config: StorageConfigData) {
        this.rawHost = config.host
        this.basePath = normalizeStorageBasePath(config.basePath)
        this.s3Config = normalizeS3Config(config)
        this.client = new S3Client({
            region: this.s3Config.region,
            endpoint: this.s3Config.endpoint,
            forcePathStyle: this.s3Config.forcePathStyle,
            credentials: {
                accessKeyId: this.s3Config.accessKeyId,
                secretAccessKey: this.s3Config.secretAccessKey
            }
        })
    }

    async uploadStream(fileStream: Readable, filename: string): Promise<void> {
        await assertSafeStorageTarget('S3', this.rawHost)
        await this.client.send(new PutObjectCommand({
            Bucket: this.s3Config.bucket,
            Key: toObjectKey(joinStorageRemotePath(this.basePath, filename)),
            Body: fileStream
        }))
    }

    async downloadStream(filename: string): Promise<Readable> {
        await assertSafeStorageTarget('S3', this.rawHost)
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.s3Config.bucket,
            Key: toObjectKey(joinStorageRemotePath(this.basePath, filename))
        }))

        if (!response.Body) {
            throw new Error('S3 object body is empty')
        }
        if (response.Body instanceof Readable) {
            return response.Body
        }
        return Readable.from(response.Body as AsyncIterable<Uint8Array>)
    }

    async testConnection(): Promise<void> {
        try {
            await assertSafeStorageTarget('S3', this.rawHost)
            await this.client.send(new ListObjectsV2Command({
                Bucket: this.s3Config.bucket,
                Prefix: toObjectKey(this.basePath),
                MaxKeys: 1
            }))
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`S3 连接测试失败: ${message}`)
        }
    }

    async deleteFile(filename: string): Promise<void> {
        await assertSafeStorageTarget('S3', this.rawHost)
        try {
            await this.client.send(new DeleteObjectCommand({
                Bucket: this.s3Config.bucket,
                Key: toObjectKey(joinStorageRemotePath(this.basePath, filename))
            }))
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            throw new Error(`删除文件失败: ${message}`)
        }
    }

    async listFiles(path?: string): Promise<string[]> {
        await assertSafeStorageTarget('S3', this.rawHost)
        try {
            const prefix = toObjectKey(joinStorageRemoteDirectory(this.basePath, path))
            const response = await this.client.send(new ListObjectsV2Command({
                Bucket: this.s3Config.bucket,
                Prefix: prefix
            }))
            const keys = response.Contents?.map(item => item.Key).filter((key): key is string => Boolean(key)) || []
            return keys.map(key => prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key).filter(Boolean)
        } catch {
            return []
        }
    }
}
