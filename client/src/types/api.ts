/**
 * API 请求/响应类型定义
 */

export interface VipBadgeStyle {
  backgroundColor: string
  textColor: string
}

// ==================== 认证相关 ====================

export interface LoginRequest {
  username: string
  password: string
  turnstileToken?: string
}

export interface LoginResponse {
  token: string
  user: {
    id: number
    username: string
    email: string
    role: 'admin' | 'user'
    avatarStyle?: string
    avatarBadgeId?: string | null
    hasCreatedHostBefore?: boolean
    canAccessHostingFeature?: boolean
  }
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  inviteCode?: string
  turnstileToken?: string
  emailCode?: string
}

export interface RegisterResponse {
  token: string
  user: {
    id: number
    username: string
    email: string
    role: 'admin' | 'user'
    avatarStyle?: string
    avatarBadgeId?: string | null
    hasCreatedHostBefore?: boolean
    canAccessHostingFeature?: boolean
  }
}

export interface UpdateUserResponse {
  message: string
  reauthRequired?: boolean
}

export interface GenerateInviteRequest {
  expiresAt?: string
  count?: number
}

export interface InviteCode {
  id: number
  code: string
  created_by: number
  createdByUsername?: string | null
  createdByEmail?: string | null
  createdByAvatarStyle?: string | null
  createdByAvatarBadgeId?: string | null
  used_by: number | null
  usedBy?: number | null
  usedByUsername?: string | null
  usedByEmail?: string | null
  usedByAvatarStyle?: string | null
  usedByAvatarBadgeId?: string | null
  used_at: string | null
  usedAt?: string | null
  expires_at: string | null
  expiresAt?: string | null
  costSnapshot?: InviteGenerationCostSnapshot | null
  cost_snapshot?: InviteGenerationCostSnapshot | null
  created_at: string
  createdAt?: string
}

