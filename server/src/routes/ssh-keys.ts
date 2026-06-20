/**
 * SSH 公钥管理路由
 * 用户可以管理用于实例的 SSH 公钥
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { validateName } from '../lib/security.js'
import crypto from 'crypto'

export default async function sshKeyRoutes(fastify: FastifyInstance) {

  // 获取用户的 SSH 公钥列表
  fastify.get('/', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest) => {
    const keys = await db.getSSHKeysByUserId(request.user.id)

    return {
      keys: keys.map(k => ({
        id: k.id,
        name: k.name,
        fingerprint: k.fingerprint,
        // 只返回公钥前后部分，安全考虑
        publicKeyPreview: truncateKey(k.public_key),
        createdAt: k.created_at
      }))
    }
  })

  // 获取单个 SSH 公钥详情
  fastify.get<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const keyId = Number(id)

    if (isNaN(keyId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const key = await db.getSSHKeyById(keyId)
    if (!key) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户SSH密钥操作
    if (key.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    return {
      key: {
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        publicKeyPreview: truncateKey(key.public_key),
        createdAt: key.created_at
      }
    }
  })

  // 添加 SSH 公钥
  fastify.post<{ Body: { name: string; publicKey: string } }>('/', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'publicKey'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 50 },
          publicKey: { type: 'string', minLength: 20 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: { name: string; publicKey: string } }>, reply: FastifyReply) => {
    const { name, publicKey } = request.body

    // 验证密钥名称（防止危险字符注入）
    const nameValidation = validateName(name, 'Key name', 1, 50)
    if (!nameValidation.valid) {
      return reply.code(400).send({ error: nameValidation.message })
    }

    // 验证并解析公钥
    const parsed = parseSSHPublicKey(publicKey.trim())
    if (!parsed) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_SSH_KEY))
    }

    // 计算指纹
    const fingerprint = calculateFingerprint(parsed.keyData)

    // 检查是否已存在相同指纹的密钥
    const existingKeys = await db.getSSHKeysByUserId(request.user.id)
    if (existingKeys.some(k => k.fingerprint === fingerprint)) {
      return reply.code(400).send(apiError(ErrorCode.SSH_KEY_EXISTS))
    }

    // 保存到数据库
    const keyId = await db.createSSHKey({
      userId: request.user.id,
      name,
      publicKey: publicKey.trim(),
      fingerprint
    })

    await createLog(request.user.id, 'ssh_key', 'ssh_key.add', `Added SSH key "${name}" [fingerprint: ${fingerprint}]`, 'success')

    reply.code(201).send({
      message: 'SSH key added',
      key: {
        id: keyId,
        name,
        fingerprint,
        publicKeyPreview: truncateKey(publicKey)
      }
    })
  })

  // 生成 SSH 密钥对
  // 使用 Node.js 原生 crypto 模块生成 Ed25519 密钥对
  // 返回私钥给用户保存，公钥自动保存到系统
  fastify.post('/generate', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // 检查用户密钥数量限制，防止滥用
    const existingKeys = await db.getSSHKeysByUserId(request.user.id)
    const MAX_SSH_KEYS = 20
    if (existingKeys.length >= MAX_SSH_KEYS) {
      return reply.code(400).send({ error: `Maximum ${MAX_SSH_KEYS} SSH keys allowed per user` })
    }

    // 生成 RSA 密钥对 (4096位)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    })

    // 将 PEM 格式的公钥转换为 OpenSSH 格式
    const sshPublicKey = convertRSAToOpenSSHFormat(publicKey)
    
    // RSA 私钥直接使用 PEM 格式（OpenSSH 支持）
    const sshPrivateKey = privateKey

    // 解析公钥获取 keyData
    const parsed = parseSSHPublicKey(sshPublicKey)
    if (!parsed) {
      return reply.code(500).send({ error: 'Failed to generate valid SSH key' })
    }

    // 计算指纹
    const fingerprint = calculateFingerprint(parsed.keyData)

    // 检查是否已存在相同指纹的密钥
    if (existingKeys.some(k => k.fingerprint === fingerprint)) {
      return reply.code(400).send({ error: 'Key already exists' })
    }

    // 生成5位随机字符后缀
    const randomSuffix = crypto.randomBytes(4).toString('base64url').slice(0, 5)
    const keyName = `Incudal-${randomSuffix}`

    // 保存公钥到数据库
    const keyId = await db.createSSHKey({
      userId: request.user.id,
      name: keyName,
      publicKey: sshPublicKey,
      fingerprint
    })

    await createLog(request.user.id, 'ssh_key', 'ssh_key.generate', `Generated SSH key "${keyName}" [fingerprint: ${fingerprint}]`, 'success')

    // 返回私钥给用户保存（系统不会保存私钥）
    return {
      message: 'SSH key generated',
      privateKey: sshPrivateKey,
      key: {
        id: keyId,
        name: keyName,
        fingerprint,
        publicKeyPreview: truncateKey(sshPublicKey)
      }
    }
  })

  // 删除 SSH 公钥
  fastify.delete<{ Params: { id: string } }>('/:id', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params
    const keyId = Number(id)

    if (isNaN(keyId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const key = await db.getSSHKeyById(keyId)
    if (!key) {
      return reply.code(404).send(apiError(ErrorCode.NOT_FOUND))
    }

    // 管理员只管理系统层面，不参与用户SSH密钥操作
    if (key.user_id !== request.user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    await db.deleteSSHKey(keyId)

    await createLog(request.user.id, 'ssh_key', 'ssh_key.delete', `Deleted SSH key "${key.name}" [fingerprint: ${key.fingerprint}]`, 'success')

    return { message: 'SSH key deleted' }
  })
}

/**
 * 解析 SSH 公钥
 * 支持 ssh-rsa, ssh-ed25519, ecdsa-sha2-nistp256 等格式
 */
