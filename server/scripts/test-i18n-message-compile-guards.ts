/**
 * i18n 文案编译守卫
 *
 * frontend-i18n-keys 只校验 key 完整性，不校验文案 value 能否被 vue-i18n 编译。
 * 裸 `@`（被当成链接消息 `@:key`）、未配对的 `{` / `}`、误用的 `|` 等会让 vue-i18n
 * 在运行时编译该文案时抛错（例如 code 10 INVALID_LINKED_FORMAT），导致整页渲染崩溃/白屏。
 * 本守卫用项目实际依赖的 @intlify/message-compiler 编译每一条文案，任何编译错误即失败，
 * 从源头拦住这类“翻译文案语法错误”导致的线上白屏。
 */
import assert from 'node:assert/strict'
import { baseCompile } from '@intlify/message-compiler'
import en from '../../client/src/locales/en.js'
import zhCN from '../../client/src/locales/zh-CN.js'
import zhTW from '../../client/src/locales/zh-TW.js'

type MessageTree = { [key: string]: string | MessageTree }

const locales: Record<string, MessageTree> = {
  en: en as unknown as MessageTree,
  'zh-CN': zhCN as unknown as MessageTree,
  'zh-TW': zhTW as unknown as MessageTree
}

interface CompileFailure {
  locale: string
  path: string
  value: string
  errors: string[]
}

function collectFailures(locale: string, node: MessageTree, prefix: string, out: CompileFailure[]): void {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      const errors: string[] = []
      try {
        baseCompile(value, {
          // 与运行时一致：把编译错误暴露出来（这里收集而非直接 throw，便于一次性汇总所有问题）。
          onError: (err: { code?: number; message?: string }) => {
            errors.push(`code ${err.code ?? '?'}: ${err.message ?? ''}`.trim())
          }
        })
      } catch (err) {
        errors.push(String((err as Error)?.message ?? err))
      }
      if (errors.length > 0) {
        out.push({ locale, path, value, errors })
      }
    } else if (value && typeof value === 'object') {
      collectFailures(locale, value, path, out)
    }
  }
}

const failures: CompileFailure[] = []
let messageCount = 0

for (const [localeName, tree] of Object.entries(locales)) {
  const before = failures.length
  const countBefore = messageCount
  const localeFailures: CompileFailure[] = []
  collectFailures(localeName, tree, '', localeFailures)
  failures.push(...localeFailures)
  // 统计条数（用于确认确实扫到了文案，避免空跑）
  const countStrings = (node: MessageTree): number =>
    Object.values(node).reduce<number>((n, v) => n + (typeof v === 'string' ? 1 : v && typeof v === 'object' ? countStrings(v as MessageTree) : 0), 0)
  messageCount += countStrings(tree)
  void before
  void countBefore
}

if (failures.length > 0) {
  const detail = failures
    .slice(0, 30)
    .map(f => `  [${f.locale}] ${f.path} = ${JSON.stringify(f.value).slice(0, 80)}\n      -> ${f.errors.join('; ')}`)
    .join('\n')
  assert.fail(
    `发现 ${failures.length} 条无法被 vue-i18n 编译的文案（会导致运行时白屏）。` +
    `如需在文案中使用字面量 @ 请写成 {'@'}，字面量花括号写成 {'{'} / {'}'}：\n${detail}`
  )
}

assert.ok(messageCount > 0, 'i18n 文案编译守卫未扫描到任何文案（加载失败？）')

console.log(`i18n message compile guard passed: ${messageCount} messages across ${Object.keys(locales).length} locales compile cleanly.`)
