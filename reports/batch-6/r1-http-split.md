# 批次 6 · R1：CAP × worker 隔离 可行性复核

> 执行：b6-r1-http-split（**全新调研 agent**，未参与批次 1–5）
> 基线：HEAD `744c56b5`，开工时工作树 clean（`git status --porcelain` 空）
> 性质：**只读复核**。本文件是唯一产物，**未改动任何源码**（临时探针目录建在 `%TEMP%` 并已删除）
> 环境限制：本机**没有 docker、5432/6379 无监听** → 双启动冒烟与 e2e 本轮**无法执行**，只能给可执行判据（§5）

---

## 0. 结论（TL;DR）

| # | 问题 | 结论 | 一句话证据 |
|---|------|------|-----------|
| 1 | 当前模块图 | 16 项 imports：**3 项纯 HTTP-only**（`AppMiddlewareModule` / `SecurityModule`(CAP) / `DiscoveryModule`）、**8 项两进程共用**（其中 2 项按 env 条件加载）、**5 项「业务 + HTTP 控制器」混装**，必须再拆；另有 `AppTechModule` 内部还夹着两片 HTTP-only（health / throttler） | `app.module.ts:31-78` + 各模块文件（§1 表） |
| 2 | CAP 依赖面 | **两条链，别再只盯 DI 链**：① DI 链 `SecurityCapModule → SecurityCapService`（只有 `cap.controller` 消费，无 cron / bootstrap / task 消费者）；② **模块求值链** `@walnut-server/guards` barrel → cap.guard.ts → cap.service.ts → `new Cap()` —— 后者才是 worker 里真正发生的事，且**与 DI 无关** | `libs/guards/src/index.ts:31` → `cap.guard.ts:21` → `cap.service.ts:17`（§2） |
| 3 | Throttler / Socket | Throttler **纯 HTTP**（tracker 是 `req.realIp`，storage 是进程内内存）；Socket 的 **gateway 在 `createApplicationContext` 下根本不会被初始化**（Nest 只在 `NestApplication.init()` 里 load/register WebSocket 模块），**但 `SocketService` 不能一起搬走**（2 个 worker 侧消费者 + @Global 端口绑定） | `throttler.guard.ts:34-36` · `nest-application.js:104,106-112` · `nest-application-context.js` 里 middleware/gateway 引用数 = 0（§3） |
| 4 | 最小切分 | 草案见 §4。**但先看两条硬约束**：guard 不能拆散（顺序真源 = 模块扫描序 + 模块内数组序）；模块重排必然改 `openapi.json` 的 paths 顺序 | `scanner.js:262-291` · `routes-resolver.js:30-34`（§4.1 / §6） |
| 5 | 验证 | 7 道门禁（G1 / G2 / G2b / G3 / G4 / G5 / G6），其中 **G1/G2/G2b 零基础设施可跑**（纯 fs 闭包 spec + 模块元数据顺序 spec，同 `common/monorepo/*.drift.spec.ts` 既有形态）；G3/G4/G5 需要 PG+Redis | §5 |
| 6 | 风险 | 三个被点名的面在「路线 A」下**全部零影响**；真正的风险在「路线 B（重建 AppModule）」：guard 顺序、openapi 顺序、cli 导出 | §6 |

### 0.1 三条会改变下一步动作的硬结论

**H1（推翻任务书的一处假设）——「CAP + throttler + socket 三项先挪」在 guard 层做不到「只挪 CAP」。**
`APP_GUARD` 的执行顺序真源是「**模块被扫描的顺序** + 模块内 providers 声明顺序」：`Scanner.insertProvider` 在扫到该模块时把 enhancer 追加进 `applicationProvidersApplyMap`（`scanner.js:262-291`），而模块扫描是**前序 DFS**（根模块先于 imports，`scanner.js:44-95`）。所以：
- 只要 12 个 guard **整体**留在同一个模块的同一个数组里，顺序逐字不变；
- 若把 CAP 的两条注册单独挪进 `AppHttpModule`（一个 **import**，排在根模块之后），CAP 会掉到链**尾**（JWT 之后），**语义直接反转**；
- 若把 throttler 的注册搬进来、但 `AppHttpModule` 与 `AppTechModule` 的先后不同，顺序同样会变——所以 **throttler 那条 `APP_GUARD` 必须与其余 11 条在同一次改动里搬**。

**H2（最关键）—— 光靠模块图切分，worker 仍然会加载 cap.js，仍然会碰 `.data/tokensList.json`。**
我按 `tsconfig.json` 的 paths 做了静态 import 闭包（§2.3 有方法与数据）：**当前 worker 闭包 816 个 .ts 文件，`cap.service.ts` 可达**，最短链是
`worker/main.ts → worker.module.ts → app.module.ts → @walnut-server/guards → cap.guard.ts → cap.service.ts`。
即便把 `SecurityModule` 整个从 worker 图里摘掉（草案 B），闭包里**仍有 49 个文件** import 那个 barrel——因为 `AppKeyModule` / `AppSettingsModule` / `AppErrorModule` / `AppLoggerModule` 这些 **worker 必需的 libs 模块**各自带着 controller，controller 又从 barrel 取装饰器。
`new Cap()` 在**模块求值期**执行，我实测了它的副作用（§2.4）：创建 `.data/tokensList.json`（内容 `{}`）+ 注册 1 个 `SIGTERM` 处理器 + 1 个 `beforeExit` 处理器。
⇒ **真正的杠杆只有两个**：(a) 把 `cap.guard.ts` 拆成「装饰器文件（barrel 导出）」+「guard 类文件（子路径导出，只有 `AppHttpModule` 引）」；(b) 把 `AppCapJS` 改成惰性构造。二者都不属于「模块切分」，必须由 Lead 单独裁决（§4.5 / 拍板 D2）。

**H3 —— `openapi.json` 的 paths 顺序会被任何「16 项 imports 重排」改变，无法既做干净的二分又保字节零 diff。**
路由注册按 `container.getModules()` 的**插入顺序**遍历（`routes-resolver.js:30-34`），插入顺序 = `AppModule.imports` 的前序 DFS。当前 HTTP-only 与 core 模块是**交错**的（HTTP 在槽位 1、7b、8、10、16），任何「core 一整块 + http 一整块」的二分都会挪动 `/security/*` 与 `/app/monitor/user/*` 的先后。
⇒ 若 `openapi:check:export` 的「字节零 diff」是本仓硬约束（历史上是，见 `reports/batch-5/r1-libs.md` §0），则**本批只应做「worker 侧切 core、api 侧一行不动」（路线 A）**，`AppHttpModule` 留到阶段 2（拍板 D3）。

---

## 1. 当前模块图

### 1.1 判据（先定判据，再分类）

