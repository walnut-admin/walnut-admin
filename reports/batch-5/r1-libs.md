# 批次 5-A · server libs 结构债（D11 / D12 / D10）

> 执行：b5-r1-libs（全新实施 agent，未参与 D10–D12 的前序调研）
> 基线：HEAD `07dacfd6`，**开工时工作树 clean**（`git status --porcelain` 空）
> 范围：`apps/server/libs/**` + 后端口径文档（`apps/server/AGENTS.md`、`apps/docs/src/zh-CN/content/backend/*`、ADR 0022）
> 不在范围：devices/monitor（另一批）、seed 重建（另一批，见 §1.2）、dependency-cruiser
> **未做 git commit**（按要求）

---

## 0. 结论

| 项 | 结果 | 一句话证据 |
|---|---|---|
| **D11 锁端口化** | ✅ 完成 | 源码扫描里真正的 murlock import 只剩 `libs/lock`；10 处消费方只注入 `WALNUT_ADMIN_LOCK`；**4 个 guard 的 spec 一行未改**且全绿；新增 2 个守卫 spec（全仓扫描 + 适配器委托） |
| **D12 cache 域缓存显式化** | ✅ 完成 | 8 个文件改名 `<domain>.cache.ts`（+2 个同名 spec），**零代码移动**；ADR 0022 新增 Decision 5（四条准入判据 + 11 行登记表）；`cache.*.ts` 与 `<domain>.cache.ts` 两种前缀的口径写死 |
| **D10 三模式 → 两模式** | ✅ 文档 + 3 个落点 | AGENTS.md / architecture.md / transactions.md / README / 根 AGENTS / ADR 0022 全部改口；按新判据撤 3 个 @Global；新增 1 个机械守卫 spec（**变异测试证明它有牙**） |
| **门禁** | 4 绿 / 2 条被并行批次污染 | 单测 **90 files / 766 tests** 绿；types 绿；我改的文件 lint 绿；`openapi:export` **字节零 diff**；docs 四道绿。boundaries 与全量 lint 的红**全是并行批次的**（§6 逐条归因） |

---

## 1. 环境、基线、以及「工作树里有别人」

### 1.1 基线（我开工时自己跑的）

~~~text
$ cmd /c "pnpm --filter @walnut/server test"
 Test Files  86 passed (86)
      Tests  753 passed (753)          # 与任务书给的 86/753 一致
$ git log --oneline -1
07dacfd6 feat(contract): filters wire 的联动收尾（...）
$ git status --porcelain
(空)
~~~

### 1.2 中途工作树被两个并行批次改了（**不是我改的**）

开工十几分钟后 `git status` 出现了不是我改的条目，形态可分两批：

| 批次 | 被改的东西 |
|---|---|
| seed 重建（D5） | `apps/server/db/seed/*.json`（8 个 M + 2 个 ??）、`packages/tooling/scripts/{package.json,src/db/*.ts,bin/db-seed-reshape.ts,bin/db-verify-seed.ts,src/ci/check-seed.ts}`、删 `src/db/seed-map.ts` 及其测试、根 `package.json` |
| locale 改名（D16） | `libs/system/src/locale/dto/locale.dto.ts`、`libs/system/src/locale/repo/locale.repo.service.ts`、新增 `libs/system/src/locale/locale.list-row.spec.ts`、`apps/server/openapi.json`、`packages/generated/api-types/*`、`apps/admin/src/views/system/locale/index.vue` |

后果（已在 §6 逐条归因）：`pnpm boundaries` 扫到 seed 批次留在 `apps/server/.tmp/` 的**整棵仓库拷贝**；`pnpm lint` 的 3 个 error 全在 locale 批次的文件里。**我没有碰这些文件**，也没有回滚它们。

---

## 2. D11：分布式锁端口化

### 2.1 改造前的事实（复核，不是照抄任务书）

~~~text
$ git grep -n "from 'murlock'"        # 改造前
libs/app-domain/src/shared/area/area.service.ts:8
libs/guards/src/guards/{cap,device,lock,sign}.guard.ts
libs/security/src/risk/modules/{device,failedLogin,location,user,user_device}.service.ts
libs/lock/src/lock.module.ts:3        # MurLockModule（装配，正常）
~~~

