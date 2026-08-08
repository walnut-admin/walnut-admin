import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
