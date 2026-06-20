/**
 * Email verification code database operations
 */

import { prisma } from './prisma.js'
import crypto from 'crypto'

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

/**
 * Create a new email verification code
 */
export async function createVerificationCode(email: string): Promise<{ code: string; expiresAt: Date } | null> {
    const normalizedEmail = email.toLowerCase().trim()
    
    // Check rate limit
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentCount = await prisma.emailVerificationCode.count({
        where: {
            email: normalizedEmail,
            createdAt: { gte: oneHourAgo }
        }
    })

    if (recentCount >= MAX_CODES_PER_HOUR) {
        return null // Rate limited
    }

    // Delete any existing codes for this email
    await prisma.emailVerificationCode.deleteMany({
        where: { email: normalizedEmail }
    })

    // Generate new code
    const code = generateVerificationCode()
    const expiresAt = new Date(Date.now() + CODE_EXPIRATION_MINUTES * 60 * 1000)

    await prisma.emailVerificationCode.create({
        data: {
            email: normalizedEmail,
            code,
            expiresAt
        }
    })

    return { code, expiresAt }
}

/**
 * Verify an email verification code
 */
export async function verifyCode(email: string, code: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    
    const record = await prisma.emailVerificationCode.findFirst({
        where: {
            email: normalizedEmail,
            code,
            expiresAt: { gt: new Date() }
        }
    })

    if (!record) {
        return false
    }

    // Delete the code after successful verification
    await prisma.emailVerificationCode.delete({
        where: { id: record.id }
    })

    return true
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
export async function hasPendingCode(email: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    
    const count = await prisma.emailVerificationCode.count({
        where: {
            email: normalizedEmail,
            expiresAt: { gt: new Date() }
        }
    })

    return count > 0
}

