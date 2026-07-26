# 02 · 物理布局与成员职责

> 数据采集时间：2026-07-26 · 文件大小为 `wc -c` 实测字节数

本文件逐一详述 `apps/` 和 `packages/` 下每个成员的**真实状态、职责边界、消费情况**。重点是区分哪些是"真包"、哪些是"空壳"——这一点在历史文档（`docs/monorepo.md`、`CLAUDE.md`）中描述失真。

---

## 1. 布局规则

仓库遵循 monorepo 业界主流约定：

```
apps/       ← 可部署单元（每个有自己的运行时入口、可独立启动/构建/部署）
packages/   ← 共享库（被 apps 消费，本身不直接运行）
```

`pnpm-workspace.yaml` 声明：

```yaml
packages:
  - 'apps/*'        # 匹配 admin, server, docs
  - 'packages/*'    # 匹配 shared, axios, core, ui, ai
```

这意味着 `apps/` 和 `packages/` 下**任何子目录都会被 pnpm 当作 workspace 成员**——只要它有 `package.json`。新增空目录不会生效，但新增带 `package.json` 的目录会自动被纳入。这是后续 Phase 3 删除 `ui`/`ai` 时只需删目录 + 改 admin/package.json 的原因。

---

## 2. apps/ 成员详述

### 2.1 `apps/admin/` — `@walnut/admin`（v1.18.0，private）

**角色**：Vue 3 SPA 前端主应用。

**技术栈**：Vue 3 + Vite 8 + Naive UI + Pinia + Vue Router + Vue I18n + UnoCSS + ECharts + CodeMirror + TinyMCE + Sentry + WebAuthn（`@simplewebauthn/browser`）+ OPAQUE（`@serenity-kit/opaque`）。

**Workspace 依赖**（`apps/admin/package.json` 实测）：

```json
"@walnut/ai": "workspace:*",
"@walnut/axios": "workspace:*",
"@walnut/core": "workspace:*",
"@walnut/shared": "workspace:*",
"@walnut/ui": "workspace:*"
```

**实际消费情况**（grep `apps/admin/src` 下 `from ['"]@walnut/<pkg>` 实测）：

| 包 | 消费文件数 | 实际 import 形式 |
|----|-----------|------------------|
| `@walnut/shared` | 48 | 全部用 subpath：`@walnut/shared/shared`、`@walnut/shared/queue`、`@walnut/shared/crypto/symmetric/aes-gcm`、`@walnut/shared/persistent/storage/sync` 等 |
| `@walnut/core` | 46（49 处 import） | 全部用 subpath：`@walnut/core/hooks/core/useState`、`@walnut/core/hooks/vueuse/usePreferredReducedMotion` 等 |
| `@walnut/axios` | 17 | 全部用 subpath：`@walnut/axios/types`、`@walnut/axios/adapters/cancel`、`@walnut/axios/instance` |
| `@walnut/ui` | **0** | 零消费（包本身是空壳） |
| `@walnut/ai` | **0** | 零消费（包本身是空壳） |

> **关键观察**：admin **从不**用 bare import `@walnut/shared`，全部走 subpath。这是因为所有 packages 的 `index.ts` 都是 0 字节空文件（见 §3）。bare import 拿不到任何东西，subpath 直接到具体文件。这个模式工作正常，但很反直觉——新人会本能写 `import { foo } from '@walnut/shared'` 然后报错。

**关键文件**：
- `apps/admin/package.json` — 依赖声明、scripts（`dev`/`build`/`types:check`/`lint`）
- `apps/admin/tsconfig.json` — extends `../../tsconfig.base.json`，覆盖 `baseUrl: "."`，加 `@/*`→`src/*`、`~/*`→`types/*` 别名，**特殊**：include `../../packages/shared/src/types/*.d.ts`（跨包类型 reach，详见 [05-tsconfig-strategy.md](./05-tsconfig-strategy.md)）
- `apps/admin/vite.config.ts` — Vite 8 + rolldownOptions，只定义 `@` 和 `axios/lib` 别名，**不**定义 `@walnut/*`（靠 pnpm symlink + package exports 解析）
- `apps/admin/build/vite/` — Vite 插件与构建配置
- `apps/admin/env/` + `apps/admin/env-local/` — 环境变量模板（env-local 被 gitignore）

**端口**：默认 3100，`/api` 代理到 `http://127.0.0.1:3000/w/v1`（后端）。

---

