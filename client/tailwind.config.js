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
        // Vercel/GitHub 风格 - 极简黑白灰
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
        // 强调色 - 简洁蓝
        accent: {
          DEFAULT: '#0070f3',
          hover: '#0060df',
          light: '#3291ff'
        },
        // 状态色
        success: '#10b981',
        warning: '#f59e0b', 
        error: '#ef4444'
      },
      fontFamily: {
        sans: [
          'Geist',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Noto Sans SC',
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
        'xl': '12px'
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'DEFAULT': '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        'border': '0 0 0 1px rgb(255 255 255 / 0.1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')({ strategy: 'class' })
  ]
}
