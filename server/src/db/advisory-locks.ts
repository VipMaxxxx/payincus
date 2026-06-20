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
