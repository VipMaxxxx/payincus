import { Prisma } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '../db/prisma.js'
import { generateAgentId, generateAgentSecret, hashAgentSecret } from './agent-auth.js'
import { decryptSensitiveData, encryptSensitiveData } from './security.js'

export interface HostAgentRecord {
  id: number
  hostId: number
  agentId: string
  secretHash: string
  secretEncrypted: string
  installTokenHash: string | null
  installTokenExpiresAt: Date | null
  installTokenUsedAt: Date | null
  enabled: boolean
  status: string
  version: string | null
  capabilities: unknown
  lastReport: unknown
  lastSeenAt: Date | null
  lastHeartbeatIp: string | null
  createdAt: Date
  updatedAt: Date
}

const agentModel = prisma.hostAgent
const nonceModel = prisma.hostAgentNonce
const agentInstallTokenPrefix = 'ait_'
const agentInstallTokenTtlMs = 30 * 60 * 1000

async function generateUniqueAgentId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const agentId = generateAgentId()
    const existing = await agentModel.findUnique({
      where: { agentId },
      select: { id: true }
    })
    if (!existing) {
      return agentId
    }
  }
  throw new Error('Unable to generate unique Agent ID')
}

export async function rotateHostAgentCredentials(hostId: number, enabled = true): Promise<{
  host: { id: number; name: string }
  agent: HostAgentRecord
  agentId: string
  agentSecret: string
}> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: { id: true, name: true }
  })
  if (!host) {
    throw new Error('HOST_NOT_FOUND')
  }

  const existingAgent = await agentModel.findUnique({
    where: { hostId },
    select: { agentId: true }
  })
  if (existingAgent) {
    // 轮换 agentId 前先清理旧 nonce，避免外键阻止 agent_id 更新。
    await nonceModel.deleteMany({ where: { agentId: existingAgent.agentId } })
  }

  const agentId = await generateUniqueAgentId()
  const agentSecret = generateAgentSecret()
  const agent = await agentModel.upsert({
    where: { hostId },
    create: {
      hostId,
      agentId,
      secretHash: hashAgentSecret(agentSecret),
      secretEncrypted: encryptSensitiveData(agentSecret),
      installTokenHash: null,
      installTokenExpiresAt: null,
      installTokenUsedAt: null,
      enabled,
      status: 'offline'
    },
    update: {
      agentId,
      secretHash: hashAgentSecret(agentSecret),
      secretEncrypted: encryptSensitiveData(agentSecret),
      installTokenHash: null,
      installTokenExpiresAt: null,
      installTokenUsedAt: null,
      enabled,
      status: 'offline',
      version: null,
      capabilities: [] as Prisma.InputJsonValue,
      lastReport: {} as Prisma.InputJsonObject,
      lastSeenAt: null,
      lastHeartbeatIp: null
    }
  })

  return {
    host,
    agent,
    agentId,
    agentSecret
  }
}

function generateAgentInstallToken(): string {
  return `${agentInstallTokenPrefix}${randomBytes(32).toString('base64url')}`
}

function hashAgentInstallToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isAgentInstallToken(value: string): boolean {
  return value.startsWith(agentInstallTokenPrefix) && value.length >= agentInstallTokenPrefix.length + 32
}

export async function issueHostAgentInstallToken(hostId: number, enabled = true): Promise<{
  host: { id: number; name: string }
  agent: HostAgentRecord
  installToken: string
  installTokenExpiresAt: Date
}> {
  const rotated = await rotateHostAgentCredentials(hostId, enabled)
  const installToken = generateAgentInstallToken()
  const installTokenExpiresAt = new Date(Date.now() + agentInstallTokenTtlMs)

  const agent = await agentModel.update({
    where: { id: rotated.agent.id },
    data: {
      installTokenHash: hashAgentInstallToken(installToken),
      installTokenExpiresAt,
      installTokenUsedAt: null
    }
  })

  return {
    host: rotated.host,
    agent,
    installToken,
    installTokenExpiresAt
  }
}

export async function consumeHostAgentInstallToken(token: string): Promise<{
  host: { id: number; name: string }
  agent: HostAgentRecord
  agentSecret: string
}> {
  if (!isAgentInstallToken(token)) {
    throw new Error('AGENT_INSTALL_TOKEN_INVALID')
  }

  const tokenHash = hashAgentInstallToken(token)
  const agent = await agentModel.findUnique({
    where: { installTokenHash: tokenHash },
    include: {
      host: {
        select: { id: true, name: true }
      }
    }
  })

  if (!agent || !agent.installTokenExpiresAt || agent.installTokenUsedAt) {
    throw new Error('AGENT_INSTALL_TOKEN_INVALID')
  }
  if (agent.installTokenExpiresAt < new Date()) {
    throw new Error('AGENT_INSTALL_TOKEN_EXPIRED')
  }

  const updated = await agentModel.updateMany({
    where: {
      id: agent.id,
      installTokenHash: tokenHash,
      installTokenUsedAt: null,
      installTokenExpiresAt: { gte: new Date() }
    },
    data: {
      installTokenHash: null,
      installTokenExpiresAt: null,
      installTokenUsedAt: new Date()
    }
  })
  if (updated.count !== 1) {
    throw new Error('AGENT_INSTALL_TOKEN_INVALID')
  }

  const agentSecret = decryptSensitiveData(agent.secretEncrypted)
  if (!agentSecret) {
    throw new Error('AGENT_SECRET_INVALID')
  }

  const { host, ...agentRecord } = agent
  return {
    host,
    agent: agentRecord,
    agentSecret
  }
}
