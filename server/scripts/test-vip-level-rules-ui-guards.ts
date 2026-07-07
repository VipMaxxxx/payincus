import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const editor = readFileSync(resolve(root, 'client/src/components/admin/VipLevelRulesEditor.vue'), 'utf8')

assert.ok(
  editor.includes('class="space-y-3 p-4 lg:hidden"') &&
    editor.includes('class="hidden overflow-hidden lg:block"') &&
    editor.includes('table class="w-full table-fixed divide-y divide-themed"') &&
    !editor.includes('class="overflow-x-auto"') &&
    !editor.includes('table class="min-w-full'),
  'VIP level rules editor must keep mobile cards and a fixed desktop table without broad horizontal overflow'
)

assert.ok(
  editor.includes('v-model="rule.enabled"') &&
    editor.includes('v-model="rule.badgeStyle.backgroundColor"') &&
    editor.includes('v-model.trim="rule.badgeStyle.backgroundColor"') &&
    editor.includes('v-model="rule.badgeStyle.textColor"') &&
    editor.includes('v-model.trim="rule.badgeStyle.textColor"') &&
    editor.includes('v-model="rule.conditionMode"') &&
    editor.includes('v-model="rule.minRecharge"') &&
    editor.includes('v-model="rule.minConsume"') &&
    editor.includes('v-model="rule.minHostingIncome"') &&
    editor.includes('v-model="rule.minHostingInstances"') &&
    editor.includes('@click="saveRules"'),
  'VIP level rules responsive layout must preserve all editable fields and the save action'
)

console.log('VIP level rules UI guard tests passed')
