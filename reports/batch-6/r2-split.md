# 批次 6 · R2：CAP × worker 隔离（阶段 1 落地）

> 执行：**全新实施 agent**（未参与 R1 调研，按 r1-http-split.md 动手）
> 输入：reports/batch-6/r1-http-split.md（516 行）+ Lead 拍板 D1–D6
> 基线：HEAD 744c56b5，开工时 git status --porcelain 只有未跟踪的 reports/batch-6/
> 性质：**动手批次**。**未 git commit**（按要求）
> 环境更正：任务书说「本机无 docker、5432/6379 无监听」——**实测 PG / Redis 都通**（openapi:export 真的 app.init() 成功、worker 真的起了 7 个 cron）。所以 R1 判为「无法执行」的 G3/G4/G5 **本轮全部真跑了**（§6）。

---

## 0. TL;DR

| # | 交付 | 状态 | 一句话证据 |
|---|------|------|-----------|
| 1 | 拆 cap.guard.ts（装饰器进 barrel，类走子路径） | ✅ | worker 闭包 **816 → 709** 个 .ts；cap.service.ts 的 importer **3 → 0** |
| 2 | 抽 AppCoreModule + AppTechCoreModule + SocketCoreModule，worker 改 import | ✅ | AppModule 的 imports 一行未动；api 的 openapi.json **整文件逐字节相同** |
| 3 | 三条新 spec（G1/G2/G3） | ✅ | 改造前 G1 4/5 红、G3 3/6 红、G2 绿（D1 不动 guard，见 §4.1）→ 改造后 16/16 绿 |
| 4 | 全量验收 | ✅ | test **93 文件 / 782 条**（基线 90/766）、types:check 0 输出、lint 0 error、boundaries 0 |
| 5 | 运行期实证 | ✅ | worker 起得来 **cron jobs: 7**；**.data 目录根本没被创建**；SecurityCapService / Throttler 日志 0 命中 |
| 6 | dev:worker + README + CI 判据 | ✅ | nest build worker -c infra/nest/dev.json 通过；CI 加「种过期 token → worker 启停 → stat+sha256 前后必须相同」 |

**三条会改变下一步动作的结论**：

**H1′（更正 R1 草案）—— R1 §4.2 的 core 模块清单漏了两个 @Global 端口绑定，照着写 worker 起不来。**
我先按 R1 草案写完 AppCoreModule，**真起 worker 才发现 DI 报错**（静态分析看不出来）：
① SysLogAuthSharedService 第 4 个参数 WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR 无人绑定 ⇒ 要加 SecurityRiskModule；
② 修完又炸 WalnutAdminInterceptorResponseEncrypt 缺 SecurityRsaService ⇒ 要加 SecurityRsaModule。
两处都必须走**子路径**（@walnut-server/security/risk/risk.module），因为 @walnut-server/security 这个 barrel 本身就导出 cap.service —— 走 barrel 会让 G1 立刻变红。

**H2′（R1 G1 的第三条判据在本批做不到）—— @nestjs/throttler 清不出 worker 闭包。**
残余来自 libs/auth/src/index.ts:62 导出 otp-throttle.guard.ts（passport OTP mixin guard，extends ThrottlerGuard）。切断它要动 auth barrel，超出本批「不搬 guard」的范围。
⇒ 我把 G1 这条改成**可达成且更精确**的形态：ThrottlerModule 的**注册面**（libs/throttle/src/throttler.module.ts）必须不在闭包里（已达成，1 → 0），并把残余 importer **精确钉死为 2 个文件**（4 → 2，再多一个就红）。
危害等级不同：@nestjs/throttler 顶层只有类定义，没有文件 / 信号副作用；真正有害的是 ThrottlerModule.forRootAsync 的注册（已拦掉）。

**H3′（工具限制，已在 spec 里补偿）—— 模块图走查穿不过 barrel。**
walkModuleGraph 只在「imports 里的标识符能在同文件解析到 @Module 类」时往下走，遇到 @walnut-server/xxx（指向无 @Module 声明的 index.ts）就断。对 G2（顺序）够用（enhancer 只注册在两个文件里），对 G3（深度隔离）不够。⇒ G3 增加一条**文件级 import 闭包**断言（与 G1 同一解析器，穿 barrel、穿 re-export），并把「api 入口必须命中它们」作为反证防空转。

