# Turborepo 缓存边界（实测判据表）

> **一句话**：本页回答「**改哪个文件，会让哪个 task 的缓存失效**」。
> 所有结论都是**实测**出来的，不是从配置推的；每条都给了可重跑的命令。
> 机械守卫：`pnpm lint:turbo-cache`（push 前、CI、发版电池三处都跑）。

本仓几乎所有常用命令都走 turbo 缓存（`pnpm build` / `test` / `lint` / `types:check`），
所以「边界错了」的代价不是慢，而是**静默**：`FULL TURBO` + exit 0，
但门禁回放了一份与当前代码无关的旧结论。

---

## 一、怎么测（唯一真源）

```bash
pnpm exec turbo run build build:stage transit types:check lint test --dry=json
```

`--dry=json` 的返回里有两样东西就是全部答案：

| 字段 | 含义 |
|------|------|
| `tasks[].inputs` | 这个 task 的哈希**逐文件**输入（`包内相对路径 → 内容哈希`） |
| `tasks[].hash` | 这个 task 最终的键 |
| `globalCacheInputs.files` | 全局哈希里那些**文件** |
| `globalCacheInputs.hashOfExternalDependencies` | 外部依赖（锁文件解析结果）那一块 |
| `globalCacheInputs.hashOfInternalDependencies` | **内部依赖**那一块（见下，最反直觉的一处） |

要验证「改 X 会不会失效」，改完再跑一次比 `hash` 即可 —— 本文所有行都是这么得出的。
**注意**：`turbo` 把**自己的 cwd** 当成仓库根，在子目录里跑只会看到那一个包、
照样「全部成立」⇒ 必须在仓库根跑（门禁里对此有硬断言）。

---

## 二、一个 task 的哈希由四块拼成

1. **全局哈希** —— `globalDependencies` 的文件内容 + `globalEnv` 的值 + **内部依赖哈希**（见第四节）+ engines
2. **本包输入** —— `inputs` 解析出的文件集合（内容哈希；`$TURBO_DEFAULT$` = 包内所有
   **git 跟踪 + 未被忽略的未跟踪**文件）
3. **依赖任务的哈希** —— `dependsOn` 里 `^xxx` / `xxx` 指到的上游 task 的哈希，递归
4. **声明的环境变量** —— `env` 里那些（值进哈希）

第 3 条是**传播**的来源：`^build` 让「上游的 build 哈希」进到本 task，
而 `transit`（本仓新增的传递节点）让「上游的 inputs」沿依赖图逐级并进来 —— 见第四节。

---

## 三、边界表（2026-09-23 实测）

「→ N 个 task」是本仓当前 90 个 task 里的失效个数。

### 3.1 全仓失效（改一次，90 个 task 全 miss）

| 文件 | 机制 |
|------|------|
| `pnpm-workspace.yaml` | `globalDependencies`（catalog 在这里，合理） |
| `eslint.config.ts` · `commitlint.config.ts` · `knip.config.ts` | `globalDependencies` |
| 根 `package.json` · `tsconfig.json` · `.gitattributes` | `globalDependencies` |
| `packages/tooling/tsconfig/*.json` | `globalDependencies`（这个 glob 顺手把该包自己的 `turbo.json` 也纳入了） |
| `packages/tooling/vitest-config/*.ts` | `globalDependencies` |
| **`packages/tooling/{eslint-config,release,scripts}` 下的 `.ts` 源文件** | **内部依赖哈希** —— 见下 |
| `pnpm-lock.yaml` 的**语义**变化（依赖版本真变了） | 全局外部依赖哈希 |

> **内部依赖哈希是什么**：根 `package.json` 依赖到的那几个 workspace 包，
> 它们的**源码内容**也算全局输入。实测：改 `packages/tooling/eslint-config/base.ts`
> 一行注释 → 90 个 task 全失效（`hashOfInternalDependencies` 变了）。
> 但它们的 `package.json` / `tsconfig.json` / `turbo.json` / `README.md` **不在**这一块里
> （只影响自己那几段）。**这不是直觉能推出来的**，所以它被写进了门禁与本文。

