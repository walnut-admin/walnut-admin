# ADR-0029: 命令表与统一入口

**Date:** 2026-11-23
**Status:** Accepted

## Context

根 `package.json` 的 scripts 曾把仓库级命令平铺成一张六十余行的表，几乎全是一行委托。它带来三个
具体问题：

- **人要知道有什么能跑，只能通读一份 JSON**。agent 也一样，而且它读到的还是「值」（`turbo …`），
  不是「这条命令为什么存在」。
- **同一件事有两个家**。一条门禁既要写进根脚本，又要写进 prepush 门禁表 / 本地 CI 步骤表 / 发版
  电池，名字还对不上：三张表里写的是根脚本名，而根脚本可能再转发到 bin。任何一处改名，另一处只能
  等运行时（或等发版）才炸。
- **根脚本面没有判据**。「根 scripts 保持一句话委托」是散文约定；新增一条门禁该不该占根的一行，
  没有机械答案。

外部依赖面是清楚的：真正**按名字**从仓库外调用根脚本的只有三处 —— lefthook 的 pre-push
（`prepush`）、`.github/actions/decrypt-env`（`setup-env`）、文档站的 netlify 配置（`build`）。
其余调用都在仓库内部。

## Decision 1: 命令表是仓库级命令的唯一真源

`tooling/scripts/src/lib/commands.ts` 收录全部仓库级命令。每项有：稳定 id（沿用原来的脚本名，
文档里早已在用的名字一个都不用换）、分组、一句话说明、`why`（凭什么存在）、可选的预算，以及
执行形态 —— 经 pnpm 执行的 argv，或入口进程内的自定义函数。

表放在 `lib/` 层而不是 `ci/` 或 `run/`：它**不认识任何业务**（只认识 id / label / why / argv），
所以 `@walnut/release` 也能直接 import 它做按名解析，而不必把整份本地 CI 或入口拖进依赖图。

## Decision 2: 根只保留一小组，判据是外部契约、日常主干与 turbo 根任务

根 `package.json` 只留：`dev`、`build`、`lint`、`lint:fix`、`types:check`、`test`、`prepush`、
`setup-env`、`release`，以及入口 `walnut`。保留的判据：

1. **外部按名字调用它们**（契约）：`prepush`（lefthook）、`setup-env`（composite action）、
   `build`（netlify 配置）；
2. **人与 agent 都默认存在的命令**（主干）：日常开发、全仓 lint / 类型 / 测试，以及发版与 env 解密。

另有一条**不是命令入口**的例外：`lint:root` 也留在根。根 `turbo.json` 的 `//#lint:root` 任务要跑
根 `package.json` 里的同名脚本；脚本不在时 turbo 把任务标成 `<NONEXISTENT>`、一个任务都不跑却
退出 0（2026-11-23 实测：`Tasks: 0 successful, 0 total`），prepush 与发版电池的 `lint-root` 段会
静默空转。命令表里它写成 `['run', 'lint:root']` —— 定义只有根脚本一处，`pnpm walnut lint:root`
仍然可用。

其余命令（`lint:*` 门禁、`boundaries`、`madge:check`、`db:*`、`images:*`、`clean:all`、
`ci:local` …）住命令表，经 `pnpm walnut <id>` 执行。判据由测试机械核对：根脚本集合必须恰好等于
「入口 + 保留清单」；表中写成 `run <id>` 的命令必须有真实根脚本；任何一条以 argv 执行的命令不得
同时还是根脚本（一条命令只有一个家）。

## Decision 3: 入口的命令行契约与退出码

根脚本 `"walnut": "node tooling/scripts/bin/run.ts"`。契约：

- `pnpm walnut <id> [<id>…]`：按**表里的顺序**执行（不看命令行给的先后），一条失败不中断其余。
- `--list` / `--json`：纯文本清单 / 机器可读整表（agent 的入口）；`--help` 打用法；`--dry-run` 只打印将要执行的命令行，不执行。这四个是入口自己的选项，**只认第一个 id 之前的**：id 之后的旗标属于那条命令（`pnpm walnut db:seed:pg --dry-run` 是种子工具自己的演练，不是入口的）。命令自己也有叫 `--dry-run` 的旗标，入口若在命令后面继续认它，命令就会被「只打印不执行」地吞掉。
- 不带参数：标准输入是终端时进多选（上下键移动、空格勾选、回车执行；取消与空选都正常退出 0）；
  **不是终端时打印用法与清单并以「前置条件未满足」退出 2** —— 非交互的调用方绝不停在界面上。
- `--` 之后、或单条命令后面的旗标原样透传给命令，此时只允许选中一条命令。非旗标的词只有命令在表里声明了 `positionalArgs` 才算它的位置参数。
- 未知 id 直接报错并列出真实 id（与本地 CI 的 `--only=` 同一条理由：拼错一个 id 却「跑完了」，
  比跑红危险得多）。没声明位置参数的命令后面出现非 id 的词，也按这条报错：把它吞成参数的后果是
  只跑第一条、还显示通过。

退出码与全仓其它门禁同一套：0 通过 / 1 查出违规 / 2 前置条件未满足 / 3 有命令没跑（未验证）。
第 3 态**不是**通过，汇总里单列。

## Decision 4: 三张表保留各自的 argv 字面量，由执行器按名解析