---

## 1. 先定判据（后面所有断言都按这个口径）

| 编号 | 判据 | 机械形态 |
|------|------|----------|
| **J1** | **模块求值级**隔离（拍板 D2） | 从 apps/worker/src/main.ts 出发、按 tsconfig.json 的 paths 解析每条 import / export-from / require，得到「运行期会被 require 的 .ts 集合」。文件在集合里 = 它的顶层代码会执行 ⇒ 对 cap.service.ts 就是 new Cap() |
| **J2** | **12 元黄金序列**（拍板 D1） | 模块前序 DFS（根模块先于 imports）× 模块内 providers 数组序，摊平 APP_GUARD 的 useClass 名 |
| **J3** | **openapi 差异预算**（拍板 D3） | 允许 paths **顺序**变；paths 排序后序列化必须**逐字节相同**，components 必须**逐字节相同**，operation 集合必须相同 |

判据写成 spec 而不是「人工看一眼」，是为了让下一批（阶段 2 搬 12 条 guard）有机械对照，而不是靠记忆。

---

## 2. 第一步：拆 cap.guard.ts

### 2.1 变更面（4 个文件，其中 1 个新增）

| 动作 | 文件:行 | 内容 |
|------|---------|------|
| 新增 | libs/guards/src/guards/cap.decorator.ts:1-33 | WalnutAdminConstDecoratorCapFreeKey（改为 export，guard 与装饰器共用同一真源）+ isWellFormedCapJsToken + WalnutAdminGuardCapFree。**零 @walnut-server/security 依赖** |
| 删（搬走） | libs/guards/src/guards/cap.guard.ts 原 :25-46 | 上述三件整体迁出 |
| 增（引入） | libs/guards/src/guards/cap.guard.ts:24 | import { isWellFormedCapJsToken, WalnutAdminConstDecoratorCapFreeKey } from './cap.decorator'；SetMetadata 从 @nestjs/common 的 import 里摘掉 |
| 改 barrel | libs/guards/src/index.ts:31-34 | export * from './guards/cap.guard' → export * from './guards/cap.decorator'（含 3 行理由注释） |
| 改注册处 import | apps/api/src/app/app.module.ts:8,11 | 类从 barrel 的具名导入里摘掉，改 import { WalnutAdminGuardCap } from '@walnut-server/guards/guards/cap.guard'。**两条 APP_GUARD 注册字面量一字未动**（:110 / :126） |