### 3.2 本包 + 下游

| 改什么 | 失效范围 |
|--------|----------|
| 任一包的 `src/**`、`package.json`、`tsconfig.json`、`turbo.json` | 本包 5 个 task；+ 每个下游包的 `build` / `build:stage` / `test`（走 `^build`）；+ 下游的 `types:check`（走 `transit`） |
| 包内**新增一个未被 gitignore 的未跟踪文件** | 同上（**未跟踪也算输入**，实测：往 `contract/src` 丢一个 `.txt` → 20 个 task 失效） |
| `apps/admin/` 下任何东西（含 `build/**`、`vite.config.ts`、`uno.config.ts`） | 只影响 admin 自己（5 个 task），**不外溢** |
| `apps/server/libs/**` | 只影响 `@walnut/server`（6 个 task），**不外溢** |
| `apps/*/env-encrypted/.env.*`（密文，进仓库那份） | 只影响该 app |

实测数字：改 `packages/platform-any/types/src/index.d.ts` → **21 个 task**；
改 `packages/platform-web/ui/src/index.ts` → **11 个**；改 `apps/server/libs/db/src/index.ts` → **6 个**（只有 server）。

### 3.3 只有 docs 的 build

| 改什么 | 失效范围 |
|--------|----------|
| `apps/docs/src/**/*.md`（站点内容） | **只有 `@walnut/docs#build`**（1 个 task） |

这一条是**刻意**的：VitePress 的构建同时就是**死链门禁**，所以根 `build` 任务那句
`!**/*.md` 被 `apps/docs/turbo.json` 的包级覆写抵消掉了。
包级 `inputs` 是**整体替换**通用任务那条（实测：把根 `build.inputs` 里的 `!**/*.md` 删掉，
`docs#build` 的输入一个都没变），而 `outputs` **会保留**。

### 3.4 完全不失效

| 改什么 | 说明 |
|--------|------|
| 根 `README.md` · `AGENTS.md` · `CLAUDE.md` · `CONTEXT.md` · `TODO.md` | 不在任何包目录内，也没进 `globalDependencies` |
| `apps/*/AGENTS.md`、各包 `README.md` | 被 `!**/*.md` 排除（改 README 不该重建） |
| `.github/workflows/**` · `lefthook.yml` · `.syncpackrc.json` · `.npmrc` · `.gitignore` · `docker-bake.hcl` · `deploy/**` | 与任何 task 的产物无关 |
| **一切被 gitignore 的东西**：`dist/`、`.turbo/`、各包 `node_modules/` | `$TURBO_DEFAULT$` 看不见 |

> ⚠️ 但 **gitignore 会被显式 glob 盖过**：实测给 `build.inputs` 加一句 `env-local/**` 之后，
> admin 的构建输入从 748 → 752 条，多出来的正是那个被忽略目录里的 4 个文件。
> 这正是 `env-local` 那个缝的补法（见第四节）。

---

## 四、四条已经修掉的缝（都是实测出来的）

### 4.1 `build:stage` 报成功却一个文件都没产出 ✅ 已修

`apps/admin` 的 staging 产物目录由 `VITE_BUILD_OUT_DIR` 决定，实际值是 `dist-staging`
（生产是 `dist`）。而根 `turbo.json` 的 `build:stage.outputs` 只写了 `dist/**`。

**实测后果**（这是本文最有价值的一条）：

```
删掉 apps/admin/dist-staging → pnpm build:stage
  Tasks:    1 successful, 1 total
  Cached:   1 cached, 1 total
  Time:     327ms >>> FULL TURBO
命中后 dist-staging 文件数 = 0        ← 一个都没有
```

即：**缓存命中只回放日志，不落产物，而退出码是 0**。
任何依赖 `pnpm build:stage` 产物的流程（或人）拿到的是一句「成功」。

**改法**：`build:stage.outputs` 补上 `dist-staging/**`。
**守卫**：门禁按 `env-local/.env.stage` 里 `VITE_BUILD_OUT_DIR` 的**真实取值**去核对 outputs ——
判据来自配置本身，不是手抄的目录名。

