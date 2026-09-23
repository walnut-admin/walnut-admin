import { defineWalnutVitestConfig } from '@walnut/vitest-config'
import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineWalnutVitestConfig({
  // e2e 从不跑覆盖率，不产出 coverage 段
  coverageInclude: false,
  plugins: [swc.vite(), tsconfigPaths()],
  test: {
    include: ['apps/api/test/**/*.e2e-spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: true,
    root: './',
  },
})
