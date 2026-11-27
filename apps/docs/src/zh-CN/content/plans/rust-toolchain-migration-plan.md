# Rust 化工具链迁移：阶段性计划（草案）

> 状态：【草案】2026-11-27 立项，尚未开始执行；各阶段的工作量只是「感受」，没有排期承诺。
> **定位**：把「换工具」拆成可独立验收、可独立回滚的阶段，回答每一步**先做什么、做到什么算完、怎么退回去**。
> **读者**：执行各阶段的 agent；评审阶段产出的仓库所有者。
> **权威边界**：**为什么做、风险多大**在[迁移考量与风险评估](../industry-research/rust-toolchain-migration-assessment.md)（下称「评估」）；**门禁有几段、各段凭什么**在 `tooling/scripts/src/ci/prepush.ts` 的表。本篇只写**怎么做、怎么验**；与代码冲突时以代码为准。

## 1. 前置阅读与口径

先读[评估](../industry-research/rust-toolchain-migration-assessment.md)的第 2 节（结论速览）、第 7 节（差距分析）与第 8 节（风险清单）。本篇不重复其中的判定，只引用结论：

- 四轨道划分：A 构建收尾（已在轨）、B 工具链落地（oxfmt 正式阻断 / oxlint 双轨 / tsdown）、C 检查侧快查（tsrs 影子 → 整批转正）、D 引擎全面 TS7（TNB 作为 `typescript` 包面 + nest-on-TNB PoC）。
- 本篇的阶段与轨道是**正交**的：P0 是防护网（不换任何工具，但含基线测量与 `check-pre-hooks` 配置化），P1 对应轨道 A，P2–P4 对应轨道 B，P5 对应轨道 C 与 D。
- 关键分界在评估第 10 节：**只消费诊断的路径直接换引擎（tsrs）；必须调 classic API 的消费者走外壳（TNB）；裸装 `typescript@7` 只有等上游** —— 那是轨道 D 唯一剩下的阻塞项。

三条写作口径：

1. **不写具体代码 diff**：本篇给的是范围与判据，实现细节由各阶段执行时决定。
2. **不写会腐烂的清单**：涉及文件一律写「在哪找」而不是「一共几个」；确实要写数量时以指到的配置文件为准。
3. **目标路径尚未存在时不加反引号**：`pnpm walnut lint:docs-refs` 会校验反引号里的包名与路径是否真实存在，尚未建成的配置文件在正文里用普通文字写。

## 2. 原则

| 原则 | 含义 | 为什么 |
|------|------|--------|
| **小步提交** | 一个阶段内一次只换一个变量：换工具不换规则、换规则不换格式、换格式不换逻辑 | 任何一次「工具 + 规则 + 格式」三合一的提交，出问题时无法定位是哪一层 |
| **每阶段独立可回滚** | 每个阶段结束时仓库处于「不回滚也能继续用」的状态；回滚方案在阶段开始前就写好 | 迁移的失败形态常常不是报错，而是「某处悄悄不跑了」，需要能整段退回去 |
| **影子运行优先于切换** | 新工具先以 `--check` / 只读报告的形式与旧工具并行，稳定后再接管 | 门禁的切换成本不在跑通，而在**误报与漏报的分布**要观察一段时间 |
| **门禁三表同步纪律** | 任何门禁命令的新增 / 改名 / 删除，必须同时改 `tooling/scripts/src/ci/prepush.ts`、`tooling/scripts/src/ci/local-ci.ts`、`tooling/release/src/release/steps.ts`，并同步 `gate-wiring.test.ts` 与 `ci-workflow.test.ts` | 三张表按命令名互相引用；漏一处的症状是「表还在、命令没人跑」，没有任何运行时报错 |
| **引擎与外壳的红线** | **类型引擎一律 7.x**（tsgo 7.0.2 经 TNB、tsrs 7.1-beta）；**API 外壳允许 TNB 形态**（classic 6.0.3 面）。**裸装 `typescript@7` 仍是红线**：nest CLI 守卫 exit 1、vue-tsc peer `<7`，那是上游断点 | 直接把 `typescript` 换成 7.x 会同时打断后端构建与 admin 检查；TNB 用 classic 外壳保住 API、用 tsgo 换掉引擎，是同一件事的可行形态 |
| **不做顺手重构** | 阶段内遇到无关的坏味道，记下来，不在本阶段处理 | 迁移类改动的评审成本已经很高，混入无关改动等于放弃回滚粒度 |

## 3. 阶段总览

| 阶段 | 目标 | 前置依赖 | 风险等级 | 工作量感受 |
|------|------|----------|----------|------------|
| P0 基线与防护网 | 构建产物快照、CSS 视觉基线、Sentry sourcemap 验证、**admin `types:check` 基线**、**`check-pre-hooks` 配置化** | 无 | 低 | 一到两天；主要是把现有命令跑一遍并留档 |
| P1 Vite 收尾 | 8.0.11 → 8.4.0；澄清 `minify` 取值；CSS / legacy / sourcemap 回归 | P0 | 低到中 | 一到两天；大部分时间在视觉回归 |
| P2 格式轨道 | oxfmt **正式接入**：stylistic 拆除 + lint-staged `--write` + CI 阻断（锁 0.80.0） | P0 | 中 | 两到四天；首轮全仓格式化的 diff 很大 |
| P3 Oxlint 双轨 | oxlint 与 eslint 并行；去重；本地规则归属决定 | P2（格式与 lint 的边界先定） | 中 | 三到五天；双轨期的规则归属表要人维护 |
| P4 tsdown 轨道 | 共享包打包试点：先 `packages/platform-any/utils-core`，后 `packages/platform-any/contract` | P0；共享包产物基线 | 中到高 | 三到六天；contract 的 barrel 与一致性测试是主要成本 |
| P5 类型检查升级 | P5-pre 清 `baseUrl` + 修真 bug；P5a 影子 1–2 周；P5b tsrs 整批转正；**P5c 引擎全面 TS7（TNB + nest PoC）** | P1；P5-pre 先行合入；P5c 依赖 P0 的 admin 基线 | 中到高（P5c） | 两到三周（含影子期与 PoC）；时间主要在观测与回归验证 |

