import { defineConfig } from 'vitepress'

const zhNav = [
  { text: '首页', link: '/' },
  { text: '文档', link: '/guide/introduction' },
  { text: '开发', link: '/plugins/overview' },
  { text: '扩展市场', link: '/plugins/market' },
  { text: 'API', link: '/api/overview' },
  {
    text: '关于',
    items: [
      { text: '在线 Demo', link: '/demo' },
      { text: '版本日志', link: '/release/version-log' },
      { text: 'Telegram 交流群', link: 'https://t.me/Payincus' },
      { text: 'GitHub', link: 'https://github.com/VipMaxxxx/payincus' }
    ]
  }
]

const enNav = [
  { text: 'Home', link: '/en/' },
  { text: 'Docs', link: '/en/guide/introduction' },
  { text: 'Development', link: '/en/plugins/overview' },
  { text: 'Extension Market', link: '/en/plugins/market' },
  { text: 'API', link: '/en/api/overview' },
  {
    text: 'About',
    items: [
      { text: 'Demo', link: '/en/demo' },
      { text: 'Version Log', link: '/en/release/version-log' },
      { text: 'Telegram Group', link: 'https://t.me/Payincus' },
      { text: 'GitHub', link: 'https://github.com/VipMaxxxx/payincus' }
    ]
  }
]

const zhSidebar = [
  {
    text: '指南',
    items: [
      { text: '项目介绍', link: '/guide/introduction' },
      { text: '在线 Demo', link: '/demo' },
      { text: '系统架构', link: '/guide/architecture' },
      { text: '文档覆盖能力', link: '/guide/documentation-coverage' },
      { text: '前后台分离', link: '/guide/split-deployment' },
      { text: '权限边界', link: '/guide/admin-user-boundary' },
      { text: '后台 OTA', link: '/guide/ota-update' }
    ]
  },
  {
    text: '部署',
    items: [
      { text: '一键安装', link: '/deployment/one-click-install' },
      { text: '手动部署', link: '/deployment/manual-install' },
      { text: 'Nginx 分离部署', link: '/deployment/nginx' },
      { text: 'systemd 服务', link: '/deployment/systemd' },
      { text: '环境变量', link: '/deployment/environment' },
      { text: '生产验收', link: '/deployment/production-checklist' }
    ]
  },
  {
    text: '功能',
    items: [
      { text: '用户端功能', link: '/user/dashboard' },
      { text: '管理后台功能', link: '/admin/overview' },
      { text: '实例与资源交付', link: '/features/instances' },
      { text: '支付与账务', link: '/features/billing' },
      { text: '通知、工单与帮助', link: '/features/communication' },
      { text: '托管与资源池', link: '/features/resource-hosting' },
      { text: '资源风控', link: '/features/resource-risk' },
      { text: 'Agent', link: '/agent/install' },
      { text: 'API 概览', link: '/api/overview' }
    ]
  },
  {
    text: '扩展开发',
    items: [
      { text: '扩展中心', link: '/plugins/overview' },
      { text: '扩展中心方案', link: '/plugins/platform-plan' },
      { text: '扩展市场', link: '/plugins/market' },
      { text: '开发指南', link: '/plugins/development' },
      { text: 'Public API SDK', link: '/plugins/sdk' },
      { text: 'Manifest', link: '/plugins/manifest' },
      { text: '客户端扩展点', link: '/plugins/client-extensions' },
      { text: '扩展模板', link: '/plugins/templates' }
    ]
  },
  {
    text: '发布与排障',
    items: [
      { text: '发布说明', link: '/release/changelog' },
      { text: '系统版本更新日志', link: '/release/version-log' },
      { text: '常见问题', link: '/troubleshooting/common-errors' }
    ]
  }
]

