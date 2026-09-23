# TypeScript 配置

## 概述

Walnut Admin 是一个**异构工具链**的全栈 monorepo——前端用 ESM + Vite + `moduleResolution: "bundler"`，后端用 CJS + NestJS CLI + SWC。TypeScript 的配置策略要同时兼容这两种模块系统，还要区分**代码由谁执行**：被 Node 原生剥离类型执行的（bin / 构建脚本 / 配置）、被 Vite 编译的（浏览器 + Vue）、以及只有工具自己加载的（纯 JSON 预设）。

## 我们做了什么

### 1. 共享预设包 `@walnut/tsconfig`（2026-09-23 提取）

共享 tsconfig 从「根目录一份 `tsconfig.base.json`」改为**独立的预设包** [`packages/tooling/tsconfig/`](https://github.com/walnut-admin/walnut-admin/tree/main/packages/tooling/tsconfig)（包名 `@walnut/tsconfig`，纯 JSON、无源码）。三个预设**按运行环境**分，不按「项目 / 库」分：

| 预设 | 面向环境 | 内容 |
|------|---------|------|
| [`base.json`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/tsconfig/base.json) | 环境无关基线 | `target: ESNext`、`module/moduleResolution: ESNext/bundler`、`strict`、`isolatedModules`、`verbatimModuleSyntax`、`noEmit`、`allowImportingTsExtensions`、`skipLibCheck`……`lib` 只有 `ESNext`（**不含 DOM**），且不含 `jsx` / `jsxImportSource` / `types` / `erasableSyntaxOnly` |
| [`ts.json`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/tsconfig/ts.json) | Node / 纯逻辑 / 工具链 | `extends base` + **`erasableSyntaxOnly: true`**（源码由 Node 原生剥离类型执行，不许 `enum` / 非 ambient `namespace` / 构造函数参数属性） |
| [`vue.json`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/tsconfig/vue.json) | 浏览器 + Vue | `extends base` + `lib: ["DOM", "ESNext", "DOM.Iterable"]` + `jsx: "preserve"` + `jsxImportSource: "vue"` |

消费者不再写不同深度的 `../../../tsconfig.base.json`，而是**按包名继承**，并在 `devDependencies` 里声明 `@walnut/tsconfig: workspace:*`：

```jsonc
// 任意消费者包
{ "extends": "@walnut/tsconfig/vue.json" }
```

| 继承的预设 | 消费者 | 为什么是它 |
|-----------|--------|-----------|
| `vue.json` | `apps/admin`、`apps/docs`、`packages/platform-web/{client,http,ui}` | 由 Vite / vue-tsc 编译，需要 DOM + Vue JSX |
| `ts.json` | `packages/platform-any/{contract,types,utils-core}`、`@walnut/scripts`、`@walnut/release` | 「Node / 纯逻辑 / 工具链」环境；其中 `@walnut/contract` 的 `packages/platform-any/contract/scripts/build-barrel.ts` 与两个工具链包的 bin 由 Node 原生执行，必须只写「可擦除语法」 |
| `base.json` | 仓库根 `tsconfig.json`、`@walnut/eslint-config`、`@walnut/commitlint-config`、`@walnut/vitest-config` | 这些文件由 ESLint（经 jiti）/ commitlint 的 TS loader / Vitest 的 esbuild 加载，**不是** Node 原生执行 ⇒ 不需要 `erasableSyntaxOnly` |
| 不继承任何预设 | `apps/server` | 见第 3 节 |

预设包本身没有可检查的 TS 源码，所以它的 `types:check` 只是一句 `echo`（`packages/tooling/tsconfig/package.json`）；而 `@walnut/eslint-config` 的预设是**真 TS 源码**，`types:check` 是真正的 `tsc --noEmit`。

### 2. 前端包 extends `vue.json`

`apps/admin`、`apps/docs`、`packages/platform-web/*` 直接 extends `@walnut/tsconfig/vue.json`，仅声明自己的 `include`/`paths`：

```jsonc
// apps/admin/tsconfig.json
{
  "extends": "@walnut/tsconfig/vue.json",
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"], "~/*": ["./types/*"] }
  }
}
```

### 2.1 DOM lib 只在 `vue.json` 里（2026-08-08 下沉，2026-09-23 随提取落位）

基线（`base.json`）只保留 `lib: ["ESNext"]`——`DOM`/`DOM.Iterable` 由真正运行在浏览器的 `vue.json` 提供（`apps/admin`、`apps/docs`、`packages/platform-web/*`）。`platform-any` 的 `contract`/`types`/`utils-core` 继承 `ts.json`，**看不到** `window`/`document` 等 DOM 全局，杜绝「平台无关包写出浏览器专用代码」的假阴性。

> 原先根 `tsconfig.base.json` 把 `jsx: "preserve"` + `jsxImportSource: "vue"` 放进了基线，于是纯逻辑包也悄悄拿到了 Vue JSX 支持——同一个假阴性。提取时把 `jsx` / `jsxImportSource` / `types` / `erasableSyntaxOnly` 全部挪出基线（`lib` 收紧为只有 `ESNext`），JSX 只在 `vue.json` 里出现。

### 3. 后端不 extends 任何预设

`apps/server/tsconfig.json` 是**完全独立**的——不 extends 任何 `@walnut/tsconfig` 预设（`tsconfig.base.json` 已删除，其位置由 `base.json` 取代）。原因：后端使用 CJS + `moduleResolution: "node"` + `experimentalDecorators`（NestJS 必需），与基线的 ESM + `bundler` 完全冲突：

| 选项 | `base.json`（前端/基线） | server（后端） |
|------|------------------------|---------------|
| `module` | `ESNext` | `commonjs` |
| `moduleResolution` | `bundler` | `node` |
| `experimentalDecorators` | — | `true` |
| `emitDecoratorMetadata` | — | `true` |
| `noEmit` | `true` | `false`（SWC 需要 .js） |
| `verbatimModuleSyntax` | `true` | 与 CJS 不兼容 |

> 2026-08-08 收紧：后端启用 `strict: true`（仅保留 `strictPropertyInitialization: false`——NestJS 依赖注入属性由构造器装饰器初始化）。全仓 `tsc --noEmit` 零错误通过，含 `noImplicitAny`/`strictBindCallApply`/`strictFunctionTypes`。

### 4. 不用 TypeScript Project References

[ADR-0010](/content/adr/0010-no-ts-project-references.md) 明确否决了 Project References。

原因：
- 异构工具链不兼容（bundler vs node 模块解析）
- Vite/VitePress 不读 `references` 字段
- 后端有自己的 tsconfig，不参与交叉引用
- Turbo 的 `dependsOn: ["^build"]` 已解决构建顺序问题，不需要 TS 层面的引用

### 5. 类型检查作为独立任务

| 任务 | 前端 | 后端 |
|------|------|------|
| 类型检查 | `vue-tsc --noEmit` | `tsc --noEmit` |
| 构建 | `vite build`（不做类型检查） | `nest build`（SWC 编译） |

根 `turbo.json` 中 `types:check` 和 `build` 是**两个独立任务**，互不影响。

## 决策反转：从「不提取共享 tsconfig 包」到 `@walnut/tsconfig`

本文档此前有一节标题为「不提取共享 tsconfig 包（`@repo/tsconfig`）」，理由是「当前有 6 个共享包 + 3 个 tooling 包 + 3 个 app，root base + 各自 extends 已足够」。**该结论已于 2026-09-23 被推翻**（见 [ADR-0019](/content/adr/0019-tsconfig-presets-and-no-mjs.md)）。

旧判断只算了**数量**，没算**分化**：

1. **三个环境长出了不同需求**。基线里同时装着「Node 原生执行的可擦除语法约束」与「浏览器 + Vue 的 DOM/JSX」两类互斥假设，只能靠每个消费者自己覆盖——`erasableSyntaxOnly` 没法放进基线（会让浏览器包报错），DOM 与 Vue JSX 也不该发给纯逻辑包。拆成 `base` / `ts` / `vue` 后，「这个包在什么环境里跑」由**预设名**表达。
2. **每个消费者都在向上数目录深度**。`apps/*` 是两级、`packages/*/*` 是三级，同一个语义（继承共享基线）在不同文件里写成不同层数的 `../../../`；包一旦挪层，继承路径就得改。改成包名继承后，包挪到哪一层都不用动。
3. **提取的实际成本已经很低**。预设是纯 JSON，不需要构建、不需要 `tsc`；`turbo boundaries` 的 `tooling` + `platform-any` 标签已能覆盖它。

## 没做什么 / 为什么

### 不声明跨包 `paths`

按照 [ADR-0012](/content/adr/0012-toolchain-divergence.md)，`@walnut/contract` 和 `@walnut/utils` 在后端中通过 pnpm workspace symlink + `package.json` 的 `exports` 字段解析，不通过 tsconfig `paths`。这确保了开发环境和生产环境（如发布到 npm）的解析行为一致。

### 不直接参考后端的 tsconfig

后端的 `@walnut-server/*` 内部 lib 通过 tsconfig `paths` 映射（而非 pnpm workspace），这是它们唯一可行的解析方式——这些 lib 不是 pnpm workspace 包，没有 `package.json` 的 `exports` 字段。

### 不给预设包写 `types:check` 实体

`@walnut/tsconfig` 只有三个 `.json` 文件，没有可检查的 TS 源码，`types:check` 保留一句 `echo` 说明原因即可——为纯 JSON 预设跑 `tsc` 只会得到一个「没有输入文件」的错误。

---

## 相关 ADR

- [ADR-0010: No TypeScript Project References](/content/adr/0010-no-ts-project-references.md)
- [ADR-0012: Frontend-Backend Toolchain Divergence](/content/adr/0012-toolchain-divergence.md)
- [ADR-0019: 共享 tsconfig 预设包与「无 `.mjs`」约束](/content/adr/0019-tsconfig-presets-and-no-mjs.md)