阶段顺序建议 P0 → P1 → P2 → P3 → P4 → P5，但 **P2 与 P3 可并行**（都在 lint / 格式面，由同一人做更省沟通成本），**P4 与 P5 可并行**（前者动构建、后者动类型检查链）。P5 内部：P5-pre → P5a（影子）→ P5b（转正）串行；**P5c 与 P5b 相互独立**（P5c 走 TNB 外壳，P5b 走 tsrs CLI），可并行。

## 4. 阶段详情

### P0 基线与防护网

**目标**：在换任何工具之前，先能回答「产物变了吗」。后面每个阶段都要靠这一层判断「是不是我改坏的」。

**范围与涉及文件**：

- 构建产物基线：对 admin 的 `apps/admin/vite.config.ts` 当前构建（`dist`）留一份文件清单与体积快照；对 server 的产物按 Dockerfile 的 CMD 路径校验文件存在（`dist/apps/api/src/main.js`）。
- sourcemap 基线：admin 的 sourcemap 由环境开关控制，Sentry 上传前先确认「关了没产物、开了能上传」两态都符合预期。
- CSS 视觉基线：挑若干个关键页（登录、列表、表单、暗色主题各一）做截图，作为 `cssCodeSplit: false` + Lightning CSS 组合的回归依据。
- **admin 类型检查基线**：在干净 HEAD 上跑 `vue-tsc --noEmit`，记录**耗时、诊断数、完整诊断清单**。这是 P5c 里 TNB 的对照组（同一份代码、同一命令、只换引擎）。
- **`check-pre-hooks` 配置化（决策 5）**：把 `CONSUMERS` 的硬编码名单搬到数据（commands 表或独立配置声明「需要 pre-hook 的命令首词」），门禁逻辑只读数据。P1–P5 之后新增消费者只改数据、不动门禁代码。
- 纪律落纸：把「改门禁命令必须同步三表 + 钉死测试」写进本阶段的产出说明（不是新文档，是在各阶段说明里引用本节）。

**入口判据**：当前分支的 `pnpm build` 能过；admin 与 server 都能产出可运行产物。

**验收标准**：

1. 产物快照留档（文件清单 + 体积），后续阶段能一眼比对。
2. sourcemap 两态各有结论：关闭时不产 `.map`，开启时 Sentry 侧能看到上传记录（或明确记录「本机无法验证上传」）。
3. 关键页截图基线可用，且截图过程可重复（同一视口、同一主题）。
4. admin 类型检查基线留档：耗时、诊断数、诊断清单三者齐全，且能重复跑出同一结果。
5. `check-pre-hooks` 改成数据驱动：现有 check-pre-hooks 测试全绿，并演示「新增一个消费者只改数据」也能被识别（加一条测试用例）。
6. 明确写下：`gate-wiring.test.ts` 与 `ci-workflow.test.ts` 是本阶段的「不可绕过」测试，任何阶段改命令都要先让它们绿。

**回滚方案**：本阶段不改产品代码，无需回滚；基线文件若放错位置直接删除即可。

### P1 Vite 收尾（轨道 A）

**目标**：把已经在 Rolldown 上的 admin 构建推到当前稳定版本，并把唯一一处配置矛盾（`minify`）澄清掉。

**范围与涉及文件**：

- `apps/admin/vite.config.ts`：版本升级后的配置核对；`minify` 取值；`rolldownOptions` 与 `codeSplitting.groups` 的现状确认。**先确认没有 `manualChunks` 对象残留** —— 它在 Vite 8 下是 TS2769 硬错（2026-11-27 核实的迁移实录），本仓已用 `codeSplitting.groups` 等价迁移，只需确认干净。
- `output.minify` 的正确形态是 **Oxc 对象**：`{ compress: { dropConsole: true, dropDebugger: true } }`。三个成熟 Vite 8 应用（vbenjs/vue-vben-admin、buqiyuan/vue3-antdv-admin、pure-admin/vue-pure-admin，2026-11-27 逐仓核对）都是这个形态；本仓的 `output.minify` 已经写对，需要改的是 `build.minify: 'esbuild'` 这一层。
- 可选：`rolldownOptions.checks.pluginTimings: false` 关掉插件耗时告警（pure-admin 在用），属于降噪不是必需。
- 插件表（`tooling/vite-config/src/plugins/`）在 Vite 8.4 下的 peer 兼容性核对。
- 共享包的构建配置（`packages/platform-any/contract/vite.config.ts`、`packages/platform-any/utils-core/vite.config.ts`）仍在用 `rollupOptions` 键名；Vite 8 把它作为 `rolldownOptions` 的弃用别名保留，本阶段只核对「是否仍被接受」，不改名（改名归 P4）。
- `tooling/scripts/src/ci/check-pre-hooks.ts` 的消费者名单：P0 已把它配置化（数据驱动），本阶段若新增或替换消费者**只改数据**，不动门禁逻辑。

