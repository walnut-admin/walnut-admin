/**
 * 仓内共享的 Vitest 预设。
 *
 * **只收敛会漂移的三件事**：用例发现规则、运行环境、覆盖率采集范围。别的都不管 ——
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
  const {
    environment = 'node',
    coverageInclude = ['src'],
    plugins,
    test,
  } = options

  const test_: NonNullable<ViteUserConfig['test']> = {
    environment,
    include: [...INCLUDE],
  }

  if (coverageInclude !== false)
    test_.coverage = { provider: 'v8', include: coverageInclude }

  return defineConfig({
    plugins,
    test: { ...test_, ...test },
  })
}

export default defineWalnutVitestConfig
