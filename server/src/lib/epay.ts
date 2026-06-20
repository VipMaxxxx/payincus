/**
 * 易支付 SDK - TypeScript 实现
 * 支持 V1 (MD5签名) 和 V2 (RSA签名) 两个版本
 */

import crypto from 'crypto'

// SDK 版本类型
export type EpayVersion = 'v1' | 'v2'

// V1 版本配置 (MD5签名)
export interface EpayConfigV1 {
  version: 'v1'
  apiurl: string        // 支付接口地址
  pid: string           // 商户ID
  key: string           // 商户密钥 (MD5)
}

// V2 版本配置 (RSA签名)
export interface EpayConfigV2 {
  version: 'v2'
  apiurl: string        // 支付接口地址
  pid: string           // 商户ID
  platform_public_key: string  // 平台公钥
  merchant_private_key: string // 商户私钥
}

// 兼容旧配置（默认V2）
export interface EpayConfigLegacy {
  apiurl: string
  pid: string
  platform_public_key: string
  merchant_private_key: string
}

export type EpayConfig = EpayConfigV1 | EpayConfigV2 | EpayConfigLegacy

export interface PayParams {
  type: string          // 支付方式：alipay, wxpay, qqpay, bank, jdpay
  out_trade_no: string  // 商户订单号
  name: string          // 商品名称
  money: string         // 付款金额
  notify_url: string    // 异步通知地址
  return_url: string    // 同步跳转地址
}

export interface CallbackData {
  pid?: string
  trade_no?: string
  out_trade_no?: string
  type?: string
  name?: string
  money?: string
  trade_status?: string
  sign?: string
  sign_type?: string
  timestamp?: string
  [key: string]: unknown
}

// 回调验证结果
export interface VerifyResult {
  valid: boolean           // 签名是否有效
  tradeSuccess: boolean    // 交易是否成功
  error?: string           // 错误信息
}

// 订单查询结果
export interface OrderQueryResult {
  success: boolean         // 查询是否成功
  paid: boolean            // 是否已支付
  trade_no?: string        // 易支付订单号
  out_trade_no?: string    // 商户订单号
  money?: string           // 支付金额
  type?: string            // 支付方式
  error?: string           // 错误信息
  rawData?: Record<string, unknown>  // 原始返回数据
}

// 易支付客户端接口
export interface IEpayClient {
  getPayLink(params: PayParams): string
  verify(data: CallbackData): boolean
  verifyWithStatus(data: CallbackData): VerifyResult  // 带交易状态验证
  queryOrder(outTradeNo: string): Promise<OrderQueryResult>  // 查询订单状态
}

/**
 * V1 版本易支付客户端 (MD5签名)
 * 适用于传统易支付平台
 */
export class EpayCoreV1 implements IEpayClient {
  private apiurl: string
  private pid: string
  private key: string
  private signType = 'MD5'

  constructor(config: EpayConfigV1) {
    this.apiurl = config.apiurl.endsWith('/') ? config.apiurl : config.apiurl + '/'
    this.pid = config.pid
    this.key = config.key
  }

  /**
   * 获取支付链接
   */
  getPayLink(params: PayParams): string {
    const requrl = this.apiurl + 'submit.php'
    const signedParams = this.buildRequestParam(params as unknown as Record<string, unknown>)
    const queryString = Object.entries(signedParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&')
    return `${requrl}?${queryString}`
  }

  /**
   * 验证回调签名 (MD5)
   */
  verify(data: CallbackData): boolean {
    if (!data || !data.sign) return false
    const sign = this.getSign(data as unknown as Record<string, string>)
    return sign === data.sign
  }

  /**
   * 验证回调签名并检查交易状态 (V1版本)
   * V1版本需要检查 trade_status === 'TRADE_SUCCESS'
   */
  verifyWithStatus(data: CallbackData): VerifyResult {
    if (!data || !data.sign) {
      return { valid: false, tradeSuccess: false, error: '缺少签名参数' }
    }

    // 验证签名
    const sign = this.getSign(data as unknown as Record<string, string>)
    if (sign !== data.sign) {
      return { valid: false, tradeSuccess: false, error: '签名验证失败' }
    }

    // V1版本必须检查 trade_status
    const tradeSuccess = data.trade_status === 'TRADE_SUCCESS'
    if (!tradeSuccess) {
      return { valid: true, tradeSuccess: false, error: `交易未成功: ${data.trade_status || '未知状态'}` }
    }

    return { valid: true, tradeSuccess: true }
  }

  /**
   * 构建请求参数
   */
  private buildRequestParam(params: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {}
    
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') {
        result[k] = String(v)
      }
    }
    
