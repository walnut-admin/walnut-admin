/**
 * 「推送前门禁」的**唯一门禁表** + 并行执行器。
 *
 * ## 为什么要有这个文件
 *
 * 在这之前，门禁是一条 `a && b && c && …` 的**单行 shell 串**写在根 `package.json` 的
 * `prepush` 里。两件事一起把它变成了维护负担：① 一行 300+ 字符，加一段得在中间找位置；
 * ② 同一份清单被**四处文档各抄一遍**（`AGENTS.md` / `README.md` / `package-scripts.md` /
 * ADR 0018）—— 正是本仓刚立的那条纪律「别在正文里写会腐烂的清单」的典型反例。
 *
 * 现在：**门禁表就是这个数组**，增删改都只看这一处；命令行只剩一个词 `pnpm prepush`
 * （= `walnut-prepush`）；文档只指向本文件。顺带拿到的两件事：
 *
 * - **并行**：表里绝大多数段是秒级的纯读盘检查，唯一的重活（`types:check`）以前只能排在
 *   它们后面干等。现在按有界并发跑，重活与轻活重叠。
 * - **每段耗时**：以前哪一段慢完全看不出来（`&&` 串只给一个总时间）。
 *
 * ## 为什么不搬进 `lefthook.yml`
 *
 * 曾经认真考虑过「pre-push 下写十几个 job」。**没搬的两个理由**：
 * ① `pnpm prepush` 这个名字被发版工具链引用着（`release/src/release/env.ts` 与
 *    `lib/child-run.ts` 都要在发版流程里剥掉 `LEFTHOOK*` 环境变量，否则发版时的 `git push`
 *    会递归触发它自己）—— 搬走等于让发版代码去认识一个钩子配置。
 * ② ADR 0018 给「收敛成单条命令」的理由（「被截断只会退化成命令不存在」）**是冲着旧
 *    simple-git-hooks 说的** —— 那时命令链真的被 postinstall 写进 `.git/hooks/*`。迁到 lefthook
 *    之后，生成的钩子文件里**一条门禁命令都没有**（它只是 `lefthook run "pre-push"` 的启动器），
 *    链进了跟踪面 —— 而 `lefthook.yml` 同样是跟踪面。那条理由在这儿已经不作数了。
 *
 * ## 顺序即执行顺序？不是
 *
 * 并行之后**完成顺序不等于表里的顺序**。表里的顺序表达的是「读起来该按什么顺序理解」，
 * 不是依赖关系 —— 表里各段之间**没有任何依赖**（都是只读检查，不产生产物给对方用）。
 * 哪天出现真有依赖的两段，就该把它们合成一段，而不是靠顺序兜。
 *
 * ## 三种结局，不是两种
 *
 * 一段门禁只有三种可能：**跑过且过了**、**跑过且没过**、**压根没跑**（本机没装 actionlint /
 * 没有 bash ⇒ 子进程按四态退出码报 3，见 `lib/errors.ts` 的 `SkippedError`）。
 *
 * 第三种以前被读成第一种（子进程 exit 0 + 本文件只在失败时回放输出 ⇒ 打的是对勾、汇总说「全部通过」），
 * 于是推送者以为验过了 —— 那是**机器在说谎**，不是文档没写清。现在：跳过行打 `-` 并注明
 * `[SKIP 未验证]`，**成功汇总里也单列**，段名逐段列出。默认**不**判红（没装工具的机器不该被
 * 挡在推送之外），要「未验证即失败」就 `PREPUSH_STRICT=1`。
 */

import process from 'node:process'
import { ChildRunError, runArgs } from '../lib/child-run.ts'
import { SKIPPED_EXIT_CODE, ViolationError } from '../lib/errors.ts'
import { err, line, out } from '../lib/log.ts'
import { getPnpmBin } from '../lib/pnpm-launcher.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

