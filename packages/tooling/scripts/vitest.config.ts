import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // 用例放在各模块旁的 __tests__/（与 packages/platform-any/utils-core 同风格）
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: { provider: 'v8', include: ['src'] },
  },
})