10 处业务代码直连 vendor；`libs/lock` 里**只有** `AppTechLockModule`（22 行，只 import MurLockModule，不导出任何端口）。
两套锁并存：`libs/cache/src/service/cache.cron-lock.ts`（173 行自研）vs murlock。

### 2.2 做法（4 个新文件 + 1 个改造 + 10 处改注入）

| 文件 | 作用 |
|---|---|
| `apps/server/libs/lock/src/lock.port.ts:26` | `WALNUT_ADMIN_LOCK` token；`:35` `WalnutLockService` 接口（`runWithLock<T>(key, releaseTimeMs, fn)`，`:46`） |
| `apps/server/libs/lock/src/murlock.adapter.ts:20` | `MurLockAdapter implements WalnutLockService`，纯委托（3 参重载原样转给 murlock） |
| `apps/server/libs/lock/src/lock.module.ts:16,33-37` | `@Global()` + `{ provide: WALNUT_ADMIN_LOCK, useExisting: MurLockAdapter }`，只导出 token |
| `apps/server/libs/lock/src/index.ts:2` | 只对外暴露 token + 接口（**适配器不导出**，消费方无法绕过端口） |

10 处消费方统一改成：

~~~ts
constructor(
  @Inject(WALNUT_ADMIN_LOCK) private readonly lockService: WalnutLockService,
) {}
await this.lockService.runWithLock(lockKey, 3000, fn)
~~~

- 字段名 `murLockService` → `lockService`（vendor 名字不再出现在业务层）；
- 调用点语义零变化：仍是 3 参、ttl 值原样（3000 / 200）、临界区代码一行未动；
- **4 个 guard 的 spec 未改一行**（它们按位置 `new WalnutAdminGuardX(...)` 注入 mock `{ runWithLock }`，端口方法名与签名和 murlock 一致 ⇒ 天然兼容）。这是「行为不变」最硬的证据（`git status` 对 4 个 spec 为空）。

`@Global` 是**新增**的 DI 可见性（改造前 `AppTechLockModule` 只在 `apps/api/src/modules/techniques/tech.module.ts:24` 被 import）。理由写在 `lock.module.ts:11-14`：绑定跟随实现（ADR 0022 Decision 3），消费方跨 guards / security / app-domain 三层。可见性只增不减 ⇒ 不会让任何现存注入失效；`openapi:export` 会真的 bootstrap 整个 AppModule（日志里有 `Nest application successfully started`）⇒ DI 图已验证。

### 2.3 cron 单实例锁**保留自研**（不并入端口）

| | `AppTechCacheCronLockService`（保留） | `WalnutLockService`（新端口） |
|---|---|---|
| 语义 | 非阻塞 try-lock：拿不到就**跳过本次 tick** | 阻塞等待直到拿到锁 |
| Redis 故障 | **fail-open** 照跑（三条路径：命令异常 / 抢锁超时 / 键被占，前两条执行且标记 abandoned 不释放） | 由实现决定（murlock `failFastOnRedisError: false`） |
| 释放 | Lua 原子比对删除 + 1s 释放超时 | murlock 内部 |
| 消费者 | `@Cron` 入口（api / worker 二选一，ADR 0025） | 请求链路的临界区（防缓存击穿） |

合并会把 fail-open 的三条路径压成一条 —— 这正是 ADR 0025 的兜底口径，所以**保留两套实现、只做一个端口**：端口覆盖「阻塞互斥」，cron 锁继续自研。这段理由已写进 ADR 0022 Decision 3 末段与 `lock.port.ts` 头注释。

### 2.4 验收实测

~~~text
# ① 已跟踪文件（git grep 看不到未 add 的 adapter，这是它唯一的盲区）
$ git grep -n "from 'murlock'" -- apps/server
apps/server/libs/lock/src/lock.module.ts:3:import { MurLockModule } from 'murlock'