| 编号 | 判据 | 机械可查的形态 |
|------|------|----------------|
| **D1** | **绑定 HTTP 适配器 / 需要请求上下文** | `switchToHttp()`、`req`/`res` 直取、Express middleware、`@WebSocketGateway`（适配器只在 `NestApplication.init()` 里注册） |
| **D2** | **注册 route（声明 `controllers`）** | 模块里有 `controllers: [...]`。**注意口径**：`createApplicationContext` 不跑 `RoutesResolver`，所以 worker 里 controller 只是「被实例化的 provider」，**不产生路由**——但实例化它仍会拉进它的全部 import（这正是 H2 的成因） |
| **D3** | **只在某一进程的生命周期里被调用** | cron（`@Cron`）/ Bull consumer → worker 侧；请求管线（middleware → guard → interceptor → pipe）→ api 侧 |
| **D4** | **DI 必需性（反判据）** | 被 worker 图里的 provider 注入 ⇒ **必须留在 core**，哪怕它「看起来像 HTTP」。典型反例：`SocketService`（`device.kick.service.ts:27`、`user.shared.service.ts:25`）、`SysDeviceKickModule` 的端口绑定 |

### 1.2 `app.module.ts` 的 16 项 imports 逐项归属

| 槽 | import | 归属 | 判据 | 证据 / 说明 |
|----|--------|------|------|-------------|
| 1 | `AppMiddlewareModule` | **HTTP-only** | D1 | `configure(consumer)` 在一段 `.apply(...)` 里挂满 Express 中间件（`middleware.module.ts:26-59`）；`middlewareModule.register(...)` 只在 `NestApplication.init()`（`nest-application.js:104`），`nest-application-context.js` 里 middleware 引用数 = **0** |
| 2 | `WalnutConfigModule` | 两进程 | — | `ConfigModule.forRoot({ isGlobal: true })`（`config.module.ts:21-40`）；worker 的 `start:worker` 同样靠 `process.cwd()` 定位 env |
| 3 | `WalnutContextModule` | 两进程 | — | `@Global` + `LoggerContextService`（`context.module.ts:14-18`） |
| 4 | `AppI18nModule` | **两进程**（不是 HTTP-only） | D4 | `libs/mailer/src/mailer.processor.ts` 注入 `I18nService`，而 mailer processor 是 **Bull 消费者**（worker 侧）；`libs/system/src/logs/auth/shared/log.auth.shared.service.ts` 同样注入 |
| 5 | `WalnutModule` | 两进程 | — | PG / TypeORM（`db.module.ts:9-15`） |
| 6 | `AppScheduleModule` | 两进程（按 env 让位） | D3 | `isWorkerStandalone() ? [] : [ScheduleModule.forRoot()]`（`schedule.composition.ts:50-53`） |
| 7 | `AppTechModule` | **混装，必须再拆** | D2/D3 | 两者都要：cache / redis / cookie / crypto / lock / queue / sse / task / event；HTTP-only：`AppTechHealthModule`（`controllers: [AppTechHealthController]`，`health.module.ts:17`）+ `AppTechThrottlerModule` + 那条 `APP_GUARD`（`tech.module.ts:34-37`） |
| 8 | `SocketModule` | **混装，必须再拆** | D1 + D4 | gateway 侧 HTTP-only（`@WebSocketGateway`，`socket.gateway.ts:31-33`）；`SocketService` 两进程都要（`socket.module.ts:16-17` 导出，2 个注入点见 D4）；模块还 `imports: [AppMonitorUserHttpModule]`（`:15`，带 controller） |
| 9 | `AuthModule` | **混装** | D2/D3 | `imports: [SysAuthModule, AuthHttpModule]`（`auth.module.ts:16`）；数据面（refresh 清理 cron / signout @Global）worker 要，`AuthHttpModule` 的 9 个 controller 是 HTTP |
| 10 | `SecurityModule` | **HTTP-only** | D2 | 4 个 controller（`security.module.ts:19-24`）+ CAP；CAP 的 service 只被 `cap.controller.ts:76` 与 CAP guard 消费（§2.1） |
| 11 | `SysDeviceKickModule` | **两进程（必须留 core）** | D4 | `@Global` + 端口 `WALNUT_ADMIN_SYSTEM_DEVICE_KICKER`（`device.kick.module.ts:16-23`）；实现 `SysDeviceKickService` 注入 `SocketService`（`device.kick.service.ts:25-28`） |
| 12 | `AppAppModule` | **混装** | D2/D3 | 数据面 + Bull processor（key / setting / logger / error / monitor）worker 要；demo / error / monitor 的 controller 是 HTTP。`AppErrorModule` 还带那条唯一的 `APP_FILTER`（`error.module.ts:44-47`） |
| 13 | `SystemModule` | **混装** | D2/D3 | `imports: [SysSystemModule, SysSystemHttpModule, SysIdentityModule, SysIdentityHttpModule]`（`system.module.ts:24-32`）；数据面是 worker 的 bootstrap 任务与 cron 的直接依赖 |
| 14 | `SharedModule` | 两进程 | — | 纯 provider 聚合（token / ali / area / ALS / delay / BLPath / ip / mask，`shared.module.ts:18`），零 controller |
| 15 | `AppBootstrapTaskModule` | 两进程之一（按 env） | D3 | `...(isWorkerStandalone() ? [] : [AppBootstrapTaskModule])`（`app.module.ts:72`）；worker 恒载（`worker.module.ts:27`） |
| 16 | `DiscoveryModule` | **HTTP/cli-only** | D1 | 只服务 swagger 的 bearer 批量注入（`swagger.document.ts:68` 的 `app.get(DiscoveryService)`）；`swagger.document.ts` 只在 `apps/api/src/main.ts:177` 与 `apps/cli/src/export-openapi.ts:13` 被引 ⇒ **不在 worker 闭包里**（实测，§2.3） |

### 1.3 全局 enhancer 装配（顺序是安全语义，单列）

| 位置 | 类型 | 数量 | 明细 |
|------|------|------|------|
| `app.module.ts:86-142` | `APP_GUARD` | **11 条注册 / 9 个不同类** | IP → Security → Device → Risk(认证前) → **CAP(认证前)** → JWT → Risk(认证后) → **CAP(认证后)** → MFA → Sign → Lock |
| `tech.module.ts:34-37` | `APP_GUARD` | 1 | Throttler（第 12 位，必须在 Lock 之后） |
| `app.module.ts:145-153` | `APP_INTERCEPTOR` | 2 | ResponseSuccess → ALSRequest |
| `libs/app-domain/src/error/error.module.ts:44-47` | `APP_FILTER` | 1 | `WalnutAdminFilterExceptionAll`（**worker 里也注册了**，无请求则永不触发） |

