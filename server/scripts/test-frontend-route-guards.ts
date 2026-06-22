import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

const routerSource = readRepoFile('client/src/router/index.ts')
const appSource = readRepoFile('client/src/App.vue')
const publicHeaderSource = readRepoFile('client/src/components/public/PublicSiteHeader.vue')
const publicFooterSource = readRepoFile('client/src/components/public/PublicSiteFooter.vue')
const marketViewSource = readRepoFile('client/src/views/MarketView.vue')
const portalViewSource = readRepoFile('client/src/views/PortalView.vue')

const routeNames = Array.from(routerSource.matchAll(/^\s{4}name:\s*'([^']+)'/gm)).map(match => match[1])
const duplicateNames = routeNames.filter((name, index) => routeNames.indexOf(name) !== index)
assert.deepEqual(duplicateNames, [], `Vue Router route names must be unique: ${duplicateNames.join(', ')}`)

const portalRoute = sectionBetween(
  routerSource,
  "path: '/'",
  "path: '/dashboard'"
)
assert.ok(
  portalRoute.includes("name: 'portal'") &&
    portalRoute.includes("component: () => import('@/views/PortalView.vue')") &&
    portalRoute.includes("titleKey: 'publicSite.nav.overview'"),
  'public / route must render PortalView directly'
)
assert.ok(
  !portalRoute.includes('redirect:'),
  'public / route must not redirect guests to the authenticated dashboard'
)

const marketRoute = sectionBetween(
  routerSource,
  "path: '/market'",
  "path: '/instances'"
)

assert.ok(
  marketRoute.includes("name: 'market'") &&
    marketRoute.includes("component: () => import('@/views/MarketView.vue')") &&
    marketRoute.includes("titleKey: 'publicSite.market.title'"),
  'public /market route must render MarketView directly'
)
assert.ok(
  !marketRoute.includes('redirect:'),
  'public /market route must not redirect to authenticated instance creation'
)
assert.equal(
  routeNames.filter(name => name === 'instance-create').length,
  1,
  'authenticated instance creation route name must not be duplicated by public market routing'
)

assert.ok(
  publicHeaderSource.includes("to: '/'") &&
    publicHeaderSource.includes("to: '/market'") &&
    publicFooterSource.includes("{ to: '/', label: t('publicSite.nav.overview') }") &&
    publicFooterSource.includes("to: '/market'") &&
    portalViewSource.includes("name: 'PortalView'") &&
    marketViewSource.includes("name: 'MarketView'"),
  'public navigation links to / and /market must land on the real public views'
)
assert.ok(
  portalViewSource.includes("path: '/market'") &&
    portalViewSource.includes("const target = authStore.isAdmin ? '/admin/users' : '/dashboard'") &&
    portalViewSource.includes("void router.push('/login')"),
  'PortalView CTA must browse the public market and send authenticated users to console or guests to login'
)
assert.ok(
  appSource.includes("import PublicSiteLayout from '@/components/public/PublicSiteLayout.vue'") &&
    appSource.includes("const publicSiteRouteNames = new Set(['portal', 'market'])") &&
    appSource.includes('const showPublicSiteLayout = computed<boolean>') &&
    appSource.includes('<PublicSiteLayout v-else-if="showPublicSiteLayout">'),
  'App shell must wrap public portal and market routes with the public site header/footer layout'
)
assert.ok(
  marketViewSource.includes("void router.push({\n      path: '/instances/create'") &&
    marketViewSource.includes("path: '/login'") &&
    marketViewSource.includes("query: { redirect }"),
  'MarketView CTA must send authenticated users to instance creation and guests through login with a redirect'
)

console.log('frontend route guard tests passed')