### 4.2 `types:check` 看不到依赖包的源码 ✅ 已修

本仓 6 个共享包**全部源码直消费**（`exports` 指 `./src/**`），下游的类型是从**源码**读的。
但 `types:check` 原本是 `dependsOn: []`，而依赖包的源码不在它的 `inputs` 里。

**实测**：改 `@walnut/types` 的 `src/index.d.ts` 一行注释 → 14 个 task 失效，
而 `@walnut/admin#types:check` **纹丝不动** ⇒ 类型门禁回放假绿。

**改法**：新增一个**没有脚本的传递节点任务** `transit`（`dependsOn: ["^transit"]`，
`inputs: ["$TURBO_DEFAULT$"]`），让 `types:check` 挂 `dependsOn: ["transit"]`。
于是「上游的 inputs」沿依赖图逐级并进本 task 的哈希。改完同一个实验 → 21 个 task 失效，
`admin#types:check` 正确失效。

**为什么只挂 `types:check`**：`build` / `test` 走 `^build` 已经覆盖（那几个 echo 的 build
任务 inputs 就是包内文件）；`lint` **刻意不挂** —— ESLint 不跨包跟随 import，
挂了只会让 lint 的命中率大跌。

### 4.3 改解密后的 `.env` 不会重建 ✅ 已修

Vite 的 `envDir` 是 `apps/admin/env-local`，而它**被 gitignore** ⇒ 不进 `$TURBO_DEFAULT$` ⇒
不进哈希。改了它（或重跑 `pnpm setup-env` 换了值）构建**不失效**，打出来的包内联的是旧 `VITE_*`。

**改法**：`build` / `build:stage` 的 `inputs` 显式加 `env-local/**`
（实测显式 glob 能盖过 gitignore）。

### 4.4 `@walnut/server` 的 `build` 与 `build:stage` 写同一个目录 ✅ 已修

`apps/server/infra/nest/{prod,stage}.json` 的 `compilerOptions.outDir` **原本都是默认的 `dist`**，
而根 `turbo.json` 给这两个任务声明的 outputs 也都是 `dist/**`。
这正是 4.1 那个 bug 的**另一半**：两条流程声明了同一个产物面，
缓存命中会把盘上的产物换成另一条流程的那一版（后跑的那次说话）。

**改法**（用户 2026-09-23 拍板：「build:stage 肯定要单独输出到一个独立的 dist 下」）：
把**最外层那个目录名**换掉。踩了两个坑，都记下来：

1. **`outDir` 的真源是 tsconfig，不是 `nest-cli` 的配置**。先在 `nest/stage.json` 的顶层与项目级
   都写了 `compilerOptions.outDir: "dist-stage"`，实测 **Nest 的 SWC builder 完全忽略它** ——
   编译产物照旧落 `dist/`（`apps/server/tsconfig.json` 里写着 `outDir: "./dist"`），
   **只有 `assets[].outDir` 生效**；而 `deleteOutDir: true` 照样先把 **prod 的 `dist` 删了再写**。
   正确做法是给 staging 一份自己的 tsconfig（`apps/api/tsconfig.app.stage.json`，只覆盖
   `outDir` 与 `tsBuildInfoFile`），再让 `nest/stage.json` 的 `tsConfigPath` 指向它。
2. **`nest/*.json` 由 Nest CLI 按严格 JSON 解析**（不是 JSONC）。第一版我在里面写了注释，
   构建直接报 `Expected property name or '}' in JSON`。说明因此写在
   `apps/server/infra/README.md` 而不是配置里。

里面的 `apps/api/src` 结构不动（那由 Nest monorepo 的 `root` / `sourceRoot` 决定）。
路径有**四处**同源声明，改一处必须改其余：`apps/api/tsconfig.app.stage.json` 的 `outDir`（真源）、
`nest/stage.json` 的 `tsConfigPath`（**顶层与 `projects.api` 两处**）与三条 `assets[].outDir`、
`apps/server/package.json` 的 `start:stage`、根 `turbo.json` 的 `build:stage.outputs`。

