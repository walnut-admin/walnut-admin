import { defineWalnutVitestConfig } from '@walnut/vitest-config'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineWalnutVitestConfig({
  // 用例在 apps/api/src 而不是 src —— 覆盖范围要跟着根目录口径走
  coverageInclude: ['apps/api/src'],
  plugins: [
    tsconfigPaths(),
    // This is required to build the test files with SWC
    swc.vite({
      // Explicitly set the module type to avoid inheriting this value from a `.swcrc` config file
      module: { type: 'es6' },
    }),
  ],
  test: {
    root: './',
    globals: true,
    include: ['apps/api/src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
