/**
 * 仓内共享的 Vitest 预设。
 *
 * **只收敛会漂移/会泄漏的少数几件事**：用例发现规则、运行环境、覆盖率采集范围，以及
 * `isolate: false` 下必需的全局状态复位钩子（见 `test_` 里的注释）。别的都不管 ——
 * `plugins` / `root` / `globals` / `exclude` 一律由各包显式传入，这里不猜意图、不设「聪明」默认值
 * （猜错的默认值比重复三行更难查）。
 *
 * 为什么值得单独成包：这 7 份配置此前各写各的，`include` 那条 glob 抄了 6 遍。用例发现规则一旦
 * 漂移，症状是**测试静默地不再被收集**（vitest 对空集合不报错），而不是红 —— 正是那种应该由结构
 * 消灭、而不是靠 review 盯住的错。
 */

import type { ViteUserConfig } from 'vitest/config'
import { defineConfig } from 'vitest/config'

/**
 * 用例与源码同目录（ADR 0015 决策 2：`src/**` 下 co-located）。
 * 放在这里而不是各包各写一份，是为了让「新包写错发现规则」在结构上不可能发生。
 */
const INCLUDE = ['src/**/*.test.ts', 'src/**/*.spec.ts'] as const

export interface WalnutVitestConfigOptions {
  /** 默认 `node`；浏览器 / Vue 包传 `jsdom`。 */
  environment?: 'node' | 'jsdom'
  /**
   * 覆盖率采集范围，默认 `['src']`。
   * 传 `false` 表示**完全不产出 `coverage` 段** —— 留给那些从不跑覆盖率的配置（如 e2e）。
   */
  coverageInclude?: string[] | false
  /** 需要额外插件时传入，如 `@vitejs/plugin-vue`、`unplugin-swc`。 */
  plugins?: ViteUserConfig['plugins']
  /**
   * 覆盖 `test` 段里的任意键（**浅合并、整键替换**）。
   * 注意 `include` 是整体替换而非追加：传了就完全按你写的来（server / e2e 的根目录口径与仓内默认不同）。
   */
  test?: NonNullable<ViteUserConfig['test']>
}

export function defineWalnutVitestConfig(options: WalnutVitestConfigOptions = {}): ViteUserConfig {
  const { environment = 'node', coverageInclude = ['src'], plugins, test } = options

  const test_: NonNullable<ViteUserConfig['test']> = {
    environment,
    include: [...INCLUDE],
    /**
     * 关闭 per-file 隔离：同一 worker 内复用模块图，省掉每个测试文件重复求值/建 worker 的
     * 启动成本（2026-11 本机实测全仓 `turbo test --force`：隔离 72.1s → 共享 28.3–28.8s）。
     *
     * **代价是全局状态真的会跨文件存活**：`vi.spyOn` / `vi.stubEnv` / `vi.stubGlobal`
     * 不再随文件结束自动回收，`vi.mock` 也不再是文件级私有的 —— 一个文件里 mock 掉的模块，
     * worker 内后续文件拿到的就是 mock 版（反过来，模块已被真实求值过时，本文件的
     * `vi.mock` 不会生效）。所以下面三条自动复位钩子**不是可选项**：它们把「忘记手动清理」
     * 从跨文件随机红降级为单文件内可解释的行为。测试里需要 mock 共享模块时，优先
     * 依赖注入 / `vi.spyOn`（配自动 restore），不要用文件级 `vi.mock` 换模块实现。
     */
    isolate: false,
    /** 每个用例前还原 `vi.spyOn` 出来的 spy（含原型上的 Logger 等）。 */
    restoreMocks: true,
    /** 每个用例前还原 `vi.stubEnv`。不还原的 env 会泄漏到同一 worker 的后续文件。 */
    unstubEnvs: true,
    /** 每个用例前还原 `vi.stubGlobal`（如 fetch / Image 替身）。 */
    unstubGlobals: true,
  }

  if (coverageInclude !== false) test_.coverage = { provider: 'v8', include: coverageInclude }

  return defineConfig({
    plugins,
    test: { ...test_, ...test },
  })
}
