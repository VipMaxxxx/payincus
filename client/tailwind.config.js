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
        // 主强调色 - 克制蓝（原樱花粉已收敛为专业蓝，保留 sakura 名以兼容既有 class）
        sakura: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        },
        // 天空蓝 - 次强调色
        sky2: {
          50: '#eefaff',
          100: '#d9f2ff',
          200: '#b0e6ff',
          300: '#7dd6ff',
          400: '#4cc4ff',
          500: '#2ab0f5',
          600: '#1690d6',
          700: '#1272ab',
          800: '#125a86',
          900: '#134a6c'
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
        // 强调色别名 - 克制蓝主色
        accent: {
          DEFAULT: '#2563eb',
          hover: '#1d4ed8',
          light: '#60a5fa'
        },
        // 状态色（语义色，克制去饱和）
        success: '#16a34a',
        warning: '#d97706',
        error: '#dc2626'
      },
      fontFamily: {
        // 专业中性无衬线字体栈（英文 Inter，中文 Noto Sans SC / 系统字体）
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        display: [
          'Inter',
          '-apple-system',
          '"Segoe UI"',
          '"Noto Sans SC"',
          'sans-serif'
        ],
        mono: [
          'Geist Mono',
          'SF Mono',
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