**实测**：`turbo run build:stage --filter=@walnut/server` 冷跑 → `dist-stage` 1465 个文件、
含 `dist-stage/apps/api/src/main.js`，而 prod 的 `dist` **一字未动**（754 个文件，sha 不变）；
删掉 `dist-stage` 再跑 → `FULL TURBO` 命中并**完整回放 1465 个文件**。

> 两个 app 的 staging 目录名**不同**是刻意的：admin 侧是 `dist-staging`，
> 它来自 `VITE_BUILD_OUT_DIR` —— 那个值在**加密的** env 文件里，改它要重建 dotenvx 密钥、
> 会让 CI 的 `ENV_KEYS` secret 失效。所以只改 server 这一侧，并把两个目录名都写进 `outputs`。

### 4.5 `NODE_ENV` 该不该进哈希 ✅ 已裁决（不进）

原本放在 `globalEnv`（进哈希）。实测代价：`NODE_ENV=production` 与 `NODE_ENV=development`
跑同一份代码 → **90 个 task 全部失效**，白扔一整轮缓存。

**裁决：改到 `globalPassThroughEnv`**（可见、不进哈希）。两条理由：

1. **可见性仍然是必须的** —— Turbo 的严格模式会剥离未声明的变量，而 `NODE_ENV` **不在**
   Turbo 的内置放行名单里（不声明就被剥成 undefined）。
2. **它不该进哈希** —— 没有任何 task 的**产物**取决于外部传进来的这个值：
   `@walnut/server` 的 build 由脚本自己 `cross-env NODE_ENV=…` 设定；
   `@walnut/admin` 走 `vite build`，Vite 自己强制 production、vitest 自己强制 test；
   `@walnut/docs` 走 `vitepress build`，同理。

判据可重跑：`NODE_ENV=a pnpm exec turbo run build --dry=json` 与 `NODE_ENV=b …` 比 hash ——
改前 90/90 失效，改后 **0/90**。

### 4.6 根级文件的 lint 完全不缓存 ✅ 已修

根 `lint:root` 脚本（`eslint *.ts *.json *.yaml`）以前只以**根脚本**的身份被 prepush 与发版电池直接调用
⇒ 每次推送都真跑，而它检查的只是根目录那 **9 个**文件。

**改法**：在根 `turbo.json` 里定义 **`//#lint:root` 根任务**（`//#` 前缀 = 没有对应 workspace 包的任务），
`inputs` **逐字等于脚本里那三个 glob**；prepush 与发版电池改走 `turbo run lint:root`。

**为什么 inputs 要逐字相等**（本项唯一需要记住的规矩，也是两个坑的分界线）：

- 写成 `$TURBO_ROOT$/**` 再逐条排除 ⇒ 那些「随运行变化」的目录（`.turbo`、各包 `dist`、
  `node_modules`）漏排一个，缓存就**永不命中**；
- 排过头（例如顺手排掉 `packages/**`）⇒ 根 eslint 配置 import 的东西不进缓存键，
  改完规则却回放旧结论 —— **门禁假绿**（参考仓实测踩过这个方向）。

**实测**：冷跑 3.8s → 热跑 **0.11s**（`FULL TURBO`）。边界也精确：
改 `node-modules-inspector.config.ts` 或 `.syncpackrc.json`（根文件，且**不在** `globalDependencies` 里）
→ 根任务失效、**其他 0 个 task 失效**；改 `apps/admin/src/main.ts` → 5 个包任务失效、根任务**不动**。

> 顺带翻了一处**过期的断言**：发版电池的测试原本钉着「`lint:root` 只是根脚本、不是 turbo 任务，
> 所以绝不能放进 turbo 的 argv」—— 理由是 `turbo run lint lint:root` 会
> `Could not find task` 当场退 1。那是**当时**的实测事实；`//#lint:root` 定义出来之后前提就没了，
> 现在 `turbo run lint lint:root` 实测 16 个任务、正常跑通。断言已按新事实改写并留了记录。

### 4.7 未声明的环境变量会被静默剥离 ✅ 已加护栏

