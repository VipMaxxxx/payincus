import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  // 忽略文件
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
      'vite.config.ts'
    ]
  },

  // JavaScript/TypeScript 文件配置
  js.configs.recommended,

  // Vue 文件配置
  ...vue.configs['flat/recommended'],

  // TypeScript 文件配置
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      // TypeScript 规则（放宽限制，因为项目中有很多 API 响应使用 any）
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'off', // 允许使用 any（API 响应等场景需要）
      'no-undef': 'off', // TypeScript 会处理
      'no-unused-vars': 'off', // 使用 TypeScript 版本
      'no-useless-escape': 'error' // 保留这个错误检查
    }
  },

  // Vue 文件配置（包含 TypeScript）
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parser: tsparser // 使用 TypeScript 解析器解析 <script lang="ts">
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      // Vue 特定规则
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off', // 项目中使用了 markdown 渲染，需要 v-html
      'vue/require-default-prop': 'off',
      'vue/require-explicit-emits': 'warn',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',

      // TypeScript 规则（放宽限制）
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'off', // 允许使用 any（API 响应等场景需要）

      // 通用规则
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      'no-undef': 'off', // TypeScript 会处理
      'no-unused-vars': 'off', // 使用 TypeScript 版本
      'no-useless-escape': 'error' // 保留这个错误检查
    }
  },

  // JavaScript 文件配置
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn'
    }
  }
]

