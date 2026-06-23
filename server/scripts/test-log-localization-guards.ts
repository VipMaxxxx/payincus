import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeLogContentForStorage } from '../src/lib/log-localization.js'

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function assertIncludes(file: string, needle: string, message: string): void {
  const content = read(file)
  if (!content.includes(needle)) {
    throw new Error(`${message}: ${file} 缺少 ${needle}`)
  }
}

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${expected} actual=${actual}`)
  }
}

assertIncludes(
  'client/src/views/LogsView.vue',
  "formatLogModule(module, tm('logModules') as Record<string, unknown>)",
  '日志模块必须使用翻译表展示'
)
assertIncludes(
  'client/src/views/LogsView.vue',
  "formatLogAction(action, tm('logActions') as Record<string, unknown>)",
  '日志操作必须使用翻译表展示'
)
assertIncludes(
  'client/src/views/LogsView.vue',
  'formatLogContent(content)',
  '日志内容必须使用中文化格式化器展示'
)
assertIncludes(
  'server/src/db/logs.ts',
  'const normalizedContent = normalizeLogContentForStorage(content)',
  '新日志入库前必须中文化常见英文模板'
)

for (const localeFile of ['client/src/locales/zh-CN.ts', 'client/src/locales/en.ts', 'client/src/locales/zh-TW.ts']) {
  for (const key of [
    'instance.batch_delete',
    'host.image_policy',
    'system.update.start',
    'plan.create',
    'host.verify'
  ]) {
    assertIncludes(localeFile, `'${key}'`, `日志操作翻译缺失 ${key}`)
  }
}

assertEqual(
  normalizeLogContentForStorage('Batch deleted instance "123" on host "JPIIJ-01"'),
  '批量删除节点 "JPIIJ-01" 上的实例 "123"',
  '批量删除日志内容应中文化'
)
assertEqual(
  normalizeLogContentForStorage('Updated image policy for host "JPIIJ-01" with 4 image(s)'),
  '更新节点 "JPIIJ-01" 的镜像策略，共 4 个镜像',
  '镜像策略日志内容应中文化'
)
assertEqual(
  normalizeLogContentForStorage('Started system update from v0.1.2 to v0.1.3'),
  '开始系统更新：v0.1.2 -> v0.1.3',
  '系统更新日志内容应中文化'
)
assertEqual(
  normalizeLogContentForStorage('Failed to create instance "123": Failed creating instance record: Instance type "virtual-machine" is not supported on this server: KVM support is missing (no /dev/kvm)'),
  '创建实例 "123" 失败：创建实例记录失败：当前服务器不支持虚拟机实例类型：缺少 KVM 支持（没有 /dev/kvm）',
  '实例创建失败日志内容应中文化'
)

console.log('Log localization guards passed')
