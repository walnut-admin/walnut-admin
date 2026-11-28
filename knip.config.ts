import type { KnipConfig } from 'knip'

/**
 * **`pnpm knip` 是绿的（exit 0）** —— 2026-11-28 收口；此前长期按「有意维持红、非门禁」运行。
 *
 * 它**仍不在任何门禁里**（prepush / CI / 发版电池都没有它），所以这份文件就是「为什么这里这么配」
 * 的唯一落脚点。这里**不写命中计数**：数会变，要看就跑 `pnpm knip`。
 *
 * ## 为什么之前红、现在怎么绿的（先读这三条判据）
 *
 * 1. **公共面 = 入口导出的符号**。本仓是模板项目，「未用导出」不等于死代码 —— 最典型的是
 *    `apps/server/libs/decorators/src/transformer/**` 里那批 `WalnutAdminDecoratorTransform*`，
 *    它们正是**留给模板使用者按需取用**的装饰器 API 面；每个内部库的 `src/index.ts` barrel
 *    就是该库的公共面。所以每个 lib 的 `src/index.ts` 必须写进 `entry`，而不是写进 `ignore`
 *    （写 ignore 会把 barrel 从程序里摘掉，于是 barrel 背后的每个导出都变成"没人 import"，
 *    2026-11-28 之前 server 那一大片红正是这条造成的）。入口导出**默认不报**（`includeEntryExports`
 *    保持关闭）—— 这就是「有意的公共面」的显式表达。
 * 2. **只在文件内使用的导出不是死代码**。`ignoreExportsUsedInFile: true`（见下）让
 *    「导出给同文件/测试复用」这一类不再亮红；真正零消费的导出仍会报。
 * 3. **工具看不见的入口要显式点名**。命令行执行的 `migrations/**`、`apps/cli/**`、
 *    `apps/worker/src/main.ts` 都不是"谁 import 它"，必须进 `entry`；如果入口在包的
 *    scripts 里写明（admin 的 `node build/generate/index.ts`），knip 会从 scripts 里认出来，
 *    不必再抄进 `entry`。反过来，`.tsx` 必须写进 `project`（admin 的 `project` 曾只含
 *    `ts`/`vue`，于是所有被 `.tsx` 消费的导出都被误报）。
 *
 * 如果将来要接进门禁：**先分类再开闸** —— 用 `entry` / `ignoreDependencies` 把「有意的公共面 /
 * 工具盲区」显式标出来，只让真正的死代码亮红。不要直接删公共导出。
 *
 * ## `packages/**` 直到 2026-11-02 才真正进入分析面（批次 2 · R2）
 *
 * 在这之前 `packages/**` **几乎没有发现**（2026-11-02 实测只有 `tooling/eslint-config` 的 4 条）——
 * 不是因为它干净，而是因为它**整块不在分析面里**：
 * workspace 只写了 `entry`，knip 于是只分析「entry 领进来的文件」，非 entry 的深层文件死了
 * 也没人报。现在五个共享包都显式写了 `project`（不写就只分析 entry 领进来的文件）。
 * 2026-11-28 收口时又删掉了 `includeEntryExports` 开关：包的 `entry` / `exports` 声明
 * 就是它的公共 API 面，要求仓内必须有人 import 每个入口导出，只会把模板留用的公共函数判死；
 * 入口**背后**的深层文件仍会被查（它们不是 entry）。
 * 改前 / 改后的实测数据与每个探针的结果记在
 * apps/docs/src/zh-CN/content/monorepo/knip.md 的「共享包进入分析面」一节 —— 这里不抄数字
 * （数会变，要看就跑 `pnpm knip`）。
 *
 * ## 已知盲区：barrel 自身的死导出**没有稳定可见性**
 *
 * 2026-11-02 用同一份配置做过 A/B 探针（往包的 `src/index.ts` 各追加一行
 * `export const __PROBE = 1`，跑 `pnpm knip`，然后 `git checkout --` 还原）：
 *   · `packages/platform-web/http/src/index.ts` —— **报出来了**；
 *   · `packages/platform-any/contract/src/index.ts` —— **没报**（同一个开关、同一次运行）。
 *
 * 所以「barrel 里的死导出能不能看见」目前**因包而异**，原因未查清（contract 是唯一带
 * `packages/platform-any/contract/scripts/build-barrel.ts` 生成 barrel 的包，怀疑与 entry
 * 推导有关 —— 未验证）。
 * 结论只有一条可依赖的：**别把「barrel 已覆盖」当结论**。要守这一面只能另立一个
 * 「barrel 符号 0 引用」的专用脚本（读 `src/index.ts` 的具名导出 → 全仓 grep 消费方），
 * 调 knip 配置解决不了。在此之前，barrel 级死导出按**部分盲区**对待。
 *
 * ## 删桶之后的复测：噪音塌了，塌的是「一桶 N 行」那一类（批次 9 · C3）
 *
 * 批次 4 把 `packages/platform-web/{client,http}` 的 barrel 删掉、把
 * `packages/platform-any/utils-core` 的 barrel 收缩成两个模块之后，同一个命令的读数掉了**整整一档**，
 * 掉的那部分全是「barrel 里 re-export 了、但入口没人消费」的符号 —— **每个符号一行**。
 * 所以这一轮噪音的主因是**桶**，不是配置：当时 `project` + `includeEntryExports` 只是把那批
 * 东西**变可见**，删桶才是把它**变不见**。下次再看到读数暴涨，先查「是不是又多了个 barrel」。
 *
 * 复测之后「怎么看」按这三步（读数会变，判据不变）：
 *
 *   1. **先分段**：`packages/**` 与 `apps/**` 分开看 —— 前者是公共面问题，后者是模板 / 动态入口问题；
 *   2. **`packages/**` 逐条二分**（入口有没有消费）：
 *      `grep -rn "from '@walnut/<pkg>'" apps packages` = 0 ⇒ 它说的是「入口没人走」，**不是死代码**
 *      （消费方走的是深路径 `@walnut/<pkg>/<file>`）；**入口与深路径都 0 消费**才是真死候选；
 *   3. **`apps/**` 那一批是有意维持的，别删**：`libs/decorators` 的 transformer 是留给模板使用者的
 *      API 面；`apps/{cli,worker}/src/main.ts` 与 `apps/api/migrations/**` 是**被命令行执行**的入口 ——
 *      knip 只看 import 图，看不见「谁在命令行里跑它」。
 *
 * **`ignoreIssues` 只给「工具确实看不见 / 本轮源码冻结」的面**（逐条理由见下面 `ignoreIssues`
 * 段）：不要把公共 barrel 或普通死导出塞进去 —— 那等于把这一面重新变回盲区。真要进门禁，
 * 先按上面三步分类，只给「真死」开红。
 *
 * 逐条读数与归因**不写在这里**（数会变）：真要引用数字，就写明是哪天的 `pnpm knip` ——
 * 历史上那份带日期的记录已随 2026-11-04 收尾归档至 git 历史；
 * 要现读就跑 `pnpm knip`（人读）/ `pnpm knip --reporter json`（要精确路径 —— 文本报告会按终端宽度
 * 截断长路径）。
 */