> 子路径 @walnut-server/guards/guards/cap.guard 不需要新增映射：tsconfig.json:223-225 早已有 @walnut-server/guards/*。

### 2.2 实测：闭包变化（我自己的走查器，方法论同 R1 §2.3）

| 指标 | 改造前（实测） | 改造后（实测） |
|------|---------------|---------------|
| worker 闭包 .ts 文件数 | **816** | **709** |
| libs/security/src/cap/cap.service.ts ∈ 闭包 | **是** | **否** |
| cap.service 的 importer 数 | **3** | **0** |
| libs/guards/src/guards/cap.guard.ts ∈ 闭包 | 是 | **否** |
| libs/throttle/src/throttler.module.ts ∈ 闭包 | 是 | **否** |
| @walnut-server/throttle 的 importer 数 | 1 | **0** |
| @nestjs/throttler 的 importer 数 | 4 | **2**（钉死，见 H2′） |
| import guards barrel 的文件数 | **56** | **10** |
| controllers ∈ 闭包 | 47（R1 测） | **9** |
| *.guard.ts ∈ 闭包 | 26（R1 测） | **19** |
| @Module 文件 ∈ 闭包 | 134（R1 测） | **116** |
| apps/api/src/socket/socket.gateway.ts ∈ 闭包 | 是 | **否** |
| apps/api/src/middleware/middleware.module.ts ∈ 闭包 | 是 | **否** |
| apps/api/src/app/app.module.ts ∈ 闭包 | 是 | **否** |

改造前的最短链（实测，与 R1 §2.3 逐字一致）：

```
apps/worker/src/main.ts -> apps/worker/src/worker.module.ts -> apps/api/src/app/app.module.ts
  -> libs/guards/src/index.ts -> libs/guards/src/guards/cap.guard.ts
  -> libs/security/src/cap/cap.service.ts
```

改造后剩下的 10 个 barrel importer（全是 controller / 1 个 guard，都因 **libs/app-domain 的 barrel** 被带进来，不是因为模块 import）：

```
libs/app-domain/src/{demo/demo,error/error,key/key,logger/logger,monitor/cache/cache,
  monitor/server/server,setting/setting,shared/ali/ali,shared/area/area}.controller.ts
libs/app-domain/src/key/key.current.guard.ts
```

⇒ 这是**下一层**的同类问题（app-domain barrel 把 9 个 controller 拉进 worker），不是 CAP 问题；CAP 已经彻底出图。登记在文末「需要 Lead 拍板」的 D-D，不在本批动。

### 2.3 「从 barrel 取装饰器的文件仍能编译」的证明

- 全仓 import @walnut-server/guards 的源文件 **56 个**（含 barrel 消费者）；
- 用 WalnutAdminGuardCapFree 的 controller **8 个**（setting / sign / rsa / cap / monitor-user / locale / lang / device）—— 一个都没改；
- cmd /c "pnpm --filter @walnut/server types:check" **0 输出**（strict 全绿）；
- pnpm test **93 文件 782 条**全绿（含 cap.guard.spec.ts / cap.service.spec.ts，mock 面未受影响 —— 前者 mock 的是 @walnut-server/security/cap/cap.service，本来就不是同文件）。

---

## 3. 第二步：抽 AppCoreModule 并给 worker 换入口

### 3.1 三个新模块

| 文件 | 类 | 内容 | 判据 |
|------|----|------|------|
| apps/api/src/app/core.module.ts:51-102 | AppCoreModule | 21 项 imports（下表） | 两进程都要的业务 / 基础设施 |
| apps/api/src/modules/techniques/tech-core.module.ts:41 | AppTechCoreModule | cache / redis / cookie / crypto / event / lock / queue / sse / task | 恰好比 AppTechModule 少 health + throttler（G3 逐项对账） |
| apps/api/src/socket/socket-core.module.ts:24 | SocketCoreModule | @Global + 只有 SocketService | D4：两个 @Global 端口实现注入它，但 gateway / adapter 只在 api 装配 |

**AppCoreModule 的 imports**（apps/api/src/app/core.module.ts:52-101）：

```
WalnutConfigModule · WalnutContextModule · AppI18nModule · WalnutModule · AppScheduleModule
AppTechCoreModule · SocketCoreModule
SysAuthModule（auth 数据面；HTTP 那半是 app 的 AuthModule）
SysDeviceKickModule（@Global 端口：WALNUT_ADMIN_SYSTEM_DEVICE_KICKER）
AppErrorModule（Bull ERROR processor）· AppMonitorUserModule · AppMonitorUserSharedModule
AppSettingsModule · AppKeyModule · AppLoggerModule
WalnutAdminDataScopePolicyModule（@Global 端口：WALNUT_ADMIN_DATA_SCOPE_POLICY）
SysSystemModule · SysIdentityModule
SecurityRiskModule（@Global 端口 ×2，子路径引入）
SecurityRsaModule（@Global：SecurityRsaService）
SharedModule
```

### 3.2 为什么 AppModule 一行 imports 都不动（而 AppTechModule 也不改）

- apps/cli/src/export-openapi.ts 依赖**全量** AppModule（await app.init() 后才 assemble document）⇒ 把 AppModule 变薄 = openapi 立刻丢路径。**worker 换入口，不是 api 减配**。
- AppTechModule 的第 6 位是 AppTechHealthModule。若改成 [AppTechCoreModule, health, throttler]，health 会从第 6 位掉到末尾 ⇒ RouterExplorer 的模块遍历序变 ⇒ openapi.json 的 paths 顺序平白多一段 diff。**两份名单 + 一个子集守卫**比「一份名单 + 顺序抖动」便宜。
- 代价是「名单重复」。用 G3 机械守：AppTechCoreModule.imports ⊂ AppTechModule.imports，且差集**必须恰好是** {AppTechHealthModule, AppTechThrottlerModule}。

### 3.3 worker.module.ts 的改动（apps/worker/src/worker.module.ts:4,39）

只换了入口（AppModule → AppCoreModule）+ 重写头注释。AppBootstrapTaskModule 与 isWorkerStandalone() 条件注册 ScheduleModule 原样保留（cron 归属语义不变）。

### 3.4 实测发现的两处 DI 缺口（R1 草案漏项）

| 报错 | 缺的端口 | 根因 | 修法 |
|------|---------|------|------|
| Nest can't resolve dependencies of the SysLogAuthSharedService (Reflector, SysLogAuthRepoService, SharedIpService, ?) | WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR | 只在 libs/security/src/risk/risk.module.ts:39 绑定（@Global） | core 加 SecurityRiskModule（同时带来 WALNUT_ADMIN_AUTH_RISK_SERVICE） |
| Nest can't resolve dependencies of the WalnutAdminInterceptorResponseEncrypt (Reflector, ?) | SecurityRsaService | SharedAliModule 的 controller 用了 @WalnutAdminDecoratorCrypto | core 加 SecurityRsaModule（@Global；密钥经 WALNUT_ADMIN_KEY_STORE 由 AppKeyModule 绑定，已在 core） |

两次报错都在**运行期**才暴露，静态走查看不出来 —— 这正是「必须真起一次」的证据。修完后 DI errors = 0。

---

## 4. 三条新 spec（改造前先跑，留红证据）

三个文件都在 apps/server/apps/api/src/common/monorepo/，形态对齐既有 lib-registration.drift.spec.ts：纯 fs + 正则，**零装载**（绝不在 spec 里 import AppModule —— 那会在求值期 new Cap()，用「会触发副作用的动作」去断言「副作用不存在」是自欺）。

| 文件 | 覆盖 | 关键断言 |
|------|------|---------|
| worker-import-closure.drift.spec.ts（G1，5 条） | J1 | 5 个 CAP 文件不在 worker 闭包 · throttler.module.ts 不在 · gateway / adapter / socket.module 不在 · middleware / swagger.document / app.module / export-openapi 不在 · **反证**：同一走查器对 api 入口必须命中 CAP 与 gateway（防空闭包全绿）· @nestjs/throttler importer 精确 = 2 个文件 |
| guard-order.drift.spec.ts（G2，4 条） | J2 | 12 元黄金序列逐位相等 · 第 12 位来自 tech.module.ts · 反证：只看 root 只能数到 11 条 · CAP 两条分别在 JWT 前后 |
| core-module-scope.drift.spec.ts（G3，7 条） | J2+J3 派生 | core 闭包 ∩ HTTP-only 集合 = ∅（**模块级 + 文件级两条**）· core 里 APP_GUARD 计数 = 0 · tech-core 差集恰为 health+throttler · socket-core 不含 gateway · AppModule 未改引 core |
| module-graph.ts（辅助，非 spec） | — | 静态解析 tsconfig paths / @Module 元数据 / 前序 DFS / 文件级闭包。cwd 口径同既有 drift spec（vitest test.root: './'） |

### 4.1 改造前的红/绿（负对照，实测）

```
apps/api/src/common/monorepo/guard-order.drift.spec.ts          (4 tests) ✓ 全绿
apps/api/src/common/monorepo/worker-import-closure.drift.spec.ts (5 tests | 4 failed) ✗
  ✓ 走查器有牙：api 侧…必须命中 CAP 求值链
  × worker 闭包仍然装着它该有的东西     ← core.module.ts 还不存在
  × 隔离：CAP 求值链完全不在 worker 闭包 ← 链打到 cap.service.ts
  × worker 不装配 Throttler…             ← 链打到 throttler.module.ts
  × @nestjs/throttler 残余钉死           ← 当时是 4 个 importer
apps/api/src/common/monorepo/core-module-scope.drift.spec.ts     (6 tests | 3 failed) ✗
  × 入口存在且不是空模块                 ← core.module.ts 不存在
  × tech-core 是 AppTechModule 的子集    ← tech-core.module.ts 不存在
  × socket-core 只给 SocketService…      ← socket-core.module.ts 不存在
```

**G2 改造前就是绿的，这是设计而非疏漏**：拍板 D1 =「12 条 guard 一条不动」，所以改造前后它都该绿 —— 它守的是「下一批搬家时顺序别错」，不是「本批要变红」。本批真正的负对照是 G1 / G3（今天必红、改完转绿）。

### 4.2 改造后（16/16 绿）+ 变异测试证明 G1 有牙

把 libs/guards/src/index.ts 临时改回 export * from './guards/cap.guard'（= 回退第一步），G1 立刻变红，且打出精确链：

```
× 隔离：CAP 求值链完全不在 worker 闭包里（D2 模块求值级）
  libs/security/src/cap/cap.service.ts 不应出现在 worker 闭包里，实际链：
  apps/worker/src/main.ts -> apps/worker/src/worker.module.ts -> apps/api/src/app/core.module.ts
    -> libs/app-domain/src/index.ts -> .../demo.controller.ts -> libs/guards/src/index.ts
    -> libs/guards/src/guards/cap.guard.ts -> libs/security/src/cap/cap.service.ts
```

已回滚。⇒ G1 不是空转。

---

## 5. 验收（全部真跑，cwd 口径写死）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 单测 | cmd /c "pnpm --filter @walnut/server test" | **93 文件 / 782 条 全绿**（基线 90 / 766；+3 文件 +16 条 = 三条新 spec） |
| 类型 | cmd /c "pnpm --filter @walnut/server types:check" | **0 输出**（strict） |
| Lint | cmd /c "pnpm --filter @walnut/server lint" | **0 error**；2 条 warning 是**存量**（libs/repository/src/pg-list.builder.spec.ts:453,474，本批未碰） |
| 边界 | cmd /c "pnpm boundaries" | 4672 files / 15 packages，no issues |
| openapi | cmd /c "pnpm --filter @walnut/server openapi:export" | ✅ 见 §5.1 |

### 5.1 D3 判据（openapi）—— 结果比要求更强

| 检查项 | 结果 |
|--------|------|
| 整文件 sha256 | **相同**（65d54c73…859150，1008460 字节） |
| paths 条数 | 173 → 173 |
| paths 键集合 | 相同（两个方向差集均空） |
| paths **顺序** | **也相同**（D3 允许它变，实际没变） |
| paths 排序后序列化 | **逐字节相同** |
| components | **逐字节相同**（规范化后各 133973 字节） |
| operation 集合 | 195 → 195，完全相同 |
| components.schemas 条数 | 202 → 202 |
| git status 里的 openapi.json / packages/generated/api-types | **无改动**（所以 openapi:check:export 的 git diff --exit-code 会过） |

⇒ 本批**没有**任何 paths 顺序变化，D3 的「只允许顺序变」这条额度一个字节都没用掉。

---

## 6. 运行期实证（R1 判为「无法执行」，本轮实际跑了）

### 6.1 worker 双启动冒烟：起得来 + 不碰 CAP 存储

判据取自 R1 §5.1 的 G4（把 .data 挪走 → 起 worker → 该目录必须仍不存在），在 apps/server 下、NODE_ENV=development WORKER_STANDALONE=true WALNUT_ADMIN_BOOTSTRAP_TASKS=off 跑 dist/apps/worker/src/main.js：

```
cronRegistered    = True
processExited     = False
dataDirAfterStart = False          ← 决定性：.data 根本没被创建
DI errors         = none
cron line = worker process started (no HTTP listener); cron jobs: 7
            [AppInitSettingsTask, SystemInitLocaleMessageTask, AppAuthDeleteRefreshTask,
             AppRotateKeyTask, SystemUpdateDeviceActiveStatusTask, AppAuthMfaSetupTask,
             AppAuthDeleteRefreshPgPurgeTask]
SecurityCapService hits = 0
Throttler hits          = 0
```

7 个 cron 与 README 记录的历史值一致 ⇒ 换入口**没有丢任务**。SecurityCapService / Throttler 两条日志 0 命中 ⇒ R1 §5.1 的 G3（日志判据）也过了。

> 跑完已把 .data 原名恢复（脚本 finally 里做的），工作树无残留。

### 6.2 证明「CI 的 .data 判据不是空过」（cap.js 副作用探针）

D6 要的判据是「.data 的 mtime 不因 worker 启停而变」。**空文件会让它空过**，所以在 CI 里**种一条已过期的假 token**（{"deadbeef:0123456789abcdef":1}），再比 stat(%Y %s) + sha256。
为什么这条能咬住：@cap.js/server@4.0.5/index.js 的 cleanup() 会删过期项并整份写回（:505-506 判过期、:545-565 写回）。
本地实测（Windows 送不了真 SIGTERM，所以让子进程 process.emit('SIGTERM') 触发 cap.js 自己注册的处理器 —— 同一代码路径）：

```
BEFORE  content="{\"deadbeef:0123456789abcdef\":1}"  mtime=2026-11-03T04:45:22.350Z
emitting SIGTERM (cap.js registered its handler at construction time)
AFTER   content="{}"                                 mtime=2026-11-03T04:45:22.463Z
STORE CHANGED = true
```

⇒ 只要 worker 里还有 new Cap()，这一步必红。（Windows 上 Stop-Process 是硬杀、走不到钩子，README 已注明。）

---

## 7. dev:worker / README / CI

| 项 | 位置 | 说明 |
|----|------|------|
| dev:worker 脚本 | apps/server/package.json:29 | cross-env NODE_ENV=development WORKER_STANDALONE=true nest start worker --watch -c infra/nest/dev.json，与 dev 同画像。**已验证目标可用**：nest build worker -c infra/nest/dev.json 成功编译 867 文件（dev.json 的 projects 里有 worker）。**未**真起 watch 进程（长跑进程不留） |
| README | apps/worker/README.md | ①「它是什么」改成 AppCoreModule 并说明与 AppModule 的分工；② 命令块加 pnpm dev:worker +「双启动 = 两个终端各一条」；③ 冒烟段加 D6 判据（种过期 token / 判据 / 本机 bash 复现 / Windows 用 Get-FileHash）；④ 末尾文件表列出 6 个入口模块谁给谁 + 三条 spec |
| CI | .github/workflows/ci.yml:433-445, 463-475 | 在既有「Worker smoke (cron registered)」步里加两段：起 worker **前**种过期 token + 记 data_before；SIGTERM 收场**后**比 data_after，不等就 ::error:: + exit 1。判据：stat -c '%Y %s' + sha256sum 前后逐字节相同 |

> ⚠️ **CI 这一段本轮无法在本机执行**（要 GitHub runner 的 PG/Redis service 与 ubuntu 的 stat / touch -d）。它的**机制**已在 §6.2 本地证伪过（有牙），但「YAML 语法 + runner 上真跑通」要等第一次 CI 才见分晓 —— 已登记为待观察项。

---

## 8. 与 R1 的偏差（3 条，都给了证据）

| # | R1 说 | 实际 | 处理 |
|---|-------|------|------|
| 1 | §4.2 的 core 清单靠静态分析给出 | 照着写 worker **起不来**（两个 @Global 端口缺绑定） | 补 SecurityRiskModule + SecurityRsaModule（§3.4）。**R1 的清单不是错，是不完整** —— 它自己也标注了「未真起进程」 |
| 2 | G1 判据 = 闭包不含 cap.service.ts / @nestjs/throttler / socket.gateway.ts | 前两条达成，第三条**做不到**（auth barrel 导出了继承 ThrottlerGuard 的 otp guard） | 改成「注册面不在闭包里」+ 残余 importer 精确钉死 2 个（H2′）。要彻底清得动 libs/auth/src/index.ts:62 |
| 3 | §5.1 G3/G4/G5「本机无法执行（无 5432/6379）」 | PG / Redis 都通 | **全部真跑了**（§6、§5.1）。R1 的环境判断不成立 |

另补一条 R1 没提的工具事实：模块图走查**穿不过 barrel**（H3′），G3 因此加了文件级闭包断言。

---

## 9. 没做 / 没验证（划清边界）

1. **没搬任何一条 guard**（D1）：app.module.ts:89-145 的 11 条与 tech.module.ts:34-37 的第 12 条，行号与顺序都未变（G2 逐位对账）。
2. **没动 api 侧 AppModule.imports**：16 项一字未变（只有第 8 行的 import 来源从 barrel 改子路径）。openapi 整文件逐字节相同是这件事的副产品证据。
3. **没做 cap.js 分布式存储**（触发条件已登记，与本批无关）。
4. **没碰 apps/server/db**。
5. **没跑** test:integration / test:e2e（guard-matrix.api-spec.ts 属 integration 配置）—— 要完整迁移态的库，本机库未必是那个状态。**guard 链的行为级证据本批是缺的**（R1 §5.3 第 3 步）；但它守的是「顺序没被破坏」，而本批根本没动顺序（G2 + diff 双证）。
6. **没真起 pnpm dev:worker 的 watch 进程**（只验证了它的 nest 目标可编译）。
7. **app-domain barrel 仍把 9 个 controller 拉进 worker**（§2.2）：不是 CAP，属下一层优化，未动。
8. **CI 新增段未在真 CI 跑过**（§7）。

---

## 需要 Lead 拍板

**D-A —— @nestjs/throttler 的残余要不要清？（卡住「G1 字面判据」是否算达标）**
现状：worker 闭包里还有 2 个 importer，来源是 libs/auth/src/index.ts:62 导出 otp-throttle.guard.ts（extends ThrottlerGuard）。它**没有**文件 / 信号副作用，危害与 CAP 不同级。
- (a) 接受现状（已用 spec 把残余钉死为 2 个文件，再长就红）—— 我倾向这个，成本 0；
- (b) 把 otp-throttle.guard.ts 也拆成「常量/装饰器（barrel）+ 类（子路径）」，与 cap 同款。成本：动 auth barrel，得重新确认 auth 侧的 barrel 消费者（本批没统计过对应数字，有风险）；
- (c) 上升成「所有继承 HTTP 基类的 guard 类都出 barrel」的通用规则 —— 那是另一批的事。

**D-B —— 两条 CI 判据的归属（卡住「谁保证 worker 起得来」）**
本轮实测证明：**静态分析查不出 DI 缺口**（§3.4 两个端口都是真起才炸）。现有 CI 的 cron jobs: N 断言**恰好**能抓住这类回归（少一个 provider 就 cron=0 或进程直接退出）。要不要把它从「openapi job 末尾的一步」提升为**独立 job**，并显式支持「DI 报错 = 红」（现在已经是红，但语义埋在一句 grep 里）？

**D-C —— 阶段 2 的 openapi 额度（D3 已给，本批一字节没用）**
本批 api 图零改动 ⇒ openapi 整文件逐字节相同。阶段 2 搬 12 条 guard 时 paths 顺序**会**变，届时 openapi:check:export（git diff --exit-code）必然红。
- (a) 阶段 2 允许改 openapi.json，并把「排序后相同 + components 逐字节相同」做成**第 4 条 drift spec**（判据脚本本批已跑通，落成 spec 很快）；
- (b) 阶段 2 想办法保住 paths 顺序（代价：core/http 二分不能整块排，得逐槽位插，施工复杂度上升）。
需要你定 (a) 还是 (b)，以及是否现在就把那个校验器写进 spec。

**D-D —— app-domain barrel 的 9 个 controller（下一层）**
worker 闭包 709 个文件里仍有 9 个 controller、10 个 barrel importer，全部来自 libs/app-domain/src/index.ts 的 re-export（core 只 import 了它的 5 个模块，却顺带求值了整个 barrel）。与 CAP 无关，但同一类问题。要不要开一条「libs barrel 按需子路径化」的独立条目？（本批按「不做」处理，未动。）
