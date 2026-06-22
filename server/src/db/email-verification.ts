/**
 * Email verification code database operations
 */

import { prisma } from './prisma.js'
import crypto from 'crypto'

export type EmailVerificationPurpose = 'register' | 'password_reset' | 'change_email'

// Verification code expiration time in minutes
const CODE_EXPIRATION_MINUTES = 10

// Rate limit: max codes per email per hour
const MAX_CODES_PER_HOUR = 5

/**
 * Generate a cryptographically secure random 6-digit verification code
 */
export function generateVerificationCode(): string {
    // Use crypto.randomInt for secure random number generation
    const min = 100000
    const max = 999999
    return crypto.randomInt(min, max + 1).toString()
}

function hashVerificationCode(code: string): string {
    return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`
}

function verificationCodeMatches(storedCode: string, inputCode: string): boolean {
    if (storedCode.startsWith('sha256:')) {
        return storedCode === hashVerificationCode(inputCode)
    }

    return storedCode === inputCode
}

/**
 * Create a new email verification code
 */
export async function createVerificationCode(
    email: string,
    purpose: EmailVerificationPurpose
): Promise<{ code: string; expiresAt: Date } | null> {
    const normalizedEmail = email.toLowerCase().trim()
    const now = new Date()
    
    // Check rate limit
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const recentCount = await prisma.emailVerificationCode.count({
        where: {
            email: normalizedEmail,
            purpose,
            createdAt: { gte: oneHourAgo }
        }
    })

    if (recentCount >= MAX_CODES_PER_HOUR) {
        return null // Rate limited
    }

    // Expire existing pending codes so only the newest code works while recent rows remain for rate limiting.
    await prisma.emailVerificationCode.updateMany({
        where: {
            email: normalizedEmail,
            purpose: { in: [purpose, 'general'] },
            expiresAt: { gt: now }
        },
        data: {
            expiresAt: now
        }
    })

    // Generate new code
    const code = generateVerificationCode()
    const codeHash = hashVerificationCode(code)
    const expiresAt = new Date(now.getTime() + CODE_EXPIRATION_MINUTES * 60 * 1000)

    await prisma.emailVerificationCode.create({
        data: {
            email: normalizedEmail,
            purpose,
            code: codeHash,
            expiresAt
        }
    })

    return { code, expiresAt }
}

/**
 * Verify an email verification code
 */
export async function verifyCode(
    email: string,
    code: string,
    purpose: EmailVerificationPurpose
): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    const codeHash = hashVerificationCode(code)
    
    const candidates = await prisma.emailVerificationCode.findMany({
        where: {
            email: normalizedEmail,
            purpose: { in: [purpose, 'general'] },
            expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
    })
    const record = candidates.find(candidate => (
        candidate.code === codeHash || verificationCodeMatches(candidate.code, code)
    ))

    if (!record) {
        return false
    }

    // Claim the code atomically so repeated concurrent submissions fail cleanly.
    const claimed = await prisma.emailVerificationCode.deleteMany({
        where: { id: record.id }
    })

    return claimed.count === 1
}

/**
 * Delete expired verification codes (cleanup job)
 */
export async function cleanupExpiredCodes(): Promise<number> {
    const result = await prisma.emailVerificationCode.deleteMany({
        where: {
            expiresAt: { lt: new Date() }
        }
    })
    return result.count
}

/**
 * Check if an email has a valid pending verification code
 */
export async function hasPendingCode(
    email: string,
    purpose: EmailVerificationPurpose
): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    
    const count = await prisma.emailVerificationCode.count({
        where: {
            email: normalizedEmail,
            purpose: { in: [purpose, 'general'] },
            expiresAt: { gt: new Date() }
        }
    })

    return count > 0
}
