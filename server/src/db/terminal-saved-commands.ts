import { prisma } from './prisma.js'
import { decryptSensitiveData, encryptSensitiveData, isEncrypted } from '../lib/security.js'

const MAX_COMMANDS_PER_USER = 100
const MAX_COMMAND_SIZE = 16 * 1024
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g

function normalizeCommandLabel(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(CONTROL_CHARS_REGEX, '')
    .trim()
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (!value) return null

  const normalized = value
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS_REGEX, '')
    .trim()

  return normalized || null
}

export interface TerminalSavedCommandData {
  id: number
  userId: number
  name: string
  command: string
  description: string | null
  createdAt: string
  updatedAt: string
}

function mapTerminalSavedCommand(command: {
  id: number
  userId: number
  name: string
  command: string
  description: string | null
  createdAt: Date | string
  updatedAt: Date | string
}): TerminalSavedCommandData {
  const decryptedName = isEncrypted(command.name) ? (decryptSensitiveData(command.name) || command.name) : command.name
  const decryptedCommand = isEncrypted(command.command) ? (decryptSensitiveData(command.command) || command.command) : command.command
  const decryptedDescription = command.description
    ? (isEncrypted(command.description) ? (decryptSensitiveData(command.description) || command.description) : command.description)
    : null
  const createdAt = command.createdAt instanceof Date
    ? command.createdAt.toISOString()
    : new Date(command.createdAt).toISOString()
  const updatedAt = command.updatedAt instanceof Date
    ? command.updatedAt.toISOString()
    : new Date(command.updatedAt).toISOString()

  return {
    id: command.id,
    userId: command.userId,
    name: decryptedName,
    command: decryptedCommand,
    description: decryptedDescription,
    createdAt,
    updatedAt
  }
}

export async function getTerminalSavedCommandsByUserId(userId: number): Promise<TerminalSavedCommandData[]> {
  const commands = await prisma.$queryRawUnsafe<Array<{
    id: number
    userId: number
    name: string
    command: string
    description: string | null
    createdAt: Date
    updatedAt: Date
  }>>(
    `
      SELECT
        id,
        user_id AS "userId",
        name,
        command,
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM terminal_saved_commands
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC
    `,
    userId
  )

  return commands.map(mapTerminalSavedCommand)
}

export async function getTerminalSavedCommandById(id: number, userId: number): Promise<TerminalSavedCommandData | null> {
  const commands = await prisma.$queryRawUnsafe<Array<{
    id: number
    userId: number
    name: string
    command: string
    description: string | null
    createdAt: Date
    updatedAt: Date
  }>>(
    `
      SELECT
        id,
        user_id AS "userId",
        name,
        command,
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM terminal_saved_commands
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    id,
    userId
  )
  const command = commands[0] || null

  return command ? mapTerminalSavedCommand(command) : null
}

export async function createTerminalSavedCommand(data: {
  userId: number
  name: string
  command: string
  description?: string | null
}): Promise<{ success: true; command: TerminalSavedCommandData } | { success: false; error: string }> {
  const name = normalizeCommandLabel(data.name)
  const command = data.command
  const description = normalizeDescription(data.description)

  if (!name) {
    return { success: false, error: 'INVALID_NAME' }
  }

  if (!command.trim()) {
    return { success: false, error: 'INVALID_COMMAND' }
  }

  if (Buffer.byteLength(command, 'utf-8') > MAX_COMMAND_SIZE) {
    return { success: false, error: 'COMMAND_TOO_LARGE' }
  }

  const countRows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `
      SELECT COUNT(*)::int AS count
      FROM terminal_saved_commands
      WHERE user_id = $1
    `,
    data.userId
  )
  const count = countRows[0]?.count || 0

  if (count >= MAX_COMMANDS_PER_USER) {
    return { success: false, error: 'MAX_COMMANDS_REACHED' }
  }

  const createdRows = await prisma.$queryRawUnsafe<Array<{
    id: number
    userId: number
    name: string
    command: string
    description: string | null
    createdAt: Date
    updatedAt: Date
  }>>(
    `
      INSERT INTO terminal_saved_commands (user_id, name, command, description, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING
        id,
        user_id AS "userId",
        name,
        command,
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    data.userId,
    encryptSensitiveData(name),
    encryptSensitiveData(command),
    description ? encryptSensitiveData(description) : null
  )
  const created = createdRows[0]

  return {
    success: true,
    command: mapTerminalSavedCommand(created)
  }
}

export async function updateTerminalSavedCommand(
  id: number,
  userId: number,
  data: {
    name?: string
    command?: string
    description?: string | null
  }
): Promise<{ success: true; command: TerminalSavedCommandData } | { success: false; error: string }> {
  const existingRows = await prisma.$queryRawUnsafe<Array<{
    id: number
    userId: number
    name: string
    command: string
    description: string | null
    createdAt: Date
    updatedAt: Date
  }>>(
    `
      SELECT
        id,
        user_id AS "userId",
        name,
        command,
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM terminal_saved_commands
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    id,
    userId
  )
  const existing = existingRows[0] ? mapTerminalSavedCommand(existingRows[0]) : null

  if (!existing) {
    return { success: false, error: 'NOT_FOUND' }
  }

  const nextName = data.name !== undefined ? normalizeCommandLabel(data.name) : existing.name
  const nextCommand = data.command !== undefined ? data.command : existing.command
  const nextDescription = data.description !== undefined
    ? normalizeDescription(data.description)
    : existing.description

  if (!nextName) {
    return { success: false, error: 'INVALID_NAME' }
  }

  if (!nextCommand.trim()) {
    return { success: false, error: 'INVALID_COMMAND' }
  }

  if (Buffer.byteLength(nextCommand, 'utf-8') > MAX_COMMAND_SIZE) {
    return { success: false, error: 'COMMAND_TOO_LARGE' }
  }

  const updatedRows = await prisma.$queryRawUnsafe<Array<{
    id: number
    userId: number
    name: string
    command: string
    description: string | null
    createdAt: Date
    updatedAt: Date
  }>>(
    `
      UPDATE terminal_saved_commands
      SET
        name = $1,
        command = $2,
        description = $3,
        updated_at = NOW()
      WHERE id = $4 AND user_id = $5
      RETURNING
        id,
        user_id AS "userId",
        name,
        command,
        description,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    encryptSensitiveData(nextName),
    encryptSensitiveData(nextCommand),
    nextDescription ? encryptSensitiveData(nextDescription) : null,
    id,
    userId
  )
  const updated = updatedRows[0]

  return {
    success: true,
    command: mapTerminalSavedCommand(updated)
  }
}

export async function deleteTerminalSavedCommand(id: number, userId: number): Promise<boolean> {
  const result = await prisma.$executeRawUnsafe(
    `
      DELETE FROM terminal_saved_commands
      WHERE id = $1 AND user_id = $2
    `,
    id,
    userId
  )

  return Number(result) > 0
}