const zhDevelopmentSidebar = [
  {
    text: '扩展中心',
    items: [
      { text: '扩展总览', link: '/plugins/overview' },
      { text: '扩展配置', link: '/plugins/development#配置' },
      { text: '事件列表', link: '/plugins/development#业务事件' },
      { text: 'Manifest', link: '/plugins/manifest' },
      { text: '扩展市场', link: '/plugins/market' },
      { text: 'SDK', link: '/plugins/sdk' }
    ]
  },
  {
    text: '扩展类型',
    items: [
      { text: '服务扩展', link: '/plugins/development#服务扩展类型' },
      { text: '支付网关扩展', link: '/plugins/development#支付网关扩展类型' },
      { text: 'Webhook Action', link: '/plugins/development#webhook-action-runtime' },
      { text: '扩展存储', link: '/plugins/development#扩展-kv-存储' }
    ]
  },
  {
    text: '主题系统',
    items: [
      { text: '创建主题', link: '/plugins/development#主题开发标准' },
      { text: 'Theme Manifest', link: '/plugins/manifest#主题-manifest' },
      { text: '主题模板', link: '/plugins/templates#主题模板' }
    ]
  },
  {
    text: 'OAuth',
    items: [
      { text: 'OAuth Provider', link: '/plugins/development#oauth-provider' },
      { text: 'API 参考', link: '/api/overview' },
      { text: '公共 API SDK', link: '/plugins/sdk' }
    ]
  }
]

const zhApiSidebar = [
  {
    text: '介绍',
    items: [
      { text: 'API 参考', link: '/api/overview' },
      { text: '鉴权', link: '/api/overview#鉴权' },
      { text: '通用规则', link: '/api/overview#通用规则' }
    ]
  },
  {
    text: '用户资料',
    items: [
      { text: 'GET 当前用户', link: '/api/overview#get-api-v1-me' },
      { text: 'PATCH 当前用户', link: '/api/overview#patch-api-v1-me' }
    ]
  },
  {
    text: '余额',
    items: [
      { text: 'GET 余额', link: '/api/overview#get-api-v1-balance' },
      { text: 'GET 余额流水', link: '/api/overview#get-api-v1-balance-logs' },
      { text: 'GET 调整申请', link: '/api/overview#get-api-v1-balance-adjustment-requests' },
      { text: 'POST 调整申请', link: '/api/overview#post-api-v1-balance-adjustment-requests' }
    ]
  },
  {
    text: '产品',
    items: [
      { text: 'GET 产品列表', link: '/api/overview#get-api-v1-products' },
      { text: 'GET 产品详情', link: '/api/overview#get-api-v1-products-id' }
    ]
  },
  {
    text: '服务',
    items: [
      { text: 'GET 服务列表', link: '/api/overview#get-api-v1-services' },
      { text: 'GET 服务详情', link: '/api/overview#get-api-v1-services-id' },
      { text: 'POST 服务动作', link: '/api/overview#post-api-v1-services-id-actions' },
      { text: 'POST 服务续费', link: '/api/overview#post-api-v1-services-id-renew' },
      { text: 'GET 服务任务', link: '/api/overview#get-api-v1-services-id-tasks-taskid' },
      { text: 'DELETE 服务任务', link: '/api/overview#delete-api-v1-services-id-tasks-taskid' }
    ]
  },
  {
    text: '订单与账单',
    items: [
      { text: 'GET 订单列表', link: '/api/overview#get-api-v1-orders' },
      { text: 'GET 订单详情', link: '/api/overview#get-api-v1-orders-id' },
      { text: 'GET 账单列表', link: '/api/overview#get-api-v1-billing-records' },
      { text: 'GET 账单详情', link: '/api/overview#get-api-v1-billing-records-id' }
    ]
  },
  {
    text: '工单',
    items: [
      { text: 'GET 工单列表', link: '/api/overview#get-api-v1-tickets' },
      { text: 'POST 创建工单', link: '/api/overview#post-api-v1-tickets' },
      { text: 'GET 工单详情', link: '/api/overview#get-api-v1-tickets-id' },
      { text: 'POST 工单回复', link: '/api/overview#post-api-v1-tickets-id-replies' },
      { text: 'PATCH 工单状态', link: '/api/overview#patch-api-v1-tickets-id-status' }
    ]
  },
  {
    text: '通知',
    items: [
      { text: 'GET 通知列表', link: '/api/overview#get-api-v1-notifications' },
      { text: 'POST 发送通知', link: '/api/overview#post-api-v1-notifications' },
      { text: 'GET 未读数量', link: '/api/overview#get-api-v1-notifications-unread-count' }
    ]
  },
  {
    text: '扩展 Action',
    items: [
      { text: 'GET 扩展列表', link: '/api/overview#get-api-v1-plugins' },
      { text: 'GET Action 列表', link: '/api/overview#get-api-v1-plugins-pluginid-actions' },
      { text: 'POST 执行 Action', link: '/api/overview#post-api-v1-plugins-pluginid-actions-action' }
    ]
  },
  {
    text: 'OAuth',
    items: [
      { text: 'GET Scope 列表', link: '/api/overview#get-api-oauth-provider-scopes' },
      { text: 'POST 换取 Token', link: '/api/overview#post-api-oauth-provider-token' },
      { text: 'GET 授权列表', link: '/api/overview#get-api-oauth-provider-authorizations' },
      { text: 'DELETE 撤销授权', link: '/api/overview#delete-api-oauth-provider-authorizations-id' }
    ]
  }
]

