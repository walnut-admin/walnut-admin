# 发布 & 发版指南

## 一句话版本

**按 `type(包名): message` 提交 conventional commits，发版一条命令：`pnpm release`。**

| 环节 | 谁负责 |
|------|--------|
| 版本号怎么定 | **pnpm 原生 release management**（`pnpm change` 写意图 → `pnpm version -r` 消费） |
| CHANGELOG 怎么出 | **git-cliff** 逐包渲染，由 `@walnut/release` 的 `src/release/changelog.ts` 写入（**唯一写入者**） |
| GitHub Release 正文 | `pnpm release` 生成的根 `changelog-latest.md`（随 release commit 提交） |
| 创建 GitHub Release | `.github/workflows/release.yml`（tag 推送触发，本地不调 API） |
| 发了什么 | 14 个包的版本号 + 各包 `CHANGELOG.md` + `changelog-latest.md` + `.changeset/ledger.yaml` + git tag `vX.Y.Z` + push（分支 + tag） |

> ⚠️ 本仓**不用** `@changesets/cli`。意图文件仍是 changesets 格式（`pnpm change` 沿用），但版本策略的
> 唯一真源是根 [`pnpm-workspace.yaml`](https://github.com/walnut-admin/walnut-admin/blob/main/pnpm-workspace.yaml) 的 `versioning` 段，
> `.changeset/config.json` 已删除。详见 [ADR 0011](/content/adr/0011-dependency-governance-release)。

## 版本策略：单一 fixed 组

```yaml
versioning:
  changelog:
    storage: registry        # changelog 由 git-cliff 写，pnpm 不落文件（避免同一版本两段）
  fixed:
    -                           # 单一组：全部 15 个 workspace 包永远同版本
      - '@walnut/admin'
      # … 其余 14 个
```

15 个包（`apps/*` 3 个 + `platform-any` 3 个 + `platform-web` 3 个 + `tooling` 6 个）**永远同一个版本号**，
发布 tag `vX.Y.Z` 因此永远有唯一来源（取组内版本，基准是 `apps/admin`）。

> `tooling` 那 6 个是 `@walnut/tsconfig` / `@walnut/eslint-config` / `@walnut/commitlint-config` /
> `@walnut/vitest-config` / `@walnut/scripts` / `@walnut/release`（前五个 2026-09-23 由
> `@walnut/tooling` 单包拆分而来、见 [ADR 0019](/content/adr/0019-tsconfig-presets-and-no-mjs)，
> `vitest-config` 同日为待办 P3-14 新增）。

### 为什么是「一组」而不是历史上的「Apps 组 + Packages 组」

pnpm 的 fixed 组**各自独立**。两个组的写法会留下一条结构性陷阱：一次**只动共享包**的发版
（如 `feat(utils): …`）只会 bump Packages 组、`apps/admin` 的版本不变 ⇒ 编排会命中
「版本号未变更，跳过发版」而退出 0，留下一个**已被 bump 却永远不会打 tag** 的脏工作区。

一个组从结构上消灭这条路径，也与 [ADR 0008](/content/adr/0008-unified-versioning-separate-deploy)
的标题（Unified Versioning）一致。

> 新增 workspace 包时**必须**把它加进 `versioning.fixed`，否则：
> `pnpm change check`（CI 与 pre-push 会跑）报锁步失败，且 `pnpm release` 第 1 步的
> fixed 组审计会直接拒绝发版（exit 1）。

## 提交纪律（发版的前提）

commitlint 强制（见 [`@walnut/commitlint-config`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/commitlint-config/index.ts)）：

**`type(包名): message`** —— scope 必填，且必须是包名或基础设施 scope：

```
feat(admin): 添加登录页
fix(server): 修复事务回滚
feat(utils)!: 破坏性 API 变更     ← breaking 用括号后感叹号
chore(release): v0.1.0            ← 发版记账提交专用 scope（不是包 scope）
feat(deploy): 部署后验证           ← 基础设施 scope
```

| 层 | scope |
|----|-------|
| apps | `admin` `server` `docs` |
| platform-any | `utils` `contract` `types` |
| platform-web | `client` `http` `ui` |
| tooling | `eslint-config` `commitlint-config` `tooling` |
| 基础设施 | `docker` `deploy` `pnpm` `release` |

> 白名单真源是 `packages/tooling/commitlint-config/index.ts` 的 `SCOPES`。`tooling` 这个 scope 保留给
> 工具链包的改动（`@walnut/scripts` / `@walnut/release` / `@walnut/tsconfig` 都在 `packages/tooling/` 下，
> 归属规则按**路径**命中这些包）；`release` 是**发版记账提交专用**的 infra scope（`chore(release): vX.Y.Z`），
> 不产生变更意图。

### 归属规则（决定「这条提交要不要发版」）

因为只有一个 fixed 组，归属不影响**版本号**（任何一条意图都会让整组一起升），它只决定
**这条提交是否产生意图**：

1. **路径优先**：提交改动的文件落在哪个包目录下（最长前缀）；一个提交可命中多个包。
2. **scope 兜底**：路径一个包都没命中时，用 commit scope 查表。
3. **否则不产生意图**：基础设施 scope（`docker` / `deploy` / `pnpm` / `release`）、未在册的 scope、
   以及只动仓库级文件（根配置、`.github/`、`deploy/`、文档站配置…）的提交。

> 第 3 条是刻意设计，不是「变更丢失」：凡真改了某个包的文件，第 1 条就会命中。
> 基础设施改动**不**带动产品版本号。

### bump 映射

| 前缀 | bump | 是否触发发版 |
|------|------|-------------|
| `feat` | minor | ✅ |
| `fix` / `perf` / `refactor` / `revert` | patch | ✅ |
| 破坏性变更（`type(包名)!:`） | major | ✅ |
| 无约定式前缀 | patch | ✅ |
| `docs` / `chore` / `style` / `test` / `build` / `ci` | skip | ❌ |

被过滤的噪声：`wip:`、`fixup!`、`squash!`、`tmp`、`draft`、纯数字，以及长度 < 4 的消息。

> 依赖升级（`chore(admin): upgrade vue`）默认不触发发版——刻意设计；想记录就手写一个意图。

## 发版一次的全过程

在 `main` 分支、工作区干净、已 `git pull` 的前提下：

```bash
pnpm release
```

六步（分节顺序即执行顺序）：

```
0   前置      分支=main / 未落后上游 / fixed 组已对齐 / 钩子已装 / GITHUB_TOKEN（可选）
1   生成意图  扫上次 tag 以来的 commit → 归属到包 → pnpm change --bump --summary <pkg…>
2   确认 bump 列出意图摘要 + 预期版本 → 交互确认，或 --bump 覆盖
3   消费意图  pnpm version -r --no-git-checks（版本 + ledger）
3.4 收走残留  删已记账的 .changeset/*.md；清 .changeset/changelogs/
3.5 changelog 逐包 git-cliff 渲染 → 写 <包>/CHANGELOG.md（幂等、空段跳过、渲染失败即中止）
3.6 notes     整仓本次发版段落 → 写根 changelog-latest.md（CI 的 Release 正文源）
4   总览确认  包归属 / bump / 版本 / 条目 / 将提交文件数 / 将推 refs / 无关改动 → Y/n
5   提交发布  git add -A → git commit -m "chore(release): vX.Y.Z"
              → 发版前全量电池 → git tag -a → git push --atomic origin main vX.Y.Z
6   完成       GitHub Release 由 release.yml 在 tag 推送后创建
```

常见退出路径（不是错误）：

| 输出 | 含义 |
|------|------|
| `没有可生成的变更记录，无需发版` | 有提交但全部是噪声 / 无归属 / 不触发发版 |
| `无需发版：标签 vX.Y.Z 已在远端、且没有新提交` | 已经在目标状态 |
| `全部 N 个意图都声明 none：本次不发版` | 意图集明确声明不发版 |

## 为什么「门禁在打 tag 之前」

`pnpm release` 在**打 tag 之前**跑一遍发版前全量电池（`release/steps.ts` 的 `RELEASE_BATTERY`）：

| id | 内容 |
|----|------|
| `hooks` | **第 0 步**：`pnpm hooks:check` —— 断言本机 git 钩子仍由 lefthook 托管。`prepush` 本身就是钩子调的（钩子没装时它根本不会跑），所以只有 `pnpm release` 这种**不经钩子**的入口才检查得到「本机门禁是否已静默失效」 |
| `boundaries` | `turbo boundaries` |
| `lint` | `turbo run lint`（所有包，不排任何包） |
| `lint-root` | `turbo run lint:root`（**根级文件**的 lint：`eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts`） |
| `types` | `turbo run types:check` |
| `types-root` | `pnpm types:check:root`（根 tsconfig 覆盖的 `eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts`） |
| `test` | `turbo run test` |
| `syncpack` | `syncpack lint` |
| `versioning` | `pnpm change check`（fixed 组锁步） |
| `workflows` | actionlint |
| `docs-refs` | `pnpm lint:docs-refs`（活文档正文里引用的 workspace 包名 / 仓库路径必须真实存在） |
| `adr` | `pnpm lint:adr`（ADR 形态：编号连续 / Status 在枚举内 / 四个必需小节 / index 双向对齐） |
| `doc-ts` | `pnpm lint:doc-ts`（标成 `ts` 的代码块必须能按 TypeScript 解析） |
| `doc-budget` | `pnpm lint:doc-budget`（常驻上下文文件不许膨胀，用不到一半也算失败） |
| `turbo-cache` | `pnpm lint:turbo-cache`（产物 / outputs / env 不变量） |
| `build` | ⏭️ **默认暂缓**：镜像由 `release.yml` 的 images job 真正构建；要跑就删掉表里那行的 `skip` |

> **这张表与 `packages/tooling/release/src/release/steps.ts` 的 `RELEASE_BATTERY` 必须一致** ——
> `steps.test.ts` 逐行钉住了它。加一段门禁时两边都要改（**注意：这里说的「逐行钉住」指的是
> 那个测试文件钉 `RELEASE_BATTERY`，不是本页**；本页的表格眼下仍靠人工同步，见
> [与参考仓 Z 的基建交叉对比](./reference-repo-comparison) 的 A1）。

> ⚠️ `types-root` 必须是**独立一行**、且经根脚本跑（`pnpm types:check:root`）—— 它只是根
> `package.json` 的脚本、**没有**对应的 turbo 任务，`turbo run types:check:root` 会直接以
> `Could not find task 'types:check:root' in project` 非 0 退出。
>
> **`lint-root` 曾经也是这个形态，2026-09-23 起不是了**：根 `turbo.json` 新增了 `//#lint:root`
> 根任务（带精确 inputs —— 就是根脚本那三个 glob），于是它改成走 `turbo run lint:root` 从而
> 可缓存（实测冷跑 3.8s → 热跑 0.11s）。**别按旧结论把它改回 `pnpm lint:root`** —— 那样会丢掉
> 缓存；也**别**把 `types-root` 改成 turbo，它到今天仍没有任务定义。判据：`turbo run lint:root`
> 与 `turbo run types:check:root` 各跑一次，前者 1 个任务、后者报 `Could not find task`。

**为什么是刻意的**：不跑门禁时，release 完全依赖 `git push` 顺带触发的 pre-push 钩子 ——
而 push 发生在打 tag **之后**。于是「本地全绿、发版成功、CI 的 verify 却红」是可达的，
那时远端已经有一个指向坏提交的 tag。放在打标之前 ⇒ 失败**不留本地 tag**，改完直接重跑。

失败时退出码非 0，且**不会**留下需要手工清理的本地 tag。
确实要带病发版：`--skip-gates`（门禁与电池一起跳）或 `--skip-gates=<id>[,<id>]`（只跳这几项）。
两者都会**写进 tag annotation**（第二段 `-m`），事后可审计。

## 只读面与 AI / 非交互用法

| 入口 | 说明 |
|------|------|
| `pnpm release --status` | 现在停在哪一步、下一步是什么、为什么（含工作区与远端事实） |
| `pnpm release --plan` | 同上，但按「计划」措辞 |
| `pnpm release --intent-only` | 只生成变更意图 |
| `pnpm release --dry-run` | 演练：打印将生成的意图 + 目标版本/tag + 后续命令链 |
| `pnpm release --json` | 人类日志全走 stderr，stdout 只放一个 JSON（含 `nextStep` / `version` / `tag`） |

交互**只在「是 TTY 且没给对应 flag」时**发生；非交互环境缺 flag 一律 `exit 2` 并说清缺什么，
**不猜、不挂**，且此时**尚未改动任何文件**：

| 交互点 | 人在终端 | AI / CI（非交互） |
|--------|----------|-------------------|
| ① 确认版本升级类型 | 回车取自动检测值，可输 `major`/`minor`/`patch` 覆盖 | `--bump major\|minor\|patch` |
| ② 变更总览确认 | 打印总览后 `Y/n` | `--yes` / `-y` |

### `--dry-run` 的边界

不写盘 ⇒ 待消费意图恒为 0 ⇒ **它只演练到第 1 步**，输出的是「将要生成的意图 + 目标版本 / tag +
后续命令链」（`--json` 里是 `wouldGenerate` / `toVersion` / `bump`）。
会写盘或联网的步（`pnpm version -r` / commit / tag / push / changelog 落盘）**不演练** ——
它们要么改工作区要么打远端。

它也不受「非交互必须给 flag」约束：缺 `--bump` 时采用自动检测档位并打印预览。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 完成（含「无需发版」「已在目标状态」） |
| 1 | 检出不一致 / 子步骤失败（fixed 组不一致、HEAD 版本复核失败、提交后工作区仍脏、门禁或电池未过、changelog 渲染失败、push 失败） |
| 2 | 前置条件未满足（不在 main、落后上游、fixed 组半升级、非交互缺 flag、未知 `--skip-gates` id） |
| 128+N | 信号中断（POSIX 130/143；Windows 上表现为 1） |

## 断点续跑

判定只看**可观测事实**（git / 工作区 / ledger / 远端 Release），不靠本机记忆：

| 停在哪 | 重跑会做什么 |
|--------|--------------|
| 意图已生成、未消费 | 直接进 bump 确认（意图正文里的 hash 是幂等键，不会重复生成） |
| 版本已 bump、changelog 没写完 | 幂等补写缺的那些包 |
| 版本已 bump、未提交 | 跳到总览确认 —— **不会**再 bump 一次 |
| 已提交、未打 tag / 未 push | 只补打 tag、只补 push |
| 一切都已发布 | 打印 `done` 与原因，退出 0 |

- `.changeset/.release-state.json`（gitignored）是**写前日志**：只让原因显示得更准，丢了也能正确接上。
- Ctrl+C / SIGTERM 有信号钩子：**先确认子进程树真的死了**，再按事实重算下一步、打印「停在哪、重跑怎么接」，
  然后按 shell 约定（128+N）退出。
- 「还有没有未消费的意图」以 `.changeset/ledger.yaml` 为准，**不看文件是否残留**。
- 补推只推不提交：只有「版本改动还没提交」时才 `git add -A` + commit。

### 需要人工介入的状态

| 现象 | 含义与处置 |
|------|-----------|
| `工作区不是可发版状态：fixed 组没对齐` | 上次消费被中断留下半升级状态。`git checkout -- .` 还原后重跑 |
| `已 bump 但还剩 N 个未消费意图` | 刻意不自动选「删」还是「重来」：在已 bump 的版本上再 bump 一档会打出错版本号的 tag。看一眼再决定 |
| `标签 vX.Y.Z 已存在，但它指向 …，而 HEAD 是 …` | 推它等于把别人的 commit 发布成这个版本。先查清是谁打的；确认重打：`git tag -d vX.Y.Z` |
| `拒绝打标：HEAD 上的 apps/admin 版本是 …` | release commit 没落到 HEAD（提交被钩子拒绝 / 跳过）。先查清再重跑 |
| `changelog 渲染失败` | **在打标之前中止**（放过去那一版的 changelog 就永远补不回来）。常见原因：`pnpm install` 没装全、`cliff.toml` 被改坏、GitHub API 不可达 |

## GitHub 集成

### Release 由 CI 创建，本地不调 API

`release.yml` 的 release job 在 `verify` + `images` 之后运行，用
`body_path: changelog-latest.md` 作为正文。那份文件由 `pnpm release` 生成并**随 release commit 提交**，
所以 CI checkout 到该 tag 时读到的就是本次的正文；旧 tag 重跑也能复现同一份正文。

发版机因此**不需要任何能改远端内容的凭据**。

### `GITHUB_TOKEN` 是可选的（只影响 changelog 的丰富度）

git-cliff 走 GitHub 原生 provider 补 **PR 号与作者**：

```bash
export GITHUB_TOKEN=<token>    # 可选；公开仓匿名也能查，但限流 60 次/小时
pnpm release
```

- 有 token：条目形如 `- [#12](…/pull/12) [`1a82770`](…/commit/1a82770…) by @user **admin** 支持记住登录状态`
- 无 token：Step 0 打一次明确警告，条目降级为 commit 链接 + 主题
- 要「缺 token 就硬失败」：`--require-github-meta`
- token **不落盘**（没有 `~/.config` 凭证文件），且**不进任何子进程**（`git push` 会触发本仓脚本）

### 想确认 Release 建好了

```bash
pnpm release --status      # 公开仓无需 token 即可查询远端 Release
```

## 关键文件

| 文件 | 作用 |
|------|------|
| [`pnpm-workspace.yaml`](https://github.com/walnut-admin/walnut-admin/blob/main/pnpm-workspace.yaml) | `versioning` 段 = 版本策略唯一真源 |
| [`.changeset/`](https://github.com/walnut-admin/walnut-admin/tree/main/.changeset) | 意图（`*.md`）、消费台账（`ledger.yaml`）、写前日志（gitignored） |
| [`cliff.toml`](https://github.com/walnut-admin/walnut-admin/blob/main/cliff.toml) | changelog 渲染规则 |
| [`lefthook.yml`](https://github.com/walnut-admin/walnut-admin/blob/main/lefthook.yml) | git 钩子唯一真源 |
| `packages/tooling/release/src/release/` | 发版编排（模块地图见该包的 README） |
| [`.github/workflows/release.yml`](https://github.com/walnut-admin/walnut-admin/blob/main/.github/workflows/release.yml) | tag 推送 → 镜像 → GitHub Release → 部署 |

> ⚠️ 这一表原本写的是相对路径（`../../../../../cliff.toml` 之类）——**层级数错了**，而且这些是
> **仓库文件、不是站点页面**，站点上也渲染不出来。2026-09-23 打开 VitePress 内置死链校验时被抓出来，
> 已统一改成 GitHub 链接。

## 相关 ADR

- [ADR-0011: Dependency Governance & Release Pipeline](/content/adr/0011-dependency-governance-release)
- [ADR-0008: Unified Versioning, Separate Deploy](/content/adr/0008-unified-versioning-separate-deploy)
- [ADR-0018: Git Hooks (lefthook)](/content/adr/0018-git-hooks-lefthook)
