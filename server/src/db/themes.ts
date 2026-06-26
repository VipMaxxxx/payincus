import { rename, rm, mkdir } from 'fs/promises'
import type { ThemePackage } from '@prisma/client'
import { prisma } from './prisma.js'
import type { PayIncusThemeManifest } from '../lib/theme-package.js'
import { getThemeInstallDir, normalizeThemeConfigValues, resolveThemeAsset } from '../lib/theme-package.js'

type ThemeWithUsers = ThemePackage & {
  installedBy?: { username: string } | null
  enabledBy?: { username: string } | null
}

export interface SerializedThemePackage {
  id: number
  themeId: string
  name: string
  version: string
  description: string | null
  author: string | null
  status: string
  enabled: boolean
  manifest: PayIncusThemeManifest
  tokens: Record<string, unknown>
  configValues: Record<string, unknown>
  cssPath: string
  cssUrl: string
  templateUrls: Record<string, { title: string; url: string }>
  previewImageUrl: string | null
  previewUrl: string
  packageSha256: string
  installedByUsername: string | null
  enabledByUsername: string | null
  enabledAt: string | null
  createdAt: string
  updatedAt: string
}

function asThemeManifest(value: unknown): PayIncusThemeManifest {
  return value as PayIncusThemeManifest
}

function asTokens(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asConfigValues(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function buildThemeAssetUrl(theme: Pick<ThemePackage, 'themeId' | 'version'>, assetPath: string): string {
  return `/api/themes/assets/${encodeURIComponent(theme.themeId)}/${encodeURIComponent(theme.version)}/${assetPath}`
}

function buildThemeTemplateUrls(theme: Pick<ThemePackage, 'themeId' | 'version'>, manifest: PayIncusThemeManifest): Record<string, { title: string; url: string }> {
  const templates: Record<string, { title: string; url: string }> = {}
  for (const template of manifest.templates || []) {
    templates[template.slot] = {
      title: template.title,
      url: buildThemeAssetUrl(theme, template.entry)
    }
  }
  return templates
}

export function serializeThemePackage(theme: ThemeWithUsers): SerializedThemePackage {
  const manifest = asThemeManifest(theme.manifest)
  return {
    id: theme.id,
    themeId: theme.themeId,
    name: theme.name,
    version: theme.version,
    description: theme.description,
    author: theme.author,
    status: theme.status,
    enabled: theme.enabled,
    manifest,
    tokens: asTokens(theme.tokens),
    configValues: asConfigValues(theme.configValues),
    cssPath: theme.cssPath,
    cssUrl: buildThemeAssetUrl(theme, theme.cssPath),
    templateUrls: buildThemeTemplateUrls(theme, manifest),
    previewImageUrl: manifest.previewImage ? buildThemeAssetUrl(theme, manifest.previewImage) : null,
    previewUrl: `/api/themes/preview/${encodeURIComponent(theme.themeId)}`,
    packageSha256: theme.packageSha256,
    installedByUsername: theme.installedBy?.username || null,
    enabledByUsername: theme.enabledBy?.username || null,
    enabledAt: theme.enabledAt?.toISOString() || null,
    createdAt: theme.createdAt.toISOString(),
    updatedAt: theme.updatedAt.toISOString()
  }
}

export async function listThemePackages() {
  return await prisma.themePackage.findMany({
    orderBy: [{ enabled: 'desc' }, { updatedAt: 'desc' }],
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } }
    }
  })
}

export async function getThemePackage(themeId: string) {
  return await prisma.themePackage.findUnique({
    where: { themeId },
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } }
    }
  })
}

export async function getActiveThemePackage() {
  return await prisma.themePackage.findFirst({
    where: { enabled: true, status: 'enabled' },
    orderBy: { enabledAt: 'desc' },
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } }
    }
  })
}

export async function getThemePackageForAsset(themeId: string, version: string) {
  return await prisma.themePackage.findFirst({
    where: { themeId, version, status: { in: ['installed', 'enabled'] } }
  })
}

export async function installValidatedTheme(input: {
  stagingDir: string
  manifest: PayIncusThemeManifest
  packageSha256: string
  installedByUserId: number
}) {
  const installRoot = getThemeInstallDir()
  await mkdir(installRoot, { recursive: true })
  const themeRoot = resolveThemeAsset(installRoot, input.manifest.id)
  await mkdir(themeRoot, { recursive: true })
  const finalPath = resolveThemeAsset(themeRoot, input.manifest.version)
  await rm(finalPath, { recursive: true, force: true })
  await rename(input.stagingDir, finalPath)

  return await prisma.themePackage.upsert({
    where: { themeId: input.manifest.id },
    create: {
      themeId: input.manifest.id,
      name: input.manifest.name,
      version: input.manifest.version,
      description: input.manifest.description || null,
      author: input.manifest.author || null,
      status: 'installed',
      enabled: false,
      manifest: input.manifest as any,
      tokens: input.manifest.tokens as any,
      configValues: normalizeThemeConfigValues(input.manifest.configSchema, {}) as any,
      cssPath: input.manifest.css,
      installPath: finalPath,
      packageSha256: input.packageSha256,
      installedByUserId: input.installedByUserId
    },
    update: {
      name: input.manifest.name,
      version: input.manifest.version,
      description: input.manifest.description || null,
      author: input.manifest.author || null,
      status: 'installed',
      enabled: false,
      enabledByUserId: null,
      enabledAt: null,
      manifest: input.manifest as any,
      tokens: input.manifest.tokens as any,
      cssPath: input.manifest.css,
      installPath: finalPath,
      packageSha256: input.packageSha256,
      installedByUserId: input.installedByUserId
    },
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } }
    }
  })
}

export async function updateThemePackageConfig(themeId: string, configValues: Record<string, unknown>) {
  const theme = await prisma.themePackage.findUnique({ where: { themeId } })
  if (!theme) throw new Error('Theme not found')
  const manifest = asThemeManifest(theme.manifest)
  const normalizedConfig = normalizeThemeConfigValues(manifest.configSchema, configValues)
  return await prisma.themePackage.update({
    where: { themeId },
    data: { configValues: normalizedConfig as any },
    include: {
      installedBy: { select: { username: true } },
      enabledBy: { select: { username: true } }
    }
  })
}

export async function enableThemePackage(themeId: string, userId: number) {
  return await prisma.$transaction(async tx => {
    const theme = await tx.themePackage.findUnique({ where: { themeId } })
    if (!theme) throw new Error('Theme not found')
    await tx.themePackage.updateMany({
      where: { enabled: true },
      data: { enabled: false, status: 'installed', enabledByUserId: null, enabledAt: null }
    })
    return await tx.themePackage.update({
      where: { themeId },
      data: {
        enabled: true,
        status: 'enabled',
        enabledByUserId: userId,
        enabledAt: new Date()
      },
      include: {
        installedBy: { select: { username: true } },
        enabledBy: { select: { username: true } }
      }
    })
  })
}

export async function rollbackDefaultTheme() {
  await prisma.themePackage.updateMany({
    where: { enabled: true },
    data: { enabled: false, status: 'installed', enabledByUserId: null, enabledAt: null }
  })
}

export async function uninstallThemePackage(themeId: string) {
  const theme = await prisma.themePackage.findUnique({ where: { themeId } })
  if (!theme) return
  if (theme.enabled) throw new Error('Enabled theme must be rolled back before uninstall')
  await prisma.themePackage.delete({ where: { themeId } })
  await rm(resolveThemeAsset(getThemeInstallDir(), themeId), { recursive: true, force: true })
}