const enSidebar = [
  {
    text: 'Guide',
    items: [
      { text: 'Introduction', link: '/en/guide/introduction' },
      { text: 'Online Demo', link: '/en/demo' },
      { text: 'Architecture', link: '/en/guide/architecture' },
      { text: 'Documentation Coverage', link: '/en/guide/documentation-coverage' },
      { text: 'Split Deployment', link: '/en/guide/split-deployment' },
      { text: 'Access Boundaries', link: '/en/guide/admin-user-boundary' },
      { text: 'Admin OTA', link: '/en/guide/ota-update' }
    ]
  },
  {
    text: 'Deployment',
    items: [
      { text: 'One-click Install', link: '/en/deployment/one-click-install' },
      { text: 'Manual Install', link: '/en/deployment/manual-install' },
      { text: 'Nginx Split Deployment', link: '/en/deployment/nginx' },
      { text: 'systemd Service', link: '/en/deployment/systemd' },
      { text: 'Environment Variables', link: '/en/deployment/environment' },
      { text: 'Production Checklist', link: '/en/deployment/production-checklist' }
    ]
  },
  {
    text: 'Features',
    items: [
      { text: 'User Portal', link: '/en/user/dashboard' },
      { text: 'Admin Console', link: '/en/admin/overview' },
      { text: 'Instances and Delivery', link: '/en/features/instances' },
      { text: 'Billing and Payments', link: '/en/features/billing' },
      { text: 'Communication', link: '/en/features/communication' },
      { text: 'Hosting and Resource Pools', link: '/en/features/resource-hosting' },
      { text: 'Resource Risk Control', link: '/en/features/resource-risk' },
      { text: 'Agent', link: '/en/agent/install' },
      { text: 'API Overview', link: '/en/api/overview' }
    ]
  },
  {
    text: 'Extension Development',
    items: [
      { text: 'Extension Center', link: '/en/plugins/overview' },
      { text: 'Extension Platform Plan', link: '/en/plugins/platform-plan' },
      { text: 'Marketplace', link: '/en/plugins/market' },
      { text: 'Development Guide', link: '/en/plugins/development' },
      { text: 'Public API SDK', link: '/en/plugins/sdk' },
      { text: 'Manifest', link: '/en/plugins/manifest' },
      { text: 'Client Extensions', link: '/en/plugins/client-extensions' },
      { text: 'Extension Templates', link: '/en/plugins/templates' }
    ]
  },
  {
    text: 'Release and Troubleshooting',
    items: [
      { text: 'Release Notes', link: '/en/release/changelog' },
      { text: 'System Version Log', link: '/en/release/version-log' },
      { text: 'Common Issues', link: '/en/troubleshooting/common-errors' }
    ]
  }
]