export interface PrepushGate {
  /** 稳定标识（出错信息、将来按名跑单段都用它） */
  id: string
  /** 人话标签（表里打印这一列） */
  label: string
  /** 经 `pnpm <argv...>` 执行 */
  argv: string[]
  /**
   * 同一段内的**后续步骤**（同样经 `pnpm <argv...>`，顺序执行，前一步非零即止）。
   *
   * 只给「一条结论必须由两条命令共同判定」的段用 —— 现在只有 `openapi` 段：先把生成物
   * 重新导出（argv），再断言暂存区与 HEAD 一致（followups，见那段注释里的 F-53）。
   */
  followups?: readonly string[][]
  /** 为什么它在**推送前**必须跑 —— 这一列是给人看的，也是「凭什么」 */
  why: string
}

/**
 * 推送前门禁表。**改动这张表就是改推送门禁**，所以每条都写清楚「凭什么」。
 *
 * 绝大多数段是**只读**检查；两个例外：`openapi` 段会重写生成物（openapi.json /
 * schema.d.ts —— 同步时逐字节不变，漂移时先写回工作区再红），`change check` 段只读
 * `pnpm-workspace.yaml` 与各 `package.json`（无副作用）。
 */
export const PREPUSH_GATES: readonly PrepushGate[] = [
  {
    id: 'boundaries',
    label: '架构边界（turbo boundaries）',
    argv: ['boundaries'],
    why: '包之间的依赖方向由 tags 声明。违规一旦合并进去，纠正成本远高于拦在推送前。',
  },
  {
    id: 'circular',
    label: '循环依赖（madge，apps/server 的 apps + libs）',
    // 经根 package.json 的 `madge:check` 转发到 apps/server 的 `madge` 脚本
    // （= madge --circular --ts-config tsconfig.json apps/api/src libs --extensions js,ts,tsx）。
    argv: ['madge:check'],
    why: '**环是唯一没有任何其它闸看得见的失效面**：boundaries 只看包与 tag 的方向（同一 app 内的 lib ↔ lib 不在它视野里）、ESLint 的分层规则只看**单条边的方向**（A→B 合法、B→A 也合法，两条同时存在就成环）、tsc 对环完全不报错。2026-11-02 实测成本：**10.3s / 1050 个文件**，与本表里 knip 量级相当，与最慢的 lint / types 并行跑不会顶高总时长。此前这条命令**只存在于 apps/server 的 scripts 里、没有任何闸在跑它** —— 留着一条没人跑的命令比没有更糟：它是「0 环」这个结论的唯一来源。',
  },
  {
    id: 'lint',
    label: 'lint 各包（turbo run lint，不排任何包）',
    argv: ['exec', 'turbo', 'run', 'lint'],
    why: '**这一段的缺位被实测抓到过**（留档 V14）：`prepush` 原先只有 `lint:root`，而 `lint-staged` 的 glob 是 `*.{ts,vue,js}` ⇒ **纯 JSON / 非 TS 文件**的 lint 问题在推送前**没有任何一段看得见**，只在 CI 的 `Lint (affected)` 现形（当时改的是 `tsconfig.dts.json`，本地 18 段全绿、CI 会红）。发版电池里一直有这一段，prepush 漏了；走的也是 turbo，所以没改动的包命中缓存、冷跑才是全量。',
  },
  {
    id: 'lint-root',
    label: 'lint 根级配置（turbo run //#lint:root）',
    // 走 turbo 而不是直接 `pnpm lint:root`：根任务有精确的 inputs（就是脚本里那三个 glob），
    // 没改根级文件时命中缓存 —— 实测冷跑 3.8s / 热跑 0.1s（以前每次 push 都真跑 12s 上下）。
    argv: ['exec', 'turbo', 'run', 'lint:root'],
    why: '根级文件（`eslint.config.ts` / `knip.config.ts` / `package.json` / `pnpm-workspace.yaml`）**不在任何包的 lint 范围里**（它们不进 turbo 的包图），所以必须单独一段。',
  },
  {
    id: 'types',
    label: '类型检查（不排任何包）',
    argv: ['exec', 'turbo', 'run', 'types:check'],
    why: '唯一的重活。它必须**不排包**地跑 —— 排包会让「被改动的包依赖的包」漏检。',
  },
  {
    id: 'types-root',
    label: '根级配置类型检查（pnpm types:check:root）',
    argv: ['types:check:root'],
    why: '与 `lint:root` 同理：根 `tsconfig.json` 覆盖的那几个配置**不入 turbo 的图**，没有这一段就没人检查它们的类型。',
  },
  {
    id: 'test',
    label: '测试（turbo run test，不排任何包）',
    // 位置上跟发版电池（steps.ts 的 RELEASE_BATTERY）对齐：都在 types-root 之后。
    argv: ['exec', 'turbo', 'run', 'test'],
    why: '**这一段的缺位被实测抓到过**（2026-11 · 批次 2 R3）：`@walnut/release` 的电池表加了 circular 行，而 fixture 与 release.md 电池表没同步 ⇒ 2 个用例红 —— 这类失败**只有 test 段看得见**，而 prepush 当时 25 段里没有它，于是红着照样推得出去（发版电池里一直有这一段，prepush 漏了）。走的也是 turbo，所以没改动的包命中缓存、冷跑才是全量。',
  },
  {
    id: 'syncpack',
    label: '依赖一致性（syncpack）',
    argv: ['syncpack:lint'],
    why: 'workspace 内部引用必须是 `workspace:*`、版本必须走 catalog。版本漂移在发版时才炸，代价高。',
  },
  {
    id: 'workflows',
    label: 'workflow 校验（actionlint）',
    argv: ['lint:workflows'],
    why: '`.github/workflows` 只被 GitHub 在**真正触发时**校验 —— 一个非法表达式能让整条流水线「启动即失败、0 个 job」，本地不拦就只能在 push 后发现。',
  },
  {
    id: 'workflows-shell',
    label: 'workflow shell 语法（逐块 bash -n）',
    argv: ['lint:workflows-shell'],
    why: 'actionlint 只看 YAML 与表达式，**看不见字符串里的 shell 语法**：2026-09-30 两次实测（注入步骤的三层嵌套引号、以及带引号 heredoc 的缩进）都只能靠发版撞出来。这道闸把 shell 块的语法错提前到推送前。本机没有 bash 时明确 SKIP。',
  },
  {
    id: 'dynamic-imports',
    label: '动态 import 说明符必须是字面量（apps/**）',
    argv: ['lint:dynamic-imports'],
    why: '拼出来的模块说明符（模板插值 / 非字面量）在 tsc 与 vite build 里都不报错，只在运行期抛 Unknown variable dynamic import —— 2026-11 那次 @walnut/ui 抽包留下的 Base:Switch 静默不渲染就是这么来的。静态扫描能在推送前毫秒级发现它。',
  },
  {
    id: 'docs-refs',
    label: '文档引用校验（包名 / 仓库路径）',
    argv: ['lint:docs-refs'],
    why: '活文档正文里引用的包名与仓库路径必须真实存在。VitePress 内置只查 markdown 链接语法，反引号里的引用它看不见。',
  },
  {
    id: 'adr',
    label: 'ADR 形态校验（编号 / 状态 / 小节）',
    argv: ['lint:adr'],
    why: 'ADR 的编号连续、`Status` 在枚举内、四个必需小节齐备、`index.md` 双向对齐 —— 没有任何现成工具管这件事。',
  },
  {
    id: 'doc-ts',
    label: '文档代码块校验（ts 块必须能解析）',
    argv: ['lint:doc-ts'],
    why: '标成 `ts` 的围栏块必须能按 TypeScript 解析（JSON 别标成 `ts`、别截断/乱码）。这类块坏掉时读者看到的语法高亮全错，但构建不会报。',
  },
  {
    id: 'doc-budget',
    label: '文档字数预算（常驻文件不许膨胀）',
    argv: ['lint:doc-budget'],
    why: '根 `AGENTS.md` / `CLAUDE.md` / 包级指引是**每次会话都进上下文**的常驻内容，膨胀了会挤掉别的东西；预算用不到一半同样算失败（那种预算已经失效）。',
  },
  {
    id: 'emoji',
    label: '注释与常驻文档里不许有 emoji（跨所有被跟踪文本文件）',
    argv: ['lint:emoji'],
    why: 'emoji 在非 UTF-8 代码页的终端里**必然**显示成乱码（中文有稳定双字节表示、emoji 没有：`⚠️` 是基础字符 + 变体选择符，`🚀` 之类更是代理对），也会污染 diff 与日志。ESLint 那条本地规则只覆盖 ESLint 能 lint 的文件，`.github/workflows/*.yml` / `.gitignore` / `cliff.toml` / `deploy/nginx/*.conf` / `lefthook.yml` 全在覆盖面之外（实测漏掉过 20 处），所以用一段跨文件类型的门禁兜住；常驻上下文文档走更严的一档（任意位置，不只注释）。',
  },
  {
    id: 'seed',
    label: '初始化数据形态（必需集合 / 禁入集合 / 体积 / 凭据形状 / 引用完整性）',
    argv: ['lint:seed'],
    why: '这份数据**随仓库发布、并被 `db:seed` 直接灌进库**，失效方式全是静默的：有人把 `app_key`（真私钥 PEM、AES keyB64）或凭证表手工导进来 = 私钥进公开仓；有人塞 `shared_area` = 89MB 进 git 历史；有人直接 dump 未裁剪的 `sys_user` = 开发者本人账号被发布（原始导出里就有）；引用被改坏（角色指向不存在的菜单）= 登录后侧边栏空掉且不报错。判据全落在数据本身、不需要数据库，所以能进这道闸。',
  },
  {
    id: 'openapi',
    label: 'OpenAPI 一致性（导出 → 生成 → git diff + git diff --cached）',
    // 经根 package.json 的 `openapi:check` 转发到 apps/server 的同名脚本；那里是**两段**：
    //   段① `openapi:check:export` —— 引导 AppModule 重导 openapi.json（要 PG/Redis + env）
    //   段② `openapi:check:schema` —— openapi.json → @walnut/api-types 的 schema.d.ts（**不要 AppModule**）
    // 两段各自 `git diff --exit-code`，所以失败时能一眼看出是「DTO 改了没重导」还是「重导了没重生成」。
    argv: ['openapi:check'],
    // F-53（DOC-18）边界①：`git diff --exit-code` 只比**工作区 vs 暂存区** —— 生成物一旦
    // 已经 `git add` 进暂存区，重导出后工作区与暂存区逐字节一致，这道闸直接绿；而真正会被
    // 推送出去的是 **index vs HEAD**（那个 commit 里躺着的是旧生成物）。所以补第二条命令：
    // `git diff --cached --exit-code` 只比 index vs HEAD。推送前本来就该「改动全部已提交」，
    // 它非零就说明生成物没进 commit（或暂存了不该提交的东西）—— 那就是必须红。
    // 用 --stat 只为把失败输出压成一行改动统计：openapi.json 是全量重排，整份 diff 上万行，
    // 灌进门禁失败回放里等于没人看得见结论。
    followups: [
      ['exec', 'git', 'diff', '--cached', '--exit-code', '--stat', '--', 'apps/server/openapi.json', 'packages/generated/api-types/src/schema.d.ts'],
    ],
    // 剩下的边界面（F-53）：
    // 边界② **已修（2026-11 批次 4 · D9）**：原来 fork PR 拿不到 secret `ENV_KEYS` ⇒ CI 的
    //   openapi job 整段跳过，最需要它的贡献者路径上恰好缺位。现在 check 拆成两段，
    //   CI 在 `DOTENVX_KEYS == ''` 的分支里硬跑段②（`pnpm openapi:check:schema`）——
    //   它只读 openapi.json、不需要引导 AppModule、不需要数据库，所以没有秘密也能硬失败。
    // 边界③ `openapi:check` 会**改写工作区**（openapi:export 写 openapi.json，
    //   openapi:generate 写 schema.d.ts）—— 它红的时候工作区已经被改过了：别当成「只是检查
    //   没过」，先看 git diff 判断改动是真实的新生成物还是被旧环境写脏。
    why: '前端类型真源是 server 装饰器反射出的 openapi.json（`@walnut/api-types` 的 schema.d.ts 从它生成）。server DTO 改了而生成物没跟着重导出时，前端类型就在静默说谎，且没有任何编译错误——只有这里重跑「导出+生成+diff」能看见。注意：导出要引导 AppModule，本地需要 `pnpm setup-env` 解密出的 env-local 与 WSL 容器（PG 5432 / Redis 6379）在线，环境不在时这一段必然失败——修好环境再推，不许为此摘闸。',
  },
  {
    id: 'dts',
    label: '手写 .d.ts 检查（关掉 skipLibCheck，只报仓库内文件）',
    argv: ['lint:dts'],
    why: '`skipLibCheck: true` 跳过的是**全部** `.d.ts`，含我们自己写的那十几份 ⇒ 手写 `.d.ts` 里解析不了的写法会**静默退化成 any**，错误只在消费方漏出来（移除 auto-import 时就是这样：`types.d.ts` 借的全局 `Ref` 一走，报出来的却是 `user-scroll.ts` 里一句「参数隐式 any」）。首跑抓到 16 处诊断 / 6 个文件（含两处 PWA 残留、一个从未存在的模型引用、两处 `@types/gtag.js` 误用）。',
  },
  {
    id: 'turbo-cache',
    label: 'turbo 配置不变量（缓存边界 + tags）',
    argv: ['lint:turbo-cache'],
    why: 'turbo.json 里漏一个产物目录、少挂一条依赖边、tags 写错一个字符，症状全是**静默的** —— `FULL TURBO` + exit 0，但门禁回放了旧结论，或那个包**根本没被 boundaries 检查**。2026-09-23 实测到前者（`pnpm build:stage` 报成功却一个文件都没产出）。',
  },
  {
    id: 'lockfile',
    label: 'catalog 与锁文件锁步（catalog ↔ pnpm-lock）',
    argv: ['lint:lockfile'],
    why: '「升级依赖」在本仓 = 改 catalog 一行，而改了声明忘了 `pnpm install` 时**本地必然全绿**（所有门禁都用既有 node_modules）、**CI 必然红**（`--frozen-lockfile`），连打 tag 的发版面一起炸。这是唯一看得见它的地方。',
  },
  {
    id: 'nginx-headers',
    label: '入口 nginx 安全响应头（conf.d）',
    argv: ['lint:nginx-headers'],
    why: 'nginx 的 `add_header` 是**整段替换**不是合并：某个 location 自己写了一条，就把 server 级的 4 个安全头全吃掉；两个并列的 `server` 块之间也不互相继承（2026-09-23 实测 `api.conf` 一个头都没有）。本机没有 Docker ⇒ `nginx -t` 都跑不了，这是唯一在推送前能看见它的地方。',
  },
  {
    id: 'exports',
    label: '包 exports 形态（目标存在 / types 在前 / 与 main 一致）',
    argv: ['lint:exports'],
    why: '本仓共享包**不构建就被消费**（`exports` 指 `./src/**`）⇒ 写错一个字符的症状不是报错，而是解析到别的入口或**类型静默丢失**，往往在下游才炸；而这一面此前零判据（15 个包的 `exports` 全靠人工对齐）。',
  },
  {
    id: 'secrets',
    label: '源码密钥形态（凭据形状不许进仓库）',
    argv: ['lint:secrets'],
    why: '**服务端那道闸在 CI 之前**：GitHub 的 push protection 只认形状、分不出样本与真货，命中就拒掉整条 push。2026-09-23 实测被它拦下一次（一个测试夹具里写了云厂商样本 SecretId），而当时那段门禁表**全绿** —— 只在 CI 里拦等于没有，必须在推送前。',
  },
  {
    id: 'pre-hooks',
    label: '脚本前置钩子（vite / vue-tsc 前必须先跑生成）',
    argv: ['lint:pre-hooks'],
    why: '生成物移出跟踪面之后，**干净检出里没有它们**，而 vite 的检查器可能在生成之前就读 ⇒ 2026-09-24 实测把 CI 的 `Build admin` 打挂过（一串 `Cannot find name …`）。这一面的判据是一条命令就能核对的（读 package.json），拦在推送前的成本几乎为零，而漏到 CI 的代价是一整轮红灯 + 一次"改了东边坏了西边"。',
  },
  {
    id: 'versioning',
    label: 'workspace 版本锁步（pnpm change check）',
    argv: ['change', 'check'],
    why: '单一 fixed 组的成员必须**恒等于**「有 version 的包数」。新增包忘了加进组，会让发版在打 tag 之前失败。',
  },
]

