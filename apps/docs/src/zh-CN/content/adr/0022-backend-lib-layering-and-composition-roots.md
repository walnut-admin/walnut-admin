# ADR-0022: 后端领域 lib 分层与组合根形态

**Date:** 2026-10-31
**Status:** Accepted

## Context

`apps/server` 是 NestJS CLI 内部 monorepo（[ADR 0007](./0007-backend-libs-not-workspace.md)）。
起点只有 9 个基建 lib（`config` / `const` / `context` / `db` / `decorators` / `exceptions` /
`pipes` / `types` / `utils`），业务代码全部在 `apps/api/src/modules/**`，模块之间直接互相 import。

2026-10 的「libs 解耦批 0-10」按依赖方向把业务模块逐层搬进 `libs/`：批 0 先立注册一致性门禁与
libs 边界 lint，批 1-9 依次下沉基建、技术设施、共享能力、身份内核与各领域域，批 10 收官时
共 **34 个内部 lib**，app 剩组合根、wire DTO 与依赖 app 侧能力（guard/wire DTO）的 controller。批次 0-9 回答「搬哪些、搬到哪」；批 10 回答
三个形态问题：

1. 分层怎么变成**机械可检查**的规则，而不是只写在文档里的意图；
2. app 与「可部署入口」是什么关系（worker / cli 是不是新服务）；
3. lib 需要 app 侧能力时如何反转依赖，而不 import app。

## Decision 1: 34 个内部 lib 按六层组织，依赖只能单向

分层以**依赖方向**为判据（下层不知道上层），不以目录名或业务重要度为判据：

| 层 | lib | 说明 |
|----|-----|------|
| 基建（9） | `config` `const` `context` `db` `decorators` `exceptions` `pipes` `types` `utils` | 不依赖任何领域概念 |
| 技术 · tech-base（14） | `als` `blpath` `cookie` `crypto` `delay` `lock` `queue` `sse` `cache` `throttle` `mailer` `sms` `rsa` `ip` | 纯技术设施（缓存 / 队列 / 加密 / 邮件短信 / IP），不感知域与数据面 |
| 技术 · tech-assemble（5） | `repository` `list` `crud` `scope-resolver` `token` | 跨域装配内核（仓储基座、列表、CRUD、数据范围、token） |
| identity 内核（1） | `identity` | 用户身份栈（用户 / 设备 / MFA / OAuth / 偏好），被 system / auth / security 共同消费 |
| 领域域（3） | `system` `auth` `security` | 各自的 service / repository / entity 与 shared 能力 |
| 装配（1） | `guards` | guard / decorator / interceptor 装配层 —— import identity / system / auth / security 来装配安全链；`app-domain` 再依赖 `guards` |
| app-domain（1） | `app-domain` | app / shared 域的数据面（demo / error / key / logger / monitor / setting / area / ali / mask） |

> **2026-11-02 更新**：技术层在 `eslint.config.ts` 里拆成两条 `layer` —— `TECH_LIBS` 已拆成
> `TECH_BASE_LIBS` + `TECH_ASSEMBLE_LIBS`，允许边只有 assemble → base 单向（反向即违规）；
> **概念分层仍是六层**。同日 `WALNUT_ADMIN_IP_LOCATION_RESOLVER` token 从 `libs/crud` 迁回
> `libs/ip`（绑定跟随实现，`crud` 改从 `@walnut-server/ip` 消费，方向变正）。拆层动因：原 19 个
> 技术 lib 内部有反向边 —— `ip`（设施）引 `crud`（装配内核）的 IP 定位 token，`crud` 又向下引
> `list`；同一条 layer 的 banned 名单拦不住同层环。

六条机械守卫（守的是 **lib ↔ app 边界、lib 之间的层间方向与注册完备性**；层间方向自本轮起由 ESLint 分层规则机械守，不再只是约定与评审）：

