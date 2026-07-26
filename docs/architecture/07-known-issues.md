# 07 · 当前问题清单

> 数据采集时间：2026-07-26 · 共 11 个底层架构问题，按严重级别排序。
> 每条含：问题描述、证据（文件路径+行号+grep 数字）、影响、严重级别、对应改造 Phase。

---

## 严重级别说明

- 🔴 **严重**：会静默炸掉或已成定时炸弹，建议优先修
- 🟡 **中等**：影响维护体验或存在隐患，但当前能跑
- 🟢 **轻微**：瑕疵或不一致，清理即可

---

## 问题 #1 🔴 `@walnut` 命名空间双重定义

**描述**：前端的 5 个 workspace 包（`@walnut/{shared,axios,core,ui,ai}`）和后端的 9 个 path 别名 lib（`@walnut/{config,const,context,db,decorators,exceptions,pipes,types,utils}`）共用 `@walnut` scope，靠"名字不重叠"侥幸不冲突。任何人加一个 `@walnut/utils` 前端包就会静默炸掉。

**证据**：
- 前端包名：`packages/*/package.json` 的 `name` 字段
- 后端别名：`apps/server/tsconfig.json` 第 21-79 行 `paths` 块（18 条映射）
- 后端 SWC 配置：`apps/server/infra/swc/{dev,prod,stage}.swcrc` 的 `jsc.paths`
- 前端零消费后端别名：`grep -r "@walnut/config" apps/admin/src` → 0 命中（已验证）
- 后端零消费前端包：`apps/server/package.json` 无 `"workspace:*"`

**影响**：未来命名碰撞时，pnpm 解析和 tsc paths 解析可能给出不同结果，开发态和构建态行为不一致，且无工具守护。

**严重级别**：🔴 严重