/** 有界并发：门禁多是秒级的读盘活，但 `types:check` 会吃满 CPU，开太多只会互相拖。 */
const DEFAULT_CONCURRENCY = 4

/** 单段预算：门禁都是分钟以内的活；真卡住要能自己收掉，而不是拖住整次 push。 */
const GATE_BUDGET_MS = 5 * 60_000

/** 一段门禁的**三种**结局：跑过且过了 / 跑过且没过 / **压根没跑**（环境缺失，未验证） */
export type GateStatus = 'ok' | 'failed' | 'skipped'

export interface GateResult {
  gate: PrepushGate
  /**
   * 一字段表达三态。**刻意不再另留一个 `ok: boolean`** —— 两个字段一旦并存就是两个真源，
   * 「跳过」迟早被写成 `ok: true`（那正是这次要修的 bug 形态）。
   */
  status: GateStatus
  ms: number
  /** 捕获到的完整输出（并行下不直接转播，避免多路输出交织） */
  output: string
}

/**
 * 一段门禁的执行出口：抛异常 = 没通过（`ChildRunError.exitCode` 区分 3 = 未验证），正常返回 = 通过。
 *
 * 为什么可注入：三态里的「跳过」只有在**子进程真的报 3**时才出现，而现场卸载 actionlint 不现实。
 * 注入执行器之后，那条分支才有真用例（见 `__tests__/prepush.test.ts` 的 runGates 段）。
 */