- **ESLint `libs-boundary`**（`apps/server/eslint.config.ts`）：`libs/**` 禁止 `@/*`
  （那是 `apps/api/src`）、禁止相对路径逃逸进 `apps/`、禁止 import 前端包；需要 app 能力时
  用注入 token 反转依赖（见 Decision 3）。因此「lib 内零 `@/` 导入」是**编译前**就被拦下的，
  不靠 review。
- **ESLint 分层规则**（同一文件，按层逐条配置）：依赖方向固定为
  基建 → 技术（tech-base → tech-assemble）→ identity → system → auth → security → guards → app-domain（箭头指向被依赖方：**上层 import 下层**，反向即违规）。每层用 `files` glob 圈定 `libs/<name>/**/*.ts`，并以 `no-restricted-imports` patterns
  点名禁用上层的 `@walnut-server/<lib>`（根路径与 `/*` 子路径都禁）。唯一例外是 `exceptions`
  允许 import `blpath`（skip 名单所需，blpath 零出边），由一条独立的 `infra-exceptions` 配置
  精确放行；未登记进任何分层的 lib 走 fail-closed 配置，连 `@walnut-server/*` 一律禁止。
  `exceptions` 单独成一条 `infra-exceptions` 配置（libs 数组只含它自己），因此每个 lib 恰好
  登记进一个 layer。ambient 声明文件（`.d.ts`，无运行时 import）豁免分层规则。**已知盲区**：
  `.d.ts` 里的 type-only 跨层依赖不在机器守卫内（tsc 只校验可解析、不校验方向），靠评审把关；
  当前 `.d.ts` 的内部 import 全部向下合法。
- **ESLint libs 守卫**（同一文件的 `libs/**` 段）：相对路径跨 lib 逃逸 ——
  `import '../../system/src/...'` 与 `export ... from '../../identity/src'` —— 由本地规则
  `local/no-cross-lib-relative-import` 拦截（上面的分层规则只认识 `@walnut-server/*` 别名，
  相对路径是它的盲区）；动态 `import()` **零豁免**：source 可以是模板串 / 拼接 / 变量，静态
  分层门禁对它们全部失效，而 libs 下当前没有任何运行时动态 import，确需按需加载时在评审中显式
  豁免。类型位的 `import('x')`（`typeof import('x')`）是 TSImportType 节点、不产生运行时依赖边，
  不在该 selector 内。
- **`lib-registration.drift.spec.ts`**：以磁盘 `libs/<name>` 为基准，五处注册面全等 ——
  ① `tsconfig.json` paths、② 三份 `infra/nest/*.json` 的 filenames / projects、
  ③ 三份 `infra/swc/*.swcrc` paths、④ `apps/api/tsconfig.app.json` include、
  ⑤ `eslint.config.ts` 的分层名单（`INFRA_LIBS` / `TECH_BASE_LIBS` / `TECH_ASSEMBLE_LIBS` /
  `DOMAIN_LIBS` / `TOP_LIBS` / `EXCEPTION_LIBS`）与 `layer(name, libs, banned)` 的接线（lib 归属 + banned 集合对账，
  防「名单对了、接线错了」）；
  application（api / cli / worker）不参与对账。
- **`dto-entity.drift.spec.ts`** 与 **`eslint-data-scope-entities.drift.spec.ts`**：
  DTO ↔ Entity 字段形状、数据范围实体清单 ↔ ESLint 规则文本，各自单向对账。
- **`repo-global.drift.spec.ts`**（2026-11-03，D10）：`*.repo.module.ts` 的 `@Global` 判据 ——
  **消费方模块数 ≤ 1 时不许 @Global**（同时绑定 `WALNUT_ADMIN_*` 端口的模块例外，见 Decision 3），
  且非 @Global 的每个消费方都必须能经 `imports`（含 `exports: [SomeRepoModule]` 再导出）看见它。
  这条规矩与「Repository 三模式 → 两种形态」同时落地，口径写在 `apps/server/AGENTS.md`。

