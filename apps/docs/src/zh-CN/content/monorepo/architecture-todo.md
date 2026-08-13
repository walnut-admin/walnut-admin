# 架构待办事项

> 基于 ADR 实现差距 + 行业调研对比，梳理架构层面剩余工作。按优先级 P0-P3 排列。

---

## P0 — 阻塞项（必须尽快解决）

| # | 事项 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 1 | **CI/CD 流水线** | ADR 0009 | 中 | **✅ 已完成**。`.github/workflows/ci.yml` 就位：`turbo boundaries` → affected lint/types:check/test → syncpack → server 构建（admin 构建经 `DOTENVX_KEYS_FILE` secret 解密 env 后启用）。commit 级（commitlint）+ push 级（pre-push：boundaries/types:check/syncpack）+ CI 级门禁齐备 |
| 2 | **共享包测试** | ADR 0009 / 0015 | 中 | `@walnut/utils`（queue、regex、crypto）、`@walnut/contract`（快照测试）至今零测试。utils-core 的 vitest 配置已提交（`vitest.config.ts`），只差测试文件本体。是 CI 流水线的前置条件 |
| 3 | **前端构建修复** | ADR README 遗留 | 小 | **✅ 已解决 2026-08-08**。三个根因：(1) env 文件缺失——正确流程是 `pnpm setup-env`（dotenvx 从 `env-encrypted/` 解密，需根 `.env.keys`）；(2) root overrides 把 `lru-cache` 全局强制为 v11（ESM-only），破坏 workbox-build 的 CJS 依赖链（`_lruCache is not a constructor`）——已移除 override；(3) `optimizeDeps.include: Object.keys(dependencies)` 把 workspace 包列入预构建导致 `@walnut/types` 等解析失败——已过滤 `@walnut/*`。另修复 `~build/package` 失效 import 及 tsbuildinfo 增量缓存掩盖的 6 处既有类型错误 |

---

## P1 — 高收益（有明确的效率/质量提升）

| # | 事项 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 4 | **Turbo Remote Cache** | 行业调研 | — | **❌ 已决定不接入（2026-08-08）**。单人维护 + CI 规模小，单机缓存足够。`globalPassThroughEnv` 的 `TURBO_TOKEN`/`TURBO_TEAM` 透传保留，未来接入零配置 |
| 5 | **部署流水线** | ADR 0008 | 大 | **✅ 已完成（Docker 方案）**：`deploy.yml` 已重写为 Docker 三镜像（backend/nginx/frontend）→ TCR → 服务器 `docker compose pull && up -d`，前端部署含 nginx-brotli 基础镜像。非 SCP 老方案，文件内"需要重新设计"TODO 已随重写移除 |
| 6 | **commitlint** | 行业调研 | 小 | enforce conventional commit 格式。**[✅ 已完成 2026-08-08（commit `029eb2b`）](./eslint.md)** ——`@commitlint/cli` + config + `commit-msg` hook 已就位，Changesets + git-cliff 依赖的 commit message 规范已保障 |
| 7 | **Changeset Bot** | 行业调研 | 小 | GitHub App，PR 中自动提醒缺少 changeset。一次安装，零维护 |

---

## P2 — 锦上添花（改善体验）

| # | 事项 | 来源 | 工作量 | 说明 |
|---|------|------|--------|------|
| 8 | **Docker 多阶段构建** | 行业调研 | 中 | **✅ 已完成**：`apps/server/Dockerfile`、`apps/admin/Dockerfile`、`deploy/nginx/Dockerfile`、`deploy/docker-compose.yml` 均存在，作为 P1-5 部署方案的落地方案（Docker + TCR + compose） |
| 9 | **syncpack** | 行业调研 | 小 | 强制 workspace 中同类依赖版本一致。**[✅ 已完成 2026-07-30](./syncpack.md)** |
| 10 | **Codecov / 覆盖率报告** | 行业调研 | 小 | PR 上自动评论覆盖率变化。免费，依赖 P0-2 测试先落地 |
| 11 | **GitHub Environments** | 行业调研 | 中 | 多环境部署（staging / production），按环境隔离 Secrets。当前 deploy.yml 用 workflow_dispatch 的 inputs 模拟环境选择，未使用原生 `environment:` 机制 |

---

## P3 — 远期（当前不做）

