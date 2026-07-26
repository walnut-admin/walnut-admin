import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.vitepress/cache/**',
      '.vitepress/dist/**',
      'nginx/**',
    ],
    vue: true,
    typescript: true,
    markdown: false,
    rules: {
      'no-console': 'off',
      'style/no-tabs': 'off',
      'vue/no-unused-refs': 'warn',
      'import/newline-after-import': 'warn',
    },
  },
)