## Decision 5: 技术层允许「域形状」缓存，但必须登记并满足准入判据（D12）

`libs/cache` 是 tech-base，却住着 8 个**域形状**缓存服务（cap / mfa / opaque / sign / verifyCode /
device / permissions / appSettings）—— 技术层因此知道了上层领域的词汇。彻底下沉的代价大于收益：
消费方横跨 guards / identity / auth / security / app-domain / system / sms 七个库，把任一服务搬进
某个域，别的库就要反向依赖那个域。折中（D12）：**零代码移动**，只做「改名显式化 + 准入判据登记」。

### 准入判据（四条全满足，才允许域缓存留在 `libs/cache`）

1. **零数据面依赖**：服务体只经 `AppTechCacheService` 做「键 + 值 + TTL」；不注入仓储 /
   `DataSource`、不调外部 API、不 import 任何域的 entity / DTO（值类型用本文件内的最小 interface
   或 `libs/const` 的类型）。
2. **键前缀已在 `libs/const/app/cache` 登记**（`WalnutAdminConstAppCacheKeys`）：域知识以常量字面量
   存在，不以代码结构存在。
3. **无跨缓存编排**：一个方法只碰一个键空间；出现「读 A 写 B」的补偿 / 状态机 ⇒ 归域。
4. **不满足就必须离开** `libs/cache`（落到 `libs/<domain>/shared/<x>.cache.service.ts`；需要跨层时
   按 Decision 3 端口化）—— 「再登记一条例外」不是出口。

### 登记表（实测口径，消费库数按构造器注入统计）

| 文件 | 域 | 值形状 | 消费库数 | 命名 |
|------|----|--------|----------|------|
| `appSettings.cache.ts` | setting | 设置读值 + 进程内 memo | 9 | 本轮改名 |
| `device.cache.ts` | device | 设备快照（locked/banned/active/currentIp）+ cookie 续期闸 | 4 | 本轮改名 |
| `permissions.cache.ts` | 权限 | 权限串快照 | 4 | 本轮改名 |
| `mfa.cache.ts` | MFA | 已验证 / webauthn 挑战状态 | 3 | 本轮改名 |
| `sign.cache.ts` | sign | ticket / AES key / nonce | 2 | 本轮改名 |
| `verifyCode.cache.ts` | 验证码 | 验证码串 | 2 | 本轮改名 |
| `cap.cache.ts` | CAP | cap.js token 校验结果（键掺 token 指纹） | 1 | 本轮改名 |
| `opaque.cache.ts` | OPAQUE | 注册会话 | 1 | 本轮改名 |
| `cache.lock.ts` | 用户锁 | 布尔（是否锁定） | 2 | 未改名 |
| `cache.rsa.ts` | 设备公钥 | 公钥 PEM 串 | 3 | 未改名 |
| `cache.cron-lock.ts` | cron | 锁 token（单实例 try-lock，见 ADR 0025） | 2 | 未改名 |

两条读法（写清楚，以免下次又变成 folklore）：

- **命名**：`<domain>.cache.ts` = 已登记进上表的域缓存（D12 改名）；`cache.*.ts` = 技术信封
  （通用缓存 / Redis / 配置 / 单实例锁 / 原始值缓存）。同一目录两种前缀是**有意的**：`cache.lock` /
  `cache.rsa` 的值是原始类型（布尔 / 不透明 PEM 串），缓存层不解释它，本轮按 D12 清单不动；
  下次动这两个文件时一并改成 `<domain>.cache.ts`。
- **消费库数不是门槛**：`cap` / `opaque` 只有 1 个消费库，但满足判据 1-3 且键与 TTL 由域规则派生
  （cap.js 的 20 分钟窗口、OPAQUE 会话），因此留在原地并登记为**下一轮可评估下沉的候选**；
  多库消费只是「更该留在技术层」的排序依据。

