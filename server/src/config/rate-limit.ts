/**
 * 速率限制配置
 * 
 * 配置说明:
 * - max: 时间窗口内最大请求数
 * - timeWindow: 时间窗口 (支持 '1 minute', '1 hour', '1 second' 等)
 * - description: 接口说明 (仅用于文档)
 * 
 * 调整建议:
 * - 登录/注册: 较严格，防止暴力破解
 * - 读取操作: 可以适当放宽
 * - 写入操作: 适中限制
 * - 敏感操作: 严格限制
 */

export interface RateLimitRule {
    /** 路由路径 (支持通配符) */
    path: string
    /** HTTP 方法 */
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | '*'
    /** 时间窗口内最大请求数 */
    max: number
    /** 时间窗口 */
    timeWindow: string
    /** 接口说明 */
    description: string
}

// ==================== 全局默认配置 ====================

export const globalRateLimit = {
    /** 全局默认: 每分钟最大请求数 */
    max: 300,
    /** 全局默认: 时间窗口 */
    timeWindow: '1 minute',
    /** 描述 */
    description: '全局默认限制'
}

// ==================== 接口级别配置 ====================

export const rateLimitRules: RateLimitRule[] = [
    // ========== 认证相关 (严格限制) ==========
    {
        path: '/api/auth/check-2fa',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '检查2FA状态 - 防止用户名枚举'
    },
    {
        path: '/api/auth/login',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '登录接口 - 防止暴力破解'
    },
    {
        path: '/api/auth/register',
        method: 'POST',
        max: 3,
        timeWindow: '1 minute',
        description: '注册接口 - 防止批量注册'
    },
    {
        path: '/api/auth/refresh',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '刷新令牌 - 适中限制'
    },
    {
        path: '/api/auth/2fa/*',
        method: '*',
        max: 10,
        timeWindow: '1 minute',
        description: '2FA 相关操作'
    },
    {
        path: '/api/auth/forgot-password/send-code',
        method: 'POST',
        max: 5,
        timeWindow: '1 hour',
        description: '发送找回密码验证码 - 防止滥用'
    },
    {
        path: '/api/auth/forgot-password/reset',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '重置密码 - 防止暴力破解验证码'
    },

    // ========== 实例操作 (适中限制) ==========
    {
        path: '/api/instances',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '创建实例 - 防止滥用资源'
    },
    {
        path: '/api/instances',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取实例列表'
    },
    {
        path: '/api/instances/*/start',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '启动实例'
    },
    {
        path: '/api/instances/*/stop',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '停止实例'
    },
    {
        path: '/api/instances/*/restart',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '重启实例'
    },
    {
        path: '/api/instances/*/reinstall',
        method: 'POST',
        max: 2,
        timeWindow: '5 minutes',
        description: '重装实例 - 严格限制'
    },

    // ========== 快照/备份 (严格限制) ==========
    {
        path: '/api/instances/*/snapshots',
        method: 'POST',
        max: 5,
        timeWindow: '5 minutes',
        description: '创建快照 - 资源密集操作'
    },
    {
        path: '/api/instances/*/snapshots',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取快照列表'
    },
    {
        path: '/api/instances/*/backups',
        method: 'POST',
        max: 3,
        timeWindow: '10 minutes',
        description: '创建备份 - 资源密集操作'
    },
    {
        path: '/api/instances/*/backups',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取备份列表'
    },
    {
        path: '/api/instances/*/backups/*/export',
        method: 'POST',
        max: 5,
        timeWindow: '10 minutes',
        description: '创建备份导出任务 - 资源密集操作'
    },
    {
        path: '/api/instances/*/backups/export/*/download-token',
        method: 'POST',
        max: 10,
        timeWindow: '10 minutes',
        description: '获取备份下载令牌'
    },
    {
        path: '/api/instances/*/backups/export/*/download',
        method: 'GET',
        max: 5,
        timeWindow: '10 minutes',
        description: '下载备份 - 带宽密集操作'
    },

    // ========== 端口映射 ==========
    {
        path: '/api/instances/*/ports',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '添加端口映射'
    },
    {
        path: '/api/instances/*/ports',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取端口映射列表'
    },

    // ========== 反代站点 ==========
    {
        path: '/api/instances/*/sites',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取站点列表'
    },
    {
        path: '/api/instances/*/sites',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '添加反代站点'
    },
    {
        path: '/api/instances/*/sites/*',
        method: 'DELETE',
        max: 10,
        timeWindow: '1 minute',
        description: '删除反代站点'
    },
    {
        path: '/api/instances/*/sites/*/refresh',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '刷新站点配置'
    },

    // ========== 用户管理 ==========
    {
        path: '/api/users',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取用户列表 (管理员)'
    },
    {
        path: '/api/users/*',
        method: 'PATCH',
        max: 10,
        timeWindow: '1 minute',
        description: '更新用户信息'
    },
    {
        path: '/api/users/*/change-email/send-code',
        method: 'POST',
        max: 5,
        timeWindow: '10 minutes',
        description: '发送修改邮箱验证码'
    },

    // ========== 主机/节点管理 (管理员) ==========
    {
        path: '/api/hosts',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取主机列表'
    },
    {
        path: '/api/hosts',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '添加主机'
    },
    {
        path: '/api/node-groups',
        method: '*',
        max: 30,
        timeWindow: '1 minute',
        description: '节点组管理'
    },

    // ========== 套餐管理 ==========
    {
        path: '/api/packages',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取套餐列表'
    },
    {
        path: '/api/packages',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '创建套餐 (管理员)'
    },
    {
        path: '/api/packages/*/hosts-detail',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取套餐宿主机详情'
    },
    {
        path: '/api/packages/*/release-channel',
        method: 'PUT',
        max: 10,
        timeWindow: '1 minute',
        description: '设置释放通知渠道'
    },
    {
        path: '/api/packages/*/release-quota',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '释放配额 - 敏感操作'
    },

    // ========== SSH 密钥 ==========
    {
        path: '/api/ssh-keys',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取 SSH 密钥列表'
    },
    {
        path: '/api/ssh-keys',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '添加 SSH 密钥'
    },
    {
        path: '/api/ssh-keys/generate',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '生成 SSH 密钥对 - CPU密集操作'
    },

    // ========== 通知 ==========
    {
        path: '/api/notifications',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取通知列表'
    },
    {
        path: '/api/notifications/channels',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '添加通知渠道'
    },

    // ========== 站内信 ==========
    {
        path: '/api/inbox',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取站内信列表'
    },
    {
        path: '/api/inbox/unread-count',
        method: 'GET',
        max: 120,
        timeWindow: '1 minute',
        description: '获取未读数量 - 轮询场景'
    },
    {
        path: '/api/inbox/*/read',
        method: 'POST',
        max: 60,
        timeWindow: '1 minute',
        description: '标记消息已读'
    },
    {
        path: '/api/inbox/read-all',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '全部标记已读'
    },
    {
        path: '/api/inbox/*',
        method: 'DELETE',
        max: 30,
        timeWindow: '1 minute',
        description: '删除消息'
    },
    {
        path: '/api/inbox/read',
        method: 'DELETE',
        max: 10,
        timeWindow: '1 minute',
        description: '清空已读消息'
    },
    {
        path: '/api/inbox/admin/send/*',
        method: 'POST',
        max: 20,
        timeWindow: '1 minute',
        description: '管理员发送站内信给特定用户'
    },
    {
        path: '/api/inbox/admin/broadcast',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '管理员全站广播'
    },
    {
        path: '/api/inbox/instances/*/notify',
        method: 'POST',
        max: 30,
        timeWindow: '1 minute',
        description: '宿主机所有者发送站内信给实例用户'
    },
    {
        path: '/api/inbox/hosts/*/notify',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '宿主机所有者通知节点实例用户'
    },

    // ========== 镜像 ==========
    {
        path: '/api/images',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取镜像列表'
    },
    {
        path: '/api/images/sync',
        method: 'POST',
        max: 2,
        timeWindow: '5 minutes',
        description: '同步镜像 - 资源密集操作'
    },

    // ========== 日志 ==========
    {
        path: '/api/logs',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取日志列表'
    },

    // ========== 帮助文档 ==========
    {
        path: '/api/help',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取帮助文档'
    },

    // ========== OAuth ==========
    {
        path: '/api/oauth/*',
        method: '*',
        max: 10,
        timeWindow: '1 minute',
        description: 'OAuth 认证'
    },

    // ========== 邀请码 ==========
    {
        path: '/api/auth/invite',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '生成邀请码 (管理员)'
    },
    {
        path: '/api/auth/invites',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取邀请码列表'
    },
    {
        path: '/api/auth/user/invite',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '生成邀请码 (用户)'
    },
    {
        path: '/api/auth/user/invites',
        method: 'GET',
        max: 30,
        timeWindow: '1 minute',
        description: '获取用户邀请码列表'
    },
    {
        path: '/api/auth/user/invites/*',
        method: 'DELETE',
        max: 20,
        timeWindow: '1 minute',
        description: '删除用户邀请码'
    },

    // ========== 工单系统 ==========
    {
        path: '/api/tickets',
        method: 'POST',
        max: 5,
        timeWindow: '1 minute',
        description: '创建工单 - 防止滥发'
    },

    // ========== 自定义初始化命令 ==========
    {
        path: '/api/init-commands',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取初始化命令列表'
    },
    {
        path: '/api/init-commands/available',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取可用初始化命令列表'
    },
    {
        path: '/api/init-commands/distros',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取发行版列表'
    },
    {
        path: '/api/init-commands',
        method: 'POST',
        max: 10,
        timeWindow: '1 minute',
        description: '创建初始化命令 - 防止滥用'
    },
    {
        path: '/api/init-commands/*',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取单个初始化命令详情'
    },
    {
        path: '/api/init-commands/*',
        method: 'PUT',
        max: 20,
        timeWindow: '1 minute',
        description: '更新初始化命令'
    },
    {
        path: '/api/init-commands/*',
        method: 'DELETE',
        max: 20,
        timeWindow: '1 minute',
        description: '删除初始化命令'
    },
    {
        path: '/api/tickets',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取工单列表'
    },
    {
        path: '/api/tickets/pending-count',
        method: 'GET',
        max: 120,
        timeWindow: '1 minute',
        description: '获取待处理工单数量 - 轮询场景'
    },
    {
        path: '/api/tickets/my-hosts',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取我的宿主机工单列表'
    },
    {
        path: '/api/tickets/hosts/*',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取指定宿主机工单列表'
    },
    {
        path: '/api/tickets/attachments/*/content',
        method: 'GET',
        max: 240,
        timeWindow: '1 minute',
        description: '读取工单图片内容'
    },
    {
        path: '/api/tickets/*',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取工单详情'
    },
    {
        path: '/api/tickets/*/messages',
        method: 'GET',
        max: 60,
        timeWindow: '1 minute',
        description: '获取工单消息列表'
    },
    {
        path: '/api/tickets/*/messages',
        method: 'POST',
        max: 20,
        timeWindow: '1 minute',
        description: '回复工单 - 防止刷屏'
    },
    {
        path: '/api/tickets/*/status',
        method: 'PATCH',
        max: 20,
        timeWindow: '1 minute',
        description: '更新工单状态'
    },
    {
        path: '/api/tickets/*/close',
        method: 'POST',
        max: 20,
        timeWindow: '1 minute',
        description: '关闭工单'
    }
]