### 2.2 `apps/server/` — `@walnut/server`（v1.18.0，private）

**角色**：NestJS + MongoDB + Redis 后端 API。

**技术栈**：NestJS 11 + Mongoose 9（replica set）+ Redis + Bull（队列）+ SWC（编译加速）+ Socket.io + 完整认证栈（JWT、OAuth、OPAQUE、WebAuthn、TOTP）。

**Workspace 依赖**：**零**。`apps/server/package.json` 没有任何 `"workspace:*"` 引用。后端不消费任何前端 `packages/*`。

**特殊：内部嵌套 NestJS-CLI monorepo**

`apps/server/` 是一个「国中之国」——它内部保留着合并前的完整 NestJS monorepo 结构：

```
apps/server/
├── apps/api/                    ← NestJS 主应用入口
│   ├── src/
│   │   ├── modules/             ← 业务模块（auth, system, app, security, techniques...）
│   │   ├── common/              ← 公共代码（dto, model, processor, guard...）
│   │   ├── decorators/          ← 装饰器（含 walnut 系列业务装饰器）
│   │   ├── guard/               ← 18 个 guard（IP, Security, JWT, MFA, Sign, Lock...）
│   │   ├── socket/              ← WebSocket
│   │   └── ...
│   ├── tsconfig.app.json        ← extends ../../tsconfig.json（server 自己的）
│   └── vitest.config.ts
├── libs/                        ← 9 个内部库（path 别名，非 workspace 包）
│   ├── config/     @walnut/config
│   ├── const/      @walnut/const          （25 个常量文件）
│   ├── context/    @walnut/context        （ALS 请求上下文）
│   ├── db/         @walnut/db             （Mongoose schema 基类等）
│   ├── decorators/ @walnut/decorators     （WalnutAdminDecoratorField* 系列）
│   ├── exceptions/ @walnut/exceptions
│   ├── pipes/      @walnut/pipes
│   ├── types/      @walnut/types          （15 个 .d.ts ambient 类型）
│   └── utils/      @walnut/utils
├── infra/
│   ├── nest/{dev,prod,stage}.json   ← NestJS-CLI monorepo 配置（"monorepo": true）
│   └── swc/{dev,prod,stage}.swcrc   ← SWC 编译配置（含 jsc.paths）
├── tsconfig.json                   ← 自包含 CJS tsconfig（不 extends 根 base）
├── docker/docker-compose.dev.yml
├── db/docker-compose.prod.yml
├── docs/lib-extraction-recommendations.md   ← lib 抽取分析报告
├── env/ + env-local/               ← 环境变量
├── scripts/release/                ← changelog/git 脚本
├── CLAUDE.md / AGENTS.md / README.md / TODO.md / changelog-latest.md   ← 自带文档
├── eslint.config.mjs + eslint-local-rules.mjs   ← 自带 ESLint + 自定义装饰器排序规则
└── .vscode/settings.json           ← 自带 VSCode 设置
```

**为什么后端这么"独立"**：合并时（见 `migration-guide/01-copy-server.md`）原样 `cp -r` 了整个 `walnut-admin-server` 仓库，只删了 `node_modules/dist/.git/.github/.claude/pnpm-lock.yaml/.npmrc/.gitignore`，保留了所有内部结构和自带配置。这是有意为之——后端的 CJS + 装饰器 + SWC + NestJS-CLI 构建链与前端 ESM + Vite 差异太大，强行统一会引入风险。

**`@walnut/*` 命名空间的双重定义问题**：后端这 9 个 `@walnut/{config,const,...}` 是 tsconfig `paths` 别名，与前端 5 个 `@walnut/{shared,axios,...}` workspace 包共用 scope。详见 [03-package-boundaries.md](./03-package-boundaries.md)。

**构建产物路径**：`dist/walnut/admin/com/app/main.js`（遗留 Java 风格包路径，`migration-guide/09-known-issues.md` Issue #6 记录）。

**关键 scripts**：
- `dev` = `cross-env NODE_ENV=development nest start api --watch -c infra/nest/dev.json`
- `build` = `cross-env NODE_ENV=production nest build -c infra/nest/prod.json`
- `build:libs` = `concurrently "nest build config" "nest build const" ...`（8 个 lib 并行构建，**注意 context 不在其中**）
- `types:check` = `tsc --noEmit --pretty`
- `test` = `vitest run`（但 `turbo.json` 没有 test task，详见 [04-toolchain.md](./04-toolchain.md)）

