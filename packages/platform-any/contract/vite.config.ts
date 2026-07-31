import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const entries = {
  'index': resolve(__dirname, 'src/index.ts'),
  'cookie': resolve(__dirname, 'src/cookie.ts'),
  'crypto-wire': resolve(__dirname, 'src/crypto-wire.ts'),
  'http': resolve(__dirname, 'src/http.ts'),
  'i18n': resolve(__dirname, 'src/i18n.ts'),
  'menu': resolve(__dirname, 'src/menu.ts'),
  'pagination': resolve(__dirname, 'src/pagination.ts'),
  'response': resolve(__dirname, 'src/response.ts'),
  'response-code': resolve(__dirname, 'src/response-code.ts'),
  'role': resolve(__dirname, 'src/role.ts'),
  'routes': resolve(__dirname, 'src/routes.ts'),
  'socket': resolve(__dirname, 'src/socket.ts'),
  'token': resolve(__dirname, 'src/token.ts'),
  'token-key': resolve(__dirname, 'src/token-key.ts'),
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