Turbo 的严格 env 模式会把「没在 `env` / `globalEnv` / `passThroughEnv` / `globalPassThroughEnv`
里声明过」的变量从任务进程里**剥掉** —— **没有任何报错**，只是那个变量在构建期变成 `undefined`。
本仓此前对这件事**零护栏**。现在接了 `eslint-plugin-turbo` 的 `no-undeclared-env-vars`（error 级），
判据的唯一真源就是根 `turbo.json`（插件按被 lint 文件的目录向上找）。

**上线当场抓出 6 个真缺口**（参考仓同类规则抓出 5 个）：

| 变量 | 谁在读 | 被剥掉的后果 |
|------|--------|--------------|
| `npm_execpath` | `@walnut/scripts` 的 `lib/pnpm-launcher.ts` | 定位不到 pnpm 的真 exe，退化成「找不到 pnpm」 |
| `PATH` | 同上（查找路径的后备） | 同上 |
| `PREPUSH_CONCURRENCY` | `prepush.ts` 的并发旋钮 | 旋钮失效、静默回落默认值 |
| `GITHUB_API_URL` | `@walnut/release` 的 `github.ts` | GitHub Enterprise 覆盖点失效 |
| `GH_TOKEN` | `@walnut/release` 的 `credentials.ts` | token 回退来源失效 |
| `WALNUT_TEST_MARKER` | 发版工具链的测试夹具 | （见下：夹具，走 allowList 而不是声明） |

**四类豁免，各自有不同理由**（这个分类本身就是这条规则的落地经验）：

| 类别 | 成员 | 为什么不进 `turbo.json` |
|------|------|------------------------|
| 框架编译期内建 | `DEV` `PROD` `SSR` `BASE_URL` | 打包器在编译期替换成字面量。规则**同时匹配 `import.meta.env.X`**，所以 `apps/admin/src/utils/constant/vue.ts` 那三行会被误报 |
| 运行时注入 | `npm_package_version`、`npm_config_*` | 由 npm/pnpm 执行脚本时注入，不是外部传入 |
| 测试夹具 | `WALNUT_TEST_MARKER` | 用例自己设再断言，不是任何代码的依赖 —— **只在测试文件里**豁免 |
| **运行期配置面** | `apps/server/libs/config/src/modules/*.config.ts` 的 ~70 个（`APP_*` / `AUTH_*` / `DATABASE_*` …） | 见下 |

最后那一类值得单独说：它们是 `@nestjs/config` 的 `registerAs` 工厂，读的是**磁盘上的
`env-local/.env.*`**（`pnpm setup-env` 解密而来），由 `ConfigModule` 在**进程内**灌进 `process.env`。
把它们写进 `globalPassThroughEnv` 是**语义错误** —— 那份清单的含义是「外部传给 turbo 任务的变量」。
判据（2026-09-23 实测）：全仓 `process.env.*` 共 **75 个不同变量名**，其中 **74 处集中在这个目录**；
去掉它之后，剩下的命中刚好就是上面那 6 个真缺口 —— 也就是说这份豁免**只**盖住了运行期配置面，
没有盖住真缺口。豁免写在 `nest.ts` 里并附了这段理由。

**验证**：注入一个未声明的 `process.env.WALNUT_BOUNDARY_PROBE` → 规则报红（并**字节级还原**验证过）。

**接线时踩的三个坑**（都会静默失败，记下来省得下次重踩）：

1. **共用的一段必须三个预设都挂**。`base` / `vue` / `nest` 各自直接调 `antfu(...)`，`nest` **不经过**
   `base` —— 第一版只改了 `base.ts`，跑 server 的 lint 得到 **0 条命中**（看着像「没有缺口」，
   其实是规则根本没生效）。所以抽成了 `eslint-config/turbo-env-vars.ts`。
2. **那个相对导入不能带 `.ts` 扩展名**。`nest.ts` 以类型方式引入 `base.ts`，于是 `base.ts` 会进
   `apps/server` 的类型程序，而那份 tsconfig（ADR 0012 自包含）没开 `allowImportingTsExtensions`
   ⇒ 带扩展名让 `@walnut/server` 的 `types:check` 报 TS5097。同一个坑 `nest.ts` 的文件头早就写过。