**入口判据**：P0 的产物与截图基线可用。

**验收标准**：

1. 版本升级后 `pnpm build`、`pnpm types:check`、`pnpm test` 全绿。
2. `minify` 有明确结论：改成 Rolldown 默认的 Oxc 压缩器（更自然），或显式声明 esbuild 依赖并说明理由。
3. CSS 回归：关键页截图与 P0 基线一致，或差异逐条说明原因（Lightning CSS 默认压缩带来的顺序 / 去重变化必须解释清楚）。
4. sourcemap 与 legacy 两处回归有结论；plugin-legacy 目标非 ES5，确认没有因默认 target 提升而改变降级范围。
5. **不改分包策略**：成熟 Vite 8 应用普遍只动 minify 与输出文件名；跨路由图 / 跨业务模块的语义分组有回滚先例（NiftyLeague 因循环 chunk import 运行期炸而 revert，2026-11-27 核实）。本阶段只确认 `codeSplitting.groups` 现状可用。
6. 若改动了任何门禁命令，三表与测试同步，`gate-wiring.test.ts` / `ci-workflow.test.ts` 绿。

**回滚方案**：版本与配置改动都在一个提交里，回退该提交即恢复 8.0.11；回退后需重跑 P0 的产物比对，确认没有残留产物。

### P2 格式轨道（轨道 B）

**目标**：把格式**正式**交给 oxfmt（唯一真源），ESLint 退出格式职责。不做「先观察一段再阻断」的两段式 —— 决策 2 的口径是「没有 1.0 就没有 1.0」，直接进阻断门禁，锁精确版本。

**范围与涉及文件**：

- 新增 oxfmt 配置（尚未建成的文件在正文里用普通名字称呼，例如根级 oxfmt 配置文件），骨架如下：

```jsonc
{
  // 锁精确 0.80.0；升级走独立提交，逐 key 对照当版文档（旧 key 会静默失效）
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  // 已拍板：100（oxfmt 默认值）；接受首轮全仓格式化的一次性大 diff
  "printWidth": 100,
  // 首轮关闭：默认 true 会重排所有 package.json，与 catalog 顺序规则可能打架
  "sortPackageJson": false,
  // 不开：sortImports 单独一步、单独回滚（Sentry 有 customGroups 排序回归的实录）
  "ignorePatterns": [
    "**/dist/**",
    "**/dist-staging/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/env-local/**",
    "pnpm-lock.yaml",
    "**/schema.d.ts",
    "**/components.d.ts"
  ]
}
```

- **stylistic 彻底拆除（决策 1）**：`tooling/eslint-config/base.ts` 与 `vue.ts` 里给 antfu 预设设 `stylistic: false`，末尾加 `eslint-config-prettier` 兜底（ComfyUI 接法）。ESLint 此后只留非格式规则。
- **perfectionist 的 import / export 排序暂留 ESLint**，等 oxfmt 的 `sortImports` 启用时一并迁走；这一步登记为后续独立事项，不混在首轮里。
- `lefthook.yml` 与根 `package.json` 的 `lint-staged` 段：接入格式化，**顺序固定为** `oxfmt --write` → `oxlint --fix` → `eslint --fix`（`oxlint` 这一段在 P3 接入时补上，但位次在 P2 就定死）。注意 lefthook 在 Windows 上的命令写法 —— 命令里不要用双引号包裹参数，避免被 shell 解析成字面量。
- CI 与推送前门禁：`oxfmt --check` 作为**阻断**命令进入三表（`prepush.ts` / `local-ci.ts` / `release/steps.ts`）与钉死测试。这是新增门禁命令，三表同步纪律在这一步必须完整走一遍。

**入口判据**：P0 完成；决策 1 / 2 已定（无需再等任何开放问题）。

**验收标准**：

1. **先小范围试跑**：`oxfmt --check` 只对 `apps/admin/src` 的 ts / vue 跑一遍，量出 diff 规模与形态（`printWidth = 100` 已拍板，这一步是估工作量、不是改决定）。Pinia 证明 `.vue` 可以整个交给 oxfmt，但模板换行行为可能有差异，这一步就是量它的。
2. 首轮格式化**单独成一个提交**，且该提交不含任何逻辑改动；评审只看「是不是只动了空白与排版」。
3. stylistic 拆除后 `pnpm lint`、`pnpm types:check`、`pnpm test` 全绿 —— 不允许出现「oxfmt 与 stylistic 互相改回去」的文件。
4. `oxfmt --check` 在干净仓库通过；在故意改坏格式的文件上让 CI 红（验证阻断真的生效，而不是只跑不判）。
5. lint-staged 顺序固定为 `oxfmt --write` → `oxlint --fix` → `eslint --fix`；lefthook 的 Windows 命令不带双引号。
6. `sortPackageJson` 首轮关闭、`sortImports` 未开，且两者都登记为独立后续事项。
7. oxfmt 在 catalog 里精确锁 `0.80.0`；升级单独成提交。

