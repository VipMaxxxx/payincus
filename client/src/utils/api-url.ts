const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export function buildApiUrl(path: string): string {
  const baseUrl = API_BASE_URL.replace(/\/+$/, '')
  return `${baseUrl}${normalizePath(path)}`
}

export function buildAbsoluteApiUrl(path: string): string {
  return new URL(buildApiUrl(path), window.location.origin).toString()
}

export function getFrontendOrigin(): string {
  return window.location.origin
}

export function buildPublicApiUrl(path: string): string {
  return new URL(`/api${normalizePath(path)}`, getFrontendOrigin()).toString()
}

export function buildApiWebSocketUrl(path: string): string {
  const apiUrl = new URL(API_BASE_URL, window.location.origin)
  const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const apiPath = apiUrl.pathname.replace(/\/+$/, '')
  return `${protocol}//${apiUrl.host}${apiPath}${normalizePath(path)}`
}
