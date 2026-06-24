export interface MenuItem {
  name?: string
  path?: string
  icon?: string
  label?: string
  labelText?: string
  divider?: boolean
}

export const isAdminEntry = false

export const navMenuItems: MenuItem[] = [
  { divider: true, label: 'nav.main' },
  { name: 'dashboard', path: '/dashboard', icon: 'home', label: 'nav.dashboard' },
  { name: 'instances', path: '/instances', icon: 'server', label: 'nav.instances' },
  { name: 'mail', path: '/mail', icon: 'mail', label: 'nav.mail' },
  { name: 'terminal', path: '/terminal', icon: 'terminal', label: 'nav.terminal' },
  { name: 'extensions', path: '/extensions', icon: 'puzzle', label: 'nav.scripts' },
  { name: 'transfers', path: '/transfers', icon: 'transfer', label: 'nav.transfers' },
  { name: 'tickets', path: '/tickets', icon: 'ticket', label: 'nav.tickets' },
  { name: 'entertainment', path: '/entertainment', icon: 'gift', label: 'nav.entertainment' },
  { name: 'wallet', path: '/wallet', icon: 'wallet', label: 'nav.wallet' },
  { name: 'orders', path: '/orders', icon: 'card', label: 'nav.orders' },
  { name: 'invites', path: '/invites', icon: 'key', label: 'nav.invites' },
  { divider: true, label: 'nav.expand' },
  { name: 'my-hosts', path: '/resources/hosts', icon: 'database', label: 'nav.hosts' },
  { name: 'my-packages', path: '/resources/packages', icon: 'package', label: 'nav.packages' },
  { name: 'hosting-wallet', path: '/hosting-wallet', icon: 'coin', label: 'nav.earnings' },
  { divider: true, label: 'nav.system' },
  { name: 'profile', path: '/profile', icon: 'settings', label: 'nav.settings' },
  { name: 'help', path: '/help', icon: 'help', label: 'nav.help' },
  { name: 'logs', path: '/logs', icon: 'logs', label: 'nav.logs' }
]
