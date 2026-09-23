# `@walnut/release` —— 发版编排

> **层判定问句**：这个模块认识「发版」吗？认识 → 它在这儿；不认识（纯工具、git 查询、子进程、提示）→
> 它在 [`@walnut/scripts`](../scripts/)。
>
> 唯一的 bin 是 `walnut-release`（根 `pnpm release`）。本包 `private`，不发布、不导出 API ——
> 所有 `export` 都是包内跨模块用；只在本文件内使用的符号**刻意不导出**（knip 会把没人 import 的
> export 报成死代码，而那正是它该报的）。

## 一次发版做了什么

```
0   前置      分支=main / 未落后上游 / fixed 组已对齐 / 钩子已装 / GITHUB_TOKEN（可选）
1   生成意图  扫上次 tag 以来的 commit → 路径优先归属到包 → pnpm change --bump --summary <pkg…>
2   确认 bump 列出意图摘要 + 预期版本 → 交互确认，或 --bump 覆盖
3   消费意图  pnpm version -r --no-git-checks（版本 + ledger）
3.4 收走残留  删已记账的 .changeset/*.md；清 .changeset/changelogs/
3.5 changelog 逐包 git-cliff 渲染 → 写 <包>/CHANGELOG.md（幂等、空段跳过、渲染失败即中止）
3.6 notes     整仓本次发版段落 → 写根 changelog-latest.md（CI 的 Release 正文源）
4   总览确认  包归属 / bump / 版本 / 条目 / 将提交文件数 / 将推 refs / 无关改动 → Y/n
5   提交发布  git add -A → commit "chore(release): vX.Y.Z" → 发版前全量电池
             → git tag -a → git push --atomic origin main vX.Y.Z
6   完成      GitHub Release 由 release.yml 在 tag 推送后创建（本地不调 API）
```

**它不做什么**：不建 GitHub Release（那是 `.github/workflows/release.yml` 的职责）、不改 workflow 文件、
不决定版本号（意图 + `pnpm version -r` 决定）。

## 模块地图

| 模块 | 职责 |
|------|------|
| `release.ts` | CLI 入口：参数 → 凭据 → 事实 → 阶梯 → 六步 → 中断收尾。**退出码、日志出口与 `ui` 的实现只在这里** |
| `ui.ts` | 步骤模块与 CLI 的**唯一接口**（日志 / 交互 / `die` / 子进程出口）：只声明不实现 |
| `args.ts` | flag 表 + 单趟解析 + 入口点互斥矩阵 + USAGE |
| `plan.ts` | **续跑阶梯**（事实 → 下一步 + 原因）+ changelog 段落提取 + Release 正文组装。纯函数 |
| `facts.ts` | 事实采集：git / 工作区 / ledger / 远端 Release → 一个 `ReleaseFacts` |
| `workspace.ts` | 只读视图 + 意图收尾：版本、fixed 组对齐、意图与 ledger、`deleteConsumedIntents()` |
| `intents.ts` | 意图解析（frontmatter → 包与 bump）+ `nextVersion` 判别式算术 + `parseFrontmatterLine` |
| `bump.ts` | 升级级别汇总（含 `none` = 不发版）+ frontmatter 改写。纯函数 |
| `commit-intent.ts` | 约定式提交 → 意图：bump 映射 / 噪声过滤 / 正文组装。不碰 git |
| `attribution.ts` | 提交 → 包归属（路径优先 → scope 兜底 → 否则不产生意图）+ fixed 组审计 |
| `generate.ts` | 第 1–2 步：从 commit 生成意图（`pnpm change`）+ 升级级别确认 |
| `consume.ts` | 第 3 步：`pnpm version -r` 的**有界预算 + 重试 + 半写入守卫** |
| `changelog.ts` | 第 3.5 步：逐包 git-cliff 渲染并写 `CHANGELOG.md`（**唯一写入者**）+ remote 一致性断言 |
| `notes.ts` | 第 3.6 步：写根 `changelog-latest.md`（**CI 的 Release 正文源**） |
| `github.ts` | GitHub REST **只读**：查某个 tag 有没有 Release + remote 解析 + token 掩码 |
| `credentials.ts` | `GITHUB_TOKEN` 解析（`--token` > 环境变量 > 无）。**不落盘** |
| `steps.ts` | 第 4–5 步：总览确认 → 提交 / 门禁电池 / 打标 / `--atomic` 推送 |
| `state.ts` | 续跑**写前日志**（`.changeset/.release-state.json`，gitignored） |
| `env.ts` | 发版子进程环境策略：哪些变量**不许**进子进程（凭据剥离） |
| `report.ts` | 文本构造：总览 / `--status` / `--plan` / 演练横幅 / 中断提示。纯函数 |

