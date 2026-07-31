import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const entries = {
  'index': resolve(__dirname, 'src/index.ts'),
  'regex': resolve(__dirname, 'src/regex.ts'),
  'queue': resolve(__dirname, 'src/queue.ts'),
  'crypto/const': resolve(__dirname, 'src/crypto/const.ts'),
  'crypto/transformer': resolve(__dirname, 'src/crypto/transformer.ts'),
  'persistent/enhance/async': resolve(__dirname, 'src/persistent/enhance/async.ts'),
  'persistent/enhance/sync': resolve(__dirname, 'src/persistent/enhance/sync.ts'),
}

export default defineConfig({
  build: {
    lib: { entry: entries, formats: ['cjs'] },
    outDir: 'dist',
    rollupOptions: {
      external: ['js-base64'],
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
