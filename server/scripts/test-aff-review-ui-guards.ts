import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const view = readFileSync(resolve(root, 'client/src/views/admin/AffReviewView.vue'), 'utf8')

assert.ok(
  view.includes('class="space-y-3 p-4 lg:hidden"') &&
    view.includes('class="hidden overflow-hidden lg:block"') &&
    view.includes('table class="w-full table-fixed"') &&
    !view.includes('v-else class="overflow-x-auto"') &&
    !view.includes('table class="w-full min-w-[960px]"'),
  'AFF withdrawal review list must keep mobile cards and a fixed desktop table without broad horizontal overflow'
)

assert.ok(
  view.includes('@click="approveWithdrawal(w)"') &&
    view.includes('@click="openRejectModal(w)"') &&
    view.includes('@click="submitReject"') &&
    view.includes('v-model="rejectReason"') &&
    view.includes('@click="page--; loadWithdrawals()"') &&
    view.includes('@click="page++; loadWithdrawals()"'),
  'AFF withdrawal review responsive layout must preserve approve, reject, modal, and pagination actions'
)

console.log('AFF review UI guard tests passed')