**回滚方案**：配置、stylistic 拆除、lint-staged / CI 接入是三个提交。**格式回归的回滚方式是回退 oxfmt 版本号**（例如从 0.80.x 退到 0.79.x），不是撤门禁；stylistic 拆除若引发大面积冲突，可整段回退（原规则文件保留在 git 历史里）；首轮格式化提交建议保留（纯格式改动，留着无害）。

### P3 Oxlint 双轨（轨道 B）

**目标**：让 oxlint 先跑一遍快速检查，eslint 继续跑它独有的面；用观察数据决定长期归属。接线方式直接照搬已有三重分工的成熟仓库（ComfyUI 的 oxfmt → oxlint → ESLint 三层，2026-11-27 核实）。

**范围与涉及文件**：

- 用 `@oxlint/migrate` 从现有 flat config 生成一份初版配置，然后**手工收敛**成「`categories: { correctness: 'error' }` 兜底 + 少量显式差异规则」——这是**已拍板**的形态，不手抄几百条规则（Cloudflare / ComfyUI 的当前形态都是极简兜底 + 差异规则；Electron 的「categories 全关 + 全显式」只适合规则面已完全稳定的仓库）。
- `eslint-plugin-oxlint` 接入：用 `buildFromOxlintConfigFile('.oxlintrc.json')` **拆两段** —— ignores 段放 flat config 最前、rules 段放最后，两个 linter 共享同一份 ignore 真源。这是 ComfyUI 的接法，也是「flat config 同 key 后份覆盖前份」这条本仓已有约束的自然延伸。
- 边界处理：末尾加 `eslint-config-prettier`，或与 P2 的 stylistic 划界结果对齐，防止格式化规则与 oxfmt 打架。
- CI：两条各管一件事 —— `oxlint --quiet --format=github`（只报 error、出 PR 注解）与 `oxfmt --check .`（只检查、不改文件）：

  ```bash
  # CI 里并行跑；两者都不负责「修」，修在本地或 pre-commit
  oxlint --quiet --format=github
  oxfmt --check .
  ```

  注意 `oxlint --format=github` 的输出是给 Actions 解析的，本地调试时换回默认格式。
- 本地规则归属评估：`walnut-comment/no-emoji`、`walnut-script/script-header`、`walnut-script/script-exit-code`、`local/sort-nestjs-decorators`、`local/no-cross-lib-relative-import` 逐条决定「移植成 oxlint 的 jsPlugin（alpha，暂不推荐）」「保留在 ESLint」「删除并说明理由」。默认答案是**保留**。
- Vue 模板：官方兼容矩阵明示 oxlint 不 lint 模板，因此模板规则必须留在 ESLint；这一点要在配置里写清楚，避免后续有人以为模板已经有人管。
- **server 包单独处理 `typescript/consistent-type-imports`**：该规则的 autofix 会删掉 NestJS DI 需要的 import（Twenty 记录 3,814 处后禁用）。本仓 server 必须**关 fix 或直接 off**，这与 ADR 0007 的装饰器元数据纪律同源。
- 类型感知：等 P5-pre 的 `baseUrl` 清理合入后再单独开一步（`baseUrl` 是 oxlint type-aware 的硬阻塞）；先 `.ts` 后 `.vue`，且只做**观测**，不接入任何门禁。

**入口判据**：P2 完成（格式与 lint 的边界已定）；决策 3（`categories` 兜底 + 显式增量）已定，无需再等规则组讨论。

**验收标准**：

1. oxlint 能在仓库根跑通，且对现有代码的报告量是可解释的（每类报告有归属：真问题、误报、待观察）。
2. 双轨去重生效：同一文件不再出现「oxlint 报一次、eslint 报一次」的同义重复；ESLint 侧的插件**只关规则、不摘注册**（Kibana 的教训：历史 `eslint-disable` 指令会报 unknown rule）。
3. 本地规则的逐条去留有书面结论（清单见评估第 4.1 节）；默认全部继续在 eslint 侧生效。
4. **CI 判红方式可信**：`oxlint` 用 `--quiet --format=github`（只报 error、出 PR 注解），并配 `--check` 或 `git diff --exit-code` —— 不能只信 `--fix` 的退出码（有「修完仍有错却退出 0」的实录）。
5. 推送前门禁**不变**：oxlint 先以独立命令存在，不进入 `tooling/scripts/src/ci/prepush.ts` 的表，直到连续若干次运行零误报。
6. 生成物全部进 ignore：构建产物、`packages/generated` 的 schema、admin 的组件声明、`env-local/`、lockfile。oxlint 本身不需要做缓存（Electron 五百余文件约 640ms），但**turbo 的缓存 key 要含 lint 配置 hash**（ComfyUI 实证），否则改配置不失效。

**回滚方案**：oxlint 配置与去重插件都是新增文件；回退接入提交即可完全回到纯 ESLint。eslint 侧的规则没有被删除（只被关闭），回滚不需要恢复规则定义。

### P4 tsdown 轨道（轨道 B）

**目标**：把共享包的「Vite lib 模式 + vite-plugin-dts + 手写 barrel」这条管线换成专门的 lib 打包器，并守住对外契约。配置骨架如下（每一条都对应一个真实仓库的已验证写法，2026-11-27 核实）：

