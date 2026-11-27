import vueConfig from '@walnut/eslint-config/vue'

export default vueConfig({
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '.vitepress/cache/**',
    '.vitepress/dist/**',
    'nginx/**',
  ],
  rules: {
    'vue/no-unused-refs': 'warn',
    'import/newline-after-import': 'warn',
  },
})