function parseSSHPublicKey(key: string): { type: string; keyData: string; comment: string } | null {
  // 移除可能的换行和多余空格
  const cleanKey = key.replace(/\r?\n/g, ' ').trim()

  // SSH 公钥格式: <type> <base64-data> [comment]
  const match = cleanKey.match(/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-\S+)\s+([A-Za-z0-9+/=]+)(\s+.*)?$/)

  if (!match) {
    return null
  }

  return {
    type: match[1],
    keyData: match[2],
    comment: match[3] ? match[3].trim() : ''
  }
}

/**
 * 计算 SSH 公钥指纹
 * 使用 SHA-256
 */
function calculateFingerprint(base64KeyData: string): string {
  try {
    const keyBuffer = Buffer.from(base64KeyData, 'base64')
    const hash = crypto.createHash('sha256').update(keyBuffer).digest('base64')
    // 移除 base64 填充符并格式化
    return 'SHA256:' + hash.replace(/=+$/, '')
  } catch {
    return 'SHA256:unknown'
  }
}

/**
 * 截断公钥用于显示
 */
function truncateKey(publicKey: string): string {
  if (!publicKey || publicKey.length < 60) return publicKey
  return publicKey.substring(0, 30) + '...' + publicKey.substring(publicKey.length - 20)
}

/**
 * 写入 4 字节 big-endian 整数
 */
function writeUInt32BE(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value, 0)
  return buf
}

/**
 * 将 PEM 格式的 RSA 公钥转换为 OpenSSH 格式
 */
function convertRSAToOpenSSHFormat(pemPublicKey: string): string {
  // 使用 crypto 模块解析公钥
  const publicKeyObject = crypto.createPublicKey({
    key: pemPublicKey,
    format: 'pem'
  })
  
  // 导出为 JWK 格式获取 n 和 e
  const jwk = publicKeyObject.export({ format: 'jwk' }) as { n?: string; e?: string }
  if (!jwk.n || !jwk.e) {
    throw new Error('Failed to export RSA public key as JWK')
  }
  
  // 从 base64url 解码
  const n = Buffer.from(jwk.n, 'base64url')
  const e = Buffer.from(jwk.e, 'base64url')
  
  // RSA 模数需要确保最高位不是 1（否则会被解释为负数）
  // 如果最高位是 1，需要在前面加一个 0x00 字节
  const nWithPadding = n[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), n]) : n
  const eWithPadding = e[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), e]) : e
  
  // 构建 OpenSSH 格式: 类型长度 + 类型 + e长度 + e + n长度 + n
  const keyType = 'ssh-rsa'
  const keyTypeBuffer = Buffer.from(keyType, 'utf8')
  
  const blob = Buffer.concat([
    writeUInt32BE(keyTypeBuffer.length),
    keyTypeBuffer,
    writeUInt32BE(eWithPadding.length),
    eWithPadding,
    writeUInt32BE(nWithPadding.length),
    nWithPadding
  ])
  
  return `ssh-rsa ${blob.toString('base64')}`
}