> 合计 **12 条 `APP_GUARD` 注册 / 10 个不同类**（Risk、Cap 各注册两次 = 各 2 个实例，见 `scanner.js:273-296` 的 per-registration UUID token）。

### 1.4 实测：worker 今天到底装了多少东西

用 §2.3 的静态闭包跑 `apps/worker/src/main.ts`：

~~~text
[worker import closure] total .ts files : 816
  controllers                            : 47
  @Module 文件                           : 134
  *.guard.ts                             : 26
在闭包内（= worker 会实例化/加载）：
  IN  libs/throttle/src/throttler.module.ts
  IN  libs/guards/src/guards/throttler.guard.ts
  IN  apps/api/src/socket/socket.gateway.ts
  IN  apps/api/src/middleware/middleware.module.ts
  IN  libs/security/src/cap/cap.module.ts
  IN  apps/api/src/modules/security/cap/cap.controller.ts
  IN  libs/app-domain/src/error/error.module.ts
不在闭包内（api 入口 / main.ts 专属，正确）：
  out apps/api/src/socket/socket.adapter.ts
  out apps/api/src/common/swagger/swagger.document.ts
~~~

即：worker 今天实例化 47 个 controller、26 个 guard 文件里的全部 guard 类（含 CAP 的 2 份实例）、throttler、socket gateway，**只是没有任何一条路径会走到它们的 `canActivate`**。这是「结构错位」，与 Lead 的判断一致；但**比 Lead 的描述更重一层**：`cap.service.ts` 不只是「被实例化」，它在**模块求值期**就已经产生了文件副作用（§2.4）。

---

## 2. CAP 的真实依赖面

### 2.1 `git grep` 原始结果（HEAD `744c56b5`，范围 `apps/server`）

~~~text
$ git grep -n "AppCapJS" -- apps/server
libs/guards/src/guards/cap.guard.ts:21        import { AppCapJS } from '@walnut-server/security/cap/cap.service'
libs/guards/src/guards/cap.guard.ts:257       ({ success } = await AppCapJS.validateToken(capToken))
libs/security/src/cap/cap.service.ts:17       export const AppCapJS = new Cap({ ... })
libs/security/src/cap/cap.service.ts:48,58    AppCapJS.createChallenge / redeemChallenge
libs/security/src/cap/cap.service.spec.ts:4,61,82          （spec）
libs/guards/src/guards/cap.guard.spec.ts:8,30,34           （spec，vi.mock 掉 cap.service）
libs/const/src/app/cap.ts:60                  （注释）
apps/api/test/api/{DESIGN-ISSUES,ENDPOINTS}.md             （文档）

$ git grep -n "SecurityCapService" -- apps/server
libs/security/src/cap/cap.module.ts:2,7,8     providers / exports
libs/security/src/cap/cap.service.ts:22       export class SecurityCapService
apps/api/src/modules/security/cap/cap.controller.ts:7,76   ← 唯一业务消费者
apps/api/src/common/swagger/openapi-response-schema.spec.ts:17,80   （spec）

$ git grep -n "SecurityCapModule" -- apps/server
libs/security/src/cap/cap.module.ts:10
libs/security/src/security.module.ts:3,22,29   （SysSecurityModule 聚合，imports + exports）

$ git grep -n "WALNUT_ADMIN_CAP_TOKEN_STORE_PATH\|tokens_store_path" -- apps/server
libs/security/src/cap/cap.service.ts:15       export const WALNUT_ADMIN_CAP_TOKEN_STORE_PATH = '.data/tokensList.json'
libs/security/src/cap/cap.service.ts:18       tokens_store_path: WALNUT_ADMIN_CAP_TOKEN_STORE_PATH
libs/security/src/cap/cap.service.ts:38       （onModuleInit 的 warn 文案）
~~~

### 2.2 回答「除 guard 外还有没有别的消费者」

| 消费者 | 是什么 | 结论 |
|--------|--------|------|
| `WalnutAdminGuardCap`（2 条 APP_GUARD 注册） | **不注入 `SecurityCapService`**，而是直接 import 模块级单例 `AppCapJS`（`cap.guard.ts:21`） | guard 走的是**模块求值链**，不是 DI 链 |
| `SecurityCapController`（`cap.controller.ts:76`） | `challenge` / `redeem` 两条写路径 | **HTTP-only**；worker 永远走不到（无 HTTP 监听） |
| cron / bootstrap / worker task | **无** | 全仓 `SecurityCapService` 的业务注入点只有 cap.controller 一处；5 个 bootstrap 任务（`bootstrap-task.module.ts:59-64`）与 `AppTechTasksService` 都不碰 CAP |
| `AppTechCacheCapService`（`libs/cache/src/service/cap.cache.ts`） | **名字像 CAP，实际是「验证结果缓存」**（Redis，`cap.guard.ts:185/208/270`） | 与 cap.js token 存储无关；worker 里实例化是**无害**的，不要顺手删（删了 guard 与 `guard-matrix.api-spec.ts:567` 都会红） |

> 另需注意：`SecurityCapSettingService`（`cap.setting.service.ts`）与 `SecurityCapService` 同在 `SecurityCapModule` 的 providers 里，一起移动即可。

### 2.3 import 闭包实测（方法 + 数据）

方法（未落盘的一次性脚本，纯 fs + 正则，零装载）：按 `apps/server/tsconfig.json` 的 `paths`（`@/*` → `apps/api/src/*`、`@walnut-server/<lib>` → `libs/<lib>/src`）解析每条 `import/export ... from '...'`，从入口做 BFS，得到「会被 `require` 到的 .ts 集合」——等价于运行时会被求值的文件集（这正是 `new Cap()` 的触发条件）。

~~~text
[入口 apps/worker/src/main.ts]   816 个 .ts ；cap.service.ts ∈ 闭包 ：true
最短链：
  apps/worker/src/main.ts
   -> apps/worker/src/worker.module.ts
   -> apps/api/src/app/app.module.ts
   -> libs/guards/src/index.ts            ← export * from './guards/cap.guard'（index.ts:31）
   -> libs/guards/src/guards/cap.guard.ts ← import { AppCapJS }（cap.guard.ts:21）
   -> libs/security/src/cap/cap.service.ts← new Cap({...})（cap.service.ts:17）

闭包里 import 了 guards barrel 的文件数：56
  构成：46 个 .controller.ts + 6 个 .guard.ts + 2 个 .module.ts
        + blacklist-path.middleware.ts（middleware，HTTP-only）
        + otp/guard/otp.decorator.ts（装饰器，HTTP-only）
  ⇒ 56 个里没有一个是「worker 需要求值的非 HTTP 代码」
~~~