## Alternatives considered

- **保持 `apps/api/src/modules/**` 单目录，不抽内部 lib** —— 跨模块 import 没有边界可查，
  「谁能依赖谁」只能靠约定；批 0-9 的拆分正是为了把这条约定变成 lint 与 drift spec。
- **把内部 lib 提升为 pnpm workspace 包** —— 已在 [ADR 0007](./0007-backend-libs-not-workspace.md)
  否决：CJS + `emitDecoratorMetadata` + SWC，不适合作 ESM workspace 包。
- **每个领域域拆成独立服务（微服务）** —— 部署单元会从「一个后端镜像」变成 N 个，事务、鉴权、
  配置共享都需重做；本仓的部署前提仍是单容器单体（见 Decision 2），微服务不在本轮范围。

## Decision 2: app 是组合根（部署单元），worker / cli 是可选组合入口

`apps/api` 仍是唯一默认部署单元：`AppModule` 按顺序装配 middleware / config / context / i18n /
db / cron / 各域 HTTP 组合根 / guard 与 interceptor。`apps/worker` 与 `apps/cli` 不是新服务，
而是**同一 workspace 内的其他组合入口**：

- `apps/worker`：可选第二进程，`NestFactory.createApplicationContext(WorkerModule)`（无 HTTP 监听）
  + `enableShutdownHooks`，承接 cron 与 Bull 消费；默认部署**不启动**它，api 单进程全功能不变。
- `apps/cli`：纯工具入口（`data-source.cli.ts` 供 migration CLI，`export-openapi.ts` 供离线导出
  OpenAPI），零运行时影响。

前提是**单容器单体**：不做「每个 app 一个容器」的编排。worker 与 api 共用同一镜像、同一份
`env-local`、同一套业务模块；需要独立伸缩时再讨论拆进程/拆服务，不在本决策内预支。

两条实现约束：

- worker / cli 作为 application 项目注册在三份 `infra/nest/{dev,prod,stage}.json`；由于当前
  Nest CLI 的 SWC builder 把 `filenames` 当**全局**配置（项目级 `builder.options` 不生效），
  `apps/cli/src` / `apps/worker/src` 进入全局 filenames。api 构建只用 `exclude` 挡掉 cli
  （纯工具、不进镜像）；worker 入口随 api 构建一起产出 `dist/apps/worker`，这样默认镜像里
  就带着「可选第二进程」的入口，Dockerfile 的 CMD 无需变化。
- worker 通过相对路径 `../../api/src/app/app.module` 复用 `AppModule`（根 tsconfig 的
  `rootDir` 覆盖整个 `apps/server/`）；不为 worker 新增 `@/*` 之外的第二套别名。

## Decision 3: 跨层依赖用注入 token 反转，绑定跟随实现所在层

方向固定为「实现方提供实现，需求方声明端口」。lib 内只 import 自己声明的 token 类型；**绑定位置
跟随依赖方向**：被绑定的实现在哪个层，绑定就放在那个层的 `@Global` 模块里；仅当实现依赖 app 专属
能力（socket、组合根装配）时，绑定才落在 app。本轮解耦引入的 20 个 `WALNUT_ADMIN_*` 注入 token
（此前已存在的 OTP strategy 等端口不在此列）**当前 3 个绑定在 app、17 个绑定在各 lib**：

- identity：`WALNUT_ADMIN_IDENTITY_USER_NOTIFIER` · `WALNUT_ADMIN_IDENTITY_DEVICE_SERVICE` ·
  `WALNUT_ADMIN_IDENTITY_OTP_SERVICE` · `WALNUT_ADMIN_IDENTITY_MFA_POST_VERIFICATION` ·
  `WALNUT_ADMIN_IDENTITY_SIGNOUT_SERVICE` · `WALNUT_ADMIN_IDENTITY_MONITOR_REPOSITORY` ·
  `WALNUT_ADMIN_IDENTITY_DATA_SCOPE_INVALIDATOR`
