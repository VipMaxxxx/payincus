/**
 * 敏感操作二次验证路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
    requestOperationVerification,
    verifyOperationCode,
    isOperationVerified,
    isAccountOperation,
    isResourceOperation,
    isResourceVerificationRequired,
    getOperationName,
    OperationType
} from '../lib/operation-verification.js'

// 有效的操作类型列表
const VALID_OPERATION_TYPES: OperationType[] = [
    'change_password',
    'disable_2fa',
    'change_email',
    'delete_account',
    'delete_instance',
    'reinstall_instance',
    'recreate_instance',
    'transfer_instance',
    'delete_snapshot',
    'delete_backup'
]

export default async function verificationRoutes(fastify: FastifyInstance) {
    /**
     * 请求二次验证码
     * POST /api/verification/request
     */
    fastify.post<{
        Body: {
            operationType: OperationType
            resourceId?: number
            resourceType?: string
        }
    }>(
        '/request',
        {
            onRequest: [fastify.authenticate],
            schema: {
                body: {
                    type: 'object',
                    required: ['operationType'],
                    properties: {
                        operationType: { type: 'string', enum: VALID_OPERATION_TYPES },
                        resourceId: { type: 'number' },
                        resourceType: { type: 'string' }
                    }
                }
            }
        },
        async (request: FastifyRequest<{
            Body: {
                operationType: OperationType
                resourceId?: number
                resourceType?: string
            }
        }>, reply: FastifyReply) => {
            const user = request.user!
            const { operationType, resourceId, resourceType } = request.body

            // 资源操作：检查是否需要二次验证
            if (isResourceOperation(operationType)) {
                const required = await isResourceVerificationRequired(user.id)
                if (!required) {
                    // 用户没有绑定通知渠道，不需要二次验证
                    return {
                        success: true,
                        required: false,
                        message: 'No notification channel configured, verification not required'
                    }
                }
            }

            const result = await requestOperationVerification(
                user.id,
                operationType,
                resourceId,
                resourceType
            )

            if (!result.success) {
                // 特殊处理：已发送过验证码
                if (result.expiresIn) {
                    return {
                        success: true,
                        channel: result.channel,
                        maskedTarget: result.maskedTarget,
                        expiresIn: result.expiresIn,
                        message: 'Verification code already sent'
                    }
                }
                
                return reply.code(400).send({
                    error: result.error,
                    code: result.errorCode || 'VERIFICATION_FAILED'
                })
            }

            return {
                success: true,
                required: true,
                channel: result.channel,
                maskedTarget: result.maskedTarget,
                expiresIn: result.expiresIn,
                operationName: getOperationName(operationType, 'zh')
            }
        }
    )

    /**
     * 验证二次验证码
     * POST /api/verification/verify
     */
    fastify.post<{
        Body: {
            operationType: OperationType
            code: string
            resourceId?: number
        }
    }>(
        '/verify',
        {
            onRequest: [fastify.authenticate],
            schema: {
                body: {
                    type: 'object',
                    required: ['operationType', 'code'],
                    properties: {
                        operationType: { type: 'string', enum: VALID_OPERATION_TYPES },
                        code: { type: 'string', minLength: 6, maxLength: 6 },
                        resourceId: { type: 'number' }
                    }
                }
            }
        },
        async (request: FastifyRequest<{
            Body: {
                operationType: OperationType
                code: string
                resourceId?: number
            }
        }>, reply: FastifyReply) => {
            const user = request.user!
            const { operationType, code, resourceId } = request.body

            const result = await verifyOperationCode(
                user.id,
                operationType,
                code,
                resourceId
            )

            if (!result.success || !result.verified) {
                return reply.code(400).send({
                    error: result.error || 'Verification failed',
                    code: result.errorCode || 'INVALID_CODE'
                })
            }

            return {
                success: true,
                verified: true,
                message: 'Verification successful'
            }
        }
    )

    /**
     * 检查操作是否已通过验证
     * GET /api/verification/check
     */
    fastify.get<{
        Querystring: {
            operationType: OperationType
            resourceId?: string
        }
    }>(
        '/check',
        {
            onRequest: [fastify.authenticate],
            schema: {
                querystring: {
                    type: 'object',
                    required: ['operationType'],
                    properties: {
                        operationType: { type: 'string', enum: VALID_OPERATION_TYPES },
                        resourceId: { type: 'string' }
                    }
                }
            }
        },
        async (request: FastifyRequest<{
            Querystring: {
                operationType: OperationType
                resourceId?: string
            }
        }>, _reply: FastifyReply) => {
            const user = request.user!
            const { operationType, resourceId } = request.query

            // 资源操作：检查是否需要二次验证
            if (isResourceOperation(operationType)) {
                const required = await isResourceVerificationRequired(user.id)
                if (!required) {
                    return {
                        required: false,
                        verified: true
                    }
                }
            }

            const verified = await isOperationVerified(
                user.id,
                operationType,
                resourceId ? parseInt(resourceId, 10) : undefined
            )

            return {
                required: isAccountOperation(operationType) || await isResourceVerificationRequired(user.id),
                verified
            }
        }
    )

    /**
     * 获取操作类型信息
     * GET /api/verification/operation-types
     */
    fastify.get(
        '/operation-types',
        {
            onRequest: [fastify.authenticate]
        },
        async (_request, _reply) => {
            const accountOperations = VALID_OPERATION_TYPES
                .filter(isAccountOperation)
                .map(op => ({
                    type: op,
                    name: getOperationName(op, 'zh'),
                    nameEn: getOperationName(op, 'en'),
                    channel: 'email'
                }))

            const resourceOperations = VALID_OPERATION_TYPES
                .filter(isResourceOperation)
                .map(op => ({
                    type: op,
                    name: getOperationName(op, 'zh'),
                    nameEn: getOperationName(op, 'en'),
                    channel: 'notification'
                }))

            return {
                accountOperations,
                resourceOperations
            }
        }
    )
}
