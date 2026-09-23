import vue from '@vitejs/plugin-vue'
import { defineWalnutVitestConfig } from '@walnut/vitest-config'

export default defineWalnutVitestConfig({
  environment: 'jsdom',
  plugins: [vue()],
})
