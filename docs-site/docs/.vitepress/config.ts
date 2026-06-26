import { defineConfig } from 'vitepress'

const zhNav = [
  { text: '首页', link: '/' },
  { text: '文档', link: '/guide/introduction' },
  { text: '开发', link: '/plugins/overview' },
  { text: '市场', link: '/plugins/market' },
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
  { text: 'Marketplace', link: '/en/plugins/market' },
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
    text: 'Extensions',
    items: [
      { text: 'Extensions', link: '/plugins/overview' },
      { text: 'Configuration', link: '/plugins/development#配置' },
      { text: 'Event list', link: '/plugins/development#业务事件' },
      { text: 'Manifest', link: '/plugins/manifest' },
      { text: 'Marketplace', link: '/plugins/market' },
      { text: 'SDK', link: '/plugins/sdk' }
    ]
  },
  {
    text: 'Types of Extensions',
    items: [
      { text: 'Server Extension', link: '/plugins/development#服务扩展类型' },
      { text: 'Gateway Extension', link: '/plugins/development#支付网关扩展类型' },
      { text: 'Webhook Action', link: '/plugins/development#webhook-action-runtime' },
      { text: 'Storage', link: '/plugins/development#扩展-kv-存储' }
    ]
  },
  {
    text: 'Themes',
    items: [
      { text: 'Create a Theme', link: '/plugins/development#主题开发标准' },
      { text: 'Theme Manifest', link: '/plugins/manifest#主题-manifest' },
      { text: 'Theme Templates', link: '/plugins/templates#主题模板' }
    ]
  },
  {
    text: 'OAuth',
    items: [
      { text: 'OAuth Provider', link: '/plugins/development#oauth-provider' },
      { text: 'API Reference', link: '/api/overview' },
      { text: 'Public API SDK', link: '/plugins/sdk' }
    ]
  }
]

const zhApiSidebar = [
  {
    text: 'API Reference',
    items: [
      { text: 'Introduction', link: '/api/overview' },
      { text: 'OAuth Provider', link: '/plugins/development#oauth-provider' },
      { text: 'Public API SDK', link: '/plugins/sdk' },
      { text: 'Extension Actions', link: '/plugins/development#webhook-action-runtime' }
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
      { text: 'Agent', link: '/en/agent/install' },
      { text: 'API Overview', link: '/en/api/overview' }
    ]
  },
  {
    text: 'Extension Development',
    items: [
      { text: 'Extension Center', link: '/en/plugins/overview' },
      { text: 'Development Guide', link: '/en/plugins/development' },
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
      { text: 'Event list', link: '/en/plugins/manifest#current-capability-manifest' },
      { text: 'Manifest', link: '/en/plugins/manifest' },
      { text: 'Marketplace', link: '/en/plugins/market' },
      { text: 'SDK', link: '/en/plugins/sdk' }
    ]
  },
  {
    text: 'Types of Extensions',
    items: [
      { text: 'Server Extension', link: '/en/plugins/manifest#current-capability-manifest' },
      { text: 'Gateway Extension', link: '/en/plugins/manifest#current-capability-manifest' },
      { text: 'Webhook Action', link: '/en/plugins/manifest#current-capability-manifest' },
      { text: 'Storage', link: '/en/plugins/manifest#current-capability-manifest' }
    ]
  },
  {
    text: 'Themes',
    items: [
      { text: 'Create a Theme', link: '/en/plugins/templates' },
      { text: 'Theme Manifest', link: '/en/plugins/manifest#theme-manifest' },
      { text: 'Theme Templates', link: '/en/plugins/templates' }
    ]
  },
  {
    text: 'OAuth',
    items: [
      { text: 'OAuth Provider', link: '/en/plugins/overview#oauth-provider' },
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
      { text: 'OAuth Provider', link: '/en/plugins/overview#oauth-provider' },
      { text: 'Public API SDK', link: '/en/plugins/sdk' },
      { text: 'Extension Actions', link: '/en/plugins/manifest#current-capability-manifest' }
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
