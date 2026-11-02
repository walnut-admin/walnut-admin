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
pnpm knip

# 只扫共享包（跨平台 + tooling）
pnpm knip:packages

# 只扫应用
pnpm knip:apps

# 自动清理 unused exports
pnpm knip:fix
```

> 实际命令为 `cross-env NODE_OPTIONS=--max-old-space-size=8192 knip ...`（防 OOM + Windows 兼容）。`knip:packages` 使用 `--workspace ./packages/*/*`——此前写的 `packages/*` 匹配不到 `platform-any/*` 这类**两层**目录，knip 静默空操作，当时声称的"零发现"是假象；2026-08-08 修复为两层通配后才是真实结果。

---

## 预期结果

| 命令 | 预期 | 说明 |
|------|------|------|
| `pnpm knip:packages` | **exit 1，有发现**（2026-11-02 起） | 补上 `project` + `includeEntryExports` 之后，共享包**第一次真的进了分析面**，于是它的公共 API 面开始报出来（判据与数据见下一节）。它此前那句「零发现」是**假绿**：不是干净，是没被分析 |
| `pnpm knip`（全仓） | exit 1，有发现 | 大部分是框架隐式组装的已知误报，少量可能是真实死代码（exit 1 属预期门禁，见下文 CI 建议） |

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

### 共享包进入分析面：`project` + `includeEntryExports`（2026-11-02，批次 2 · R2）

只写 `entry` 时，knip **只分析 entry 领进来的那批文件** —— 非 entry 的深层文件、以及 barrel 里
「导出了但没人消费」的符号，都不在它的视野里。给每个共享包补两行才能补上：

```jsonc
"packages/platform-any/contract": {
  entry: ["src/index.ts"],
  // ① 谁算「程序的一部分」：不写就只算 entry 领进来的文件
  project: ["src/**/*.ts"],
  // ② 唯一能让非 entry 文件的死导出现身的开关（默认 false）
  includeEntryExports: true,
},
```

**实测（2026-11-02 口径，改前 / 改后各跑一次 `pnpm knip`）**：

| | Unused exports | Unused exported types | 说明 |
|---|---|---|---|
| 改前（五个包都只有 `entry`） | 50 | 24 | 50 条**全部**落在 `apps/**`，`packages/**` 一条都没有 |
| 只加 `project` | 50 | 24 | 0 变化 —— `project` 不是主因 |
| 只删 `entry`（让 knip 从 `package.json` 的 `exports` 推） | 50 | 24 | 0 变化 —— 摘了也会从 `exports` 推回来，**「把 barrel 从 entry 摘出去」不是可执行的动作** |
| `project` + `includeEntryExports` | **139** | **49** | +89 / +25，新增**全部**落在 `packages/**` |

新增 89 条按文件的分布（`pnpm knip` 全表逐条解析）：`packages/platform-web/client/src/index.ts`
53 条、`packages/platform-any/utils-core/src/index.ts` 22 条、`packages/platform-web/http/src/index.ts`
7 条（**这三处都是 barrel 本身**），其余 7 条散在 `client` 的深层文件（`browser/cookie.ts`、
`browser/shared.ts`、`browser/crypto/shared.ts`、`file/download.ts`、`hooks/vueuse/useDraggableElement.ts`、
`store/createWalnutStore.ts`）。也就是说**这一轮的主要产出就是「barrel 里被 re-export、但全仓没人用」
的符号第一次现身**。

**但 barrel 的可见性并不稳定 —— 这是已知盲区，别当结论用**：

| 探针（各追加一行，跑完 `git checkout --` 还原） | 结果 |
|---|---|
| `export const __PROBE = 1` 追加到 `packages/platform-web/http/src/index.ts` | **报出来了**（`…/src/index.ts:25:14`） |
| 同一行追加到 `packages/platform-any/contract/src/index.ts` | **没报**（同一份配置、同一次运行） |
| `export const __PROBE = 1` 追加到非 entry 的深层文件（`contract/src/role.ts`） | **报出来了** |

结论：**barrel 级死导出目前「因包而异」，不是稳定判据**；contract 那个例外原因未查清（它是唯一
用 `packages/platform-any/contract/scripts/build-barrel.ts` 生成 barrel 的包，怀疑与 entry 推导有关，未验证）。要真正守这一面，
只能另立一个专用脚本（读 `src/index.ts` 的具名导出 → 全仓 grep 消费方），调 knip 配置解决不了。

### 前端应用（apps/admin）

```jsonc
"apps/admin": {
  entry: [
    "src/main.ts",                    // 应用入口
    "src/router/index.ts",            // 路由（import 所有页面）
    "src/router/routes/**/*.ts",      // 路由配置
  ],
  project: ["src/**/*.{ts,vue}"],
  vite: false,                        // 禁用 Vite 插件（见下文）
  ignore: [
    "src/components/**",              // 组件自动注册（unplugin-vue-components）
    "src/composables/**",             // 组件自动注册
    "src/hooks/**",                   // 组件自动注册
    "src/api/**",                     // barrel + store 动态引用
    "src/store/**",                   // Pinia 动态注册
    "src/socket/**",                  // 动态 import
    "src/types/**",                   // ambient 引用
    "src/const/**",                   // 同上
    "src/enums/**",                   // 同上
    "build/**",                       // 构建脚本
  ],
},
```

### 后端应用（apps/server）

```jsonc
"apps/server": {
  entry: ["apps/api/src/main.ts"],
  project: ["apps/**/*.ts", "libs/**/*.ts"],
  ignore: [
    "**/*.module.ts",                 // @Module() 装饰器隐式组装
    "**/*.controller.ts",             // @Controller() 同上
    "**/*.service.ts",                // @Injectable() DI
    "**/*.dto.ts",                    // 装饰器引用
    "**/*.schema.ts",                 // Mongoose 动态加载
    "**/*.guard.ts",                  // DI 组装
    "**/*.interceptor.ts",            // 同上
    "**/*.pipe.ts",                   // 同上
    "**/*.filter.ts",                 // 同上
    "**/*.decorator.ts",              // 同上
    "**/*.strategy.ts",               // 同上
    "**/*.middleware.ts",             // 同上
    "libs/*/src/index.ts",            // tsconfig paths 引用
    "infra/**",                       // SWC 构建配置
    "**/*.e2e-spec.ts",              // E2E 测试
    "**/vitest.config.*.ts",         // 测试配置
  ],
},
```

---

## 为什么 apps 有大量文件被忽略

knip 是**静态 import 追踪**工具。以下框架机制对 knip 不可见，必须手动排除：

| 框架 | 机制 | knip 能追踪？ |
|------|------|--------------|
| Vue 3 | `unplugin-vue-components`（自动注册组件） | ❌ |
| Vue 3 | Pinia store 动态注册 | ❌ |
| NestJS | `@Module()` 装饰器隐式组装 | ❌ |
| NestJS | `@Controller()` / `@Injectable()` 依赖注入 | ❌ |
| NestJS | Mongoose schema 动态加载 | ❌ |
| Admin | vite.config.ts 依赖 `loadEnv` / 回调执行（`useBuildEnv()` 内 `JSON.parse(env.VITE_PROXY)`），knip 的 jiti 无法安全加载 | ❌ |

**对策**：这些文件类型在 `knip.config.ts` 中通过 `ignore` 排除在 unused files 检测之外。knip 仍会对它们做 export 级别的检测。

---

## 已知技术局限

### barrel 自身的死导出（**部分盲区**，未解决）

`includeEntryExports` 让一部分 barrel 的死导出现身（`platform-web/client` / `utils-core` /
`platform-web/http` 三处 barrel 一次报出 82 条），但**不是所有包都报** —— 同样的探针在
`packages/platform-any/contract/src/index.ts` 上不出现。判据不稳定 ⇒ 按部分盲区对待。
探针数据见上文「共享包进入分析面」一节；要稳定守住这一面得另写脚本，不能靠 knip 配置。

### `~build/*` 路径别名（已解决）

admin 中曾有文件 import `~build/package` 和 `~build/time`，旧版 knip 无法解析——`vite-tsconfig-paths` 在构建时动态解析这些别名，knip 无此上下文，输出 `Unresolved imports`。

**已解决（2026-08-08）**：`knip.config.ts` 中的 `paths` 块已删除，knip 不再做别名解析，对应问题不再出现。

### vite.config.ts 加载失败

admin 的 `vite.config.ts` 在 `useBuildEnv()` 函数内调用 `JSON.parse(env.VITE_PROXY)`（由 `loadEnv` 提供 env），knip 的 jiti 加载器无法安全执行 → 加载抛异常。

**对策**：在 `apps/admin` workspace 配置中设置 `vite: false`，改为手动指定 entry files。

### Vite 插件 devDependencies

30+ 个 Vite 插件（如 `@vitejs/plugin-vue`、`vite-plugin-checker`）在 `devDependencies` 中声明但不会在源码中 import——它们只在 `vite.config.ts` 中引用。knip 无法解析 `vite.config.ts`，所以报告为 "unused devDependencies"。

**对策**：已加入 `ignoreDependencies` 列表。

---

## 如何解读输出

```text
Unused files (7)        ← 值得排查：可能真的有死文件
Unused dependencies (4) ← 值得排查：可能真的有没用到的包
Unlisted binaries (1)   ← CLI 工具在 scripts 中引用但未列在 dependencies
Unresolved imports      ← 路径别名问题，已知局限（见上文）
Unused exports (40+)    ← 导出但无消费者，可按需清理
Unused catalog entries  ← pnpm-workspace.yaml 中的孤立条目
Configuration hints (69)← knip 建议清理的冗余配置项（可忽略）
```

以上为全仓实测数字（2026-08-08），`pnpm knip` 当前退出码为 1——作为门禁属预期行为（见下文 CI 建议）。

---

## 日常维护

### 添加新 workspace 包

在 [`knip.config.ts`](https://github.com/walnut-admin/walnut-admin/blob/main/knip.config.ts) 的 `workspaces` 中添加：

```jsonc
"packages/platform-any/新包名": {
  entry: ["src/index.ts"],
  project: ["src/**/*.ts"],      // 不写 = 只分析 entry 领进来的文件
  includeEntryExports: true,     // 不写 = 非 entry 文件的死导出永远不报
},
```

两行都别省（理由与实测见上文「共享包进入分析面」一节）。

### 添加新 app

参照现有 `apps/admin` 或 `apps/server` 的配置，根据框架类型选择合适的 entry 和 ignore 策略。

### CI 集成建议

**暂时不要**把 `pnpm knip:packages` 直接当硬门禁。2026-11-02 之前它以 exit 0 通过，原因是
`packages/**` 整块不在分析面里（假绿）；补上 `project` + `includeEntryExports` 之后它开始
报共享包的公共 API 面，而本仓对那批符号的既定判断仍是「模板留给使用者取用的能力，不等于死代码」
（见 `knip.config.ts` 顶部注释）。要真接进门禁，先按「有意的公共面 / 真死代码」分类，只让后者亮红。

若直接调 knip，务必用 `--workspace ./packages/*/*` 的两层通配写法——`packages/*` 匹配不到
`platform-any/*` 这类两层目录，会静默空操作。全仓 `pnpm knip` 由于存在已知误报，建议作为
信息性检查而非硬门禁（当前实测 exit 1，属预期）。

```yaml
# .github/workflows/ci.yml 示例片段
- name: Dead code check (packages)
  run: pnpm knip:packages
```

---

## 相关资源

- [Knip 官方文档](https://knip.dev/)
- [Knip Configuration 参考](https://knip.dev/reference/configuration)
- [Knip Known Issues](https://knip.dev/reference/known-issues)
- [Knip GitHub 仓库](https://github.com/webpro-nl/knip)（11.6k+ stars，周下载 770 万）
