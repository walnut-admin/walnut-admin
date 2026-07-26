import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [swc.vite(), tsconfigPaths()],

  test: {
    include: ['**/*.e2e-spec.ts'],
    globals: true,
    root: './',
  },
})
