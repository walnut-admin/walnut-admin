# `@walnut/tsconfig` —— 共享 TypeScript 预设

> 取代了根部的 `tsconfig.base.json`（**已删除**）。各包不再用 `../../../tsconfig.base.json` 这种
> **按深度相对**的继承，而是 `"extends": "@walnut/tsconfig/<preset>.json"` —— 包搬到哪一层都不影响。

## 三个预设：按**运行环境**分，不按「项目 vs 库」分

| 预设 | 用于 | 相对 base 多了什么 |
|------|------|--------------------|
| `base.json` | 不放直接消费者（裸配置） | —— |
| `ts.json` | `packages/platform-any/*`、`packages/tooling/*`、仓库根 `tsconfig.json` | `erasableSyntaxOnly: true` |
| `vue.json` | `apps/admin`、`apps/docs`、`packages/platform-web/*` | DOM lib + `jsx: preserve` + `jsxImportSource: vue` |

`base.json` 只放**与环境无关**的编译语义：严格性、模块系统、互操作、发射开关。刻意**不含**
`lib` / `jsx` / `jsxImportSource` / `types` / `erasableSyntaxOnly` —— 这五项都是**环境假设**，
由下层预设补齐。直接 `extends` base = 裸配置（lib 只有 ESNext、无 JSX、types 走自动包含），
仓内无此用法。

### 为什么 `ts.json` 要 `erasableSyntaxOnly`

这些包的源码会被 **Node 原生执行**（仓库脚本的 bin、`contract/scripts/build-barrel.ts` 这类构建脚本、
以及 ESLint / commitlint 直接加载的配置），靠 Node 24 的类型剥离而不是 tsx / ts-node。
类型剥离只支持**可擦除语法** —— 没有 `enum`、没有非 ambient `namespace`、没有构造函数参数属性、
没有 `import =`。这个开关让 `tsc` 在**编译期**就拦住这些写法，否则要到运行时才炸。

### 为什么 `vue.json` 不需要它

浏览器包全部由 Vite / vue-tsc 编译，**不经 Node 原生剥离类型**。给它们加上这个约束只会误伤
（`apps/admin` 里有 60+ 处 `namespace`，都在类型位置上，属正常写法）。

### 为什么是「三个按环境分」而不是「项目 / 库」

原来的 `tsconfig.base.json` 把 `jsx: preserve` + `jsxImportSource: vue` 也放在基线里，于是
`packages/platform-any/*`（纯逻辑、不该写 JSX）也拿到了 Vue JSX 支持 —— 那是个假阴性：
平台无关包写出 `.tsx` 也能通过。现在 DOM 与 JSX 都只出现在 `vue.json` 里。

## 各包用哪个

| 包 | 预设 | 原因 |
|----|------|------|
| `apps/admin` | `vue.json` | Vue SPA，Vite 编译 |
| `apps/docs` | `vue.json` | VitePress（自己声明 `types: ["node"]`） |
| `apps/server` | **不继承任何预设** | ADR 0012：CJS + `moduleResolution: node` + decorators 与 ESM + bundler 冲突 |
| `packages/platform-any/contract` | `ts.json` | 有 Node 执行的 `packages/platform-any/contract/scripts/build-barrel.ts` |
| `packages/platform-any/types` | `ts.json` | 纯 `.d.ts` |
| `packages/platform-any/utils-core` | `ts.json` | 纯逻辑（自持 `types: ["node"]`） |
| `packages/platform-web/*` | `vue.json` | 浏览器 + Vue |
| `packages/tooling/scripts` | `ts.json` | 四个 bin 由 Node 原生执行 |
| `packages/tooling/release` | `ts.json` | bin 由 Node 原生执行 |
| `packages/tooling/eslint-config` | `base.json` | 由 ESLint 经 jiti 加载，不经 Node 剥离 |
| `packages/tooling/commitlint-config` | `base.json` | 由 commitlint 的 TS loader 加载 |
| `packages/tooling/vitest-config` | `base.json` | 由 Vitest 的 esbuild 加载，不经 Node 剥离 |
| 仓库根 `tsconfig.json` | `base.json` | 只覆盖 `eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts` |

**判据一句话**：这个包里有**被 `node` 直接跑**的 `.ts` 吗？有 → `ts.json`；只有被工具加载的配置 →
`base.json`；在浏览器里跑 → `vue.json`。

## 几个值得说明的开关

- **`allowImportingTsExtensions: true`**（在 base）：源码直消费的包（`@walnut/*` 的 `exports` 指到
  `.ts`）与被 Node 执行的脚本，内部相对导入必须写显式 `.ts`（ESM 不做扩展名推断）。
  该开关要求 `noEmit`（base 已设），不会与产物语义冲突。
- **`lib: ["ESNext"]`**（在 base，**不含 DOM**）：写 `document` 之类的浏览器全局在纯逻辑包里应当
  直接编译失败。数组型选项是**覆盖**而非合并，所以 `vue.json` 里整体替换成 DOM 版。
- **`noEmit: true`**：本仓只做类型检查，真实产物由 Vite / vue-tsc / SWC / Nest CLI 负责。

## 加新包时

1. 按上面的判据选预设，写 `"extends": "@walnut/tsconfig/<preset>.json"`；
2. `devDependencies` 里加 `"@walnut/tsconfig": "workspace:*"` —— pnpm 的 `hoist: false` 下，
   不声明就解析不到；
3. 把它加进 `pnpm-workspace.yaml` 的 `versioning.fixed` 单组（`pnpm change check` 与发版审计都会拦）。
