export const isAdminEntry = false

export function loginPath(): string {
  return '/login'
}

export function registerPath(inviteCode?: string): string {
  return inviteCode ? `/register/${encodeURIComponent(inviteCode)}` : '/register'
}

export function forgotPasswordPath(): string {
  return '/forgot-password'
}

export function profilePath(): string {
  return '/profile'
}

export function logsPath(): string {
  return '/logs'
}

export function dashboardPath(): string {
  return '/dashboard'
}

export function marketPath(): string {
  return '/market'
}

export function walletPath(): string {
  return '/wallet'
}

export function entertainmentPath(): string {
  return '/entertainment'
}

export function helpPath(): string {
  return '/help'
}

export function inboxPath(): string {
  return '/inbox'
}

export function mailPath(): string {
  return '/mail'
}

export function mailDomainPath(id: number | string): string {
  return `/mail/domains/${encodeURIComponent(String(id))}`
}

export function transfersPath(): string {
  return '/transfers'
}

export function terminalPath(): string {
  return '/terminal'
}

export function extensionsPath(): string | null {
  return '/extensions'
}

export function instancesPath(): string {
  return '/instances'
}

export function instanceCreatePath(): string {
  return '/instances/create'
}

export function instanceDetailPath(id: number | string): string {
  return `/instances/${encodeURIComponent(String(id))}`
}

export function ticketsPath(ticketId?: number | string): string {
  return ticketId ? `/tickets?id=${encodeURIComponent(String(ticketId))}` : '/tickets'
}

export function hostsPath(): string {
  return '/resources/hosts'
}

export function hostCreatePath(): string {
  return '/resources/hosts/create'
}

export function hostDetailPath(id: number | string): string {
  return `/resources/hosts/${encodeURIComponent(String(id))}`
}

export function packagesPath(): string {
  return '/resources/packages'
}

export function packageCreatePath(): string {
  return '/resources/packages/create'
}

export function packageEditPath(id: number | string): string {
  return `/resources/packages/${encodeURIComponent(String(id))}/edit`
}
