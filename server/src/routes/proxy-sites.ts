/**
 * 反代站点管理路由
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as tls from 'tls'
import * as dns from 'dns'
import { promisify } from 'util'
import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { apiError, ErrorCode } from '../lib/errors.js'
import { createCaddyClient } from '../lib/caddy-client.js'
import { getDnsRecordType } from '../lib/network-address.js'
import { requireInstanceViewPermission } from '../lib/permission.js'
import {
  createProxySite,
  getProxySitesByInstanceId,
  getProxySiteById,
  deleteProxySite,
  isDomainUsed,
  isValidDomain,
  updateProxySiteStatus,
  updateProxySite,
  getProxySiteCountByInstance
  // toggleProxySiteEnabled 已合并到 updateProxySiteStatus
} from '../db/proxy-sites.js'

// DNS 解析函数
const dnsResolve4 = promisify(dns.resolve4)
const dnsResolve6 = promisify(dns.resolve6)

export default async function proxySitesRoutes(fastify: FastifyInstance) {
  /**
   * 获取实例的反代站点列表
   * GET /instances/:id/sites
   */
  fastify.get<{
    Params: { id: string }
  }>('/instances/:id/sites', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 权限检查：实例所有者、宿主机所有者、管理员均可查看
    if (!(await requireInstanceViewPermission(user, instance, reply))) {
      return
    }

    // 检查宿主机 Caddy 是否启用
    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    const sites = await getProxySitesByInstanceId(instanceId)

    // 获取站点配额信息
    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const siteLimit = instance.site_limit ?? pkg?.site_limit ?? 10

    return {
      sites: sites.map(s => ({
        id: s.id,
        domain: s.domain,
        targetPort: s.targetPort,
        httpsEnabled: s.httpsEnabled,
        remark: s.remark,
        status: s.status,
        enabled: s.enabled,
        error: s.error,
        createdAt: s.createdAt
      })),
      caddyEnabled: host.caddy_enabled || false,
      // DNS 解析提示信息
      dnsRecordType: (host.nat_public_ip || host.ip_address) ? getDnsRecordType(host.nat_public_ip || host.ip_address || '') : null,
      dnsRecordValue: host.nat_public_ip || host.ip_address || null,
      // 站点配额信息
      siteQuota: {
        used: sites.length,
        limit: siteLimit
      },
      // 站点增删改仍保持实例所有者能力，管理员/宿主机所有者在详情页只读查看
      canManageSites: user.role !== 'admin' && instance.user_id === user.id
    }
  })

  /**
   * 添加反代站点
   * POST /instances/:id/sites
   */
  fastify.post<{
    Params: { id: string }
    Body: {
      domain: string
      targetPort: number
      httpsEnabled?: boolean
      remark?: string
    }
  }>('/instances/:id/sites', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        required: ['domain', 'targetPort'],
        properties: {
          domain: { type: 'string', minLength: 4 },
          targetPort: { type: 'integer', minimum: 1, maximum: 65535 },
          httpsEnabled: { type: 'boolean', default: true },
          remark: { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string }
    Body: {
      domain: string
      targetPort: number
      httpsEnabled?: boolean
      remark?: string
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const { domain, targetPort, httpsEnabled = true, remark } = request.body

    if (isNaN(instanceId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 域名格式验证
    const normalizedDomain = domain.toLowerCase().trim()
    if (!isValidDomain(normalizedDomain)) {
      return reply.code(400).send({ error: '域名格式无效（不支持泛域名）' })
    }

    const instance = await db.getInstanceById(instanceId)
    if (!instance) {
      return reply.code(404).send(apiError(ErrorCode.INSTANCE_NOT_FOUND))
    }

    // 封停状态不允许操作
    if (instance.status === 'suspended') {
      if (instance.suspend_reason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 权限检查
    if (instance.user_id !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    const host = await db.getHostById(instance.host_id)
    if (!host) {
      return reply.code(404).send(apiError(ErrorCode.HOST_NOT_FOUND))
    }

    // 检查 Caddy 是否启用
    if (!host.caddy_enabled) {
      return reply.code(400).send({ error: '请先在宿主机安装 Caddy' })
    }

    // 检查站点数量配额
    const currentSiteCount = await getProxySiteCountByInstance(instanceId)
    // 实例的 siteLimit 为 null 时，继承套餐的设置
    const pkg = instance.package_id ? await db.getPackageById(instance.package_id) : null
    const siteLimit = instance.site_limit ?? pkg?.site_limit ?? 10
    
    // siteLimit = 0 表示不限制
    if (siteLimit !== 0 && currentSiteCount >= siteLimit) {
      return reply.code(400).send({ 
        error: `已达到站点数量上限 (${siteLimit})`,
        code: 'SITE_LIMIT_EXCEEDED'
      })
    }

    // 检查域名是否已被使用
    if (await isDomainUsed(host.id, normalizedDomain)) {
      return reply.code(400).send({ error: '该域名已被使用' })
    }

    // 实例需要有内网 IP
    if (!instance.ipv4) {
      return reply.code(400).send({ error: '实例未分配 IPv4 地址' })
    }

    // 在数据库创建记录（状态为 pending，等待 DNS 解析）
    const site = await createProxySite({
      instanceId,
      hostId: host.id,
      domain: normalizedDomain,
      targetPort,
      httpsEnabled,
      remark: remark?.trim() || undefined
    })

    // 返回 DNS 解析提示，不立即发送到 Caddy
    const dnsRecordValue = host.nat_public_ip || host.ip_address || ''
    const dnsRecordType = dnsRecordValue ? getDnsRecordType(dnsRecordValue) : 'A'

    await createLog(
      user.id,
      'proxy',
      'site.create',
      `Created proxy site "${normalizedDomain}" (pending DNS)`,
      'success',
      { instanceId }
    )

    return {
      site: {
        id: site.id,
        domain: site.domain,
        targetPort: site.targetPort,
        httpsEnabled: site.httpsEnabled,
        status: 'pending'
      },
      dnsHint: {
        type: dnsRecordType,
        host: normalizedDomain,
        value: dnsRecordValue
      },
      message: '站点已创建，请配置 DNS 后点击“检测 DNS”激活'
    }
  })

  /**
   * 删除反代站点
   * DELETE /instances/:id/sites/:siteId
   */
  fastify.delete<{
    Params: { id: string; siteId: string }
  }>('/instances/:id/sites/:siteId', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const siteId = parseInt(request.params.siteId, 10)

    if (isNaN(instanceId) || isNaN(siteId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const site = await getProxySiteById(siteId)
    if (!site) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 验证站点属于该实例
    if (site.instanceId !== instanceId) {
      return reply.code(400).send({ error: '站点不属于该实例' })
    }

    // 封停状态不允许操作
    if (site.instance.status === 'suspended') {
      if (site.instance.suspendReason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    // 权限检查
    if (site.instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 从 Caddy 删除
    try {
      if (site.host.caddyEnabled && site.host.caddyUsername && site.host.caddyPassword) {
        const targetHost = site.host.natPublicIp || site.host.ipAddress || ''
        if (targetHost) {
          const client = createCaddyClient({
            host: targetHost,
            port: site.host.caddyPort || 8444,
            username: site.host.caddyUsername,
            password: site.host.caddyPassword
          })

          await client.deleteSite(site.domain)
        }
      }
    } catch (err) {
      request.log.error(err, 'Failed to remove site from Caddy')
      // 继续删除数据库记录
    }

    // 删除数据库记录
    await deleteProxySite(siteId)

    await createLog(
      user.id,
      'proxy',
      'site.delete',
      `Deleted proxy site "${site.domain}"`,
      'success',
      { instanceId }
    )

    return { message: '站点已删除' }
  })

  /**
   * 检测 DNS 并激活站点
   * POST /instances/:id/sites/:siteId/check-dns
   * 
   * 返回 DNS 检测结果，如果 DNS 正确则自动激活站点
   */
  fastify.post<{
    Params: { id: string; siteId: string }
  }>('/instances/:id/sites/:siteId/check-dns', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const siteId = parseInt(request.params.siteId, 10)

    if (isNaN(instanceId) || isNaN(siteId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const site = await getProxySiteById(siteId)
    if (!site || site.instanceId !== instanceId) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 封停状态不允许操作
    if (site.instance.status === 'suspended') {
      if (site.instance.suspendReason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (site.instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 获取宿主机公网 IP
    const expectedIp = site.host.natPublicIp || site.host.ipAddress
    if (!expectedIp) {
      return reply.code(400).send({ error: '宿主机未配置公网 IP' })
    }

    // 检测 DNS 解析
    let resolvedIps: string[] = []
    let dnsError: string | null = null

    try {
      // 尝试解析 IPv4
      const ipv4s = await dnsResolve4(site.domain)
      resolvedIps = resolvedIps.concat(ipv4s)
    } catch {
      // IPv4 解析失败
    }

    try {
      // 尝试解析 IPv6
      const ipv6s = await dnsResolve6(site.domain)
      resolvedIps = resolvedIps.concat(ipv6s)
    } catch {
      // IPv6 解析失败
    }

    if (resolvedIps.length === 0) {
      dnsError = 'DNS 未解析，请检查域名配置'
      return {
        dnsResolved: false,
        expectedIp,
        resolvedIps: [],
        error: dnsError,
        status: site.status
      }
    }

    // 检查 IP 是否匹配
    const ipMatches = resolvedIps.includes(expectedIp)
    
    if (!ipMatches) {
      dnsError = `DNS 解析到 ${resolvedIps.join(', ')}，但期望的是 ${expectedIp}`
      return {
        dnsResolved: true,
        ipMatches: false,
        expectedIp,
        resolvedIps,
        error: dnsError,
        status: site.status
      }
    }

    // DNS 正确，如果站点还是 pending 状态，自动激活
    if (site.status === 'pending') {
      try {
        if (!site.host.caddyEnabled || !site.host.caddyUsername || !site.host.caddyPassword) {
          throw new Error('Caddy 未启用')
        }

        const instanceIp = site.instance.ipv4
        if (!instanceIp) {
          throw new Error('实例未分配 IP')
        }

        const client = createCaddyClient({
          host: expectedIp,
          port: site.host.caddyPort || 8444,
          username: site.host.caddyUsername,
          password: site.host.caddyPassword
        })

        // 先删除可能存在的旧配置（防止实例删除时 Caddy 删除失败导致残留）
        try {
          await client.deleteSite(site.domain)
        } catch {
          // 删除失败不影响后续操作（可能路由不存在）
        }

        await client.addSite(site.domain, instanceIp, site.targetPort, site.httpsEnabled)
        await updateProxySiteStatus(site.id, 'active')

        await createLog(
          user.id,
          'proxy',
          'site.activate',
          `Activated proxy site "${site.domain}" after DNS verification`,
          'success',
          { instanceId }
        )

        return {
          dnsResolved: true,
          ipMatches: true,
          expectedIp,
          resolvedIps,
          activated: true,
          status: 'active',
          message: 'DNS 验证通过，站点已激活'
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await updateProxySiteStatus(site.id, 'error', errorMessage)
        request.log.error(err, 'Failed to activate site after DNS check')
        
        return {
          dnsResolved: true,
          ipMatches: true,
          expectedIp,
          resolvedIps,
          activated: false,
          status: 'error',
          error: `激活失败: ${errorMessage}`
        }
      }
    }

    // 站点已经是 active 或 error 状态
    return {
      dnsResolved: true,
      ipMatches: true,
      expectedIp,
      resolvedIps,
      status: site.status,
      message: site.status === 'active' ? '站点已激活' : '请点击刷新重试配置'
    }
  })

  /**
   * 刷新站点状态（重新尝试配置）
   * POST /instances/:id/sites/:siteId/refresh
   */
  fastify.post<{
    Params: { id: string; siteId: string }
  }>('/instances/:id/sites/:siteId/refresh', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const siteId = parseInt(request.params.siteId, 10)

    if (isNaN(instanceId) || isNaN(siteId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const site = await getProxySiteById(siteId)
    if (!site || site.instanceId !== instanceId) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 封停状态不允许操作
    if (site.instance.status === 'suspended') {
      if (site.instance.suspendReason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (site.instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 重新尝试配置
    try {
      // 禁用的站点不允许刷新
      if (!site.enabled) {
        return reply.code(400).send({ error: '站点已禁用，请先启用' })
      }

      if (!site.host.caddyEnabled || !site.host.caddyUsername || !site.host.caddyPassword) {
        return reply.code(400).send({ error: 'Caddy 未启用' })
      }

      const targetHost = site.host.natPublicIp || site.host.ipAddress
      if (!targetHost) {
        return reply.code(400).send({ error: '宿主机未配置公网 IP' })
      }

      const instanceIp = site.instance.ipv4
      if (!instanceIp) {
        return reply.code(400).send({ error: '实例未分配 IP' })
      }

      const client = createCaddyClient({
        host: targetHost,
        port: site.host.caddyPort || 8444,
        username: site.host.caddyUsername,
        password: site.host.caddyPassword
      })

      // 先删除旧路由（避免重复添加）
      try {
        await client.deleteSite(site.domain)
      } catch {
        // 删除失败不影响后续操作（可能路由不存在）
      }

      // 重新添加路由
      await client.addSite(site.domain, instanceIp, site.targetPort, site.httpsEnabled)
      await updateProxySiteStatus(site.id, 'active')

      await createLog(
        user.id,
        'proxy',
        'site.refresh',
        `Refreshed proxy site "${site.domain}"`,
        'success',
        { instanceId }
      )

      return { message: '站点配置已刷新', status: 'active' }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      await updateProxySiteStatus(site.id, 'error', errorMessage)

      await createLog(
        user.id,
        'proxy',
        'site.refresh',
        `Failed to refresh proxy site "${site.domain}": ${errorMessage}`,
        'failed',
        { instanceId }
      )

      return reply.code(500).send({ error: `配置失败: ${errorMessage}` })
    }
  })

  /**
   * 修改站点配置
   * PATCH /instances/:id/sites/:siteId
   */
  fastify.patch<{
    Params: { id: string; siteId: string }
    Body: {
      targetPort?: number
      httpsEnabled?: boolean
      remark?: string
    }
  }>('/instances/:id/sites/:siteId', {
    onRequest: [fastify.authenticateUser],
    schema: {
      body: {
        type: 'object',
        properties: {
          targetPort: { type: 'integer', minimum: 1, maximum: 65535 },
          httpsEnabled: { type: 'boolean' },
          remark: { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
    Body: {
      targetPort?: number
      httpsEnabled?: boolean
      remark?: string
    }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const siteId = parseInt(request.params.siteId, 10)
    const { targetPort, httpsEnabled, remark } = request.body

    if (isNaN(instanceId) || isNaN(siteId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    // 至少需要修改一个字段
    if (targetPort === undefined && httpsEnabled === undefined && remark === undefined) {
      return reply.code(400).send({ error: '请提供要修改的字段' })
    }

    const site = await getProxySiteById(siteId)
    if (!site || site.instanceId !== instanceId) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 封停状态不允许操作
    if (site.instance.status === 'suspended') {
      if (site.instance.suspendReason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (site.instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查站点是否启用
    if (!site.enabled) {
      return reply.code(400).send({ error: '请先启用站点' })
    }

    // 确定最终配置
    const newTargetPort = targetPort ?? site.targetPort
    const newHttpsEnabled = httpsEnabled ?? site.httpsEnabled
    const newRemark = remark !== undefined ? (remark.trim() || null) : site.remark

    // 检查是否只修改了 remark（不需要更新 Caddy）
    const onlyRemarkChanged = newTargetPort === site.targetPort && newHttpsEnabled === site.httpsEnabled && newRemark !== site.remark

    if (onlyRemarkChanged) {
      // 只修改备注，不需要更新 Caddy
      await updateProxySite(site.id, { remark: newRemark })
      
      await createLog(
        user.id,
        'proxy',
        'site.update',
        `Updated proxy site "${site.domain}" remark`,
        'success',
        { instanceId }
      )

      return {
        message: '站点备注已更新',
        site: {
          id: site.id,
          domain: site.domain,
          targetPort: site.targetPort,
          httpsEnabled: site.httpsEnabled,
          remark: newRemark,
          status: site.status
        }
      }
    }

    // 如果配置没有变化（包括 remark），直接返回
    if (newTargetPort === site.targetPort && newHttpsEnabled === site.httpsEnabled && newRemark === site.remark) {
      return { message: '配置无变化', site: { id: site.id, domain: site.domain, targetPort: site.targetPort, httpsEnabled: site.httpsEnabled, remark: site.remark, status: site.status } }
    }

    // 需要更新 Caddy 配置
    // 检查 Caddy 是否可用
    if (!site.host.caddyEnabled || !site.host.caddyUsername || !site.host.caddyPassword) {
      return reply.code(400).send({ error: 'Caddy 未启用' })
    }

    const targetHost = site.host.natPublicIp || site.host.ipAddress
    if (!targetHost) {
      return reply.code(400).send({ error: '宿主机未配置公网 IP' })
    }

    const instanceIp = site.instance.ipv4
    if (!instanceIp) {
      return reply.code(400).send({ error: '实例未分配 IP' })
    }

    // 确定最终配置
    const finalTargetPort = targetPort ?? site.targetPort
    const finalHttpsEnabled = httpsEnabled ?? site.httpsEnabled

    // 如果配置没有变化，直接返回
    if (finalTargetPort === site.targetPort && finalHttpsEnabled === site.httpsEnabled) {
      return { message: '配置无变化', site: { id: site.id, domain: site.domain, targetPort: site.targetPort, httpsEnabled: site.httpsEnabled, remark: site.remark, status: site.status } }
    }

    try {
      const client = createCaddyClient({
        host: targetHost,
        port: site.host.caddyPort || 8444,
        username: site.host.caddyUsername,
        password: site.host.caddyPassword
      })

      // 先删除旧路由
      await client.deleteSite(site.domain)

      // 再添加新路由
      await client.addSite(site.domain, instanceIp, finalTargetPort, finalHttpsEnabled)

      // 更新数据库
      await updateProxySite(site.id, {
        targetPort: finalTargetPort,
        httpsEnabled: finalHttpsEnabled,
        remark: newRemark,
        status: 'active',
        error: null
      })

      await createLog(
        user.id,
        'proxy',
        'site.update',
        `Updated proxy site "${site.domain}": port=${finalTargetPort}, https=${finalHttpsEnabled}`,
        'success',
        { instanceId }
      )

      return {
        message: '站点配置已更新',
        site: {
          id: site.id,
          domain: site.domain,
          targetPort: finalTargetPort,
          httpsEnabled: finalHttpsEnabled,
          remark: newRemark,
          status: 'active'
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      await updateProxySiteStatus(site.id, 'error', errorMessage)
      request.log.error(err, 'Failed to update site configuration')
      return reply.code(500).send({ error: `更新失败: ${errorMessage}` })
    }
  })

  /**
   * 切换站点启用状态
   * POST /instances/:id/sites/:siteId/toggle
   */
  fastify.post<{
    Params: { id: string; siteId: string }
  }>('/instances/:id/sites/:siteId/toggle', {
    onRequest: [fastify.authenticateUser]
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const siteId = parseInt(request.params.siteId, 10)

    if (isNaN(instanceId) || isNaN(siteId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const site = await getProxySiteById(siteId)
    if (!site || site.instanceId !== instanceId) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 封停状态不允许操作
    if (site.instance.status === 'suspended') {
      if (site.instance.suspendReason === 'expired') {
        return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED_EXPIRED))
      }
      return reply.code(403).send(apiError(ErrorCode.INSTANCE_SUSPENDED))
    }

    if (site.instance.userId !== user.id) {
      return reply.code(403).send(apiError(ErrorCode.FORBIDDEN))
    }

    // 检查 Caddy 是否启用
    if (!site.host.caddyEnabled || !site.host.caddyUsername || !site.host.caddyPassword) {
      return reply.code(400).send({ error: 'Caddy 未启用' })
    }

    const targetHost = site.host.natPublicIp || site.host.ipAddress
    if (!targetHost) {
      return reply.code(400).send({ error: '宿主机未配置公网 IP' })
    }

    const newEnabled = !site.enabled

    try {
      const client = createCaddyClient({
        host: targetHost,
        port: site.host.caddyPort || 8444,
        username: site.host.caddyUsername,
        password: site.host.caddyPassword
      })

      if (newEnabled) {
        // 启用站点：添加 Caddy 配置
        const instanceIp = site.instance.ipv4
        if (!instanceIp) {
          return reply.code(400).send({ error: '实例未分配 IP' })
        }
        // 先删除可能存在的旧配置（防止残留）
        try {
          await client.deleteSite(site.domain)
        } catch {
          // 删除失败不影响后续操作
        }
        await client.addSite(site.domain, instanceIp, site.targetPort, site.httpsEnabled)
        await updateProxySiteStatus(site.id, 'active', null, newEnabled)
      } else {
        // 禁用站点：删除 Caddy 配置
        await client.deleteSite(site.domain)
        await updateProxySiteStatus(site.id, 'pending', null, newEnabled)  // 设为 pending 表示未激活
      }

      // 更新数据库 enabled 状态
      // 注：已在 updateProxySiteStatus 中一并更新，此处移除独立调用
      // await toggleProxySiteEnabled(site.id, newEnabled)

      await createLog(
        user.id,
        'proxy',
        newEnabled ? 'site.enable' : 'site.disable',
        `${newEnabled ? 'Enabled' : 'Disabled'} proxy site "${site.domain}"`,
        'success',
        { instanceId }
      )

      return {
        message: newEnabled ? '站点已启用' : '站点已禁用',
        enabled: newEnabled,
        status: newEnabled ? 'active' : 'pending'
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      request.log.error(err, `Failed to ${newEnabled ? 'enable' : 'disable'} site`)
      return reply.code(500).send({ error: `操作失败: ${errorMessage}` })
    }
  })

  /**
   * 检查站点证书状态
   * GET /instances/:id/sites/:siteId/certificate
   */
  fastify.get<{
    Params: { id: string; siteId: string }
  }>('/instances/:id/sites/:siteId/certificate', {
    onRequest: [fastify.authenticate]
  }, async (request: FastifyRequest<{
    Params: { id: string; siteId: string }
  }>, reply: FastifyReply) => {
    const { user } = request
    const instanceId = parseInt(request.params.id, 10)
    const siteId = parseInt(request.params.siteId, 10)

    if (isNaN(instanceId) || isNaN(siteId)) {
      return reply.code(400).send(apiError(ErrorCode.INVALID_ID))
    }

    const site = await getProxySiteById(siteId)
    if (!site || site.instanceId !== instanceId) {
      return reply.code(404).send({ error: '站点不存在' })
    }

    // 证书状态属于查看类信息，允许实例所有者、宿主机所有者、管理员查看
    if (!(await requireInstanceViewPermission(user, {
      user_id: site.instance.userId,
      host_id: site.instance.hostId
    }, reply))) {
      return
    }

    // 如果未启用 HTTPS，返回特定状态
    if (!site.httpsEnabled) {
      return {
        httpsEnabled: false,
        status: 'disabled',
        message: 'HTTPS 未启用'
      }
    }

    // 如果站点还是 pending 状态，返回提示
    if (site.status === 'pending') {
      return {
        httpsEnabled: true,
        status: 'pending',
        hint: '站点待激活，请先配置 DNS 并点击“检测 DNS”'
      }
    }

    // 尝试通过 TLS 连接获取证书信息
    try {
      const certInfo = await new Promise<{
        valid: boolean
        issuer: string
        subject: string
        validFrom: string
        validTo: string
        daysRemaining: number
      }>((resolve, reject) => {
        const socket = tls.connect({
          host: site.domain,
          port: 443,
          servername: site.domain,
          rejectUnauthorized: false, // 允许自签名证书
          timeout: 10000
        }, () => {
          const cert = socket.getPeerCertificate()
          socket.end()

          if (!cert || !cert.subject) {
            reject(new Error('无法获取证书信息'))
            return
          }

          const validFrom = new Date(cert.valid_from)
          const validTo = new Date(cert.valid_to)
          const now = new Date()
          const daysRemaining = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

          // 检查证书是否有效
          const isValid = now >= validFrom && now <= validTo

          // 获取颁发者信息
          const issuerParts: string[] = []
          if (cert.issuer) {
            if (cert.issuer.O) issuerParts.push(cert.issuer.O)
            if (cert.issuer.CN) issuerParts.push(cert.issuer.CN)
          }

          resolve({
            valid: isValid,
            issuer: issuerParts.join(' - ') || 'Unknown',
            subject: cert.subject.CN || site.domain,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            daysRemaining
          })
        })

        socket.on('error', (err) => {
          reject(err)
        })

        socket.on('timeout', () => {
          socket.destroy()
          reject(new Error('连接超时'))
        })
      })

      return {
        httpsEnabled: true,
        status: 'valid',
        certificate: certInfo
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      
      // 分析错误类型
      let status = 'error'
      let hint = ''
      
      if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        status = 'dns_error'
        hint = 'DNS 未解析，请检查域名是否正确指向服务器'
      } else if (errorMessage.includes('ECONNREFUSED')) {
        status = 'connection_refused'
        hint = '连接被拒绝，请检查服务器 443 端口是否开放'
      } else if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
        status = 'timeout'
        hint = '连接超时，请检查网络连接'
      } else if (errorMessage.includes('handshake') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
        status = 'cert_pending'
        hint = '证书正在申请中，请稍后重试'
      } else if (errorMessage.includes('certificate') || errorMessage.includes('self signed')) {
        status = 'cert_pending'
        hint = '证书正在申请中，请稍后重试'
      } else if (errorMessage.includes('ECONNRESET')) {
        status = 'cert_pending'
        hint = '证书可能正在申请中，请稍后重试'
      }

      return {
        httpsEnabled: true,
        status,
        error: errorMessage,
        hint
      }
    }
  })
}