| # | 事项 | 来源 | 原因 |
|---|------|------|------|
| 12 | **Zod 替换 class-validator** | ADR 0016 | 工程量巨大（100+ DTO 类，6 个子系统）。评估已完成，暂不迁移 |
| 13 | **E2E 测试（Playwright）** | 行业调研 | 优先覆盖单元+集成测试。E2E 在测试体系稳定后再加 |
| 14 | **Vitest 共享 preset** | 行业调研 | 理由已过时，重新评估 | 当时包数 4 个、复制配置即可。现 12 个包、4 份 vitest.config 复制（server/api、utils、client、release），且 P0-2 测试补齐后配置会更多。规模已跨过提取阈值，可再议 |
| 15 | **oxlint / biome** | 行业调研 | 都不支持 Vue SFC。等支持后再加为 ESLint 的快速第一道扫描 |

---

## ADR 0017 遗留（Package 重组收尾线）

ADR 0017 Phase 1（目录重组 + 既有包迁移）+ Phase 2.1/2.3（contract 共享常量）已完成。以下为剩余项：

| # | 事项 | 状态 | 说明 |
|---|------|------|------|
| A1 | **旧目录残留清理** | ✅ 已完成 | 旧平铺目录（`packages/{axios,client,contract,eslint-config,utils}`）零文件，9 个包全部在新分组（platform-any/platform-web/tooling）下（2026-08-08 清理并核实） |
| A2 | **walnut 标签补齐** | ✅ 已完成 | 9 个包全部带 `walnut` 字段（platform/type/runtime）（2026-08-08 完成并核实） |
| A3 | **turbo boundaries 升级** | ✅ 已完成 | 根 `turbo.json` boundaries 已含 platform-any/platform-node 维度（any/web/node deny 规则）（2026-08-08 完成并核实） |
| A4 | **`@walnut/client` vue-router 死依赖** | ✅ 已完成 | `vue-router` 依赖声明已移除（2026-08-08，见执行记录）；现 client 的 vue/pinia 也已移入 peerDependencies |
| A5 | **Phase 2.2 API 路由迁移** | 🔄 渐进式 | ✅ admin 侧 30 处静态硬编码 URL 全部迁移到 `@walnut/contract/routes`（2026-08-08）。剩余 11 处为带参动态模板字符串（device 子路由等）与 server 侧 44 个 controller 的同步，留待渐进 |
| A6 | **Phase 2.4 server 死依赖决策** | ✅ 已完成 | ✅ 2026-08-08 确认 server 0 处 import `@walnut/utils`，按 ADR 评估结论（libs/utils 迁移已跳过）移除依赖声明 |
| A7 | **Phase 3.1 `@walnut/ui`** | 🔄 POC 完成 | ✅ 2026-08-08 创建 `packages/platform-web/ui/`，迁入 Switch/DynamicTags/TimePicker 验证模式：naive-ui peerDependency、显式 import naive 组件、`WalnutAdminComponentResolver` 增扫 package 路径、`Form/src/types.ts` 类型改从 `@walnut/ui/*` 导入。lint/types:check/boundaries 全绿。剩余 22 组件（含依赖链复杂的 Button/Card/Form/Table）待批量迁移，需处理跨组件相对 import 与 app store 依赖注入 |
| A8 | **Phase 3.2 `@walnut/i18n`** | ❌ 待做 | locale bootstrap + 状态机 + naive locale 映射。需定义 `LocaleFetcher`/`LocaleCache` DI 接口 |
| A9 | **Phase 3.3 `@walnut/security`** | ❌ 待做 | URL 加密 guard + sign interceptor crypto + VerifyAuth 类型。需定义 `SignProvider`/`CryptoKeyProvider`/`VerifyAuthHandler` DI 接口 |
| A10 | **Phase 3.4 store 工厂迁移** | 🔄 半完成 | `createWalnutStore()` 已进 `@walnut/client`（commit `dec4619`），但 admin 24 个 store 文件 0 处使用，未逐个迁移 |
| A11 | **Phase 4 自动导入迁移** | ❌ 待做 | 迁入 package 的代码中隐式全局变量改为显式 import；更新 auto-import / component resolver 指向新包 |

---

## 架构优化池（2026-08-08 review 新增）

> 全仓 review 发现、但非阻塞的优化候选。按收益排序，随手可做。