const enDevelopmentSidebar = [
  {
    text: 'Extensions',
    items: [
      { text: 'Extensions', link: '/en/plugins/overview' },
      { text: 'Configuration', link: '/en/plugins/development#configuration' },
      { text: 'Event list', link: '/en/plugins/development#business-events' },
      { text: 'Manifest', link: '/en/plugins/manifest' },
      { text: 'Marketplace', link: '/en/plugins/market' },
      { text: 'SDK', link: '/en/plugins/sdk' }
    ]
  },
  {
    text: 'Types of Extensions',
    items: [
      { text: 'Server Extension', link: '/en/plugins/development#service-extension-types' },
      { text: 'Gateway Extension', link: '/en/plugins/development#gateway-extension-types' },
      { text: 'Webhook Action', link: '/en/plugins/development#webhook-action-runtime' },
      { text: 'Storage', link: '/en/plugins/development#extension-kv-storage' }
    ]
  },
  {
    text: 'Themes',
    items: [
      { text: 'Create a Theme', link: '/en/plugins/development#theme-development-standard' },
      { text: 'Theme Manifest', link: '/en/plugins/manifest#theme-manifest' },
      { text: 'Theme Templates', link: '/en/plugins/templates' }
    ]
  },
  {
    text: 'OAuth',
    items: [
      { text: 'OAuth Provider', link: '/en/plugins/development#oauth-provider' },
      { text: 'API Reference', link: '/en/api/overview' },
      { text: 'Public API SDK', link: '/en/plugins/sdk' }
    ]
  }
]

const enApiSidebar = [
  {
    text: 'API Reference',
    items: [
      { text: 'Introduction', link: '/en/api/overview' },
      { text: 'Authentication', link: '/en/api/overview#authentication' },
      { text: 'Common Rules', link: '/en/api/overview#common-rules' }
    ]
  },
  {
    text: 'Profile',
    items: [
      { text: 'GET Current User', link: '/en/api/overview#get-api-v1-me' },
      { text: 'PATCH Current User', link: '/en/api/overview#patch-api-v1-me' }
    ]
  },
  {
    text: 'Balance',
    items: [
      { text: 'GET Balance', link: '/en/api/overview#get-api-v1-balance' },
      { text: 'GET Balance Logs', link: '/en/api/overview#get-api-v1-balance-logs' },
      { text: 'GET Adjustment Requests', link: '/en/api/overview#get-api-v1-balance-adjustment-requests' },
      { text: 'POST Adjustment Request', link: '/en/api/overview#post-api-v1-balance-adjustment-requests' }
    ]
  },
  {
    text: 'Products',
    items: [
      { text: 'GET Products', link: '/en/api/overview#get-api-v1-products' },
      { text: 'GET Product', link: '/en/api/overview#get-api-v1-products-id' }
    ]
  },
  {
    text: 'Services',
    items: [
      { text: 'GET Services', link: '/en/api/overview#get-api-v1-services' },
      { text: 'GET Service', link: '/en/api/overview#get-api-v1-services-id' },
      { text: 'POST Service Action', link: '/en/api/overview#post-api-v1-services-id-actions' },
      { text: 'POST Service Renew', link: '/en/api/overview#post-api-v1-services-id-renew' },
      { text: 'GET Service Task', link: '/en/api/overview#get-api-v1-services-id-tasks-taskid' },
      { text: 'DELETE Service Task', link: '/en/api/overview#delete-api-v1-services-id-tasks-taskid' }
    ]
  },
  {
    text: 'Orders and Billing',
    items: [
      { text: 'GET Orders', link: '/en/api/overview#get-api-v1-orders' },
      { text: 'GET Order', link: '/en/api/overview#get-api-v1-orders-id' },
      { text: 'GET Billing Records', link: '/en/api/overview#get-api-v1-billing-records' },
      { text: 'GET Billing Record', link: '/en/api/overview#get-api-v1-billing-records-id' }
    ]
  },
  {
    text: 'Tickets',
    items: [
      { text: 'GET Tickets', link: '/en/api/overview#get-api-v1-tickets' },
      { text: 'POST Ticket', link: '/en/api/overview#post-api-v1-tickets' },
      { text: 'GET Ticket', link: '/en/api/overview#get-api-v1-tickets-id' },
      { text: 'POST Ticket Reply', link: '/en/api/overview#post-api-v1-tickets-id-replies' },
      { text: 'PATCH Ticket Status', link: '/en/api/overview#patch-api-v1-tickets-id-status' }
    ]
  },
  {
    text: 'Notifications',
    items: [
      { text: 'GET Notifications', link: '/en/api/overview#get-api-v1-notifications' },
      { text: 'POST Notification', link: '/en/api/overview#post-api-v1-notifications' },
      { text: 'GET Unread Count', link: '/en/api/overview#get-api-v1-notifications-unread-count' }
    ]
  },
  {
    text: 'Plugin Actions',
    items: [
      { text: 'GET Plugins', link: '/en/api/overview#get-api-v1-plugins' },
      { text: 'GET Actions', link: '/en/api/overview#get-api-v1-plugins-pluginid-actions' },
      { text: 'POST Dispatch Action', link: '/en/api/overview#post-api-v1-plugins-pluginid-actions-action' }
    ]
  },
  {
    text: 'OAuth',
    items: [
      { text: 'GET Scopes', link: '/en/api/overview#get-api-oauth-provider-scopes' },
      { text: 'POST Token', link: '/en/api/overview#post-api-oauth-provider-token' },
      { text: 'GET Authorizations', link: '/en/api/overview#get-api-oauth-provider-authorizations' },
      { text: 'DELETE Authorization', link: '/en/api/overview#delete-api-oauth-provider-authorizations-id' }
    ]
  }
]

