import { defineConfig } from 'vitepress'

const zhNav = [
  { text: '开始', link: '/guide/introduction' },
  { text: '在线 Demo', link: '/demo' },
  { text: '部署', link: '/deployment/one-click-install' },
  { text: '后台 OTA', link: '/guide/ota-update' },
  { text: '插件', link: '/plugins/overview' },
  { text: '版本日志', link: '/release/version-log' },
  { text: 'API', link: '/api/overview' },
  {
    text: '社区',
    items: [
      { text: 'Telegram 交流群', link: 'https://t.me/Payincus' },
      { text: 'GitHub', link: 'https://github.com/VipMaxxxx/payincus' }
    ]
  }
]

const enNav = [
  { text: 'Start', link: '/en/guide/introduction' },
  { text: 'Demo', link: '/en/demo' },
  { text: 'Deploy', link: '/en/deployment/one-click-install' },
  { text: 'Admin OTA', link: '/en/guide/ota-update' },
  { text: 'Plugins', link: '/en/plugins/overview' },
  { text: 'Version Log', link: '/en/release/version-log' },
  { text: 'API', link: '/en/api/overview' },
  {
    text: 'Community',
    items: [
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
    text: '插件开发',
    items: [
      { text: '插件中心', link: '/plugins/overview' },
      { text: '开发指南', link: '/plugins/development' },
      { text: 'Manifest', link: '/plugins/manifest' },
      { text: '客户端扩展点', link: '/plugins/client-extensions' },
      { text: '插件模板', link: '/plugins/templates' }
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
    text: 'Plugin Development',
    items: [
      { text: 'Plugin Center', link: '/en/plugins/overview' },
      { text: 'Development Guide', link: '/en/plugins/development' },
      { text: 'Manifest', link: '/en/plugins/manifest' },
      { text: 'Client Extensions', link: '/en/plugins/client-extensions' },
      { text: 'Plugin Templates', link: '/en/plugins/templates' }
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
        sidebar: zhSidebar,
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
        sidebar: enSidebar,
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