# ② 全树扫描（跳过 node_modules/dist/点开头目录 ⇒ 跳过并行批次的 .tmp）
真正的 import 行：libs/lock/src/lock.module.ts:3 · libs/lock/src/murlock.adapter.ts:3   （2 处，都在 libs/lock）
其余 `from 'murlock'` 命中都是注释（lock.port.ts:8,23 与两个 spec 在解释规则）

# ③ 消费方
$ git grep -l "@Inject(WALNUT_ADMIN_LOCK)" -- apps/server   # 10 个文件
libs/app-domain/src/shared/area/area.service.ts
libs/guards/src/guards/{cap,device,lock,sign}.guard.ts
libs/security/src/risk/modules/{device,failedLogin,location,user,user_device}.service.ts
~~~

新增两道守卫（都进单测，**不靠 review**）：

- `apps/server/libs/lock/src/murlock-isolation.drift.spec.ts`（4 条）：① 全仓真正的 vendor import 只在 `libs/lock`；② `libs/lock` 内部触碰点恰好 2 个（adapter + module）；③ 注入 `WALNUT_ADMIN_LOCK` 必须带 `@Inject(...)`（Symbol token 漏装饰器只在运行时炸，类型系统看不见）；④ 消费方清单锁死为 10 个。
- `apps/server/libs/lock/src/murlock.adapter.spec.ts`（3 条）：透传 `(key, ttl, fn)`、返回临界区结果、临界区/锁实现抛错原样传播（适配器不许自己加重试或吞错）。

---

## 3. D12：cache 域缓存显式化（零代码移动）

### 3.1 改名清单（`git mv`，内容零改动）

~~~text
libs/cache/src/service/cache.appSettings.ts    → appSettings.cache.ts    (+ spec 同名)
libs/cache/src/service/cache.cap.ts            → cap.cache.ts            (+ spec 同名)
libs/cache/src/service/cache.device.ts         → device.cache.ts
libs/cache/src/service/cache.mfa.ts            → mfa.cache.ts
libs/cache/src/service/cache.opaque.ts         → opaque.cache.ts
libs/cache/src/service/cache.permissions.ts    → permissions.cache.ts
libs/cache/src/service/cache.sign.ts           → sign.cache.ts
libs/cache/src/service/cache.verifyCode.ts     → verifyCode.cache.ts
~~~

只改了 4 处 import 面：`libs/cache/src/cache.module.ts:5-15`、`libs/cache/src/index.ts:7-17`、`cap.cache.ts:6`（内部依赖 appSettings）、两个 spec 的相对 import。另有 6 处**过期的路径引用**顺手订正（`libs/const/src/app/cap.spec.ts:18,22`、`libs/system/src/data-scope/data-scope.service.ts:125`、`apps/api/test/integration/auth.login-chain.pg.int-spec.ts:261`、`apps/api/test/api/DESIGN-ISSUES.md:109,304`、`DESIGN-ISSUES-ARCHIVE.md` 4 处 —— 后者是 `pnpm lint:docs-refs` 逼出来的，**改名前它是绿的**）。

### 3.2 ADR 0022 新增 Decision 5（登记「允许的例外」+ 判据）

`apps/docs/src/zh-CN/content/adr/0022-backend-lib-layering-and-composition-roots.md` 的 Decision 5 写了两样东西：

**准入判据（四条全满足才允许域缓存住在 `libs/cache`）**

1. 零数据面依赖：只经 `AppTechCacheService` 做「键 + 值 + TTL」，不注入仓储 / DataSource、不调外部 API、不 import 任何域的 entity / DTO；
2. 键前缀已在 `libs/const/app/cache` 登记（域知识 = 常量字面量，不是代码结构）；
3. 无跨缓存编排（一个方法只碰一个键空间；出现「读 A 写 B」就归域）；
4. 不满足就必须**离开** `libs/cache`（`libs/<domain>/shared/<x>.cache.service.ts`，跨层时按 Decision 3 端口化）—— 「再登记一条例外」不是出口。

**登记表**（11 行：8 个已改名 + `cache.lock` / `cache.rsa` / `cache.cron-lock`），并写清两条容易反复的读法：

