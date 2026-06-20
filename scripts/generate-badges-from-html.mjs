import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

import ts from '../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js'

const rootDir = process.cwd()
const outputDir = path.join(rootDir, 'client', 'public', 'badges')
const manifestPath = path.join(rootDir, 'server', 'src', 'config', 'badges.generated.json')
const manifestTsPath = path.join(rootDir, 'server', 'src', 'config', 'badges.generated.ts')
const sourceFiles = [
  {
    fileName: 'aaaa.html',
    sourceId: 'core',
    sourceLabel: '核心科幻'
  },
  {
    fileName: 'bbbb.html',
    sourceId: 'astro-zodiac',
    sourceLabel: '星相生肖'
  }
]

function writeManifestTs(manifest) {
  fs.writeFileSync(
    manifestTsPath,
    `export const badgeCatalogData = ${JSON.stringify(manifest, null, 2)} as const\n`
  )
}

const passthroughAttributes = new Set(['viewBox', 'xmlns', 'preserveAspectRatio'])

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
}

function toAttributeName(name) {
  if (name === 'className') return 'class'
  if (passthroughAttributes.has(name)) return name
  return toKebabCase(name)
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function serializeStyle(style) {
  return Object.entries(style)
    .map(([key, value]) => `${toKebabCase(key)}:${value}`)
    .join(';')
}

function h(tag, props, ...children) {
  const normalizedProps = props || {}
  if (typeof tag === 'function') {
    return tag({ ...normalizedProps, children })
  }

  const attributes = Object.entries(normalizedProps)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([key, value]) => {
      if (value === true) {
        return toAttributeName(key)
      }

      const attrValue = key === 'style' && typeof value === 'object'
        ? serializeStyle(value)
        : value

      return `${toAttributeName(key)}="${escapeAttribute(attrValue)}"`
    })
    .join(' ')

  const content = children
    .flat(Infinity)
    .filter(value => value !== null && value !== undefined && value !== false)
    .join('')

  return `<${tag}${attributes ? ` ${attributes}` : ''}>${content}</${tag}>`
}

function Fragment(_props, ...children) {
  return children.flat(Infinity).join('')
}

const gradients = [
  { id: 'supreme', dark: ['#2a2d3e', '#0a0a0f'], light: ['#ffffff', '#cbd5e1'] },
  { id: 'void', dark: ['#1a0033', '#05000a', '#000000'], light: ['#312e81', '#0f172a', '#020617'] },
  { id: 'ice', dark: ['#002244', '#000a1a'], light: ['#e0f2fe', '#7dd3fc'] },
  { id: 'gold', dark: ['#4a3b1c', '#1a140a'], light: ['#fef3c7', '#fbbf24'] },
  { id: 'moon', dark: ['#334155', '#0f172a'], light: ['#f8fafc', '#94a3b8'] },
  { id: 'omega', dark: ['#4a0000', '#1a0000'], light: ['#fee2e2', '#f87171'] },
  { id: 'matrix', dark: ['#003311', '#001100'], light: ['#dcfce7', '#4ade80'] },
  { id: 'platinum', dark: ['#475569', '#1e293b'], light: ['#ffffff', '#94a3b8'] },
  { id: 'nebula', dark: ['#581c87', '#831843', '#171717'], light: ['#f3e8ff', '#fbcfe8', '#cbd5e1'] },
  { id: 'aegis', dark: ['#0f172a', '#020617'], light: ['#f1f5f9', '#94a3b8'] },
  { id: 'reactor', dark: ['#14532d', '#052e16'], light: ['#dcfce7', '#4ade80'] },
  { id: 'tactical', dark: ['#450a0a', '#2a0000'], light: ['#fee2e2', '#f87171'] },
  { id: 'arcane', dark: ['#3b0764', '#17002e'], light: ['#f3e8ff', '#c084fc'] }
]

function buildDefs() {
  const filters = `
<filter id="glow-neon-d" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="4" result="blur"></feGaussianBlur>
  <feMerge>
    <feMergeNode in="blur"></feMergeNode>
    <feMergeNode in="SourceGraphic"></feMergeNode>
  </feMerge>
</filter>
<filter id="glow-intense-d" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="8" result="b1"></feGaussianBlur>
  <feGaussianBlur stdDeviation="3" result="b2"></feGaussianBlur>
  <feMerge>
    <feMergeNode in="b1"></feMergeNode>
    <feMergeNode in="b2"></feMergeNode>
    <feMergeNode in="SourceGraphic"></feMergeNode>
  </feMerge>
</filter>
<filter id="glow-neon-l" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.2" result="shadow"></feDropShadow>
  <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="glow"></feGaussianBlur>
  <feMerge>
    <feMergeNode in="shadow"></feMergeNode>
    <feMergeNode in="glow"></feMergeNode>
    <feMergeNode in="SourceGraphic"></feMergeNode>
  </feMerge>
</filter>
<filter id="glow-intense-l" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#000" flood-opacity="0.25" result="shadow"></feDropShadow>
  <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b1"></feGaussianBlur>
  <feGaussianBlur in="SourceGraphic" stdDeviation="1" result="b2"></feGaussianBlur>
  <feMerge>
    <feMergeNode in="shadow"></feMergeNode>
    <feMergeNode in="b1"></feMergeNode>
    <feMergeNode in="b2"></feMergeNode>
    <feMergeNode in="SourceGraphic"></feMergeNode>
  </feMerge>
</filter>`

  const gradientMarkup = gradients.map(gradient => {
    const buildGradient = (colors, theme) => {
      const stops = colors.map((color, index) => {
        const offset = colors.length === 1
          ? '0%'
          : `${(index / (colors.length - 1)) * 100}%`
        return `<stop offset="${offset}" stop-color="${color}"></stop>`
      }).join('')
      return `<linearGradient id="bg-${gradient.id}-${theme}" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient>`
    }

    return [
      buildGradient(gradient.dark, 'd'),
      buildGradient(gradient.light, 'l')
    ].join('')
  }).join('')

  return `<defs>${filters}${gradientMarkup}</defs>`
}

