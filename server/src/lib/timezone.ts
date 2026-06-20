/**
 * 时区工具函数
 * 
 * 业务统计使用固定的时区（Asia/Shanghai），确保：
 * - "今日"统计在中国时间 0 点刷新
 * - "本月"统计在中国时间每月 1 日 0 点刷新
 */

// 默认业务时区
const DEFAULT_TIMEZONE = 'Asia/Shanghai'

/**
 * 获取指定时区的当前日期字符串（YYYY-MM-DD 格式）
 */
export function getDateStringInTimezone(date: Date = new Date(), timezone: string = DEFAULT_TIMEZONE): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone })
}

/**
 * 获取指定时区的当前年月（YYYY-MM 格式）
 */
export function getMonthStringInTimezone(date: Date = new Date(), timezone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date)
  
  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  return `${year}-${month}`
}

/**
 * 获取指定时区今日的开始和结束时间（返回 UTC Date 对象）
 * 
 * @example
 * // 如果中国时间是 2024-01-21 15:30:00
 * // 返回的 start 是 2024-01-21 00:00:00 中国时间 = 2024-01-20 16:00:00 UTC
 * // 返回的 end 是 2024-01-22 00:00:00 中国时间 = 2024-01-21 16:00:00 UTC
 */
export function getTodayRange(timezone: string = DEFAULT_TIMEZONE): { start: Date; end: Date } {
  const now = new Date()
  const dateStr = getDateStringInTimezone(now, timezone)
  
  // 解析日期字符串
  const [year, month, day] = dateStr.split('-').map(Number)
  
  // 计算时区偏移（以分钟为单位）
  // 使用 Intl.DateTimeFormat 获取时区偏移
  const tzOffset = getTimezoneOffsetMinutes(timezone)
  
  // 创建今日 0 点的 UTC 时间
  // 例如：中国时区 (UTC+8)，中国 0 点 = UTC -8 小时
  const startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  startUtc.setMinutes(startUtc.getMinutes() - tzOffset)
  
  // 创建明日 0 点的 UTC 时间
  const endUtc = new Date(startUtc)
  endUtc.setDate(endUtc.getDate() + 1)
  
  return { start: startUtc, end: endUtc }
}

/**
 * 获取指定时区本月的开始时间（返回 UTC Date 对象）
 */
export function getThisMonthStart(timezone: string = DEFAULT_TIMEZONE): Date {
  const now = new Date()
  const dateStr = getDateStringInTimezone(now, timezone)
  
  // 解析日期字符串获取年月
  const [year, month] = dateStr.split('-').map(Number)
  
  // 计算时区偏移
  const tzOffset = getTimezoneOffsetMinutes(timezone)
  
  // 创建本月 1 日 0 点的 UTC 时间
  const startUtc = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  startUtc.setMinutes(startUtc.getMinutes() - tzOffset)
  
  return startUtc
}

/**
 * 获取指定时区上月的开始和结束时间（返回 UTC Date 对象）
 */
export function getLastMonthRange(timezone: string = DEFAULT_TIMEZONE): { start: Date; end: Date } {
  const thisMonthStart = getThisMonthStart(timezone)
  
  // 上月结束时间 = 本月开始时间 - 1 毫秒
  const end = new Date(thisMonthStart.getTime() - 1)
  
  // 上月开始时间
  const now = new Date()
  const dateStr = getDateStringInTimezone(now, timezone)
  const [year, month] = dateStr.split('-').map(Number)
  
  // 计算上个月的年月
  let lastYear = year
  let lastMonth = month - 1
  if (lastMonth === 0) {
    lastMonth = 12
    lastYear = year - 1
  }
  
  // 计算时区偏移
  const tzOffset = getTimezoneOffsetMinutes(timezone)
  
  // 创建上月 1 日 0 点的 UTC 时间
  const start = new Date(Date.UTC(lastYear, lastMonth - 1, 1, 0, 0, 0, 0))
  start.setMinutes(start.getMinutes() - tzOffset)
  
  return { start, end }
}

/**
 * 获取时区偏移（以分钟为单位）
 * 正数表示东时区，负数表示西时区
 * 例如：Asia/Shanghai 返回 480（UTC+8 = +480分钟）
 */
function getTimezoneOffsetMinutes(timezone: string): number {
  const now = new Date()
  
  // 获取指定时区的时间字符串
  const tzTimeStr = now.toLocaleString('en-US', { 
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  
  // 获取 UTC 时间字符串
  const utcTimeStr = now.toLocaleString('en-US', { 
    timeZone: 'UTC',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  
  // 解析时间字符串为 Date 对象（用于计算差值）
  const parseDateStr = (str: string): Date => {
    // 格式: "MM/DD/YYYY, HH:MM:SS"
    const [datePart, timePart] = str.split(', ')
    const [month, day, year] = datePart.split('/').map(Number)
    const [hour, minute, second] = timePart.split(':').map(Number)
    return new Date(year, month - 1, day, hour, minute, second)
  }
  
  const tzDate = parseDateStr(tzTimeStr)
  const utcDate = parseDateStr(utcTimeStr)
  
  // 计算差值（分钟）
  return Math.round((tzDate.getTime() - utcDate.getTime()) / 60000)
}

/**
 * 业务时区常量
 */
export const BUSINESS_TIMEZONE = DEFAULT_TIMEZONE