export type GateExecutor = (gate: PrepushGate, write: (text: string) => void) => Promise<void>

/**
 * 缺省执行出口：经 `pnpm <argv…>` 跑本段。
 *
 * 为什么是工厂而不是常量函数：`getPnpmBin()` 要摸盘，一次 runGates 只该摸一次。
 * Windows 上也不能直接 `spawn('pnpm', …)`：PATH 上是 `pnpm.cmd`，而 `shell: false` 下 Node 24
 * 不再把 `.cmd` 当可执行文件解析 ⇒ ENOENT（实测）。走 lib/pnpm-launcher.ts 找那个真 exe，
 * 它同时保证 argv 不经 cmd.exe（`%VAR%` / `&` 不会被展开）。
 */
export function createPnpmGateExecutor(): GateExecutor {
  const pnpmBin = getPnpmBin()
  return async (gate, write) => {
    // argv + followups 是同一段的**一条结论**：顺序执行，任一步非零就整段失败（不继续下一步）
    for (const argv of [gate.argv, ...(gate.followups ?? [])]) {
      await runArgs(pnpmBin, argv, {
        // cwd 必须是**仓库根**：从子目录跑时 `pnpm <脚本>` 会解析到最近那个包的脚本
        cwd: REPO_ROOT,
        // 并行下不转播子进程输出（多路交织会糊成一片）；收进缓冲，失败时整段回放
        output: { write },
        // 探针（`$ pnpm …` 与心跳）也静音 —— 执行器自己会打印一行结果
        note: () => {},
        heartbeatMs: 0,
        budgetDefaultMs: GATE_BUDGET_MS,
      })
    }
  }
}

