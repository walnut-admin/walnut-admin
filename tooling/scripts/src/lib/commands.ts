/**
 * 仓库级命令的**唯一命令表**（`pnpm walnut` 的数据源）。
 *
 * ## 它收敛的是什么
 *
 * 根 `package.json` 的 scripts 曾把仓库级命令平铺成一张几十行的表（几乎全是一行委托）：
 * 人要知道有什么能跑，只能通读那份 JSON；agent 也一样。现在这些命令住进本文件 ——
 * 每项有稳定 id、分组、一句话说明与「凭什么存在」，入口（`pnpm walnut`）按它执行与列清单。
 *
 * ## 为什么在 lib 层
 *
 * 本模块**不认识任何业务**（只认识 `id` / `label` / `why` / `argv`），所以发版编排
 * （`@walnut/release`）将来也能直接 import 它，而不必把 `ci/` 或 `run/` 拖进依赖图。
 * 也正因为它会被别的包消费，这里**不出现任何副作用**：没有 I/O、没有 env 读取、没有 `process`。
 *
 * ## 两种执行形态
 *
 * - `argv`：经 `pnpm <argv…>` 执行（与三张表 —— prepush 门禁表、本地 CI 步骤表、发版电池 ——
 *   走同一条子进程通道）。原来委托给 bin 的写成 `['exec', '<bin>']`；带固定参数的照搬成数组元素。
 *   `argv` 是 `shell: false` 直传的，参数**不经 shell** —— 所以原脚本值里的引号要拆掉变成
 *   一个数组元素，带通配符的值（如 `--workspace` 的参数）整段是一个元素、通配符保持字面量，
 *   由工具自己展开。**前提是工具真的会展开**：eslint 与 knip 会；rimraf 默认把参数当字面路径，
 *   Windows 上带 `*` 的路径直接报「Illegal characters in path」。翻译一条带通配符的命令时先查这一点
 *   （`clean:all` 在逐条验证时就是这样失败的，2026-11-23；它后来干脆不再经 rimraf，见下）。
 * - `run`：自定义执行函数。现在只剩 `clean:all`（在入口进程里直接删，因为让 rimraf 删自己所在的
 *   目录做不到以 0 收场）。入口对自定义形态的支持保留着 —— 那是一条可用的形态，不是给这一项特设的。
 *
 * ## 保留在根的那些脚本
 *
 * `dev` / `build` / `lint` / `lint:fix` / `types:check` / `test` / `prepush` / `setup-env` / `release`
 * 仍留在根 `package.json`（外部按名字调用它们：lefthook、CI 的 action、netlify 配置），
 * 判据见 ADR 0029。表里给它们的 argv 是 `['run', '<id>']` —— 仍然由根脚本执行，命令行不必在两处各写一遍。
 *
 * ## 按名解析
 *
 * {@link resolveCommandArgv} 把「首词是命令表 id」的 argv 解析成真正要跑的 argv。三张表
 * （prepush 门禁表、本地 CI 步骤表、发版电池）的 argv 字面量保留原样，由各自的执行器在交给
 * `runArgs` 之前过这一遍 —— 表与逐字钉着表的用例因此都不必改。
 */

import { PRE_HOOK_CONSUMERS } from '../ci/pre-hook-consumers.ts'

/** 命令分组（顺序即清单里的展示顺序；表本身也按这个顺序排列） */
export type CommandGroup =
  | '开发'
  | '构建'
  | '门禁'
  | '依赖'
  | '数据库'
  | '环境'
  | '发版与镜像'
  | '工具'

export interface CommandBase {
  /** 稳定标识：`pnpm walnut <id>` 用的就是它，沿用根脚本名（文档里早已在用的名字一个都不用换） */
  id: string
  /** 分组（人的检索面；也决定清单里的先后） */
  group: CommandGroup
  /** 一句话说明（清单里打印这一列） */
  label: string
  /** 凭什么存在 —— 失败回放时跟着明细一起打出来 */
  why: string
  /**
   * 预算（毫秒；`<= 0` = 不设上限）。只给三类命令写：
   * - 有实测依据的长耗时命令（量级取自 `ci/local-ci.ts` 的步骤预算）；
   * - **常驻或交互式**的命令（开发服务、发版、可视化界面）—— 写 `0`，否则跑满默认预算会被收掉；
   * - **自己给各部分定了预算的编排型命令**（prepush、ci:local）与耗时没有上界的命令（images:*）——
   *   同样写 `0`：入口层再套一层全局上限，只会把「几段合法耗时加起来」判成卡死。
   * 其余不写 ⇒ 走 `lib/child-run.ts` 的默认预算。
   */
  budgetMs?: number
  /**
   * 位置参数的用法提示（如 `<name>`）。**声明了才接受位置参数。**
   *
   * 没声明的命令后面出现一个非旗标的词，入口不把它当参数透传，而是按「未知命令 id」报错：
   * 那多半是拼错的第二个 id —— 吞成参数的后果是只跑第一条还显示通过，正是 `run/args.ts`
   * 头注释里说的那种静默失效。要给没声明的命令传参数，写在 `--` 之后。
   */
  positionalArgs?: string
}

/** 经 `pnpm <argv…>` 执行的命令（argv 直传，永不 shell） */
export interface PnpmCommand extends CommandBase {
  argv: readonly string[]
}

/** 自定义执行函数：接收透传参数（`--` 之后、或单条命令后面的那一段） */
export interface CustomCommand extends CommandBase {
  run: (args: readonly string[]) => Promise<void>
}

export type Command = PnpmCommand | CustomCommand

