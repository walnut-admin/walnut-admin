import { defineWalnutVitestConfig } from '@walnut/vitest-config'

export default defineWalnutVitestConfig({
  test: {
    /**
     * 单条用例的超时放宽到 60 秒（共享预设的缺省是 5 秒）。
     *
     * 为什么这个包要单独放宽：它的用例经常**对着真实仓库扫**（emoji、文档引用、turbo 不变量），
     * 或者**起真实子进程**（node、pnpm、git、taskkill）。这些用例平时是毫秒到秒级，但 prepush
     * 在 turbo 缓存冷的时候会与别的门禁段抢 CPU —— 实测那种时候连「读一个 tsconfig」的断言都会在
     * 5 秒处超时（2026-11-23 一天里这样假红了四次）。2026-11-24 起经 turbo 扇出的三段（lint /
     * types / test）在门禁表里互斥，不再互相抢（见 `src/ci/prepush.ts` 的 `PrepushGate.lane`），
     * 但测试段仍与其余门禁段共享一台机器，这个余量继续留着。
     * 超时只决定「卡死的用例多久被判死」，不改变正常用例的耗时：真卡住的用例 60 秒后照样红。
     */
    testTimeout: 60_000,
  },
})
