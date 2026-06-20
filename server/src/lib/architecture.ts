export const SUPPORTED_ARCHITECTURES = ['x86_64', 'aarch64'] as const

export type SupportedArchitecture = typeof SUPPORTED_ARCHITECTURES[number]

const X86_ARCHITECTURES = new Set(['x86_64', 'amd64', 'x64', 'x86'])
const ARM_ARCHITECTURES = new Set(['aarch64', 'arm64'])

export function normalizeArchitecture(value?: string | null): SupportedArchitecture {
  const normalized = value?.trim().toLowerCase()

  if (normalized && ARM_ARCHITECTURES.has(normalized)) {
    return 'aarch64'
  }

  if (normalized && X86_ARCHITECTURES.has(normalized)) {
    return 'x86_64'
  }

  return 'x86_64'
}