/**
 * 仍留在根 `package.json` 的脚本（成员就是下面这份集合 —— 别在注释里再抄一份数量）。
 *
 * `resolveCommandArgv` 遇到它们**原样返回**：它们仍是真实根脚本，再展开成 `['run', …]`
 * 只是绕一圈（行为一致，但没必要）。这份清单是「保留」这件事的机械表达（入口 `walnut` 自己不在表里）。
 *
 * 其中 `lint:root` 是**唯一一条不是命令入口的保留项**：根 `turbo.json` 的 `//#lint:root` 任务
 * 要跑根 `package.json` 里的同名脚本，没有它 turbo 会把任务标成 `<NONEXISTENT>` 并**一个任务都不跑**
 * （2026-11-23 实测：`turbo run lint:root` 报 0 successful / 0 total、退出码 0）—— 那会让 prepush
 * 与发版电池的 `lint-root` 段静默变成空转。保留它是为了让 `turbo run` 有东西可跑。
 */
export const KEPT_ROOT_SCRIPTS: ReadonlySet<string> = new Set([
  'dev',
  'build',
  'lint',
  'lint:fix',
  'lint:root',
  'types:check',
  'test',
  'prepush',
  'setup-env',
  'release',
])

/**
 * 「首词是 pnpm 自己的子命令」时原样返回的那几个。
 *
 * 刻意只认三张表里真实出现的两个（`exec` / `change`）：任何加进来的词就不再可能被解析成
 * 命令表 id，而 pnpm 的子命令面比命令表大得多，多认一个就多一份与将来 id 撞名的风险。
 */
const PNPM_SUBCOMMANDS: ReadonlySet<string> = new Set(['exec', 'change'])

const MINUTE = 60_000

/**
 * 命令表。**顺序 = 清单顺序 = 多选执行顺序**（不看命令行给的先后）。
 *
 * 增删命令只改这一处 —— 根 `package.json` 只留保留的那几条（见 ADR 0029）；三张表的 argv 字面量
 * 由执行器按名解析，也不在这里重复。每条 `why` 说清「凭什么」，因为它也是失败回放里
 * 唯一能解释「为什么要有这一步」的文字。
 */
