export const isAdminEntry = true

export function loginPath(): string {
  return '/admin/login'
}

export function registerPath(): string {
  return '/admin/login'
}

export function forgotPasswordPath(): string {
  return '/admin/login'
}

export function profilePath(): string {
  return '/admin/profile'
}

export function logsPath(): string {
  return '/admin/logs'
}

export function dashboardPath(): string {
  return '/admin/users'
}

export function marketPath(): string {
  return '/admin/resources/packages'
}

export function walletPath(): string {
  return '/admin/billing'
}

export function exchangePath(): string {
  return '/admin/exchange'
}

export function entertainmentPath(): string {
  return '/admin/entertainment'
}

export function helpPath(): string {
  return '/admin/help'
}

export function inboxPath(): string {
  return '/admin/inbox'
}

export function mailPath(): string {
  return '/admin/mail'
}

export function mailDomainPath(_id?: number | string): string {
  return '/admin/mail'
}

export function transfersPath(): string {
  return '/admin/inbox'
}

export function terminalPath(): string {
  return '/admin/instances'
}

export function extensionsPath(): string | null {
  return null
}

export function instancesPath(): string {
  return '/admin/instances'
}

export function instanceCreatePath(): string {
  return '/admin/instances/create'
}

export function instanceDetailPath(id: number | string): string {
  return `/admin/instances/${encodeURIComponent(String(id))}`
}

export function ticketsPath(ticketId?: number | string): string {
  return ticketId ? `/admin/tickets?id=${encodeURIComponent(String(ticketId))}` : '/admin/tickets'
}

export function hostsPath(): string {
  return '/admin/resources/hosts'
}

export function hostCreatePath(): string {
  return '/admin/resources/hosts/create'
}

export function hostDetailPath(id: number | string): string {
  return `/admin/resources/hosts/${encodeURIComponent(String(id))}`
}

export function packagesPath(): string {
  return '/admin/resources/packages'
}

export function packageCreatePath(): string {
  return '/admin/resources/packages/create'
}

export function packageEditPath(id: number | string): string {
  return `/admin/resources/packages/${encodeURIComponent(String(id))}/edit`
}