---

### 2.3 `apps/docs/` — `@walnut/docs`（v1.0.0，private）

**角色**：VitePress 文档站。

**技术栈**：VitePress 1.6.3 + mermaid + pagefind + `vitepress-plugin-tabs`。

**Workspace 依赖**：**零**。纯 VitePress，不依赖 admin 或 server。

**关键 scripts**：
- `dev`/`build`/`preview` = `vitepress` 命令
- `types:check` = `echo skipped`（**故意跳过类型检查**，VitePress 配置文件不做严格类型校验）
- `lint:fix` = eslint

**内容结构**：双语（`zh-CN/`、`en-US/`）。

**遗留物**（合并时未清理的 standalone 残留）：
- `apps/docs/CLAUDE.md` — 自带的 Claude 指令
- `apps/docs/version.json` — 记录 `v1.10.0`，与 `package.json` 的 `1.0.0` **不一致**
- `apps/docs/scripts/fetch-version.js`
- `apps/docs/nginx/www.conf` — Nginx 部署配置
- `apps/docs/.vscode/settings.json` — 自带 VSCode 设置
- `apps/docs/.gitignore` — 遗留（根 `.gitignore` 已覆盖）

**端口**：默认 8886。

---

## 3. packages/ 成员详述（含真实文件树）

### 通用模式：内部包（Internal Package）

所有 5 个 package 都遵循「内部包」模式：

- **不构建、不发布**：`build` script 是 `echo '<pkg>: pure source, no build needed'`
- **exports 直指源码**：`package.json` 的 `exports` 字段是 `{ ".": "./src/index.ts", "./*": "./src/*.ts" }`——直接指向 `.ts` 源文件，而非编译后的 `.js`/`.d.ts`
- **消费者直接吃源码**：Vite（admin）和 tsc 通过 pnpm workspace symlink + package `exports` 直接解析到 `.ts` 源，省去构建步骤，改动即时 HMR

这种模式的好处是**零构建开销 + 即时反馈**，代价是消费者必须能用 `moduleResolution: "bundler"` 解析 `.ts` 源（admin 和 docs 的 tsconfig 满足；后端是 `node10` 不满足，所以后端不消费这些包）。

> 关于这个模式的取舍和与 TS Project References 的对比，详见 [05-tsconfig-strategy.md](./05-tsconfig-strategy.md)。

---

### 3.1 `packages/shared/` — `@walnut/shared`【✅ 真实包】

**定位**：零依赖基础库（仓库最底层）。

**真实文件树**（30 个源文件，~53 KB）：

```
packages/shared/src/
├── index.ts                              ← 0 字节（空，但不影响功能）
├── shared.ts                       (4188 B)  ← 共享类型与工具（Recordable, ValueOf 等）
├── queue.ts                        (593 B)
├── regex.ts                        (681 B)   ← 手机号/邮箱正则
├── crypto/
│   ├── const.ts                    (2197 B)
│   ├── shared.ts                   (6354 B)
│   ├── transformer.ts              (2774 B)
│   ├── asymmetric/rsa-oaep.ts      (1002 B)
│   ├── symmetric/aes-gcm.ts        (4436 B)
│   ├── derive/api-sign-key.ts      (1566 B)
│   ├── kdf/hkdf-sha256.ts          (610 B)
│   └── mac/hmac-sha256.ts          (872 B)
├── file/
│   ├── base64.ts                   (1687 B)
│   └── download.ts                 (1505 B)
├── persistent/
│   ├── shared.ts                   (1056 B)
│   ├── enhance/{index,async,sync}.ts
│   ├── idb/index.ts                (804 B)
│   └── storage/{async,sync,localStorage}.ts
├── timer/useExpireTimer.ts         (1528 B)
├── types/                          ← ambient .d.ts（被其他包跨域 include，见 05）
│   ├── deep-ref.d.ts               (1981 B)
│   ├── object-key.d.ts             (693 B)
│   ├── storage.d.ts                (1128 B)
│   ├── universal.d.ts              (220 B)
│   ├── vite.d.ts                   (306 B)
│   ├── vue-runtime.d.ts            (132 B)
│   └── vue.d.ts                    (45 B)
└── window/base64.ts                (275 B)
```

**职责**：加解密（AES-GCM、RSA-OAEP、HKDF、HMAC、签名派生）、存储抽象（localStorage、IndexedDB、Cookie、迁移）、正则、队列、通用类型。