// ==================== 白名单配置 ====================

export const rateLimitWhitelist = {
    /** 跳过速率限制的路径前缀 */
    pathPrefixes: [
        '/api/ws/instances/*/terminal'  // WebSocket 终端
    ],
    /** 跳过速率限制的完整路径 */
    exactPaths: [
        '/api/health'  // 健康检查
    ]
}

// ==================== 辅助函数 ====================

/**
 * 根据请求路径和方法查找匹配的速率限制规则
 */
export function findRateLimitRule(path: string, method: string): RateLimitRule | null {
    for (const rule of rateLimitRules) {
        // 检查方法匹配
        if (rule.method !== '*' && rule.method !== method) {
            continue
        }

        // 检查路径匹配 (支持 * 通配符)
        const pattern = rule.path
            .replace(/\*/g, '[^/]+')  // * 匹配单个路径段
            .replace(/\//g, '\\/')    // 转义斜杠

        const regex = new RegExp(`^${pattern}$`)
        if (regex.test(path)) {
            return rule
        }
    }
    return null
}

/**
 * 检查路径是否在白名单中
 */
export function isWhitelisted(path: string): boolean {
    // 检查完整路径
    if (rateLimitWhitelist.exactPaths.includes(path)) {
        return true
    }

    // 检查前缀匹配
    for (const prefix of rateLimitWhitelist.pathPrefixes) {
        const pattern = prefix
            .replace(/\*/g, '[^/]+')
            .replace(/\//g, '\\/')

        const regex = new RegExp(`^${pattern}`)
        if (regex.test(path)) {
            return true
        }
    }

    return false
}

/**
 * 打印速率限制配置摘要
 */
export function printRateLimitSummary(): void {
    console.log('\n📊 速率限制配置:')
    console.log(`   全局默认: ${globalRateLimit.max} 次/${globalRateLimit.timeWindow}`)
    console.log(`   自定义规则: ${rateLimitRules.length} 条`)
    console.log(`   白名单路径: ${rateLimitWhitelist.exactPaths.length + rateLimitWhitelist.pathPrefixes.length} 条\n`)
}