- auth / security：`WALNUT_ADMIN_AUTH_RISK_SERVICE` · `WALNUT_ADMIN_AUTH_MONITOR_SERVICE`
- system：`WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR` ·
  `WALNUT_ADMIN_SYSTEM_MONITOR_ACTIVE_USER_READER`
- 共享能力：`WALNUT_ADMIN_BLACKLIST_REPOSITORY` · `WALNUT_ADMIN_DATA_SCOPE_POLICY` ·
  `WALNUT_ADMIN_ERROR_REPORTER` · `WALNUT_ADMIN_IP_LOCATION_RESOLVER` · `WALNUT_ADMIN_KEY_STORE` ·
  `WALNUT_ADMIN_LOCK` · `WALNUT_ADMIN_OPERATE_LOG_WRITER` · `WALNUT_ADMIN_SOFT_DELETE_STRATEGY` ·
  `WALNUT_ADMIN_TOKEN_TTL`
- 分布式锁（D11 / 2026-11-03）：`WALNUT_ADMIN_LOCK` 的端口与 token 落在 `libs/lock`（tech-base），
  绑定在同一 lib 的 `AppTechLockModule`（@Global）—— `{ provide: WALNUT_ADMIN_LOCK, useExisting: MurLockAdapter }`。
  消费方 10 处（guards 4 / security 5 / app-domain 1）只认 `WalnutLockService` 接口，
  `from 'murlock'` 全仓只剩 `libs/lock` 内部，由 `murlock-isolation.drift.spec.ts` 机械守。
  **cron 单实例锁不并入本端口**：`AppTechCacheCronLockService` 是 Redis `SET NX EX` 的非阻塞
  try-lock（拿不到就跳过本次 tick、Redis 故障 fail-open，见 ADR 0025），与「阻塞等待直到拿到锁」
  是两种语义，合并会把 fail-open 的三条路径压成一条。

新增一个反转点时，token 与端口接口一起放进**需要它**的 lib（而不是 app）；绑定放在**实现所在层**
的 `@Global` 模块（多数时候就是同一 lib 或更低层 lib），app 侧只保留实现依赖 app 专属能力时的
`{ provide: TOKEN, useClass/useExisting/useFactory }`。

> **放法有两条，判据只有一条（2026-11-02 明确）**：token 与端口优先放进**需要它**的 lib；
> 需求方在上层、实现方在下层时（`crud` 在 tech-assemble、实现在 tech-base 的 `ip`），token 跟着
> **实现**落在下层，由需求方反向消费 —— 否则下层要反向 import 上层。可检验的内核是「token 不落
> app、绑定跟随实现」，不是「token 必须与需求方同 lib」。

## Decision 4: 两处顺序敏感的东西留在 app

下沉只搬「数据面」，以下两类**故意留在 `apps/api/src`**：

- **wire DTO**：`SysUserDTOSafe` 及其虚拟读模型（`WalnutAdminVirtualUserDTO` 等）参与 swagger
  schema 的注册顺序；schema 键序决定 `openapi.json` 的字节形态，而 `openapi:check` 的
  `git diff --exit-code` 是前端类型生成的真源。放进 lib 会同时造成 lib → app 反向依赖与 schema 顺序漂移。
- **HTTP controller 跟随依赖落位**：依赖全 lib 的（app-domain 9 个）随数据面进 lib；
  system 域的 logs **数据面进 lib、controller 留 app**；依赖 app guard / wire DTO / passport
  mixin 的（38 个：身份栈、auth、security 的 HTTP 面与 monitor/user）留 app 的各 HTTP 组合模块声明。

由此产生两处**交错点**（改动时必须保持）：

1. `AppMonitorUserHttpModule` 由 `SocketModule` 首个 import，`/app/monitor/user/*` 在 openapi 里
   排在 `/app/demo` 之前；
