import baseConfig from '@walnut/eslint-config/base'

/**
 * E2E 包的 ESLint 配置：base 预设 + 本包**运行态产物**的忽略。
 *
 * 为什么需要包级配置（其余包都直接继承根配置）：Playwright 在跑测试时会不断改写
 * `test-results/`（每个用例结束都重写 `.last-run.json`），`eslint .` 与测试并行就会读到
 * 半写/已删的文件（实测 ENOENT: test-results/.last-run.json）。这些目录只在跑测试时出现，
 * 不该进 lint 面；`ignores` 在 antfu 的选项里是**整段替换**，所以 base 的两条也要带上。
 */
export default baseConfig({
  ignores: [
    '**/dist/**',
    'pnpm-lock.yaml',
    // 脚本/测试的运行态产物（全部 gitignored）
    '.auth/**',
    '.e2e/**',
    'test-results/**',
    'playwright-report/**',
  ],
})
