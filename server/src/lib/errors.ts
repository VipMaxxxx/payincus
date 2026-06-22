/**
 * Standardized API error codes and messages
 * Frontend will translate these based on error codes
 */

export const ErrorCode = {
    // Common errors
    INVALID_ID: 'INVALID_ID',
    NOT_FOUND: 'NOT_FOUND',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    ADMIN_REQUIRED: 'ADMIN_REQUIRED',
    FEATURE_DISABLED: 'FEATURE_DISABLED',

    // User errors
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USER_EXISTS: 'USER_EXISTS',
    CANNOT_MODIFY_SELF: 'CANNOT_MODIFY_SELF',
    CANNOT_DELETE_SELF: 'CANNOT_DELETE_SELF',
    CANNOT_BAN_ADMIN: 'CANNOT_BAN_ADMIN',
    CANNOT_DELETE_ADMIN: 'CANNOT_DELETE_ADMIN',
    USER_HAS_INSTANCES: 'USER_HAS_INSTANCES',
    USER_HAS_RESOURCES: 'USER_HAS_RESOURCES',

    // Auth errors
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    ACCOUNT_BANNED: 'ACCOUNT_BANNED',
    TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
    REGISTRATION_DISABLED: 'REGISTRATION_DISABLED',
    INVALID_INVITE_CODE: 'INVALID_INVITE_CODE',
    INVITE_CODE_EXPIRED: 'INVITE_CODE_EXPIRED',
    INVALID_2FA_CODE: 'INVALID_2FA_CODE',
    TWO_FA_REQUIRED: 'TWO_FA_REQUIRED',
    TWO_FA_ALREADY_ENABLED: 'TWO_FA_ALREADY_ENABLED',
    TWO_FA_NOT_ENABLED: 'TWO_FA_NOT_ENABLED',
    REFRESH_TOKEN_MISSING: 'REFRESH_TOKEN_MISSING',
    REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
    SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',

    // Validation errors
    INVALID_EMAIL: 'INVALID_EMAIL',
    EMAIL_CONTAINS_ILLEGAL: 'EMAIL_CONTAINS_ILLEGAL',
    USERNAME_CONTAINS_ILLEGAL: 'USERNAME_CONTAINS_ILLEGAL',
    PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
    INVALID_SSH_KEY: 'INVALID_SSH_KEY',
    SSH_KEY_EXISTS: 'SSH_KEY_EXISTS',
    INVALID_NAME: 'INVALID_NAME',

    // Instance errors
    INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
    INSTANCE_ALREADY_RUNNING: 'INSTANCE_ALREADY_RUNNING',
    INSTANCE_ALREADY_STOPPED: 'INSTANCE_ALREADY_STOPPED',
    INSTANCE_STATUS_INVALID: 'INSTANCE_STATUS_INVALID',
    INSTANCE_SUSPENDED: 'INSTANCE_SUSPENDED',
    INSTANCE_NOT_SUSPENDED: 'INSTANCE_NOT_SUSPENDED',
    INSTANCE_SUSPENDED_EXPIRED: 'INSTANCE_SUSPENDED_EXPIRED',
    INSTANCE_DESTROY_TRAFFIC_LIMIT_EXCEEDED: 'INSTANCE_DESTROY_TRAFFIC_LIMIT_EXCEEDED',

    // Host errors
    HOST_NOT_FOUND: 'HOST_NOT_FOUND',
    HOST_OFFLINE: 'HOST_OFFLINE',
    HOST_ONLINE: 'HOST_ONLINE',
    HOST_HAS_INSTANCES: 'HOST_HAS_INSTANCES',
    HOST_ALREADY_OFFICIAL: 'HOST_ALREADY_OFFICIAL',
    HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT: 'HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT',
    NO_AVAILABLE_HOSTS: 'NO_AVAILABLE_HOSTS',

    // Image errors
    IMAGE_NOT_FOUND: 'IMAGE_NOT_FOUND',
    IMAGE_SYNCED_ON_HOSTS: 'IMAGE_SYNCED_ON_HOSTS',
    IMAGE_TYPE_MISMATCH: 'IMAGE_TYPE_MISMATCH',
    IMAGE_MEMORY_INCOMPATIBLE: 'IMAGE_MEMORY_INCOMPATIBLE',

    // Package errors
    PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
    PACKAGE_IN_USE: 'PACKAGE_IN_USE',
    PACKAGE_PREREQUISITE_MISSING: 'PACKAGE_PREREQUISITE_MISSING',

    // Quota errors
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    QUOTA_CPU_EXCEEDED: 'QUOTA_CPU_EXCEEDED',
    QUOTA_MEMORY_EXCEEDED: 'QUOTA_MEMORY_EXCEEDED',
    QUOTA_DISK_EXCEEDED: 'QUOTA_DISK_EXCEEDED',
    QUOTA_INSTANCE_EXCEEDED: 'QUOTA_INSTANCE_EXCEEDED',
    QUOTA_PORT_EXCEEDED: 'QUOTA_PORT_EXCEEDED',
    QUOTA_SNAPSHOT_EXCEEDED: 'QUOTA_SNAPSHOT_EXCEEDED',
    QUOTA_BACKUP_EXCEEDED: 'QUOTA_BACKUP_EXCEEDED',
    QUOTA_NOT_ALLOCATED: 'QUOTA_NOT_ALLOCATED',

    // Snapshot errors
    SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
    SNAPSHOT_RESTORE_REQUIRES_STOP: 'SNAPSHOT_RESTORE_REQUIRES_STOP',

    // Backup errors
    BACKUP_NOT_FOUND: 'BACKUP_NOT_FOUND',
    BACKUP_NOT_READY: 'BACKUP_NOT_READY',
    EXPORT_TASK_NOT_FOUND: 'EXPORT_TASK_NOT_FOUND',
    EXPORT_TASK_EXPIRED: 'EXPORT_TASK_EXPIRED',

    // Port mapping errors
    PORT_IN_USE: 'PORT_IN_USE',
    PORT_OUT_OF_RANGE: 'PORT_OUT_OF_RANGE',
    PORT_MAPPING_NOT_FOUND: 'PORT_MAPPING_NOT_FOUND',
    PORT_CONFLICT: 'PORT_CONFLICT',
    PORT_RANGE_MISMATCH: 'PORT_RANGE_MISMATCH',
    QUOTA_PORT_BATCH_EXCEEDED: 'QUOTA_PORT_BATCH_EXCEEDED',

    // Notification errors
    NOTIFICATION_CHANNEL_NOT_FOUND: 'NOTIFICATION_CHANNEL_NOT_FOUND',

    // Help errors
    ARTICLE_NOT_FOUND: 'ARTICLE_NOT_FOUND',
    SLUG_EXISTS: 'SLUG_EXISTS',

    // Invite code errors
    INVITE_CODE_USED: 'INVITE_CODE_USED',
    INVITE_CODE_NOT_FOUND: 'INVITE_CODE_NOT_FOUND',

    // OAuth errors
    OAUTH_PROVIDER_DISABLED: 'OAUTH_PROVIDER_DISABLED',
    OAUTH_ALREADY_BOUND: 'OAUTH_ALREADY_BOUND',
    OAUTH_NOT_BOUND: 'OAUTH_NOT_BOUND',
    OAUTH_TOKEN_ERROR: 'OAUTH_TOKEN_ERROR',

    // SSH Key errors
    SSH_KEY_NOT_FOUND: 'SSH_KEY_NOT_FOUND',
    SSH_KEY_REQUIRED: 'SSH_KEY_REQUIRED',
    SSH_KEY_NOT_OWNED: 'SSH_KEY_NOT_OWNED',

    // Package/Plan errors
    PACKAGE_UNAVAILABLE: 'PACKAGE_UNAVAILABLE',
    PLAN_REQUIRED: 'PLAN_REQUIRED',
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    PLAN_INACTIVE: 'PLAN_INACTIVE',
    PLAN_SOLD_OUT: 'PLAN_SOLD_OUT',
    CANNOT_CREATE_OWN_PAID_PACKAGE: 'CANNOT_CREATE_OWN_PAID_PACKAGE',
    BALANCE_INSUFFICIENT: 'BALANCE_INSUFFICIENT',

    // Host resource errors
    HOST_UNAVAILABLE: 'HOST_UNAVAILABLE',
    HOST_NO_ONLINE: 'HOST_NO_ONLINE',
    HOST_RESOURCES_NOT_SYNCED: 'HOST_RESOURCES_NOT_SYNCED',
    HOST_NODE_GROUP_NO_HOSTS: 'HOST_NODE_GROUP_NO_HOSTS',
    HOST_RESOURCES_INSUFFICIENT: 'HOST_RESOURCES_INSUFFICIENT',
    HOST_NAME_EXISTS: 'HOST_NAME_EXISTS',
    HOST_ADDRESS_EXISTS: 'HOST_ADDRESS_EXISTS',
    HOST_ADDRESS_UNRESOLVABLE: 'HOST_ADDRESS_UNRESOLVABLE',
    HOST_CERT_NOT_CONFIGURED: 'HOST_CERT_NOT_CONFIGURED',
    HOST_INVALID_CPU_MAX: 'HOST_INVALID_CPU_MAX',
    HOST_INVALID_MEMORY_MAX: 'HOST_INVALID_MEMORY_MAX',
    HOST_INVALID_IPV6_MODE: 'HOST_INVALID_IPV6_MODE',
    HOST_IPV6_ROUTE_REQUIRES_CONFIG: 'HOST_IPV6_ROUTE_REQUIRES_CONFIG',
    HOST_CPU_BELOW_USED: 'HOST_CPU_BELOW_USED',
    HOST_MEMORY_BELOW_USED: 'HOST_MEMORY_BELOW_USED',
    HOST_INSTANCE_TYPE_MISMATCH: 'HOST_INSTANCE_TYPE_MISMATCH',

    // Instance operation errors
    INSTANCE_STOP_REQUIRED: 'INSTANCE_STOP_REQUIRED',
    INSTANCE_IMAGE_REQUIRED: 'INSTANCE_IMAGE_REQUIRED',
    INSTANCE_IMAGE_UNAVAILABLE: 'INSTANCE_IMAGE_UNAVAILABLE',
    INSTANCE_REBUILD_FAILED: 'INSTANCE_REBUILD_FAILED',
    INSTANCE_CLONE_FAILED: 'INSTANCE_CLONE_FAILED',
    INSTANCE_IPV6_NOT_SUPPORTED: 'INSTANCE_IPV6_NOT_SUPPORTED',
    INSTANCE_IPV6_REASSIGN_FAILED: 'INSTANCE_IPV6_REASSIGN_FAILED',
    INSTANCE_NO_IPV4: 'INSTANCE_NO_IPV4',
    HOST_NO_IPV6_SUBNET: 'HOST_NO_IPV6_SUBNET',
    IPV6_POOL_EXHAUSTED: 'IPV6_POOL_EXHAUSTED',
    IPV6_REASSIGN_COOLDOWN: 'IPV6_REASSIGN_COOLDOWN',

    // Port mapping errors (additional)
    PORT_MAPPING_NAT_ONLY: 'PORT_MAPPING_NAT_ONLY',
    PORT_NO_AVAILABLE: 'PORT_NO_AVAILABLE',
    PORT_MAPPING_INVALID_ID: 'PORT_MAPPING_INVALID_ID',

    // Image errors (additional)
    IMAGE_CREATE_FAILED: 'IMAGE_CREATE_FAILED',
    IMAGE_UPDATE_FAILED: 'IMAGE_UPDATE_FAILED',
    IMAGE_INVALID_HOST_ID: 'IMAGE_INVALID_HOST_ID',

    // Backup errors (additional)
    BACKUP_CREATE_FAILED: 'BACKUP_CREATE_FAILED',
    BACKUP_DELETE_FAILED: 'BACKUP_DELETE_FAILED',
    BACKUP_EXPORT_FAILED: 'BACKUP_EXPORT_FAILED',
    BACKUP_QUOTA_NOT_SET: 'BACKUP_QUOTA_NOT_SET',
    BACKUP_EXPORT_STATUS_INVALID: 'BACKUP_EXPORT_STATUS_INVALID',

    // Config errors
    CONFIG_INVALID_KEY: 'CONFIG_INVALID_KEY',
    CONFIG_INVALID_VALUE: 'CONFIG_INVALID_VALUE',

    // Snapshot errors (additional)
    SNAPSHOT_QUOTA_NOT_SET: 'SNAPSHOT_QUOTA_NOT_SET',

    // Package errors (additional)
    PACKAGE_HAS_INSTANCES: 'PACKAGE_HAS_INSTANCES',

    // Resource limit errors
    RESOURCE_CPU_EXCEEDS_PACKAGE: 'RESOURCE_CPU_EXCEEDS_PACKAGE',
    RESOURCE_MEMORY_EXCEEDS_PACKAGE: 'RESOURCE_MEMORY_EXCEEDS_PACKAGE',
    RESOURCE_DISK_EXCEEDS_PACKAGE: 'RESOURCE_DISK_EXCEEDS_PACKAGE',

    // User quota errors (detailed)
    QUOTA_CPU_INSUFFICIENT: 'QUOTA_CPU_INSUFFICIENT',
    QUOTA_MEMORY_INSUFFICIENT: 'QUOTA_MEMORY_INSUFFICIENT',
    QUOTA_DISK_INSUFFICIENT: 'QUOTA_DISK_INSUFFICIENT',
    QUOTA_INSTANCE_LIMIT_REACHED: 'QUOTA_INSTANCE_LIMIT_REACHED',
    QUOTA_HOST_LIMIT_REACHED: 'QUOTA_HOST_LIMIT_REACHED',
    QUOTA_PACKAGE_LIMIT_REACHED: 'QUOTA_PACKAGE_LIMIT_REACHED',
    QUOTA_FRIEND_LIMIT_REACHED: 'QUOTA_FRIEND_LIMIT_REACHED',
    QUOTA_PORT_BELOW_USED: 'QUOTA_PORT_BELOW_USED',
    QUOTA_SNAPSHOT_BELOW_USED: 'QUOTA_SNAPSHOT_BELOW_USED',
    QUOTA_BACKUP_BELOW_USED: 'QUOTA_BACKUP_BELOW_USED',
    QUOTA_PORT_TOTAL_EXCEEDED: 'QUOTA_PORT_TOTAL_EXCEEDED',
    QUOTA_SNAPSHOT_TOTAL_EXCEEDED: 'QUOTA_SNAPSHOT_TOTAL_EXCEEDED',
    QUOTA_BACKUP_TOTAL_EXCEEDED: 'QUOTA_BACKUP_TOTAL_EXCEEDED',

    // Image errors (additional)
    IMAGE_NOT_SYNCED: 'IMAGE_NOT_SYNCED',
    IMAGE_SYNCING_CANNOT_DELETE: 'IMAGE_SYNCING_CANNOT_DELETE',
    IMAGE_NO_HOSTS: 'IMAGE_NO_HOSTS',

    // Port errors (additional)
    PORT_RANGE_INVALID: 'PORT_RANGE_INVALID',

    // Snapshot policy errors
    SNAPSHOT_MANUAL_FULL: 'SNAPSHOT_MANUAL_FULL',
    SNAPSHOT_RETENTION_EXCEEDS: 'SNAPSHOT_RETENTION_EXCEEDS',

    // Backup policy errors
    BACKUP_MANUAL_FULL: 'BACKUP_MANUAL_FULL',
    BACKUP_RETENTION_EXCEEDS: 'BACKUP_RETENTION_EXCEEDS',

    // OAuth errors (additional)
    OAUTH_NOT_ENABLED: 'OAUTH_NOT_ENABLED',

    // Storage config errors
    STORAGE_CONFIG_NOT_FOUND: 'STORAGE_CONFIG_NOT_FOUND',
    STORAGE_CONFIG_CREATE_FAILED: 'STORAGE_CONFIG_CREATE_FAILED',
    STORAGE_CONFIG_UPDATE_FAILED: 'STORAGE_CONFIG_UPDATE_FAILED',
    STORAGE_CONFIG_DELETE_FAILED: 'STORAGE_CONFIG_DELETE_FAILED',
    STORAGE_TYPE_NOT_SUPPORTED: 'STORAGE_TYPE_NOT_SUPPORTED',
    STORAGE_POOL_NOT_CONFIGURED: 'STORAGE_POOL_NOT_CONFIGURED',

    // Backup upload errors
    BACKUP_UPLOAD_TASK_NOT_FOUND: 'BACKUP_UPLOAD_TASK_NOT_FOUND',
    BACKUP_UPLOAD_IN_PROGRESS: 'BACKUP_UPLOAD_IN_PROGRESS',
    BACKUP_UPLOAD_FAILED: 'BACKUP_UPLOAD_FAILED',

    // Instance config errors
    CONFIG_DISK_CANNOT_SHRINK: 'CONFIG_DISK_CANNOT_SHRINK',
    CONFIG_NO_CHANGES: 'CONFIG_NO_CHANGES',
    CONFIG_UPDATE_FAILED: 'CONFIG_UPDATE_FAILED',

    // Transfer errors
    TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
    TRANSFER_TO_SELF: 'TRANSFER_TO_SELF',
    TRANSFER_TO_BANNED: 'TRANSFER_TO_BANNED',
    TRANSFER_ALREADY_PENDING: 'TRANSFER_ALREADY_PENDING',
    TRANSFER_NOT_PENDING: 'TRANSFER_NOT_PENDING',
    TRANSFER_INVALID_STATUS: 'TRANSFER_INVALID_STATUS',
    TRANSFER_QUOTA_NOT_FOUND: 'TRANSFER_QUOTA_NOT_FOUND',
    TRANSFER_QUOTA_INSUFFICIENT: 'TRANSFER_QUOTA_INSUFFICIENT',
    TRANSFER_INSTANCE_LOCKED: 'TRANSFER_INSTANCE_LOCKED',
    TRANSFER_INSUFFICIENT_BALANCE: 'TRANSFER_INSUFFICIENT_BALANCE',
    TRANSFER_HOST_DISABLED: 'TRANSFER_HOST_DISABLED',
    INVALID_PARAMS: 'INVALID_PARAMS',

    // Friend system errors
    CANNOT_ADD_SELF: 'CANNOT_ADD_SELF',
    ALREADY_FRIENDS: 'ALREADY_FRIENDS',
    FRIEND_REQUEST_PENDING: 'FRIEND_REQUEST_PENDING',
    FRIEND_REQUEST_NOT_FOUND: 'FRIEND_REQUEST_NOT_FOUND',
    FRIEND_REQUEST_NOT_PENDING: 'FRIEND_REQUEST_NOT_PENDING',
    FRIENDSHIP_NOT_FOUND: 'FRIENDSHIP_NOT_FOUND',
    NOT_FRIENDS: 'NOT_FRIENDS',
    TARGET_FRIEND_QUOTA_FULL: 'TARGET_FRIEND_QUOTA_FULL',

    // Package share errors
    CANNOT_SHARE_TO_SELF: 'CANNOT_SHARE_TO_SELF',
    PACKAGE_ALREADY_SHARED: 'PACKAGE_ALREADY_SHARED',
    SHARE_NOT_FOUND: 'SHARE_NOT_FOUND',
    SHARE_QUOTA_CPU_EXCEEDED: 'SHARE_QUOTA_CPU_EXCEEDED',
    SHARE_QUOTA_MEMORY_EXCEEDED: 'SHARE_QUOTA_MEMORY_EXCEEDED',
    SHARE_QUOTA_INSTANCES_EXCEEDED: 'SHARE_QUOTA_INSTANCES_EXCEEDED',

    // Email verification errors
    EMAIL_VERIFICATION_DISABLED: 'EMAIL_VERIFICATION_DISABLED',
    EMAIL_CODE_REQUIRED: 'EMAIL_CODE_REQUIRED',
    INVALID_EMAIL_CODE: 'INVALID_EMAIL_CODE',
    TOO_MANY_VERIFICATION_REQUESTS: 'TOO_MANY_VERIFICATION_REQUESTS',
    EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
    EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
    EMAIL_DOMAIN_NOT_ALLOWED: 'EMAIL_DOMAIN_NOT_ALLOWED',

    // Inbox errors
    MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',

    // Checkin errors
    CHECKIN_NO_INSTANCE: 'CHECKIN_NO_INSTANCE',
    CHECKIN_ALREADY_TODAY: 'CHECKIN_ALREADY_TODAY',
    REDEEM_ALREADY_TODAY: 'REDEEM_ALREADY_TODAY',
    REDEEM_CODE_NOT_FOUND: 'REDEEM_CODE_NOT_FOUND',
    REDEEM_CODE_USED: 'REDEEM_CODE_USED',
    REDEEM_CODE_EXPIRED: 'REDEEM_CODE_EXPIRED',
    REDEEM_CODE_SELF_ONLY: 'REDEEM_CODE_SELF_ONLY',
    REDEEM_CODE_DISABLED: 'REDEEM_CODE_DISABLED',
    REDEEM_CODE_INVALID_FORMAT: 'REDEEM_CODE_INVALID_FORMAT',
    REDEEM_CODE_EXHAUSTED: 'REDEEM_CODE_EXHAUSTED',
    REDEEM_CODE_ALREADY_USED_BY_USER: 'REDEEM_CODE_ALREADY_USED_BY_USER',
    REDEEM_CODE_HOST_MISMATCH: 'REDEEM_CODE_HOST_MISMATCH',
    REDEEM_CODE_BATCH_LIMIT: 'REDEEM_CODE_BATCH_LIMIT',
    REDEEM_EXCEEDS_PACKAGE_QUOTA: 'REDEEM_EXCEEDS_PACKAGE_QUOTA',
    REDEEM_ALREADY_AT_LIMIT: 'REDEEM_ALREADY_AT_LIMIT',
    CHECKIN_CODE_PAID_INSTANCE: 'CHECKIN_CODE_PAID_INSTANCE',

    // Resource Pool errors
    RESOURCE_POOL_INSUFFICIENT: 'RESOURCE_POOL_INSUFFICIENT',
    RESOURCE_POOL_KVM_CPU_MULTIPLE: 'RESOURCE_POOL_KVM_CPU_MULTIPLE',
    RESOURCE_POOL_KVM_MEMORY_MULTIPLE: 'RESOURCE_POOL_KVM_MEMORY_MULTIPLE',
    RESOURCE_POOL_KVM_DISK_MULTIPLE: 'RESOURCE_POOL_KVM_DISK_MULTIPLE',
    RESOURCE_POOL_VM_MUST_STOP: 'RESOURCE_POOL_VM_MUST_STOP',
    RESOURCE_POOL_SYSTEM_CODE_REQUIRES_INSTANCE: 'RESOURCE_POOL_SYSTEM_CODE_REQUIRES_INSTANCE',

    // Internal errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',

    // Mail module errors
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',
    RESOURCE_EXISTS: 'RESOURCE_EXISTS',
    UPSTREAM_ERROR: 'UPSTREAM_ERROR',
    INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
} as const

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode]

