import '../src/config/env.js'

// @ts-ignore - bcryptjs has its own types in this project setup
import bcrypt from 'bcryptjs'
import { closePrismaDatabase, prisma } from '../src/db/prisma.js'
import { invalidateUserAccessTokens, revokeAllUserRefreshTokens } from '../src/lib/security.js'

const unsafeProductionConfirmation = 'I_UNDERSTAND'
const minimumProductionPasswordLength = 12
const unsafePasswordPatterns = [
  /^admin123$/i,
  /^password$/i,
  /^admin$/i,
  /^default$/i,
  /^changeme$/i,
  /change[_-]?me/i,
  /replace/i,
  /generate/i,
  /example/i,
  /placeholder/i,
  /beforedeploy/i
]

function getPassword(): string {
  const password = (
    process.env.RESET_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    ''
  ).trim()

  if (!password) {
    throw new Error('RESET_ADMIN_PASSWORD or ADMIN_PASSWORD is required')
  }

  if (password.length < 6 || password.length > 128) {
    throw new Error('Admin password must be between 6 and 128 characters')
  }

  if (process.env.NODE_ENV === 'production') {
    const unsafeReason = getUnsafeProductionPasswordReason(password)
    if (unsafeReason && process.env.ALLOW_UNSAFE_ADMIN_PASSWORD !== unsafeProductionConfirmation) {
      throw new Error(
        `Refusing unsafe production admin password (${unsafeReason}). ` +
        `Set ALLOW_UNSAFE_ADMIN_PASSWORD=${unsafeProductionConfirmation} only for an intentional emergency reset.`
      )
    }
  }

  return password
}

function getUnsafeProductionPasswordReason(password: string): string | null {
  if (password.length < minimumProductionPasswordLength) {
    return `shorter than ${minimumProductionPasswordLength} characters`
  }

  if (unsafePasswordPatterns.some(pattern => pattern.test(password))) {
    return 'default or placeholder value'
  }

  return null
}

async function resetAdminPassword(): Promise<void> {
  const username = (process.env.RESET_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin').trim()
  const email = (process.env.RESET_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@isvoro.com').trim()
  const password = getPassword()
  const disable2FA = process.env.RESET_ADMIN_DISABLE_2FA === '1' || process.env.RESET_ADMIN_DISABLE_2FA === 'true'
  const passwordHash = await bcrypt.hash(password, 12)

  const existing = await prisma.user.findUnique({
    where: { username },
    include: { quota: true }
  })

  let userId: number

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email,
        passwordHash,
        role: 'admin',
        status: 'active',
        banReason: null,
        ...(disable2FA
          ? {
              twoFactorEnabled: false,
              twoFactorSecret: null,
              twoFactorRecoveryCodes: null
            }
          : {})
      }
    })

    if (!existing.quota) {
      await prisma.userQuota.create({
        data: {
          userId: existing.id,
          hostLimit: 1000,
          friendLimit: 1000,
          packageLimit: 1000
        }
      })
    }

    userId = existing.id
  } else {
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        role: 'admin',
        status: 'active',
        quota: {
          create: {
            hostLimit: 1000,
            friendLimit: 1000,
            packageLimit: 1000
          }
        }
      }
    })
    userId = user.id
  }

  await revokeAllUserRefreshTokens(userId)
  await invalidateUserAccessTokens(userId)

  console.log(`Admin password reset completed for ${username} (userId=${userId})`)
  if (disable2FA) {
    console.log(`Admin 2FA disabled for ${username}`)
  }
}

resetAdminPassword()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await closePrismaDatabase()
  })
