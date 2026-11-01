import { defineWalnutVitestConfig } from '@walnut/vitest-config'

export default defineWalnutVitestConfig({
  // 包级结构门禁（entries / barrel / exports 三方一致）读的是包根文件，放 `__tests__/`；
  // 共享预设只扫 `src/**`，这里显式补上（`include` 是整键替换）。
  test: { include: ['src/**/*.test.ts', '__tests__/**/*.test.ts'] },
})
