# `@walnut/scripts` —— 仓库级脚本的通用层

> **层判定问句**：这个模块认识「发版」吗？认识 → 它在 [`@walnut/release`](../release/)；不认识 → 它在这儿。
>
> 本包装**不认识业务的仓库基础设施**：纯逻辑工具（`lib/`）、仓库门禁（`ci/`）、env 加解密（`env/`）。
> 它自己也提供八个 bin，被根 `package.json` 直接调用。

## 入口（root scripts 经 bin 调用）

| bin | 根脚本 | 作用 |
|-----|--------|------|
| `walnut-lint-workflows` | `pnpm lint:workflows` | actionlint 校验 workflow（未安装时跳过，CI 强制） |
| `walnut-check-doc-refs` | `pnpm lint:docs-refs` | 校验**活文档正文**里引用的 workspace 包名与仓库路径是否真实存在 |
| `walnut-setup-env` | `pnpm setup-env` / `pnpm encrypt-env` | dotenvx 加解密 `env-encrypted/` ↔ `env-local/` |
| `walnut-check-git-hooks` | `pnpm hooks:check` | 断言 git 钩子由 lefthook 托管（防门禁静默消失） |

发版编排的 bin（`walnut-release`）在 [`@walnut/release`](../release/)。

## 对外接口：只有 `lib/*`

```jsonc
// package.json
"exports": { "./lib/*": "./src/lib/*.ts" }
```

`@walnut/release` 就是这样复用本包的通用能力（`import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'`）。
**收窄到 `lib/*` 是刻意的**：`ci/` 与 `env/` 是给本包自己的 bin 用的实现，不是给别的包 import 的 API ——
把它们也导出去，等于承诺两个没人调用、却必须保持兼容的入口。

## 模块地图

### `src/lib/` —— 通用能力（不认识任何业务）

| 模块 | 职责 |
|------|------|
| `repo-root.ts` | 从 `import.meta.dirname` 向上找 `pnpm-workspace.yaml` + `.git` 定位仓库根 |
| `git.ts` | **只读** git 查询：一条命令行一个具名函数，argv 直传、cwd 固定仓库根、读不到返回 null/空集 |
| `child-run.ts` | 子进程执行：实况转播 + 心跳 + 预算 + 失败尾部缓冲；`sanitizeEnv` 剥凭据 |
| `child-tree.ts` | 进程树收尾（Windows 走 `taskkill /T /F`）—— 防「父进程退了、子进程还在改工作区」 |
| `child-output.ts` | 输出尾部缓冲（失败时重播最后 N 行） |
| `pnpm-launcher.ts` | 定位真实的 pnpm 可执行文件；**拒绝 `shell: true`**（`cmd.exe` 会展开 `%VAR%` 泄凭据） |
| `prompt.ts` | 终端交互：非 TTY 一律立即返回空串，绝不挂住 |
| `log.ts` | `writeOut`（TTY 走 stream / 管道走 `fs.writeSync`，Windows 代码页正确）+ `frame` 横幅 |
| `errors.ts` | `PreconditionError`（退出码 2 语义） |
| `ref-guard.ts` | ref 白名单：挡住选项形态（`-` 开头）与穿越形态（`..`）的注入 |
| `json-file.ts` | 读写 JSON（读不到返回 null，不抛） |

### `src/ci/` —— 仓库门禁

| 模块 | 职责 |
|------|------|
| `lint-workflows.ts` | actionlint（缺二进制时跳过并告警；CI 的 workflow-lint.yml 才是权威闸门） |
| `check-doc-refs.ts` | 活文档里的包名 / 仓库路径引用校验。**判据宁可漏报不可误报**：路径只在 markdown 反引号里查、必须顶层目录开头、允许语境解析（仓库根 / 文档目录 / `apps/server/`）；ADR 与待办文档因「合法引用历史路径」被排除；`ALLOWED_*` 豁免清单每条都要写理由 |
| `check-git-hooks.ts` | 断言三个钩子文件存在且含 lefthook 托管标记 |

### `src/env/` —— 环境文件

| 模块 | 职责 |
|------|------|
| `setup-env.ts` | dotenvx 加解密；纯变换（`rebuildKeysFile` / `stripPublicKeyHeaderContent`）已导出以便单测 |

## 两条硬约束

1. **本包源码由 Node 原生执行**（八个 bin + 被 `@walnut/release` 的 bin 间接拉起）。
   因此它继承 `@walnut/tsconfig/ts.json`，受 **`erasableSyntaxOnly`** 约束：
   不许 `enum`、不许非 ambient `namespace`、不许构造函数参数属性。
   违反会在 `pnpm types:check` 当场报错，而不是等到运行时才炸。

2. **`@dotenvx/dotenvx` 是本包自己的依赖**，`setup-env` 从它的 `package.json#bin` 解析出 CLI 入口、
   用 `process.execPath` 以 argv 拉起 —— **不再用 `npx dotenvx`**。
   原来的 `npx` 形态依赖「cwd 的 node_modules 里能找到 dotenvx」，依赖一下沉就会静默退化成联网下载；
   而且它经 shell，在 Windows 上还要额外处理 `.cmd`。

## 排查

| 现象 | 先看哪里 |
|------|----------|
| 门禁像是没跑 | `pnpm hooks:check`；再看 `pnpm-workspace.yaml` 的 `allowBuilds` 有没有 `lefthook: true` |
| `pnpm setup-env` 报找不到 dotenvx | 本包的 `node_modules/@dotenvx/dotenvx` 是否装上（`pnpm install`） |
| 单测报 `Cannot find module 'yaml'` | `yaml` 是本包的 devDependency（只有 lefthook 配置的审计用例需要它） |
