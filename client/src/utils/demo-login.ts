const DEFAULT_DEMO_HOSTS = new Set(['demo.payincus.com', 'demoadmin.payincus.com'])
const DEFAULT_DEMO_ACCOUNTS: Record<'user' | 'admin', DemoLoginAccount> = {
  user: {
    label: '演示用户账号',
    username: 'demo',
    email: 'demo@payincus.com',
    password: 'demo123'
  },
  admin: {
    label: '演示后台账号',
    username: 'admin',
    email: 'admin@payincus.com',
    password: 'admin123'
  }
}

export interface DemoLoginAccount {
  label: string
  username: string
  email: string
  password: string
}

interface DemoLoginConfig {
  hosts?: string[]
  user?: DemoLoginAccount
  admin?: DemoLoginAccount
}

declare global {
  interface Window {
    __PAYINCUS_DEMO_LOGIN__?: DemoLoginConfig
  }
}

export function isDemoLoginHost(hostname = window.location.hostname): boolean {
  const configuredHosts = window.__PAYINCUS_DEMO_LOGIN__?.hosts
  if (configuredHosts?.length) {
    return configuredHosts.includes(hostname)
  }
  return DEFAULT_DEMO_HOSTS.has(hostname)
}

export function getDemoLoginAccount(kind: 'user' | 'admin'): DemoLoginAccount | null {
  if (!isDemoLoginHost()) return null
  return window.__PAYINCUS_DEMO_LOGIN__?.[kind] ?? DEFAULT_DEMO_ACCOUNTS[kind]
}