3. **规则元组不能用 `as const`**：`readonly [...]` 不满足 flat config 的 `RuleEntry`（要求可变元组），
   会报 TS2345。

---

## 五、交叉对比：调研文档 / 参考仓 Z / 本仓

三份材料回答的是同一个问题，但**深度差两级**。

| 议题 | 仓内调研文档（`industry-research/05`） | 参考仓 Z（另一个更成熟的内部 monorepo） | 本仓现在 |
|------|--------------------------------------|------------------------------------------|----------|
| `inputs` 精确化 | ✅ 提出（「默认 hash 包内所有文件，改 README 也会失效」） | ✅ 做到，且**按消费面分层**：全包共享的根输入放 `transit`，只有某个 app 消费的（`.env*` / `types/**` / `vendor/**`）收进该 app 的包级 `turbo.json` | ✅ 做了排除与包级覆写，但**没有分层**：全局输入一律 `globalDependencies`，一处改动全仓失效 |
| 依赖包源码变更 | ❌ 未涉及 | ✅ **`transit` 传递节点**（本仓直接采纳了这个设计） | ✅ 本轮补上 |
| 产物目录 | ⚠️ 只写「不声明 `outputs` 等于放弃缓存」，**没说清真正的症状**：声明了但**漏一个目录**时是「命中缓存 ⇒ 静默不产出 + exit 0」 | ✅ 实测过同一类 bug，并把 `dist` / `dist-stage` **按画像分离** | ✅ 本轮补上 `dist-staging`，并把它做成门禁（Z 仓靠断言 + 负向验证器） |
| 根级文件的缓存 | ❌ 未涉及 | ✅ 有 `//#lint:root` 这种**根任务**，inputs 用 `$TURBO_ROOT$/**` + 逐条排除运行期目录，且记了「漏排除 ⇒ 缓存永不命中」「排除过头 ⇒ 门禁回放假绿」两个方向的坑 | ✅ 已补 `//#lint:root` 根任务（inputs 逐字等于脚本的 glob），冷跑 3.8s → 热跑 0.11s，见 4.6 |
✅ **已接** `no-undeclared-env-vars`（error 级，三个预设共用一段），上线当场抓出 **6 个真缺口**；四类豁免（框架内建 / 运行时注入 / 测试夹具 / 运行期配置面）各有理由，见 4.7
| 缓存淘汰 | ❌ 未涉及 | ✅ `cacheMaxAge: "14d"` + `cacheMaxSize: "5GB"` | ✅ 已对齐（同日把 turbo 升到 2.11.2 —— 这两个键要 2.10+） |
| 并发 | ❌ 未涉及 | ✅ `concurrency: 4`，并与 vitest 的 `maxWorkers: '50%'` 一起收敛 | ⚠️ `concurrency: "4"` 已加（Turbo 默认是 **10**，本仓 12 核 ⇒ 收了一半多）；但**没**跟着设 vitest 的 `maxWorkers` —— 本机实测两种设置下全仓 test 都是 9.5–11s（无差异），而在小核 CI 上 `50%` 反而可能欠配。结论与实测记在 [Turbo](./turbo) |
| 边界怎么被守住 | ❌ 未涉及 | ✅ 把缓存断言写进 `check-scripts` / `check-package-standard`，并给关键断言配**负向验证器**（注入错误证明它真会红） | ✅ 本轮补上 `walnut-check-turbo-cache` + 7 个注入用例 |
| 远端缓存 | ⚠️ 推荐接入（后被推翻） | ✅ 明确只用本地缓存，理由是「单机验证够用、CI 是构建 tag 不是增量」 | ✅ 同为不接入，理由一致 |

**哪边更好，逐条说**：

- **调研文档**是**入门级**的：它把「有 `inputs` / `outputs` / `env` 这三样东西」讲对了，
  但**没有一条实测**，也没触及「写错了会怎样」。它的 §8 差距表还停在 2026-09 之前
  （写着 `inputs` 未配置、`env` 未区分），本仓早就做了 —— 那份表需要重写。