const config: KnipConfig = {
  // `export` 给同文件内部复用（含递归）不是死代码的判据。「导出给外部消费」由 barrel / entry
  // 表达；这一开关只影响那些**没有外部消费者、但自己还在用**的符号（如 `STEP_TIMEOUT_MS`、
  // `DEFAULT_ALLOWED`、`mfaVerifiedKey`），否则它们会被误报成可删。
  ignoreExportsUsedInFile: true,

  // ============================================================
  // Workspace 包入口
  //
  // 注意：Vue3 项目用了 unplugin-vue-components
  // 组件是自动注册的，knip 追踪不到这些隐式依赖。
  // 因此 apps/admin 的 components/ 排除在 unused files 检测之外。
  // （`unplugin-auto-import` 已于 2026-09-29 移除，隐式全局那一条不再成立。）
  // ============================================================
  workspaces: {
    // --- 前端 Vue3 应用 ---
    // vite: false：阻止 knip 的 vite 插件尝试 jiti 加载 vite.config.ts
    // （它依赖 loadEnv/回调执行，knip 无法安全执行）；entry 已手动指定。
    'apps/admin': {
      entry: ['src/main.ts', 'src/router/index.ts', 'src/router/routes/**/*.ts'],
      // `tsx` 不能漏：本仓有 `*.tsx`（如 views/system/menu/useMenuFormSchema.tsx），漏掉它
      // 会让「只被 tsx 消费」的导出全部误报（2026-11-28 之前的 `menuTypeOptions` 等）。
      // `build/**` 也不能再整块 ignore：`predev` / `prebuild` / `pretypes:check` 由
      // `node build/generate/index.ts` 直接执行，knip 从 package.json 的脚本里能认出这个入口
      // （所以不必手写进 `entry`）；而入口背后的 `tsrs` 正是这样进入依赖图的。
      project: ['src/**/*.{ts,tsx,vue}', 'build/**/*.ts'],
      vite: false,
      ignore: [
        // `unplugin-vue-components` 自动注册：组件目录的 `index.ts` 默认导出与 .vue 文件
        // 都不在 import 图里（实际消费者是模板里的标签名）。这是本仓唯一必须整块豁免的目录。
        'src/components/**',
        // 常量 / 派生类型（`ValueOfAppConst*`）是组件层的公共词汇，消费方在 components
        // 与模板里；components 已整块忽略，这里跟着豁免，避免把公共词汇判成死导出。
        'src/const/**',
        // socket 事件 / 房间常量与 @walnut/contract 同源，由 socket 层按事件名动态使用。
        'src/socket/**',
      ],
    },

    // --- 后端 NestJS 应用 ---
    //
    // `entry` 必须把**三类非 import 入口**点名，否则它们不是"死文件"就是"死导出"：
    //   · 命令行执行：`apps/api/migrations/**`（TypeORM CLI）、`apps/cli/**`（typeorm / openapi
    //     导出脚本）、`apps/worker/src/main.ts`（`start:worker` 直接 node 跑 dist 入口）；
    //   · 内部库公共面：`libs/*/src/index.ts` —— 消费者走 tsconfig paths
    //     `@walnut-server/<lib>`，barrel 就是该库唯一的公共入口。**不要再把它写进 ignore**：
    //     摘掉 barrel 等于让 barrel 后面的所有导出都"没人 import"（见文件头判据 1）；
    //   · `apps/api/src/main.ts` 是常规 bin 入口。
    // barrel 的导出默认不算"未使用"（`includeEntryExports` 未开）—— 这是模板公共面的显式声明。
    'apps/server': {
      entry: [
        'apps/api/src/main.ts',
        'apps/api/migrations/**/*.ts',
        'apps/cli/src/**/*.ts',
        'apps/worker/src/main.ts',
        'libs/*/src/index.ts',
      ],
      project: ['apps/**/*.ts', 'libs/**/*.ts'],
      ignore: [
        // 装饰器是模板公共面（如 `OtpDecoratorAuthLog` 由组合根/使用方按需取用）；
        // 装饰器的"消费"发生在装饰器语法里，knip 看不到这层 API 语义。
        '**/*.decorator.ts',
        // 集成/API 测试的 helper 由 vitest 的 globalSetup / 用例按路径加载，不是 import 图。
        '**/test/**',
        // `libs/const` 的 barrel 是 `export {}`，三条历史兼容 shim 只把 `@walnut/contract`
        // 原样再导出一次（文件头写着 "Consumers should prefer direct import"），全仓零消费。
        // 它们属于 server 源码面，删除不在本轮 knip 收口范围；先按"待删兼容层"显式豁免，
        // 下次动 server 时直接删文件并把这三行一起删掉。
        'libs/const/src/app/header.ts',
        'libs/const/src/app/lang.ts',
        'libs/const/src/app/responseCode.ts',
        // e2e / integration 的 vitest 配置由包脚本显式 `--config` 指定，不是被 import 的模块。
        '**/vitest.config.*.ts',
      ],
    },

    // --- 文档站 ---
    // 不写 `entry`：VitePress 插件会从 `.vitepress/config` / `.vitepress/theme` 的约定推出
    // 两个入口（knip 的 hint 一直在提示这两条是冗余的）。`project` 仍显式限定分析面。
    'apps/docs': {
      project: ['.vitepress/**/*.ts'],
    },

    // --- 全链路 E2E（Playwright，2026-11-25 进分析面）---
    //
    // `entry` 必须手写：这个包没有 bin / exports，而它的入口不是「谁 import 它」——
    //   · `scripts/**` 由包脚本（`node scripts/run.ts` 等）与 playwright 的 webServer 命令执行；
    //   · `tests/**` 由 Playwright 按 project 的 testMatch 加载 —— setup 项目的文件名是
    //     `*.setup.ts` 而不是 `*.spec.ts`，靠「测试文件」的约定推不出来（Playwright 插件只认
    //     spec 与 `playwright.config.ts`，后者因此**不写进 entry**：写了会变成冗余条目）。
    // 不点名就等于不分析（knip 只从 entry 往里走）。
    //
    // 运行态目录（`.auth/` `.e2e/` `test-results/` `playwright-report/`）**不用写 ignore**：
    // knip 的 glob 默认跳过点目录，而另外两个里面没有 `.ts`（只有 JSON / trace 压缩包）。
    // 真正在盘上的 `.e2e/debug-*.ts` 属于点目录，刚好被默认规则挡在外面。
    'apps/e2e': {
      entry: ['scripts/**/*.ts', 'tests/**/*.ts'],
      project: ['**/*.ts'],
    },

    // --- 共享包（严格检查 — 这里 knip 价值最大）---
    //
    // 每个包都写 `project`：不写时 knip 只分析「entry 领进来的文件」，非 entry 的深层文件
    // 根本不在程序里，死了也不会有人报。
    //
    // **`includeEntryExports` 一律不开**（2026-11-28 收口）：包的 `entry` / `exports` 声明就是
    // 它的公共 API 面，入口导出的符号天然是"给消费方用的"。打开它等于要求仓内必须有人 import
    // 每个公共导出，于是模板留用的公共函数（`downloadByOnlineUrl` / `Cookie` …）全部亮红。
    // 入口**背后**的文件仍会被查：`src/index.ts` re-export 的深层模块不是 entry，它们自己的
    // 死导出照报（`project` + 默认行为已覆盖），所以「桶里能看见的只是公共面，桶后仍可查」。
    //
    // 注意 `entry` **不写**：这些包的 `exports` 已把入口逐字声明出来（`"."` → `src/index.ts`
    // 或 `.d.ts`），knip 会按 exports 推导 —— 手写一遍既是重复，也会随包结构变化而腐化。
    // 这也回答了「能不能把 barrel 从 entry 摘出去」：摘掉显式条目后，knip 推回来的还是同一个
    // 文件，行为不变；所以**barrel 自身的死导出依旧是盲区**（公共 API 的固有代价）。
    // 要查它只能另立一个「barrel 符号 0 引用」的专用脚本，knip 配置解决不了。
    'packages/platform-any/contract': {
      project: ['src/**/*.ts'],
    },
    'packages/platform-any/utils-core': {
      project: ['src/**/*.ts'],
    },
    'packages/platform-any/types': {
      project: ['src/**/*.ts'],
    },
    // client / http 的桶入口（`src/index.ts`）**已于 2026-11 批次 4 删除**（D8）：
    // 两个 barrel 共 75 个导出、全仓裸包名 import 站点 **0** 个，等于「公共 API 面」本身
    // 没有任何消费者 —— 之前 `entry: ['src/index.ts']` 会把这些导出全判成「公共 API」，
    // 于是 knip 一边报它们未用、一边说不出「谁该用」。
    //
    // 删桶之后**刻意不写 `entry`**：两个包的 `exports` 是 `./*` 子路径通配，按 knip 的
    // 推导规则「每个可被导入的文件都是入口」，这与事实一致（子路径就是公共面），也与
    // 上面 tooling/* 的处理同口径。写回 `entry: ['src/index.ts']` 会立刻变成
    // 「指向不存在的文件」，那是配置错误而不是结论。
    'packages/platform-web/client': {
      project: ['src/**/*.ts'],
    },
    'packages/platform-web/http': {
      project: ['src/**/*.ts'],
    },
    // tooling/* 刻意**不写 entry**：knip 能从 package.json 的 `exports`（预设/通用能力）
    // 与 `bin`（命令入口）自己推出入口文件。显式列一遍既是重复，也会随包结构变化而腐化 ——
    // knip 的 Configuration hints 一直在提示这一点，本轮按其建议删掉。
  },

  // ============================================================
  // 文件级豁免（只给「工具看不见」或「本轮不能动」的公共面）
  // ============================================================
  //
  // 语义比 `ignoreDependencies` 窄：只关掉指定文件的指定问题类型，文件本身仍在程序里，
  // 它的 import 边照常参与分析。**新增条目必须能说出「为什么删不掉」**，否则先按文件头
  // 的三条判据分类；能靠 `entry` / `project` 表达的就不要写到这里。
  ignoreIssues: {
    // ---- server：源码面本轮冻结，下列都是「兼容再导出 / 被 .d.ts 消费」的公共面 ----
    // （下一批动 server 时优先删这些兼容层，然后连条目一起删）

    // 「兼容旧 import 面」re-export：算子真源已迁 pg-column-op，全仓已无消费者。
    'apps/server/libs/repository/src/pg-list.builder.ts': ['exports'],
    // 批 7 下沉后的兼容 re-export 面（谓词真源在 @walnut-server/system）；
    // 两个查询函数已无任何消费者（spec 也改用 system 的谓词），属待删兼容层。
    'apps/server/apps/api/src/common/repository/data-scope.ts': ['exports', 'types'],
    // 兼容入口：既有公共导入路径 `@walnut-server/config/utils/env`；isStage / WalnutAdminEnv
    // 已无消费者，但整条转发面保留（删它属于 server 调用点迁移）。
    'apps/server/libs/config/src/utils/env.ts': ['exports'],
    // `IWalnutAdminSocketEvents` 已由 `types.d.ts` 声明成全局类型、`socket.service.ts` 按全局名
    // 消费；从这里（socket.const）的 re-export 已无直接消费者 —— 保留为兼容面，删它要动 server。
    'apps/server/apps/api/src/socket/socket.const.ts': ['types'],
    // 腾讯云短信 provider 由运行时按配置选择（不是静态 import），但文件本身**要参与分析**：
    // 它 import 的 `tencentcloud-sdk-nodejs` 只有这样才能被认成"已使用"。
    'apps/server/libs/sms/src/tencent/tencent.sms.service.ts': ['files'],
    // `libs/const` 的 const 值有用，派生的类型别名目前无消费者；server 源码冻结期先留。
    'apps/server/libs/const/src/app/setting.ts': ['types'],
    'apps/server/libs/const/src/app/dataScope.ts': ['types'],
    'apps/server/libs/const/src/app/event.ts': ['types'],

    // ---- docs：英文站配置整块保留但有意不启用（2026-09-23 裁决「不要英文站」）----
    // `en.ts` 的 `search` 仍被 index.ts 使用；导出的 `en` 是将来启用时的完整配置对象。
    'apps/docs/.vitepress/config/en.ts': ['exports'],
  },

  // ============================================================
  // 全局忽略
  // ============================================================
  // 只保留**实测必须**的条目（2026-11-28 用「清空后逐组加回」的办法验证过）：
  //   · `tooling/tsconfig/**`：纯 JSON 预设，会被 knip 读成「未声明依赖 vue / 未解析 tslib」；
  //   · vitest 配置：knip 的 vitest 插件会把 `coverage.provider: 'v8'` 读成对
  //     `@vitest/coverage-v8` 的依赖，而本仓只有 server 装它（其余包不跑 coverage）。
  // 其余条目（dist / node_modules / 测试 / .d.ts / scripts / env / infra）都是 knip 默认
  // 已覆盖或实测删掉后 0 变化的面，不再重复声明。
  ignore: ['tooling/tsconfig/**', '**/vitest.config.ts'],

  // 收尾状态（2026-11-28）：`pnpm knip` exit 0，issues 为 0；剩余的 configuration hint
  // 全是 "Compiled extension excluded by project"（admin 的 .sass/.scss、client/docs 的 .vue）——
  // 样式与编译扩展不在分析面内，knip 无法解析，也不代表未使用代码。**不要**为了消掉这些
  // hint 把 .vue/.scss 塞进 project（会带进一批无法解析的假红）。

  // ============================================================
  // 以下**二进制**来自工具自身，不是任何依赖提供的（knip 会把它们报成 unlisted）
  // ============================================================
  ignoreBinaries: [
    // `pnpm change` 是 pnpm 12 的原生命令（发行版自带，不在 node_modules/.bin 里）。
    // 出现在根 `prepush` 脚本与 ci.yml 的 quality job 里（fixed 组锁步门禁）。
    'change',
    // `actionlint` 是**外部工具**，刻意不进依赖：`lint-workflows` 探测不到就抛 SkippedError
    // （退出码 3，跳过不等于通过），权威闸门是 CI 的 workflow-lint.yml。
    'actionlint',
    // `wsl` 是 Windows 自带的可执行文件（e2e 的 pg-container 在 win32 上经
    // `wsl -e bash -c` 进 WSL 的 Docker），不是 npm 依赖。
    'wsl',
  ],

  // ============================================================
  // 以下依赖 knip 会报告为 unused/missing，但实际上是需要的
  // ============================================================
  // 只保留**实测仍需忽略**的条目；2026-11-28 用「清空后跑 knip」验证过：其余几十条
  // 都是 knip 现在能自行解析的（Vite 插件表、nest CLI、ESLint 预设、workspace bin…），
  // 留在列表里只会让 configuration hints 永远清不掉。
  ignoreDependencies: [
    // --- tooling：动态拼接的模块路径 / 配置字符串，knip 的静态分析看不见 ---
    // @walnut/vite-config 的 iconify 插件用模板字符串 import @iconify/json/json/<name>.json。
    '@iconify/json',
    // Nest CLI 从 infra/nest/*.json 的 collection 字符串加载它，不是 TS import。
    '@nestjs/schematics',
    // commitlint 从 extends 字符串数组加载，不是 TS import。
    '@commitlint/config-conventional',

    // --- 命令表间接调用（pnpm walnut <id> 的 argv 在运行时拼出） ---
    'syncpack',
    'taze',

    // --- pnpm packageExtensions 的 peer（knip 的 pnpm 插件把它当根配置依赖） ---
    'rxjs',

    // --- 只在被 ignore 的目录里被消费 ---
    // 类型包是 codemirror 的类型来源（tsc 消费，不产生 import 边）；`codemirror` 本身在
    // components 里 import，knip 顺着 barrel / vue-codemirror 也能看到它，所以不必 ignore。
    '@types/codemirror',

    // --- 运行时按名字 require ---
    // Express 的 app.setViewEngine('hbs') 由 Express 在运行期 require 该包。
    'hbs',
    // 唯一 importer 是 libs/sms/src/tencent/tencent.sms.service.ts —— 该文件自述 @deprecated
    // 「仅作为代码留存，不再被任何模块引入」，barrel 也刻意不导出它。依赖与文件必须一起留
    // （删依赖会让 nest build / tsrs 在编译这个留存文件时解析失败）；本轮 server 源码冻结，
    // 下次删该文件时把这条一起删掉。
    'tencentcloud-sdk-nodejs',
    // `apps/server` 的 **prod dependencies** 本轮不在授权范围（只允许动 devDeps）；
    // 实测全仓无静态 import（express 自带自己的 raw-body），但删除要等下一次 server 依赖清理。
    // 先显式记录为待删，避免它变成「没人知道为什么在」的匿名条目。
    'raw-body',
  ],
}

export default config
