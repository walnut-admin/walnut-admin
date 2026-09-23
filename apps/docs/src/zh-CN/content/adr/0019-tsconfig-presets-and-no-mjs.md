# ADR-0019: 共享 tsconfig 预设包 与「无 `.mjs`」约束

**Date:** 2026-09-23
**Status:** Accepted

## Context

三件事在同一轮里被摆到台面上：

1. **`packages/tooling/scripts` 一个包装了太多东西** —— 11 个通用 `lib` 模块 + 20 个发版模块 +
   2 个门禁 + 1 个 env 工具 + 4 个 bin，职责横跨「通用能力」「仓库门禁」「发版编排」「env 加解密」。
2. **`tsconfig` 一直是根部的 `tsconfig.base.json`**，每个包用 `../../../tsconfig.base.json` 这种
   **按目录深度**的相对路径继承。仓内已有 12 个包 + 根自己，深度还不一致（`apps/*` 是两级、
   `packages/*/*` 是三级）。ADR 0010 与 `monorepo/typescript.md` 曾明确写过「不提取共享 tsconfig 包」，
   理由是「12 包规模下 root base 足够」。
3. **仓库里有 16 个 `.mjs` 文件**（5 个 eslint 配置：根 + 3 个 app + ui 包；eslint-config 的 4 个预设，
   含一把 249 行的 NestJS 装饰器排序规则插件；commitlint 配置与 config 包；contract 的 build-barrel 脚本；
   4 个 bin），与仓内其余的 `.ts` 代码形成两套心智模型。

## Decision

### 1. `packages/tooling/` 拆成 5 个包，按**耦合度**切

```
packages/tooling/
├── tsconfig/           @walnut/tsconfig           纯 JSON 预设（base / ts / vue）
├── eslint-config/      @walnut/eslint-config      ESLint 预设（base / vue / nest）
├── commitlint-config/  @walnut/commitlint-config  commitlint 规则
├── scripts/            @walnut/scripts            src/lib + src/ci + src/env，3 个 bin
└── release/            @walnut/release            src/release，1 个 bin（walnut-release）
```

**分界线一句话**：*这个模块认识「发版」吗？* 认识 → `release/`；不认识（纯工具、git 查询、子进程、
提示、门禁、env）→ `scripts/`。

- `@walnut/scripts` 只用 `exports: { "./lib/*": "./src/lib/*.ts" }` 对外暴露**通用能力**；
  `ci/` 与 `env/` 刻意**不导出** —— 它们是本包 bin 的实现，导出去等于承诺两个没人调用却要维持兼容的入口。
- `@walnut/release` 依赖 `@walnut/scripts`，按需 import `lib`（10 个模块）。
  `lib` 里不许出现「发版 / 包 / 意图」这类业务词；本包需要通用能力时**上提**到 `lib`。

**为什么不按能力切成 `script-lib` + `release` + `checks` + `env`（6~7 包）**：`ci/` 只有 2 个模块、
`env/` 只有 1 个，为它们各建一个包，收益（可读性）低于成本（每个包一套 `package.json` +
`tsconfig.json` + `turbo.json` + 依赖声明）。**按耦合度切**让每一边都足够大且内聚。

**为什么不学参考仓（一个 `@zhenfei/tooling` 装下 `scripts/{build,ci,dev,lib,local,release}`）**：
参考仓的 tooling 是**单包多目录**，本仓的 `release` 已经长到 20 个模块、且有独立的测试面与依赖
（`git-cliff`、`yaml`），把它留在一个「什么都装」的包里会让「谁依赖 git-cliff」这类问题无法从
`package.json` 读出来。

### 2. 提取 `@walnut/tsconfig`，删掉根 `tsconfig.base.json`

三个预设**按运行环境**分，不按「项目 / 库」分：

| 预设 | 用于 | 关键差异 |
|------|------|----------|
| `base.json` | 仓库根 `tsconfig.json`、`@walnut/eslint-config`、`@walnut/commitlint-config` | 只有与环境无关的语义 |
| `ts.json` | `platform-any/*`、`tooling/{scripts,release}` | `+ erasableSyntaxOnly` |
| `vue.json` | `apps/admin`、`apps/docs`、`platform-web/*` | `+ DOM lib, jsx, jsxImportSource: vue` |

- **`base.json` 不含 `lib` 之外的任何环境假设**（`jsx` / `jsxImportSource` / `types` /
  `erasableSyntaxOnly`）：它们都是环境假设。原 base 把 `jsx: preserve` + `jsxImportSource: vue` 放进基线，
  于是 `platform-any/*`（纯逻辑包）也拿到了 Vue JSX 支持 —— 一个假阴性，本轮一并修掉。
- 三层不是「继承链的中间层」：`base.json` 有**三个真实直接消费者**，它们都由 jiti / commitlint 的
  TS loader 加载（不经 Node 原生类型剥离），因此既不需要 `erasableSyntaxOnly`、也不需要 DOM lib。
- `@walnut/tsconfig` 自己的 `types:check` 仍是 `echo` —— 包里只有纯 JSON 预设，`tsc` 无事可做。
- `apps/server/tsconfig.json` **仍然完全不 extends 任何预设**（ADR 0012 的理由不变：
  CJS + `moduleResolution: node` + decorators 与 ESM + bundler 冲突）。

**为什么推翻了 ADR 0010 / `typescript.md` 里「不提取」的结论**：当时的理由是「12 包规模下 root base
足够」，那条判断只算了**数量**，没算**分化**。实际情况是三个环境已经长出了不同需求
（Node 原生执行 / 浏览器+Vue / 纯 JSON），而每个消费者还要写不同深度的 `../../../`。提取之后
「这个包在什么环境里跑」由一个**预设名**表达，且包挪到哪一层都不用改继承路径。