把 `SecurityModule` 从候选 core 里摘掉（草案 B，模拟「CAP 先挪」）：

~~~text
[草案 B = core 不含 SecurityModule]  770 个 .ts ；cap.service.ts ∈ 闭包 ：true
链变成：
  tech.module.ts:7  import { WalnutAdminGuardThrottler } from '@walnut-server/guards'
   -> libs/guards/src/index.ts -> cap.guard.ts -> cap.service.ts
仍在闭包里的 guards-barrel importers：49 个
  构成：41 个 .controller.ts + 6 个 .guard.ts（其中 5 个是 passport mixin guard）
        + tech.module.ts + otp/guard/otp.decorator.ts
  · libs/app-domain/src/key/key.controller.ts        （AppKeyModule 必需：rotateAppKey cron）
  · libs/app-domain/src/setting/setting.controller.ts（AppSettingsModule 必需：settings 预热）
  · libs/app-domain/src/error/error.controller.ts    （AppErrorModule 必需：error Bull processor）
  · libs/app-domain/src/logger/logger.controller.ts
  · …其余 45 个
~~~

改用 libs 级业务模块拼 core（不经 app 的 HTTP 包装模块）也**救不了**：

~~~text
[候选 core = 纯 libs 数据面 + tech(cache/lock/queue/sse/cookie/crypto) + SysAuth/SysSystem/SysIdentity]
701 个 .ts ；cap.service.ts ∈ 闭包 ：true ；guards barrel ∈ 闭包 ：true
barrel importers：10（全部是 libs/app-domain 的 controller）
controllers 仍在闭包里：9
~~~

**唯一的反证数据**：同一批闭包里，import `@walnut-server/security` **barrel** 的文件数 = **0**；只有 3 个 guard 走子路径（`cap.guard` / `risk.guard` / `sensitive.guard`，另加 2 个 oauth controller）。
⇒ 只要切断「**guards barrel → cap.guard.ts**」这一条边，CAP 就会从 worker 闭包里**彻底消失**，其余一切（模块怎么切、controller 留不留）都不用动。这就是 §4.5 的方案来源。

### 2.4 `new Cap()` 的真实副作用（**我实测了，不是读码推演**）

用仓库里装的 `@cap.js/server@4.0.5` 在临时目录跑一次构造（探针目录建在 `%TEMP%`，跑完删除）：

~~~text
probe cwd = C:\Users\tron\AppData\Local\Temp\cap-probe-...
SIGTERM listeners before    = 0
beforeExit listeners before = 0
file exists right after import = false
SIGTERM listeners after new Cap()    = 1        ← 构造期就装了信号处理器
beforeExit listeners after new Cap() = 1
[cap] tokens file not found, creating a new empty one
.data dir exists  = true
token store files = [ 'tokensList.json' ]
file content      = "{}"
~~~

对应源码（`@cap.js/server@4.0.5/index.js`）：

| 行为 | 出处 |
|------|------|
| 构造即 `_loadTokens()`（不 await，`.catch(() => {})` 吞掉） | `:201-203` |
| 注册 `process.on('beforeExit', cleanup)` 与 `once('SIGINT'/'SIGTERM'/'SIGQUIT')` → `cleanup().then(() => process.exit(0))` | `:205-213` |
| `_loadTokens`：`mkdir(dirname)` + 读文件；读不到就 `writeFile(path, '{}')` | `:444-473` |
| `cleanup()`：清理过期 token，**有变化就把整份内存快照写回文件** | `:545-565` |

⇒ 三件事今天在 worker 里都发生了：**目录创建 / 文件创建 / 信号处理器抢占**。第三件尤其值得记一笔（§6.6）。

### 2.5 两个进程共用同一个文件（推演，标注清楚）

`worker/main.ts` 与 api 都以 `apps/server/` 为 cwd（`start:worker` = `node dist/apps/worker/src/main.js`，`package.json:32`；ConfigModule 也依赖 cwd），`tokens_store_path` 是相对路径 ⇒ **同一个 `apps/server/.data/tokensList.json`**（现值：2 字节、内容 `{}`、mtime `2026/11/3 12:12:56`；该目录在 `.gitignore` 里）。

推演（**未实测**，本机无法起两个真进程）：worker 启动时把 token 表读进内存（`_loadTokens`），之后**永不刷新**；停机时 `cleanup()` 若发现过期项（token TTL 20 分钟，长跑进程几乎必然有），会把**它自己那份陈旧快照**整份写回 ⇒ api 在 worker 启动之后签发的 token 会从文件里消失（api 内存里还在，但 api 重启后这批用户会吃 40116/40117，直到客户端重做挑战）。
影响面：自愈型（客户端会刷新），**不是**「已炸」，但它把「worker 不该碰 CAP 存储」从口号变成了可观测事实——同时给 §5 提供了一条**比日志更硬的判据**（`.data` 文件的 mtime 不得因 worker 启停而变）。

---

## 3. Throttler 与 Socket：worker 需要它们吗

### 3.1 Throttler —— **纯 HTTP，worker 零收益**

| 事实 | 证据 |
|------|------|
| tracker 取 `req.realIp`（请求对象字段，由 `IpMiddleware` 写入） | `throttler.guard.ts:34-36` |
| 存储是**进程内内存**（没配 `storage`，注释里明确登记了单实例前提） | `throttler.service.ts:8-29` |
| 装配 = `ThrottlerModule.forRootAsync` + 一个 `APP_GUARD` | `throttler.module.ts:13-21` · `tech.module.ts:34-37` |
| worker 侧唯一可见效果 | 启动日志多一行 `[ThrottlerLog] Initiating throttler module...`（`throttler.service.ts:37`）+ 一份永远用不上的内存计数器 |

⇒ 判据 D1/D3 都指向 HTTP-only。**顺带**：这条日志是 §5 的一个便宜判据（搬走后 worker 启动日志里不该再有它）。

### 3.2 Socket —— 适配器/网关**不会**在 `createApplicationContext` 下被创建（有源码证据）

| 环节 | api（`NestFactory.create` → `NestApplication`） | worker（`createApplicationContext` → `NestApplicationContext`） | 证据 |
|------|------|------|------|
| WebSocket 模块加载 | `init()` 里 `loadSocketModule()` | **不加载** | `nest-application.js:113-133`；`nest-application-context.js` 里 gateway/websocket 引用数 = **0** |
| gateway 注册（`afterInit` → `@WebSocketServer` 注入） | `registerWsModule()` → `socketModule.register(...)` | **不执行** | `nest-application.js:106-112` |
| 适配器 | `app.useWebSocketAdapter(new SocketIoAdapter(...))` | 无（`initialize(..., httpServer = null)` → `container.setHttpAdapter(null)`） | `apps/api/src/main.ts:132` · `nest-factory.js:88-100` |
| 结论 | 真实 socket.io 命名空间 | `SocketGateway` 只是被实例化的 provider；`SocketService.socket` 恒 `null` | `socket.service.ts:15` |

