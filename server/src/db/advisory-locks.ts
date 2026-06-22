import { Prisma } from '@prisma/client'

export const HOST_TASK_CLAIM_LOCK_NAMESPACE = 4101
export const HOST_NOTIFICATION_EMAIL_LOCK_NAMESPACE = 4102
export const HOST_NOTIFICATION_EMAIL_LOCK_KEY = 1
export const TRANSFER_CREATE_LOCK_NAMESPACE = 4103
export const REDEEM_CODE_LOCK_NAMESPACE = 4104
export const HOSTING_BALANCE_LOG_LOCK_NAMESPACE = 4105
export const INSTANCE_OPERATION_LOCK_NAMESPACE = 4106
export const USER_DESTROY_BILLING_LOCK_NAMESPACE = 4107
export const USER_ADMIN_ROLE_LOCK_NAMESPACE = 4108
export const MAIL_SUBSCRIPTION_LOCK_NAMESPACE = 4109
export const USER_BALANCE_LOCK_NAMESPACE = 4110
export const USER_POINTS_LOCK_NAMESPACE = 4111
export const USER_AFF_BALANCE_LOCK_NAMESPACE = 4112
export const USER_BACKUP_UPLOAD_LOCK_NAMESPACE = 4113
export const USER_RESOURCE_POOL_LOCK_NAMESPACE = 4114
export const USER_VIP_BENEFIT_CLAIM_LOCK_NAMESPACE = 4115
export const MAIL_DOMAIN_LOCK_NAMESPACE = 4116
export const USER_EMAIL_REGISTRATION_LOCK_NAMESPACE = 4117
export const OPERATION_VERIFICATION_REQUEST_LOCK_NAMESPACE = 4118
export const IP_ADDRESS_ALLOCATION_LOCK_NAMESPACE = 4119

export async function tryAdvisoryTransactionLock(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: number
): Promise<boolean> {
  const result = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    SELECT pg_try_advisory_xact_lock(${namespace}, ${key}) AS locked
  `)

  return result[0]?.locked === true
}

export async function advisoryTransactionLock(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: number
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    WITH acquired_lock AS (
      SELECT pg_advisory_xact_lock(${namespace}, ${key})
    )
    SELECT true AS locked FROM acquired_lock
  `)
}

export async function advisoryTransactionLockString(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: string
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    WITH acquired_lock AS (
      SELECT pg_advisory_xact_lock(${namespace}, hashtext(${key}))
    )
    SELECT true AS locked FROM acquired_lock
  `)
}