prepush 门禁表、本地 CI 步骤表、发版电池**不改成从命令表派生**。它们保留原来的 argv 字面量
（如 `['lint:adr']`、`['madge:check']`、`['exec', 'turbo', 'run', 'lint']`），三处执行器在交给
`runArgs` 之前各加一遍 `resolveCommandArgv`：

- 首词是命令表 id ⇒ 换成该命令真正要跑的 argv（其余参数跟在后面）；
- pnpm 子命令（`exec` / `change`）或保留的根脚本名 ⇒ 原样返回；
- 其它 ⇒ 原样返回（解析器不是校验器）。

于是三张表与逐字钉着它们的测试都不必跟着根脚本瘦身改一遍；`pnpm walnut ci:local` 也改成了
argv 形态（`['exec', 'walnut-ci-local']`，参数由 bin 转发），因为本地 CI 要 import 解析函数，
留在自定义形态会让命令表与本地 CI 互为运行期依赖。

**为什么不把三张表并进命令表**：三张表回答的是三个不同的问题，各带不同的字段与预算 ——
prepush 是**并行**的门禁段（`label` / `why` / 逐段预算 / `followups`），本地 CI 是**顺序**的构建
步骤（顺序即依赖、每步预算、还有一个表表达不了的自定义步骤），发版电池有**暂缓 / 跳过**语义
（`skip` 理由、未验证记账）。并成一张表就要取字段的并集，并把三套独立的策略（并行度、顺序依赖、
暂缓）塞进同一种形状；以后再调其中一套，另外两套会被迫跟着改。按名解析拿到了「名字只有一个家」
的全部收益，代价只是三处各一行。

## Decision 5: 入口由 node 直接启动，不登记为 bin

入口在 `bin/` 下，但刻意**不在** `package.json` 的 `bin` 字段里。两条理由：

1. 命令表里有一条 `clean:all`，职责就是删掉根 `node_modules`。入口若经 `node_modules/.bin` 的
   垫片启动，就等于拆自己脚下的地板 —— Windows 上 cmd 逐行读批处理垫片，入口删完目录退出之后
   cmd 读不到下一行，整条命令以「系统找不到指定的路径」+ 退出码 1 收场（2026-11-23 实测，目录
   其实已经删干净）。由 node 直接启动没有这层垫片。
2. 顺带的收益：刚克隆、还没安装依赖的仓库里 `pnpm walnut --list` 就能用。这要求入口的运行期
   依赖图只有 `node:*` 内置模块（界面库是惰性 import）。

## Alternatives considered

- **让 CI 整份改调本地入口（一条命令跑完 quality 的所有门禁）**：CI 日志会从「一步一条结论」变成
  一整段，哪条红、改哪个文件都要翻日志；而且 quality / build / openapi 三个 job 的触发面不同
  （affected、secret 有无），一条本地入口表达不了。所以 CI 仍是一步一条门禁，只是每步改调入口。
- **CI 不经过入口、直接调底层命令（`pnpm exec turbo …` / `pnpm exec walnut-*`）**：这正是改造前的
  形态。命令表 id 会失去 CI 触发面，`gate-wiring.test.ts` 的「没有只有本地守的门禁」那条断言
  就无从成立；同一个门禁在本地与 CI 走两条命名路径，改名时只红一边。
- **把三张表并进命令表**：见 Decision 4 —— 三套不同的字段、预算与调度策略会被迫收敛成一张表的
  并集，且在每次调整其中一套时牵连另外两套。
- **把全部脚本继续留在根 `package.json`**：零迁移成本，但「通读 JSON 才知道有什么能跑」「同一件
  事两个家」这两个问题原样保留；根脚本面仍然没有机械判据。
- **把入口做成 bin（`walnut-run`）**：符合包的一般习惯，但 `clean:all` 会删掉入口自己的垫片，
  Windows 上无法以 0 收场；也会丢掉「未安装依赖时入口可用」这条收益。

## Consequences

- 仓库级命令的形状从「一张 JSON」变成「一张表 + 一个入口」；`pnpm walnut --list` 是唯一的清单来源。
- `ci.yml` 的 quality / build job、`release.yml` 的 verify job、`workflow-lint.yml` 的门禁步骤改成
  `run: pnpm walnut <id>`；`working-directory: apps/server` 下那些是 server 包自己的脚本，不动。
- 三张表的 argv 字面量未改；执行器各加一遍按名解析，`check-turbo-cache` 同时学会认入口形态
  （缓存污染守卫按 `--cache-dir` 是否出现在 `--` 之前判定）。
- `ci:local` 从自定义项改成 `exec walnut-ci-local`，自定义形态只剩 `clean:all`；入口对自定义形态的
  支持与其测试保留。
- 守卫的枢纽从「根脚本」改成「可执行的名字」（保留的根脚本 / 命令表 id / pnpm 子命令），
  扫描面下限改到命令表上；每个 bin 的引用面是「根脚本值 + 命令表 argv」两处。
- 代价：新增一条门禁多一步「命令表登记」；`pnpm walnut <id>` 比 `pnpm <id>` 多打一个词。
- 历史记录（ADR 正文、归档、过程记录）保留旧的根脚本名不改：它们记的是当时的事实。

## Related

- [ADR 0009](./0009-ci-quality-gates.md) —— 门禁的分层，以及「静默弱化」为什么是本仓反复要防的形态
- [ADR 0018](./0018-git-hooks-lefthook.md) —— pre-push 只调一条命令，清单在表里
- [ADR 0028](./0028-top-level-tooling-directory.md) —— tooling 成为顶层目录组；命令表住在其中
