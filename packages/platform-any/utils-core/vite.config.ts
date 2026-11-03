import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

/**
 * 只构建**双端同源**的两个子路径 + 包入口（D7 之后）。
 * 别的工具不要去 client 那边复制进来 —— 后端的 CJS 消费面只有 `dist/object-paths.cjs`
 * 与 `dist/sign-raw.cjs`（`apps/server` 的 guards 与 `libs/utils` 各 require 其一）。
 */
const entries = {
  'index': resolve(__dirname, 'src/index.ts'),
  'object-paths': resolve(__dirname, 'src/object-paths.ts'),
  'sign-raw': resolve(__dirname, 'src/sign-raw.ts'),
}

export default defineConfig({
  build: {
    lib: { entry: entries, formats: ['cjs'] },
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src'],
    }),
  ],
})