⇒ HTTP-only 的只有 **gateway + `SocketAuthMiddleware` + `AppMonitorUserHttpModule`（`socket.module.ts:15-16`）**。

### 3.3 但 `SocketService` 必须留在 worker（反判据 D4）

- `apps/api/src/modules/system/device/shared/device.kick.service.ts:25-28` 注入 `SocketService`（端口 `WALNUT_ADMIN_SYSTEM_DEVICE_KICKER` 的实现，`@Global` 绑定）；
- `apps/api/src/modules/app/monitor/user/shared/user.shared.service.ts:25` 注入 `SocketService`（端口 `WALNUT_ADMIN_AUTH_MONITOR_SERVICE` + `WALNUT_ADMIN_IDENTITY_USER_NOTIFIER` 的实现）；
- 这两个 `@Global` 模块由 `AppTechTaskModule` 引入（`task.module.ts:31`），而 task 模块是 worker 的 cron 宿主 ⇒ **删掉 `SocketService` = worker 启动即 DI 报错**；
- 语义上 worker 里它是空壳：`kickDeviceSockets` 在 `socket === null` 时 `return 0`（`socket.service.ts:63-68`），日志会打 `sockets closed: 0`——**正确但无用**，属可接受的现状（真正的踢人只能发生在 api）。

⇒ 结论：**Socket 要拆成两半**（`SocketCoreModule`：只 providers `[SocketService]` + `@Global`；`SocketModule`：gateway + auth middleware + `AppMonitorUserHttpModule`），**不是整体搬走**。

---

## 4. 最小切分方案（草案，**不落地**）

### 4.1 两条不可回避的约束（先看这个，再看模块名单）

**C1 —— 12 条 `APP_GUARD` 只能整体搬或整体不搬。**
顺序真源：`Scanner.insertProvider` 在扫到某模块时把该模块的 enhancer 依次追加进 `applicationProvidersApplyMap`（`scanner.js:262-291`）；`NestFactory.initialize` 按这个数组的**现存顺序**逐个 `addGlobalGuard`（`nest-factory.js:99-108` → `scanner.js:386-419`）；`GuardsContextCreator` 直接按数组顺序执行（`guards-context-creator.js:56-66`）。而模块扫描是**前序 DFS**：根模块先被 insert，再递归 imports（`scanner.js:44-95`）。
⇒ 推论：**根模块里的 11 条永远排在任何 import 里的 enhancer 之前**。所以「CAP 单独挪走」「throttler 单独挪走」都会改变次序（CAP 会跑到 JWT/MFA/Sign/Lock 之后）。

**C2 —— 16 项 imports 的任何重排都会改 `openapi.json` 的 paths 顺序。**
`app.module.ts:70-71` 自己的注释就写着这条（openapi.json 的 paths 顺序依赖 RouterExplorer 的模块遍历顺序），源码印证：`routes-resolver.js:30-34` 遍历 `container.getModules()`（插入序 = imports 前序 DFS）。
当前 HTTP-only 与 core 交错在槽位 **1 / 7b / 8 / 10 / 16**，其中带 controller 的是 7b(health)、8(monitor-user)、10(security)。任意「一整块 core + 一整块 http」的二分都会让 `/security/*` 与 `/app/monitor/user/*` 相对 auth 段换位。

### 4.2 草案 A（**推荐本批落地**）：worker 切到 `AppCoreModule`，api 一行不动

> 依据 C1/C2：api 侧零改动 ⇒ guard 顺序零风险、`openapi.json` 字节零 diff、`guard-matrix` 零风险。代价：`app.module.ts` 与 `core.module.ts` 的 imports 名单有重叠（需 §5 G2b 的 drift 守卫钉住「core ⊆ app」且「core ∩ HTTP-only = ∅」）。

**`apps/api/src/app/core.module.ts`（新文件，只列模块名 + 理由）**

| import | 为什么 core 需要 |
|--------|------------------|
| `WalnutConfigModule` | env（两进程都要） |
| `WalnutContextModule` | ALS 日志上下文（`@Global`） |
| `AppI18nModule` | mailer.processor / log.auth.shared 注入 `I18nService` |
| `WalnutModule` | PG 连接 |
| `AppScheduleModule` | cron 归属（env 让位逻辑与 api 共用同一判据） |
| `AppTechCoreModule`（**新**：现 `AppTechModule` 去掉 health + throttler） | cache / redis / cookie / crypto / lock / queue / sse / task / event 全都要 |
| `SocketCoreModule`（**新**：只 `SocketService`） | D4：两个 `@Global` 端口实现注入它 |
| `SysAuthModule` | refresh 清理 cron / signout `@Global`（`AuthSignoutModule` 是 `@Global`，`device.kick` 靠它解析） |
| `SysSystemModule` / `SysIdentityModule` | bootstrap 预热/清理任务与 cron 的数据面（locale 预热、device 活跃状态、MFA 状态等） |
| `SharedModule` | token / ip / blpath / delay / ALS / mask，纯 provider |
| `AppKeyModule` / `AppSettingsModule` / `AppLoggerModule` / `AppErrorModule` / `AppMonitorUserModule`（libs/app-domain 数据面） | rotateAppKey / settings 预热 / error Bull processor 等 |
| `SysDeviceKickModule` | D4：端口绑定，缺了 = 启动期 DI 报错 |
| `AppTechTaskModule` + `AppMonitorUserSharedModule`（已被 task 引入） | cron 宿主 + 两个 `@Global` 端口绑定 |

**`apps/api/src/app/http.module.ts`（新文件，阶段 2 才启用；本轮只作为草案）**

| import | 为什么只在 HTTP 侧 |
|--------|-------------------|
| `AppMiddlewareModule` | D1：整段 Express 中间件（`.apply(...).forRoutes('*')`），只在 `NestApplication.init()` 里生效 |
| `AppTechHealthModule` | D2：一个 controller（`/health`） |
| `AppTechThrottlerModule` + 第 12 条 `APP_GUARD` | D1/D3：限流只对请求生效 |
| `SocketModule`（gateway 版） | D1：适配器只在 api 装配 |
| `SecurityModule`（CAP 的宿主） | D2：4 个 controller；CAP 的写路径（challenge/redeem）只在这里 |
| `AuthHttpModule` / `SysSystemHttpModule` / `SysIdentityHttpModule` / `AppDemoModule` 等 HTTP 包装 | D2：纯 controller + wire DTO |
| `DiscoveryModule` | 只有 `createSwaggerDocument` 用 |
| 12 条 `APP_GUARD` + 2 条 `APP_INTERCEPTOR` | 请求管线专属（**必须 12 条一起搬，见 C1**） |

