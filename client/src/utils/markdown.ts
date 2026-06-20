import { marked, Renderer } from 'marked'

// 自定义 Alert 颜色配置
const alertColors: Record<string, { bg: string; bgLight: string; border: string; text: string; textLight: string; icon: string }> = {
  info: {
    bg: 'bg-blue-900/30',
    bgLight: 'bg-blue-50',
    border: 'border-blue-500/50',
    text: 'text-blue-400',
    textLight: 'text-blue-600',
    icon: '<svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
  },
  success: {
    bg: 'bg-green-900/30',
    bgLight: 'bg-green-50',
    border: 'border-green-500/50',
    text: 'text-green-400',
    textLight: 'text-green-600',
    icon: '<svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>'
  },
  warning: {
    bg: 'bg-yellow-900/30',
    bgLight: 'bg-yellow-50',
    border: 'border-yellow-500/50',
    text: 'text-yellow-400',
    textLight: 'text-yellow-600',
    icon: '<svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>'
  },
  danger: {
    bg: 'bg-red-900/30',
    bgLight: 'bg-red-50',
    border: 'border-red-500/50',
    text: 'text-red-400',
    textLight: 'text-red-600',
    icon: '<svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>'
  },
  note: {
    bg: 'bg-gray-800/50',
    bgLight: 'bg-gray-100',
    border: 'border-gray-500/50',
    text: 'text-gray-400',
    textLight: 'text-gray-600',
    icon: '<svg class="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"/></svg>'
  }
}

// 颜色别名映射
const colorAliases: Record<string, string> = {
  blue: 'info',
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  gray: 'note',
  grey: 'note'
}

/**
 * 解析自定义 Alert 语法: ?{颜色}[内容]
 * 支持的颜色: info/blue, success/green, warning/yellow, danger/red, note/gray
 */
function parseCustomAlerts(content: string): string {
  // 匹配 ?{颜色}[内容] 格式，内容可以跨行
  const alertRegex = /\?\{(\w+)\}\[([\s\S]*?)\]/g

  return content.replace(alertRegex, (_, color: string, text: string) => {
    const normalizedColor = colorAliases[color.toLowerCase()] || color.toLowerCase()
    const colorConfig = alertColors[normalizedColor] || alertColors.info

    // 处理内容中的换行
    const processedText = text.trim().replace(/\n/g, '<br>')

    return `<div class="md-alert md-alert-${normalizedColor} dark:${colorConfig.bg} ${colorConfig.bgLight} border ${colorConfig.border} rounded-lg p-4 my-4 flex items-start gap-3">
      <span class="dark:${colorConfig.text} ${colorConfig.textLight}">${colorConfig.icon}</span>
      <div class="flex-1 dark:${colorConfig.text} ${colorConfig.textLight} text-sm leading-relaxed">${processedText}</div>
    </div>`
  })
}


/**
 * 创建自定义 marked 渲染器
 */
function createCustomRenderer(): Renderer {
  const renderer = new Renderer()

  // 自定义链接渲染 - 外部链接新窗口打开
  renderer.link = ({ href, title, text }) => {
    const isExternal = href?.startsWith('http://') || href?.startsWith('https://')
    const titleAttr = title ? ` title="${title}"` : ''
    const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : ''
    const externalIcon = isExternal
      ? ' <svg class="inline-block w-3.5 h-3.5 ml-0.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>'
      : ''
    return `<a href="${href}"${titleAttr}${targetAttr}>${text}${externalIcon}</a>`
  }

  // 自定义图片渲染 - 支持图片标题和懒加载
  renderer.image = ({ href, title, text }) => {
    const titleAttr = title ? ` title="${title}"` : ''
    const altAttr = text ? ` alt="${text}"` : ''
    const figcaption = title ? `<figcaption class="text-center text-sm text-themed-muted mt-2">${title}</figcaption>` : ''
    return `<figure class="my-4">
      <img src="${href}"${altAttr}${titleAttr} loading="lazy" class="rounded-lg max-w-full mx-auto" />
      ${figcaption}
    </figure>`
  }

  // 自定义代码块渲染
  renderer.code = ({ text, lang }) => {
    const langLabel = lang ? `<span class="absolute top-2 right-2 text-xs text-themed-muted opacity-60">${lang}</span>` : ''
    const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    return `<div class="relative group">
      <pre><code class="language-${lang || 'plaintext'}">${escapedText}</code></pre>
      ${langLabel}
    </div>`
  }

  // 自定义表格渲染 - 添加响应式包装
  renderer.table = (token: any) => {
    const headerRows = token.header.map((row: any[]) =>
      `<tr>${row.map((cell: any) => `<th>${cell.text}</th>`).join('')}</tr>`
    ).join('')
    const bodyRows = token.rows.map((row: any[]) =>
      `<tr>${row.map((cell: any) => `<td>${cell.text}</td>`).join('')}</tr>`
    ).join('')
    return `<div class="overflow-x-auto my-4">
      <table class="min-w-full">
        <thead>${headerRows}</thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`
  }

  // 自定义引用块渲染
  renderer.blockquote = ({ text }) => {
    return `<blockquote class="border-l-4 border-accent/50 pl-4 my-4 italic text-themed-secondary">${text}</blockquote>`
  }

  // 自定义水平线
  renderer.hr = () => {
    return '<hr class="my-8 border-t border-themed" />'
  }

  // 自定义复选框列表项
  renderer.listitem = ({ text, task, checked }) => {
    if (task) {
      const checkboxClass = checked
        ? 'text-green-500'
        : 'text-themed-muted'
      const checkIcon = checked
        ? '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>'
        : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"/></svg>'
      return `<li class="flex items-start gap-2 ${checkboxClass}"><span class="mt-0.5 flex-shrink-0">${checkIcon}</span><span>${text}</span></li>`
    }
    return `<li>${text}</li>`
  }

  return renderer
}