export interface InviteListResponse {
  invites: InviteCode[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface InviteCostOption {
  resource: string
  amount: number
  enabled: boolean
  label: string
  unit: string
  displayAmount: string
}

export interface InviteGenerationCostSnapshot {
  resource: string
  amount: number
  label: string
  unit: string
  displayAmount: string
  chargedAt: string
}

export interface UserInvite {
  id: number
  code: string
  createdBy: number
  usedBy: number | null
  usedAt: string | null
  expiresAt: string | null
  createdAt: string
  costSnapshot: InviteGenerationCostSnapshot | null
  registerUrl: string
  usedByUser: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId: string | null
    createdAt: string
  } | null
}

export interface UserInviteSummary {
  costOptions: InviteCostOption[]
  balances: {
    balance: number
    points: number
  }
  stats: {
    total: number
    used: number
    unused: number
    usageRate: number
  }
}

export interface VersionMetadata {
  version: string
  gitTag: string | null
  gitCommit: string | null
  buildTime: string | null
  deployedAt: string | null
  changelog: string[]
}

export interface AvailableSystemUpdate {
  version: string
  commit: string | null
  date: string | null
  changelog: string[]
  ota: OtaReleaseInfo
}

export interface OtaArtifactInfo {
  name: string
  platform: string
  arch: string
  url: string
  sha256: string
  size: number | null
}

export interface OtaReleaseInfo {
  manifestAvailable: boolean
  manifestUrl: string | null
  artifacts: OtaArtifactInfo[]
  error: string | null
}

export interface SystemUpdateCheckResult {
  current: VersionMetadata
  latest: AvailableSystemUpdate | null
  updates: AvailableSystemUpdate[]
  updateAvailable: boolean
  repositoryAvailable: boolean
  repositoryError: string | null
  canManageUpdates?: boolean
}

export type SystemUpdateTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'

export interface SystemUpdateTask {
  id: number
  targetVersion: string
  fromVersion: string | null
  status: SystemUpdateTaskStatus
  startedByUserId: number
  startedByUsername: string | null
  backupPath: string | null
  logPath: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type UserLifecycleTagKey =
  | 'new_user'
  | 'paid_user'
  | 'high_value'
  | 'expiring_soon'
  | 'churn_risk'
  | 'risk_flag'

export interface UserLifecycleMetric {
  totalRecharge: number
  totalConsume: number
  instanceCount: number
  runningInstances: number
  expiringSoonInstances: number
  earliestExpiry: string | null
  lastLoginAt: string | null
}

export interface UserLifecycleTagDefinition {
  key: UserLifecycleTagKey
  label: string
  description: string
  count?: number
}

export interface UserLifecycleSegment {
  id?: number
  key: string
  name: string
  description: string | null
  enabled?: boolean
  count?: number
  matchedAt?: string
  snapshot?: Record<string, unknown>
}

export interface UserLifecycleAction {
  id: number
  actionType: string
  status: string
  targetUserId: number | null
  actorUserId: number
  actorUsername: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  message: string | null
  createdAt: string
}

export interface UserLifecycleEvent {
  id: number
  userId: number
  eventType: string
  eventKey: string
  sourceType: string | null
  sourceId: number | null
  metadata: Record<string, unknown> | null
  occurredAt: string
  createdAt: string
}

export interface UserLifecycleOffer {
  id: number
  code: string
  codeType: 'c' | 'r' | 'd' | 't'
  codeValue: number
  expiresAt: string | null
  remark: string | null
  host: { id: number; name: string }
  used: boolean
  usedAt: string | null
}

export interface UserLifecycleListUser {
  id: number
  username: string
  emailMasked: string | null
  status: string
  createdAt: string
  metrics: UserLifecycleMetric
  tags: Array<{ tagKey: UserLifecycleTagKey; active?: boolean; note: string | null; assignedAt: string }>
  segments: UserLifecycleSegment[]
}

export interface UserLifecycleOverview {
  totalUsers: number
  activeUsers: number
  expiringInstances: number
  tags: UserLifecycleTagDefinition[]
  segments: UserLifecycleSegment[]
  recentActions: UserLifecycleAction[]
}

export interface UserLifecycleUsersResponse {
  users: UserLifecycleListUser[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface UserLifecycleUserSummary extends UserLifecycleListUser {
  tickets: { total: number; open: number }
  events: UserLifecycleEvent[]
  actions: UserLifecycleAction[]
  offers: UserLifecycleOffer[]
}

export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'failed'
export type PluginSourceType = 'upload' | 'market'
export type PluginTaskStatus = 'pending' | 'running' | 'success' | 'failed'
export type PluginTaskAction = 'upload_install' | 'market_install' | 'enable' | 'disable' | 'uninstall'

export interface PluginPageManifest {
  slot: string
  title: string
  entry: string
  path?: string | null
  requiresAuth?: boolean
}

export interface PluginTemplateManifest {
  name: string
  path: string
}

export interface PluginConfigOptionManifest {
  label: string
  value: string
}

export interface PluginConfigFieldManifest {
  type: 'text' | 'textarea' | 'markdown' | 'password' | 'email' | 'number' | 'select' | 'tags' | 'checkbox' | 'color' | 'file' | 'placeholder'
  label: string
  description?: string
  placeholder?: string
  group?: string
  order?: number
  required: boolean
  default?: unknown
  options?: PluginConfigOptionManifest[]
  min?: number
  max?: number
  step?: number
  secret?: boolean
}

export interface PluginActionManifest {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  runtime?: 'webhook'
  url?: string
  scopes: string[]
  requestSchema?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
  idempotency?: 'none' | 'optional' | 'required'
  rateLimit?: 'normal' | 'strict'
}

export interface PluginEventSubscriptionManifest {
  event: string
  handler: string
}

export interface PluginNotificationTemplateManifest {
  id: string
  title: string
  message: string
  variables?: string[]
}

export type PluginServiceExtensionHook =
  | 'checkoutConfig'
  | 'provision'
  | 'suspend'
  | 'unsuspend'
  | 'terminate'
  | 'upgrade'
  | 'servicePanel'

export interface PluginServiceExtensionManifest {
  key: string
  name: string
  productId?: string
  hooks: Partial<Record<PluginServiceExtensionHook, string>>
}

export type PluginGatewayExtensionHook =
  | 'availability'
  | 'createPayment'
  | 'verifyPayment'
  | 'refund'
  | 'webhook'

export interface PluginGatewayExtensionManifest {
  key: string
  name: string
  providerCode?: string
  hooks: Partial<Record<PluginGatewayExtensionHook, string>>
}

export interface PluginTableMigrationManifest {
  version: string
  name: string
}

export interface PluginTableManifest {
  name: string
  description?: string
  scopes?: Array<'user' | 'global' | 'service'>
  maxRows?: number
  migrations?: PluginTableMigrationManifest[]
}

export interface PluginStorageManifest {
  kind: 'kv'
  maxKeys?: number
  scopes?: Array<'user' | 'global' | 'service'>
  retention?: 'keep' | 'delete_on_uninstall'
  tables?: PluginTableManifest[]
}

export interface PluginCapabilitiesManifest {
  actions?: PluginActionManifest[]
  events?: PluginEventSubscriptionManifest[]
  notificationTemplates?: PluginNotificationTemplateManifest[]
  serviceExtensions?: PluginServiceExtensionManifest[]
  gatewayExtensions?: PluginGatewayExtensionManifest[]
  storage?: PluginStorageManifest
}

export interface PayIncusPluginManifest {
  id: string
  name: string
  version: string
  payincus: string
  description?: string
  author?: string
  homepage?: string
  entrypoints: {
    adminPages?: PluginPageManifest[]
    userPages?: PluginPageManifest[]
  }
  permissions?: string[]
  configSchema?: Record<string, PluginConfigFieldManifest>
  templates?: PluginTemplateManifest[]
  capabilities?: PluginCapabilitiesManifest
}

export interface PluginVersion {
  id: number
  pluginId: string
  version: string
  manifest: PayIncusPluginManifest
  packageSha256: string
  installPath: string
  installedAt: string
}

export interface PluginRecord {
  id: number
  pluginId: string
  name: string
  status: PluginStatus
  enabled: boolean
  currentVersion: string | null
  sourceType: PluginSourceType
  sourceRepo: string | null
  installedByUsername: string | null
  enabledByUsername: string | null
  enabledAt: string | null
  createdAt: string
  updatedAt: string
  latestVersion: PluginVersion | null
  capabilityReviews?: PluginCapabilityReview[]
}

export type PluginCapabilityReviewStatus = 'pending' | 'approved' | 'rejected' | 'revoked'
export type PluginCapabilityRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PluginCapabilityReview {
  id: number
  pluginId: string
  pluginName: string | null
  pluginStatus: PluginStatus | null
  pluginEnabled: boolean | null
  pluginCurrentVersion: string | null
  manifestVersion: string
  capabilityKey: string
  capabilityType: string
  title: string
  description: string | null
  riskLevel: PluginCapabilityRiskLevel | string
  status: PluginCapabilityReviewStatus | string
  scopes: string[]
  hooks: string[]
  reviewNotes: string | null
  reviewedByUserId: number | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PublicPluginActionRateLimitDefault {
  rateLimit: 'normal' | 'strict'
  maxRequests: number
  windowSeconds: number
}

export interface PublicPluginActionRateLimitPolicy {
  id: number
  pluginId: string
  actionName: string
  rateLimit: 'normal' | 'strict'
  maxRequests: number
  windowSeconds: number
  enabled: boolean
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export interface PublicPluginActionRateLimitPolicyInput {
  pluginId?: string
  actionName?: string
  rateLimit: 'normal' | 'strict'
  maxRequests: number
  windowSeconds?: number
  enabled?: boolean
}

export interface PayIncusThemeManifest {
  id: string
  name: string
  version: string
  payincus: string
  description?: string
  author?: string
  homepage?: string
  css: string
  previewImage?: string
  tokens: Record<string, unknown>
  layoutSlots: string[]
  templates: PayIncusThemeTemplate[]
  configSchema: Record<string, PayIncusThemeConfigField>
}

export interface PayIncusThemeTemplate {
  slot: string
  title: string
  entry: string
}

export interface PayIncusThemeConfigOption {
  label: string
  value: string
}

export interface PayIncusThemeConfigField {
  type: string
  label: string
  description?: string
  placeholder?: string
  group?: string
  order?: number
  required: boolean
  default?: unknown
  options?: PayIncusThemeConfigOption[]
  min?: number
  max?: number
  step?: number
}

export interface ThemePackageRecord {
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

export interface ThemeMarketEntry {
  id: string
  name: string
  latest: string
  manifestUrl: string
  downloadUrl: string
  sha256: string
  description?: string
  author?: string
  previewImageUrl?: string
  reviewStatus: 'pending' | 'listed' | 'delisted' | 'rejected'
  trustLevel: 'official' | 'verified' | 'third_party'
  developer: {
    name: string
    homepage?: string
    github?: string
    verified: boolean
    contact?: string
  }
  compatibility: {
    minPayincus?: string
    maxPayincus?: string
  }
  security: {
    checksumPinned: boolean
    signature?: {
      status: 'unsigned' | 'valid' | 'missing' | 'invalid'
      algorithm?: string
      keyId?: string
    }
    notes: string[]
  }
  tokens: string[]
  layoutSlots: string[]
  rating: { average: number; count: number }
  installCount: number
  releaseNotes?: string
  rollbackNotes?: string
}

export interface ThemeMarketGovernance {
  totalEntries: number
  visibleEntries: number
  hiddenEntries: number
  indexHost: string | null
  fingerprint: string
  defaultReviewStatus: 'pending' | 'listed' | 'delisted' | 'rejected'
  installPolicy: string[]
}

export type ThemeMarketSubmissionReviewStatus = 'pending' | 'listed' | 'rejected' | 'delisted'
export type ThemeMarketSubmissionRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface ThemeMarketSubmission {
  id: number
  themeId: string
  version: string
  name: string
  repoUrl: string
  releaseUrl: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  developerName: string
  developerHomepage?: string | null
  developerGithub?: string | null
  contactEmail: string
  compatibility?: Record<string, unknown>
  tokens?: unknown
  layoutSlots?: unknown
  notes?: string | null
  reviewStatus: ThemeMarketSubmissionReviewStatus
  riskLevel: ThemeMarketSubmissionRiskLevel
  reviewNotes?: string | null
  scanStatus: 'pending' | 'passed' | 'warning' | 'failed'
  scanResult?: unknown
  scannedAt?: string | null
  submittedByUserId: number
  submittedByUsername?: string | null
  reviewedByUserId?: number | null
  reviewedByUsername?: string | null
  reviewedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ThemeMarketSubmissionScanResult {
  status: 'passed' | 'warning' | 'failed'
  riskLevel: ThemeMarketSubmissionRiskLevel
  manifest: {
    id: string
    name: string
    version: string
    payincus: string
    tokenCount: number
    layoutSlotCount: number
  } | null
  packageSha256: string | null
  findings: PluginMarketSubmissionScanFinding[]
  scannedAt: string
}

export interface ReviewThemeMarketSubmissionRequest {
  reviewStatus: ThemeMarketSubmissionReviewStatus
  riskLevel?: ThemeMarketSubmissionRiskLevel
  reviewNotes?: string | null
}

export interface ThemeMarketPublishResult {
  indexPath: string
  publishedEntries: number
  totalEntries: number
  updatedAt: string
}

export interface PluginUserData {
  id: number
  pluginId: string
  userId: number
  key: string
  value: unknown
  createdAt: string
  updatedAt: string
}

export interface PluginStorageItem {
  id: number
  pluginId: string
  scopeType: string
  scopeId: string
  key: string
  value: unknown
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export type PluginStorageScope = 'user' | 'global' | 'service'

export interface PluginTableRow {
  id: number
  pluginId: string
  tableName: string
  scopeType: string
  scopeId: string
  rowKey: string
  value: unknown
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: string
  updatedAt: string
}

export interface PluginTableMigration {
  id: number
  pluginId: string
  tableName: string
  version: string
  name: string
  appliedByUserId: number
  appliedAt: string
}

export interface PluginStorageUsage {
  pluginId: string
  storageDeclared: boolean
  retention: 'keep' | 'delete_on_uninstall'
  legacyUserKeyCount: number
  kv: Array<{
    scopeType: string
    keyCount: number
    maxKeys: number | null
    declared: boolean
  }>
  tables: Array<{
    tableName: string
    scopeType: string
    rowCount: number
    maxRows: number | null
    migrationCount: number
    declared: boolean
  }>
  warnings: Array<{
    level: 'warning' | 'critical'
    kind: 'kv' | 'table'
    label: string
    count: number
    limit: number
    usageRatio: number
    message: string
  }>
  totals: {
    kvKeys: number
    tableRows: number
    tableMigrations: number
  }
}

export interface PluginStorageBackup {
  schemaVersion: 1
  pluginId: string
  pluginVersion: string
  exportedAt: string
  backupId?: string
  mode?: 'full'
  contentSha256?: string
  legacyUserData: Array<{ userId: number; key: string; value: unknown; createdAt?: string; updatedAt?: string }>
  scopedStorage: Array<{ scopeType: string; scopeId: string; key: string; value: unknown; createdByUserId: number | null; updatedByUserId: number | null; createdAt?: string; updatedAt?: string }>
  tableRows: Array<{ tableName: string; scopeType: string; scopeId: string; rowKey: string; value: unknown; createdByUserId: number | null; updatedByUserId: number | null; createdAt?: string; updatedAt?: string }>
  tableMigrations: Array<{ tableName: string; version: string; name: string; appliedByUserId: number; appliedAt?: string }>
  counts: {
    legacyUserData: number
    scopedStorage: number
    tableRows: number
    tableMigrations: number
    totalItems?: number
  }
  restorePolicy?: {
    dryRunSupported: boolean
    restoreMode: 'replace_all_plugin_storage'
    modifiesBusinessData: boolean
    modifiesPluginPackage: boolean
  }
}

export interface PluginStorageRestoreResult {
  pluginId: string
  legacyUserData: number
  scopedStorage: number
  tableRows: number
  tableMigrations: number
  totalItems?: number
  contentSha256?: string
  archiveId?: string | null
}

export interface PluginStorageRestoreDryRunResult {
  pluginId: string
  valid: boolean
  contentSha256: string
  counts: {
    legacyUserData: number
    scopedStorage: number
    tableRows: number
    tableMigrations: number
    totalItems: number
  }
  restoreMode: 'replace_all_plugin_storage'
  modified: false
  archiveId?: string | null
}

export interface PluginStorageBackupArchive {
  backupId: string
  pluginId: string
  pluginVersion: string
  exportedAt: string
  mode: 'full'
  contentSha256: string
  counts: {
    legacyUserData: number
    scopedStorage: number
    tableRows: number
    tableMigrations: number
    totalItems: number
  }
  restorePolicy: {
    dryRunSupported: boolean
    restoreMode: 'replace_all_plugin_storage'
    modifiesBusinessData: boolean
    modifiesPluginPackage: boolean
  }
  remoteArchives?: PluginStorageBackupRemoteArchive[]
}

export interface PluginStorageBackupRemoteArchive {
  id: number
  pluginId: string
  backupId: string
  storageConfigId: number
  remoteFileName: string
  remotePath: string | null
  storageName: string
  storageType: string
  contentSha256: string
  fileSize: string
  status: string
  lastRestoredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PluginServiceExtensionTarget {
  pluginId: string
  serviceExtensionKey: string
  name: string
  productId: string | null
  hook: PluginServiceExtensionHook
}

export interface PluginGatewayExtensionTarget {
  pluginId: string
  gatewayExtensionKey: string
  name: string
  providerCode: string | null
  hook: PluginGatewayExtensionHook
}

export interface PluginExtensionContractResult {
  accepted: boolean
  status: 'accepted' | 'pending' | 'completed' | 'failed' | 'unsupported'
  message: string | null
  externalReference: string | null
  metadata: Record<string, unknown>
}

export interface PluginActionExecutionResult {
  pluginId: string
  action: string
  runtime: 'webhook'
  status: 'success'
  statusCode: number
  requestId: string
  result: unknown
}

export interface PluginServiceExtensionDispatchResult {
  pluginId: string
  serviceExtensionKey: string
  hook: PluginServiceExtensionHook
  action: PluginActionExecutionResult
  contract: PluginExtensionContractResult
}

export interface PluginGatewayExtensionDispatchResult {
  pluginId: string
  gatewayExtensionKey: string
  hook: PluginGatewayExtensionHook
  action: PluginActionExecutionResult
  contract: PluginExtensionContractResult
}

export type PublicApiScope =
  | 'profile:read'
  | 'profile:write'
  | 'balance:read'
  | 'balance:write'
  | 'billing:read'
  | 'products:read'
  | 'services:read'
  | 'services:operate'
  | 'services:billing'
  | 'orders:read'
  | 'tickets:read'
  | 'tickets:write'
  | 'notifications:read'
  | 'notifications:send'
  | 'plugins:action'

export interface PublicApiScopeMetadata {
  scope: PublicApiScope
  title: string
  description: string
  risk: 'low' | 'medium' | 'high'
  access: 'read' | 'write' | 'operate'
  resources: string[]
  implemented: boolean
  notes: string[]
}

export interface PublicApiProfile {
  id: number
  username: string
  email: string | null
  role: 'admin' | 'user'
  avatarStyle: string
  avatarBadgeId: string | null
}

export interface UpdatePublicApiProfileRequest {
  avatarStyle: string
}

export interface PublicApiBalance {
  userId: number
  balance: number
  currency: 'CNY'
  updatedAt: string
}

export type PublicApiBalanceLogType =
  | 'recharge'
  | 'consume'
  | 'refund'
  | 'admin_adjust'
  | 'gift'
  | 'transfer_fee'
  | 'transfer_refund'
  | 'hosting_withdraw'
  | 'hosting_deduction'
  | 'invite_generate'

export interface PublicApiBalanceLog {
  id: number
  type: PublicApiBalanceLogType
  amount: number
  balanceBefore: number
  balanceAfter: number
  orderId: string | null
  instance: { id: number; name: string } | null
  remark: string | null
  createdAt: string
}

export interface PublicApiOrder {
  id: string
  sourceType: 'recharge' | 'instance_billing'
  sourceId: number
  orderNo: string
  title: string
  status: string
  rawStatus: string
  amount: number
  actualAmount: number | null
  fee: number
  paymentMethod: string
  tradeNo: string | null
  failReason: string | null
  instance?: {
    id: number
    name: string
    status: string
    plan: {
      id: number
      name: string
      package: { id: number; name: string } | null
    } | null
  } | null
  months?: number | null
  periodStart?: string
  periodEnd?: string
  createdAt: string
  completedAt: string | null
  expiredAt: string | null
}

export interface PublicApiNotification {
  id: number
  eventType: string
  title: string
  content: string
  isRead: boolean
  createdAt: string
}

export interface PublicApiUnreadNotificationCount {
  count: number
}

export interface PublicApiPluginActionDescriptor {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  runtime: 'webhook'
  scopes: string[]
  idempotency: 'none' | 'optional' | 'required'
  rateLimit: 'normal' | 'strict'
  requestSchema: Record<string, unknown> | null
  responseSchema: Record<string, unknown> | null
}

export interface PublicApiPluginActionCatalogItem {
  pluginId: string
  name: string
  version: string
  description: string | null
  author: string | null
  homepage: string | null
  actionCount: number
  actions: PublicApiPluginActionDescriptor[]
}

export interface PublicApiPluginActionCatalog {
  pluginId: string
  name: string
  version: string
  description: string | null
  actions: PublicApiPluginActionDescriptor[]
}

export interface CreatePublicApiTicketRequest {
  subject: string
  content: string
  category?: 'general' | 'billing' | 'technical' | 'abuse'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  instanceId?: number
}

export interface PublicApiTicketCreateResult {
  id: number
  messageId: number
  subject: string
  category: string
  priority: string
  status: 'open'
  hostId: number | null
  instanceId: number | null
  attachments: []
}

export interface PublicApiToken {
  id: number
  name: string
  tokenPrefix: string
  scopes: PublicApiScope[]
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePublicApiTokenRequest {
  name: string
  scopes: PublicApiScope[]
  expiresAt?: string | null
}

export interface CreatePublicApiTokenResponse {
  token: string
  apiToken: PublicApiToken
}

export type PluginMarketSubmissionReviewStatus = 'pending' | 'listed' | 'rejected' | 'delisted'
export type PluginMarketSubmissionRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PluginMarketSubmission {
  id: number
  pluginId: string
  version: string
  name: string
  repoUrl: string
  releaseUrl: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  developerName: string
  developerHomepage: string | null
  developerGithub: string | null
  contactEmail: string
  permissions: unknown
  compatibility: unknown
  pricing: unknown
  notes: string | null
  reviewStatus: PluginMarketSubmissionReviewStatus
  riskLevel: PluginMarketSubmissionRiskLevel
  reviewNotes: string | null
  scanStatus: 'pending' | 'passed' | 'warning' | 'failed'
  scanResult: unknown
  scannedAt: string | null
  submittedByUserId: number
  submittedByUsername: string | null
  reviewedByUserId: number | null
  reviewedByUsername: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DeveloperPluginEventHealth {
  pluginId: string
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
  dueRetry: number
  lastEventAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  recentWindowHours: number
  recentTotal: number
  recentSuccess: number
  recentFailed: number
  recentRetryPending: number
  recentDeadLetter: number
  recentDeduped: number
  recentDueRetry: number
  recentSuccessRate: number | null
  trendWindowDays: number
  trend: DeveloperPluginEventHealthTrendPoint[]
  alerts: DeveloperPluginEventHealthAlert[]
  breakdown: DeveloperPluginEventHealthBreakdown[]
}

export interface DeveloperPluginEventHealthAlert {
  level: 'warning' | 'critical'
  code: string
  message: string
  count: number
}

export interface DeveloperPluginEventHealthTrendPoint {
  date: string
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
}

export interface DeveloperPluginEventHealthBreakdown {
  eventName: string
  handler: string
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
  dueRetry: number
  lastEventAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  recentWindowHours: number
  recentTotal: number
  recentSuccess: number
  recentFailed: number
  recentRetryPending: number
  recentDeadLetter: number
  recentDeduped: number
  recentDueRetry: number
  recentSuccessRate: number | null
  alerts: DeveloperPluginEventHealthAlert[]
}

export interface PluginEventAlertPreference {
  pluginId: string
  enabled: boolean
  minimumLevel: 'warning' | 'critical'
  cooldownMinutes: number
  notifyOnDeadLetter: boolean
  notifyOnDueRetry: boolean
  notifyOnSuccessRateBelow: boolean
  successRateThreshold: number
  recentWindowHours: number
  updatedAt: string | null
}

export interface UpdatePluginEventAlertPreferenceRequest {
  enabled?: boolean
  minimumLevel?: 'warning' | 'critical'
  cooldownMinutes?: number
  notifyOnDeadLetter?: boolean
  notifyOnDueRetry?: boolean
  notifyOnSuccessRateBelow?: boolean
  successRateThreshold?: number
  recentWindowHours?: number
}

export interface CreatePluginMarketSubmissionRequest {
  pluginId: string
  version: string
  name: string
  repoUrl: string
  releaseUrl: string
  manifestUrl: string
  packageUrl: string
  sha256: string
  developerName: string
  developerHomepage?: string | null
  developerGithub?: string | null
  contactEmail: string
  permissions?: Record<string, unknown>
  compatibility?: Record<string, unknown>
  pricing?: Record<string, unknown>
  notes?: string | null
}

export interface PluginMarketSubmissionUploadResult {
  pluginId: string
  version: string
  name: string
  packageUrl: string
  manifestUrl: string
  sha256: string
  permissions: Record<string, unknown>
  compatibility: Record<string, unknown>
  sourceName: string
}

export interface ReviewPluginMarketSubmissionRequest {
  reviewStatus: PluginMarketSubmissionReviewStatus
  riskLevel?: PluginMarketSubmissionRiskLevel
  reviewNotes?: string | null
}

export interface PluginMarketSubmissionScanFinding {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export interface PluginMarketSubmissionScanResult {
  status: 'passed' | 'warning' | 'failed'
  riskLevel: PluginMarketSubmissionRiskLevel
  manifest: {
    id: string
    name: string
    version: string
    permissions: string[]
  } | null
  packageSha256: string | null
  findings: PluginMarketSubmissionScanFinding[]
  scannedAt: string
}

export interface PluginMarketPublishResult {
  indexPath: string
  publishedEntries: number
  totalEntries: number
  updatedAt: string
}

export interface PluginTask {
  id: number
  pluginId: string | null
  action: PluginTaskAction
  status: PluginTaskStatus
  sourceType: PluginSourceType
  sourceUrl: string | null
  logPath: string | null
  errorMessage: string | null
  startedByUserId: number
  startedByUsername: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PluginEventLog {
  id: number
  pluginId: string
  userId: number | null
  action: string
  result: string
  message: string | null
  eventName: string | null
  handler: string | null
  payload: unknown
  actor: unknown
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  deadLetterAt: string | null
  dedupeKey: string | null
  lastAttemptAt: string | null
  lastError: string | null
  createdAt: string
}

export interface PluginEventSummary {
  total: number
  success: number
  failed: number
  retryPending: number
  deadLetter: number
  deduped: number
  dueRetry: number
  updatedAt: string
}

export interface PluginEventReplayResult {
  id: number
  pluginId: string
  eventName: string
  handler: string
  result: 'success' | 'retry_pending' | 'dead_letter'
  retryCount: number
}

export interface PluginConfigValue {
  id: number
  pluginId: string
  key: string
  value: unknown
  isSecret: boolean
  createdAt: string
  updatedAt: string
}

export interface PluginMarketEntry {
  id: string
  name: string
  latest: string
  repo: string
  manifestUrl: string
  downloadUrl: string
  sha256: string
  description?: string
  author?: string
  reviewStatus: 'pending' | 'listed' | 'delisted' | 'rejected'
  trustLevel: 'official' | 'verified' | 'third_party'
  developer: {
    name: string
    homepage?: string
    github?: string
    verified: boolean
    contact?: string
  }
  permissions: {
    adminPages: string[]
    userPages: string[]
    api: string[]
    storage: string[]
  }
  compatibility: {
    minPayincus?: string
    maxPayincus?: string
  }
  security: {
    checksumPinned: boolean
    signature?: {
      status: 'unsigned' | 'valid' | 'missing' | 'invalid'
      algorithm?: string
      keyId?: string
    }
    notes: string[]
  }
  pricing: {
    type: 'free' | 'paid'
    price?: string
    currency?: string
    revenueSharePercent?: number | null
  }
  rating: { average: number; count: number }
  installCount: number
  releaseNotes?: string
  upgradeNotes?: string
  rollbackNotes?: string
}

export interface PluginMarketGovernance {
  totalEntries: number
  visibleEntries: number
  hiddenEntries: number
  indexHost: string | null
  fingerprint: string
  defaultReviewStatus: 'pending' | 'listed' | 'delisted' | 'rejected'
  installPolicy: string[]
}

export interface PluginClientExtension {
  pluginId: string
  pluginName: string
  version: string | null
  slot: string
  title: string
  path: string | null
  requiresAuth: boolean
  url: string
}

// ==================== 用户相关 ====================

export interface User {
  id: number
  username: string
  email: string | null
  role: 'admin' | 'user'
  status: 'active' | 'banned'
  avatarStyle?: string
  avatarBadgeId?: string | null
  hasCreatedHostBefore?: boolean
  canAccessHostingFeature?: boolean
  twoFAEnabled?: boolean
  instanceCount?: number
  hasGithubBinding?: boolean
  balance?: number
  quota?: UserQuota
  created_at: string
  updated_at: string
  createdAt?: string
}

export interface UserQuota {
  id?: number
  userId?: number
  // 新配额系统：控制用户可拥有的资源数量
  // 配额为 0 表示功能未授权，需要管理员开启
  // 注意：不再限制实例配额，用户可以创建无限数量的实例
  hostLimit: number
  hostUsed: number
  friendLimit: number
  friendUsed: number
  packageLimit: number
  packageUsed: number
}

export interface UpdateUserRequest {
  email?: string
  role?: 'admin' | 'user'
  status?: 'active' | 'banned'
  avatarStyle?: string
  password?: string
  currentPassword?: string  // 修改密码时需要提供当前密码
  emailCode?: string
}

export interface TelegramBindingStatus {
  enabled: boolean
  configured: boolean
  botUsername: string | null
  binding: {
    telegramUserId: string
    telegramUsername: string | null
    firstName: string | null
    lastName: string | null
    boundAt: string
  } | null
}

export interface TelegramBindTokenResponse {
  bindUrl: string
  expiresAt: string
}

export interface TelegramWebhookInfo {
  url: string
  has_custom_certificate?: boolean
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
  max_connections?: number
  allowed_updates?: string[]
}

export interface TelegramWebhookInfoResponse {
  info: TelegramWebhookInfo
}

export interface TelegramWebhookSetupResponse {
  message: string
  webhookUrl: string
  commandsSynced?: boolean
  commands?: Array<{
    command: string
    description: string
  }>
  result?: boolean
}

export interface TelegramWebhookDeleteResponse {
  message: string
  result?: boolean
}

export interface TelegramGroupEligibility {
  eligible: boolean
  status: 'eligible' | 'ineligible' | 'disabled' | 'unconfigured'
  message: string
  joinMode: 'any' | 'all'
  minRecharge: number
  minConsume: number
}

export interface TelegramAdminBinding {
  id: number
  userId: number
  user: {
    id: number
    username: string
    email: string | null
    status: string
  } | null
  telegramUserId: string
  telegramUsername: string | null
  firstName: string | null
  lastName: string | null
  boundAt: string
  updatedAt: string
  stats: {
    totalRecharge: number
    totalConsume: number
    totalRefund: number
    totalDestroyedValue: number
  }
  eligibility: TelegramGroupEligibility
  vipEligibility: TelegramGroupEligibility
}

export interface TelegramAdminBindingsResponse {
  bindings: TelegramAdminBinding[]
  total: number
  page: number
  pageSize: number
  group: {
    enabled: boolean
    configured: boolean
    joinMode: 'any' | 'all'
    minRecharge: number
    minConsume: number
  }
  vipGroup: {
    enabled: boolean
    configured: boolean
    joinMode: 'any' | 'all'
    minRecharge: number
    minConsume: number
  }
}

export interface BadgeCatalogItem {
  id: string
  name: string
  nameEn: string | null
  fullLabel: string
  sourceId?: string
  sourceLabel?: string
  seriesId: string
  seriesTitle: string
  seriesNameZh?: string
  seriesNameEn?: string | null
  seriesDescription: string
  assetUrl: string
  assetUrlDark?: string
  assetUrlLight?: string
  displayOrder?: number
  isActive?: boolean
  seriesIsActive?: boolean
  createdAt?: string
  updatedAt?: string
  ownershipCount?: number
  avatarUseCount?: number
  instanceUseCount?: number
}

export interface BadgeSeriesItem {
  id: string
  title: string
  nameZh: string
  nameEn: string | null
  description: string
  sourceId?: string | null
  sourceLabel?: string | null
  displayOrder: number
  isActive: boolean
  badgeCount?: number
  activeBadgeCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface BadgeOwnership {
  id: number
  badgeId: string
  badgeName: string
  badgeNameEn: string | null
  badgeLabel: string
  seriesId: string
  seriesTitle: string
  assetUrl: string
  assetUrlDark?: string | null
  assetUrlLight?: string | null
  source: 'draw' | 'lottery' | 'select' | 'admin_grant'
  applicationTarget: 'avatar' | 'instance' | null
  appliedInstanceId: number | null
  appliedInstanceName: string | null
  appliedAt: string | null
  createdAt: string
}

export interface BadgeOverview {
  costs: {
    randomDraw: number
    select: number
  }
  currentPoints: number
  avatarBadgeId: string | null
  catalog: BadgeCatalogItem[]
  ownerships: BadgeOwnership[]
  instances: Array<{
    id: number
    name: string
    status: string
    iconBadgeId: string | null
    packagePlanId: number | null
    instanceType: 'container' | 'vm'
    host: {
      id: number
      name: string
      location: string | null
      countryCode: string
    }
  }>
}

export interface BadgeMultiDrawResponse {
  success: boolean
  currentPoints: number
  ownerships: BadgeOwnership[]
}

// ==================== 实例相关 ====================

export interface Instance {
  id: number
  incus_id: string
  name: string
  user_id?: number  // Only for admin
  host_id?: number  // Only for admin
  package_id: number | null
  displayOrder?: number
  display_order?: number
  image: string
  imageName?: string | null  // 镜像显示名称
  status: 'creating' | 'running' | 'stopped' | 'suspended' | 'error' | 'deleted'
  cpu: number
  memory: number
  disk: number
  ipv4: string | null
  ipv6: string | null
  network_mode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'  // camelCase 别名
  ssh_port: number | null
  root_password?: string | null  // Removed from API responses for security
  port_limit: number | null
  snapshot_limit: number | null
  backup_limit: number | null
  site_limit: number | null
  remaining_quota?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  quota_usage?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  effective_quota_limit?: {
    port: number
    snapshot: number
    backup: number
    site: number
  }
  swapEnabled?: boolean
  swapSize?: number | null
  monthlyTrafficLimit?: string | null  // BigInt as string (Bytes)
  trafficResetPrice?: number  // 元，实例实际自助重置价格
  limitsIngress?: string | null  // 入栈带宽限制
  limitsEgress?: string | null  // 出栈带宽限制
  planId?: number | null  // 方案ID（用于变更方案）
  packagePlanId?: number | null  // 付费方案ID（列表接口返回，用于判断是否付费实例）
  planName?: string | null
  planPrice?: number | null
  billingPrice?: number | null
  billingCycle?: number | null
  affDiscountRate?: number | null
  hasAffBinding?: boolean
  isHostedInstance?: boolean
  instanceType?: 'container' | 'vm'  // 实例类型：容器或虚拟机
  iconBadgeId?: string | null
  allow_instance_deletion?: boolean  // 是否允许删除实例（来自套餐设置）
  // 实例列表返回的宿主机信息
  host?: {
    name: string
    country_code: string
    nat_public_ip?: string | null
    storageDriver?: string
  }
  hostCountryCode?: string
  natPublicIp?: string | null
  hostNatPublicIpv6?: string | null
  hostIpv6Gateway?: string | null
  hostIpAddress?: string | null
  userAvatarBadgeId?: string | null
  // 封停相关字段
  expires_at?: string | null        // 到期时间，null 表示免费实例
  suspended_at?: string | null      // 封停时间
  suspended_by?: number | null      // 封停操作者 ID
  suspend_reason?: string | null    // 封停原因
  // 自动续费
  autoRenew?: boolean
  // 托管节点所有者信息（仅用户托管节点）
  hostOwnerInfo?: {
    id: number
    username: string
    email: string
    avatarStyle: string
    avatarBadgeId: string | null
    hostCount: number
    instanceCount: number
    registeredDays: number
    vipLevel: number
    vipBadgeStyle?: VipBadgeStyle | null
  } | null
  servicePanelExtensions?: Array<PluginServiceExtensionTarget & { hook: 'servicePanel' }>
  created_at: string
  createdAt?: string  // camelCase 别名
  updated_at: string
}

export interface InstanceWithDetails extends Omit<Instance, 'host'> {
  user?: Pick<User, 'id' | 'username' | 'email'>
  // 实例详情页面的宿主机信息（比列表更详细）
  host?: {
    id?: number
    name: string
    location?: string | null
    country_code: string
    nat_public_ip?: string | null
    storageDriver?: string
  }
  package?: Pick<Package, 'id' | 'name'>
  port_mappings?: PortMapping[]
  nat_public_ip?: string
  isHostOwner?: boolean  // True if current user owns the host
  isInstanceOwner?: boolean  // True if current user owns the instance
  isAdmin?: boolean  // True if current user is an admin
  enableResourcePool?: boolean  // 节点是否启用资源池玩法
}

export interface CreateInstanceRequest {
  name?: string
  packageId: number
  planId?: number  // 付费方案ID（付费套餐必填）
  image: string
  cpu: number
  memory: number
  disk: number
  hostId: number
  sshKeyId: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  customInitCommandIds?: number[]  // 用户自定义初始化命令 ID 列表
  promoCode?: string
  flashSaleItemId?: number
  idempotencyKey?: string
  turnstileToken?: string
}

export type ExchangeListingStatus = 'active' | 'paused' | 'delisted' | 'locked' | 'sold' | 'delivery_failed' | 'force_delisted'
export type ExchangeOrderStatus = 'escrowed' | 'delivering' | 'delivered' | 'confirming' | 'completed' | 'cancelled' | 'refunded' | 'disputed' | 'manual_review' | 'failed'
export type ExchangeDeliveryTaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type ExchangeWithdrawalStatus = 'pending' | 'approved' | 'paying' | 'completed' | 'rejected' | 'cancelled' | 'failed_returned'
export type ExchangeDisputeStatus = 'open' | 'processing' | 'rejected' | 'refunded' | 'redelivering' | 'released' | 'closed'

export interface ExchangePublicConfig {
  enabled: boolean
  minRemainingDays: number
  expiringSoonDays: number
  minPrice: number
  maxPrice: number | null
  maxMarkupPercent: number
  feePercent: number
  minFee: number
  maxFee: number | null
  confirmationHours: number
  autoConfirmEnabled: boolean
  allowBuyerImageSelection: boolean
  allowBalanceTransfer: boolean
  allowPublicIpTransfer: boolean
  withdrawalMinAmount: number
  dailyWithdrawalLimit: number | null
  dailyWithdrawalCountLimit: number
  maxActiveListingsPerUser: number
  maxPurchasesPerUserPerDay: number
  disputeTimeoutHours: number
}

export interface ExchangeInstanceSnapshot {
  instanceId?: number
  name?: string
  status: string
  cpu: number
  memory: number
  disk: number
  networkMode: string
  portLimit: number | null
  snapshotLimit: number | null
  backupLimit: number | null
  siteLimit: number | null
  limitsIngress: string | null
  limitsEgress: string | null
  monthlyTrafficLimit: string | null
  monthlyTrafficUsed: string | null
  expiresAt: string | null
  billingPrice: number | null
  billingCycle: number | null
  ipv4: string | null
  ipv6: string | null
  package: { id: number; name: string } | null
  packagePlan: { id: number; name: string } | null
  host: { id: number; name: string; location: string | null; countryCode: string | null }
  deliveryMode: 'reinstall_required'
  privacyMode: 'anonymous'
}

export interface ExchangeEligibilityResult {
  eligible: boolean
  status: 'can_list' | 'must_stop_first' | 'cannot_list'
  reasons: string[]
  checks: Array<{ key: string; label: string; passed: boolean; message: string }>
  instance?: ExchangeInstanceSnapshot
}

export interface ExchangeListing {
  id: number
  publicCode: string
  instanceId?: number
  status: ExchangeListingStatus
  price: number
  feeAmount: number
  sellerReceivesAmount: number
  description: string | null
  autoDelistAt: string | null
  listedAt: string
  delistedAt: string | null
  soldAt: string | null
  instance: ExchangeInstanceSnapshot
  snapshot?: ExchangeInstanceSnapshot
  deliveryMode: 'reinstall_required'
  privacyMode: 'anonymous'
}

export interface ExchangeMarketPackageCategory {
  id: number
  name: string
  count: number
}

export interface ExchangeDeliveryTask {
  id: number
  status: ExchangeDeliveryTaskStatus
  step: string
  progress: unknown
  imageAlias?: string | null
  sshKeyId?: number | null
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface ExchangeOrder {
  id: number
  orderNo: string
  listingId: number
  instanceId: number
  status: ExchangeOrderStatus
  price: number
  feeAmount: number
  sellerReceivesAmount: number
  escrowAmount: number
  createdAt: string
  paidAt?: string | null
  deliveredAt?: string | null
  confirmedAt?: string | null
  confirmationDueAt?: string | null
  completedAt: string | null
  cancelledAt?: string | null
  failureReason?: string | null
  deliveryTask: ExchangeDeliveryTask | null
  instance: ExchangeInstanceSnapshot
  snapshot?: ExchangeInstanceSnapshot
  deliveryMode: 'reinstall_required'
  privacyMode: 'anonymous'
}

export interface ExchangeWallet {
  id: number
  availableAmount: number
  frozenAmount: number
  createdAt: string
  updatedAt: string
}

export interface ExchangeWalletLog {
  id: number
  type: string
  amount: number
  availableBefore: number
  availableAfter: number
  frozenBefore: number
  frozenAfter: number
  orderId: number | null
  withdrawalId: number | null
  balanceLogId: number | null
  remark: string | null
  createdAt: string
}

export interface ExchangeWithdrawal {
  id: number
  withdrawalNo: string
  amount: number
  status: ExchangeWithdrawalStatus
  method: string | null
  applicantRemark: string | null
  reviewRemark?: string | null
  rejectReason: string | null
  proofUrl?: string | null
  createdAt: string
  updatedAt?: string
  reviewedAt: string | null
  completedAt: string | null
}

export interface ExchangeDispute {
  id: number
  orderId: number
  orderNo: string
  orderStatus: ExchangeOrderStatus
  orderPrice: number
  status: ExchangeDisputeStatus
  reason: string
  detail: string | null
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
}

export type FlashSaleCampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'ended' | 'cancelled'
export type FlashSaleReservationStatus = 'paid' | 'delivering' | 'delivered' | 'failed' | 'refunded' | 'cancelled'

export interface FlashSalePlanSummary {
  id: number
  name: string
  description: string | null
  cpu: number
  memory: number
  disk: number
  trafficLimit: string
  trafficLimitSpeed: string
  price: number
  billingCycle: number
  isActive: boolean
  isSoldOut: boolean
  package: {
    id: number
    name: string
    networkMode: string
    instanceType: string
    sourceType: 'official' | 'market'
    monthlyTrafficLimit: string | null
    hostCount: number
  }
}

export interface FlashSaleItem {
  id: number
  campaignId: number
  packagePlanId: number
  flashPrice: number
  originalPriceSnapshot: number
  totalStock: number
  soldCount: number
  reservedCount: number
  deliveredCount: number
  failedCount: number
  remainingStock: number
  perUserLimit: number
  allowCoupon: boolean
  allowAff: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  plan: FlashSalePlanSummary
}

export interface FlashSaleCampaign {
  id: number
  name: string
  description: string | null
  status: FlashSaleCampaignStatus
  effectiveStatus: FlashSaleCampaignStatus
  startAt: string
  endAt: string
  requireTurnstile: boolean
  minAccountAgeHours: number
  requireEmail: boolean
  blockRiskRestricted: boolean
  maxPerUser: number
  notes: string | null
  createdByUserId: number
  createdAt: string
  updatedAt: string
  items: FlashSaleItem[]
}

export interface FlashSaleReservation {
  id: number
  campaignId: number
  campaignName?: string
  itemId: number
  userId?: number
  user?: { id: number; username: string; email?: string | null; avatarStyle?: string | null; avatarBadgeId?: string | null } | null
  packageName: string
  planName: string
  instanceId?: number | null
  instance?: { id: number; name: string; status: string } | null
  status: FlashSaleReservationStatus
  amount: number
  failureReason: string | null
  paidAt: string | null
  deliveredAt: string | null
  refundedAt: string | null
  createdAt: string
  updatedAt?: string
}

export interface UpdateInstanceRequest {
  name?: string
  cpu?: number
  memory?: number
  disk?: number
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number | null  // 0 = 不限制, null = 继承套餐
}

export interface InstanceStats {
  cpu: {
    usage: number
    usagePercent: number
  }
  memory: {
    usage: number
    usagePercent: number
    limit: number
  }
  disk: {
    usage: number
    usagePercent: number
    limit: number
  }
  network: {
    bytesReceived: number
    bytesSent: number
  }
}

export interface PortMapping {
  id: number
  instance_id?: number
  host_id?: number
  protocol: 'tcp' | 'udp'
  publicPort: number
  privatePort: number
  public_port?: number  // 兼容旧格式
  private_port?: number  // 兼容旧格式
  remark?: string | null
  device_name?: string
  created_at?: string
}

export interface CreatePortMappingRequest {
  protocol: 'tcp' | 'udp'
  privatePort: number
  remark?: string
  deviceName?: string
}

// ==================== IP 地址 ====================

export interface IpAddress {
  id: number
  address: string
  type: 'inet4' | 'inet6'
  isPrimary: boolean
  isCustom?: boolean
  device: string
  createdAt: string
}

export interface Ipv6Subnet {
  id: number
  cidr: string
  primaryIp: string
  device: string
  instanceId: number
  createdAt: string
}

// ==================== 快照/备份 ====================

export interface Snapshot {
  id: number
  instance_id: number
  incus_name: string
  name: string
  description: string | null
  stateful: number
  size: number
  created_at: string
}

export interface Backup {
  id: number
  instance_id: number
  incus_name: string
  name: string
  description: string | null
  size: number
  status: 'creating' | 'ready' | 'error' | 'deleted'
  created_at: string
  expires_at: string | null
}

export interface CreateSnapshotRequest {
  name: string
  description?: string
}

export interface CreateBackupRequest {
  name: string
  description?: string
}

export interface SnapshotPolicy {
  id: number
  instance_id: number
  enabled: number
  interval_minutes: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface BackupPolicy {
  id: number
  instance_id: number
  enabled: number
  interval_minutes: number
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface UpdateSnapshotPolicyRequest {
  enabled?: boolean
  intervalMinutes?: number  // 10, 60, 360, 1440
}

export interface UpdateBackupPolicyRequest {
  enabled?: boolean
  intervalMinutes?: number  // 60, 360, 1440, 4320
}

// ==================== 节点相关 ====================

export interface Host {
  id: number
  name: string
  url: string
  location: string | null
  country_code: string
  architecture?: 'x86_64' | 'aarch64'
  status: 'online' | 'offline' | 'maintenance'
  cert_path?: string | null  // Removed from API responses for security
  key_path?: string | null   // Removed from API responses for security
  nat_public_ip: string | null
  nat_port_start: number | null
  nat_port_end: number | null
  cpu_used: number
  memory_used: number
  disk_used: number
  cpu_allowance_max?: number
  memory_max?: number
  instance_type?: 'container' | 'vm' | 'both'
  notify_purchase?: boolean
  notify_renew?: boolean
  notify_destroy?: boolean
  created_at: string
  updated_at: string
}

export interface HostWithDetails extends Host {
  instanceCount?: number
  tags?: string[]
  certPath?: string  // Removed from API responses for security
  keyPath?: string   // Removed from API responses for security
  resources?: {
    cpuUsed: number
    memoryUsed: number
    diskUsed: number
  }
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  architecture?: 'x86_64' | 'aarch64'
  natConfig?: {
    publicIp: string | null
    publicIpv6?: string | null
    bindIp?: string | null
    bindIpv6?: string | null
    portRangeStart: number | null
    portRangeEnd: number | null
    portsUsedCount?: number
  }
  // 托管节点所有者信息（管理员查看托管节点时返回）
  owner?: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId?: string | null
  }
}

export interface HostAgentStatus {
  id: number
  hostId: number
  agentId: string
  enabled: boolean
  status: 'online' | 'offline' | string
  version: string | null
  latestVersion: string | null
  versionStatus: 'latest' | 'outdated' | 'unknown'
  capabilities: string[]
  lastReport: {
    incus?: {
      available?: boolean
      socket?: string
    }
    resources?: {
      cpuTotal?: number
      cpuUsagePercent?: number
      memoryTotalMb?: number
      memoryUsedMb?: number
      memoryAvailableMb?: number
      memoryUsagePercent?: number
      swapTotalMb?: number
      swapUsedMb?: number
      swapUsagePercent?: number
      diskMountpoint?: string
      diskTotalBytes?: number
      diskUsedBytes?: number
      diskAvailableBytes?: number
      diskUsagePercent?: number
      processCount?: number
    }
    metrics?: {
      reportedAt?: string
      heartbeatIntervalSeconds?: number
      uptimeSeconds?: number
      load1?: number
      load5?: number
      load15?: number
    }
    [key: string]: unknown
  }
  lastSeenAt: string | null
  lastHeartbeatIp: string | null
  createdAt: string
  updatedAt: string
}

export interface HostAgentStatusResponse {
  host: {
    id: number
    name: string
  }
  agent: HostAgentStatus | null
}

export interface HostAgentUpgradeRequestResponse {
  requested: boolean
  currentVersion: string | null
  latestVersion: string | null
  versionStatus: 'latest' | 'outdated' | 'unknown'
  nextHeartbeatSeconds: number
  message: string
}

export interface HostAgentInstallCommandResponse {
  host: {
    id: number
    name: string
  }
  agent: HostAgentStatus
  installToken: string
  installTokenExpiresAt: string
  installScriptUrl: string
  installCommand: string
  warning: string
}

export interface CreateHostRequest {
  name: string
  url: string
  location?: string
  countryCode?: string
  tags?: string[]
  certPath?: string
  keyPath?: string
  natConfig?: {
    publicIp?: string
    publicIpv6?: string
    bindIp?: string
    bindIpv6?: string
    portRangeStart?: number
    portRangeEnd?: number
  }
  ipAddress?: string
  // 存储配置
  storageDriver?: 'zfs' | 'lvm'
  storageType?: 'loop' | 'disk'
  storagePath?: string
  storageSize?: number
  // 网络配置
  ipv6Mode?: number
  ipv6Subnet?: string
  ipv6Gateway?: string
  ipv6ParentInterface?: string
}

export interface UpdateHostRequest {
  name?: string
  url?: string
  location?: string
  countryCode?: string
  status?: 'online' | 'offline' | 'maintenance'
  certPath?: string
  keyPath?: string
  cpuAllowanceMax?: number
  memoryMax?: number
  instanceType?: 'container' | 'vm' | 'both'
  ipv6ParentInterface?: string
  ipv6Subnet?: string
  transferEnabled?: boolean
  trafficResetDay?: number  // 流量重置日（1-28）
  notifyPurchase?: boolean
  notifyRenew?: boolean
  notifyDestroy?: boolean
  enableResourcePool?: boolean  // 是否参与资源池玩法
  announcement?: string | null  // 节点公告
  probeUrl?: string | null  // 探针地址
  natConfig?: {
    publicIp?: string
    publicIpv6?: string
    bindIp?: string
    bindIpv6?: string
    portRangeStart?: number | null
    portRangeEnd?: number | null
  }
}

export interface AvailableHost {
  id: number
  name: string
  location: string | null
  countryCode: string
  architecture?: 'x86_64' | 'aarch64'
  probeUrl?: string | null
  trafficMultiplier?: number
  effectiveTrafficLimit?: string | null
  resources: {
    cpuUsed: number
    cpuAllowanceMax: number
    cpuEffectiveMax: number
    cpuAvailable: number
    memoryUsed: number
    memoryMax: number
    memoryAvailable: number
    diskAvailable: number
  }
}

export type ChangeHostUnavailableReason =
  | 'current_host'
  | 'host_offline'
  | 'host_type_mismatch'
  | 'cpu_full'
  | 'memory_full'
  | 'resource_unconfigured'
  | 'image_unavailable'

export interface ChangeHostOption {
  id: number
  name: string
  location: string | null
  countryCode: string
  architecture: string
  status: string
  probeUrl?: string | null
  trafficMultiplier?: number
  effectiveTrafficLimit?: string | null
  isCurrent: boolean
  canChange: boolean
  unavailableReason: ChangeHostUnavailableReason | null
  resources: {
    cpuUsed: number
    cpuAllowanceMax: number
    cpuAvailable: number
    memoryUsed: number
    memoryMax: number
    memoryAvailable: number
  }
}

export interface ChangeHostOptionsResponse {
  packageId: number | null
  packageName: string | null
  currentHostId: number
  required: {
    cpu: number
    memory: number
  }
  hosts: ChangeHostOption[]
  sshKeys: Array<{
    id: number
    name: string
    fingerprint?: string | null
  }>
  canChangeHost: boolean
  unavailableReason?: 'no_package' | 'single_host' | 'no_ssh_key'
}

// ==================== 套餐相关 ====================

export interface Package {
  id: number
  name: string
  description: string | null
  cpu_max: number
  memory_max: number
  disk_max: number
  bandwidth_max: number | null
  network_mode: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'  // camelCase 别名
  instance_type?: 'container' | 'vm'  // 实例类型
  host_ids: number[]  // 绑定的宿主机ID列表
  host_storage_pools?: Record<string, string | null>
  host_traffic_multipliers?: Record<string, number>
  privileged: number
  nested: number
  active: number
  instance_count?: number
  port_limit?: number | null
  snapshot_limit?: number | null
  backup_limit?: number | null
  site_limit?: number | null
  node_selectors?: string | null
  monthly_traffic_limit?: string | null  // BigInt as string (Bytes)
  traffic_reset_price?: number | null  // 分
  // 存储 I/O 限制
  io_limit_mode?: 'throughput' | 'iops'
  limits_read?: string
  limits_write?: string
  limits_read_iops?: number
  limits_write_iops?: number
  // 网络限制
  limits_ingress?: string
  limits_egress?: string
  // 进程与调度
  limits_processes?: number
  limits_cpu_priority?: number
  // 启动配置
  boot_autostart?: boolean
  boot_autostart_priority?: number
  boot_autostart_delay?: number
  boot_host_shutdown_timeout?: number
  created_at: string
  // 套餐所有权标识（用于区分自己的套餐和共享的套餐）
  isOwn?: boolean  // true = 用户自己拥有的套餐，false = 共享给自己的套餐
  isShared?: boolean  // true = 共享给自己的套餐
  isGlobalShared?: boolean  // true = 全局共享的套餐
  ownerId?: number  // 套餐所有者ID
  ownerUsername?: string  // 套餐所有者用户名
  sourceType?: 'official' | 'market' | 'zone' | 'friends' | 'own'  // 套餐来源类型
  hostingZoneId?: number
  hostingZoneName?: string
  hostingZoneLogoUrl?: string
  soldOut?: boolean  // 是否售罄（所有宿主机都无法满足最低配置）
  // 全局共享配置（仅当 isGlobalShared = true 或套餐所有者查看时）
  global_shared?: boolean
  global_quota_multiplier?: null  // 公开套餐不再使用资源配额倍数限制
  global_max_instances?: number | null  // 公开套餐最大实例数，开启公开时必须为 1-5
  required_package_id?: number | null
  required_package_name?: string | null
  has_required_package_instance?: boolean
  // 实例操作权限
  allow_instance_deletion?: boolean  // 是否允许用户删除实例
  sharedAt?: string  // 共享时间（共享套餐）
  // 剩余配额信息
  quotaInfo?: {
    maxInstances: number | null
    remainingInstances: number | null
    maxCpu: number | null
    remainingCpu: number | null
    maxMemory: number | null
    remainingMemory: number | null
    ownerUsername: string | null
  }
  // 托管套餐所有者信息（管理员查看托管套餐时返回）
  owner?: {
    id: number
    username: string
    email: string | null
    avatarStyle: string
    avatarBadgeId?: string | null
  }
}

export interface CreatePackageRequest {
  name: string
  description?: string
  cpuMax: number
  memoryMax: number
  diskMax: number
  bandwidthMax?: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds: number[]  // 必须至少绑定一个宿主机
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  nodeSelectors?: string[]
  monthlyTrafficLimit?: string  // BigInt as string (Bytes)
  trafficResetPrice?: number    // 分
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调度
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: null  // 公开套餐不再使用资源配额倍数限制
  globalMaxInstances?: number | null  // 公开套餐最大实例数，开启公开时必须为 1-5
  requiredPackageId?: number | null
  // 实例操作权限
  allowInstanceDeletion?: boolean  // 是否允许用户删除实例
}

export interface UpdatePackageRequest {
  name?: string
  description?: string
  cpuMax?: number
  memoryMax?: number
  diskMax?: number
  bandwidthMax?: number
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat' | 'public_ipv4' | 'public_ipv4_ipv6'
  instanceType?: 'container' | 'vm'  // 实例类型
  hostIds?: number[]  // 如果提供，将更新绑定的宿主机（必须至少一个）
  hostStoragePools?: Record<string, string | null>
  hostTrafficMultipliers?: Record<string, number>
  privileged?: boolean
  nested?: boolean
  active?: boolean
  portLimit?: number
  snapshotLimit?: number
  backupLimit?: number
  siteLimit?: number
  nodeSelectors?: string[]
  monthlyTrafficLimit?: string | null  // BigInt as string (Bytes), null to clear
  trafficResetPrice?: number    // 分
  // 存储 I/O 限制
  ioLimitMode?: 'throughput' | 'iops'
  limitsRead?: string
  limitsWrite?: string
  limitsReadIops?: number
  limitsWriteIops?: number
  // 网络限制
  limitsIngress?: string
  limitsEgress?: string
  // 进程与调度
  limitsProcesses?: number
  limitsCpuPriority?: number
  // 启动配置
  bootAutostart?: boolean
  bootAutostartPriority?: number
  bootAutostartDelay?: number
  bootHostShutdownTimeout?: number
  // 全局共享配置
  globalShared?: boolean
  globalQuotaMultiplier?: null  // 公开套餐不再使用资源配额倍数限制
  globalMaxInstances?: number | null  // 公开套餐最大实例数，开启公开时必须为 1-5
  requiredPackageId?: number | null
  // 实例操作权限
  allowInstanceDeletion?: boolean  // 是否允许用户删除实例
}

// 实例配置类型
export interface InstanceConfig {
  limits_read: string
  limits_write: string
  limits_read_iops: number
  limits_write_iops: number
  limits_ingress: string
  limits_egress: string
  limits_processes: number
  limits_cpu_priority: number
  boot_autostart: boolean
  boot_autostart_priority: number
  boot_autostart_delay: number
  boot_host_shutdown_timeout: number
}

export interface InstanceSwapConfig {
  available: boolean
  enabled: boolean
  sizeMb: number
  kind: 'container' | 'vm'
  requiresRunning: boolean
}

export interface InstanceConfigResponse {
  config: InstanceConfig
  overrides: Record<keyof InstanceConfig, boolean>
  packageDefaults: InstanceConfig
  ioLimitMode: 'throughput' | 'iops'
  swap: InstanceSwapConfig
}

export interface UpdateInstanceConfigRequest {
  limitsRead?: string | null
  limitsWrite?: string | null
  limitsReadIops?: number | null
  limitsWriteIops?: number | null
  limitsIngress?: string | null
  limitsEgress?: string | null
  limitsProcesses?: number | null
  limitsCpuPriority?: number | null
  bootAutostart?: boolean | null
  bootAutostartPriority?: number | null
  bootAutostartDelay?: number | null
  bootHostShutdownTimeout?: number | null
}

// ==================== SSH Keys ====================

export interface SshKey {
  id: number
  user_id?: number
  name: string
  fingerprint: string
  publicKeyPreview?: string  // 截断的公钥预览
  created_at?: string
  createdAt?: string
}

export interface CreateSshKeyRequest {
  name: string
  publicKey: string
}

// ==================== 通知相关 ====================

export interface NotificationChannel {
  id: number
  user_id: number
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  name: string
  config: string | Record<string, unknown>
  enabled: boolean | number
  created_at: string
}

export interface CreateNotificationChannelRequest {
  type: 'telegram' | 'discord' | 'email' | 'webhook'
  name: string
  config: Record<string, unknown>
}

export interface UpdateNotificationChannelRequest {
  name?: string
  config?: Record<string, unknown>
  enabled?: boolean
}

export type CloudInitState =
  | 'manual'
  | 'done'
  | 'done_with_errors'
  | 'running'
  | 'disabled'
  | 'unsupported'
  | 'agent_unavailable'
  | 'unknown'

export interface CloudInitStatusResponse {
  ready: boolean
  state: CloudInitState
  source: 'manual' | 'status_json' | 'boot_finished' | 'image' | 'unknown'
  manualOverride: boolean
  message: string
  detectedAt: string
}

export interface TerminalSavedCommand {
  id: number
  userId: number
  name: string
  command: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTerminalSavedCommandRequest {
  name: string
  command: string
  description?: string | null
}

export interface UpdateTerminalSavedCommandRequest {
  name?: string
  command?: string
  description?: string | null
}

// ==================== 实例任务相关 ====================

export type InstanceTaskType = 'start' | 'stop' | 'restart' | 'rebuild' | 'recreate' | 'clone' | 'change_host'
export type InstanceTaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface InstanceTask {
  id: number
  instanceId?: number
  instanceName?: string | null
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress?: string | null
  error?: string | null
  queuePosition: number
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  newInstanceId?: number | null  // 用于 clone 操作
}

export interface InstanceTaskResponse {
  message: string
  taskId: number
  status: InstanceTaskStatus
}

export type DeliveryAssuranceCaseStatus = 'pending_manual' | 'auto_retryable' | 'in_progress' | 'recovered' | 'closed'
export type DeliveryAssuranceIssueType = 'task_failed' | 'task_stale' | 'host_offline' | 'agent_offline' | 'resource_pressure' | 'plan_upgrade_sync_failed'

export interface DeliveryAssuranceCase {
  id: number
  taskId: number | null
  instanceId: number
  hostId: number
  userId: number
  status: DeliveryAssuranceCaseStatus
  issueType: DeliveryAssuranceIssueType
  severity: string
  retryable: boolean
  retryTaskId: number | null
  title: string
  lastError: string | null
  detail: Record<string, unknown> | null
  note: string | null
  handledByUserId: number | null
  handledByUsername: string | null
  handledAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface DeliveryTaskContext {
  id: number
  instanceId: number
  hostId: number
  userId: number
  taskType: InstanceTaskType
  status: InstanceTaskStatus
  progress?: string | null
  error?: string | null
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  newInstanceId?: number | null
  instance: {
    id: number
    name: string
    status: string
    incusId: string
    image: string
  } | null
  user: {
    id: number
    username: string
    email: string | null
    status: string
  } | null
  host: {
    id: number
    name: string
    status: string
    location: string | null
    countryCode: string
    cpuUsed?: number
    cpuAllowanceMax?: number
    memoryUsed?: number
    memoryMax?: number
    diskUsed?: number
    natPortsUsedCount?: number
    agent?: {
      status: string
      version: string | null
      lastSeenAt: string | null
    } | null
  } | null
  assuranceCase: DeliveryAssuranceCase | null
  billing: {
    id: number
    type: string
    amount: number
    createdAt: string
    balanceLogId: number | null
  } | null
}

export interface DeliveryCaseContext {
  id: number
  instanceId: number
  hostId: number
  userId: number
  instance: {
    id: number
    name: string
    status: string
    incusId: string
    image: string
    cpu: number
    memory: number
    disk: number
    limitsIngress: string | null
    limitsEgress: string | null
  } | null
  user: {
    id: number
    username: string
    email: string | null
    status: string
  } | null
  host: {
    id: number
    name: string
    status: string
    location: string | null
    countryCode: string
  } | null
  assuranceCase: DeliveryAssuranceCase
  billing: {
    id: number
    type: string
    amount: number
    createdAt: string
    balanceLogId: number | null
  } | null
}

export interface DeliveryOverview {
  summary: {
    pending: number
    processing: number
    completed: number
    failed: number
    completedLast24h: number
    failedLast24h: number
    staleProcessing: number
    notificationSentLast24h: number
    notificationFailedLast24h: number
    notificationPendingLast24h: number
    enabledUserChannels: number
    enabledGlobalChannels: number
    casesPendingManual: number
    casesAutoRetryable: number
    casesInProgress: number
    casesRecovered: number
    casesClosed: number
  }
  recentFailures: DeliveryTaskContext[]
}

export interface DeliveryTasksResponse {
  tasks: DeliveryTaskContext[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface DeliveryCasesResponse {
  cases: DeliveryCaseContext[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== SLA 告警相关 ====================

export type SlaAlertSeverity = 'info' | 'warning' | 'critical'
export type SlaAlertStatus = 'open' | 'investigating' | 'recovered' | 'ignored'
export type SlaAlertObjectType =
  | 'host'
  | 'agent'
  | 'instance'
  | 'order'
  | 'task'
  | 'notification_channel'
  | 'system_update'
  | 'smtp'
  | 'telegram'
  | 'disk'
  | 'system'

export interface SlaAlertAction {
  id: number
  actionType: string
  actorUserId: number | null
  actorUsername: string | null
  note: string | null
  detail: Record<string, unknown> | null
  createdAt: string | null
}

export interface SlaAlertEvent {
  id: number
  ruleCode: string
  module: string
  severity: SlaAlertSeverity
  status: SlaAlertStatus
  objectType: SlaAlertObjectType
  objectId: number | null
  objectLabel: string | null
  fingerprint: string
  title: string
  message: string
  detail: Record<string, unknown> | null
  triggerCount: number
  firstTriggeredAt: string | null
  lastTriggeredAt: string | null
  recoveredAt: string | null
  silencedUntil: string | null
  handledByUserId: number | null
  handledByUsername: string | null
  handledAt: string | null
  note: string | null
  createdAt: string | null
  updatedAt: string | null
  actions: SlaAlertAction[]
}

export interface SlaAlertRule {
  id: number
  code: string
  module: string
  title: string
  description: string | null
  severity: SlaAlertSeverity
  enabled: boolean
  thresholdMinutes: number | null
  thresholdCount: number | null
  dedupeMinutes: number
  notificationChannels: unknown[]
  silenceUntil: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface SlaAlertOverview {
  summary: {
    open: number
    investigating: number
    recovered: number
    ignored: number
    critical: number
    warning: number
    info: number
    openCritical: number
    rulesEnabled: number
    lastScanAt: string | null
  }
  recentAlerts: SlaAlertEvent[]
}

export interface SlaAlertListResponse {
  alerts: SlaAlertEvent[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface SlaAlertScanResponse {
  scanned: number
  created: number
  merged: number
  skipped: number
}

// ==================== 站内信相关 ====================

export interface InboxMessage {
  id: number
  userId: number
  eventType: string
  title: string
  content: string
  isRead: boolean
  data: Record<string, unknown> | null
  createdAt: string
}

export interface PaginatedInboxMessages {
  messages: InboxMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== OAuth 相关 ====================

export interface OAuthConfig {
  id: number
  provider: 'github' | 'google'
  client_id: string
  client_secret: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface UserOAuthBinding {
  id: number
  user_id: number
  provider: 'github' | 'google'
  provider_user_id: string
  provider_username: string | null
  provider_email: string | null
  provider_avatar: string | null
  created_at: string
  updated_at: string
}

export interface UpdateOAuthConfigRequest {
  clientId?: string
  clientSecret?: string
  enabled?: boolean
}

export interface OAuthClientApp {
  id: number
  name: string
  clientId: string
  redirectUris: string[]
  scopes: PublicApiScope[]
  enabled: boolean
  createdByUserId: number
  createdByUsername: string | null
  createdAt: string
  updatedAt: string
}

export interface UpsertOAuthClientAppRequest {
  name: string
  redirectUris: string[]
  scopes: PublicApiScope[]
  enabled: boolean
}

export interface OAuthProviderConsentResponse {
  app: {
    id: number
    name: string
    clientId: string
  }
  requestedScopes: PublicApiScope[]
  scopeMetadata: PublicApiScopeMetadata[]
  existingScopes: PublicApiScope[]
  consentRequired: boolean
  request: {
    responseType: string
    clientId: string
    redirectUri: string
    scope: string
    state: string | null
  }
}

export interface OAuthProviderAuthorizeRequest {
  responseType: 'code'
  clientId: string
  redirectUri: string
  scope: string
  state?: string | null
  confirmed?: boolean
}

export interface OAuthProviderAuthorizeResponse {
  redirectTo: string
  expiresIn?: number
}

export type GiftCardStatus = 'active' | 'used' | 'disabled' | 'expired'

export interface GiftCardRecord {
  id: number
  code: string
  codeMasked?: string
  faceValue: number
  balanceValue: number
  status: GiftCardStatus
  expiresAt?: string | null
  usedAt?: string | null
  createdAt: string
  remark?: string | null
  batchId?: string | null
  createdBy?: { id: number; username: string } | null
  owner?: { id: number; username: string } | null
  usedBy?: { id: number; username: string } | null
}

export interface GiftCardListResponse {
  records: GiftCardRecord[]
  total: number
  page: number
  pageSize: number
}

export interface GiftCardStats {
  total: number
  active: number
  used: number
  disabled: number
  expired: number
  outstandingValue: number
  totalRedeemedValue: number
}

export interface CreateGiftCardRequest {
  faceValue: number
  balanceValue?: number
  expiresAt?: string | null
  remark?: string
  turnstileToken?: string
}

export interface CreateGiftCardBatchRequest extends CreateGiftCardRequest {
  count: number
}

export interface OAuthProviderAuthorization {
  id: number
  app: {
    id: number
    name: string
    clientId: string
    enabled: boolean
  }
  scopes: PublicApiScope[]
  active: boolean
  lastAuthorizedAt: string
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminOAuthAuthorization extends OAuthProviderAuthorization {
  user: {
    id: number
    username: string
    email: string | null
    role: string
    status: string
  }
  tokenStats: {
    activeAccessTokens: number
    activeRefreshTokens: number
  }
}

// ==================== 帮助文档 ====================

export interface HelpArticle {
  id: number
  title: string
  slug: string
  content: string
  category: string
  sort_order: number
  published: number
  pinned?: number  // 是否置顶（0 = 否，1 = 是）
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface CreateHelpArticleRequest {
  title: string
  slug: string
  content: string
  category: string
  sortOrder?: number
  published?: boolean
  pinned?: boolean
}

export interface UpdateHelpArticleRequest {
  title?: string
  slug?: string
  content?: string
  category?: string
  sortOrder?: number
  published?: boolean
  pinned?: boolean
}

// ==================== 镜像相关 ====================

export interface SystemImage {
  id: number
  name: string
  osType: string
  remoteAlias: string
  architecture: 'x86_64' | 'aarch64'
  instanceType?: 'container' | 'vm' | 'both'
  icon: string
  sortOrder?: number
  hidden?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CreateSystemImageRequest {
  name: string
  remoteAlias: string
  osType?: string
  architecture?: 'x86_64' | 'aarch64'
  instanceType?: 'container' | 'vm' | 'both'
  icon: string
  sortOrder?: number
  hidden?: boolean
}

export interface UpdateSystemImageRequest {
  name?: string
  remoteAlias?: string
  osType?: string
  architecture?: 'x86_64' | 'aarch64'
  instanceType?: 'container' | 'vm' | 'both'
  icon?: string
  sortOrder?: number
  hidden?: boolean
}

export interface HostImagePolicy {
  success: boolean
  host: {
    id: number
    name: string
    architecture: 'x86_64' | 'aarch64'
    instanceType: 'container' | 'vm' | 'both'
  }
  useDefault: boolean
  allowedImageIds: number[]
  images: SystemImage[]
}

// ==================== 日志 ====================

export interface Log {
  id: number
  user_id: number | null
  instance_id?: number | null
  username?: string | null
  module: string
  action: string
  content: string
  result: string
  created_at: string
  risk_level?: 'low' | 'medium' | 'high' | 'critical'
  risk_title?: string
  approval_required?: boolean
  verification_required?: boolean
  batch_sensitive?: boolean
}

// ==================== 工单相关 ====================

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketCategory = 'general' | 'billing' | 'technical' | 'abuse'
export type TicketSlaStatus = 'waiting_first_response' | 'waiting_user' | 'waiting_internal' | 'due_soon' | 'overdue' | 'met' | 'closed'
export type TicketObjectLinkType = 'recharge_record' | 'order_operation_case' | 'instance' | 'host' | 'delivery_case' | 'sla_alert' | 'plugin_task'

export interface Ticket {
  id: number
  userId: number
  hostId: number | null  // 可为 null，表示直接发给管理员的工单
  instanceId: number | null
  subject: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  closedAt: string | null
  firstResponseDueAt?: string | null
  resolutionDueAt?: string | null
  firstRespondedAt?: string | null
  slaBreachedAt?: string | null
  slaStatus?: TicketSlaStatus
  user?: {
    id: number
    username: string
    avatarStyle?: string
    avatarBadgeId?: string | null
  }
  host?: {
    id: number
    name: string
    userId: number
  }
  instance?: {
    id: number
    name: string
    status?: string
    iconBadgeId?: string | null
    incusId?: string | null
    ipv4?: string | null
    ipv6?: string | null
    cpu?: number
    memory?: number
    disk?: number
    image?: string
    packageName?: string | null
  } | null
  messageCount?: number
  lastMessage?: {
    content: string
    isFromOwner: boolean
    createdAt: string
  } | null
  // 是否需要回复：
  // - 用户视角：宿主机主人回复了，需要用户回复
  // - 宿主机视角：用户回复了，需要宿主机主人回复
  needsReply?: boolean
}

export interface TicketMessage {
  id: number
  ticketId: number
  senderId: number
  content: string
  isFromOwner: boolean
  createdAt: string
  attachments: TicketMessageAttachment[]
  sender?: {
    id: number
    username: string
    avatarStyle?: string
    avatarBadgeId?: string | null
  }
}

export interface TicketMessageAttachment {
  id: number
  ticketId: number
  messageId: number
  uploaderId: number
  provider: string
  providerVersion: string
  providerFileId: string | null
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
}

export interface TicketInternalNote {
  id: number
  ticketId: number
  actorUserId: number
  actorUsername: string
  content: string
  createdAt: string
}

export interface TicketObjectLink {
  id: number
  ticketId: number
  objectType: TicketObjectLinkType
  objectId: number
  objectLabel: string | null
  createdByUserId: number
  createdByUsername: string
  createdAt: string
}

export interface TicketSupportTimelineItem {
  type: 'message' | 'internal_note' | 'object_link'
  id: number
  title: string
  actor: string
  content: string
  createdAt: string
}

export interface TicketSupportContext {
  ticket: Ticket
  userContext: {
    id: number
    username: string
    emailMasked: string | null
    role: 'admin' | 'user'
    status: 'active' | 'banned'
    balance: string | null
    createdAt: string
    updatedAt: string
    counts: {
      instances: number
      ticketsCreated: number
      rechargeRecords: number
      balanceLogs: number
    }
  } | null
  recentOrders: Array<Record<string, unknown>>
  recentOrderCases: Array<Record<string, unknown>>
  recentInstances: Array<Record<string, unknown>>
  recentDeliveryCases: Array<Record<string, unknown>>
  recentAlerts: Array<Record<string, unknown>>
  links: TicketObjectLink[]
  internalNotes: TicketInternalNote[]
  timeline: TicketSupportTimelineItem[]
  knowledgeSuggestions: Array<{ title: string; steps: string[] }>
  quickActions: {
    notifyUser: boolean
    balanceAdjustmentPath: string
    deliveryCenterPath: string
    userPath: string
    instancePath: string | null
    hostPath: string | null
  }
}

export interface TicketAiDraftResponse {
  draft: string
  model: string
  safety: {
    passed: boolean
    blockedReasons: string[]
  }
}

export interface TicketAiReplyResponse {
  message: string
  data: TicketMessage
  model: string
  confidence: number
  confidenceThreshold: number
  safety: {
    passed: boolean
    blockedReasons: string[]
  }
  sendBlockedReasons?: string[]
}

export interface TicketAiStatusResponse {
  pluginId: string
  permissions: {
    readContext: boolean
    generateDraft: boolean
    reply: boolean
  }
  config: {
    enabled: boolean
    mode: 'draft' | 'semi_auto' | 'auto'
    modelConfigured: boolean
    autoReplyCategories: string[]
    confidenceThreshold: number
    dailyAutoReplyLimit: number
    ticketAutoReplyLimit: number
    cooldownSeconds: number
    showAiIdentity: boolean
  }
  automation: {
    autoReplyActive: boolean
    scanIntervalSeconds: number
    scope: string
    requiresLatestCustomerMessage: boolean
    safeguards: string[]
  }
}

export interface CreateTicketRequest {
  instanceId?: number | null  // 可选：不选实例时工单直接发给管理员
  subject: string
  category?: TicketCategory
  priority?: TicketPriority
  content: string
  attachments?: File[]
}

export interface PaginatedTickets {
  tickets: Ticket[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PaginatedTicketMessages {
  messages: TicketMessage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== 计费相关 ====================

// 套餐方案
export interface PackagePlan {
  id: number
  packageId: number
  name: string
  description: string | null
  price: number
  trafficResetPrice?: number | null
  billingCycle: number // 账期（月）
  setupFee?: number    // 开通费（分）
  cpu: number
  memory: number
  disk: number
  portLimit: number
  snapshotLimit: number
  backupLimit: number
  siteLimit: number
  monthlyTrafficLimit: string | null
  isActive: boolean
  isSoldOut: boolean
  sortOrder: number
  slaGuarantee: number | null // SLA保证百分比，1-100
  createdAt: string
  package?: {
    id: number
    name: string
  }
}

// 计费信息
export interface InstanceBillingInfo {
  instanceId: number
  instanceName: string
  planId: number | null
  planName: string | null
  price: number | null
  billingCycle: number | null
  expiresAt: string | null
  autoRenew: boolean
  renewPreview: RenewPreview[] | null
  affDiscount: AffDiscount | null
  // 托管实例相关信息
  isHostedInstance: boolean
  daysUntilExpire: number | null
  hostingRenewRestriction: { monthsOnly: number; daysBeforeExpire: number } | null
}

export interface RenewPreview {
  months: number
  price: number           // 原价（元）
  discountedPrice: number // 折扣价（元）
  expiresAt: string
}

export interface AffDiscount {
  discountRate: number     // 折扣率，如 0.05
  discountPercent: number  // 百分比，如 5 表示 5%
}

// 升降级预览
export interface ChangePlanPreview {
  oldPlan: {
    id: number
    name: string
    price: number
    billingCycle: number
  }
  newPlan: {
    id: number
    name: string
    price: number
    billingCycle: number
    isActive: boolean
    isSoldOut: boolean
  }
  remainingDays: number
  // 计算详情
  oldDailyPrice: number        // 原方案日价（元）
  newDailyPrice: number        // 新方案日价（元）
  remainingValue: number       // 剩余价值（元）
  newPlanCost: number          // 新方案费用（元）
  // 折扣信息
  discountRate: number         // 折扣率（0-1）
  discountAmount: number       // 折扣金额（元）
  // 最终费用
  priceDiff: number            // 差价（元，正数=补交，负数=退款）
  isUpgrade: boolean
  newExpiresAt: string
  newConfig: {
    cpu: number
    memory: number
    disk: number
  }
  resourceWarnings: string[] | null
  resourceCapacity?: {
    canUpgrade: boolean
    reason: string | null
    message: string | null
    hostId: number
    deltas: { cpu: number; memory: number; disk: number }
    currentUsage: { cpu: number; memory: number; disk: number }
    projectedUsage: { cpu: number; memory: number; disk: number }
    limits: { cpu: number | null; memory: number | null; disk: number | null }
    available: { cpu: number | null; memory: number | null; disk: number | null }
  }
  // 可变更状态
  canChange: boolean
  cannotChangeReason?: string
}

// 计费记录
export interface InstanceBillingRecord {
  id: number
  type: 'purchase' | 'renewal' | 'upgrade' | 'downgrade' | 'admin_extension'
  amount: number
  months: number | null
  periodStart: string
  periodEnd: string
  remark: string | null
  createdAt: string
}

// 支付渠道
export interface PaymentProvider {
  id: number
  name: string
  type: string
  methods: string[]
  methodFees?: Record<string, { feeRate: number; feeFixed?: number }>
  minAmount: number
  maxAmount: number | null
  feeRate: number
  feeFixed: number
}

// 充值订单
export interface RechargeOrder {
  id?: number
  orderNo: string
  amount: number
  payableAmount?: number
  actualAmount: number | null
  fee: number
  status: 'pending' | 'paid' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'refunded'
  provider?: {
    id: number
    name: string
    type: string
  }
  paymentMethod?: string | null
  actualPaymentMethod?: string | null
  paymentCurrency?: string | null
  paymentNetwork?: string | null
  paymentUuid?: string | null
  paymentTxid?: string | null
  invoiceCurrency?: string | null
  gatewayStatus?: string | null
  gatewayStatusDescription?: string | null
  tradeNo?: string | null
  failReason?: string | null
  createdAt: string
  expiredAt?: string | null
  completedAt?: string | null
}

// 用户余额信息
export interface UserBalance {
  balance: number
  frozen: number
  totalRecharge: number
  totalConsume: number
}

// 余额变动记录
export interface BalanceLog {
  id: number
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  remark: string | null
  createdAt: string
}

// ==================== 通用响应 ====================

export interface ApiResponse<T = unknown> {
  success?: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
