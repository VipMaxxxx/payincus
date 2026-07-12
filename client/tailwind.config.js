// 纯黑白墨阶：用于把所有装饰性冷色/粉紫色系收敛为中性灰（仅保留 绿/琥珀/红 作状态色）
const neutralRamp = {
  50: '#fafafa',
  100: '#f2f2f4',
  200: '#e6e6e9',
  300: '#d7d7dc',
  400: '#a3a3a8',
  500: '#737378',
  600: '#52525a',
  700: '#3a3a40',
  800: '#262629',
  900: '#151518',
  950: '#0a0a0a'
}

// Nimbus 信号色阶（Linear 靛紫）：给散落的 bg-primary-*/text-primary-*/ring-primary-* 等
// accent 死类恢复为可见的靛紫主色（与 --kawaii-primary=#5e6ad2 一致，500=#5e6ad2、600=#4f5bc9）。
const indigoRamp = {
  50: '#f0f1fb',
  100: '#e2e4f7',
  200: '#c9ccf0',
  300: '#a9ade6',
  400: '#868cdc',
  500: '#5e6ad2',
  600: '#4f5bc9',
  700: '#4149a8',
  800: '#373d85',
  900: '#31376b',
  950: '#1f2140'
}

// rose 在代码里被广泛用作「危险/严重/亏损」的红色语义（非装饰），
// 因此保留为真红（与 error=#dc2626 对齐），避免被灰化后危险态静默失色。
const dangerRamp = {
  50: '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
  900: '#7f1d1d',
  950: '#450a0a'
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 中性灰阶 - 保留作为文本/边框基底
        gray: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
          950: '#0a0a0a'
        },
        // 主强调色 - 已收敛为中性墨阶（纯黑白，保留 sakura 名以兼容既有 class）
        sakura: {
          50: '#fafafa',
          100: '#f2f2f4',
          200: '#e6e6e9',
          300: '#d7d7dc',
          400: '#a3a3a8',
          500: '#737378',
          600: '#52525a',
          700: '#3a3a40',
          800: '#262629',
          900: '#151518'
        },
        // 次强调色 - 同样收敛为中性墨阶
        sky2: {
          50: '#fafafa',
          100: '#f2f2f4',
          200: '#e6e6e9',
          300: '#d7d7dc',
          400: '#a3a3a8',
          500: '#737378',
          600: '#52525a',
          700: '#3a3a40',
          800: '#262629',
          900: '#151518'
        },
        // 点缀色 - 已收敛为中性 slate（去掉紫色装饰感）
        lavender: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a'
        },
        // 暖阳金 - 点缀/VIP色
        sunny: {
          50: '#fff9eb',
          100: '#fff0c2',
          200: '#ffe08a',
          300: '#ffcd4d',
          400: '#ffb81f',
          500: '#f79f05',
          600: '#d67f02',
          700: '#a95f05',
          800: '#894b0d',
          900: '#723e10'
        },
        // 薄荷绿 - 成功/在线
        mint: {
          50: '#eafff6',
          100: '#cbffe8',
          200: '#99ffd4',
          300: '#5cf5ba',
          400: '#2be29e',
          500: '#12c584',
          600: '#08a06c',
          700: '#0a7e58',
          800: '#0c6448',
          900: '#0d523c'
        },
        // 强调色别名 - 墨色（主题感知，浅色黑 / 深色白）
        // primary/secondary 别名用于救活散落的 accent-primary/accent-secondary 死类
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent)',
          light: 'var(--accent)',
          primary: 'var(--accent)',
          secondary: 'var(--accent)'
        },
        // primary 色阶 - 代码里散落 bg-primary-*/text-primary-*/ring-primary-* 作强调用；
        // Nimbus 下恢复为靛蓝信号色阶（选中态/复选框/强调可见且成品牌）
        primary: indigoRamp,
        // 状态色。保留 Tailwind 自带 blue/sky/teal 等语义色，
        // 避免处理中、信息、选中和图表状态被全局灰化后失去区分。
        success: '#16a34a',
        warning: '#d97706',
        error: '#dc2626',
        // rose 保留真红：代码里当「危险/严重/亏损」语义用（详见 dangerRamp 注释）
        rose: dangerRamp
      },
      fontFamily: {
        // Nimbus：Inter(自托管 variable) 为 UI 主字，系统栈 + 中文回退
        sans: [
          '"Inter Variable"',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          '"PingFang SC"',
          '"Noto Sans SC"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        display: [
          '"Inter Variable"',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"Helvetica Neue"',
          '"PingFang SC"',
          '"Noto Sans SC"',
          'sans-serif'
        ],
        // Nimbus：JetBrains Mono(自托管 variable) 做数据/ID/哈希/终端的等宽声部
        mono: [
          '"JetBrains Mono Variable"',
          '"JetBrains Mono"',
          'ui-monospace',
          '"SF Mono"',
          'Monaco',
          'Consolas',
          'monospace'
        ]
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        'lg': '8px',
        'xl': '10px',
        '2xl': '12px',
        '3xl': '16px'
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'DEFAULT': '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
        'border': '0 0 0 1px rgb(0 0 0 / 0.06)',
        // 发光阴影已统一收敛为细微中性阴影（保留别名以兼容既有 class）
        'glow-sakura': '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
        'glow-sky': '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
        'glow-lavender': '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
        'glow-sunny': '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
        'glow-mint': '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.10)',
        'pop': '0 4px 12px -2px rgb(0 0 0 / 0.12), 0 2px 6px -2px rgb(0 0 0 / 0.08)'
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        // 装饰性动效已收敛：pop-in/bounce-in 退化为普通淡入，其余花哨动效禁用
        'pop-in': 'fadeIn 0.2s ease-out',
        'bounce-in': 'fadeIn 0.2s ease-out',
        'wiggle': 'none',
        'float': 'none',
        'float-delay': 'none',
        'sparkle': 'none',
        'heart-beat': 'none',
        'glow-pulse': 'none',
        'shimmer': 'none',
        'petal-fall': 'none'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.85) translateY(6px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' }
        },
        bounceIn: {
          '0%': { opacity: '0', transform: 'scale(0.5)' },
          '60%': { opacity: '1', transform: 'scale(1.05)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%': { transform: 'rotate(-6deg)' },
          '75%': { transform: 'rotate(6deg)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-8px) rotate(3deg)' }
        },
        sparkle: {
          '0%, 100%': { opacity: '0.3', transform: 'scale(0.8) rotate(0deg)' },
          '50%': { opacity: '1', transform: 'scale(1.15) rotate(90deg)' }
        },
        heartBeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '14%': { transform: 'scale(1.2)' },
          '28%': { transform: 'scale(1)' },
          '42%': { transform: 'scale(1.15)' },
          '70%': { transform: 'scale(1)' }
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(255 79 156 / 0.4)' },
          '50%': { boxShadow: '0 0 0 6px rgb(255 79 156 / 0)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        },
        petalFall: {
          '0%': { transform: 'translateY(-10%) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '0.8' },
          '100%': { transform: 'translateY(110vh) rotate(360deg)', opacity: '0' }
        }
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')({ strategy: 'class' })
  ]
}