```ts
export default defineConfig({
  entry: { /* 与现 vite.config.ts 的 entries 表一一对应 */ },
  format: ['cjs'], // 只产 CJS，与现状一致
  platform: 'neutral', // CJS 下会被忽略并告警（tsdown#1111），是噪音不是错误
  sourcemap: true,
  clean: true,
  minify: false,
  dts: false, // types 指 src、dist 的 d.ts 无消费者；同时绕开 rolldown-plugin-dts 的坑（#451 / #1106）
  deps: { neverBundle: ['easy-fns-ts'] }, // 旧 rollupOptions.external 的对应写法
  exports: false, // 关键：现 exports 形状（source/types/import 指 src）生成器表达不了，手写不动
  outputOptions: {
    exports: 'named',
    esModule: true, // rolldown 默认 'if-default-prop'，纯具名导出入口不会带 __esModule，必须显式
    strict: true,
  },
  publint: false,
  attw: false, // exports 指 .ts 时两者必然假阳性（unocss 也只敢 ci-only + ignoreRules）
})
```

要点逐条：

- **CJS 产物不要开 minify**：压缩后的 re-export 对 cjs-module-lexer 不可见，ESM 侧具名导入会静默丢失。WebChat 的 tsdown 基础配置里专门写了这条注释。
- **`dts: { isolatedDeclarations: true }` 已是失效写法**：0.23.7 的 dts 选项里没有这个字段（现写法是 `dts: { oxc: true }` 或在 tsconfig 开 `isolatedDeclarations`）。而且**不建议开** `isolatedDeclarations`：本仓大量 `as const` 要补显式注解，而 dts 已关，收益为零。
- **barrel 方案三选一，推荐「保留 `packages/platform-any/contract/scripts/build-barrel.ts`」**：tsdown 的产物名同样是 `dist/*.cjs`，现脚本零改动可用。迁移后补一条 **default 导出断言**（CJS 里 `export { default as foo }` 不 unwrap，消费者拿到的是 `{ default: foo }`，tsdown#914）。
- **产物验证用 `node --check` + require 冒烟**替代 publint / attw：exports 指 `.ts` 时这两个工具必然假阳性，会逼人加豁免而不是发现问题。
- 第一步：`packages/platform-any/utils-core`（`entries` 表很短，消费面小）。核对产物形状、CJS 可被 `require`、`dist/*.d.ts` 的现状（当前是占位、无人消费）不被意外改变。
- 第二步：`packages/platform-any/contract`。这里是主要成本：
  - `packages/platform-any/contract/vite.config.ts` 的 entries 表要平移；entries 与 `src` 文件、`exports` 键、`dist` 产物四方一致由 `packages/platform-any/contract/__tests__/entries.drift.test.ts` 守着 —— 该测试解析的是配置文件文本，配置换形态后它要跟着改，否则会红或更糟（静默变成空断言）。
  - `packages/platform-any/contract/package.json` 的 `exports` 四条件（`source` / `types` / `import` 指源码，`require` / `default` 指 CJS）一条都不能动，也不交给 tsdown 生成。
- 版本：锁 `tsdown` 0.23.x，不接受自动升小版本。

**入口判据**：P0 的产物基线可用；P1 已完成（Vite 键名与版本已稳定，避免两件事同时变）。

**验收标准**：

1. `pnpm build` 后，共享包的 `dist` 文件清单与基线逐项对得上（除打包器自身的 banner / helper 差异，需逐条解释）。
2. 后端能正常启动：`require` 消费面逐子路径可用（至少覆盖 guards 与 libs 里实际用到的入口）；每个产物过一遍 `node --check`。
3. `entries.drift.test.ts` 改造后仍然**有效**：故意删一个 entry 或改一处 `exports` 键，测试必须红。
4. default 导出断言存在且能捕获「不 unwrap」的形态。
5. 前端 `import` 仍走源码（`source` / `import` 条件未被破坏），admin 构建与类型检查无变化。
6. `tsdown` 版本在 catalog 里被精确锁住，且有注释说明「0.x，不做自动升级」。
7. `publint` / `attw` **不**作为门禁（原因见上），若临时跑过要记录其假阳性类型。

**回滚方案**：共享包构建配置的改动按包分提交（utils 一个、contract 一个）。回退 contract 的提交即可恢复 Vite lib 管线；回退后必须重跑 `pnpm build` 与后端启动冒烟，确认 `dist` 被重新产出（防止 turbo 缓存命中导致「产物是旧的」）。

### P5 类型检查升级（轨道 C + D）

**目标**：P5 分成两条独立路径 —— **C（检查侧快查，tsrs）**：先清障、再影子、再整批转正；**D（引擎全面 TS7）**：TNB 作为 `typescript` 包面全局接入，nest-on-TNB PoC 先行。收益口径见评估 5.6：tsrs 在 server 上 4.28s、包级项目 3–12x，但主要集中在 CI 冷跑；引擎侧的收益（tsgo）另算。

**P5-pre：`baseUrl` 清理 + 真 bug 修复（独立 PR，先行合入）**

**范围与涉及文件**：

- 全仓 15 份 tsconfig 机械删除 `baseUrl: "."`（除 `apps/admin` 外都没有 `paths`，删除语义零变化；`apps/server` 本来就没有 `baseUrl`）。
- `apps/admin/tsconfig.json` 的 paths 加 `./` 前缀（`@/*: ["src/*"]` → `@/*: ["./src/*"]`），否则 TS5090 —— **这是唯一有语义风险的一处**。
- 修 `packages/platform-web/client/src/browser/file/base64.ts` 的 `img.crossOrigin = 'Anonymous'` → `'anonymous'`（TS7.1 的 lib.dom 收紧；大写本就让跨域图转 base64 静默退化为 no-cors）。