| # | 事项 | 说明 | 工作量 |
|---|------|------|--------|
| R1 | **peers 版本错位治理** | `pnpm peers check` 现存 3 个 unmet：`@swc/cli@0.8.1` 超出 `@nestjs/cli` peer 范围（^0.1.62~^0.7.0）、`chokidar@4` 不满足 `@swc/cli`/`nunjucks` 要的 ^3.3/^5、`class-validator@0.15` 超出 `@nestjs/mapped-types` peer（^0.13~^0.14）。strict-peer-dependencies 未阻断 install（pnpm 仅警告），但存在运行时隐患，需逐个评估升级/降级 | 中 |
| R2 | **knip 豁免清单裁剪** | `ignoreDependencies` 已膨胀至 80+ 条集中豁免，掩盖真实死依赖、维护成本高。建议按包拆分豁免并周期性清理（08-08 批次已清过一轮，仍可继续） | 中 |
| R3 | **root eslint 换 base preset** | 根 `eslint.config.mjs` 用 vueConfig 但只 lint mjs/json/yaml/scripts，用 base preset 更贴切、更快 | 小 |
| R4 | **根 tsconfig.json 接入类型检查** | 根 tsconfig 覆盖 `scripts/` 但无任何脚本执行它（types:check 只跑 turbo 包任务）。建议加 `types:check:root: tsc -p tsconfig.json` 并入 pre-push/CI | 小 |
| R5 | **AGENTS.md 重写** | 根 `AGENTS.md` 自标过时（描述合并前单包结构），其声明的重写任务（旧文档问题 #11）一直未排期 | 中 |
| R6 | **only-allow 加入 devDeps** | preinstall 里 `npx only-allow pnpm` 每次安装走网络拉取；加入 devDeps 并用 `pnpm exec only-allow pnpm`（packageManager 字段 + corepack 已兜底） | 小 |
| R7 | **TS 7 / tsgo 迁移准备** | `tsconfig.base.json` 的 `ignoreDeprecations: "6.0"` 一刀切静音了通往原生编译器（tsgo）的迁移信号。建议列出实际触发的弃用项逐个决策，为 TS 7 铺路 | 中 |
| R8 | **`@walnut/types` exports 结构** | 该包只有 `./*` 子路径导出、无根 `"."` 与 `types` 字段，消费方必须写 `@walnut/types/xxx`；评估是否补根导出 | 小 |
| R9 | **turbo preview 任务** | ✅ 已修复（2026-08-08）：根 `preview: turbo preview` 脚本曾指向未定义任务（turbo 报 Could not find task），已在 `turbo.json` 补 `preview` 任务（persistent + ^build） | — |
| R10 | **CI affected 空集行为验证** | `turbo run test --affected` 在受影响集全为无 test 脚本的包（admin/docs/contract/types/http/ui）时是否报 "No tasks were executed" 失败——需实测确认 CI 矩阵的健壮性 | 小 |
| R11 | **文档漂移清扫** | `apps/server/CLAUDE.md`（pm2 脚本已删、`pnpm typecheck` → `types:check`、TS 5.9 → 6.0.3）、`apps/docs/CLAUDE.md`（`pnpm format` 不存在）等入口文档与现状的落差；本轮已修 server/docs 两处，其余（.claude/、.zcode/ 等）待查 | 小 |

---

## 执行记录