/**
 * 有解并发地跑门禁表，**按完成顺序**回调（并行下没有「表里的顺序」可言）。
 * 返回全部结果（仍然按表里的顺序排列，便于断言与汇总）。
 */
export async function runGates(
  gates: readonly PrepushGate[],
  onDone: (result: GateResult) => void,
  concurrency: number = DEFAULT_CONCURRENCY,
  execute: GateExecutor = createPnpmGateExecutor(),
): Promise<GateResult[]> {
  const results = new Map<string, GateResult>()
  let next = 0

  async function worker(): Promise<void> {
    while (next < gates.length) {
      const gate = gates[next++]
      if (!gate)
        return
      const started = Date.now()
      const chunks: string[] = []
      let status: GateStatus = 'ok'
      try {
        await execute(gate, text => chunks.push(text))
      }
      catch (error) {
        // 子进程按**四态**退出码回报（lib/errors.ts）：3 = 环境缺失、这一步没跑。不认 3 的话，
        // 跳过与失败在汇总里同形 —— 而这正是本文件这次要修的那件事。
        status = error instanceof ChildRunError && error.exitCode === SKIPPED_EXIT_CODE
          ? 'skipped'
          : 'failed'
        chunks.push(error instanceof Error ? error.message : String(error))
      }
      const result: GateResult = { gate, status, ms: Date.now() - started, output: chunks.join('') }
      results.set(gate.id, result)
      onDone(result)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, gates.length)) }, () => worker()),
  )
  return gates.map(gate => results.get(gate.id)!).filter(Boolean)
}