**`apps/api/src/app/app.module.ts`（阶段 2 形态）**：`imports: [AppCoreModule, AppHttpModule, ...条件项]`（顺序取舍见 C2）。

### 4.3 `worker.module.ts` 改造后（草案 A / B 相同）

~~~ts
// 草案：不落地
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { AppBootstrapTaskModule } from '../../api/src/modules/techniques/task/bootstrap-task.module'
import { AppCoreModule } from '../../api/src/app/core.module'          // ← 不再 import AppModule
import { isWorkerStandalone } from '../../api/src/app/schedule.composition'

@Module({
  imports: [
    AppCoreModule,                    // 业务 + 基础设施（不含任何 APP_GUARD / middleware / gateway / CAP）
    AppBootstrapTaskModule,           // 恒载（与 api 的条件注册同一判据）
    ...(isWorkerStandalone() ? [ScheduleModule.forRoot()] : []),
  ],
})
export class WorkerModule {}
~~~

### 4.4 分阶段建议

| 阶段 | 动作 | 风险 | 达成 |
|------|------|------|------|
| **1（本批）** | 新增 `AppCoreModule` + 拆 `AppTechCoreModule` / `SocketCoreModule`；`worker.module.ts` 改 import `AppCoreModule`；**`app.module.ts` 一行不动** | 极低（api 图逐字节不变） | worker 不再有 CAP **provider**、throttler、gateway、middleware、Discovery；`.data` 仍会被 `new Cap()` 创建（H2） |
| **1.5（可选，见 4.5）** | 拆 `cap.guard.ts` 为「装饰器 + 类」两文件，barrel 只导出装饰器 | 低（1 新文件 + 3 处 import） | worker **彻底不加载 cap.js**（`.data` 不再被创建/写回） |
| **2（下一批）** | `AppModule = AppCoreModule + AppHttpModule`，12 条 guard 整体搬 | 中（C1 + C2：openapi 顺序） | `app.module.ts` 变薄，职责边界自洽 |

### 4.5 阶段 1.5 的具体形态（若要「真隔离」，这一步绕不过）

现状：`cap.guard.ts` 一个文件同时装着**装饰器/纯函数**（`:25-46`：Symbol、`WalnutAdminGuardCapFree`、`isWellFormedCapJsToken`）和**guard 类**（`:66-318`，import `AppCapJS`）。而 barrel 只 `export *` 这个文件 ⇒ 任何只是想拿装饰器的 controller 都会顺带加载 cap.js。

消费面清清楚楚（`git grep`）：

~~~text
WalnutAdminGuardCap（类）：只有 app.module.ts:8,107,123 用它（+ 自己的 spec）
WalnutAdminGuardCapFree（装饰器）：8 个 controller 用
  （setting / sign / locale / lang / rsa / cap / monitor-user / device）
~~~

⇒ 草案：新建 `libs/guards/src/guards/cap.decorator.ts`（搬 `:25-46`），`cap.guard.ts` 只留类并 `import { ... } from './cap.decorator'`；`libs/guards/src/index.ts:31` 改成 `export * from './guards/cap.decorator'`，类改由子路径 `@walnut-server/guards/guards/cap.guard`（`tsconfig.json:220-225` 已有 `@walnut-server/guards/*` 映射）导出，只有 `AppHttpModule` 引它。
`cap.guard.spec.ts` / `cap.service.spec.ts` 的 mock 面不受影响（前者 mock 的是 `@walnut-server/security/cap/cap.service`）。
**另一条等价路线**：把 `export const AppCapJS = new Cap(...)` 改成惰性 getter（首用才构造）——效果相同，但要改 2 个 spec 的 spy 面。两条都要 Lead 二选一（拍板 D4）。

---

## 5. 验证手段：双启动冒烟 + 三道零基础设施门禁

### 5.1 判据总表

| 编号 | 判据 | 能证明什么 | 前提 | 现状 |
|------|------|-----------|------|------|
| **G1** | 新 spec：worker import 闭包**不含** `cap.service.ts` / `throttler.guard.ts` / `socket.gateway.ts` / `@nestjs/throttler` | 「worker 不再实例化/加载 CAP」的**结构级**证明（比日志硬） | 无（纯 fs + 正则，同 `common/monorepo/*.drift.spec.ts` 形态） | **现在会红**（实测 `cap.service.ts ∈ 闭包 = true`）——这正是它该有的初始值 |
| **G2** | 新 spec：`MODULE_METADATA.PROVIDERS` 里 `APP_GUARD` 的 `useClass.name` 序列 === 12 元黄金表；且 `AppCoreModule` / `tech.module` 里 `APP_GUARD` 计数为 0（搬完后） | 顺序真源唯一、可机械对账 | 无（只读装饰器元数据） | 现在没有这道守卫（全仓 `getGlobalGuards` 引用数 = 0） |
| **G2b** | 新 spec：`AppCoreModule.imports ⊆ AppModule.imports`，且不得含 `{AppMiddlewareModule, SecurityModule, AppTechHealthModule, AppTechThrottlerModule, DiscoveryModule, SocketModule(gateway)}` | 路线 A 的「两份名单」不会漂移 | 无 | 新增 |
| **G3** | 双启动冒烟（日志）：worker 启动日志**不得**出现 `SecurityCapService`、`ConfigService - Throttler`；必须出现 `worker process started (no HTTP listener)`（`worker/main.ts:34`） | 运行期确实没实例化 CAP provider / throttler | PG + Redis + `env-local/` | 本轮无法执行（本机无 5432/6379、无 docker） |
| **G4** | 双启动冒烟（文件）：把 `.data/tokensList.json` 移走 → 起 worker → **该文件必须仍不存在**；跑一会儿后 SIGTERM → mtime 不得变 | 「worker 不碰 CAP 存储」的**副作用级**证明（今天必然失败：实测 `new Cap()` 会创建它） | PG + Redis | 同上 |
| **G5** | `pnpm --filter @walnut/server openapi:check:export` 字节零 diff | 路线 A：必须零 diff；路线 B：会 diff ⇒ 说明 paths 顺序变了（人工 review 只允许顺序变动） | PG + Redis（export 会 `app.init()`） | 同上 |
| **G6** | `pnpm --filter @walnut/server test`（含 G1/G2/G2b）+ `test:integration`（`guard-matrix.api-spec.ts` 属 `apps/api/test/api/**/*.api-spec.ts`，由 `vitest.config.integration.ts:44` 收）+ `test:e2e` | 运行期 guard 链行为不变（拒绝码不变） | 单测无需基础设施；后两者需 PG + Redis | 同上 |