2. `SysDeleted` 的 controller 排在 `AppDemoModule` 之后（`AppAppModule` 紧随 lib 的
   `AppDemoModule` 引入），system 各子模块的 controller 声明顺序与解耦前一致。

### app 保留件清单

下列件**故意留在 `apps/api/src`**，逐件理由：

- **`app/`**（`app.module.ts` / `schedule.composition.ts` / `AppController` / `AppService`）：
  `AppModule` 的 imports 顺序就是 middleware → config → context → i18n → db → cron → 各域
  HTTP 组合根的装配顺序；`schedule.composition.ts` 用 `WORKER_STANDALONE` 做条件装配
  （cron 归属在 api / worker 间切换），属于组合根语义；`AppController` / `AppService` 是根路由，
  挂在组合根上而不是任何域里。
- **`modules/app/`**：`AppAppModule` 的组合顺序（含「两处交错点」）与 monitor/user 的 HTTP 组合
  —— 后者的 wire DTO 引 `SysUserDTOSafe`，必须与 wire DTO 同层，否则 lib → app 反向依赖。
- **各域 `modules/{auth,security,system}/` 的 HTTP 组合根**：controller + wire DTO +
  passport mixin guard 是 app 侧装配面；数据面已在 `libs/{auth,security,system,identity}`。
  `modules/shared/` 只剩 `SharedModule` 聚合根（lib barrel 的组装，无 controller/DTO）。
- **`modules/techniques/` 四件**：
  - `event`：`EventEmitterModule.forRoot()` 是进程级注册；订阅方是 app 级适配器 —— 它监听
    libs/crud 发出的删除事件并回写 `SysDeleted` 仓库，而 libs 只发事件常量，不反向依赖 app。
  - `health`：Terminus 探针（network / PostgreSQL / heap / disk）是运行时可观测面，
    不是业务域能力（compose healthcheck 已探 `/health/ready`（W2-B 起），探针经 raw route
    逃逸全局增强器）。
  - `logger`：`WalnutAdminLogger` 必须在 Nest DI 建立**之前**可用（引导期日志），
    Winston 传输 / 轮转是进程级配置。
  - `task`：`@Cron` 与 `onModuleInit` 横跨四域（app-domain / auth / identity / system），且 cron
    归属由 `AppScheduleModule` 在 api / worker 间切换 —— 搬进 lib 等于让 lib 对「由谁组合、
    以什么进程形态运行」表态。
- **wire DTO**：`SysUserDTOSafe` 及其虚拟读模型参与 swagger schema 的注册顺序；schema 键序
  决定 `openapi.json` 的字节形态，`openapi:check` 是裁判（见 Decision 4 正文）。
- **`common/repository/` 的 data-scope 注册表 + policy**：横跨 app-domain / auth / identity /
  system 四层实体（另含 `libs/repository` 的 `SysDeletedEntity`；无 security —— 其表均不入回收站与
  行级清单）的行级数据权限唯一真源；放进任何一个域都会造成域间反向依赖。
- **`common/recoverable/app-recoverables.ts`**：app / auth / shared 三域恢复器的登记汇总，
  只服务 `dto-entity.drift.spec` 的对账（运行期各域 module 调各自的登记 factory），属于跨域对账面。
- **`i18n/` · `socket/` · `middleware/` · `public/` · `views/`**：进程级入口能力 —— i18n 是
  全局语言解析、socket 是 WebSocket 网关装配、middleware 是 HTTP 管道工序，`public/` /
  `views/` 是静态资产与模板。
- **`common/swagger/`**：swagger 装配是 API 文档的进程级配置，随 wire DTO 一起留 app。