    result.pid = this.pid
    result.sign = this.getSign(result)
    result.sign_type = this.signType
    
    return result
  }

  /**
   * 生成 MD5 签名
   */
  private getSign(params: Record<string, string>): string {
    const signStr = this.getSignContent(params) + this.key
    return crypto.createHash('md5').update(signStr).digest('hex')
  }

  /**
   * 获取待签名字符串
   */
  private getSignContent(params: Record<string, unknown>): string {
    const keys = Object.keys(params).sort()
    const parts: string[] = []
    
    for (const k of keys) {
      const v = params[k]
      if (v === null || v === undefined || v === '' || k === 'sign' || k === 'sign_type') {
        continue
      }
      parts.push(`${k}=${v}`)
    }
    
    return parts.join('&')
  }

  /**
   * 查询订单状态 (V1版本)
   * 调用易支付 API 查询订单支付状态
   */
  async queryOrder(outTradeNo: string): Promise<OrderQueryResult> {
    try {
      const url = `${this.apiurl}api.php?act=order&pid=${encodeURIComponent(this.pid)}&key=${encodeURIComponent(this.key)}&out_trade_no=${encodeURIComponent(outTradeNo)}`
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      })
      
      if (!response.ok) {
        return { success: false, paid: false, error: `HTTP错误: ${response.status}` }
      }
      
      const data = await response.json() as Record<string, unknown>
      
      // 检查返回状态码
      if (data.code !== 1) {
        return { 
          success: false, 
          paid: false, 
          error: (data.msg as string) || '查询失败',
          rawData: data
        }
      }
      
      // status: 1 为支付成功，0 为未支付
      const paid = data.status === 1
      
      return {
        success: true,
        paid,
        trade_no: data.trade_no as string,
        out_trade_no: data.out_trade_no as string,
        money: data.money as string,
        type: data.type as string,
        rawData: data
      }
    } catch (error) {
      return { 
        success: false, 
        paid: false, 
        error: error instanceof Error ? error.message : '查询异常' 
      }
    }
  }
}

/**
 * V2 版本易支付客户端 (RSA签名)
 * 适用于新版彩虹易支付
 */
export class EpayCoreV2 implements IEpayClient {
  private apiurl: string
  private pid: string
  private platformPublicKey: string
  private merchantPrivateKey: string
  private signType = 'RSA'

  constructor(config: EpayConfigV2 | EpayConfigLegacy) {
    this.apiurl = config.apiurl.endsWith('/') ? config.apiurl : config.apiurl + '/'
    this.pid = config.pid
    this.platformPublicKey = config.platform_public_key
    this.merchantPrivateKey = config.merchant_private_key
  }

  /**
   * 获取支付链接
   */
  getPayLink(params: PayParams): string {
    const requrl = this.apiurl + 'api/pay/submit'
    const signedParams = this.buildRequestParam(params as unknown as Record<string, unknown>)
    const queryString = Object.entries(signedParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&')
    return `${requrl}?${queryString}`
  }

  /**
   * 验证回调签名 (RSA)
   */
  verify(data: CallbackData): boolean {
    if (!data || !data.sign) return false
    
    // 检查时间戳（允许 5 分钟误差）
    if (data.timestamp) {
      const timestamp = parseInt(data.timestamp, 10)
      if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
        return false
      }
    }

    const sign = data.sign
    return this.rsaPublicVerify(this.getSignContent(data), sign)
  }

  /**
   * 验证回调签名并检查交易状态 (V2版本)
   * V2版本也检查 trade_status，但主要依赖RSA签名和时间戳
   */
  verifyWithStatus(data: CallbackData): VerifyResult {
    if (!data || !data.sign) {
      return { valid: false, tradeSuccess: false, error: '缺少签名参数' }
    }

    // 检查时间戳（允许 5 分钟误差）
    if (data.timestamp) {
      const timestamp = parseInt(data.timestamp, 10)
      if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
        return { valid: false, tradeSuccess: false, error: '时间戳已过期' }
      }
    }