### 5.2 可执行命令（cwd 口径写死）

~~~powershell
# ── G1 / G2 / G2b：零基础设施，任何时候可跑 ──
cd apps/server
cmd /c "pnpm vitest run --config ./apps/api/vitest.config.ts worker-import-closure guard-order"

# ── G6 单测全量 ──
cmd /c "pnpm test"

# ── G3 / G4：双启动冒烟（两个终端，cwd 都是 apps/server）──
# 终端 1（api）
cmd /c "pnpm dev"
# 终端 2（worker）—— 注意：本仓没有 dev:worker，只能先构建
cmd /c "pnpm build:worker"
cmd /c "cross-env NODE_ENV=development WORKER_STANDALONE=true node dist/apps/worker/src/main.js"

# ── G5 openapi 零 diff ──
cmd /c "pnpm openapi:check:export"
~~~

> 观察口径：HTTP 恒 200，真实结果看 `body.code`（本仓既有约定）。G3 的日志按 `WalnutAdminLogger` 输出，grep 关键字取 `SecurityCapService` / `ConfigService - Throttler` 两个 Logger 上下文名即可。

### 5.3 怎么「不破坏现有 12 个 guard 顺序」地证明「worker 不再实例化 CAP」

三步，互不重叠：

1. **结构证明（G1，零基础设施）**：闭包断言。它是**加强版**——不只证明「CAP provider 没被实例化」，而是证明「连 cap.js 都没被加载」。今天红、改完绿，且可用变异测试验证它有牙（把 `SecurityModule` 加回 `AppCoreModule` → 必须变红）。
2. **顺序证明（G2，零基础设施）**：把 12 个 guard 的**类名序列**钉成常量表。它与 G1 正交：G1 管「worker 少了什么」，G2 管「api 的 12 条一条不少、次序一位不差」。
3. **行为证明（G6，需基础设施）**：`guard-matrix.api-spec.ts` 走真实 HTTP 全链，逐个断言拒绝码（40111/40116/40117/403xx…）。顺序一旦错位，拒绝码立刻变（例如 CAP 排到 JWT 之后，未登录请求会先吃 40101 而不是 40116）——**这是「顺序没被破坏」的最强证据**，但它需要库。

> 换句话说：**顺序风险不必靠"冒烟"来守，靠 G2 + G6；CAP 隔离不必靠日志来守，靠 G1 + G4。** 日志（G3）只是给人看的即时反馈。

---

## 6. 风险逐项

### 6.1 `app.module.ts` 里 `APP_GUARD` 的顺序

| 场景 | 影响 | 判定 |
|------|------|------|
| **路线 A**（api 一行不动，只加 `AppCoreModule` 给 worker） | 12 条注册原地不动 ⇒ 顺序逐字不变 | ✅ 无风险 |
| 只把 CAP 两条挪进 `AppHttpModule` | CAP 落到链尾（JWT 之后），40116/40117 语义反转 | ❌ **禁止**（C1） |
| 12 条整体搬进 `AppHttpModule`，**但** throttler 那条仍留 `tech.module` | throttler 排在 `AppHttpModule` 之前还是之后取决于两模块在 imports 里的先后 ⇒ 可能变成「限流第一、IP 黑名单第二」 | ⚠️ 必须**同时**把 throttler 那条搬进来 |
| 12 条整体搬进 `AppHttpModule`（含 throttler），顺序按现表 | 顺序不变（同模块同数组） | ✅ 但需 G2 钉住 |
| `AppHttpModule` 内含 `useClass` 两次的同一类（Risk / Cap） | Nest 每次注册生成独立 UUID token（`scanner.js:273-296`）⇒ 仍是 2 个实例，与现在一致 | ✅ 不变 |

### 6.2 `swagger.document.ts` 的遍历

- 遍历入口是 `discoveryService.getControllers()`（`swagger.document.ts:73`），`DiscoveryService` 由 `DiscoveryModule` 提供，通过 `app.get(DiscoveryService)` 从**根上下文跨模块**取（`:67-69`）⇒ 只要 `DiscoveryModule` 仍在 api 的图里（无论在 `AppHttpModule` 还是 `AppModule`），遍历面不变。
- 遍历结果只依赖「容器里有哪些 controller」，与模块切分无关；`applySwaggerBearerAuth` 只在 api（`main.ts:177`）与 cli（`export-openapi.ts:71`）被调 ⇒ **worker 完全不参与**。
- 真正的坑：`DiscoveryModule` 被误删 ⇒ api 启动即 `app.get(DiscoveryService)` 抛错。另一个与本批无关但要记住的点：文档只非生产挂载（`main.ts:173`）。
- 幂等标记 `WALNUT_ADMIN_SWAGGER_BEARER_INJECTED` 挂在 handler 上（`:56` / `:114`），重复调用不叠加 ⇒ 不受影响。

### 6.3 `guard-matrix.api-spec.ts`

- 它用 `createApiApp()`（`helpers/create-api-app.ts:45`，`imports: [AppModule]`）装配**全量** AppModule ⇒ 只要 `AppModule` 的 guard 注册面不变、`SecurityCapService` 仍在 api 图里，**它一行都不用改**。
- 它对 CAP 的依赖有两处：`app.get(AppTechCacheCapService).delCapTokenCache(...)`（`:567`，缓存侧，与 cap.js 存储无关）与 CAP 拒绝码断言。**注意**：它**不**断言 guard *顺序*，只是顺序错位会间接改拒绝码 ⇒ 它是「行为级」而非「顺序级」守卫。
- 路线 B 若把 `SecurityCapService` 误从 api 图里摘掉 → `cap.controller` 的 DI 立刻报错 ⇒ 这类错误会在 `createApiApp()` 阶段就炸，**不会静默**。

### 6.4 `openapi.json` / `openapi:check`

- 路线 A：`AppModule.imports` 逐项不变 ⇒ 零 diff（可当作本批的硬验收）。
- 路线 B：paths 顺序必变（C2）⇒ `openapi:check:export` 红，需要重新导出 + 人工确认「只有顺序变、没有路径增删」。这会连带污染 `packages/generated/api-types`（`openapi:check:schema` 段），因为 `schema.d.ts` 的键序也会跟着动。

### 6.5 `apps/cli/src/export-openapi.ts`（容易被忘）

它 `import { AppModule } from '../../api/src/app/app.module'` 并 `await app.init()`（`:59-62`）——**必须继续拿到全量 HTTP 图**。如果为了「让 worker 干净」把 `AppModule` 削成只有 core，openapi 会立刻丢掉全部 app 侧 controller 的路径，`openapi:check:export` 与前端 `api-types` 一起崩。
⇒ 约束：**`AppModule` 永远是「api + cli 的全量图」**，worker 换入口，而不是把 `AppModule` 变薄。