/**
 * 配置 marked 选项
 */
function configureMarked(): void {
  marked.setOptions({
    breaks: true,
    gfm: true,
    renderer: createCustomRenderer()
  } as any)
}

// 初始化配置
configureMarked()

/**
 * 解析 Markdown 内容为 HTML
 * @param content Markdown 内容
 * @returns 解析后的 HTML
 */
export function parseMarkdown(content: string): string {
  if (!content) return ''

  // 先处理自定义 Alert 语法
  const processedContent = parseCustomAlerts(content)

  // 使用 marked 解析
  return marked(processedContent) as string
}

/**
 * 获取 Markdown 样式类名
 * 用于在组件中应用样式
 */
export const markdownStyles = `
/* ============ Markdown 基础样式 ============ */
.markdown-body {
  color: var(--text-primary);
  line-height: 1.7;
}

.markdown-body > *:first-child {
  margin-top: 0 !important;
}

.markdown-body > *:last-child {
  margin-bottom: 0 !important;
}

/* 标题 */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  color: var(--text-primary);
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body h1 { font-size: 1.75em; }
.markdown-body h2 { 
  font-size: 1.5em; 
  border-bottom: 1px solid var(--border-color); 
  padding-bottom: 0.3em; 
}
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4 { font-size: 1.1em; }
.markdown-body h5 { font-size: 1em; }
.markdown-body h6 { font-size: 0.9em; color: var(--text-secondary); }

/* 段落 */
.markdown-body p {
  margin: 1em 0;
}

/* 链接 */
.markdown-body a {
  color: var(--accent);
  text-decoration: none;
  transition: color 0.15s;
}

.markdown-body a:hover {
  text-decoration: underline;
}

/* 图片 */
.markdown-body img {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-body figure {
  margin: 1.5em 0;
}

/* 列表 */
.markdown-body ul,
.markdown-body ol {
  padding-left: 1.5em;
  margin: 1em 0;
}

.markdown-body ul {
  list-style-type: disc;
}

.markdown-body ol {
  list-style-type: decimal;
}

.markdown-body li {
  margin: 0.5em 0;
}

.markdown-body li > ul,
.markdown-body li > ol {
  margin: 0.25em 0;
}

/* 任务列表 */
.markdown-body ul:has(li > span:first-child > svg) {
  list-style: none;
  padding-left: 0;
}

/* 行内代码 */
.markdown-body code {
  background: var(--bg-tertiary);
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

/* 代码块 */
.markdown-body pre {
  background: var(--bg-tertiary);
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1em 0;
  border: 1px solid var(--border-color);
}

.markdown-body pre code {
  background: none;
  padding: 0;
  font-size: 0.875em;
  line-height: 1.6;
}

/* 引用块 */
.markdown-body blockquote {
  border-left: 4px solid var(--accent);
  padding-left: 1em;
  margin: 1em 0;
  color: var(--text-secondary);
}

.markdown-body blockquote p {
  margin: 0.5em 0;
}

/* 表格 */
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.9em;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border-color);
  padding: 0.6em 1em;
  text-align: left;
}

.markdown-body th {
  background: var(--bg-tertiary);
  font-weight: 600;
}

.markdown-body tr:hover td {
  background: var(--bg-secondary);
}

/* 水平线 */
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 2em 0;
}

/* 删除线 */
.markdown-body del {
  color: var(--text-tertiary);
}

/* 强调 */
.markdown-body strong {
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-body em {
  font-style: italic;
}

/* 键盘按键 */
.markdown-body kbd {
  display: inline-block;
  padding: 0.2em 0.4em;
  font-size: 0.85em;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 1px 0 var(--border-color);
}

/* ============ 自定义 Alert 样式 ============ */
.md-alert {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  margin: 1rem 0;
  border-radius: 0.5rem;
  border-width: 1px;
}

.md-alert svg {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
}

.md-alert > div {
  flex: 1;
  font-size: 0.875rem;
  line-height: 1.5;
}

/* Alert 颜色变体 - 暗色主题 */
.dark .md-alert-info {
  background-color: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
}
.dark .md-alert-info svg,
.dark .md-alert-info > div {
  color: #60a5fa;
}

.dark .md-alert-success {
  background-color: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.3);
}
.dark .md-alert-success svg,
.dark .md-alert-success > div {
  color: #4ade80;
}

.dark .md-alert-warning {
  background-color: rgba(234, 179, 8, 0.15);
  border-color: rgba(234, 179, 8, 0.3);
}
.dark .md-alert-warning svg,
.dark .md-alert-warning > div {
  color: #facc15;
}

.dark .md-alert-danger {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
}
.dark .md-alert-danger svg,
.dark .md-alert-danger > div {
  color: #f87171;
}

.dark .md-alert-note {
  background-color: rgba(107, 114, 128, 0.15);
  border-color: rgba(107, 114, 128, 0.3);
}
.dark .md-alert-note svg,
.dark .md-alert-note > div {
  color: #9ca3af;
}

/* Alert 颜色变体 - 亮色主题 */
.light .md-alert-info {
  background-color: #eff6ff;
  border-color: rgba(59, 130, 246, 0.3);
}
.light .md-alert-info svg,
.light .md-alert-info > div {
  color: #2563eb;
}

.light .md-alert-success {
  background-color: #f0fdf4;
  border-color: rgba(34, 197, 94, 0.3);
}
.light .md-alert-success svg,
.light .md-alert-success > div {
  color: #16a34a;
}

.light .md-alert-warning {
  background-color: #fefce8;
  border-color: rgba(234, 179, 8, 0.3);
}
.light .md-alert-warning svg,
.light .md-alert-warning > div {
  color: #ca8a04;
}

.light .md-alert-danger {
  background-color: #fef2f2;
  border-color: rgba(239, 68, 68, 0.3);
}
.light .md-alert-danger svg,
.light .md-alert-danger > div {
  color: #dc2626;
}

.light .md-alert-note {
  background-color: #f9fafb;
  border-color: rgba(107, 114, 128, 0.3);
}
.light .md-alert-note svg,
.light .md-alert-note > div {
  color: #4b5563;
}

/* ============ 代码高亮主题适配 ============ */
/* 暗色主题代码高亮 */
.dark .markdown-body pre {
  background: #0d1117;
  border-color: #30363d;
}

.dark .markdown-body .hljs {
  color: #c9d1d9;
  background: transparent;
}

.dark .markdown-body .hljs-keyword,
.dark .markdown-body .hljs-selector-tag,
.dark .markdown-body .hljs-title {
  color: #ff7b72;
}

.dark .markdown-body .hljs-string,
.dark .markdown-body .hljs-attr {
  color: #a5d6ff;
}

.dark .markdown-body .hljs-comment {
  color: #8b949e;
}

.dark .markdown-body .hljs-number,
.dark .markdown-body .hljs-literal {
  color: #79c0ff;
}

.dark .markdown-body .hljs-function,
.dark .markdown-body .hljs-built_in {
  color: #d2a8ff;
}

.dark .markdown-body .hljs-variable,
.dark .markdown-body .hljs-template-variable {
  color: #ffa657;
}

/* 亮色主题代码高亮 */
.light .markdown-body pre {
  background: #f6f8fa;
  border-color: #d0d7de;
}

.light .markdown-body .hljs {
  color: #24292f;
  background: transparent;
}

.light .markdown-body .hljs-keyword,
.light .markdown-body .hljs-selector-tag,
.light .markdown-body .hljs-title {
  color: #cf222e;
}

.light .markdown-body .hljs-string,
.light .markdown-body .hljs-attr {
  color: #0a3069;
}

.light .markdown-body .hljs-comment {
  color: #6e7781;
}

.light .markdown-body .hljs-number,
.light .markdown-body .hljs-literal {
  color: #0550ae;
}

.light .markdown-body .hljs-function,
.light .markdown-body .hljs-built_in {
  color: #8250df;
}

.light .markdown-body .hljs-variable,
.light .markdown-body .hljs-template-variable {
  color: #953800;
}
`

export default parseMarkdown