### 3. 全仓消除 `.mjs`，去掉 `tsx`

- 16 个 `.mjs` 全部改成 `.ts`（含那把 249 行的 NestJS 装饰器排序规则插件 —— 它此前是无类型的实验代码，
  本轮补齐类型并让它过 `tsc --noEmit`）。
- bin 由 **Node 24 的原生类型剥离**执行，不再 `import 'tsx/esm'`；`tsx` 也从仓库**彻底移除** ——
  最后一个使用者是 `apps/admin` 的 `predev` / `types:check:log`，两个脚本改走 `node`，`tsx` 的
  devDependency 与 catalog 条目一并删掉。
  代价是那两条链路必须满足 Node ESM 的解析规则：`build/utils/**` 的相对导入要写全 `.ts` 扩展名
  （Node 不做扩展名推断），`build/utils/log.ts` 里 `import pkg from '../../package.json'` 要补
  `with { type: 'json' }` 导入属性（ESM 不会替你猜 JSON 的模块类型）。
- 该不变量由 `ts.json` 的 **`erasableSyntaxOnly: true`** 在编译期保证：
  源码只要用了 `enum` / 非 ambient `namespace` / 构造函数参数属性，`pnpm types:check` 当场报错 ——
  而不是等到某个 bin 被调用时才炸。
- ESLint 加载 `eslint.config.ts` 需要 `jiti`，因此根 devDependencies 新增它。

**为什么值得**：`.mjs` 与 `.ts` 并存意味着「哪些文件能写类型、哪些不能」要靠记忆。
统一成 `.ts` 后，配置、预设、bin、构建脚本与业务代码是同一套心智模型，类型检查也覆盖到了配置层
（`@walnut/eslint-config` 的 `types:check` 此前是一句空跑的 `echo`，现在是真正的 `tsc --noEmit`）。

## Consequences

**变得更好：**

- 依赖边界可从 `package.json` 读出：`git-cliff` / `yaml` 在 `@walnut/release`，`@dotenvx/dotenvx` 在
  `@walnut/scripts`，`@antfu/eslint-config` 在 `@walnut/eslint-config`。
- 根 `package.json` 的 devDependencies **18 → 19 项**：去掉 `@antfu/eslint-config` / `@dotenvx/dotenvx` /
  `@walnut/tooling`（都是「只有某个包用」），加上 `@walnut/release` / `@walnut/scripts` /
  `@walnut/tsconfig`（根要经它们的 bin 与 tsconfig 预设）与 `jiti`。
  净增 1 项，但每一项都是**根自己真的用**的 —— 不再是「某个包的依赖搭根的车」。
- 类型检查覆盖到配置层与工具链（`@walnut/eslint-config` 与 `@walnut/commitlint-config` 的
  `types:check` 是真 `tsc --noEmit`；只有纯 JSON 的 `@walnut/tsconfig` 保持 `echo`）。
- `erasableSyntaxOnly` 把「Node 能不能跑这个文件」从运行期问题变成编译期问题。

**代价：**

- `packages/tooling/` 从 3 个目录变成 5 个包，每个包一套 `package.json` + `tsconfig.json` + `turbo.json`。
- 新增 `jiti` 一个依赖（ESLint 加载 TS 配置的官方要求）。
- `versioning.fixed` 单组从 12 个包涨到 14 个（新增 `@walnut/tsconfig` 与 `@walnut/release`，
  `@walnut/tooling` 消失）。
- **`nest.ts` 里对 `./nest-local-rules` 的导入刻意不写 `.ts` 扩展名** —— 它会被消费方
  （`apps/server`）的类型程序一起编译，而 server 的 tsconfig 按 ADR 0012 是自包含的、没有开
  `allowImportingTsExtensions`。写扩展名会让 `@walnut/server` 的 types:check 直接报 TS5097。

**顺带修掉的三个真实缺陷：**

- 重写那把装饰器排序插件时把顺序表里的 `ApiWalnutOkResponse` 写成了 `WalnutAdminOkResponse`，
  导致 11 个 controller 报出**假违规**。已用「三张顺序表与原文逐项比对」的方式验证一致
  （38 / 17 / 3 项全等）。
- 根级配置（`eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts`）此前**不被任何门禁覆盖** ——
  `prepush` 与 CI 都只跑包内任务。本轮把 `pnpm lint:root` 加进 `prepush`（当时为六段，
  2026-09-23 又补 `pnpm types:check:root` 后为七段）与 `ci.yml`
  的 quality job。
- 发版电池（`RELEASE_BATTERY`）里有一条写的是 `turbo run lint lint:root`，但 `lint:root` 只是根
  `package.json` 的脚本、**不是** turbo 任务 ⇒ 该命令以 `Could not find task 'lint:root' in project`
  非 0 退出，**每一次发版都会在打 tag 之前被它拦下**。已拆成两行：`turbo run lint` + `pnpm lint:root`。

## Related

- 修订 [ADR 0010](/content/adr/0010-no-ts-project-references) 与 `monorepo/typescript.md` 里
  「不提取共享 tsconfig 包」的结论
- 延续 [ADR 0012](/content/adr/0012-toolchain-divergence)（server 自包含 tsconfig，不变）
- 延续 [ADR 0017](/content/adr/0017-package-reorganization)（包分组：platform-any / platform-web / tooling）
- 与 [ADR 0011](/content/adr/0011-dependency-governance-release) 配套：发版编排迁到 `@walnut/release`，
  版本策略真源仍是 `pnpm-workspace.yaml#versioning`
- [ADR 0018](/content/adr/0018-git-hooks-lefthook)：`hooks:check` 的实现落在 `@walnut/scripts`