**对应 Phase**：[Phase 1](./08-refactor-plan.md#phase-1)（后端改名 `@walnut-server/*`）

**详细论证**：见 [03-package-boundaries.md](./03-package-boundaries.md) §2

---

## 问题 #2 🔴 前后端零契约共享，类型/常量重复维护

**描述**：前端和后端各自维护自己的类型定义和常量，已发生 6 处可证实的重复，部分已漂移。API 字段变更时前端不会编译报错。

**证据**（6 处重复，详见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 4 §2）：

1. **响应信封**：
   - 前端 `packages/axios/src/types.ts` → `BaseResponse<T> { code, msg, data, meta? }`
   - 后端 `apps/server/libs/types/src/walnut-admin/response.d.ts` → `IWalnutAdminResponseBase<T> { data, code?, msg?, requestId, meta?, _devMsg? }`
   - 同形状，后端更严格

2. **响应码**（三份，已漂移）：
   - 后端 `apps/server/libs/const/src/app/responseCode.ts` → `WalnutAdminConstAppResponseCode`（~70 codes，权威）
   - 前端 `packages/axios/src/constant.ts` → `BusinessCodeConst`（子集）
   - 前端 `packages/axios/src/constant.ts` → `notAllowedErrorCodeMap`（硬编码数字）
   - 命名已漂移：前端 `CAPJS_TOKEN_INTERACTION_REQUIRED` vs 后端 `UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED`

3. **菜单枚举**（字节级重复）：
   - 前端 `apps/admin/src/const/menu.ts` → `AppConstMenuType = { CATALOG, MENU, ELEMENT }`
   - 后端 `apps/server/apps/api/src/modules/system/menu/schema/menu.schema.ts` → `SysMenuTypeConst`（同值不同名）
   - `AppConstMenuTernal` / `SysMenuTernalConst` 同样重复
   - `AppConstCacheKeyStrategy` / `SysMenuCacheKeyStrategyConst` 同样重复

4. **角色枚举**：
   - 前端 `apps/admin/src/const/app.ts` → `AppConstRoles = { ROOT, ADMIN, DEVELOPER, VISITOR }`
   - 后端 `apps/server/libs/const/src/role/index.ts` → `WalnutAdminConstRole`（同值，键顺序不同）

5. **分页类型**：
   - 前端 `packages/axios/src/types.ts` → `BaseListParams<T>` / `BaseListResponse<T>`
   - 后端 `apps/server/apps/api/src/common/dto/list.dto.ts` → `CreateWalnutAdminRequestListDTO<T>` / `CreateWalnutAdminResponseListDTO<T>`（同 wire shape，不同实现）

6. **HTTP 头/语言**：
   - 前端 `AppConstRequestHeaders`（`x-language` 小写）vs 后端 `WalnutAdminConstAppHeaders`（`X-Language` 大写）—— 同 header 不同大小写约定
   - 前端 `AppConstLocale`（zh_CN/en_US）vs 后端 `WalnutAdminConstAppLanguage`（zh_CN/en_US）

**影响**：API 契约变更时前端无编译期保护；前后端枚举值不一致会导致运行时 bug；响应码命名漂移已发生。

**严重级别**：🔴 严重

**对应 Phase**：[Phase 4](./08-refactor-plan.md#phase-4)（引入 `@walnut/contract`）

---

## 问题 #3 🔴 CI/CD 对 monorepo 坏掉

**描述**：
- `.github/workflows/deploy.yml` 用 SCP + 远程 `pnpm install --prod`，对 monorepo 根 lockfile 完全行不通（远程 install 会拉全仓库 workspace 包，且 `--prod` 模式与 workspace 冲突）
- **没有** PR/push 的 lint/build/test CI
- `turbo.json` 没有 `test` task

**证据**：
- `.github/workflows/deploy.yml` 第 N行（含多处 `TODO: monorepo 适配` 注释，明确标注 SCP 方案坏掉）
- `.github/workflows/` 只有 `deploy.yml`（手动触发，仅部署 server）和 `release.yml`（tag 触发，仅创建 Release）
- 无 `ci.yml` / `lint.yml` / `build.yml`
- `turbo.json` tasks 块无 `test`（虽然 `apps/server/package.json` 有完整 vitest 配置）

**影响**：PR 不经过任何自动化检查就能合并；部署可能失败或部署错乱。

**严重级别**：🔴 严重

**对应 Phase**：[Phase 5](./08-refactor-plan.md#phase-5)

---

## 问题 #4 🟡 `packages/ui` 和 `packages/ai` 是空壳

**描述**：两个包只有一行 stub，零消费者，但 `apps/admin/package.json` 仍声明 `"workspace:*"` 依赖。

**证据**：
- `packages/ui/src/index.ts`（101 B）：`// @walnut/ui - Source files will be populated in Phase 5`
- `packages/ai/src/index.ts`（101 B）：`// @walnut/ai - Source files will be populated in Phase 6`
- `apps/admin/src` 下 `@walnut/ui` 和 `@walnut/ai` 的 import：**0 命中**（grep 验证）
- `apps/admin/package.json` 第 N行仍声明两者为 `"workspace:*"`
- 两个包的 `package.json` **没有 `exports` 字段**（与 shared/axios/core 不一致）

**影响**：误导维护者以为有这两个包；admin package.json 有无用依赖；增加 pnpm install 开销。

**严重级别**：🟡 中等

**对应 Phase**：[Phase 3](./08-refactor-plan.md#phase-3)（删除 ui/ai）

---

## 问题 #5 🟡 `tsconfig.base.node.json` 是孤儿

**描述**：定义了后端 CJS + 装饰器共享 base，但零消费者。

**证据**：
- `tsconfig.base.node.json` 存在（target ES2022, module commonjs, emitDecoratorMetadata, experimentalDecorators）
- grep 所有 tsconfig 的 `extends` 字段：`tsconfig.base.node` → **0 命中**
- `apps/server/tsconfig.json` 自包含（直接写 `module: commonjs` 等，不 extends 任何 base）

**影响**：死文件，误导维护者。

**严重级别**：🟡 中等

**对应 Phase**：[Phase 2](./08-refactor-plan.md#phase-2)

---

## 问题 #6 🟡 `tsconfig.base.json` 的 paths 因 baseUrl 覆盖而失效

**描述**：base 的 `paths` 映射 `@walnut/*` → `./packages/*/src`，但子配置覆盖 `baseUrl: "."` 后，paths 错解析到子配置目录下的 packages（不存在）。实际靠 pnpm symlink + package exports 兜底。

**证据**：
- `tsconfig.base.json` 第 11-17 行：`paths` 块（无 baseUrl）
- `apps/admin/tsconfig.json`：`"baseUrl": "."`（覆盖）
- `packages/*/tsconfig.json`：都设 `"baseUrl": "."`
- 实际 admin 工作：因为全走 subpath import（不经 paths），靠 node_modules symlink + exports 解析

**详细机制**：见 [05-tsconfig-strategy.md](./05-tsconfig-strategy.md) §3.2

**影响**：bare import `@walnut/shared` 会 TS 报错（虽然没人这么写）；配置语义与实际行为不符；脆弱。

**严重级别**：🟡 中等

**对应 Phase**：[Phase 2](./08-refactor-plan.md#phase-2)

---

## 问题 #7 🟡 跨包 `.d.ts` 相对路径 reach

**描述**：4 个 tsconfig 通过相对路径 `include` 跨包的 ambient `.d.ts`。

**证据**：

| 文件 | include 条目 |
|------|-------------|
| `apps/admin/tsconfig.json` | `"../../packages/shared/src/types/*.d.ts"` |
| `packages/axios/tsconfig.json` | `"../shared/src/types/*.d.ts"` |
| `packages/core/tsconfig.json` | `"../shared/src/types/*.d.ts"` |
| `packages/shared/tsconfig.json` | `"../shared/src/types/*.d.ts"`（自包含，无害） |

目标：`packages/shared/src/types/` 下 7 个 ambient `.d.ts`（`deep-ref`、`object-key`、`storage`、`universal`、`vite`、`vue-runtime`、`vue`）。

**影响**：脆弱的隐式依赖；packages/shared 改目录结构就断；不可扩展。

**严重级别**：🟡 中等

**对应 Phase**：[Phase 2](./08-refactor-plan.md#phase-2)

---

## 问题 #8 🟡 根 `dev` 脚本同时启动三个 app

**描述**：`pnpm dev` = `turbo dev`，会并行启动 admin（需 MongoDB+Redis 才能用）、server（需 MongoDB+Redis）、docs。开发时几乎没人想要。

**证据**：
- 根 `package.json`：`"dev": "turbo dev"`
- `turbo.json` `dev` task：`persistent: true`，无 filter
- 三个 app 都有 `dev` script，turbo 会全跑

**影响**：新手 `pnpm dev` 后被三个进程淹没；server 启动失败（无 DB）会干扰 admin 的开发。

**严重级别**：🟡 中等

**对应 Phase**：[Phase 5](./08-refactor-plan.md#phase-5)（改默认行为或加文档警告）

**临时绕过**：用 `pnpm dev:admin` / `pnpm dev:server` / `pnpm dev:docs`。

---

## 问题 #9 🟡 后端是「国中之国」，standalone 残留未清理

**描述**：`apps/server/` 和 `apps/docs/` 自带一堆合并时未清理的独立配置/文档。

**证据**（`apps/server/` 自带）：
- `apps/server/{CLAUDE.md, AGENTS.md, README.md, TODO.md, changelog-latest.md}` — 5 份自带文档
- `apps/server/eslint.config.mjs` + `eslint-local-rules.mjs` — 独立 ESLint
- `apps/server/.vscode/settings.json` — 独立 VSCode 设置
- `apps/server/docs/lib-extraction-recommendations.md` — 内部分析报告

**证据**（`apps/docs/` 自带）：
- `apps/docs/CLAUDE.md`
- `apps/docs/version.json` → `v1.10.0`，与 `package.json` 的 `1.0.0` **不一致**
- `apps/docs/scripts/fetch-version.js`
- `apps/docs/nginx/www.conf`
- `apps/docs/.vscode/settings.json`
- `apps/docs/.gitignore`（根已覆盖）

**影响**：认知负担（两套文档可能矛盾）；版本号不一致误导。

**严重级别**：🟡 中等

**对应 Phase**：不在本次 5 个 Phase 内（属于"文档清理"，归到未来 Phase 0 文档归档动作）

---

## 问题 #10 🟡 缺失 commitlint

**描述**：历史文档声称有 `commitlint.config.mjs`，实际不存在；仓库不校验 commit message 格式。

**证据**：
- `docs/monorepo.md` 第 9 行声称 `commitlint.config.mjs` 存在
- 实际：`find . -name "commitlint*"` → 0 结果
- `package.json` 无 `@commitlint/cli` 依赖
- 根 `package.json` 的 `simple-git-hooks` 只配了 `pre-commit`（lint-staged）和 `pre-push`（types:check），无 commit-msg hook

**影响**：commit message 格式无强制，历史 commit 已有不规范的情况。

**严重级别**：🟡 中等（可选改进）

**对应 Phase**：不在本次 5 个 Phase 内（可选）

---

## 问题 #11 🟢 根 `AGENTS.md` 整体过时

**描述**：根 `AGENTS.md` 描述的是合并前的 `walnut-admin-client` 单包，版本号、命令、后端引用全错。

**证据**：
- `AGENTS.md` 第 7 行：`Name: walnut-admin-client`（实际 monorepo 根名为 `walnut-admin`）
- 第 8 行：`Version: 1.17.0`（实际 admin 是 1.18.0，且根无 version）
- 技术栈版本全错：Vue 3.5.21（实际 3.5.34）、TS 5.9.2（实际 6.0.3）、Vite 7.1.5（实际 8.0.11）、VueUse 13.9.0（实际 14.3.0）、Axios 1.11.0（实际 1.16.0）、Vue Router 4.5.1（实际 5.0.6）、Vue I18n 11.1.12（实际 11.4.2）
- 命令：`pnpm dev` / `pnpm build`（实际根脚本是 `pnpm dev:admin` / `pnpm build:admin` 等）
- 后端：描述为外部仓库 `walnut-admin-server`（实际在 `apps/server/`）
- 项目结构：单 `src/` 树（实际是 `apps/` + `packages/` monorepo）
- 无任何 monorepo/pnpm workspace/turbo/packages 提及

**影响**：AI agent 读 AGENTS.md 会得到完全错误的项目认知；新贡献者被误导。

**严重级别**：🟢 轻微（但影响 AI agent 效果）

**对应 Phase**：不在本次 5 个 Phase 内（文档重写，归到未来 Phase 0）

**临时缓解**：`CLAUDE.md`（根）是当前最准确的文档，AI agent 优先读它。

---

## 问题 #12 🟢 `pnpm-workspace.yaml` 不在 turbo globalDependencies

**描述**：改 catalog 版本不会自动失效 turbo 缓存。

**证据**：
- `turbo.json`：`"globalDependencies": ["tsconfig.base.json", "tsconfig.json", "eslint.config.mjs"]`
- `pnpm-workspace.yaml` 不在其中

**影响**：依赖版本变了但 turbo 可能用旧缓存（理论上；实际 lockfile 变化会触发重装）。

**严重级别**：🟢 轻微

**对应 Phase**：[Phase 5](./08-refactor-plan.md#phase-5)（一行修复）

---

## 问题 #13 ✅ `apps/admin/deploy.config.cjs` 含明文密码（已核实：未泄露）

**描述**：部署配置文件含明文 SSH 密码，根 `.gitignore` 忽略 `deploy.config.*`。

**证据**：
- 根 `.gitignore`：`deploy.config.*`（忽略）
- `apps/admin/deploy.config.cjs` 存在于磁盘
- `git ls-files | grep deploy.config` → **exit 1（零命中）**——文件**未被 tracked**，无泄露

**结论**：误报。文件被 .gitignore 正确忽略，未入库。**无需处理**。（原文档措辞"可能被 tracked"是基于未核查的推测，已于 2026-07-26 核实修正。）

**严重级别**：✅ 不再是问题

**对应 Phase**：无（已核实安全）

---

## 汇总表

> 更新于 2026-07-26。✅ 表示已处理。

| # | 严重 | 问题 | Phase | 状态 |
|---|------|------|-------|------|
| 1 | 🔴 | `@walnut` 命名空间双重定义 | Phase 1 | 待办 |
| 2 | 🔴 | 前后端零契约共享 | Phase 4 | 待办 |
| 3 | 🔴 | CI/CD 坏掉 | Phase 5 | 部分（已加 test task，CI workflow 待加）|
| 4 | 🟡 | ui/ai 空壳 | Phase 3 | ✅ 已删除 |
| 5 | 🟡 | tsconfig.base.node 孤儿 | Phase 2 | ✅ 已删除 |
| 6 | 🟡 | baseUrl/paths 错配 | Phase 2 | 待办 |
| 7 | 🟡 | 跨包 .d.ts reach | Phase 2 | 待办 |
| 8 | 🟡 | 根 dev 脚本启动三 app | Phase 5 | 待办 |
| 9 | 🟡 | 后端/docs standalone 残留 | 未来 | 部分（docs .gitignore 已合并到根）|
| 10 | 🟡 | 无 commitlint | 未来 | 待办 |
| 11 | 🟢 | AGENTS.md 过时 | 未来 | 部分（已加 deprecation 头部）|
| 12 | 🟢 | catalog 不在 turbo globalDeps | Phase 5 | ✅ 已加 |
| 13 | ✅ | deploy.config 明文密码 | — | ✅ 已核实未泄露（误报）|

**已处理**：#4、#5、#12、#13（4 个）
**部分处理**：#3、#9、#11（3 个）
**待办**：#1、#2、#6、#7、#8、#10（6 个，其中 #1/#2 是大工程）

---

## 下一步

- 想动手改 → [08-refactor-plan.md](./08-refactor-plan.md)
