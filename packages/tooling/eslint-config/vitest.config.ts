import { defineWalnutVitestConfig } from '@walnut/vitest-config'

// 本包是**平铺布局**（源码就在包根：`base.ts` / `nest-local-rules.ts` / `script-rules.ts`），
// 没有 `src/`。所以两处都要显式覆盖：
//   · `include` —— 预设的默认是 `src/**/*.test.ts`（co-located 约定），这里按平铺写；
//   · `coverageInclude: false` —— 本包从不跑覆盖率（规则由 RuleTester 直接驱动），
//     留着 `['src']` 只会在 `--coverage` 时报一个 0/0 的空面。预设专门留了这个开关。
export default defineWalnutVitestConfig({
  test: { include: ['*.test.ts'] },
  coverageInclude: false,
})
