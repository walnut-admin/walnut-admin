# libs 解耦：终审残留事项与后续投入建议

> 2026-11-01 ｜ 对应「libs 解耦批 0-10 + V1-V5」完成后的三切面终审（libs 分层 / 组合根与 HTTP 面 /
> 文档与打包 CI）。本文件是**待办与决策留档**：已修复项不在此列（见各批提交与 ADR 0022）。
> 标注【需拍板】的条目需要方向确认后才能动手；其余条目按优先级排好了可直接执行。

## 总体结论（三切面终审汇总）

- **组合根「薄且守得住」**：apps/api 的 30 条运行时 `@/` 互引全部是组合/HTTP 面引用，无 lib → app；
  11 个 APP_GUARD 顺序实测一致；openapi.json 全程零 diff（md5 不变）。
- **依赖方向干净**：34 lib / 937 条 import 边，唯一跨层例外是文档化的 `exceptions → blpath`；
  madge 零循环；19 个注入端口定义/绑定/消费/implements 四方全对齐。
- **分层门禁已机械守**：ESLint 八 rank + 五处注册面 drift（含 ESLint 名单对账）+ 资产断言，
  负向探针全部验证过。

## P1（下轮优先）

### 1. 分层门禁的四个已知盲区【可执行】
- `packages/tooling/eslint-config/nest.ts` 的全局 ignores 仍豁免 `**/*.d.ts`（25 个 ambient
  文件不在分层覆盖内）——需明确 .d.ts 的类型依赖是否也守；
- `no-restricted-imports` 不覆盖**相对路径跨 lib** 与**动态 `import()`** 两条路径（实测均不报错）；
- drift ⑤ 面只对账「名单」，不对账 `layer()` 的 files/禁用集合**接线**——删一条禁用项是静默削弱；
- 基建层内存在 `utils ↔ config ↔ const` 同层互引 SCC（当前无文件级环，因子路径叶子导入）。
改进方向：用一份有序 `LAYERS` 数组派生 files/禁用集合（单一真源），补接线对账 spec、
相对/动态导入规则，并把 env 判定下沉独立叶子消除 SCC。

### 2. 迁移账本判据（本地已修，生产库待核）【需在生产环境执行】
`DataScopePhase1` 类名是 28 字符（`DataScopePhase1` + `1793336000000`），本地库账本行名曾少一个 0
（已 UPDATE 修正，`migration:show` 现为 6/6 applied）。**判据：生产/预发库 `migrations.name`
必须是 28 字符同款；若为 27 字符执行同一 UPDATE。不要改类名**——TypeORM 用类名末 13 位解析排序，
27 字符会让空库首跑顺序崩坏（已用集成测试实证）。

### 3. Windows 本地 staging 不可移植【需 WSL/Linux 环境】
`build/image/server/node_modules` 的 pnpm 符号链接指向本机绝对路径、`.bin` 是 Windows shim——
本机 staging 直接 `docker build` Linux 镜像会得到悬空依赖。可信路径：Linux CI 或 WSL 内重跑
`pnpm deploy`。`deploy/README.md` 的本地构建节缺 OS 提示，补一句即可。

## P2

### 4. 健康检查升级（部署可信度）【需拍板 readiness 形态】
compose healthcheck 探静态图片路由 = 仅 liveness（不触 PG/Redis）；且异常过滤器恒返回 HTTP 200
（错误在 body `code`），任何走 controller 的健康检查（含 `/app/health/*`，还需 ROOT/DEVELOPER
角色）都会失去探测意义。建议：新增不鉴权、绕过全局响应包裹的 readiness 端点（依赖挂时真 503），
healthcheck 改探它并对 body `code` 断言；同时给 Redis 补 healthcheck（当前 backend 只等
`service_started`）。

### 5. bootstrap 任务归属显式化（双启动残留风险）
`WORKER_STANDALONE` 只让位 `@Cron`，六个 `onModuleInit` 一次性任务不受控——api + worker 双启动时
`rotateAppKey`（非幂等）等仍各跑一次（撞 `uq_key` 被 catch 吞掉）。本轮已给 `openapi:export`
加 `WALNUT_ADMIN_BOOTSTRAP_TASKS=off` 隔离；根治方向是把 bootstrap 任务的角色归属（api 专属 /
worker 专属 / 双方幂等）逐个显式化。

### 6. openapi 顺序依赖的第三处未登记
`tech.module.ts` 的 import 顺序（health 在 task 前）+ `task.module.ts` 的 `AppKeyModule` 共同决定
`/app/health/*`、`/app/key/*` 先于 `/app/monitor/user`——重排会改 openapi 字节。ADR 0022 只登记了
monitor/user 与 deleted 两处。另外整个 `AppModule.imports` 顺序都是 openapi 字节形态真源，
目前只有 prepush 的 openapi diff 兜底。

### 7. openapi 门禁不在 CI【已记录豁免，建议复审】
`gate-wiring.test.ts:151` 把 `openapi:check` 豁免给本地 prepush/发版电池；CI 与 release workflow
都没有该段。tag 由本地创建时 openapi 漂移无 CI 拦截。若要收口：CI 加 PG/Redis service 后跑
`openapi:check`，或约定「动 DTO 的 PR 必须附 openapi.json/schema.d.ts 变更」。