- 命名：`<domain>.cache.ts` = 已登记域缓存；`cache.*.ts` = 技术信封（通用缓存 / Redis / 配置 / 单实例锁 / 原始值）。同目录两种前缀是**有意的**：`cache.lock`（布尔）/ `cache.rsa`（PEM 串）的值是原始类型，缓存层不解释它 —— 下次动这两个文件时一并改名。
- **消费库数不是门槛**：`cap` / `opaque` 只有 1 个消费库，但满足判据 1–3 且键 / TTL 由域规则派生（cap.js 20 分钟窗口、OPAQUE 会话），登记为「下一轮可评估下沉的候选」。这条特意写进去，否则下次评审一定会问「8 个里为什么有 2 个只有单消费者」。

### 3.3 验收实测

~~~text
$ cmd /c "pnpm exec vitest run ... libs/cache"      # 8 files / 33 tests 全绿（含 rename 后的两个 spec）
$ cmd /c "pnpm types:check"                          # exit 0
$ cmd /c "pnpm exec eslint libs/cache"               # exit 0
$ cmd /c "pnpm lint:docs-refs"                       # ✅ 没有引用不存在的包名或路径（修完 4 处过期路径后）
~~~

**为什么没做成「技术层不认识域」的终局**：8 个服务的消费方横跨 guards / identity / auth / security / app-domain / system / sms 七个 lib（实测消费库数：appSettings 9、device 4、permissions 4、mfa 3、sign 2、verifyCode 2、cap 1、opaque 1），下沉任一服务都会让别的库反向依赖某个域。这是 D12 折中的根据，已写进 ADR 正文。

---

## 4. D10：Repository 三模式 → 两模式

### 4.1 口径改写（6 个文档位）

| 文件 | 改了什么 |
|---|---|
| `apps/server/AGENTS.md:65` | 整节重写：「三种 Repository 模式」→「**Repository 与 Shared Service（两种形态，一个判据）**」：Repository 两个落点（同模块 `*.basic.repository.ts` / 跨模块 `repo/*`）、`@Global` = **消费方模块数 ≥ 2**、Shared Service 非 @Global（端口绑定例外）、硬规矩与守卫 spec 指向 |
| `apps/server/AGENTS.md:19` | 「先看哪份」表同步改口 |
| `apps/docs/.../backend/architecture.md:4,97,105,160` | 引言、模块骨架注释（`repo/` 不再标「@Global」而是「消费方模块 ≥2 才 @Global」）、取舍规则段（补 @Global 判据 + 守卫 spec）、末尾硬规矩 |
| `apps/docs/.../backend/transactions.md:70` | 「三种 Repository 模式」→「Repository 与 Shared Service」 |
| `apps/server/README.md:12` | 同上 |
| 根 `AGENTS.md:123` | 同上（包级指引一句话描述） |
| ADR 0022 | 「五条机械守卫」→「六条」，新增 `repo-global.drift.spec.ts` 一条；Consequences 补 D10/D11/D12 三条 |

文档预算：`apps/server/AGENTS.md` 6215 / 6900（90%），根 `AGENTS.md` 8312 / 8700（96%）—— 都过 `pnpm lint:doc-budget`（其余三份未动）。

### 4.2 逐条体检（18 个 `*.repo.module.ts`，消费方模块数 = 用 AST 数「声明了注入该 provider 的类」的模块；测试文件不算）

