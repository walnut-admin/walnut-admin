# Knip：死代码与无用依赖检测

## 概述

[Knip](https://knip.dev/) 是一个面向 TypeScript monorepo 的死代码检测工具。它会从每个包的入口文件出发，追踪整个 import 图，自动发现：

- **未使用的文件** —— 源码文件没有被任何地方 import
- **未使用的 exports** —— 函数/类型/变量 被导出但无消费者
- **未使用的 npm 依赖** —— `package.json` 中声明但代码未 import 的包
- **孤立的 catalog 条目** —— `pnpm-workspace.yaml` 中列了但无 `package.json` 引用的依赖

本项目已集成 Knip 6.29.0，配置文件位于仓库根目录 [`knip.config.ts`](https://github.com/walnut-admin/walnut-admin/blob/main/knip.config.ts)。

---

## 快速使用

```bash
# 全仓扫描（含 apps + packages）
pnpm walnut knip

# 只扫共享包（跨平台 + tooling）
pnpm walnut knip:packages

# 只扫应用
pnpm walnut knip:apps

# 自动清理 unused exports
pnpm walnut knip:fix
```

> 实际命令为 `cross-env NODE_OPTIONS=--max-old-space-size=8192 knip ...`（防 OOM + Windows 兼容）。`knip:packages` 使用 `--workspace ./packages/*/*`——此前写的 `packages/*` 匹配不到 `platform-any/*` 这类**两层**目录，knip 静默空操作，当时声称的"零发现"是假象；2026-08-08 修复为两层通配后才是真实结果。

---

## 预期结果

**2026-11-28 收口后，下面两条命令都是 `exit 0`**（此前长期是 exit 1、按「有意维持红」运行）：

| 命令 | 预期 | 说明 |
|------|------|------|
| `pnpm walnut knip:packages` | exit 0 | 共享包的 `project` 已显式声明，入口导出按公共 API 处理（不报）；入口背后的深层死导出仍会报 |
| `pnpm walnut knip`（全仓） | exit 0 | 只剩若干条 `Compiled extension excluded by project` 的 informational hint（.sass/.scss/.vue 不在分析面），不是 issues |

---

## 配置设计

knip 的核心原理是**从入口文件出发，沿 import 链追踪**。因此每个 workspace 包都需要在 `knip.config.ts` 中声明 entry files。

### 共享包（packages/\*）

```jsonc
"packages/platform-any/contract": {
  entry: ["src/index.ts"],  // barrel export → 追踪所有子模块
},
```

共享包的 import 链完全显式（`import { xxx } from '@walnut/contract'`），knip 可 100% 精确追踪。

### 共享包进入分析面：`project`（2026-11-02 起）；`includeEntryExports` 已于 2026-11-28 移除

只写 `entry` 时，knip **只分析 entry 领进来的那批文件** —— 非 entry 的深层文件不在它的视野里。
给每个共享包补 `project` 才能让深层文件进入分析：

```jsonc
"packages/platform-any/contract": {
  entry: ["src/index.ts"],       // 从 package.json 的 exports 也能推出来；显式写是为了可读
  project: ["src/**/*.ts"],      // 谁算「程序的一部分」：不写就只算 entry 领进来的文件
},
```

`includeEntryExports: true` 曾在 2026-11-02 一并开启，用来让 barrel 里的死导出可见；2026-11-28
收口时**移除**：包的 `entry` / `exports` 就是公共 API，要求仓内必须有人 import 每个入口导出，
只会把模板留用的公共函数（`downloadByOnlineUrl` / `Cookie` …）判成死代码。**入口背后的深层文件
仍会被查**（它们不是 entry），所以这项收窄不等于放弃检查。

**下面是 2026-11-02 的实测快照（历史，别当现状引用）**：

| | Unused exports | Unused exported types | 说明 |
|---|---|---|---|
| 改前（五个包都只有 `entry`） | 50 | 24 | 这 50 条**全部**落在 `apps/**`；`packages/**` 在改前只有 4 条（都在 `tooling/eslint-config`），其余整块不在分析面里 |
| 只加 `project` | 50 | 24 | 0 变化 —— `project` 不是主因 |
| 只删 `entry`（让 knip 从 `package.json` 的 `exports` 推） | 50 | 24 | 0 变化 —— 摘了也会从 `exports` 推回来，**「把 barrel 从 entry 摘出去」不是可执行的动作** |
| `project` + `includeEntryExports` | **139** | **49** | +89 / +25，新增**全部**落在 `packages/**` |

新增 89 条按文件的分布（`pnpm walnut knip` 全表逐条解析）：`packages/platform-web/client/` 的 barrel 53 条、
`packages/platform-any/utils-core/` 的 barrel 22 条、`packages/platform-web/http/` 的 barrel
7 条（**这三处都是 barrel 本身**，即各包的 `src/index.ts`；其中 client / http 两处已于
2026-11 批次 4 按决策 D8 删除），其余 7 条散在 `client` 的深层文件（`browser/cookie.ts`、
`browser/shared.ts`、`browser/crypto/shared.ts`、`file/download.ts`、`hooks/vueuse/useDraggableElement.ts`、
`store/createWalnutStore.ts`）。也就是说**这一轮的主要产出就是「barrel 里被 re-export、但全仓没人用」
的符号第一次现身**。

**barrel 自身的死导出仍是盲区（2026-11-28 后的形态）**：入口导出现在按公共 API 处理、不报，
所以「桶里 re-export 了一个全仓没人用的符号」不会亮红。2026-11-02 做过一组 A/B 探针，证明
「桶里的死导出能不能看见」当时**因包而异**（`platform-web/http` 报了、`contract` 没报）；那条
不稳定的可见性已随 `includeEntryExports` 的移除一起消失。结论只有一条可依赖的：**别把「barrel
已覆盖」当结论**。要守这一面只能另立一个「barrel 符号 0 引用」的专用脚本（读 `src/index.ts`
的具名导出 → 全仓 grep 消费方），调 knip 配置解决不了。

### 删桶之后的复测：噪音**确实随删桶塌掉**（批次 9 · C3）

批次 4 按 D7 / D8 处理掉三个 barrel（`packages/platform-web/client` 与 `packages/platform-web/http` 的
入口 `src/index.ts` **删除**；`packages/platform-any/utils-core` 的入口**收缩**成只剩「双端同源」的两个
模块）之后，重跑一次 `pnpm walnut knip`，结论只有一句话：**噪音塌了，而且塌掉的正是「一桶 N 行」那一类**。

**怎么判「塌的是哪一类」**（不要背数字，照判据看）：

| 看什么 | 判据 |
|--------|------|
| 读数有没有掉 | 拿上面那张 2026-11-02 的表当**历史快照**对比 `Unused exports` / `Unused exported types`。它记的是「进分析面」那一刻，桶一删就**必然**过期 —— 别当现状引用 |
| 掉的是哪一类 | 看还剩几行落在**包的 `src/index.ts`**（= 桶本身）。桶越少这类行越少；`apps/**` 与深层文件那部分基本不动（它们与桶无关） |
| 剩下的怎么看 | ① **分两段**：`packages/**` 是公共面问题，`apps/**` 是模板 / 动态入口问题。② `packages/**` 每一条**按「入口有没有消费」二分**：`grep -rn "from '@walnut/<pkg>'" apps packages` 为 0 ⇒ 它说的是「入口没人走」，**不是死代码**（消费方走深路径）；入口与深路径都 0 才是真死候选。③ `apps/**` 的入口类文件（`apps/{cli,worker}/src/main.ts`、`migrations/**`）必须进 `entry` —— knip 看不见命令行执行；模板装饰器 API 面仍在 `**/*.decorator.ts` ignore 里 |

为什么这一节只写判据、不写读数：**这一面的数字已经腐烂过一次** —— 上一节那张表是 2026-11-02 的快照，
桶一删就全过期。要现状就跑 `pnpm walnut knip`；要引用数字就得写明是哪天的 `pnpm walnut knip`（历史那份带日期的记录已随 2026-11-04 收尾归档至 git 历史）。

**`ignoreIssues` 只给「工具确实看不见」的面**：现在只剩 docs 的英文站脚手架一条（逐条理由写在
`knip.config.ts` 的 `ignoreIssues` 段）；server 的兼容再导出层已在 2026-11-28 的依赖清理批次里
**直接删源码**，没有变成新的豁免。不要把公共 barrel 或普通死导出塞进去 —— 那等于把这一面重新
变回盲区。真要接进门禁，先按上面三步分类，只给「真死」开红。

### 前端应用（apps/admin）

```jsonc
"apps/admin": {
  entry: [
    "src/main.ts",                    // 应用入口
    "src/router/index.ts",            // 路由（import 所有页面）
    "src/router/routes/**/*.ts",      // 路由配置
  ],
  // .tsx 不能漏：views/system/menu/useMenuFormSchema.tsx 等消费的导出否则会被误报。
  // build/ 也不能整块 ignore：predev/prebuild/pretypes:check 由 node build/generate/index.ts 执行。
  project: ["src/**/*.{ts,tsx,vue}", "build/**/*.ts"],
  vite: false,                        // 禁用 Vite 插件（见下文）
  ignore: [
    "src/components/**",              // unplugin-vue-components 自动注册（只有这一处必须整块忽略）
    "src/const/**",                   // 组件层公共词汇（ValueOfAppConst*），消费方在 components/模板
    "src/socket/**",                  // socket 事件 / 房间常量按事件名动态使用
  ],
},
```

### 后端应用（apps/server）

```jsonc
"apps/server": {
  entry: [
    "apps/api/src/main.ts",
    "apps/api/migrations/**/*.ts",   // TypeORM CLI 执行
    "apps/cli/src/**/*.ts",          // typeorm / openapi 导出脚本
    "apps/worker/src/main.ts",       // start:worker 直接 node 跑 dist 入口
    "libs/*/src/index.ts",           // 每个内部库的 barrel = 公共面
  ],
  project: ["apps/**/*.ts", "libs/**/*.ts"],
  ignore: [
    "**/*.decorator.ts",             // 装饰器公共面（装饰器语法里的消费 knip 看不到）
    "**/test/**",                    // 集成/API 测试 helper（globalSetup 按路径加载）
    "**/vitest.config.*.ts",         // e2e / integration 配置由脚本 --config 指定
  ],
},
```

### 全链路 E2E（apps/e2e，2026-11-25 进分析面）

```jsonc
"apps/e2e": {
  entry: ["scripts/**/*.ts", "tests/**/*.ts"],
  project: ["**/*.ts"],
},
```

`entry` 必须手写：这个包没有 bin / exports，入口不是「谁 import 它」——

- `scripts/**` 由包脚本（`node scripts/run.ts` 等）与 Playwright 的 webServer 命令执行；
- `tests/**` 由 Playwright 按 project 的 `testMatch` 加载；setup 项目的文件名是 `*.setup.ts` 而不是
  `*.spec.ts`，靠「测试文件」的约定推不出来（Playwright 插件只认 spec 与 `playwright.config.ts`，
  后者因此不写进 entry —— 写了会变成冗余条目）。

`project` 收全包 `.ts`：只写 `entry` 时非入口文件（`lib/**`、fixture、断言工具）死掉也不会被看见。
运行态目录（`.auth/` `.e2e/` `test-results/` `playwright-report/`）不用写 `ignore`：knip 的 glob
默认跳过点目录，另外两个里面没有 `.ts`（只有 JSON / trace 压缩包）。

判据：改包脚本或新增 spec 目录时，`pnpm walnut knip` 里 `apps/e2e` 的读数要能解释每一条 ——
「入口没人走」与「真死代码」的分法见上面的三步。

---

## 为什么 apps 还有少量文件 / 导出被忽略

knip 是**静态 import 追踪**工具。2026-11-28 收口时把之前「按框架猜」的一大批 ignore 收掉后，
现在只剩三类确实看不见的面：

| 机制 | 处理 |
|------|------|
| Vue 3 `unplugin-vue-components`（组件按标签名自动注册） | `src/components/**` 整块 ignore —— 组件目录的 `index.ts` 默认导出与 `.vue` 文件的消费者是模板标签，不在 import 图里 |
| NestJS 装饰器公共面 | `**/*.decorator.ts` ignore —— 消费发生在装饰器语法里，knip 看不到这层 API 语义 |
| 测试 helper / vitest 配置 | `**/test/**`、`**/vitest.config.*.ts` ignore —— globalSetup 与 `--config` 都是按路径加载，不是 import |

admin 的 `vite.config.ts` **不再是盲区**：`vite: false` 只阻止 knip 的 Vite 插件用 jiti 执行它，
knip 仍按普通 TS 文件分析它（`build/constant.ts` 的 import 因此可见）。

---

## 已知技术局限

### barrel 自身的死导出（**部分盲区**，未解决）

2026-11-28 起，包的 `entry` / `exports` 导出一律按「公共 API」处理、不报未使用 —— 这是刻意的：
本仓是模板项目，`downloadByOnlineUrl` / `Cookie` 这类公共函数仓内没人用不等于该删。代价是
**barrel 里 re-export 了一个全仓没人用的符号也不会亮红**。

2026-11-02 曾用 `includeEntryExports` 做过一组 A/B 探针（`platform-web/http` 的桶报出来了、
`contract` 的桶没报，同一份配置同一次运行），证明「桶里的死导出能不能看见」当时**因包而异**。
开关已于 2026-11-28 移除，那条不稳定的可见性不再存在；按部分盲区对待。
**别把「barrel 已覆盖」当结论**；要守这一面只能另立「barrel 符号 0 引用」专用脚本（读
`src/index.ts` 的具名导出 → 全仓 grep 消费方），调 knip 配置解决不了。要看现状就跑
`pnpm walnut knip`。

### `~build/*` 路径别名（已解决）

admin 中曾有文件 import `~build/package` 和 `~build/time`，旧版 knip 无法解析——`vite-tsconfig-paths` 在构建时动态解析这些别名，knip 无此上下文，输出 `Unresolved imports`。

**已解决（2026-08-08）**：`knip.config.ts` 中的 `paths` 块已删除，knip 不再做别名解析，对应问题不再出现。

### vite.config.ts 加载失败

admin 的 `vite.config.ts` 在 `useBuildEnv()` 函数内调用 `JSON.parse(env.VITE_PROXY)`（`useBuildEnv` 与 `loadEnv` 提供的 env 分别来自 `@walnut/vite-config` 与 vite），knip 的 jiti 加载器无法安全执行 → 加载抛异常。

**对策**：在 `apps/admin` workspace 配置中设置 `vite: false`，改为手动指定 entry files。

### Vite 插件 / 构建依赖

2026-11 起，Vite 插件依赖已从 app 的 `devDependencies` 迁到 `@walnut/vite-config` 的
`dependencies`，由该包源码显式 import，knip 能正常追踪。2026-11-28 收口时又清掉了整张历史
`ignoreDependencies` 表：清空后重跑，knip 仍能自行解析 Vite 插件表、nest CLI、ESLint 预设与
workspace bin。现在保留的只有**确实静态看不见**的几类（逐条理由在 `knip.config.ts`）：

- 动态拼接模块路径：`@iconify/json`（`import('@iconify/json/json/${name}.json')`）；
- 配置字符串：`@nestjs/schematics`（nest JSON 的 `collection`）、`@commitlint/config-conventional`（`extends` 数组）；
- 命令表 argv：`syncpack` / `taze`（`pnpm walnut <id>` 在运行时拼参数）；
- pnpm `packageExtensions` 的 peer：`rxjs`；
- 只在被 ignore 的 components 里被消费：`codemirror` / `@types/codemirror`；
- 运行时按名字 require：`hbs`（Express 视图引擎）。

**别把这张短名单再扩回「历史盲区大全」**：每条都必须能指出静态分析为什么看不见它。

2026-11-28 的 server 依赖与兼容层清理之后，这张表里又拿掉两条：`tencentcloud-sdk-nodejs`
（唯一 importer 是 `@deprecated` 的腾讯云短信留存文件，依赖与文件一起删）与 `raw-body`
（prod 依赖、全仓零静态 import，express 自带自己的那份）。同批删掉的还有 `ignoreIssues`
里的整个 server 段 —— 六处兼容再导出层改为直接删源码（判据见 `knip.config.ts` 头注释）。

---

## 如何解读输出

```text
Unused files            ← 值得排查：可能真的有死文件
Unused dependencies     ← 值得排查：可能真的没用到的包
Unused catalog entries  ← pnpm-workspace.yaml 里没有 package.json 引用的条目
Unlisted dependencies   ← import 了但没在 package.json 声明
Unused exports / types  ← 导出但无消费者（入口导出按公共 API 不报）
Configuration hints     ← 冗余配置建议；不是 issues，不影响退出码
```

`pnpm walnut knip` 在 2026-11-28 收口后 **exit 0**；剩下的 configuration hints 只有
「Compiled extension excluded by project」（.sass/.scss/.vue 不进分析面），属 informational。

---

## 日常维护

### 添加新 workspace 包

在 [`knip.config.ts`](https://github.com/walnut-admin/walnut-admin/blob/main/knip.config.ts) 的 `workspaces` 中添加：

```jsonc
"packages/platform-any/新包名": {
  entry: ["src/index.ts"],
  project: ["src/**/*.ts"],      // 不写 = 只分析 entry 领进来的文件
},
```

`project` 别省（理由见上文「共享包进入分析面」）。`includeEntryExports` 不要再开：包的入口 /
`exports` 就是公共 API，入口导出默认不报。

### 添加新 app

参照现有 `apps/admin` 或 `apps/server` 的配置，根据框架类型选择合适的 entry 和 ignore 策略。

### CI 集成建议

**当前仍不进硬门禁**，但性质变了：2026-11-28 起 `pnpm walnut knip` 与
`pnpm walnut knip:packages` 都是 exit 0，不再是「有意维持红」。没有立刻接进门禁的理由是
它仍带一层**有意保留的公共 API 判断**（模板留用的入口导出不报），以及若干 documented
`ignoreIssues`（server 源码冻结的兼容层、docs 英文站脚手架）—— 接门禁前要先把这些条目
当成「需要定期复审的白名单」，而不是当成永不失败的配置。

若将来接门禁，建议先只接 `knip:packages`（分析面最稳定），全仓命令继续做信息性检查。
若直接调 knip，`--workspace ./packages/*/*` 的两层通配写法仍然成立——`packages/*` 匹配不到
`platform-any/*` 这类两层目录，会静默空操作。

```yaml
# .github/workflows/ci.yml 示例片段
- name: Dead code check (packages)
  run: pnpm walnut knip:packages
```

---

## 相关资源

- [Knip 官方文档](https://knip.dev/)
- [Knip Configuration 参考](https://knip.dev/reference/configuration)
- [Knip Known Issues](https://knip.dev/reference/known-issues)
- [Knip GitHub 仓库](https://github.com/webpro-nl/knip)（11.6k+ stars，周下载 770 万）
