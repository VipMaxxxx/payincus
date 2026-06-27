import type { MenuItem } from './side-nav-items-user'

export const isAdminEntry = true

export const navMenuItems: MenuItem[] = [
  { divider: true, label: 'nav.admin' },
  { name: 'admin-users', path: '/admin/users', icon: 'users', label: 'nav.users' },
  { name: 'admin-hosting', path: '/admin/hosting', icon: 'coin', label: 'nav.hosting' },
  { name: 'admin-settings', path: '/admin/settings', icon: 'cog', label: 'nav.system' },
  { name: 'admin-plugins', path: '/admin/plugins', icon: 'package', label: 'nav.plugins' },
  { divider: true, label: 'nav.operations' },
  { name: 'admin-system-update', path: '/admin/system-update', icon: 'sparkles', label: 'nav.systemUpdate' },
  { name: 'admin-delivery', path: '/admin/delivery', icon: 'pulse', label: 'nav.delivery' },
  { name: 'admin-sla-alerts', path: '/admin/sla-alerts', icon: 'bell', label: 'nav.slaAlerts' },
  { name: 'admin-resource-risk', path: '/admin/resource-risk', icon: 'pulse', label: 'nav.resourceRisk' },
  { name: 'admin-production-proof', path: '/admin/production-proof', icon: 'logs', label: 'nav.productionProof' },
  { name: 'admin-user-lifecycle', path: '/admin/user-lifecycle', icon: 'users', label: 'nav.userLifecycle' },
  { name: 'admin-tickets', path: '/admin/tickets', icon: 'ticket', label: 'nav.tickets' },
  { name: 'admin-broadcast', path: '/admin/broadcast', icon: 'bell', label: 'nav.broadcast' },
  { name: 'admin-logs', path: '/admin/logs', icon: 'logs', label: 'nav.logs' },
  { divider: true, label: 'nav.billing' },
  { name: 'admin-billing', path: '/admin/billing', icon: 'wallet', label: 'nav.billing' },
  { name: 'admin-gift-cards', path: '/admin/gift-cards', icon: 'gift', label: 'nav.giftCards' },
  { name: 'admin-orders', path: '/admin/orders', icon: 'card', label: 'nav.orders' },
  { divider: true, label: 'nav.resources' },
  { name: 'admin-my-hosts', path: '/admin/resources/hosts', icon: 'database', label: 'nav.hosts' },
  { name: 'admin-my-packages', path: '/admin/resources/packages', icon: 'package', label: 'nav.packages' },
  { name: 'admin-capacity-cost', path: '/admin/capacity-cost', icon: 'chart', label: 'nav.capacityCost' },
  { name: 'admin-images', path: '/admin/images', icon: 'image', label: 'nav.images' },
  { name: 'admin-instance-create', path: '/admin/instances/create', icon: 'gift', label: 'nav.create' },
  { name: 'admin-mail', path: '/admin/mail', icon: 'mail', label: 'nav.mail' },
  { divider: true, label: 'nav.system' },
  { name: 'admin-help', path: '/admin/help', icon: 'book', label: 'nav.helpManage' },
  { name: 'admin-entertainment', path: '/admin/entertainment', icon: 'gift', label: 'nav.entertainment' },
  { name: 'admin-profile', path: '/admin/profile', icon: 'settings', label: 'nav.settings' },
  { name: 'admin-statistics', path: '/admin/statistics', icon: 'chart', label: 'nav.statistics' },
  { name: 'admin-oauth', path: '/admin/oauth', icon: 'key', label: 'nav.oauth' }
]