**入口判据**：P1 完成；当前 HEAD 的全仓 `types:check` 与 admin 的 `vue-tsc` 是绿的（作为对照基线）。

**验收标准**：

1. 全仓 `pnpm types:check` 绿、admin 的 `vue-tsc --noEmit` 绿。
2. `--listFiles` 的项目文件集与清理前一致（证明只删了配置键、没改变覆盖范围）。
3. base64 的修复有回归证据（单测或等价的手工验证记录）。
4. **红利确认**：这一步同时解除 oxlint type-aware 的 `baseUrl` 硬阻塞，P3 的类型感知观测可以直接开始。

**回滚方案**：独立 PR，回退即恢复；回退后 oxlint type-aware 与 P5 全部退回等待。

**P5a：影子期（1–2 周 / ≥10 PR）**

**范围与涉及文件**：

- `tsrs` 进 catalog，**锁精确版本 `7.1.0-beta.tsrs5`**（无 `next` tag、`tsrsN` 文本排序只到 tsrs9，禁用范围）；加到需要检查的包的 devDependencies（`hoist: false` 下必须逐包声明）。
- CI 新增 `types:check:tsrs`，**report-only**（失败不阻断）。输出按 `file:line:col code` 排序后与 tsc 的同一排序做 diff。

**入口判据**：P5-pre 已合入；决策 5（#1114 只跟踪、不加双跑门禁）已定。

**验收标准**：

1. 与 tsc 的诊断差集为零，或每条差异都有归属（真 bug / TS7.1 版本差异 / 误报），且真 bug 单独修掉。
2. 影子期满足时长与 PR 数下限；#1114 类随机失败按团队决策**只记录、不设门禁**；若出现可复现的失败模式，触发决策复评而不是自动阻塞。
3. 不出现「同一段代码 TS6 绿、tsrs 红」却没人解释的情况。
4. 影子步骤没有进任何阻断表，回滚成本是删一个 CI step。

**回滚方案**：删除 CI step 与 catalog 条目即可；不影响现有门禁。

**P5b：转正（整批，不混搭）**

**范围与涉及文件**：

- server 与 packages 的 `types:check` **一次性批量**切到 tsrs 作为阻断检查（不要逐个包切，否则 CI 结论取决于哪个包跑哪个检查器）。
- server 的 `tsBuildInfoFile` 分离到独立路径（例如 `node_modules/.cache/tsrs/`）：tsrs 写 Go 格式的 `version: "7.1.0-beta"`，与 TS6 共路径会乒乓失效。
- 本地 `typecheck:watch` **永久保留 tsc**（Zerion 模式）；本阶段**不碰** catalog 的 `typescript` 条目（它的替换是 P5c 的事，P5b 只换检查命令）。
- `apps/server/package.json` 的 scripts 与 `tooling/scripts/src/ci/check-pre-hooks.ts` 的消费者名单同步；门禁命令改动走三表。

**入口判据**：P5a 全部验收通过。

**验收标准**：

1. 全仓 `pnpm types:check` 由 tsrs 跑且全绿；CI 冷跑耗时记录在案。
2. 回滚是一行：把命令指回 tsc，不需要改 tsconfig。
3. `nest build` 完全不受影响（emit 链没动），产物与 P0 基线一致。
4. 没有 `--fast`、没有范围版本号、没有把 tsrs 塞进 watch 脚本。

**回滚方案**：按包的命令改动各自成提交；catalog 里的 `typescript` 条目从未改动，回滚不涉及 lockfile 大改。

**P5c：引擎全面 TS7（TNB 外壳 + nest PoC）**

**目标**：把 `typescript` 包面全局换成 TNB（classic 6.0.3 API 外壳 + 进程内 tsgo 7.0.2 引擎），让 `tsc` / `vue-tsc` / ESLint / Nest 都跑在 7.x 引擎上；「裸装 `typescript@7`」仍等上游，不做。

**范围与涉及文件**：

- **TNB 接入**：pnpm overrides + catalog 双改，把 `typescript` 解析到 TNB 的发布包（版本 `6.0.3-bridge.19.tsgo.7.0.2`）；`vue-tsc` 升到 3.3.14。
- 三条文档 / 产物检查（doc-ts / handwritten-dts / turbo-cache）与架构 drift spec 继续走 `typescript` 的 classic API —— 理论上零改动，但要实测确认。
- **步骤严格按顺序**：
  1. **P0 基线对照**：拿 P0 留档的 admin `vue-tsc --noEmit` 耗时 / 诊断数。
  2. **TNB 接 admin**：换 TNB 后跑同一基线，全量 SFC 诊断逐条 diff，**只接受可归因差异**（版本收紧导致的真问题算可归因并修掉；外壳 / 引擎缺陷算阻塞）。
  3. **nest-on-TNB PoC**：`nest build` 跑通 + `nest start --watch` 跑通 + `createProgram` 路径验证 + ADR 0007 装饰器元数据冒烟（断言 tsc 产 dist 的 `design:paramtypes` 与 SWC 等价）。
  4. **转正或回退**：PoC 通过 → TNB 全局 catalog 转正，server 的 `tsc --noEmit` 此时也跑 tsgo 引擎（与 P5b 的 tsrs 并存；两者都对齐 pinned TS7.1，诊断源差异由影子期口径覆盖）。PoC 失败 → **只把 nest 侧回退到 stock TS6**（恢复一条 catalog 条目），其余部分仍保持 TS7 引擎。

