# ADR-0030: admin 构建配置抽出为 tooling 包

**Date:** 2026-11-24
**Status:** Accepted

## Context

`apps/admin/build/` 此前混着两类东西：

- **真正的 Vite 配置层**：插件封装（`vite/plugin/**`，含 iconify 的自定义插件）、开发代理
  （`vite/proxy.ts`）、环境变量的 zod schema（`vite/config/**`）、以及被插件用到的构建期读写
  工具（`utils/{log,fs}.ts`）。它们的消费者是「任何用 Vite 的前端 app」，与 admin 的业务无关。
- **只有 admin 自己用的 codegen**：`generate/genJSONSchemas.ts` 读 admin 的 `src/store/types.d.ts`、
  写仓库根的 `.vscode/settings-dev.schema.json`；`generate/index.ts` 是它的统一入口，顺带清理
  已废弃的 auto-import dts；`build/types.ts` 是把 `vue-tsc` 输出落盘的日志脚本。

两类东西的判据不同：前者问「换个 app 还能不能用」，后者问「这个 app 的生成物要不要更新」。
混在同一棵树下，`build/` 的职责只能靠逐个读文件才能回答，而配置层里的插件封装还静态 import 了
admin 的 `package.json` 与 app 专属约定（自定义元素、组件目录、resolver、iconify 扫描范围）。

## Decision 1: 配置层抽成 `tooling/vite-config`（`@walnut/vite-config`）

插件表、开发代理、环境变量 schema 与 `useBuildEnv` 的映射、构建期读写工具搬到
`tooling/vite-config/`，与其它工具链包同级（[ADR 0028](./0028-top-level-tooling-directory.md)）。
包暴露两个入口：根（`createVitePlugins` / `createViteProxy` / `useBuildEnv` / 三份 schema 与类型）
与 `/utils`（`BuildUtilsLog` / `BuildUtilsReadFile` / `BuildUtilsWriteFile` /
`configureBuildLogger`）。

它按「给仓库自己用、不随业务发布」的判据进 `tooling/`，因此也进 `pnpm-workspace.yaml` 的单一
`versioning.fixed` 组；commit scope 走 `tooling`，**不**在 commitlint 的 `SCOPES` 里单列（该文件的
口径：工具链包里只有 eslint-config / commitlint-config 单列，其余统一 `tooling`）。

## Decision 2: codegen 留在 admin，build 目录缩小而不消失

`build/generate/**`、`build/constant.ts`、`build/utils/paths.ts` 仍在
`apps/admin/build/`。判据是「只有 admin 的输入与输出」：codegen 读的是 admin 的 store 类型、写的是
仓库根的编辑器 schema。

`build/types.ts`（`types:check:log`）在 2026-11-24 的收尾里删除：它的唯一用途是把 `vue-tsc` 输出
落盘，命令写的还是 `npm run`（本仓规定只用 pnpm），且没有第二个消费者。

因此 `build/` 不会被清空，`lint:pre-hooks` 的判据（包内有 `build/generate/` ⇒ 跑 `vite` / `vue-tsc`
的脚本必须有 `pre<script>`）继续成立，无需改动。

## Decision 3: 包内不 import 任何 app 文件，调用方信息一律经 options 传入

`createVitePlugins(mode, env, options)` 的 `options` 就是「只有 app 才知道」的那部分事实：
`pkg`（banner / 日志前缀 / 分包名要用的包信息子集）、`isCustomElement`、`componentsDirs` /
`componentsDtsPath` / `componentsResolvers`、`iconify`（图标集、扫描范围、SVG 目录）、
`checkerWatchPath`。`ViteConfigPackageInfo` 刻意只列构建产物真正用到的字段，而不是整个
`package.json` —— 否则本包又得依赖调用方的清单形态。

理由：包要被不止一个 app 消费，而 app 的 `package.json` 与目录约定不是包能猜到的事实；反向
import app 文件还会让依赖图成环（app 依赖本包，本包又依赖 app），并破坏 boundaries 里
「工具链包不属于业务」的判据。

## Decision 4: 日志前缀是模块级配置（`configureBuildLogger`），不是逐函数参数

插件链路深处的调用点（iconify 的 `IconLog`、`fs` 的读写工具）都需要「当前 app 的包名」做前缀。
若改成给每个纯工具函数多传一个包名参数，等于给与职责无关的函数加参数，且要把包名穿过多层调用。
现在由 `createVitePlugins` 在入口处调一次 `configureBuildLogger(options.pkg.name)`；独立脚本
（admin 的 codegen 由 `node` 直接跑，不同进程）自己调一次。