**package.json 关键字段**：

```json
{
  "name": "@walnut/shared",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  }
}
```

**注意**：`exports` 的 `./*` → `./src/*.ts` 映射是**单段**的（`@walnut/shared/crypto/symmetric/aes-gcm` 会映射到 `./src/crypto/symmetric/aes-gcm.ts`，靠 TS/Vite 的后续文件解析兜底）。这个映射对所有真实包一致。

**为何 index.ts 是空的**：历史遗留。最初设计是 barrel re-export，但实际消费都走 subpath，index.ts 从未填充。不影响功能，但反直觉。

---

### 3.2 `packages/axios/` — `@walnut/axios`【✅ 真实包】

**定位**：HTTP 客户端框架（业务无关的 axios 封装）。

**真实文件树**（11 个源文件，~21.8 KB）：

```
packages/axios/src/
├── index.ts                  ← 0 字节（空）
├── instance.ts         (2122 B)   ← AppAxios 实例
├── types.ts            (1785 B)   ← BaseResponse, BaseListParams, BaseListResponse
├── constant.ts         (751 B)    ← BusinessCodeConst, notAllowedErrorCodeMap  ⚠️ 与后端重复
├── utils.ts            (1377 B)
└── adapters/
    ├── index.ts        (945 B)
    ├── cache.ts        (2097 B)    ← 缓存适配器
    ├── cancel.ts       (2686 B)    ← 取消重复请求
    ├── retry.ts        (1330 B)    ← 重试
    ├── throttle.ts     (2584 B)    ← 节流
    ├── merge.ts        (5848 B)
    └── id.ts           (285 B)
```

**职责**：Axios 实例 + 7 个适配器（缓存、取消、重试、节流、合并、id）+ 类型 + 常量。

**注意**：
- `types.ts` 的 `BaseResponse<T>` / `BaseListParams<T>` / `BaseListResponse<T>` 是前后端**重复定义**的契约类型（后端在 `libs/types/walnut-admin/response.d.ts` 和 `apps/api/src/common/dto/list.dto.ts` 各有一份）。详见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 4。
- `constant.ts` 的 `BusinessCodeConst` 与后端 `libs/const/app/responseCode.ts` 的 `WalnutAdminConstAppResponseCode` 重复，且**已经命名漂移**（如前端 `CAPJS_TOKEN_INTERACTION_REQUIRED` vs 后端 `UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED`）。

**业务相关的拦截器**（token 刷新、加密等）**不在这里**，留在 `apps/admin/src/utils/axios/`——这是正确的边界划分。

---

### 3.3 `packages/core/` — `@walnut/core`【⚠️ 部分真实】

**定位**：通用 composables / hooks（业务无关）。

**真实文件树**（16 个 hook 文件，~14.7 KB，加空 index.ts）：

```
packages/core/src/
├── index.ts                  ← 0 字节（空，无 barrel re-export）
└── hooks/
    ├── component/
    │   └── useGlobalAsyncComponent.ts   (1633 B)
    ├── core/
    │   ├── useContext.ts                (451 B)
    │   ├── useLocalRefresh.ts           (334 B)
    │   ├── useProps.ts                  (546 B)
    │   └── useState.ts                  (576 B)
    ├── vueuse/                          ← VueUse 扩展
    │   ├── useBattery.ts                (137 B)
    │   ├── useBreakpoints.ts            (158 B)
    │   ├── useDocumentVisibility.ts     (310 B)
    │   ├── useDraggableElement.ts       (738 B)
    │   ├── useIntervalFnWithPercent.ts  (2529 B)
    │   ├── useNavigatorLanguage.ts      (167 B)
    │   ├── useNetwork.ts                (137 B)
    │   ├── usePreferredReducedMotion.ts (311 B)
    │   └── useResize.ts                 (224 B)
    └── web/
        ├── useBlob.ts                   (844 B)
        └── useLinkTag.ts                (5739 B)
```

**重要纠正历史文档的错误**：
- `CLAUDE.md`（根）第 65-71 行声称 `packages/core` 含「stores, router, hooks, socket」
- `migration-guide/08-phase2-packages.md` 声称要把 core 的「ALL — Pinia stores, Router, composables, socket」搬回 admin
- **实际**：core **只有 hooks**，没有任何 Pinia store、router、socket、composables。这些业务代码**从未存在于 core**，一直在 `apps/admin/src/` 下。