    // 验证RSA签名
    const sign = data.sign
    if (!this.rsaPublicVerify(this.getSignContent(data), sign)) {
      return { valid: false, tradeSuccess: false, error: 'RSA签名验证失败' }
    }

    // 检查交易状态
    const tradeSuccess = data.trade_status === 'TRADE_SUCCESS'
    if (!tradeSuccess) {
      return { valid: true, tradeSuccess: false, error: `交易未成功: ${data.trade_status || '未知状态'}` }
    }

    return { valid: true, tradeSuccess: true }
  }

  /**
   * 构建请求参数
   */
  private buildRequestParam(params: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {}
    
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') {
        result[k] = String(v)
      }
    }
    
    result.pid = this.pid
    result.timestamp = Math.floor(Date.now() / 1000).toString()
    result.sign = this.getSign(result)
    result.sign_type = this.signType
    
    return result
  }

  /**
   * 生成 RSA 签名
   */
  private getSign(params: Record<string, string>): string {
    return this.rsaPrivateSign(this.getSignContent(params))
  }

  /**
   * 获取待签名字符串
   */
  private getSignContent(params: Record<string, unknown>): string {
    const keys = Object.keys(params).sort()
    const parts: string[] = []
    
    for (const k of keys) {
      const v = params[k]
      if (Array.isArray(v) || v === null || v === undefined || v === '' || k === 'sign' || k === 'sign_type') {
        continue
      }
      parts.push(`${k}=${v}`)
    }
    
    return parts.join('&')
  }

  /**
   * 商户私钥签名
   */
  private rsaPrivateSign(data: string): string {
    const key = `-----BEGIN PRIVATE KEY-----\n${this.merchantPrivateKey.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`
    const sign = crypto.sign('sha256', Buffer.from(data), {
      key,
      padding: crypto.constants.RSA_PKCS1_PADDING
    })
    return sign.toString('base64')
  }

  /**
   * 平台公钥验签
   */
  private rsaPublicVerify(data: string, signature: string): boolean {
    try {
      const key = `-----BEGIN PUBLIC KEY-----\n${this.platformPublicKey.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`
      return crypto.verify('sha256', Buffer.from(data), {
        key,
        padding: crypto.constants.RSA_PKCS1_PADDING
      }, Buffer.from(signature, 'base64'))
    } catch {
      return false
    }
  }

  /**
   * 查询订单状态 (V2版本)
   * V2版本的标准查询接口可能需要 RSA 签名
   * 备注：大多数易支付都支持 api.php?act=order 查询接口
   * 但 V2 版本没有 MD5 密钥，可能不支持标准查询接口
   * 返回失败，让业务层等待 notify_url 异步回调
   */
  async queryOrder(_outTradeNo: string): Promise<OrderQueryResult> {
    // V2 版本使用 RSA 签名，标准易支付查询接口可能不支持
    // 返回不支持的状态，让前端显示“等待到账”
    return {
      success: false,
      paid: false,
      error: 'V2版本暂不支持主动查询，请等待异步回调'
    }
  }
}

// 为了向后兼容，保留 EpayCore 别名
export const EpayCore = EpayCoreV2

/**
 * 创建易支付客户端
 * 根据配置自动选择 V1 或 V2 版本
 */
export function createEpayClient(config: EpayConfig): IEpayClient {
  // 检查是否为 V1 配置
  if ('version' in config && config.version === 'v1') {
    return new EpayCoreV1(config as EpayConfigV1)
  }
  
  // 检查是否为 V1 配置（通过 key 字段判断）
  if ('key' in config && !('platform_public_key' in config)) {
    const v1Config = config as { apiurl: string; pid: string; key: string }
    return new EpayCoreV1({ version: 'v1', apiurl: v1Config.apiurl, pid: v1Config.pid, key: v1Config.key })
  }
  
  // 默认使用 V2
  if ('version' in config && config.version === 'v2') {
    return new EpayCoreV2(config as EpayConfigV2)
  }
  
  // 兼容旧配置
  return new EpayCoreV2(config as EpayConfigLegacy)
}