/**
 * 结果表格里的一行（纯函数，便于用例断言）。
 *
 * 三种标记**刻意用 ASCII 字形**（对勾 / 叉 / 短横）：表格靠 `padStart` 对齐，而 emoji 是**双宽**字符，
 * 混进去整列会歪（同一条理由见 `lib/log.ts` 的 `MARK` 注释）。
 * 跳过的行还要在尾巴上写明 `[SKIP 未验证]` —— 一个孤零零的 `-` 会被读成「无关紧要」，
 * 而这里要表达的恰恰相反：**它没验过**。
 */
export function formatLine(result: GateResult): string {
  const mark = result.status === 'ok' ? '✓' : result.status === 'failed' ? '✗' : '-'
  const secs = `${(result.ms / 1000).toFixed(1)}s`
  const note = result.status === 'skipped' ? '  [SKIP 未验证]' : ''
  return `  ${mark} ${secs.padStart(7)}  ${result.gate.label}${note}`
}

/**
 * 严格开关：`PREPUSH_STRICT=1` ⇒ 有跳过就判红。
 *
 * 为什么用环境变量而不是 argv：pre-push 由 lefthook 起（`pnpm --silent prepush`），
 * **传不了参数**；同族的 `PREPUSH_CONCURRENCY` 已经证明这条路通。
 * 默认关：没装 actionlint 的机器不该被门禁挡住推送 —— 但「没验过」必须看得见。
 */