export const COMMANDS: readonly Command[] = [
  // ── 开发 ──
  {
    id: 'dev',
    group: '开发',
    label: '起前端 + 后端开发服务（turbo dev）',
    why: '日常开发的主命令；后端要连 PG / Redis，env 从 apps/server 的 env-local 读。',
    argv: ['run', 'dev'],
    budgetMs: 0, // 常驻进程，不设预算
  },
  {
    id: 'dev:server',
    group: '开发',
    label: '只起后端开发服务（turbo dev --filter=@walnut/server）',
    why: '前端已由别的实例起好时，只重启后端更快；后端必须从 apps/server 目录读 env。',
    argv: ['exec', 'turbo', 'dev', '--filter=@walnut/server'],
    budgetMs: 0,
  },
  {
    id: 'dev:docs',
    group: '开发',
    label: '文档站开发服务（端口 8886）',
    why: '改文档时用它看实时预览；死链校验只有构建（build:docs）才会做。',
    argv: ['exec', 'turbo', 'dev', '--filter=@walnut/docs'],
    budgetMs: 0,
  },
  {
    id: 'preview',
    group: '开发',
    label: '预览生产构建产物（turbo preview）',
    why: '产物起来的样子与 dev 不同（条件导出、压缩、env 内联），发布前值得看一眼。',
    argv: ['exec', 'turbo', 'preview'],
    budgetMs: 0,
  },

  // ── 构建 ──
  {
    id: 'build',
    group: '构建',
    label: '全量构建（packages → apps）',
    why: 'CI 与发版用的就是它；包多时内存吃紧，所以根脚本统一挂 NODE_OPTIONS。',
    argv: ['run', 'build'],
  },
  {
    id: 'build:admin',
    group: '构建',
    label: '只构建 admin（含依赖包）',
    why: '改前端时省掉 server 侧的构建时间；与全量构建共用同一份内存设置。',
    argv: [
      'exec',
      'cross-env',
      'NODE_OPTIONS=--max-old-space-size=8192',
      'turbo',
      'build',
      '--filter=@walnut/admin',
    ],
    budgetMs: 20 * MINUTE,
  },
  {
    id: 'build:server',
    group: '构建',
    label: '只构建 server（不含依赖包）',
    why: '后端改动后快速拿产物；worker 冒烟、openapi 导出、迁移都读 dist。',
    argv: [
      'exec',
      'cross-env',
      'NODE_OPTIONS=--max-old-space-size=8192',
      'turbo',
      'build',
      '--filter=@walnut/server',
    ],
    budgetMs: 15 * MINUTE,
  },
  {
    id: 'build:docs',
    group: '构建',
    label: '构建文档站（顺带死链门禁）',
    why: 'VitePress 构建本身就是死链校验：改文档、包名、仓库路径都可能把链接改死，而只有构建会报。',
    argv: ['exec', 'turbo', 'build', '--filter=@walnut/docs'],
    budgetMs: 10 * MINUTE,
  },
  {
    id: 'build:stage',
    group: '构建',
    label: 'admin 的 stage 构建（turbo build:stage）',
    why: 'stage 产物的 base 与后端地址跟正式构建不同；发版前由它产出那一份。',
    argv: [
      'exec',
      'cross-env',
      'NODE_OPTIONS=--max-old-space-size=8192',
      'turbo',
      'build:stage',
      '--filter=@walnut/admin',
    ],
    budgetMs: 20 * MINUTE,
  },
  {
    id: 'smoke:dist',
    group: '构建',
    label: '产物冒烟（真实浏览器打开 dist，断言 splash 消失）',
    why:
      '构建成功不等于跑得起来：缺一条条件导出时产物一执行就抛错、页面停在 splash，而 lint / 类型 / 构建全绿。' +
      '没有浏览器时脚本自己跳过。',
    argv: ['exec', 'walnut-smoke-dist'],
    budgetMs: 5 * MINUTE,
  },
  {
    id: 'clean',
    group: '构建',
    label: '清理各包的构建产物（turbo clean）',
    why: '排查「构建结果不对」时先清一次，避免读到上一次的 dist。',
    argv: ['exec', 'turbo', 'clean'],
  },
  {
    id: 'clean:all',
    group: '构建',
    label: '连 node_modules 一起清（全仓）',
    why: '依赖树被改坏时的最后手段；清完要重新 pnpm install，耗时以十分钟计。',
    // 不经 rimraf：它在 Windows 上既不展开通配符，又会删掉自己所在的目录，命令干完活却以失败收场。
    // 改在入口进程里直接删（理由见 run/clean-all.ts 的头注释）。
    // 惰性 import：与 ci:local 同一个理由 —— 命令表要能被别的包（如 release）单独消费。
    run: async () => {
      const { runCleanAll } = await import('../run/clean-all.ts')
      await runCleanAll()
    },
  },

  // ── 门禁 ──
  {
    id: 'lint',
    group: '门禁',
    label: 'lint 各包（turbo run lint）',
    why: '各包的 ESLint 走 turbo，没改动的包命中缓存；根级文件不在它范围内，另有 lint:root。',
    argv: ['run', 'lint'],
  },
  {
    id: 'lint:fix',
    group: '门禁',
    label: 'lint 并自动修复（turbo lint:fix）',
    why: '能机械修的样式问题一次修完；修完仍要跑 lint 确认没有剩下的。',
    argv: ['run', 'lint:fix'],
  },
  {
    id: 'lint:root',
    group: '门禁',
    label: 'lint 根级配置（eslint *.ts *.json *.yaml）',
    why: '根级文件不进 turbo 的包图，任何包的 lint 都覆盖不到它们。',
    // 保留为根脚本而不是写成 eslint 的 argv：根 `turbo.json` 的 `//#lint:root` 任务要跑根上同名
    // 脚本（prepush 与发版电池都用 `exec turbo run lint:root` 调它）。表里写成 run 形态，
    // 定义仍只有根 `package.json` 一处。
    argv: ['run', 'lint:root'],
  },
  {
    id: 'lint:root:fix',
    group: '门禁',
    label: 'lint 根级配置并自动修复',
    why: '与 lint:root 同一覆盖面，只是带上 --fix。',
    argv: ['exec', 'eslint', '*.ts', '*.json', '*.yaml', '--fix', '--concurrency=4'],
  },
  {
    id: 'lint:oxlint',
    group: '门禁',
    label: 'oxlint 快速检查（categories.correctness 兜底）',
    why: '通用正确性规则的第一道快速通道；Vue 模板、本地规则、类型感知分层仍归 ESLint。',
    // 在仓库根跑一次，不经 turbo（执行计划 §7.6 方案 R）：改 `.oxlintrc.json` 立刻生效，
    // 没有「缓存回放旧规则」的问题。`--fix` 的退出码不可信，判红只认这一条（不带 fix）。
    argv: ['exec', 'oxlint', '--quiet'],
  },
  {
    id: 'lint:oxlint:fix',
    group: '门禁',
    label: 'oxlint 自动修复',
    why: '能机械修的一次修完；修完仍要跑 lint:oxlint —— fix 的退出码不能当门禁判据。',
    argv: ['exec', 'oxlint', '--fix'],
  },
  {
    id: 'format:check',
    group: '门禁',
    label: '格式检查（oxfmt --check，唯一真源）',
    why: '格式的唯一真源是 oxfmt；ESLint 已退出格式职责（stylistic: false），所以这一面没有第二条闸。',
    argv: ['exec', 'oxfmt', '--check', '.'],
  },
  {
    id: 'format:fix',
    group: '门禁',
    label: '格式化（oxfmt --write，会改文件）',
    why: '本地一次改完；改完仍要跑 format:check 确认没有剩下的。',
    argv: ['exec', 'oxfmt', '--write', '.'],
  },
  {
    id: 'types:check',
    group: '门禁',
    label: '全仓类型检查（admin / docs 用 vue-tsc，其余 tsc）',
    why: '类型错误只有这一步看得见；排包会漏检「被改动包所依赖的包」，所以整仓跑。',
    argv: ['run', 'types:check'],
  },
  {
    id: 'types:check:root',
    group: '门禁',
    label: '根级配置类型检查（tsc -p tsconfig.json）',
    why: '根 tsconfig 覆盖的那几个配置不入 turbo 的图，没有这一步就没人检查它们的类型。',
    argv: ['exec', 'tsc', '-p', 'tsconfig.json'],
  },
  // tsrs 的**影子入口**（执行计划 §9.1 第 5 条）：影子期只观测，**不进 prepush / 发版电池**。
  // 判据是「时长 + 诊断 diff」（§9.2），期满后整批转正（§9.3）时删掉本条。
  {
    id: 'types:check:tsrs',
    group: '门禁',
    label: 'tsrs 类型检查（影子期只观测，不阻断）',
    why: '检查侧快查的候选实现；影子期只看时长与诊断 diff，期满后再决定是否转正。',
    argv: ['exec', 'turbo', 'run', 'types:check:tsrs'],
    budgetMs: 0,
  },
  {
    id: 'test',
    group: '门禁',
    label: '测试（turbo test）',
    why: '哪些包有 test 任务以各包 package.json 为准；改共享包时它是唯一的行为判据。',
    argv: ['run', 'test'],
  },
  {
    id: 'e2e',
    group: '门禁',
    label: '全链路 E2E（独立 PG/Redis 栈 + dist-stage 后端 + dist-staging 前端）',
    why:
      '跨端链路（设备身份、CAP、签名握手、风控）只有真实浏览器 + 真实后端能验；这条命令先查前置、' +
      '抢 run 级锁、重建独立库（默认 walnut_e2e / 5433 / 6380，绝不碰 dev 库）再跑 spec。' +
      '`E2E_STACK_PROFILE=smoke|risk|network|pages|journey` 切到该 profile 的独立库 / 偏移端口 / `.e2e/<p>/` 基线' +
      '（不设 = default，本地全量行为不变；profile 与 project 同名 1:1）。' +
      '**前置**：`pnpm setup-env`（apps/server/env-local/.env.stage）、`pnpm build`（workspace 包的 CJS dist）、' +
      '`pnpm walnut build:stage` 与 `pnpm --filter @walnut/server build:stage`、' +
      '`pnpm --filter @walnut/e2e exec playwright install chromium`、' +
      '数据栈在 5433 / 6380 可达（WSL 形态还要一个隐藏会话）。全量含 @network 用例（依赖真实外网，' +
      '离线时改用 e2e:risk）。刻意不进 prepush 与 ci:local：重活不属于推送前门禁。',
    // 顺序写在 apps/e2e/scripts/run.ts：锁 → preflight → 基线决策 → Redis 设备键对账 →
    // stack-info → playwright test
    argv: ['-C', 'apps/e2e', 'run', 'e2e'],
    budgetMs: 0, // 整套分钟级，且含 webServer 启停（不给入口层套上限）
  },
  {
    id: 'e2e:default',
    group: '门禁',
    label: 'E2E default 面（smoke + risk + network + mobile）',
    why:
      '日常验收入口：覆盖设备 / 风控 / 冒烟 / 外网 / mobile 四个 project，不跑 pages 与 journey' +
      '（它们有独立 stack profile 与基线，CI 里也各自成 job）。' +
      '前置与 e2e 相同；比裸 `pnpm walnut e2e` 少 2 个 project（约 3–5 分钟）。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:default'],
    budgetMs: 0, // 同 e2e：分钟级 + webServer 启停
  },
  {
    id: 'e2e:smoke',
    group: '门禁',
    label: 'E2E 冒烟子集（setup + 首页 / 菜单 / 角色 / 设置 / 用户 CRUD）',
    why:
      '改前端或后端引导链后先跑这一组：它含 UI 登录与 MFA，能最快回答「栈还活着吗」。' +
      '前置与 e2e 相同（setup-env / pnpm build / 两处 build:stage / playwright install / 数据栈），' +
      '但它不碰 @network，离线也能跑。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:smoke'],
    budgetMs: 0, // 同 e2e：分钟级 + webServer 启停
  },
  {
    id: 'e2e:risk',
    group: '门禁',
    label: 'E2E 风险子集（设备 ID 全生命周期）',
    why:
      '设备签发 / 40605 自愈 / 滑动续期 / 封禁锁定 / 新设备 CAP 这些链路只有这一组 spec 守着。' +
      '依赖真实外网的用例带 @network 标记、由 e2e:network 单独跑，所以这一组离线应全绿；' +
      '前置同 e2e。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:risk'],
    budgetMs: 0, // 同 e2e
  },
  {
    id: 'e2e:network',
    group: '门禁',
    label: 'E2E 外网子集（@network：真实 geoip 定位）',
    why:
      '这条只跑标了 @network 的用例（当前是非 local IP 走 api.ip.sb 的真实定位）：**它依赖真实外网**，' +
      '断网 / 代理拦截时必红，所以从 risk 子集里隔离出来。前置同 e2e（只多一个外网可达）。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:network'],
    budgetMs: 0, // 同 e2e
  },
  {
    id: 'boundaries',
    group: '门禁',
    label: '架构边界（turbo boundaries）',
    why: '包之间的依赖方向由 tags 声明；违规一旦合并进去，纠正成本远高于拦在推送前。',
    argv: ['exec', 'turbo', 'boundaries'],
  },
  {
    id: 'madge:check',
    group: '门禁',
    label: '循环依赖（madge，apps/server 的 apps + libs）',
    why: '环是唯一没有其它闸看得见的失效面：boundaries 看包与 tag、ESLint 只看单条边、tsc 对环完全不报错。',
    argv: ['-C', 'apps/server', 'madge'],
  },
  {
    id: 'openapi:check',
    group: '门禁',
    label: 'OpenAPI 一致性（导出 → 生成 → git diff）',
    why:
      '前端类型真源是 server 装饰器反射出的 openapi.json；DTO 改了却没重导出时，前端类型就在静默说谎。' +
      '导出要引导 AppModule，所以本机需要 env-local 与 PG / Redis。',
    argv: ['-C', 'apps/server', 'openapi:check'],
  },
  {
    id: 'openapi:check:export',
    group: '门禁',
    label: '只重导 openapi.json',
    why: '上游 DTO 改了、要单独刷新生成物时用它；结果要连同 schema.d.ts 一起提交。',
    argv: ['-C', 'apps/server', 'openapi:check:export'],
  },
  {
    id: 'openapi:check:schema',
    group: '门禁',
    label: '只从 openapi.json 重生成 schema.d.ts',
    why: '不需要引导 AppModule，所以没有数据库也能跑；CI 的无 secret 分支跑的就是它。',
    argv: ['-C', 'apps/server', 'openapi:check:schema'],
  },
  {
    id: 'lint:workflows',
    group: '门禁',
    label: 'workflow 校验（actionlint）',
    why: '非法 workflow 在 GitHub 那边启动即失败、0 个 job，本地不拦就只能 push 后发现。本机没装 actionlint 时这一步跳过。',
    argv: ['exec', 'walnut-lint-workflows'],
    budgetMs: 5 * MINUTE,
  },
  {
    id: 'lint:workflows-shell',
    group: '门禁',
    label: 'workflow 里的 shell 块逐块 bash -n',
    why: 'actionlint 只看 YAML 与表达式，看不见字符串里的 shell 语法错。本机没有 bash 时明确跳过。',
    argv: ['exec', 'walnut-check-workflow-shell'],
  },
  {
    id: 'lint:docs-refs',
    group: '门禁',
    label: '文档引用校验（包名 / 仓库路径）',
    why: '活文档正文里引用的包名与仓库路径必须真实存在；VitePress 看不见反引号里的引用。',
    argv: ['exec', 'walnut-check-doc-refs'],
  },
  {
    id: 'lint:adr',
    group: '门禁',
    label: 'ADR 形态校验（编号 / 状态 / 小节）',
    why: '编号连续、Status 在枚举内、四个必需小节齐备、index 双向对齐 —— 没有现成工具管这件事。',
    argv: ['exec', 'walnut-check-adr'],
  },
  {
    id: 'lint:doc-ts',
    group: '门禁',
    label: '文档代码块校验（标 ts 的块必须能解析）',
    why: '标成 ts 的围栏块必须能按 TypeScript 解析；它坏掉时读者看到的高亮全错，而构建不会报。',
    argv: ['exec', 'walnut-check-doc-ts'],
  },
  {
    id: 'lint:dynamic-imports',
    group: '门禁',
    label: '动态 import 说明符必须是字面量（apps/**）',
    why: '拼出来的模块说明符在 tsc 与 vite build 里都不报错，只在运行期抛 Unknown variable dynamic import。',
    argv: ['exec', 'walnut-check-dynamic-imports'],
  },
  {
    id: 'lint:doc-budget',
    group: '门禁',
    label: '文档字数预算（常驻文件不许膨胀）',
    why: '根 AGENTS.md 与包级指引每次会话都进上下文，膨胀了会挤掉别的东西；预算用不到一半同样算失败。',
    argv: ['exec', 'walnut-check-doc-budgets'],
  },
  {
    id: 'lint:dts',
    group: '门禁',
    label: '手写 .d.ts 检查（关掉 skipLibCheck，只报仓库内文件）',
    why: 'skipLibCheck 跳过的是全部 .d.ts，含我们自己写的那几份；它们坏掉时错误只在消费方漏出来。',
    argv: ['exec', 'walnut-check-dts'],
  },
  {
    id: 'lint:seed',
    group: '门禁',
    label: '初始化数据形态（集合 / 体积 / 凭据形状 / 引用完整性）',
    why: '这份数据随仓库发布并被直接灌进库，失效方式全是静默的：私钥进公开仓、开发者账号被发布、引用断裂后侧边栏空掉。',
    argv: ['exec', 'walnut-check-seed'],
  },
  {
    id: 'lint:turbo-cache',
    group: '门禁',
    label: 'turbo 配置不变量（缓存边界 + tags）',
    why: 'turbo.json 漏一个产物目录、少挂一条依赖边、tags 写错一个字符，症状全是静默的：FULL TURBO + exit 0。',
    argv: ['exec', 'walnut-check-turbo-cache'],
  },
  {
    id: 'lint:pre-hooks',
    group: '门禁',
    // 措辞从**名单本身**推导：名字住在 ci/pre-hook-consumers.ts（唯一真源），
    // 写死「vite / vue-tsc」会在新增消费者后继续骗人（清单比规则先腐烂的那类）。
    label: `脚本前置钩子（${PRE_HOOK_CONSUMERS.map((consumer) => consumer.bin).join(' / ')} 前必须先跑生成）`,
    why: '生成物不在跟踪面里，干净检出里没有它们；缺了钩子会让构建在生成之前就读文件。',
    argv: ['exec', 'walnut-check-pre-hooks'],
  },
  {
    id: 'lint:lockfile',
    group: '门禁',
    label: 'catalog 与锁文件锁步（catalog ↔ pnpm-lock）',
    why: '改了 catalog 忘了 pnpm install 时本地必然全绿、CI 必然红（--frozen-lockfile），连打 tag 的发版面一起炸。',
    argv: ['exec', 'walnut-check-catalog-lockstep'],
  },
  {
    id: 'lint:nginx-headers',
    group: '门禁',
    label: '入口 nginx 安全响应头（conf.d）',
    why: 'add_header 是整段替换而不是合并：某个 location 自己写一条，server 级的安全头就全被吃掉。',
    argv: ['exec', 'walnut-check-nginx-headers'],
  },
  {
    id: 'lint:post-verify',
    group: '门禁',
    label: '部署后验证脚本的行为测试（post-verify.test.sh）',
    why: 'deploy/post-verify.sh 是部署后唯一证明服务真的在工作的一步，而它的各条失败分支只有这个行为测试守着（假 docker / curl，不需要 Docker）；判据写漏一行，最晚在镜像上线后才发现。本地只在相对上游改了相关文件时才真跑（Windows 上一次约 3 分钟），CI 上每次都跑。',
    // 本机实测：直接 `bash deploy/post-verify.test.sh` 约 90 秒；经本门禁（Node 再起 MSYS bash）
    // 约 185 秒 —— 差别来自 Windows 上每个假 docker / curl 子进程的启动开销。10 分钟与 prepush
    // 的默认段预算同口径，约 3 倍余量，用来收掉真卡住的进程，不是把慢机器判死。
    argv: ['exec', 'walnut-check-post-verify'],
    budgetMs: 10 * MINUTE,
  },
  {
    id: 'lint:dist',
    group: '门禁',
    label: '产物去密体检（扫 dist / dist-staging 有没有把后端 env 打包进去）',
    why: '前端产物是公开文件；把后端 env 搬错一行就会被打包进去，而构建 / 类型 / lint / 测试全都不响。两份产物（build 的 dist 与 build:stage 的 dist-staging）都是公开面，缺一不可 —— 缺哪份会显式打印「没验过」，两份都缺才退 2。所以要在构建之后跑。',
    argv: ['exec', 'walnut-check-dist-secrets'],
    budgetMs: 5 * MINUTE,
  },
  {
    id: 'lint:secrets',
    group: '门禁',
    label: '源码密钥形态（凭据形状不许进仓库）',
    why: 'GitHub 的 push protection 只认形状、命中就拒掉整条 push；只在 CI 里拦等于没有。',
    argv: ['exec', 'walnut-check-source-secrets'],
  },
  {
    id: 'lint:emoji',
    group: '门禁',
    label: '注释与常驻文档里不许有 emoji',
    why: 'emoji 在非 UTF-8 代码页的终端里必然显示成乱码，也会污染 diff 与日志。',
    argv: ['exec', 'walnut-lint-emoji'],
  },
  {
    id: 'lint:exports',
    group: '门禁',
    label: '包 exports 形态（目标存在 / types 在前 / 与 main 一致）',
    why: '共享包不构建就被消费，exports 写错一个字符的症状是解析到别的入口或类型静默丢失。',
    argv: ['exec', 'walnut-check-package-exports'],
  },
  {
    id: 'hooks:check',
    group: '门禁',
    label: '断言 git 钩子由 lefthook 托管',
    why: '钩子被别的工具接管或静默消失时，pre-push 门禁就不再运行，而没有任何提示。',
    argv: ['exec', 'walnut-check-git-hooks'],
  },
  {
    id: 'prepush',
    group: '门禁',
    label: '推送前门禁（并行跑、每段报耗时）',
    why: '门禁表在 tooling/scripts/src/ci/prepush.ts；pre-push 钩子与 CI 都引用它，这是推送前唯一的一处闸。',
    argv: ['run', 'prepush'],
    // 不设入口级预算：表里每一段各有自己的预算（10～15 分钟），卡住的段由它自己的预算收。
    // 入口层再套一层全局上限，只会把「几段依次跑、耗时加起来」误判成卡死 —— 经 turbo 扇出的
    // 三段互斥之后，全冷时本机（12 逻辑核）整表 5 分钟，核数少的机器按比例会超过缺省的 15 分钟。
    budgetMs: 0,
  },
  {
    id: 'ci:local',
    group: '门禁',
    label: '本地复刻 CI 的构建类步骤（顺序执行）',
    why: 'prepush 只管静态门禁；构建、产物冒烟、迁移、worker 冒烟只有这里能在本地跑。顺序即依赖，第一个失败即止。',
    // 经 bin 执行而不是自定义函数：local-ci 自己要 import resolveCommandArgv（解析它的步骤表），
    // 若仍让命令表惰性 import local-ci，两个模块就互为对方的运行期依赖。
    // 顺带保住「每个 bin 都有引用面」—— 根脚本 `ci:local` 删掉后由这一项引用 `walnut-ci-local`。
    argv: ['exec', 'walnut-ci-local'],
    // 不设入口级预算，理由同 prepush：步骤表里每一步各有预算（另有 CI_LOCAL_BUDGET_MS 一处放宽），
    // 步骤顺序执行，合法耗时加起来远超缺省的 15 分钟 —— 入口层再套上限等于把步骤表的预算作废。
    budgetMs: 0,
  },

  // ── 依赖 ──
  {
    id: 'syncpack:lint',
    group: '依赖',
    label: '依赖一致性（syncpack）',
    why: 'workspace 内部引用必须是 workspace:*、版本必须走 catalog；版本漂移在发版时才炸。',
    argv: ['exec', 'syncpack', 'lint', '--dependency-types', 'dev,prod'],
  },
  {
    id: 'syncpack:fix',
    group: '依赖',
    label: '按 syncpack 规则自动修依赖声明',
    why: 'lint 报出来的版本与引用形态一次修完，之后仍要 syncpack:lint 复核。',
    argv: ['exec', 'syncpack', 'fix'],
  },
  {
    id: 'syncpack:update',
    group: '依赖',
    label: '交互式更新 catalog 里的依赖版本',
    why: '升级在本仓 = 改 catalog 一行；这个交互界面按依赖类型筛选。',
    argv: ['exec', 'syncpack', 'update', '--dependency-types', 'pnpmCatalog', '--interactive'],
    budgetMs: 0, // 交互式，不设预算
  },
  {
    id: 'check:deps:update',
    group: '依赖',
    label: '列出可升级的依赖（taze major -l）',
    why: '只读：先看哪些包有大版本，再决定逐条升。',
    argv: ['exec', 'taze', 'major', '-l'],
  },
  {
    id: 'knip',
    group: '依赖',
    label: '死代码检测',
    why: '当前是有意维持的红（理由见 knip.config.ts 顶部注释）；改动前后对比输出，别拿它当门禁。',
    argv: ['exec', 'cross-env', 'NODE_OPTIONS=--max-old-space-size=8192', 'knip'],
  },
  {
    id: 'knip:fix',
    group: '依赖',
    label: '死代码检测并自动修（knip --fix）',
    why: '只自动修它敢确定的那几类；结果必须进 diff 复核。',
    argv: ['exec', 'cross-env', 'NODE_OPTIONS=--max-old-space-size=8192', 'knip', '--fix'],
  },
  {
    id: 'knip:packages',
    group: '依赖',
    label: '只扫 packages / tooling 两组（knip --workspace）',
    why: '大仓整跑很慢；改共享包时缩到这两组。',
    argv: [
      'exec',
      'cross-env',
      'NODE_OPTIONS=--max-old-space-size=8192',
      'knip',
      '--workspace',
      './packages/*/*',
      '--workspace',
      './tooling/*',
    ],
  },
  {
    id: 'knip:apps',
    group: '依赖',
    label: '只扫 apps 组（knip --workspace）',
    why: '同上：缩小扫描面，只回答「三个 app 有没有死代码」。',
    argv: [
      'exec',
      'cross-env',
      'NODE_OPTIONS=--max-old-space-size=8192',
      'knip',
      '--workspace',
      './apps/*',
    ],
  },
  {
    id: 'inspect:node-modules',
    group: '依赖',
    label: 'node_modules 体积与重复依赖可视化',
    why: '排查「谁把这份依赖装了第二遍」时比读 lockfile 快。',
    argv: ['exec', 'node-modules-inspector'],
    budgetMs: 0, // 起本地可视化服务，常驻
  },

  // ── 数据库 ──
  {
    id: 'db:seed:pg',
    group: '数据库',
    label: '仓内 seed 行数组 → PG（按主键 upsert）',
    why: '幂等可重放；CI 与部署通道播的就是这份数据。',
    argv: ['exec', 'walnut-db-seed-pg'],
  },
  {
    id: 'db:credential-check',
    group: '数据库',
    label: '口令凭证探针：密文可解 + valueHash 自洽',
    why: '凭证绑定面变更（OPAQUE identifiers / ① 的 AES 信封）会让旧行静默 40103；部署后先跑它，比逐账号试登录快且不触发风控。',
    argv: ['exec', 'walnut-db-credential-check'],
  },
  {
    id: 'db:export:pg',
    group: '数据库',
    label: 'PG → 历史导出形态 Extended JSON',
    why: '反向导出，供 db:seed:reshape 与人工 review 用（uuid 本体）。',
    argv: ['exec', 'walnut-db-export-pg'],
  },
  {
    id: 'db:seed:reshape',
    group: '数据库',
    label: '历史导出 → PG 行形态 seed 目录',
    why: '把导出的 Extended JSON 重排成 { id, … } 的行数组与 junction 独立文件。',
    argv: ['exec', 'walnut-db-seed-reshape'],
  },
  {
    id: 'db:seed:verify',
    group: '数据库',
    label: '双库对拍（旧 seed 与旧管线 对 新 seed）',
    why: '逐表逐列比两份数据，是 reshape 是否等价的唯一判据。',
    argv: ['exec', 'walnut-db-verify-seed'],
  },
  {
    id: 'migration:run',
    group: '数据库',
    label: '对本地库跑迁移（幂等）',
    why: 'worker 冒烟要一个已迁移的库；迁移幂等，重复跑只会报 No migrations are pending。',
    argv: ['-C', 'apps/server', 'migration:run'],
    budgetMs: 10 * MINUTE,
  },
  {
    id: 'migration:revert',
    group: '数据库',
    label: '回滚最后一个迁移',
    why: '只在本地库上用：改写 schema 之后要重跑迁移、重播 seed。',
    argv: ['-C', 'apps/server', 'migration:revert'],
  },

  // ── 环境 ──
  {
    id: 'setup-env',
    group: '环境',
    label: '解密 env-encrypted/ → env-local/（dotenvx）',
    why: '后端与 openapi 导出都要 env-local；私钥 .env.keys 经 1Password 共享。',
    argv: ['run', 'setup-env'],
  },
  {
    id: 'encrypt-env',
    group: '环境',
    label: '把 env-local/ 加密回 env-encrypted/',
    why: '改了本地 env 之后用它产出可提交的密文；密文文件内的注释即模板。',
    argv: ['exec', 'walnut-setup-env', 'encrypt'],
  },

  // ── 发版与镜像 ──
  {
    id: 'release',
    group: '发版与镜像',
    label: '发版（pnpm 原生 release management + git-cliff）',
    why: '变更意图 → 确认 bump → 逐包 changelog → 提交 / 门禁 / 打标 / 推送，见 docs 的 release 页。',
    argv: ['run', 'release'],
    budgetMs: 0, // 交互式且分钟级，内部各步另有自己的预算
  },
  {
    id: 'images:build',
    group: '发版与镜像',
    label: '构建镜像（docker buildx bake）',
    why: '多架构镜像的定义在 docker-bake.hcl；只构建不推送。',
    argv: ['exec', 'docker', 'buildx', 'bake', '--file', 'docker-bake.hcl'],
    // 不设入口级预算：同一份 Dockerfile 的构建实测在 15m49s ~ 77m53s 之间抖动（依据见 docker-bake.hcl
    // 头注释），缺省的 15 分钟连最快的那次都拦。卡没卡住看 buildx 自己的进度输出。
    budgetMs: 0,
  },
  {
    id: 'images:push',
    group: '发版与镜像',
    label: '构建并推送镜像',
    why: '同一条 bake 加 --push；推之前确认 registry 凭据。',
    argv: ['exec', 'docker', 'buildx', 'bake', '--file', 'docker-bake.hcl', '--push'],
    budgetMs: 0, // 同 images:build，外加推送层的时间（取决于上行带宽）
  },
  {
    id: 'images:print',
    group: '发版与镜像',
    label: '打印 bake 解析后的最终配置',
    why: '不构建，只看变量与 target 展开成了什么，排查标签与参数用。',
    argv: ['exec', 'docker', 'buildx', 'bake', '--file', 'docker-bake.hcl', '--print'],
  },

  // ── 工具 ──
  {
    id: 'e2e:affected',
    group: '工具',
    label: '按改动范围选择 E2E 子集（默认 base=origin/main）',
    why:
      '本地与 nightly 的轻量入口：读 `git diff --name-only <base>...HEAD`，admin 登录 → smoke、' +
      'server guards/system/ip/middleware → risk、admin views/router → pages、socket/锁屏 → journey、' +
      'seed / 迁移 / prepare-db → 重新封板 + 全量、' +
      '只改文档 → 跳过、**其它任何路径 → 全量**（安全网）。**刻意不进 prepush / PR 门禁**；' +
      '执行仍经 apps/e2e/scripts/run.ts（抢 run 级锁、基线决策与单 run 不变量不变）。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:affected'],
    // base 可位置参数给（`pnpm walnut e2e:affected origin/main`），也可 `--base=<ref>`
    positionalArgs: '[base]',
    budgetMs: 0, // 可能走到全量，分钟级 + webServer 启停
  },
  {
    id: 'e2e:doctor',
    group: '工具',
    label: 'E2E 前置自检（打印全部检查与修复命令，不抢锁、不动库）',
    why:
      '跑 e2e 前的失败先说清「缺什么、怎么补」：它只跑 preflight（env / workspace CJS dist / ' +
      '两处 stage 产物 / chromium / PG·Redis 可达 / PG 容器可读 / 端口），**不**抢 run 级锁、' +
      '不重建库、不起服务。环境有问题时仍按退出码 2 收场（与 e2e 的前置口径一致），适合排障时反复跑。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:doctor'],
  },
  {
    id: 'e2e:report',
    group: '工具',
    label: '打开上一轮 E2E 的 HTML 报告',
    why:
      '它**不是门禁**：起一个常驻的本地报告服务，看完手动关。失败回放（trace / 截图 / 网络）在' +
      'Playwright 报告里；产物落在 gitignored 的 playwright-report/（含 token，别上传）。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:report'],
    budgetMs: 0, // 起本地报告服务，常驻
  },
  {
    id: 'e2e:stack:up',
    group: '工具',
    label: '起 E2E 数据栈（独立 PG 5433 / Redis 6380）',
    why:
      '按 E2E_PG_EXEC_MODE / 平台自动选 WSL 常驻栈或通用 compose（容器名可用 E2E_PG_CONTAINER 覆盖），' +
      '然后 `docker compose up -d`。**只起数据栈**：不抢 run 级锁、不重建库、不碰 Playwright 的 webServer —— ' +
      '那些仍由 e2e 自己编排。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:stack', 'up'],
    budgetMs: 5 * MINUTE, // compose up 通常秒级；拉镜像时才会慢，5 分钟收掉卡死
  },
  {
    id: 'e2e:stack:down',
    group: '工具',
    label: '停 E2E 数据栈（默认保留数据卷）',
    why:
      '与 up 同一个形态探测；默认 `down` 保留数据卷（基线仍可用）。要重置成空实例就在命令后加 ' +
      '`--volumes`（或 `-- -v`）：连卷删掉后旧基线失效，下一次 run 会全量 prepare 并重新封板。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:stack', 'down'],
    budgetMs: 5 * MINUTE,
  },
  {
    id: 'e2e:stack:status',
    group: '工具',
    label: 'E2E 数据栈状态（容器 / PG·Redis 可达性 / 端口 / 基线）',
    why:
      '一条只读命令回答「现在能不能跑 e2e」：容器是否 running、5433 / 6380 是否可达、' +
      '3001 / 3002 / 4173 是否空闲、当前基线可用 / 缺失 / 漂移。复用 preflight 的探针与 baseline 的判定，' +
      '不抢锁、不动库、不启停服务；默认只报告、退出码恒 0，`-- --strict` 时容器 / PG·Redis 任一 FAIL ⇒ 1。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:stack', 'status'],
  },
  {
    id: 'e2e:clean',
    group: '工具',
    label: '清理 apps/e2e/.e2e 的调试文件（dry-run 默认）',
    why:
      '`.e2e/` 是排障现场：log / 临时 json / 截图 / trace 会越堆越多，而基线三件套与 stack.json ' +
      '是下一轮 run 直接消费的。默认只列出将删条目；`--force` 才真删，且路径闸只允许删该目录的直接子项。' +
      '跑用例期间别清（正在写的日志会被删）。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:clean'],
  },
  {
    id: 'e2e:redis-gc',
    group: '工具',
    label: 'Redis 设备键对账（按 deviceId 清孤儿，不 FLUSH）',
    why:
      '扫描白名单前缀里的设备键，查 `sys_device` 判存在性，只对「设备不存在」的键执行精确 `DEL`。' +
      'run 流程默认在库准备之后自动跑（`E2E_REDIS_GC=0` 关）；这条是排障 / 负对照的独立入口，' +
      '`--dry-run` 只看计划不删。**绝不 FLUSHDB / FLUSHALL**（compose 里已禁用那两个命令）。',
    argv: ['-C', 'apps/e2e', 'run', 'e2e:redis-gc'],
    budgetMs: 5 * MINUTE,
  },
  {
    id: 'scaffold:lib',
    group: '工具',
    label: '按模板新建一个后端 lib',
    why: '新 lib 要同时登记到分层与组合根；脚手架负责那几处机械改动，省掉漏登记。',
    argv: ['exec', 'walnut-scaffold-lib'],
    positionalArgs: '<name>',
  },
  {
    id: 'docs:version',
    group: '工具',
    label: '刷新文档站的版本号（查 GitHub 最新发版）',
    why: '文档站导航栏显示的版本号来自 apps/docs/version.json，它是手工刷新的；旧的 apps/docs/scripts/fetch-version.js 已删除，改由本命令查**本仓**的 releases/latest（没有 Release 时回退本机最新 tag）。',
    argv: ['exec', 'walnut-docs-version'],
  },
  {
    id: 'gen:doc',
    group: '工具',
    label: '生成后端代码文档（compodoc，产物在 apps/server/.tmp/compodoc）',
    why:
      'compodoc 提供代码结构视图（模块图 / 注入关系 / 每方法装饰器清单），与 Swagger 的 HTTP 面互补；' +
      '产物落 apps/server/.tmp/compodoc（已被 gitignore），全量生成以分钟计，所以只做本地产物、不进 CI。',
    argv: ['-C', 'apps/server', 'gen:doc'],
    budgetMs: 4 * MINUTE, // 全量生成实测两次为 116s / 187s（机器负载不同），留余量
  },
]

/**
 * 按名解析：把「首词是命令表 id」的 argv 换成真正要跑的 argv。
 *
 * 规则（三处执行器共用这一条：prepush 门禁、本地 CI 步骤、发版电池）：
 * - 命令表 id ⇒ 该命令的 `argv` + 原 argv 的其余部分；自定义命令没有可展开的 argv，原样返回；
 * - pnpm 子命令（`exec` / `change`）或保留的根脚本名 ⇒ 原样返回；
 * - 其它（未知首词、空 argv）⇒ 原样返回 —— 解析器不是校验器，未知的东西不该被这里吞掉。
 */
export function resolveCommandArgv(argv: readonly string[]): string[] {
  const head = argv[0]
  if (head === undefined) return []
  if (PNPM_SUBCOMMANDS.has(head) || KEPT_ROOT_SCRIPTS.has(head)) return [...argv]
  const command = COMMANDS.find((item) => item.id === head)
  if (command === undefined || !('argv' in command)) return [...argv]
  return [...command.argv, ...argv.slice(1)]
}