### 8. 端口三方一致性无机械 spec【可执行】
19 个 token 当前定义/绑定/消费/implements 全对齐（人工对账表见 V5b 报告），但新增 token 漏绑定
只会到启动期才暴露。建议补一条 spec：grep 收集 token 定义 → 断言每个都有 `provide:` 绑定点。

### 9. actionlint 本机未装
prepush 的「workflow 校验」段在本机是 SKIP（✓ 但 ≠ 通过）；权威闸在 CI 的 workflow-lint.yml。
本机装 actionlint（或 WSL）后该段会真跑。另：`workflow-lint.yml` 已补 setup-node@24（V5）。

### 10. mailer 视图路径的字符串耦合【可执行】
`libs/mailer/src/mailer.config.service.ts` 用 `join(__dirname, '../../../apps/api/src/views/...')`
回溯 app 视图；`verify-build-assets` 只断言资产存在、不证明这条相对路径解析正确（ESLint 也看不见
路径字符串）。改进：把模板根做成注入配置，或给 verify-build-assets 加一条「从 dist/libs/mailer/src
按同款相对路径解析必须命中」的断言。

## P3（记录即可）

- **worker 复用整 AppModule**：无 HTTP 的 worker 实例化全部 38 个 controller 与 socket gateway；
  在意内存/启动面时拆 `AppCoreModule` / `AppHttpModule`（ADR 0022 已声明这是当前取舍）。
- **SocketModule 引 monitor-user-http 的路由顺序装配**：与交错点 A 同源，脆但被 openapi diff 兜底。
- **命名漂移清单**（不影响行为，找机会顺手改）：`libs/list/src/shared.dto.ts` 实为设备/经纬度 DTO；
  `libs/crud/src/operate-log/operate-log.decorator.ts` 实为拦截器；`SecurityRsa*` 前缀属技术层；
  `SysDeletedEntity` 真身在 libs/repository（system 侧无）；`SysRoleEntity` 真身在 identity
  （system 是 re-export）；`blpath` 命名不自解释。
- **24 个文件的中文注释含 U+FFFD 乱码**（如 `libs/blpath/src/blpath.service.ts:4`）——搬迁前已有，
  非本轮引入，清理属低优先卫生。
- **ADR 0022 待补两句**：进程级 provider（APP_FILTER / ThrottlerModule.forRootAsync）进 lib、
  guards 留 app 的判据未成文；ADR 0013 的「显式具名 re-export」只约束 workspace 包，lib barrel
  目前普遍 `export *`——二者关系一句话说清。
- **Dockerfile 加非 root `USER node`**（当前 root 运行）；无 `.dockerignore`（staging 已手工清理，
  本地构建依赖 Dockerfile rm 兜底）。
- **docker-bake.hcl**：nginx target 的 `dockerfile` 路径疑似 context-relative 笔误——
  按 bake 语义会解析为下面这个不存在的路径（主流程走 `docker build` 未触发；`:38` 注释的
  staging 路径过时）：

  ```text
  deploy/nginx/deploy/nginx/Dockerfile
  ```
- **lib-registration ①④ 不比值**：tsconfig alias 只比键集合、tsconfig.app 只查 include；
  worker/cli 的 tsconfig include 与各 `tsconfig.lib.json` outDir 不在守卫面（当前值均正确）。
- **ADR 0022:87** 「当前全部 19 个 token」口径：另有 `WALNUT_ADMIN_OTP_STRATEGY`、
  `WALNUT_ADMIN_PERMANENT_BLACKLIST_PATHS` 等 JWT/OAuth/strategy 组注入常量不在清单（清单本身
  19/19 全部真实存在）。

## 已验证的基线（本轮终点状态）

- `pnpm lint`：0 error / 0 warning（含 infra/scripts，历史 2 条 warning 已根因修复）
- `pnpm test`（根）：14/14 任务；server 33 文件 / 251 例
- `pnpm test:e2e` 1/1；`pnpm test:integration` 63 文件 / 560 例**连续两轮**全绿；
  `TEST_DATA=real` 5 例（dump 30 表 665,121 行）
- `pnpm build --force`：10/10 任务真跑，资产断言 4 项通过，dist 无 `*spec.js`
- `pnpm prepush`：23 段全绿（actionlint 段本机 SKIP，见 P3）
- `pnpm smoke:dist`：真实 Chrome 冒烟有结论（无后端错误屏 = 设计内）
- `pnpm lint:dist`：1473 文件零密钥命中
- `openapi.json` / `schema.d.ts`：全程零 diff（md5 不变）
- staging（build/image/*）：无 env-local / env-encrypted / .data / .tmp / logs / dist-stage
- `migration:show`：6/6 applied（账本行名已修）

## 生产/预发部署前清单（判据）

1. 核对 `migrations.name` 的 Phase1 行为 28 字符 `DataScopePhase11793336000000`（见 P1-2）。
2. 预建 `walnut_app` 角色（NOSUPERUSER NOBYPASSRLS）并设置强密码，更新 env-encrypted 的
   `DATABASE_PG_APP_PASS` → `pnpm setup-env`——本地 L5 防呆当前拦截 prod 启动即因此。
3. 镜像构建在 Linux 环境（staging 由 `pnpm deploy` 现做，勿复用 Windows 本地 staging）。
4. 启用 worker 时：api 与 worker **两个进程都要设** `WORKER_STANDALONE=true`（见
   apps/worker/README.md；漏 api 侧会 cron 双跑）。