// English error messages (default)
export const ErrorMessages: Record<ErrorCodeType, string> = {
    // Common errors
    [ErrorCode.INVALID_ID]: 'Invalid ID',
    [ErrorCode.NOT_FOUND]: 'Resource not found',
    [ErrorCode.UNAUTHORIZED]: 'Unauthorized',
    [ErrorCode.FORBIDDEN]: 'Access denied',
    [ErrorCode.ADMIN_REQUIRED]: 'Admin privileges required',
    [ErrorCode.FEATURE_DISABLED]: 'This feature has been disabled',

    // User errors
    [ErrorCode.USER_NOT_FOUND]: 'User not found',
    [ErrorCode.USER_EXISTS]: 'Username already exists',
    [ErrorCode.CANNOT_MODIFY_SELF]: 'Cannot modify your own status',
    [ErrorCode.CANNOT_DELETE_SELF]: 'Cannot delete yourself',
    [ErrorCode.CANNOT_BAN_ADMIN]: 'Cannot ban admin account',
    [ErrorCode.CANNOT_DELETE_ADMIN]: 'Cannot delete admin account',
    [ErrorCode.USER_HAS_INSTANCES]: 'User has instances, please delete them first',
    [ErrorCode.USER_HAS_RESOURCES]: 'User owns resources, please transfer or remove them first',

    // Auth errors
    [ErrorCode.INVALID_CREDENTIALS]: 'Invalid username or password',
    [ErrorCode.ACCOUNT_BANNED]: 'Account has been disabled',
    [ErrorCode.TOO_MANY_ATTEMPTS]: 'Too many login attempts, please try again later',
    [ErrorCode.REGISTRATION_DISABLED]: 'Registration is currently closed',
    [ErrorCode.INVALID_INVITE_CODE]: 'Invalid or used invite code',
    [ErrorCode.INVITE_CODE_EXPIRED]: 'Invite code has expired',
    [ErrorCode.INVALID_2FA_CODE]: 'Invalid verification code or recovery code',
    [ErrorCode.TWO_FA_REQUIRED]: 'Two-factor authentication required',
    [ErrorCode.TWO_FA_ALREADY_ENABLED]: '2FA is already enabled, please disable it first',
    [ErrorCode.TWO_FA_NOT_ENABLED]: '2FA is not enabled',
    [ErrorCode.REFRESH_TOKEN_MISSING]: 'Refresh token missing',
    [ErrorCode.REFRESH_TOKEN_INVALID]: 'Refresh token invalid or expired',
    [ErrorCode.SESSION_NOT_FOUND]: 'Session not found',

    // Validation errors
    [ErrorCode.INVALID_EMAIL]: 'Please enter a valid email address',
    [ErrorCode.EMAIL_CONTAINS_ILLEGAL]: 'Email contains illegal characters',
    [ErrorCode.USERNAME_CONTAINS_ILLEGAL]: 'Username contains illegal characters',
    [ErrorCode.PASSWORD_TOO_WEAK]: 'Password is too weak',
    [ErrorCode.INVALID_SSH_KEY]: 'Invalid SSH public key format',
    [ErrorCode.SSH_KEY_EXISTS]: 'This SSH key has already been added',
    [ErrorCode.INVALID_NAME]: 'Invalid name format',

    // Instance errors
    [ErrorCode.INSTANCE_NOT_FOUND]: 'Instance not found',
    [ErrorCode.INSTANCE_ALREADY_RUNNING]: 'Instance is already running',
    [ErrorCode.INSTANCE_ALREADY_STOPPED]: 'Instance is already stopped',
    [ErrorCode.INSTANCE_STATUS_INVALID]: 'Instance status does not allow this operation',
    [ErrorCode.INSTANCE_SUSPENDED]: 'Instance is suspended and cannot be started',
    [ErrorCode.INSTANCE_NOT_SUSPENDED]: 'Instance is not in suspended status',
    [ErrorCode.INSTANCE_SUSPENDED_EXPIRED]: 'Instance is suspended due to expiration, please renew to unsuspend',
    [ErrorCode.INSTANCE_DESTROY_TRAFFIC_LIMIT_EXCEEDED]: 'Current monthly traffic cycle usage has reached the destroy limit',

    // Host errors
    [ErrorCode.HOST_NOT_FOUND]: 'Host not found',
    [ErrorCode.HOST_OFFLINE]: 'Host is offline',
    [ErrorCode.HOST_ONLINE]: 'Host is online, reinstall not needed',
    [ErrorCode.HOST_HAS_INSTANCES]: 'Host has instances, please delete them first',
    [ErrorCode.HOST_ALREADY_OFFICIAL]: 'Host is already official',
    [ErrorCode.HOST_TAKEOVER_PACKAGE_BINDING_CONFLICT]: 'Takeover blocked because some packages would lose all bound hosts',
    [ErrorCode.NO_AVAILABLE_HOSTS]: 'No available hosts',

    // Image errors
    [ErrorCode.IMAGE_NOT_FOUND]: 'Image not found',
    [ErrorCode.IMAGE_SYNCED_ON_HOSTS]: 'Image is synced on hosts, please delete from hosts first',
    [ErrorCode.IMAGE_TYPE_MISMATCH]: 'Selected image is not compatible with the package instance type',
    [ErrorCode.IMAGE_MEMORY_INCOMPATIBLE]: '128MB memory only supports Alpine/Debian images',

    // Package errors
    [ErrorCode.PACKAGE_NOT_FOUND]: 'Package not found',
    [ErrorCode.PACKAGE_IN_USE]: 'Package is in use by instances',
    [ErrorCode.PACKAGE_PREREQUISITE_MISSING]: 'Required package instance is missing',

    // Quota errors
    [ErrorCode.QUOTA_EXCEEDED]: 'Quota exceeded',
    [ErrorCode.QUOTA_CPU_EXCEEDED]: 'CPU quota exceeded',
    [ErrorCode.QUOTA_MEMORY_EXCEEDED]: 'Memory quota exceeded',
    [ErrorCode.QUOTA_DISK_EXCEEDED]: 'Disk quota exceeded',
    [ErrorCode.QUOTA_INSTANCE_EXCEEDED]: 'Instance quota exceeded',
    [ErrorCode.QUOTA_PORT_EXCEEDED]: 'Port quota exceeded',
    [ErrorCode.QUOTA_SNAPSHOT_EXCEEDED]: 'Snapshot quota exceeded',
    [ErrorCode.QUOTA_BACKUP_EXCEEDED]: 'Backup quota exceeded',
    [ErrorCode.QUOTA_NOT_ALLOCATED]: 'Quota not allocated',

    // Snapshot errors
    [ErrorCode.SNAPSHOT_NOT_FOUND]: 'Snapshot not found',
    [ErrorCode.SNAPSHOT_RESTORE_REQUIRES_STOP]: 'Please stop the instance before restoring snapshot',

    // Backup errors
    [ErrorCode.BACKUP_NOT_FOUND]: 'Backup not found',
    [ErrorCode.BACKUP_NOT_READY]: 'Backup is not ready for export',
    [ErrorCode.EXPORT_TASK_NOT_FOUND]: 'Export task not found or expired',
    [ErrorCode.EXPORT_TASK_EXPIRED]: 'Export task has expired',

    // Port mapping errors
    [ErrorCode.PORT_IN_USE]: 'Port is already in use',
    [ErrorCode.PORT_OUT_OF_RANGE]: 'Port is out of allowed range',
    [ErrorCode.PORT_MAPPING_NOT_FOUND]: 'Port mapping not found',
    [ErrorCode.PORT_CONFLICT]: 'Some ports are already in use',
    [ErrorCode.PORT_RANGE_MISMATCH]: 'Private and public port range count must match',
    [ErrorCode.QUOTA_PORT_BATCH_EXCEEDED]: 'Port quota exceeded for batch mapping',

    // Notification errors
    [ErrorCode.NOTIFICATION_CHANNEL_NOT_FOUND]: 'Notification channel not found',

    // Help errors
    [ErrorCode.ARTICLE_NOT_FOUND]: 'Article not found',
    [ErrorCode.SLUG_EXISTS]: 'Slug already exists',

    // Invite code errors
    [ErrorCode.INVITE_CODE_USED]: 'Invite code has been used',
    [ErrorCode.INVITE_CODE_NOT_FOUND]: 'Invite code not found',

    // OAuth errors
    [ErrorCode.OAUTH_PROVIDER_DISABLED]: 'This login method has been disabled',
    [ErrorCode.OAUTH_ALREADY_BOUND]: 'This account is already bound to another user',
    [ErrorCode.OAUTH_NOT_BOUND]: 'Account not bound',
    [ErrorCode.OAUTH_TOKEN_ERROR]: 'Failed to get authorization',

    // SSH Key errors
    [ErrorCode.SSH_KEY_NOT_FOUND]: 'SSH key not found',
    [ErrorCode.SSH_KEY_REQUIRED]: 'SSH key is required, please add one in settings first',
    [ErrorCode.SSH_KEY_NOT_OWNED]: 'SSH key not found or does not belong to this user',

    // Package/Plan errors
    [ErrorCode.PACKAGE_UNAVAILABLE]: 'Package is unavailable or discontinued',
    [ErrorCode.PLAN_REQUIRED]: 'This is a paid package, a plan must be selected',
    [ErrorCode.PLAN_NOT_FOUND]: 'Plan not found or does not belong to this package',
    [ErrorCode.PLAN_INACTIVE]: 'Plan is inactive',
    [ErrorCode.PLAN_SOLD_OUT]: 'Plan is sold out',
    [ErrorCode.CANNOT_CREATE_OWN_PAID_PACKAGE]: 'Cannot create instance with your own paid package',
    [ErrorCode.BALANCE_INSUFFICIENT]: 'Insufficient balance',

    // Host resource errors
    [ErrorCode.HOST_UNAVAILABLE]: 'Selected host is unavailable or has insufficient resources',
    [ErrorCode.HOST_NO_ONLINE]: 'No online hosts available, please test connection in node management',
    [ErrorCode.HOST_RESOURCES_NOT_SYNCED]: 'Host resources not synced, please click "Test Connection" in node management',
    [ErrorCode.HOST_NODE_GROUP_NO_HOSTS]: 'No available hosts bound to this package',
    [ErrorCode.HOST_RESOURCES_INSUFFICIENT]: 'All hosts have insufficient resources, please try later or choose another package',
    [ErrorCode.HOST_NAME_EXISTS]: 'Host name already exists',
    [ErrorCode.HOST_ADDRESS_EXISTS]: 'Host connection address already exists',
    [ErrorCode.HOST_ADDRESS_UNRESOLVABLE]: 'Panel could not resolve the host connection address',
    [ErrorCode.HOST_CERT_NOT_CONFIGURED]: 'Please configure certificate path first',
    [ErrorCode.HOST_INVALID_CPU_MAX]: 'CPU max allowance cannot be negative',
    [ErrorCode.HOST_INVALID_MEMORY_MAX]: 'Memory max cannot be negative or less than 256MB',
    [ErrorCode.HOST_INVALID_IPV6_MODE]: 'IPv6 mode must be 1 (route), 2 (NAT), or 3 (disabled)',
    [ErrorCode.HOST_IPV6_ROUTE_REQUIRES_CONFIG]: 'IPv6 route mode requires subnet and parent interface configuration',
    [ErrorCode.HOST_CPU_BELOW_USED]: 'CPU max allowance cannot be less than current usage by instances',
    [ErrorCode.HOST_MEMORY_BELOW_USED]: 'Memory max cannot be less than current usage by instances',
    [ErrorCode.HOST_INSTANCE_TYPE_MISMATCH]: 'Package instance type is not supported by the selected host',

    // Instance operation errors
    [ErrorCode.INSTANCE_STOP_REQUIRED]: 'Please stop the instance first',
    [ErrorCode.INSTANCE_IMAGE_REQUIRED]: 'Please specify an image',
    [ErrorCode.INSTANCE_IMAGE_UNAVAILABLE]: 'Selected image is not available on this host',
    [ErrorCode.INSTANCE_REBUILD_FAILED]: 'Instance rebuild failed',
    [ErrorCode.INSTANCE_CLONE_FAILED]: 'Instance clone failed',
    [ErrorCode.INSTANCE_IPV6_NOT_SUPPORTED]: 'Only NAT + IPv6 mode instances support IPv6 reassignment',
    [ErrorCode.INSTANCE_IPV6_REASSIGN_FAILED]: 'Failed to reassign IPv6 address',
    [ErrorCode.INSTANCE_NO_IPV4]: 'VM instance requires IPv4 address for port mapping',
    [ErrorCode.HOST_NO_IPV6_SUBNET]: 'Host has no IPv6 subnet configured',
    [ErrorCode.IPV6_POOL_EXHAUSTED]: 'IPv6 address pool exhausted, please try again later',
    [ErrorCode.IPV6_REASSIGN_COOLDOWN]: 'IPv6 can only be reassigned once per day, please try again later',

    // Port mapping errors (additional)
    [ErrorCode.PORT_MAPPING_NAT_ONLY]: 'Port mapping is only supported in NAT or dual-stack mode',
    [ErrorCode.PORT_NO_AVAILABLE]: 'No available ports, please contact administrator',
    [ErrorCode.PORT_MAPPING_INVALID_ID]: 'Invalid instance or port mapping ID',

    // Image errors (additional)
    [ErrorCode.IMAGE_CREATE_FAILED]: 'Image creation failed',
    [ErrorCode.IMAGE_UPDATE_FAILED]: 'Image update failed',
    [ErrorCode.IMAGE_INVALID_HOST_ID]: 'Invalid image or host ID',

    // Backup errors (additional)
    [ErrorCode.BACKUP_CREATE_FAILED]: 'Backup creation failed',
    [ErrorCode.BACKUP_DELETE_FAILED]: 'Backup deletion failed',
    [ErrorCode.BACKUP_EXPORT_FAILED]: 'Backup export failed',
    [ErrorCode.BACKUP_QUOTA_NOT_SET]: 'Please set backup quota for this instance first',
    [ErrorCode.BACKUP_EXPORT_STATUS_INVALID]: 'Export task status is invalid',

    // Config errors
    [ErrorCode.CONFIG_INVALID_KEY]: 'Invalid configuration key',
    [ErrorCode.CONFIG_INVALID_VALUE]: 'Configuration value must be a non-negative integer',

    // Snapshot errors (additional)
    [ErrorCode.SNAPSHOT_QUOTA_NOT_SET]: 'Please set snapshot quota for this instance first',

    // Package errors (additional)
    [ErrorCode.PACKAGE_HAS_INSTANCES]: 'Package is in use by instances and cannot be deleted',

    // Resource limit errors
    [ErrorCode.RESOURCE_CPU_EXCEEDS_PACKAGE]: 'CPU configuration exceeds package limit',
    [ErrorCode.RESOURCE_MEMORY_EXCEEDS_PACKAGE]: 'Memory configuration exceeds package limit',
    [ErrorCode.RESOURCE_DISK_EXCEEDS_PACKAGE]: 'Disk configuration exceeds package limit',

    // User quota errors (detailed)
    [ErrorCode.QUOTA_CPU_INSUFFICIENT]: 'CPU quota insufficient',
    [ErrorCode.QUOTA_MEMORY_INSUFFICIENT]: 'Memory quota insufficient',
    [ErrorCode.QUOTA_DISK_INSUFFICIENT]: 'Disk quota insufficient',
    [ErrorCode.QUOTA_INSTANCE_LIMIT_REACHED]: 'Instance limit reached',
    [ErrorCode.QUOTA_HOST_LIMIT_REACHED]: 'Host limit reached',
    [ErrorCode.QUOTA_PACKAGE_LIMIT_REACHED]: 'Package limit reached',
    [ErrorCode.QUOTA_FRIEND_LIMIT_REACHED]: 'Friend limit reached',
    [ErrorCode.QUOTA_PORT_BELOW_USED]: 'Port quota cannot be less than current usage',
    [ErrorCode.QUOTA_SNAPSHOT_BELOW_USED]: 'Snapshot quota cannot be less than current usage',
    [ErrorCode.QUOTA_BACKUP_BELOW_USED]: 'Backup quota cannot be less than current usage',
    [ErrorCode.QUOTA_PORT_TOTAL_EXCEEDED]: 'Total port quota exceeds user limit',
    [ErrorCode.QUOTA_SNAPSHOT_TOTAL_EXCEEDED]: 'Total snapshot quota exceeds user limit',
    [ErrorCode.QUOTA_BACKUP_TOTAL_EXCEEDED]: 'Total backup quota exceeds user limit',

    // Image errors (additional)
    [ErrorCode.IMAGE_NOT_SYNCED]: 'Image not synced to selected host',
    [ErrorCode.IMAGE_SYNCING_CANNOT_DELETE]: 'Image is syncing on hosts and cannot be deleted',
    [ErrorCode.IMAGE_NO_HOSTS]: 'No available hosts, please add hosts first',

    // Port errors (additional)
    [ErrorCode.PORT_RANGE_INVALID]: 'Port must be within allowed range',

    // Snapshot policy errors
    [ErrorCode.SNAPSHOT_MANUAL_FULL]: 'Manual snapshots have reached instance quota, cannot enable auto snapshot',
    [ErrorCode.SNAPSHOT_RETENTION_EXCEEDS]: 'Retention count exceeds available quota',

    // Backup policy errors
    [ErrorCode.BACKUP_MANUAL_FULL]: 'Manual backups have reached instance quota, cannot enable auto backup',
    [ErrorCode.BACKUP_RETENTION_EXCEEDS]: 'Retention count exceeds available quota',

    // OAuth errors (additional)
    [ErrorCode.OAUTH_NOT_ENABLED]: 'This OAuth provider is not enabled',

    // Storage config errors
    [ErrorCode.STORAGE_CONFIG_NOT_FOUND]: 'Storage configuration not found',
    [ErrorCode.STORAGE_CONFIG_CREATE_FAILED]: 'Failed to create storage configuration',
    [ErrorCode.STORAGE_CONFIG_UPDATE_FAILED]: 'Failed to update storage configuration',
    [ErrorCode.STORAGE_CONFIG_DELETE_FAILED]: 'Failed to delete storage configuration',
    [ErrorCode.STORAGE_TYPE_NOT_SUPPORTED]: 'Storage type not supported',
    [ErrorCode.STORAGE_POOL_NOT_CONFIGURED]: 'No system disk storage pool configured on host',

    // Backup upload errors
    [ErrorCode.BACKUP_UPLOAD_TASK_NOT_FOUND]: 'Backup upload task not found',
    [ErrorCode.BACKUP_UPLOAD_IN_PROGRESS]: 'A backup upload task is already in progress',
    [ErrorCode.BACKUP_UPLOAD_FAILED]: 'Backup upload failed',

    // Instance config errors
    [ErrorCode.CONFIG_DISK_CANNOT_SHRINK]: 'Disk size can only be increased, not decreased',
    [ErrorCode.CONFIG_NO_CHANGES]: 'No configuration changes provided',
    [ErrorCode.CONFIG_UPDATE_FAILED]: 'Failed to update instance configuration',

    // Transfer errors
    [ErrorCode.TRANSFER_NOT_FOUND]: 'Transfer request not found',
    [ErrorCode.TRANSFER_TO_SELF]: 'Cannot transfer to yourself',
    [ErrorCode.TRANSFER_TO_BANNED]: 'Cannot transfer to a banned user',
    [ErrorCode.TRANSFER_ALREADY_PENDING]: 'This instance already has a pending transfer request',
    [ErrorCode.TRANSFER_NOT_PENDING]: 'Transfer request is not in pending status',
    [ErrorCode.TRANSFER_INVALID_STATUS]: 'Instance status does not allow transfer',
    [ErrorCode.TRANSFER_QUOTA_NOT_FOUND]: 'Target user quota not found',
    [ErrorCode.TRANSFER_QUOTA_INSUFFICIENT]: 'Target user quota insufficient',
    [ErrorCode.TRANSFER_INSTANCE_LOCKED]: 'Instance is locked due to pending transfer',
    [ErrorCode.TRANSFER_INSUFFICIENT_BALANCE]: 'Insufficient balance for transfer fee',
    [ErrorCode.TRANSFER_HOST_DISABLED]: 'Transfer is disabled for this host',
    [ErrorCode.INVALID_PARAMS]: 'Invalid parameters',

    // Friend system errors
    [ErrorCode.CANNOT_ADD_SELF]: 'Cannot add yourself as a friend',
    [ErrorCode.ALREADY_FRIENDS]: 'You are already friends with this user',
    [ErrorCode.FRIEND_REQUEST_PENDING]: 'A friend request is already pending',
    [ErrorCode.FRIEND_REQUEST_NOT_FOUND]: 'Friend request not found',
    [ErrorCode.FRIEND_REQUEST_NOT_PENDING]: 'Friend request is not in pending status',
    [ErrorCode.FRIENDSHIP_NOT_FOUND]: 'Friendship not found',
    [ErrorCode.NOT_FRIENDS]: 'You are not friends with this user',
    [ErrorCode.TARGET_FRIEND_QUOTA_FULL]: 'Target user friend quota is full',

    // Package share errors
    [ErrorCode.CANNOT_SHARE_TO_SELF]: 'Cannot share package to yourself',
    [ErrorCode.PACKAGE_ALREADY_SHARED]: 'Package is already shared to this user',
    [ErrorCode.SHARE_NOT_FOUND]: 'Share record not found',
    [ErrorCode.SHARE_QUOTA_CPU_EXCEEDED]: 'Shared package CPU quota exceeded',
    [ErrorCode.SHARE_QUOTA_MEMORY_EXCEEDED]: 'Shared package memory quota exceeded',
    [ErrorCode.SHARE_QUOTA_INSTANCES_EXCEEDED]: 'Shared package instance limit exceeded',

    // Email verification errors
    [ErrorCode.EMAIL_VERIFICATION_DISABLED]: 'Email verification is not enabled',
    [ErrorCode.EMAIL_CODE_REQUIRED]: 'Email verification code is required',
    [ErrorCode.INVALID_EMAIL_CODE]: 'Invalid or expired verification code',
    [ErrorCode.TOO_MANY_VERIFICATION_REQUESTS]: 'Too many verification requests, please try again later',
    [ErrorCode.EMAIL_SEND_FAILED]: 'Failed to send verification email',
    [ErrorCode.EMAIL_ALREADY_REGISTERED]: 'Email address is already registered',
    [ErrorCode.EMAIL_DOMAIN_NOT_ALLOWED]: 'This email domain is not allowed for registration',

    // Inbox errors
    [ErrorCode.MESSAGE_NOT_FOUND]: 'Message not found',

    // Checkin errors
    [ErrorCode.CHECKIN_NO_INSTANCE]: 'You need at least one instance to check in',
    [ErrorCode.CHECKIN_ALREADY_TODAY]: 'You have already checked in today',
    [ErrorCode.REDEEM_ALREADY_TODAY]: 'You have already redeemed a code today',
    [ErrorCode.REDEEM_CODE_NOT_FOUND]: 'Redeem code not found',
    [ErrorCode.REDEEM_CODE_USED]: 'Redeem code has already been used',
    [ErrorCode.REDEEM_CODE_EXPIRED]: 'Redeem code has expired',
    [ErrorCode.REDEEM_CODE_SELF_ONLY]: 'This redeem code can only be used by its owner',
    [ErrorCode.REDEEM_CODE_DISABLED]: 'This redeem code has been disabled',
    [ErrorCode.REDEEM_CODE_INVALID_FORMAT]: 'Invalid code format, only h- prefix codes are supported',
    [ErrorCode.REDEEM_CODE_EXHAUSTED]: 'This redeem code has reached its maximum usage limit',
    [ErrorCode.REDEEM_CODE_ALREADY_USED_BY_USER]: 'You have already used this redeem code',
    [ErrorCode.REDEEM_CODE_HOST_MISMATCH]: 'This redeem code can only be used on instances from the same host',
    [ErrorCode.REDEEM_CODE_BATCH_LIMIT]: 'You have already used a redeem code from this batch',
    [ErrorCode.REDEEM_EXCEEDS_PACKAGE_QUOTA]: 'Redeeming would exceed instance package quota',
    [ErrorCode.REDEEM_ALREADY_AT_LIMIT]: 'Instance resource is already at package limit',
    [ErrorCode.CHECKIN_CODE_PAID_INSTANCE]: 'Check-in redeem codes can only be used on free instances',

    // Resource Pool errors
    [ErrorCode.RESOURCE_POOL_INSUFFICIENT]: 'Insufficient resource pool balance',
    [ErrorCode.RESOURCE_POOL_KVM_CPU_MULTIPLE]: 'KVM instance CPU must be a multiple of 100',
    [ErrorCode.RESOURCE_POOL_KVM_MEMORY_MULTIPLE]: 'KVM instance memory must be a multiple of 128MB',
    [ErrorCode.RESOURCE_POOL_KVM_DISK_MULTIPLE]: 'KVM instance disk must be a multiple of 1GB (1024MB)',
    [ErrorCode.RESOURCE_POOL_VM_MUST_STOP]: 'KVM instance must be stopped to adjust memory or disk',
    [ErrorCode.RESOURCE_POOL_SYSTEM_CODE_REQUIRES_INSTANCE]: 'System redeem code requires an instance to be specified',

    // Internal errors
    [ErrorCode.INTERNAL_ERROR]: 'Internal server error',

    // Mail module errors
    [ErrorCode.VALIDATION_ERROR]: 'Validation error',
    [ErrorCode.OPERATION_NOT_ALLOWED]: 'Operation not allowed',
    [ErrorCode.RESOURCE_EXISTS]: 'Resource already exists',
    [ErrorCode.UPSTREAM_ERROR]: 'Upstream service error',
    [ErrorCode.INSUFFICIENT_BALANCE]: 'Insufficient balance',
}

/**
 * Create API error response with code and message
 */
export function apiError(code: ErrorCodeType, details?: string) {
    return {
        error: ErrorMessages[code],
        code,
        details
    }
}
