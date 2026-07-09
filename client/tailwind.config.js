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
        // 樱花粉 - 主强调色
        sakura: {
          50: '#fff0f6',
          100: '#ffdcea',
          200: '#ffb8d5',
          300: '#ff8fbd',
          400: '#ff6ba8',
          500: '#ff4f9c',
          600: '#f13c8c',
          700: '#d42a76',
          800: '#a91f5e',
          900: '#7e1747'
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
        // 薰衣草紫 - 点缀色
        lavender: {
          50: '#f6f0ff',
          100: '#ece0ff',
          200: '#dac2ff',
          300: '#c29dff',
          400: '#a875fb',
          500: '#9052f0',
          600: '#7a39d6',
          700: '#632eae',
          800: '#4f278a',
          900: '#3f2170'
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
        // 强调色别名 - 指向樱花粉主色
        accent: {
          DEFAULT: '#ff4f9c',
          hover: '#f13c8c',
          light: '#ff8fbd'
        },
        // 状态色
        success: '#12c584',
        warning: '#f79f05',
        error: '#ff5470'
      },
      fontFamily: {
        // 圆润可爱的无衬线字体，中英文皆有圆角笔画特征
        sans: [
          '"Baloo 2"',
          '"ZCOOL KuaiLe"',
          '"Rounded Mplus 1c"',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          '"Noto Sans SC"',
          'sans-serif'
        ],
        display: [
          '"Baloo 2"',
          '"ZCOOL KuaiLe"',
          '-apple-system',
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
        DEFAULT: '10px',
        'lg': '16px',
        'xl': '20px',
        '2xl': '28px',
        '3xl': '36px'
      },
      boxShadow: {
        'sm': '0 2px 8px 0 rgb(255 79 156 / 0.06)',
        'DEFAULT': '0 4px 16px 0 rgb(255 79 156 / 0.10)',
        'border': '0 0 0 1px rgb(255 255 255 / 0.1)',
        // 二次元发光阴影系列
        'glow-sakura': '0 0 0 1px rgb(255 79 156 / 0.25), 0 4px 20px -2px rgb(255 79 156 / 0.35)',
        'glow-sky': '0 0 0 1px rgb(42 176 245 / 0.25), 0 4px 20px -2px rgb(42 176 245 / 0.35)',
        'glow-lavender': '0 0 0 1px rgb(144 82 240 / 0.25), 0 4px 20px -2px rgb(144 82 240 / 0.35)',
        'glow-sunny': '0 0 0 1px rgb(247 159 5 / 0.3), 0 4px 20px -2px rgb(247 159 5 / 0.4)',
        'glow-mint': '0 0 0 1px rgb(18 197 132 / 0.25), 0 4px 20px -2px rgb(18 197 132 / 0.35)',
        'pop': '0 8px 24px -4px rgb(255 79 156 / 0.25), 0 2px 8px -2px rgb(0 0 0 / 0.08)'
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        // 二次元动效系列
        'pop-in': 'popIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'bounce-in': 'bounceIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'wiggle': 'wiggle 0.5s ease-in-out',
        'float': 'float 3.5s ease-in-out infinite',
        'float-delay': 'float 3.5s ease-in-out 1.2s infinite',
        'sparkle': 'sparkle 1.8s ease-in-out infinite',
        'heart-beat': 'heartBeat 1.2s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.4s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
        'petal-fall': 'petalFall 6s linear infinite'
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