**进程级 provider 的归属判据**：`APP_FILTER` 跟随所属域的数据面 module 进 lib 是允许的 ——
错误过滤器（`libs/app-domain` 的 `AppErrorModule` 注册的 `APP_FILTER`）本身就是该域数据面的错误
上报出口；而 11 个 `APP_GUARD`、2 个 `APP_INTERCEPTOR` 与 `EventEmitterModule.forRoot()` 属于
进程级编排（guard / interceptor 的顺序即安全语义，事件订阅方是 app 级适配器），必须留在 app 组合
根；throttler 的 options/storage 由 `libs/throttle` 的 `ThrottlerModule.forRootAsync` 提供，
而 `WalnutAdminGuardThrottler` 的 `APP_GUARD` 注册留在 app（`modules/techniques/tech.module.ts`）。

**与 [ADR 0013](./0013-barrel-exports-policy.md) 的关系**：ADR 0013 的「显式具名 re-export」约束
的是 workspace package 的公开入口（`packages/*/src/index.ts`）；lib barrel（`libs/<name>/src/index.ts`）
的 `export *` 是内部 Nest monorepo 的消费口径，不受该条约束。

## Consequences

- app 侧剩组合根、wire DTO 与依赖 app 能力的 controller；业务数据面在 34 个 lib 内。
  lib ↔ app 边界由 ESLint + 三个 drift spec 机械守；**lib 之间的层间方向由 ESLint 分层规则
  机械守（本轮落地）**。
- 基建层内部没有互相引用的 SCC：纯 `process.env` 判定下沉到 `libs/const/src/app/env.ts`
  （`libs/config/src/utils/env.ts` 只做兼容转发），`config` / `utils` 对 `const` 单向依赖，
  `config` 对 `utils` 的 `pkg` 依赖也不再回头（层间规则只拦跨层方向、同层环不在其内，只能靠这种「纯判定放最低叶子」
  的结构约束）。
- 默认部署形态不变：未设 `WORKER_STANDALONE` 时 api 行为与解耦前一致，`openapi.json` 零 diff
  是每次改动的裁判；worker 是**可选**入口，`WORKER_STANDALONE=true` 时 api 让出 cron，
  worker 的组合根承接（见 `apps/worker/README.md`）。
- 新增内部 lib 的动作固定为「建目录 + 五处注册（paths / nest / swc / tsconfig include /
  ESLint 分层名单）+ lint 通过」；漏任何一处 drift spec 会红（第 ⑤ 面即分层名单对账）。
- 新增领域的能力默认拆成「lib 数据面 + app HTTP 组合根」两层；只有确认不触碰 wire DTO /
  guard 装配时才考虑把 controller 也下沉。
- **锁只有一个端口**（D11）：`WALNUT_ADMIN_LOCK` + `WalnutLockService` 在 `libs/lock`，murlock 是
  适配器实现，10 处消费方只注入端口；`from 'murlock'` 出界即单测红（`murlock-isolation.drift.spec.ts`）。
  cron 的单实例锁仍是自研 `AppTechCacheCronLockService`（语义不同，见 Decision 3 末段）。
- **域缓存的例外是登记制**（D12）：`libs/cache` 里的域形状服务必须出现在 Decision 5 的登记表里并
  满足四条准入判据；新增一个域缓存若判据不满足，正确动作是把它放进消费方所在的域，而不是扩表。
- **Repository 只有两种形态**（D10）：`@Global` 不是目录约定，而是「消费方模块 ≥ 2」的机械判据，
  由 `repo-global.drift.spec.ts` 守；口径见 `apps/server/AGENTS.md`。

## Related

- [ADR 0007](./0007-backend-libs-not-workspace.md)：内部 lib 不提升为 workspace 包
- [ADR 0012](./0012-toolchain-divergence.md)：server 自有 tsconfig / SWC 工具链
- [ADR 0013](./0013-barrel-exports-policy.md)：barrel 策略（约束 workspace package 入口；lib barrel 的 `export *` 不受该条约束）
- [架构待办](../monorepo/architecture-todo.md) 的 A12：内部 lib 抽取计划（批 0-10 已执行完毕）