const defsMarkup = buildDefs()

function injectDefs(svg, extraStyles = '') {
  const withXmlns = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  const styleBlock = extraStyles ? `<style>${extraStyles}</style>` : ''
  return withXmlns.replace(/^(<svg[^>]*>)/, `$1${styleBlock}${defsMarkup}`)
}

function splitLabel(label) {
  const matched = label.match(/^(.*?)\s+\((.*?)\)$/)
  if (!matched) {
    return {
      name: label.trim(),
      nameEn: null
    }
  }

  return {
    name: matched[1].trim(),
    nameEn: matched[2].trim()
  }
}

function splitSeriesMeta(title) {
  const normalized = title.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const matched = normalized.match(/^([A-Z]+)\s+(.+)$/)
  if (!matched) {
    return {
      seriesId: 'misc',
      seriesNameEn: null,
      seriesNameZh: normalized
    }
  }

  return {
    seriesId: matched[1].toLowerCase(),
    seriesNameEn: matched[1],
    seriesNameZh: matched[2].trim()
  }
}

const availableSourceFiles = sourceFiles.filter(source => fs.existsSync(path.join(rootDir, source.fileName)))

if (availableSourceFiles.length !== sourceFiles.length) {
  if (fs.existsSync(manifestPath)) {
    const existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    writeManifestTs(existingManifest)
    console.warn('Badge source html files are missing. Kept existing badge assets and regenerated TypeScript manifest from JSON only.')
    process.exit(0)
  }

  throw new Error('Badge source html files are missing and no existing manifest is available.')
}

fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })
fs.mkdirSync(path.join(outputDir, 'dark'), { recursive: true })
fs.mkdirSync(path.join(outputDir, 'light'), { recursive: true })

const manifest = []
const seenBadgeIds = new Set()

for (const source of availableSourceFiles) {
  const sourcePath = path.join(rootDir, source.fileName)
  const html = fs.readFileSync(sourcePath, 'utf8')
  const styleMatches = Array.from(html.matchAll(/<style>([\s\S]*?)<\/style>/g))
  const extraStyles = styleMatches
    .map(match => match[1].trim())
    .filter(Boolean)
    .join('\n')

  const scriptMatch = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)
  if (!scriptMatch) {
    throw new Error(`Failed to locate badge source script in ${source.fileName}`)
  }

  const scriptContent = scriptMatch[1]
  const componentStart = scriptContent.indexOf('const SvgFilters')
  const componentEnd = scriptContent.indexOf('const App = () =>')
  if (componentStart === -1 || componentEnd === -1) {
    throw new Error(`Failed to locate badge component section in ${source.fileName}`)
  }

  const componentSource = scriptContent.slice(componentStart, componentEnd)
  const transpiled = ts.transpileModule(componentSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment'
    }
  }).outputText

  const context = {
    h,
    Fragment,
    console
  }
  vm.createContext(context)
  vm.runInContext(`${transpiled}
this.seriesData = seriesData;`, context)

  for (const series of context.seriesData) {
    const seriesMeta = splitSeriesMeta(series.title)
    const seriesId = seriesMeta.seriesId
    const seriesTitle = series.title
    for (const item of series.icons) {
      if (seenBadgeIds.has(item.id)) {
        throw new Error(`Duplicate badge id detected: ${item.id}`)
      }
      seenBadgeIds.add(item.id)

      const parts = splitLabel(item.label)
      const renderProps = {
        d: true,
        c1: item.c1,
        c2: item.c2,
        bgId: item.bg,
        element: item.el,
        lines: item.lines,
        nodes: item.nodes
      }
      const darkSvgMarkup = injectDefs(item.component(renderProps), extraStyles)
      const lightSvgMarkup = injectDefs(item.component({ ...renderProps, d: false }), extraStyles)
      const fileName = `${item.id}.svg`
      fs.writeFileSync(path.join(outputDir, 'dark', fileName), `${darkSvgMarkup}\n`)
      fs.writeFileSync(path.join(outputDir, 'light', fileName), `${lightSvgMarkup}\n`)
      manifest.push({
        id: item.id,
        name: parts.name,
        nameEn: parts.nameEn,
        fullLabel: item.label,
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        seriesId,
        seriesTitle,
        seriesNameZh: seriesMeta.seriesNameZh,
        seriesNameEn: seriesMeta.seriesNameEn,
        seriesDescription: series.desc,
        assetUrl: `/badges/dark/${fileName}`,
        assetUrlDark: `/badges/dark/${fileName}`,
        assetUrlLight: `/badges/light/${fileName}`
      })
    }
  }
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
writeManifestTs(manifest)
console.log(`Generated ${manifest.length} badge assets and manifest.`)
