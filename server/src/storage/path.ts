export function normalizeStorageBasePath(basePath: string | null | undefined): string {
  const raw = basePath?.trim() ?? ''
  if (!raw) return ''
  if (raw.includes('\0') || raw.includes('\\')) {
    throw new Error('Storage base path contains invalid characters')
  }

  const absolute = raw.startsWith('/')
  const segments = raw.split('/').filter(Boolean)
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Storage base path cannot contain relative path segments')
  }

  if (segments.length === 0) return absolute ? '/' : ''
  return `${absolute ? '/' : ''}${segments.join('/')}/`
}

export function normalizeStorageFilename(filename: string): string {
  const raw = filename.trim()
  if (!raw) {
    throw new Error('Storage filename cannot be empty')
  }
  if (
    raw.includes('\0') ||
    raw.includes('/') ||
    raw.includes('\\') ||
    raw === '.' ||
    raw === '..'
  ) {
    throw new Error('Storage filename contains invalid path segments')
  }
  if (raw.length > 255) {
    throw new Error('Storage filename is too long')
  }
  return raw
}

export function joinStorageRemotePath(basePath: string, filename: string): string {
  return `${normalizeStorageBasePath(basePath)}${normalizeStorageFilename(filename)}`
}

export function joinStorageRemoteDirectory(basePath: string, subPath?: string | null): string {
  const normalizedBasePath = normalizeStorageBasePath(basePath)
  const rawSubPath = subPath?.trim() ?? ''
  if (!rawSubPath) return normalizedBasePath

  const normalizedSubPath = normalizeStorageBasePath(rawSubPath)
  if (normalizedSubPath.startsWith('/')) {
    throw new Error('Storage sub path must be relative')
  }

  return `${normalizedBasePath}${normalizedSubPath}`
}