const STRICT_ENV = 'PREPUSH_STRICT'

function isStrict(): boolean {
  const value = (process.env[STRICT_ENV] ?? '').trim().toLowerCase()
  return value === '1' || value === 'true'
}

/**
 * 严格模式下「有跳过」该判红的理由；不该判红时返回 `null`。
 *
 * 纯函数（读入参，不读 `process.env`）：它是「未验证是否算失败」这条口径的**唯一一句**，
 * 而口径这种东西必须有用例钉住 —— main() 会真跑整张表，用例碰不到。
 */
export function strictFailureMessage(strict: boolean, skippedIds: readonly string[]): string | null {
  if (!strict || skippedIds.length === 0)
    return null
  return `${STRICT_ENV}=1：有 ${skippedIds.length} 段跳过（未验证）—— ${skippedIds.join(', ')}。`
    + '装上对应的工具后重跑，或去掉这个环境变量（它默认关，只为「谁都不许把未验证当通过」的场景拧开）'
}

/** 一次 prepush 的**结论**（三态报数 + 跳过名单 + 严格开关的判决） */
export interface RunSummary {
  /** 三态报数行（真跑通过 / 跳过未验证）；永远存在，没有跳过时也不含跳过字样 */
  okLine: string
  /** 跳过单列行（没有跳过时为 `null`）：段名 + 「跳过不等于通过」+ 权威闸门指向 */
  skippedLine: string | null
  /** 严格模式下该判红的理由（非严格 / 无跳过 ⇒ `null`） */
  strictMessage: string | null
  failed: GateResult[]
  skipped: GateResult[]
}