- **参考仓 Z** 明显更深：它的 `turbo.jsonc` 里每条规则都带**实测结论和日期**，
  甚至记录了「哪个断言曾经只是注释里的承诺、其实不存在」。本仓这一轮的三条修正
  （`transit` / 产物目录 / env 进键）里有两条是**直接采纳**它的设计，一条（产物目录）
  是**它的实测结论让我们提前知道该去查**。
- **本仓比 Z 仓弱的地方**（都已记进架构待办，不是本轮范围）：
  没有 `NODE_ENV` 该不该进哈希的裁决、没有未声明 env 的护栏、没有缓存淘汰与并发上限、
  `lint:root` 不缓存。**本仓比 Z 仓强的地方**：输入集合的实测边界表是**独立做的**
  （用 `--dry=json` 直接量，而不是靠断言间接守），而且工具链包少一半、图更浅。

> 「参考仓 Z」是另一个私有仓库，不在此展开其路径与业务内容；
> 上面的对比只保留与本仓决策相关的部分。

---

## 六、这道门禁守什么（每条都有 rule id，报错时按它定位）

`pnpm lint:turbo-cache` **不改任何文件**，只拿 `--dry=json` 的解析结果 + 配置文件里的真实取值核对一组不变量
（**表里不写条数** —— 它随门禁增删而变；真源是 `check-turbo-cache.ts` 里的 rule id）：

| # | 不变量（rule id） | 不守会怎样 |
|---|------------------|-----------|
| 1 | 每个 workspace 包都有 `turbo.json`，且 `extends: ["//"]` + 非空 `tags`（`package-turbo-json`） | 那个包**静默不受** `turbo boundaries` 约束 |
| 2 | `globalDependencies` 每条都命中真实文件（`global-dependency-exists`） | 写错一个字符 = 少一个全局失效源（本轮实测出 `packages/tooling/tsconfig/*.json` 顺带纳入了 `turbo.json`，说明这类 glob 值得核） |
| 3 | 有 `env-local/` 的 app，其 `build` / `build:stage` 的 inputs 必须含 `env-local/**`（`env-local-in-inputs`） | 改 .env 不重建（4.3） |
| 4 | 从 `env-local/.env.*` 读出的 `VITE_BUILD_OUT_DIR` 必须出现在对应任务的 `outputs` 里（`outputs-cover-artifacts`） | 缓存命中静默不产出（4.1） |
| 5 | `transit` 存在、带 `^transit`，且 `types:check` 挂它（`transit-exists` / `transit-chains`） | 依赖包源码变更 ⇒ 类型门禁回放假绿（4.2） |
| 6 | `@walnut/docs#build` 的输入里有 `.md`（`docs-build-sees-markdown`） | 改文档不重建 ⇒ **死链校验被跳过** |
| 7 | 同一个 app 的 prod 与 stage **不许落进同一个产物目录**（判据顺着 `tsConfigPath → extends` 读 tsconfig 的 `outDir`），且该目录必须在 `build:stage.outputs` 里（`stage-outdir-separate`） | 两条流程抢同一目录 ⇒ 缓存重放互相覆盖；`deleteOutDir` 还会先删掉对方的产物（4.4） |
| 8 | `//#lint:root` 的 `inputs` 与根脚本里那几个 glob **双向一致**（`lint-root-inputs`） | 写成大排除式 ⇒ 漏排一个运行期目录就**永不命中**；排过头 ⇒ 根 eslint 配置的改动不进缓存键、**门禁回放假绿** |
| 9 | `tags` 的**形态**：字符串、小写 kebab-case、无重复（`tag-shape`） | `Platform_Web` 这种拼法能通过 JSON 校验，却**匹配不上** `boundaries` 里那条 `platform-web` 的规则 ⇒ 与"没写"同效 |
| 10 | **平台 tag 与目录组一致**：`packages/platform-any/*` 必须带 `platform-any` 且不带另两个（`platform-tag-matches-dir`） | 那条 boundaries 规则会**套到错的一侧**（比如 platform-any 的包声明了 platform-web，于是它躲开了本该受的约束） |
| 11 | **反向断言**：根 `boundaries.tags` 的每个 key 都得有包真的声明它（`boundary-rule-has-subject`） | 那条规则**永远不会触发** —— 恒关的规则等于没有规则（与 `lint:doc-budget` 的「预算用不到一半也算失败」同一族） |