**入口判据**：P0 的 admin 类型检查基线可用；P5-pre 已合入（`baseUrl` 已清）。

**验收标准**：

1. admin 基线对比有数据：耗时与诊断数记录在案；SFC 诊断的每条差异都有归因结论。
2. `nest build` 产物与 P0 基线一致；`nest start --watch` 能正常启动；ADR 0007 的装饰器元数据断言通过。
3. 全仓 `types:check` 在 7.x 引擎上绿；doc-ts / handwritten-dts / turbo-cache 三支检查与 drift spec 在 classic API 面上零改动通过。
4. **单点回退成立**：模拟 PoC 失败时，只回退 nest 侧即可恢复后端构建，其他包的检查仍跑 TS7 引擎。
5. 没有裸装 `typescript@7`；没有把 `@typescript/native` 之类的别名偷偷加回 catalog（双别名方案已作废）。

**回滚方案**：恢复 catalog 的 `typescript` 条目为 stock `6.0.3` 并删除 overrides，重跑 `pnpm install`（lockfile 会变）。两档写清：**全局回退**（整包回到 stock TS6）与**仅 nest 回退**（其余仍是 TNB 引擎）—— 后者是 PoC 失败时的默认动作。

## 5. 阻塞跟踪清单

每一条都写「上游在等什么」与「解除条件」。解除条件不满足时，对应阶段不得跨越红线。

| 阻塞项 | 上游状态（2026-11-27） | 解除条件 |
|--------|------------------------|----------|
| 裸装 `typescript@7` 直装 | `@nestjs/cli` 12.0.15 起带 `assertProgrammaticApiIsSupported` 守卫（issue #3479 open，维护者 2026-09-14 称等 7.1 API 稳定，两次 ping 无应答）；vue-tsc 的 peer 是 `typescript < 7` | nest-cli 合入 7.1 API 支持（PR #3554 及后续，需覆盖 watch 与 paths）；在此之前用 TNB 外壳，去掉外壳是后续优化不是目标 |
| Nest CLI 的 TS7 支持 PR | PR #3554 未批；即便合入也只解决 build（无 watch，paths 会报错） | 合入且覆盖 watch 与 paths 场景 |
| nest-on-TNB PoC 结果 | TNB 支持矩阵只验证 tsc / vue-tsc / tsserver / ESLint；`nest build` / `start --watch` 未验证 | PoC 通过则 P5c 转正；失败则按「仅 nest 回退」执行，并在评估里记录原因 |
| vue-tsc 的第三条路 | TNB 已获 Vue 官方背书（2–3x，见评估 5.7）；官方 v4 = content-mapper + TS7.1、**取消独立 vue-tsc 二进制**（alpha.3，无 stable 日期） | content-mapper v4 stable（届时可去掉 TNB 外壳里的 vue-tsc 依赖） |
| tsrs 随机失败 | issue #1114（2026-11-26 open）：1,240 次运行里 12 次失败（约 1%），tsrs5 复现范围内，maintainer 未回复；**团队决策：只跟踪、不加双跑门禁** | issue 关闭，或锁定触发条件并给出可靠绕法；出现可复现失败模式时复评决策 |
| tsrs stable 与 packaged validation | tsrs2 → 5 无 RC（间隔 2/2/3 天）；TS 7.1 的 RC 按官方 iteration plan 排 2026-12-01、stable 待定；tsrs stable 只在其后且无日期；packaged-release validation 仍 pending；registry 无 `next` tag | 发布 stable 且 packaged validation 转正；在此之前锁精确版本 |
| tsrs 的 Windows watch | NotImplemented，**退出码 5**；named pipes 已实现，真正缺的是 fswatch 后端与 LSP watchdog，**无跟踪 issue、无 ETA** | 补齐 fswatch / watchdog 并给出 ETA；在此之前本地 watch 永久用 tsc |
| @vue/content-mapper v4 | alpha.3；v4 只支持 TS7.1，且不再有独立 vue-tsc | v4 发布 stable |
| oxlint 不 lint Vue 模板 | 官方兼容矩阵明示只 lint script 块 | 官方宣布模板 linting 支持，且经本仓实测误报可接受 |
| `ts-json-schema-generator` / `vite-plugin-dts` 依赖 TS API | 两者都依赖 TS 的 JS API | 两者都发布不依赖 `typescript` 包的版本；在此之前由 TNB 的 classic 面承载 |

红线只有一条：**不裸装 `typescript@7`**（nest CLI 守卫与 vue-tsc peer 都还没解）；TNB 外壳与 tsrs 快查都是允许形态，引擎一律 7.x。

方法论附注：上游「采用名单」不能当证据 —— 官方 Projects Using Oxc 名单把 Vue.js 列为用户，但 `vuejs/core` 实测零 oxlint 痕迹（评估第 6 节）。跟踪上游时一律以仓库 HEAD 的配置为准。

## 6. 门禁与工程联动改动清单

换工具时**必须一起动**的地方。这张表是 P1–P5 的公共检查项，每个阶段收尾时逐行过一遍。