历史文档要么描述的是"目标态"（从未实现），要么是合并前某个中间态（已被回退）。无论哪种，当前现实是 core 只有 hooks。

**消费情况**：admin 通过 subpath 消费（46 文件，49 处 import），全部形如 `import { useSharedPreferredReducedMotion } from '@walnut/core/hooks/vueuse/usePreferredReducedMotion'`。

**结论**：core 是真实包，职责清晰（纯 hooks），保留。只是 index.ts 空、文档描述夸大。

---

### 3.4 `packages/ui/` — `@walnut/ui`【❌ 空壳 stub】

**真实文件树**：

```
packages/ui/src/
└── index.ts    (101 B)    ← "// @walnut/ui - Source files will be populated in Phase 5"
```

**完整源码**（就这一行）：

```ts
// @walnut/ui - Source files will be populated in Phase 5
export const WALNUT_UI_VERSION = '0.0.1'
```

**消费情况**：**零**。grep `apps/admin/src` 下 `@walnut/ui` 返回 0 命中。

**package.json 的 exports 字段**：**不存在**。与其他 4 个包不一致（其他都有 `exports`）。

**结论**：纯占位 stub，从未填充。历史文档（`docs/monorepo.md`、`CLAUDE.md`）描述它含「UI/、Advanced/、Business/、HOC/、Extra/ 组件」——这些组件**实际都在 `apps/admin/src/components/` 下**，从未被搬到 ui 包。Phase 2 抽取从未执行。

**处置**：删除（详见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 3）。

---

### 3.5 `packages/ai/` — `@walnut/ai`【❌ 空壳 stub】

**真实文件树**：

```
packages/ai/src/
└── index.ts    (101 B)    ← "// @walnut/ai - Source files will be populated in Phase 6"
```

**完整源码**：

```ts
// @walnut/ai - Source files will be populated in Phase 6
export const WALNUT_AI_VERSION = '0.0.1'
```

**消费情况**：**零**。

**package.json 的 exports 字段**：**不存在**。

**结论**：纯占位 stub。AI 聊天子系统的实际代码在 `apps/admin/src/views/demo/ai-chat/`（业务页面）等地，从未搬到 ai 包。

**处置**：删除（详见 Phase 3）。

---

## 4. packages/ 状态汇总表

| 包 | 状态 | 源文件数 | 源码体积 | admin 消费 | exports 字段 | 处置 |
|----|------|---------|---------|-----------|-------------|------|
| `@walnut/shared` | ✅ 真实 | 30 | ~53 KB | 48 文件 | ✅ 有 | 保留 |
| `@walnut/axios` | ✅ 真实 | 11 | ~21.8 KB | 17 文件 | ✅ 有 | 保留 |
| `@walnut/core` | ⚠️ 部分（仅 hooks） | 16 | ~14.7 KB | 46 文件 | ✅ 有 | 保留（填充 index 或文档化 subpath-only） |
| `@walnut/ui` | ❌ 空壳 | 1（stub） | 101 B | 0 文件 | ❌ 无 | **删除** |
| `@walnut/ai` | ❌ 空壳 | 1（stub） | 101 B | 0 文件 | ❌ 无 | **删除** |

---

## 5. 关键结论

1. **真实有用的包只有 3 个**：shared、axios、core。它们合计 57 个源文件、~89.5 KB，被 admin 实际消费。
2. **ui 和 ai 是死代码**：零消费者、零真实源码、零 exports。在 `apps/admin/package.json` 里的 `"workspace:*"` 声明是摆设。
3. **所有 package 的 index.ts 都是空的**（shared/axios/core 也是）。这是统一的 subpath-only 消费模式——靠 `exports` 的 `./*` → `./src/*.ts` 映射工作。bare import 拿不到东西。
4. **后端是独立的「国中之国」**：自带文档、ESLint、tsconfig、docker、db、scripts，与前端零代码耦合。这是有意保留的，但带来了命名空间冲突隐患。
5. **docs 有 standalone 残留**：自带 CLAUDE.md、version.json（版本不一致）、nginx、.vscode、.gitignore，合并时未彻底清理。

---

## 下一步

- 命名空间为什么是定时炸弹 → [03-package-boundaries.md](./03-package-boundaries.md)
- 工具链怎么搭的 → [04-toolchain.md](./04-toolchain.md)
- 想动手删 ui/ai → [08-refactor-plan.md](./08-refactor-plan.md) Phase 3