代价：一个进程里同时给两个 app 建配置会互相覆盖前缀。本仓没有这种用法，且这是显式的
模块级状态而不是隐式全局 —— 读代码时看得见调用点。

## Alternatives considered

- **整体搬走（含 codegen）**：只有 admin 用 codegen，搬进共享包只能硬造参数去描述「读哪个类型文件、
  写到哪个 schema 路径」；这也与 `@walnut/contract` 把构建脚本留在包内的做法不一致（判据是
  「只有本包用的脚本跟着包走」）。搬过去只得到一个职责更杂的共享包。
- **不搬（配置层继续留在 admin）**：迁移成本为零，但「配置层与 app 代码混在一棵树上」的问题原样
  保留：插件封装继续静态 import admin 的 `package.json`，第二个 app 想复用只能复制粘贴。
- **日志前缀做成每个函数的参数**：见 Decision 4 —— 会给纯工具函数加与职责无关的参数，并把包名
  穿过多层调用；换来的只是「同进程多 app」这种本仓不存在的场景。

## Consequences

- **新 app 接入**：`devDependencies` 加 `"@walnut/vite-config": "workspace:*"`；`vite.config.ts` 按
  包 README 的样例组装（`useBuildEnv(loadEnv(...))` + `createVitePlugins` + `createViteProxy`）；
  `types/vite-env.d.ts` 用 `ViteImportMetaEnv` 接到全局 `ImportMetaEnv`；要用 iconify 的虚拟模块
  则 app 侧同时装 `@iconify/vue` 与 `@iconify/json`。加插件、加环境变量的步骤写在包的
  `README.md`，不在本 ADR 里重复。
- **实施时才发现的三件事**（6-A 的实测结论，留给以后换位置的人）：
  1. `@iconify/json`、`unplugin-info`、`unplugin-turbo-console` 必须同时留在 app 侧。前者的
     `@iconify/json/json/<set>.json` 与 `@iconify/vue` 由 dev 模式的**虚拟模块** import，要从
     app 的模块图解析；后两者的 client 类型由 app 的 `types/vite-refs.d.ts` 用
     `/// <reference types>` 引用。依赖搬走不会在包内报错，只会在 app 侧解析失败或类型消失。
  2. `unplugin-vue-components` 的 `dtsTsx` 默认值是 `isPackageExists('@vitejs/plugin-vue-jsx')`
     —— 从 **cwd 的包清单**里猜。插件依赖装到本包名下之后猜测会静默变成 `false`，被跟踪的
     `types/generated/components.d.ts` 会少掉 TSX 声明段，所以显式写 `dtsTsx: true`。
  3. 本包由 Vite 的配置加载链路经 **Node 原生类型剥离** `import()`，所以 tsconfig 走
     `@walnut/tsconfig/ts.json`（`erasableSyntaxOnly`），包内相对 import 一律带 `.ts` 扩展名。
- **缓存边界不用额外登记**：本包没有 `build` 脚本，但 `@walnut/vite-config#build` 仍在任务图里，
  其 inputs 覆盖包内源码；`@walnut/admin#build` 走 `^build` 已经吃到它。2026-11-24 用
  `turbo run build --filter=@walnut/admin --dry=json` 实测：改一行包内源码，admin#build 的 hash
  随之变化 ⇒ 不需要往根 `turbo.json` 的 `globalDependencies` 加条目。
- **插件开关（2026-11-24 落实）**：`VITE_DEV_CSP` 只管 dev，`VITE_BUILD_CSP` 与 `VITE_BUILD_LEGACY`
  是构建期的可选键（不配即关）；Sentry 的判据改成 `env.build.sentry.enabled`，不再对对象求真。
  实测结论：dev 与生产构建的 CSP 都能把 meta 注入 HTML；legacy 打开后 admin 的生产构建成功
  （产物含 `polyfills-legacy-*` / `vendor-legacy-*` 与 `<script nomodule>`），前提是显式给出
  `modernTargets` 去掉插件默认目标里的 es2020 聚合目标 —— 顶层 `await` 需要 ES2022，
  取舍记在包 README 的「已知限制」与 `src/plugins/legacy.ts` 的注释里。

## Related

- [ADR 0028](./0028-top-level-tooling-directory.md) —— tooling 成为顶层目录组，本包是其中的新成员
- [ADR 0019](./0019-tsconfig-presets-and-no-mjs.md) —— `ts.json` 的 `erasableSyntaxOnly` 与「无 `.mjs`」
- [ADR 0013](./0013-barrel-exports-policy.md) —— 包只暴露真实消费者用得到的入口（根与 `/utils`）