| 联结点 | 要做什么 | 漏掉会怎样 |
|--------|----------|------------|
| 根 `turbo.json` 的 `globalDependencies` | 新增的配置文件（oxlint / oxfmt / tsdown 配置等）逐条登记 | 改配置不失效缓存，门禁全绿但产物是旧的 |
| turbo 的 lint 缓存 key | 需要含 lint / format 配置的 hash（ComfyUI 实证）；oxlint 自身很快，不必为它做额外缓存 | 改了 `.oxlintrc.json` 但缓存命中，跑的是旧规则 |
| `tooling/scripts/src/ci/prepush.ts` / `local-ci.ts` / `tooling/release/src/release/steps.ts` | 新增或改名门禁命令时三处同改 | 「表还在、命令没人跑」；发版电池里跑一条不存在的命令 |
| `gate-wiring.test.ts` / `ci-workflow.test.ts` | 跟随三表改动同步 | 测试红（好的情况），或钉死关系失效（坏的情况） |
| `tooling/scripts/src/ci/check-pre-hooks.ts` 的 `CONSUMERS` | **P0 已配置化**：名单搬进数据（commands 表或独立配置），之后新增消费者（如只跑 tsrs 的检查、仍跑 tsc 的 watch）只改数据 | 生成物不产，检查跑在旧产物上 |
| `tooling/scripts/src/ci/check-turbo-cache.ts` 的推导 | server 构建产物路径变化时确认推导仍成立 | turbo `outputs` 与真实产出一致性失守，缓存命中时静默不产出 |
| `pnpm-workspace.yaml` 的 catalog | `tsrs` 进 catalog 并锁**精确版本**；需要的包逐一声明 devDeps（`hoist: false`）；`tsdown` / `oxlint` / `oxfmt` 同样精确锁；**P5c 的 TNB 走 overrides + catalog 双改**（把 `typescript` 解析到 TNB 发布包）；有构建脚本的包显式 allowBuilds | strict 模式下装不上；或范围版本悄悄漂移；或 TNB 只改了一半、部分包仍解析到 stock TS6 |
| server 的 `tsBuildInfoFile` | 切 tsrs 后分到独立路径（如 `node_modules/.cache/tsrs/`） | TS6 与 tsrs 的缓存文件互相覆盖，反复全量 |
| `tooling/tsconfig/` 预设 | `baseUrl` 等 TS7 / tsrs 不接受的键在 P5-pre 清掉 | 检查器在配置加载阶段就失败；oxlint type-aware 也开不了 |
| `pnpm walnut` 命令表（`tooling/scripts/src/lib/commands.ts`） | 新门禁以命令形式暴露 | 人与 agent 找不到入口，只能记命令 |
| 根 `AGENTS.md` 与 `apps/docs/src/zh-CN/content/monorepo/` 的现状文档 | 工具换代后更新「现在是什么样」 | 文档与代码漂移，且没有任何门禁能拦住 |
| `.github/workflows/` | CI 里新增步骤要与 prepush 表口径一致 | 本地绿、CI 红，或反之 |
| 生成物 ignore 清单 | oxlint / oxfmt 的 ignore 要列全：构建产物、`packages/generated` 的 schema、admin 的组件声明、`env-local/`、lockfile | 生成物进报告，假红把真问题淹没 |

## 7. 非目标

明确**不做**的事，避免范围蔓延：

- **不删 `typescript` 依赖位**。它会被 TNB 以同名包面接管（classic 6.0.3 API + tsgo 引擎）；文档 / 产物检查三支、架构 drift spec、`ts-json-schema-generator` 与 `vite-plugin-dts` 继续走 classic 面。
- **不裸装 `typescript@7`**。nest CLI 守卫（#3479 / #3554）与 vue-tsc 的 peer `<7` 都还没解；TNB 外壳是当前的合法形态，等上游支持后再评估去掉外壳。这条是轨道 D 唯一等上游的地方。
- **不做 catalog 双别名方案**。已作废（决定 ⑥）：TNB 全局接入后它失去意义；也不把 `@typescript/native` 之类的别名偷偷加回 catalog。
- **不把 tsrs 当 vue-tsc / Nest 的后端**。tsrs 是独立 CLI 快查，API 是 7.1 形态、没有 `createProgram`；admin 与 Nest 的 7.x 引擎由 TNB 提供。
- **不混用检查器**。不给一部分包换 tsrs、一部分留 tsc；要换就整批换（或影子期明确「以哪个为准」）。
- **不用 `tsrs --fast`**。它的官方定位是「可能改变诊断与退出码」，与门禁的确定性要求冲突。
- **不全量替换 ESLint**。Vue 模板、五条本地规则、类型感知的分层禁令三项至少留一项在 ESLint，因此 oxlint 只能是第二轨。
- **不把共享包改成 ESM-only**。后端 `require` 消费面是既成事实；tsdown 的 CJS 维护模式对我们刚好够用。
- **不升 Vitest 5**。本仓 vitest 4.1.2 的 peer 已含 vite ^8，升 5 是可选优化，不属于本计划；如果将来要做，单独立项。
- **不做「一次换完全部工具」的演示分支**。四轨道正交的价值就在于任意一条停下都不影响其他三条。
- **不趁 P1 重划分包**。成熟 Vite 8 应用只动 minify 与文件名；语义分组有运行期回滚先例。
