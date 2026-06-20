/**
 * 异步任务重试机制
 * LOGIC003: 提供通用的重试工具，统一重试逻辑
 * 
 * 特性：
 * - 可配置的重试次数和延迟
 * - 指数退避（Exponential Backoff）
 * - 可选的错误过滤（某些错误不重试）
 * - 重试回调（用于日志或监控）
 */

/**
 * 重试配置选项
 */
export interface RetryOptions {
  /** 最大重试次数（不包括首次尝试）*/
  maxRetries?: number
  /** 基础延迟时间（毫秒）*/
  baseDelay?: number
  /** 最大延迟时间（毫秒）*/
  maxDelay?: number
  /** 是否使用指数退避 */
  exponentialBackoff?: boolean
  /** 退避因子（默认 2） */
  backoffFactor?: number
  /** 判断错误是否应该重试的函数 */
  shouldRetry?: (error: Error, attempt: number) => boolean
  /** 每次重试前的回调 */
  onRetry?: (error: Error, attempt: number, delay: number) => void
  /** 任务标识（用于日志） */
  taskName?: string
  /** 超时时间（毫秒，0 表示无限制） */
  timeout?: number
}

/**
 * 重试结果
 */
export interface RetryResult<T> {
  success: boolean
  result?: T
  error?: Error
  attempts: number
  totalTime: number
}

/**
 * 默认配置
 */
const DEFAULT_OPTIONS = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialBackoff: true,
  backoffFactor: 2,
  timeout: 0,
} as const

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 计算下一次重试的延迟时间
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  exponentialBackoff: boolean,
  backoffFactor: number
): number {
  if (!exponentialBackoff) {
    return Math.min(baseDelay, maxDelay)
  }
  
  // 指数退避：baseDelay * (backoffFactor ^ attempt)
  const calculatedDelay = baseDelay * Math.pow(backoffFactor, attempt - 1)
  
  // 添加随机抖动（±10%）避免雷群效应
  const jitter = calculatedDelay * 0.1 * (Math.random() * 2 - 1)
  
  return Math.min(calculatedDelay + jitter, maxDelay)
}

/**
 * 不可重试的错误模式（配置错误、认证错误等）
 */
const NON_RETRYABLE_PATTERNS = [
  'INVALID_CREDENTIALS',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_ARGUMENT',
  'Missing required',
  'Invalid configuration',
  '401',
  '403',
  '404',
]

/**
 * 默认的错误过滤函数
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return !NON_RETRYABLE_PATTERNS.some(pattern => 
    message.includes(pattern.toLowerCase())
  )
}

/**
 * 带重试的异步函数执行器
 * 
 * @param fn 要执行的异步函数
 * @param options 重试配置
 * @returns 执行结果
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchDataFromAPI(),
 *   {
 *     maxRetries: 3,
 *     baseDelay: 1000,
 *     taskName: 'API请求',
 *     onRetry: (err, attempt) => console.log(`重试 ${attempt}: ${err.message}`)
 *   }
 * )
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const {
    maxRetries,
    baseDelay,
    maxDelay,
    exponentialBackoff,
    backoffFactor,
    shouldRetry = isRetryableError,
    onRetry,
    taskName = 'Task',
    timeout,
  } = opts

  const startTime = Date.now()
  let lastError: Error | undefined
  let attempts = 0

  // 超时处理
  let timeoutHandle: NodeJS.Timeout | undefined
  let isTimedOut = false

  if (timeout > 0) {
    timeoutHandle = setTimeout(() => {
      isTimedOut = true
    }, timeout)
  }

  try {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      attempts = attempt

      // 检查超时
      if (isTimedOut) {
        throw new Error(`${taskName}: Operation timed out after ${timeout}ms`)
      }

      try {
        const result = await fn()
        
        return {
          success: true,
          result,
          attempts,
          totalTime: Date.now() - startTime,
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // 如果是最后一次尝试，不再重试
        if (attempt > maxRetries) {
          break
        }

        // 检查是否应该重试
        if (!shouldRetry(lastError, attempt)) {
          console.warn(`[Retry] ${taskName}: Non-retryable error, stopping retry`)
          break
        }

        // 计算延迟
        const retryDelay = calculateDelay(attempt, baseDelay, maxDelay, exponentialBackoff, backoffFactor)

        // 调用重试回调
        if (onRetry) {
          onRetry(lastError, attempt, retryDelay)
        } else {
          console.warn(`[Retry] ${taskName}: Attempt ${attempt}/${maxRetries + 1} failed, retrying in ${retryDelay}ms: ${lastError.message}`)
        }

        // 等待后重试
        await delay(retryDelay)
      }
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalTime: Date.now() - startTime,
  }
}

/**
 * 简化版重试函数（直接返回结果或抛出错误）
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const result = await withRetry(fn, options)
  
  if (result.success && result.result !== undefined) {
    return result.result
  }
  
  throw result.error || new Error('Retry failed with unknown error')
}

/**
 * 创建可重用的重试执行器
 */
export function createRetryExecutor(defaultOptions: RetryOptions = {}) {
  return async <T>(fn: () => Promise<T>, overrideOptions: RetryOptions = {}): Promise<RetryResult<T>> => {
    return withRetry(fn, { ...defaultOptions, ...overrideOptions })
  }
}

/**
 * 批量执行带重试的任务
 * 
 * @param tasks 任务数组
 * @param options 重试配置
 * @param concurrency 并发数（默认 5）
 */
export async function withRetryBatch<T>(
  tasks: Array<{ name: string; fn: () => Promise<T> }>,
  options: Omit<RetryOptions, 'taskName'> = {},
  concurrency: number = 5
): Promise<Array<RetryResult<T> & { name: string }>> {
  const results: Array<RetryResult<T> & { name: string }> = []
  
  // 使用简单的并发控制
  const executing: Promise<void>[] = []
  
  for (const task of tasks) {
    const p = (async () => {
      const result = await withRetry(task.fn, { ...options, taskName: task.name })
      results.push({ ...result, name: task.name })
    })()
    
    executing.push(p)
    
    if (executing.length >= concurrency) {
      await Promise.race(executing)
      // 移除已完成的
      executing.splice(0, executing.length, ...executing.filter(e => e !== p))
    }
  }
  
  // 等待剩余任务完成
  await Promise.all(executing)
  
  return results
}