/**
 * 把「跑完的那张表」变成「推给用户的那两行 + 一个判决」。
 *
 * 为什么抽成纯函数：**跳过必须单列**这条口径只在成功汇总里看得见，而 main() 会真跑整张表
 * （分钟级、还依赖本机环境），用例碰不到。抽出来之后这条口径有真用例钉住，
 * 也让「跳过在成功汇总里也可见」不是靠人读代码确认。
 */
export function summarizeRun(
  results: readonly GateResult[],
  totalSeconds: string,
  strict: boolean,
): RunSummary {
  const failed = results.filter(result => result.status === 'failed')
  const skipped = results.filter(result => result.status === 'skipped')
  const passed = results.length - failed.length - skipped.length
  const skippedIds = skipped.map(result => result.gate.id)
  // 有跳过时才追加那一段 —— 没有跳过时「0 段跳过」只是噪音；但只要**有**，它就必须出现在汇总里
  const skippedNote = skipped.length === 0 ? '' : ` / ${skipped.length} 段跳过（未验证）`
  return {
    okLine: `${results.length} 段：${passed} 段真跑通过${skippedNote}（总 ${totalSeconds}s）`,
    skippedLine: skipped.length === 0
      ? null
      : `未验证的段：${skippedIds.join(', ')}（本机环境缺失，跳过不等于通过；权威闸门见 .github/workflows/）`,
    strictMessage: strictFailureMessage(strict, skippedIds),
    failed,
    skipped,
  }
}

export async function main(): Promise<void> {
  const concurrency = Math.max(1, Number(process.env.PREPUSH_CONCURRENCY) || DEFAULT_CONCURRENCY)
  const started = Date.now()
  out(`推送前门禁：${PREPUSH_GATES.length} 段，最多并行 ${concurrency} 路（表在 packages/tooling/scripts/src/ci/prepush.ts）`)

  const results = await runGates(PREPUSH_GATES, result => out(formatLine(result)), concurrency)
  const total = ((Date.now() - started) / 1000).toFixed(1)
  const summary = summarizeRun(results, total, isStrict())

  if (summary.failed.length === 0) {
    // 三段式报数：真跑通过 / 跳过未验证（+ 跳过的段名）。**不再说「全部通过」** —— 那是谎。
    line('ok', summary.okLine)
    if (summary.skippedLine !== null) {
      line('skipped', summary.skippedLine)
      if (summary.strictMessage !== null)
        throw new ViolationError(summary.strictMessage)
    }
    return
  }

  // 失败才回放输出：成功时那些输出没人看，失败时它是唯一线索
  for (const result of summary.failed) {
    err(`\n${'─'.repeat(20)} ${result.gate.label} 失败（${(result.ms / 1000).toFixed(1)}s） ${'─'.repeat(20)}`)
    err(`为什么必须有这一段：${result.gate.why}`)
    err(result.output.trimEnd() || '（这一段没有输出，只有非零退出码）')
  }
  // 这一行是**明细**（哪几段、各自耗时），不带标记 —— 唯一那句结论由 `runCli` 打
  err(`${summary.failed.length}/${results.length} 段失败：${summary.failed.map(r => r.gate.id).join(', ')}（总 ${total}s）`)
  // 已经有失败时结论早就红了，但「还有几段没验过」仍要说 —— 严格口径在这里也只多一行，不改退出码
  if (summary.skippedLine !== null) {
    err(summary.skippedLine)
    if (summary.strictMessage !== null)
      err(summary.strictMessage)
  }
  throw new ViolationError(`${summary.failed.length} 段推送前门禁失败（明细见上）`)
}