export default defineConfig({
  title: 'PayIncus',
  description: 'PayIncus 用户端、管理后台、Incus 交付、Agent 和 OTA 文档',
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  head: [
    ['link', { rel: 'icon', href: '/incudal_logo.webp' }],
    ['meta', { name: 'theme-color', content: '#111827' }]
  ],
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'PayIncus',
      description: 'PayIncus 用户端、管理后台、Incus 交付、Agent 和 OTA 文档',
      themeConfig: {
        nav: zhNav,
        editLink: {
          pattern: 'https://github.com/VipMaxxxx/payincus/edit/main/docs-site/docs/:path',
          text: '在 GitHub 上编辑此页'
        },
        lastUpdated: {
          text: '最后更新'
        },
        docFooter: {
          prev: '上一页',
          next: '下一页'
        },
        outline: {
          label: '本页目录',
          level: [2, 3]
        },
        sidebar: {
          '/plugins/': zhDevelopmentSidebar,
          '/api/': zhApiSidebar,
          '/': zhSidebar
        }
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      title: 'PayIncus',
      description: 'PayIncus documentation for user portal, admin console, Incus delivery, Agent reporting, payments and OTA updates',
      themeConfig: {
        nav: enNav,
        editLink: {
          pattern: 'https://github.com/VipMaxxxx/payincus/edit/main/docs-site/docs/:path',
          text: 'Edit this page on GitHub'
        },
        lastUpdated: {
          text: 'Last updated'
        },
        docFooter: {
          prev: 'Previous page',
          next: 'Next page'
        },
        outline: {
          label: 'On this page',
          level: [2, 3]
        },
        sidebar: {
          '/en/plugins/': enDevelopmentSidebar,
          '/en/api/': enApiSidebar,
          '/en/': enSidebar
        }
      }
    }
  },
  themeConfig: {
    logo: '/incudal_logo.webp',
    siteTitle: 'PayIncus',
    search: {
      provider: 'local'
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/VipMaxxxx/payincus' }
    ],
    footer: {
      message: 'PayIncus documentation',
      copyright: 'Copyright © 2026 PayIncus'
    }
  }
})