| repo module | 消费方模块数 | 改造前 @Global | 处置 |
|---|---|---|---|
| `libs/system/src/locale/repo/locale.repo.module.ts` | **1**（locale.module） | 是 | **撤 @Global** —— 消费方本来就 import 它，零接线改动 |
| `libs/system/src/menu/repo/menu.repo.module.ts` | **1**（menu.shared.module） | 是 | **撤 @Global** —— menu.shared.module 已 import |
| `libs/auth/src/modules/refresh/repo/refresh.repo.module.ts` | **1**（refresh.shared.module） | 是 | **撤 @Global** + 给 refresh.shared.module 补 1 行 import。原注释说「保持 @Global 因为 auth shared / signout / monitor / task 消费方」—— 那是把 **shared service** 的消费方记到仓库头上，注释一并订正 |
| `libs/system/src/logs/operate/repo/log.operate.repo.module.ts` | 1（log.operate.module） | 是 | 保留：同时绑定 `WALNUT_ADMIN_OPERATE_LOG_WRITER`（装饰器级注入，跨 controller），ADR 0022 D3 例外 |
| `libs/identity/src/user_lock/repo/user_lock.repo.module.ts` | 2 | 是 | 保留 |
| `libs/identity/src/user_mfa/repo/user_mfa.repo.module.ts` | 2 | 是 | 保留 |
| `libs/system/src/deleted/repo/deleted.repo.module.ts` | 2 | 是 | 保留（还导出 `WALNUT_ADMIN_SOFT_DELETE_STRATEGY`） |
| `libs/system/src/logs/auth/repo/log.auth.repo.module.ts` | 2 | 是 | 保留 |
| `libs/app-domain/src/setting/repo/setting.repo.module.ts` | 3 | 是 | 保留（+ `WALNUT_ADMIN_BLACKLIST_REPOSITORY`） |
| `libs/system/src/dept/dept.repo.module.ts` | 3 | **否** | **不动**：显式 import 是更保守的合规形态；`dept.module.ts:21` 用 `exports: [SysDeptRepoModule]` 把仓库借给 employee，这个模式本身合法（守卫 spec 按 exports 闭包判可见性，否则会假红） |
| `libs/system/src/lang/repo/lang.repo.module.ts` | 3 | 是 | 保留 |
| `libs/system/src/role/repo/role.repo.module.ts` | 3 | 是 | 保留 |
| `libs/identity/src/user_oauth/repo/user_oauth.repo.module.ts` | 4 | 是 | 保留 |
| `libs/app-domain/src/monitor/user/repo/user.repo.module.ts` | 5 | 是 | 保留（+ 两个端口 token） |
| `libs/identity/src/user_device/repo/user_device.repo.module.ts` | 5 | 是 | 保留 |
| `libs/identity/src/user_identity/repo/user_identity.repo.module.ts` | 7 | 是 | 保留 |
| `libs/system/src/device/repo/device.repo.module.ts` | 7 | 是 | 保留 |
| `libs/identity/src/user/repo/user.repo.module.ts` | 14 | 是 | 保留 |

⇒ **@Global 的 repo module：17 → 14**。改的只有「一个消费方却还挂 @Global」这种**零收益**的 3 个；**没有搬任何文件**（符合「别大范围搬文件」）。

### 4.3 新守卫 + 变异测试（证明它有牙）

`apps/server/apps/api/src/common/monorepo/repo-global.drift.spec.ts`（3 条；纯源码 + TypeScript 解析器，不需要 DB / Redis）：

1. 扫描口径有效性（≥10 个 repo module，@Global 与非 @Global 都存在 —— 防「扫不到文件 ⇒ 全绿」）；
2. **纯类 provider 的 repo module，消费方 ≤ 1 时不许 @Global**（token 绑定模块豁免，理由 = ADR 0022 D3）；
3. 非 @Global 的 repo module，每个消费方都必须能**经 imports 闭包**看见它（含 `exports: [SomeRepoModule]` 再导出 —— employee 就是这条路径）。

变异测试（临时把 `@Global()` 加回 locale.repo.module，跑完立即回滚）：

~~~text
 FAIL  ... > 纯类 provider 的 repo 模块，消费方 ≤ 1 时不许 @Global
   "libs/system/src/locale/repo/locale.repo.module.ts（消费方 1：libs/system/src/locale/locale.module.ts）"
exit=1     # 回滚后 exit=0
~~~

---

## 5. 改了什么（文件级清单，便于逐项对 diff）

**新增 6 个文件**
`libs/lock/src/lock.port.ts`、`libs/lock/src/murlock.adapter.ts`、`libs/lock/src/murlock.adapter.spec.ts`、`libs/lock/src/murlock-isolation.drift.spec.ts`、`apps/api/src/common/monorepo/repo-global.drift.spec.ts`（+ 10 个文件是 `git mv` 的重命名）