第 9–11 条是 2026-09-23 交叉对比时补的（待办 P1-17）：原先把「非空 tags」当成够用了，
但它只挡住「整个忘写」，挡不住「写了个不会匹配任何规则的 tag」—— 后者同样是**静默豁免**。

> ⚠️ **这道门禁曾经在 CI 上从没成立过**（2026-09-23 读出来的真 bug）：
> `loadTurboDry()` 原本是 `execFileSync('cmd', ['/c', 'pnpm exec turbo … 2>nul'])` ——
> 那是**只在 Windows 上成立**的写法，而 CI 的 runner 是 `ubuntu-latest`：那里没有 `cmd`，
> 直接 ENOENT ⇒ 这一步在 CI 上只会**报错退出 2**。（当时那批提交还没推过，所以没红过 ——
> 一推就会红。）现已改走 `getPnpmBin()`（本仓唯一被认可起 pnpm 的方式，Windows 上
> `execFileSync('pnpm', …)` 同样会 ENOENT，而 `shell: true` 会重新解析 argv）。
> `check-turbo-cache.test.ts` 里有一条**剥注释后**扫源码的守卫，防止再退回去。

**它真的会红吗**——注入用例逐个验过（改完即还原，`turbo.json` sha 不变）：

| 注入的错误 | 报出的规则 |
|-----------|-----------|
| 输出目录漏声明（复现 4.1） | `outputs-cover-artifacts` |
| `env-local` 掉出 inputs | `env-local-in-inputs`（admin 与 server 各两条） |
| `types:check` 掉了 `transit` | `transit-chains` |
| `transit` 不再向上串联 | `transit-chains` |
| `globalDependencies` 写了不存在的路径 | `global-dependency-exists` |
| 删掉某个包的 `turbo.json` | `package-turbo-json` |
| docs 的 build 不再把 `.md` 当输入 | `docs-build-sees-markdown` |
| server 的 stage 又写回 `dist`（P3-22 复现） | `stage-outdir-separate` |
| `nest/stage.json` 的 `tsConfigPath` 指回 prod 的 tsconfig | `stage-outdir-separate` |
| `build:stage.outputs` 漏掉 `dist-stage/**` | `outputs-cover-artifacts` |
| `//#lint:root` 的 inputs 少一个 glob | `lint-root-inputs` |
| 改成 `$TURBO_ROOT$/**` 大排除式 | `lint-root-inputs` |
| 根脚本多检查一类文件、inputs 没跟上 | `lint-root-inputs` |
| tag 写成 `Platform_Web` ／ tags 有重复 | `tag-shape` |
| `packages/platform-any/*` 漏了 `platform-any`／声明了 `platform-web` | `platform-tag-matches-dir` |
| `boundaries.tags` 里有一条没有包声明 | `boundary-rule-has-subject` |

第 9–11 条的三行用例走的是**临时夹具仓库**（`mkdtemp` 造一个只有 1 个包的迷你仓，
把 `dry` 的 `directory` 指过去）—— 因为 tags 是门禁从**盘上的 `turbo.json`** 读的，
没法像 outputs 那样靠改 `dry` 注入。

另外还有一道**跑错目录**的守卫：在子目录里跑时 turbo 只会看到 1 个包、
所有断言照样成立 —— 门禁对此硬报错（`turbo 只在 <cwd> 下发现了 1 个包`），
不让它退化成假绿。

---

## 相关文档

- [Turbo](./turbo) —— 任务编排与边界（本页是它的「缓存」那一半的展开）
- [package.json & Scripts](./package-scripts) —— 根脚本与包脚本的分工
- [📋 架构待办事项](./architecture-todo) —— 4.4 与「本仓比 Z 仓弱的地方」都登记在这里
