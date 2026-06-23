type TranslationMap = Record<string, unknown>

function getTranslation(translations: TranslationMap, key: string): string | null {
  const value = translations[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function formatLogModule(module: string, translations: TranslationMap): string {
  return getTranslation(translations, module) || module
}

export function formatLogAction(action: string, translations: TranslationMap): string {
  return getTranslation(translations, action) || action
}

export function formatLogResult(result: string, translations: TranslationMap): string {
  return getTranslation(translations, result) || result
}

function translateLogDetails(details: string): string {
  return details
    .replace(/\bCPU:/g, 'CPU:')
    .replace(/\bMemory:/g, '内存:')
    .replace(/\bDisk:/g, '磁盘:')
    .replace(/\burl:/g, '地址:')
    .replace(/\blocation:/g, '地区:')
    .replace(/\bcountry:/g, '国家:')
    .replace(/\bstorage:/g, '存储:')
    .replace(/\binstanceType:/g, '实例类型:')
    .replace(/\bnetwork:/g, '网络:')
    .replace(/\bhosts:/g, '节点:')
    .replace(/\bhost:/g, '节点:')
    .replace(/\barch:/g, '架构:')
    .replace(/\bminor changes\b/g, '少量变更')
    .replace(/\bunknown\b/g, '未知')
    .replace(/\bN\/A\b/g, '无')
}

function translateLogError(message: string): string {
  return message
    .replace(/Failed creating instance record:/g, '创建实例记录失败：')
    .replace(/创建实例记录失败：\s*/g, '创建实例记录失败：')
    .replace(/Failed to create instance:\s*/g, '创建实例失败：')
    .replace(/Instance type "virtual-machine" is not supported on this server:\s*/g, '当前服务器不支持虚拟机实例类型：')
    .replace(/KVM support is missing \(no \/dev\/kvm\)/g, '缺少 KVM 支持（没有 /dev/kvm）')
    .replace(/Failed to run:/g, '执行失败：')
    .replace(/not authorized/gi, '未授权')
    .replace(/request returned error:/gi, '请求返回错误：')
}

export function formatLogContent(content: string): string {
  if (!content) return content

  const exactContent: Record<string, string> = {
    password: '修改密码',
    'Started 2FA setup': '开始设置双因素认证',
    'Enabled two-factor authentication': '启用双因素认证',
    'Disabled two-factor authentication': '禁用双因素认证',
    'Regenerated 2FA recovery codes': '重新生成双因素认证恢复码',
    '2FA disabled due to password reset': '因重置密码禁用双因素认证'
  }
  if (exactContent[content]) return exactContent[content]

  let match = content.match(/^Batch deleted instance "([^"]+)" on host "([^"]+)"(?: \(refund: ¥([^)]+)\))?$/)
  if (match) {
    return `批量删除节点 "${match[2]}" 上的实例 "${match[1]}"${match[3] ? `（退款：¥${match[3]}）` : ''}`
  }

  match = content.match(/^Updated image policy for host "([^"]+)" with (\d+) image\(s\)$/)
  if (match) return `更新节点 "${match[1]}" 的镜像策略，共 ${match[2]} 个镜像`

  match = content.match(/^Started system update from ([^\s]+) to ([^\s]+)$/)
  if (match) return `开始系统更新：${match[1]} -> ${match[2]}`

  match = content.match(/^Started rollback for system update task #(\d+)$/)
  if (match) return `开始回滚系统更新任务 #${match[1]}`

  match = content.match(/^Denied system update access for (.+)$/)
  if (match) return `拒绝用户 ${match[1]} 执行系统更新`

  match = content.match(/^Failed to create instance "([^"]+)": (.+)$/)
  if (match) return `创建实例 "${match[1]}" 失败：${translateLogError(match[2])}`

  match = content.match(/^Created plan "([^"]+)" for package "([^"]+)"$/)
  if (match) return `为套餐 "${match[2]}" 创建方案 "${match[1]}"`

  match = content.match(/^Updated plan "([^"]+)" for package "([^"]+)"$/)
  if (match) return `更新套餐 "${match[2]}" 的方案 "${match[1]}"`

  match = content.match(/^Deleted plan "([^"]+)" from package "([^"]+)"$/)
  if (match) return `从套餐 "${match[2]}" 删除方案 "${match[1]}"`

  match = content.match(/^Synced quota to (\d+) instance\(s\) for plan "([^"]+)"$/)
  if (match) return `已将方案 "${match[2]}" 的配额同步到 ${match[1]} 个实例`

  match = content.match(/^Created package "([^"]+)" \[(.+)\]$/)
  if (match) return `创建套餐 "${match[1]}" [${translateLogDetails(match[2])}]`

  match = content.match(/^Updated package "([^"]+)" \[(.+)\]$/)
  if (match) return `更新套餐 "${match[1]}" [${translateLogDetails(match[2])}]`

  match = content.match(/^Deleted package "([^"]+)" \[(.+)\]$/)
  if (match) return `删除套餐 "${match[1]}" [${translateLogDetails(match[2])}]`

  match = content.match(/^Released quota for package "([^"]+)": CPU \+([^,]+), Memory \+([^ ]+) on (\d+) host\(s\)$/)
  if (match) return `为套餐 "${match[1]}" 释放配额：CPU +${match[2]}，内存 +${match[3]}，作用节点 ${match[4]} 个`

  match = content.match(/^Created host "([^"]+)" \[(.+)\]$/)
  if (match) return `创建节点 "${match[1]}" [${translateLogDetails(match[2])}]`

  match = content.match(/^Updated host "([^"]+)" \[(.+)\]$/)
  if (match) return `更新节点 "${match[1]}" [${translateLogDetails(match[2])}]`

  match = content.match(/^Verified and connected host "([^"]+)" \[(.+)\]$/)
  if (match) return `验证并连接节点 "${match[1]}" [${translateLogDetails(match[2])}]`

  match = content.match(/^Created storage pool "([^"]+)" \(([^)]+)\) on host "([^"]+)"$/)
  if (match) return `在节点 "${match[3]}" 创建存储池 "${match[1]}"（${match[2]}）`

  match = content.match(/^Queued (start|stop|restart) task for instance "([^"]+)"$/)
  if (match) {
    const actionMap: Record<string, string> = { start: '启动', stop: '停止', restart: '重启' }
    return `已为实例 "${match[2]}" 创建${actionMap[match[1]]}任务`
  }

  match = content.match(/^Queued (rebuild|recreate) task for instance "([^"]+)" with image (.+)$/)
  if (match) {
    const actionMap: Record<string, string> = { rebuild: '重装', recreate: '重建' }
    return `已为实例 "${match[2]}" 创建${actionMap[match[1]]}任务，镜像 ${match[3]}`
  }

  match = content.match(/^Suspended instance "([^"]+)"(?: \(reason: (.+)\))?$/)
  if (match) return `暂停实例 "${match[1]}"${match[2] ? `（原因：${match[2]}）` : ''}`

  match = content.match(/^Unsuspended instance "([^"]+)"$/)
  if (match) return `恢复实例 "${match[1]}"`

  match = content.match(/^Added port mapping for instance "([^"]+)" \[(.+)\]$/)
  if (match) return `为实例 "${match[1]}" 添加端口映射 [${translateLogDetails(match[2])}]`

  match = content.match(/^Deleted port mapping for instance "([^"]+)" \[(.+)\]$/)
  if (match) return `删除实例 "${match[1]}" 的端口映射 [${translateLogDetails(match[2])}]`

  match = content.match(/^Failed to (add|delete) port mapping: (.+)$/)
  if (match) return `${match[1] === 'add' ? '添加' : '删除'}端口映射失败：${translateLogError(match[2])}`

  return translateLogError(content)
}