## 复用 `@walnut/scripts` 的哪些能力

`REPO_ROOT` · git 只读查询 · 子进程执行与进程树收尾 · 输出缓冲 · pnpm 启动器 · 终端交互 ·
日志写入（TTY/管道）· 前置条件错误 · ref 白名单 · JSON 读写。共 10 个 `lib` 模块。

**边界为什么这么切**：`lib` 里没有任何「发版 / 包 / 意图」的概念 —— 一旦出现，说明它该搬回本包的
`release/` 里；反过来，本包需要通用能力时**上提**到 `lib`，而不是让 `lib` 长出流程的私有实现。

## 续跑阶梯（`plan.ts`，纯函数）

判定只看**可观测事实**，不靠本机记忆：

```
① isBumped：工作区版本已离开上个 tag
             ├ bumpUncommitted（HEAD 版本 ≠ 工作区版本）→ confirm-summary
             └ 否则                                        → commit-tag-push
② stateStep==='consume-intents' 且 pendingIntents>0       → consume-intents
③ pendingIntents>0                                        → confirm-bump
④ localTag 有、remote 没有                                → commit-tag-push（补推）
⑤ localTag+remoteTag 有、分支未推、且未推提交正是 release 提交 → commit-tag-push（补推分支）
⑥ remoteTag 有、commitsSinceTag>0                         → generate-intents
⑦ remoteTag 有、无新提交                                   → done
⑧ 否则                                                     → generate-intents
```

**「已 bump」必须排在「有待消费意图」之前**——反过来的写法在「消费只删了一半意图」时会让重跑在已
bump 的版本上**再 bump 一档**，打出一个错版本号的 tag。这条顺序由 `__tests__/plan.test.ts` 钉住。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 完成（含「无需发版」「已在目标状态」） |
| 1 | 检出不一致 / 子步骤失败 |
| 2 | 前置条件未满足 |
| 128+N | 信号中断（POSIX；Windows 上表现为 1） |

细表见 `src/release/args.ts` 的 `USAGE`。

## 本包的执行方式

bin 由 **Node 原生执行 `.ts`**（Node 24 默认剥离类型），不需要 tsx —— 因此继承
`@walnut/tsconfig/ts.json`，受 **`erasableSyntaxOnly`** 约束（不许 `enum` / 非 ambient `namespace` /
构造函数参数属性）。违反在 `pnpm types:check` 当场报错。

## 排查

| 现象 | 先看哪里 |
|------|----------|
| 长时间没输出 | 第 5 步先跑分钟级的**全量电池**（每条都打 `▶️ 标签` + `$ 命令` + 心跳 + 用时），随后 push 又触发 pre-push |
| 卡在某步 | `pnpm release --status`（只读，会说清停在哪、下一步是什么、为什么） |
| 非交互报缺 `--bump` / `--yes` | 设计如此：AI / CI 场景显式传参，脚本不替你猜 |
| 某包的 changelog 没更新 | 看第 3.5 步逐包结果：「没有该包的条目」属正常；「渲染失败」会中止整个发版 |
