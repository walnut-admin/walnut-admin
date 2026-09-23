# `@walnut/tooling` —— 仓库级脚本的家

> 一句话定位：本包装**仓库级**的脚本 —— 发版（`release/`）、仓库门禁（`ci/`）、env 加解密（`env/`）、
> 通用纯逻辑（`lib/`）。不对外导出：由根 `package.json` 的脚本经 `bin/` 调用。

## 入口（root scripts 经 bin 调用）

| bin | 根脚本 | 作用 |
|-----|--------|------|
| `walnut-release` | `pnpm release` | 发版唯一入口（六步 + 断点续跑） |
| `walnut-lint-workflows` | `pnpm lint:workflows` | actionlint 校验 workflow（未安装时跳过，CI 强制） |
| `walnut-setup-env` | `pnpm setup-env` / `pnpm encrypt-env` | dotenvx 加解密 `env-encrypted/` ↔ `env-local/` |
| `walnut-check-git-hooks` | `pnpm hooks:check` | 断言 git 钩子由 lefthook 托管（防门禁静默消失） |

`bin/*.mjs` 一律先 `import 'tsx/esm'` 再 import `.ts`：本包**没有构建步骤**，
源码由 tsx loader 直接执行，因此内部相对导入必须写显式 `.ts` 扩展名
（tsconfig 开了 `allowImportingTsExtensions`）。

## 模块地图

判据：**认识发版业务的留在 `release/`**；通用能力上提到 `lib/`（那里不认识任何业务）。
单测在各模块旁的 `__tests__/`，由本包套件跑（`pnpm --filter @walnut/tooling test`）。

### `src/release/` —— 发版专属

| 模块 | 职责 |
|------|------|
| `release.ts` | CLI 入口：参数 → 凭据 → 事实 → 阶梯 → 六步 → 中断收尾。**退出码、日志出口与 `ui` 的实现只在这里** |
| `ui.ts` | 步骤模块与 CLI 的**唯一接口**（日志 / 交互 / `die` / 子进程出口）：只声明不实现 |
| `args.ts` | flag 表 + 单趟解析 + 入口点互斥矩阵 + USAGE |
| `plan.ts` | **续跑阶梯**（事实 → 下一步 + 原因）+ changelog 段落提取 + Release 正文组装。纯函数 |
| `facts.ts` | 事实采集：git / 工作区 / ledger / 远端 Release → 一个 `ReleaseFacts` |
| `workspace.ts` | 只读视图 + 意图收尾：版本、fixed 组对齐、意图与 ledger、`deleteConsumedIntents()`、「发版自己会改的文件」判据 |
| `intents.ts` | 意图解析（frontmatter → 包与 bump）+ `nextVersion` 判别式算术 |
| `bump.ts` | 升级级别汇总（含 `none` = 不发版）+ frontmatter 改写。纯函数 |
| `commit-intent.ts` | 约定式提交 → 意图：bump 映射 / 噪声过滤 / 正文组装。不碰 git |
| `attribution.ts` | 提交 → 包归属（路径优先 → scope 兜底 → 否则不产生意图）+ fixed 组审计 |
| `generate.ts` | 第 1–2 步：从 commit 生成意图（`pnpm change`）+ 升级级别确认 |
| `consume.ts` | 第 3 步：`pnpm version -r` 的**有界预算 + 重试 + 半写入守卫** |
| `changelog.ts` | 第 3.5 步：逐包 git-cliff 渲染并写 `CHANGELOG.md`（**唯一写入者**）+ remote 一致性断言 |
| `notes.ts` | 第 3.6 步：写根 `changelog-latest.md`（**CI 的 Release 正文源**） |
| `github.ts` | GitHub REST **只读**：查某个 tag 有没有 Release（不建、不改）+ remote 解析 + token 掩码 |
| `credentials.ts` | `GITHUB_TOKEN` 解析（`--token` > 环境变量 > 无）。**不落盘** |
| `steps.ts` | 第 4–5 步：总览确认 → 提交 / 门禁电池 / 打标 / `--atomic` 推送 |
| `state.ts` | 续跑**写前日志**（`.changeset/.release-state.json`，gitignored） |
| `env.ts` | 发版子进程环境策略：哪些变量**不许**进子进程（凭据剥离） |
| `report.ts` | 文本构造：总览 / `--status` / `--plan` / 演练横幅 / 中断提示。纯函数 |

### `src/lib/` —— 通用能力（不认识任何业务）

`repo-root` · `git`（只读查询）· `child-run`（子进程执行）· `child-tree`（进程树收尾）·
`child-output`（输出尾部缓冲）· `pnpm-launcher` · `prompt`（终端交互）· `log`（TTY/管道写入）·
`errors`（前置条件错）· `ref-guard`（值白名单）· `json-file`

### `src/ci/` —— 仓库门禁

`lint-workflows.ts`（actionlint）· `check-git-hooks.ts`（钩子托管检查）

### `src/env/` —— 环境文件

`setup-env.ts`（dotenvx 加解密；纯变换函数已导出以便单测）

### 它们的 bin

`bin/release.mjs` · `bin/lint-workflows.mjs` · `bin/setup-env.mjs` · `bin/check-git-hooks.mjs`

## 两条硬边界

1. **步骤模块不 import CLI**。它们只接收 `ui.ts` 的 `ReleaseUi` 与 `ReleaseArgs`。
   于是「退出码是 0/1/2 哪一档」「日志走 stdout 还是 stderr」「子进程环境剥没剥凭据」
   这三件策略**只有 CLI 说了算**，与步骤体写在哪一层无关。

2. **凭据剥离是每个子进程都必须带的性质**。所有子进程统一经 `childOptions()` 工厂取环境
   （`RELEASE_CHILD_ENV` 已剥掉 `GITHUB_TOKEN` / `GH_TOKEN`）。理由：`git push` 会触发本仓的
   pre-push 钩子，那些脚本不该看到发版机的令牌；用 `--no-verify` 绕过是错的（那会拆掉本地门禁）。

## 退出码契约（`walnut-release`）

| 码 | 含义 |
|----|------|
| 0 | 完成（含「无需发版」「已在目标状态」） |
| 1 | 检出不一致 / 子步骤失败 |
| 2 | 前置条件未满足 |
| 128+N | 信号中断（POSIX；Windows 上表现为 1） |

细表见 `src/release/args.ts` 的 `USAGE`。

## 排查

| 现象 | 先看哪里 |
|------|----------|
| `pnpm release` 长时间没输出 | 第 5 步先跑分钟级的**全量电池**（每条都打 `▶️ 标签` + `$ 命令` + 心跳 + 用时），随后 push 又触发 pre-push。属预期 |
| 门禁像是没跑 | `pnpm hooks:check`；再看 `pnpm-workspace.yaml` 的 `allowBuilds` 有没有 `lefthook: true` |
| 发版卡在某步 | `pnpm release --status`（只读，会说清停在哪、下一步是什么、为什么） |
| 非交互报缺 `--bump` / `--yes` | 设计如此：AI / CI 场景请显式传参，脚本不替你猜 |
| 某包的 changelog 没更新 | 看第 3.5 步那行逐包结果：**没有该包的条目**属正常；「渲染失败」会中止整个发版 |