| 日期 | 完成项 |
|------|--------|
| 2026-08-08 | **文档配套 + 优化池**：① A4 表格勾选（执行记录早已完成，表格漏更）；② P1-4 Remote Cache 标记为已决定不接入；③ P3-14 Vitest preset 理由更新（4 包 → 12 包）；④ 新增"架构优化池"R1-R11（peers 错位、knip 裁剪、root eslint base、types:check:root、tsgo 准备等）；⑤ 修复 turbo `preview` 任务缺失（root 脚本指向未定义任务）；⑥ release.md/index.md 的 fixed 组更新为 9+3；eslint.md 同步 pre-push/boundaries 与 lint-staged；turbo.md 补 preview 任务与 Remote Cache 决策；env-management.md 补 CI secret 用法；server/docs 的 CLAUDE.md 过时点修复 |
| 2026-08-08 | **架构 review 第三批**：① `@walnut/client` 的 `vue`/`pinia` 从 dependencies 移入 peerDependencies（与 `@walnut/ui` 对齐，防双实例）+ devDependencies 补供本包解析；② DOM lib 下沉：`tsconfig.base.json` 仅 `lib: ["ESNext"]`、移除 `typeRoots`，DOM/DOM.Iterable 下沉到 admin/docs/platform-web/*，platform-any 不再可见 DOM 全局；③ server `strict: true`（保留 strictPropertyInitialization: false）——tsc 零错误；④ 清理 6 处残留空导入 `import { } from '@walnut/contract'`（contract 无 declare global，无副作用职责）；⑤ changesets fixed 组补齐 `@walnut/release`/`@walnut/commitlint-config`；⑥ `build:stage` 升级为独立 turbo 任务，废除 `turbo build -- -- --mode stage` 三重 `--` 透传（透传参数会泄漏给全图任务）；⑦ lint-staged 删除无效的 `*.md` 条目（eslint preset 关闭 markdown 后该条目静默无效） |
| 2026-08-08 | **架构 review 第二批**：① turbo `dev`/`test` 任务接入 `dependsOn: ["^build"]`——修复 fresh clone 下 `dev:server` 因 contract/utils CJS dist 缺失（gitignore）而 MODULE_NOT_FOUND 的问题（ADR 0002 的 require 链路）；② `turbo boundaries` 接入 pre-push 与 CI 门禁（此前无任何 gate，root 新增 `boundaries` 脚本）；③ CI workflow 落地（P0-1 ✅：boundaries → affected lint/types:check/test → syncpack → 构建，admin 构建按 secret 存在与否自动启用）；④ 根 `clean:all` glob 修复（`packages/*/node_modules` 匹配不到两层嵌套目录，补 `packages/*/*/node_modules`）；⑤ `@walnut/eslint-config` 补 lint/lint:fix/types:check 脚本（此前该包代码从未被 lint）；⑥ `apps/admin|server|docs` 补 `private: true` 防误发布；⑦ 边界验证实测：临时给 contract 加 `app` 标签 → `turbo boundaries` 正确报出 3 处 shared→app 违规，回滚后零违规 |
| 2026-08-08 | **架构 review 修复批**：① 修复 production/stage 缺失 `USER_ID_ENCRYPTION_KEY`/`USER_ID_HASH_SALT`（validation fail-fast → 生产启动失败 bug，密钥与 development 对齐并重新加密）；② 根 `pnpm test` 可用（修复 server vitest 配置路径错误——配置在 `apps/api/` 子目录而脚本在包根跑、修复 smoke test 的 I18nService 依赖、utils/client `--passWithNoTests`、client 补 jsdom）；③ knip 假门禁修复：`knip:packages/apps` 的 `packages/*` glob 匹配不到两层目录改为 `./packages/*/*`（此前静默空操作），清理 `~build/*` 死 paths 与 8 条死 ignoreDependencies，全仓/包级 knip 加 8GB NODE_OPTIONS 防 OOM，移除真死依赖（client nanoid、admin lru-cache、docs dayjs、server pm2 脚本）；④ server jest/ts-jest/ts-loader/ts-node/tsconfig-paths/@types/jest 残留清理（vitest 时代死配置，spec 改显式 vitest import，tsconfig types 删 jest）；⑤ git-cliff 残留清理（release.test.ts 标题、knip ignore、文档引用）；⑥ 根 scripts `NODE_OPTIONS=` 前缀统一改 cross-env（Windows cmd 兼容），admin lint 同修 |
| 2026-08-08 | **PWA 移除**：删除 vite-plugin-pwa + workbox-window + @vite-pwa/assets-generator 及全部相关代码（插件、注册、ReloadPrompt、store、图标、env schema）。原因：workbox-build 传递链问题多（lru-cache CJS 崩溃、高危漏洞、precaching 陈旧内容），后台场景价值有限。如未来需要 PWA 可考虑 Serwist 或自研轻量 SW |
| 2026-08-08 | **构建与 dev 验证**：P0-3 解决（env 解密流程 + lru-cache override + optimizeDeps 过滤）；修复 tsbuildinfo 掩盖的 6 处既有类型错误（Table/ApiSelect/CountryCallingSelect）；`pnpm build:admin` 成功；dev 前端（3100）+ dev 后端（3000，连 MongoDB/Redis）均启动验证通过，端口已清理 |
| 2026-08-08 | **ADR 0017 收尾批次**：A1 旧目录残留清理；A2 6 包 walnut 标签补齐；A3 turbo boundaries 升级为 platform 维度（any/web/node）+ 修复 10 处 `~build/package` 失效 import + 清理 utils-core 残留 types；A4 client 移除 vue-router 死依赖 + easy-fns-ts 依赖分类修正；A5 admin 30 处硬编码路由 → contract；A6 server 移除 @walnut/utils 死依赖；A7 @walnut/ui POC（3 组件）。lint 9/9 + types:check 9/9 + boundaries 零违规 |
| 2026-08-08 | 文档同步：commitlint (P1-6) 实际已完成；新增 ADR 0017 遗留收尾线 (A1-A11) |
| 2026-07-30 | syncpack (P2 #9) — 依赖版本一致性检测接入 |
| 2026-07-29 | P0 剩余 3 项未完成 |

---

## 相关文档

- [ADR 索引](../adr/)
- [ADR 0009 - CI Quality Gates](../adr/0009-ci-quality-gates.md)
- [ADR 0017 - Package 重组](../adr/0017-package-reorganization.md)
- [行业调研 - CI/CD](../industry-research/03-ci-cd-pipeline.md)
- [行业调研 - 测试](../industry-research/04-testing-strategy.md)