### 6.6 SIGTERM 竞争（新发现，与本次拆分互为因果）

`@cap.js/server` 在**构造期**注册 `process.once('SIGTERM')` → `cleanup().then(() => process.exit(0))`（`index.js:205-213`，实测 `SIGTERM listeners after new Cap() = 1`）。
两个进程都会 `app.enableShutdownHooks()`（`apps/api/src/main.ts:191`、`apps/worker/src/main.ts:26`）。cap.js 的处理器在**模块加载期**注册（早于 `enableShutdownHooks`），所以在 signal emitter 里排在 Nest 之前 ⇒ 理论上可以在 `app.close()` 把 PG / Redis / Bull 排空前就 `process.exit(0)`。
- 拆分后：**worker 侧这个竞争消失**（不再加载 cap.js）；
- api 侧：**保持现状**（不是本批引入的），但要登记为已知风险——api 现在还有 `setDraining(true)` 那条 handler（`main.ts:198-199`）依赖「注册晚于 enableShutdownHooks」的注释，三套 SIGTERM 处理器共存值得单独 review。

### 6.7 DI / `@Global` 可见性（路线 A 的主要施工风险）

- `SocketCoreModule` 必须 `@Global`（或由 `AppCoreModule` 显式 export）：`SysDeviceKickService` / `AppMonitorUserSharedService` 都是**跨模块注入** `SocketService`，今天靠 `SocketModule` 的 `@Global`（`socket.module.ts:13`）解析。
- `SysDeviceKickModule` 是 `@Global` 端口绑定（`device.kick.module.ts:13-23`），**漏在 core 外 = worker 启动期 DI 报错**（模块注释明写「缺绑定 = 启动期 DI 报错，不会静默跳过」）。
- `AuthSignoutModule` 是 `@Global`（`libs/auth/src/modules/signout/signout.module.ts`），所以 `SysDeviceKickService` 只要 core 引 `SysAuthModule` 即可解析。
- cron 宿主：`AppTechTasksService` **只能有一个 provider 实例**（`task.module.ts:17-21` 的 DUPLICATE_SCHEDULER 警告）⇒ `AppCoreModule` 引 `AppTechTaskModule`、`AppBootstrapTaskModule` 引同一个模块（Nest 按类去重），**别在 core 里重复 provide**。
- `WORKER_STANDALONE` 语义不变：`AppScheduleModule` 与 `AppBootstrapTaskModule` 的条件判据仍读 `process.env`（`schedule.composition.ts:24-26`、`bootstrap-task.module.ts:19-21`），与模块切分无关。

### 6.8 其它

| 项 | 说明 |
|----|------|
| `APP_FILTER`（`error.module.ts:44-47`） | 随 `AppErrorModule` 进 core，worker 里也注册。无请求 ⇒ 永不触发；不必为它单独设计 |
| `AppI18nModule` 的 `join(__dirname, '../i18n/')` | 取决于产物布局；两进程共用同一份 `apps/api/src/i18n` 编译产物，**不因拆分而变**（未实测 dist 布局，登记为未验证项） |
| worker 没有 `dev:worker` 脚本 | `package.json:26-33` 只有 `build:worker` + `start:worker`（后者 = prod + dist）⇒ 双启动冒烟得先 build；是否加 `dev:worker`（`nest start worker --watch`）由 Lead 定（拍板 D5） |
| `.data/tokensList.json` 已被 gitignore | `.gitignore` 有一条专门针对它的注释（Cap.js 的反机器人 token 存储）⇒ G4 把文件移走不会污染工作树 |

---

## 7. 我没有验证的东西（说明边界，避免被当成结论）

1. **没有真起 api / worker**：本机无 docker、5432/6379 无监听 ⇒ G3/G4/G5/G6 全部未执行。
2. **没有跑任何测试**（`pnpm test` 也没跑）：本轮定位是静态复核 + 判据设计；`cap.guard.spec.ts` / `cap.service.spec.ts` 的现有绿/红状态我未观测。
3. **跨进程写回（§2.5）是推演**，不是实测；要证实需要两个进程 + 非空 token 表 + 至少一个过期项。
4. **dist 产物布局**（`__dirname` 相关）未检查。
5. G1/G2/G2b 三道 spec **尚未编写**（本轮只读）。它们是我给出的可执行判据，不是已有资产。

---

## 需要 Lead 拍板

> 每条都给「不拍板会卡在哪一步」。

**D1 —— 第一批的 guard 怎么动？（卡住 §4 的所有施工）**
C1 证明了「只挪 CAP」会把 CAP 挪到 JWT 之后。二选一：
- **(a) 本批一个 guard 都不动**（路线 A：只加 `AppCoreModule` 给 worker，`app.module.ts` 一行不改）—— 风险最低，我推荐；
- **(b) 12 条（含 throttler 那条）一次性整体搬进 `AppHttpModule`** —— 更彻底，但要同时接 C2 的 openapi 顺序问题。

**D2 —— 「worker 不再实例化 CAP」的口径到哪一层？（卡住阶段 1 的验收定义）**
- **(a) provider 级**：worker 的 DI 图里没有 `SecurityCapService`（阶段 1 就能达成，判据 G3）；
- **(b) 模块求值级**：worker 连 cap.js 都不加载、不创建 `.data`、不注册 SIGTERM（需要阶段 1.5：拆 `cap.guard.ts`，见 §4.5）。
我建议按 **(b)** 立验收，否则 `.data` 的跨进程写回（§2.5）与 SIGTERM 竞争（§6.6）都还在。

**D3 —— `openapi.json` 字节零 diff 是不是本批硬约束？（卡住 §4.2 选 A 还是 B）**
是 ⇒ 只能走路线 A；否 ⇒ 允许重新导出，但需人工确认「只有 paths 顺序变」，并同步 `packages/generated/api-types`。

**D4 —— `cap.guard.ts` 拆分 vs `AppCapJS` 惰性化，选哪条？（卡住阶段 1.5）**
前者动 1 个新文件 + 3 处 import，spec 不动；后者动 1 个文件 + 2 个 spec 的 spy 面。

**D5 —— 要不要加 `dev:worker` 脚本？（卡住双启动冒烟的易用性）**
现在只能 `build:worker` 后跑 dist；若加 `nest start worker --watch`，冒烟成本降到「两个终端各一条命令」，也更适合写进下一批的施工单。

**D6 —— 双启动冒烟放哪？（卡住 G3/G4/G5 的归属）**
- 只在本地/发布前手工（CI 无 PG/Redis）；
- 还是进 CI（需要给 job 挂 PG + Redis service）。若进 CI，G1/G2/G2b 这三道零基础设施门禁可以先落，G3~G5 后置。
