import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const entries = {
  'index': resolve(__dirname, 'src/index.ts'),
  'response-code': resolve(__dirname, 'src/response-code.ts'),
  'response': resolve(__dirname, 'src/response.ts'),
  'pagination': resolve(__dirname, 'src/pagination.ts'),
  'menu': resolve(__dirname, 'src/menu.ts'),
  'role': resolve(__dirname, 'src/role.ts'),
  'i18n': resolve(__dirname, 'src/i18n.ts'),
  'http': resolve(__dirname, 'src/http.ts'),
}

export default defineConfig({
  build: {
    lib: { entry: entries, formats: ['cjs'] },
    outDir: 'dist',
    rollupOptions: {
      external: ['easy-fns-ts'],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
  plugins: [dts({ insertTypesEntry: true, include: ['src'] })],
})