**改动（我的）**
- D11：`libs/lock/src/{lock.module,index}.ts` + 10 个消费方（area / 4 guards / 5 risk services）
- D12：`libs/cache/src/{cache.module,index}.ts`、`cap.cache.ts`、2 个 spec 的 import、6 处过期路径引用
- D10：`locale.repo.module.ts`、`menu.repo.module.ts`、`refresh.repo.module.ts`、`refresh.shared.module.ts`
- 文档：`apps/server/AGENTS.md`、`apps/server/README.md`、根 `AGENTS.md`、`backend/{architecture,transactions,modules/system-core}.md`、ADR 0022、`DESIGN-ISSUES{,-ARCHIVE}.md`

**不是我的**（§1.2 两个并行批次）：`db/seed/*.json`、`packages/tooling/scripts/**`、根 `package.json`、`libs/system/src/locale/{dto,repo}`、`locale.list-row.spec.ts`、`openapi.json`、`packages/generated/api-types/**`、`apps/admin/**`、`apps/server/.tmp/**`。

---

## 6. 门禁实测（含逐条归因）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单测 | `cmd /c "pnpm --filter @walnut/server test"` | ✅ **90 files / 766 tests passed**，exit 0，126s。基线 86/753；**+3 文件 / +10 条是我的**（adapter 3 + isolation 4 + repo-global 3），另 +1 文件 / +3 条来自并行批次的 `locale.list-row.spec.ts` |
| 类型 | `cmd /c "pnpm types:check"`（cwd apps/server） | ✅ exit 0（全部改完后最终态复跑） |
| Lint（我的文件） | `pnpm exec eslint` 指向我改的 15 个路径 | ✅ exit 0 |
| Lint（全量） | `cmd /c "pnpm lint"` | ❌ exit 1：**3 个 error 全在并行批次文件**——`libs/system/src/locale/dto/locale.dto.ts:165`（eol-last）、`locale.list-row.spec.ts:34`（test title 小写）、`libs/system/src/locale/repo/locale.repo.service.ts:236`（eol-last）；另 2 个 `ts/no-unsafe-assignment` warning 是 `libs/repository/src/pg-list.builder.spec.ts:453,474` 的**存量**。我自己第一轮引入过 22 个 lint 问题，已全部修掉（import 排序 / consistent-type-specifier-style / promise-function-async / prefer-lowercase-title / if-newline / regexp/*） |
| 边界 | `cmd /c "pnpm boundaries"` | ❌ exit 1，但 **4/4 issue 全在 `apps/server/.tmp/seed-baseline/head/` 与 `.tmp/seed-verify/07dacfd6/`**（seed 批次留下的整棵仓库拷贝，`yaml` 依赖判定失败）；扫描文件数 4645 → **4873** 全部来自这些拷贝。我的改动全在 `@walnut/server` 包内、没有新增跨包 import ⇒ 这条的绿要等 `.tmp/` 被清掉（§8 第 1 条） |
| OpenAPI | `cmd /c "pnpm --filter @walnut/server openapi:export"` | ✅ 输出 `written ... (openapi 3.0.0, **202 schemas**)`；**导出前后 `openapi.json` 的 sha256 完全一致**（`65d54c734720202e`），`schema.d.ts` / `index.ts` 同样一致 ⇒ **我的改动零 openapi 影响**。`git diff --stat` 里 openapi/api-types 的 13+/2- 是**并行批次（D16）改的、导出前就在**，我的导出没有动它 |
| 文档 4 道 | `lint:adr` / `lint:doc-budget` / `lint:docs-refs` / `lint:doc-ts` | ✅ 全绿（ADR 27 篇形态 OK；预算 6 份都在区间内；docs-refs 首跑红是改名导致 `DESIGN-ISSUES-ARCHIVE.md` 里 4 处旧路径失效 —— 订正后复跑绿；doc-ts 230 篇 / 124 个 ts 块 OK） |

**额外证据（DI 图）**：`openapi:export` 会真 bootstrap 整个 AppModule，日志里出现 `Nest application successfully started` 与 `MurLock Redis Client connection closed` ⇒ 撤 @Global / 加 @Global / 新 token 绑定都没有打断 DI 解析。

---

## 7. 发现但**本轮不改**（逐条，附理由与落点）

| # | 发现 | 证据 | 为什么不改 |
|---|---|---|---|
| 1 | `SysLogAuthSharedModule` 是 **Shared Service 却 @Global 且不绑定端口** —— 新口径下唯一的形态违规 | `libs/system/src/logs/auth/shared/log.auth.shared.module.ts:12`；其 interceptor 经 `@UseInterceptors(WalnutAdminInterceptorRequestAuthLog)` 在 2 个装饰器里实例化，控制器散在多个模块 | 撤 @Global 要在**每个**用到 `@WalnutAdminDecoratorAuthLog` 的控制器模块里 import 它 ⇒ 动认证/安全链路（含 app.module 的 APP_INTERCEPTOR）。属「不改认证/安全链路」红线，请 Lead 决定是否排下一批 |
| 2 | `SysUserOAuthSharedModule` + `SysUserOAuthSharedService` **死模块**（0 import / 0 注入） | `grep SysUserOAuthSharedService` 只命中定义与自己的 module（4 行） | 删除属另一类动作（knip 当前有意红），不在 D10「调整落点」范围；建议下一批清理 |
| 3 | 裸 service 自持 `DataSource` 的残留：`libs/auth/src/modules/oauth/{gitee,github}.service.ts:20`、`libs/auth/src/modules/otp/otp.service.ts:23` | `grep InjectDataSource` 排除仓库类后的命中（review 的 ARCH-05 / F-31 已登记） | 属认证链路（OAuth/OTP），本轮只做落点口径，不动业务实现 |
| 4 | 锁键前缀仍叫 `APP:MURLOCK` | `libs/const/src/app/cache.ts:12` + 10 处消费方拼键 | 改名会改变 Redis 键空间（在途锁键名失效、监控台缓存列表显示变化）= 运维可见变更 ⇒ 交 Lead 拍板（§8 第 3 条） |
| 5 | `cache.rsa` / `cache.lock` / `cache.cron-lock` 与 8 个域缓存同类但命名未统一 | ADR 0022 Decision 5 登记表 | D12 只列了 8 个；改名留到下次触碰（ADR 已写明「下次动这两个文件时一并改」），避免与 D12 的清单口径打架 |

---

## 8. 需要 Lead 拍板

1. **`pnpm boundaries` 的绿怎么算**：当前 4 个 issue 全在 `apps/server/.tmp/`（seed 批次的仓库拷贝，扫描文件数 4645→4873 全来自它）。我不会删别人的临时目录。二选一：① 让 seed 批次清掉 `.tmp/`，我复跑补一条实测；② 认可「boundaries 红 100% 来自 .tmp 拷贝」这条归因（已给逐文件路径与文件数对照）。
2. **全量 `pnpm lint` 的绿同理**：3 个 error 全在 locale 批次（D16）的文件（2 个 eol-last + 1 个 test title）。要么等它收口后复跑，要么按「我的文件 lint 绿」验收。
3. **锁键前缀 `APP:MURLOCK`**：端口化后保留 vendor 名字会持续误导（换实现后键名还在说 murlock）。改名代价是 Redis 键空间切换（在途锁最多 300–900s 自然过期，无数据丢失）。建议下一批改，需你点头。
4. **`WALNUT_ADMIN_LOCK` 的接口名**：按 D11 原文用了 `WalnutLockService`（不带 `I` 前缀），与既有 `IWalnutAdmin*` 端口命名不一致。若要统一，改 1 处定义 + 11 处 import 即可 —— 现在改还是留作命名批？
5. **§7 第 1 条（`SysLogAuthSharedModule` 的 @Global）与第 2 条（死模块）**：要不要排进下一批？两条都要动认证 / 日志链路，需要你确认批次边界。
