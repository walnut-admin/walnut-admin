# `@walnut/vitest-config` —— 共享 Vitest 预设

> 建立于 2026-09-23（待办 P3-14）。此前仓内 7 份 `vitest.config*.ts` 各自手写，`include` 那条
> glob 抄了 6 遍。

## 只做三件事

| 收敛项 | 默认值 | 为什么值得集中 |
|--------|--------|----------------|
| 用例发现规则 | `['src/**/*.test.ts', 'src/**/*.spec.ts']` | 抄错/抄漏的症状是**测试静默不再被收集**（vitest 对空集合不报错），不是红 |
| 运行环境 | `'node'` | 只有浏览器包需要 `jsdom`，显式传 |
| 覆盖率采集范围 | `['src']`（`v8` provider） | 6 份配置此前逐字相同 |

**不管**的事：`plugins` / `root` / `globals` / `exclude` 一律由各包显式传入 —— 猜意图的默认值
比重复三行更难查。

## 用法

```ts
// 纯 Node 包：一行
import { defineWalnutVitestConfig } from '@walnut/vitest-config'

export default defineWalnutVitestConfig()
```

```ts
// 浏览器 / Vue 包
import vue from '@vitejs/plugin-vue'
import { defineWalnutVitestConfig } from '@walnut/vitest-config'

export default defineWalnutVitestConfig({ environment: 'jsdom', plugins: [vue()] })
```

```ts
// 根目录口径与仓内默认不同的包（apps/server 的用例在 apps/api/src，不在 src）
export default defineWalnutVitestConfig({
  coverageInclude: ['apps/api/src'],
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    root: './',
    globals: true,
    include: ['apps/api/src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
```

`test` 是**浅合并、整键替换**：传了 `include` 就完全按你写的来，不会与仓内默认拼接。

`coverageInclude: false` 表示不产出 `coverage` 段（`apps/server` 的 e2e 配置用它 —— 那条路径
从不跑覆盖率，加上只会让 `--coverage` 意外生效）。

## 消费者

`apps/server`（单元 + e2e 两份）、`packages/platform-any/{contract,utils-core}`、
`packages/platform-web/client`、`packages/tooling/{scripts,release}`。

## 为什么是独立包而不是塞进 `@walnut/scripts`

`@walnut/scripts` 的定位是「被其它工具包复用的**模块**（`src/lib/*`）+ 四个 bin」，而
`@walnut/eslint-config` / `@walnut/tsconfig` / `@walnut/commitlint-config` 已经确立了
「一种共享配置一个包」的分法。塞进 `scripts` 会让它同时承担两种角色。

## 落 `base.json` 而不是 `ts.json`

本文件由 **Vitest 自己的 esbuild 打包加载**，不经 Node 原生类型剥离 —— 与
`@walnut/eslint-config`（jiti）/ `@walnut/commitlint-config`（TS loader）同一判据。见
[`@walnut/tsconfig` 的判据表](../tsconfig/README.md)。

## 加新测试包时

1. `devDependencies` 加 `"@walnut/vitest-config": "workspace:*"`（`hoist: false` 下不声明就解析不到）；
2. 配置改成上面的一行式；
3. 把它加进 `pnpm-workspace.yaml` 的 `versioning.fixed` 单组 —— 但**如果你只是在给已有包加测试，
   这条不适用**（`@walnut/vitest-config` 自己已经在组里了）。

> ⚠️ 改本包的 `index.ts` 会让**所有**包的 turbo 缓存失效：它列在根 `turbo.json` 的
> `globalDependencies` 里。这是刻意的 —— 该包没有 `build` 任务，不这么写的话改了预设、
> 消费者的 `test` 缓存不会失效，本地会重放旧的通过结果。
