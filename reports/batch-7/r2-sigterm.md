# 批次 7 · R2：api 侧 SIGTERM 竞争（cap.js）

> 执行：**全新实施 agent**（未参与 R1，按任务书动手）
> 基线：HEAD `d9f4233e`。开工时 `git status --porcelain` 为空；**收尾时同工作树里还有别的批次的在途改动**（见 §7，会改变验收读法）
> 性质：**动手批次**，**未 git commit**
> 环境：Windows / pwsh，Node 24.21，PG 5432 / Redis 6379 通（WSL），`@cap.js/server@4.0.5`，`@nestjs/core@12.3.2`

---

## 0. TL;DR

| # | 交付 | 状态 | 一句话证据 |
|---|------|------|-----------|
| 1 | 定位 cap.js 抢注册 SIGTERM 的确切位置与 `cleanup()` 语义 | ✅ | `@cap.js/server/index.js:205`（beforeExit）+ `:207-213`（SIGINT/SIGTERM/SIGQUIT → `cleanup().then(() => process.exit(0))`）；`cleanup()` 在 `:545-565`；**不可配置** |
| 2 | 把 cap 的 cleanup 挂进 Nest 关闭流程，摘掉它自己的 `process.exit` | ✅ | 新增 `libs/security/src/cap/cap.shutdown.ts`（构造期监听器差集摘下）+ `SecurityCapService.beforeApplicationShutdown`；**没 fork、没改 node_modules** |
| 3 | 「PG 池与 Bull 队列都关了才退出」的机械断言 | ✅ | 3 个 spec 共 8 条（含一条跑**真 Nest 关闭序列**的顺序断言）；另有端到端探针脚本 + 判据（§4.2） |
| 4 | 关闭顺序写清 | ✅ | `onModuleDestroy(Redis quit) → beforeApplicationShutdown(CAP cleanup) → dispose(停 HTTP/socket.io) → onApplicationShutdown(Bull close / TypeORM destroy) → process.exit(0)`（§3.3，实测时间轴） |
| 5 | 验收 | ✅ | test **95 文件 / 790 条全绿**（基线 93/782）、types:check **15/15**、lint **15/15（0 error）**、boundaries **0 issue**（§6） |

**两条会改变下一步动作的结论：**

**H1 —— 「关不干净」的根因不是 Nest 配置，而是 cap.js 的信号监听器比 Nest 注册得早，并且自己 `process.exit(0)`。**
实测（§2.2）：SIGTERM 后 **27ms** 进程就 `exit 0`，PG 的 `DataSource.destroy` 与 Bull 的 `queue.close()` **一次都没发生**。
按 Nest 12.3.2 的序列，Bull 的 `queue.close()` 本来要 ~1.55s（3 个队列各等阻塞客户端返回）—— 这段**过去每次部署都被吃掉**。

**H2 —— 只摘监听器不够，还必须换掉 Nest 默认的收尾方式（`useProcessExit: true`）。**
Nest 默认在关闭序列跑完后 `process.kill(process.pid, signal)` 重发信号；而 main.ts 自己给 SIGTERM/SIGINT 注册的 `setDraining` 监听器会**接住**这次重发（Node 只在没有监听器时才走默认终止），进程于是靠「事件循环自然空掉」退出 —— 只要还剩一句异步尾巴（winston 传输、socket.io 定时器）就**永远不退**。改成显式 `process.exit(0)`，且只在整段序列之后。

---

## 1. 问题 1：cap.js 到底在哪里抢了 SIGTERM

### 1.1 注册位置（`@cap.js/server@4.0.5`，`"type": "commonjs"`，`main: index.js`）

`apps/server/node_modules/@cap.js/server/index.js`：

| 行 | 内容 | 含义 |
|----|------|------|
| `:205` | `process.on("beforeExit", () => this.cleanup())` | 自然退出时刷一次（无 exit） |
| `:207-213` | `["SIGINT","SIGTERM","SIGQUIT"].forEach(signal => process.once(signal, () => { this.cleanup().then(() => process.exit(0)).catch(() => process.exit(1)) }))` | **抢注册 + 自己 exit** |
| `:186-214` | 以上全部在 **constructor** 里 | 即 `new Cap(...)` 的副作用，不是首次调用时 |

关键点：这 4 个监听器是 `process.once`（`beforeExit` 是 `on`）。它们在**模块求值期**就被注册 —— 因为
`libs/security/src/cap/cap.service.ts:29-31` 在顶层 `new Cap(...)`（改造前是 `:17` 的 `export const AppCapJS = new Cap(...)`）。
而 `app.enableShutdownHooks()` 在 `main.ts:208`（改造前 `:191`）才跑，**晚于**模块求值。Node 按注册顺序派发同一信号的监听器 ⇒ cap 先跑。

### 1.2 `cleanup()` 做了什么（`:545-565`）

```js
async cleanup() {
  if (this._cleanupPromise) return this._cleanupPromise      // 幂等：只算一次
  this._cleanupPromise = (async () => {
    const tokensChanged = await this._cleanExpiredTokens()   // :480 清过期的 challenge / token（纯内存）
    if (tokensChanged && !this.config.noFSState && !this.config.storage?.tokens?.store) {
      await fs.writeFile(this.config.tokens_store_path, JSON.stringify(this.config.state.tokensList), 'utf8')
    }
  })()
  return this._cleanupPromise
}
```

- 只碰**自己的内存状态 + 一个本地文件**（本项目 `tokens_store_path = '.data/tokensList.json'`）；
- **不碰 PG / Redis / Bull** —— 这一点决定了「它排在关闭序列的哪一段」在数据面上没有耦合（见 §3.3 的注意点）；
- 幂等：`_cleanupPromise` 复用，重复调用不会重复写盘。

### 1.3 能不能配置 / 关掉？**不能**

| 配置项 | 实际作用 | 对信号注册 |
|--------|----------|-----------|
| `disableAutoCleanup` | 只关 `_lazyCleanup()`（`:221-233`，每 5 分钟一次的机会式清理） | **无影响** |
| `noFSState` | 关掉 `.data` 文件读写（`:201-203`、`:551-561`） | **无影响** |
| `storage` / `tokens_store_path` | 换存储后端 / 落盘路径 | **无影响** |

`:207-213` 的注册是**无条件**的，没有任何开关能跳过它。README / `index.d.ts` 也没有对应选项。

### 1.4 为什么它一定赢（时序上的必然，不是概率）

```text
require(app.module) ─→ … ─→ @walnut-server/security/cap/cap.service ─→ new Cap()   ← 注册 SIGTERM（第 1 个监听器）
NestFactory.create()  ─→ … ─→ app.init() ─→ app.listen()
main.ts:208          ─→ app.enableShutdownHooks(...)                                ← 注册 SIGTERM（第 2 个监听器）
```

SIGTERM 到达时两个监听器都会被调用，但 cap 的 `cleanup()` 只有几毫秒（内存 + 可选的小文件写），
Nest 的 `app.close()` 要跑完 `onModuleDestroy` → `beforeApplicationShutdown` → `dispose` → `onApplicationShutdown`。
**cap 的 `process.exit(0)` 在一次 tick 内就把还在排空的进程杀掉**（实测 27ms 内，见 §2.2）。

---

## 2. 问题复现（修前实测）

### 2.1 方法

不能直接 `process.exit` 观察（那正是被观测对象）。用一个 `--require` **外部探针**给关键关闭方法打时间戳，
再让进程自己发 SIGTERM（Windows 没有真正的 POSIX 信号投递，`process.emit('SIGTERM', 'SIGTERM')` 与
libuv 派发给监听器的形态**等价**：按注册顺序调用同一批监听器，且 `SignalsListener = (signal: Signals) => void`
—— 见 `@types/node/process.d.ts:411`）：

- `typeorm` 的 `DataSource.prototype.destroy`（TypeORM 关池的真身）
- `bull/lib/queue` 的 `Queue.prototype.close`（`@nestjs/bull` 的 `queue.onApplicationShutdown = () => this.close()`，见 `node_modules/@nestjs/bull/dist/bull.providers.js:33`）
- `@cap.js/server` 的 `Cap.prototype.cleanup`
- 包一层 `process.exit`（记录调用栈）

探针脚本全文在附录 A，落在 `reports/batch-7/probe/probe.js`；日志在同目录 `before.log` / `after.log` / `after2.log`。

### 2.2 修前（HEAD d9f4233e 编译产物）

```text
 17825ms emit SIGTERM
 17832ms cap.cleanup start
 17852ms cap.cleanup done
 17852ms process.exit(0) stack: … <- at @cap.js/server/index.js:210:31 <- at runNextTicks
 17873ms 'exit' event code=0
```

- SIGTERM → 退出：**48ms**；从 cleanup 完成到 exit：**0ms**（同一个 tick）；
- `pg.DataSource.destroy` / `bull.Queue.close`：**全程没有出现一行**（探针已成功 patch，见日志前几行的 `patched …`）；
- 退出码 0 —— 所以编排层看到的是「干净退出」，问题只在连接被重置 / 任务重复消费时才显形。

应用自己的日志也印证：修前收到 SIGTERM 后**没有任何** `Redis client disconnected.`（`libs/cache/src/redis/redis.service.ts:29-33` 的 `onModuleDestroy` 根本没跑到）。

> 说明：同一份 `before.log` 里还有一段 `process.exit(1)` 的记录，那是我用 `NODE_ENV=production` 起进程时
> env 校验失败（`config.module.js` 报错）留下的，与本事无关；之后统一用默认 env 跑。

### 2.3 判据（这三条同时成立才算复现）

1. `cap.cleanup done` 之后紧跟 `process.exit(0)`，且栈里有 `@cap.js/server/index.js:210`；
2. `pg.DataSource.destroy` 与 `bull.Queue.close` 在进程退出前**从未被调用**；
3. 从 SIGTERM 到 `'exit'` 的时间远小于依赖排空所需时间（本例 <50ms vs Bull 实测 ≥1.5s）。

---

## 3. 问题 2：设计（把 cleanup 挂进 Nest，而不是自己 exit）

### 3.1 为什么是「摘钩子」，而不是 fork / patch node_modules

| 方案 | 代价 | 结论 |
|------|------|------|
| fork `@cap.js/server` | 该包**不发构建产物**（直接发 `index.js` + `index.d.ts`）；要接管 `pnpm catalog` 版本、维护 4 段内部实现（`_loadTokens`/`_cleanExpiredTokens`/storage 钩子）、每次上游升级都 rebase | ❌ 本批不做（任务书要求「若必须 fork，停下来问」——**不需要 fork**） |
| `patch-package` / postinstall 改 node_modules | 引入一份 patch 文件当第二真源；CI 需要 postinstall 钩子；锁文件一变就得重打 | ❌ |
| **构造期差集摘下监听器**（本批） | 需要在 cap.js 升级时复核事件清单 —— 由一条**漂移守卫**单测机械拦（§4.1 第 4 条） | ✅ |

为什么差集够用：cap 的 4 个监听器是 `new Cap(...)` **期间**新增的，快照前后做差集就能拿到**原函数引用**
（`process.listeners()` 对 `once` 返回的是原函数，`removeListener` 也接受原函数），既不用猜 cap 内部实现，
也不会误伤调用方自己注册的监听器（有单测钉住）。

### 3.2 变更面（6 个文件，3 新增 3 修改）

| 动作 | 文件:行 | 内容 |
|------|---------|------|
| **新增** | `apps/server/libs/security/src/cap/cap.shutdown.ts:1-100` | `WALNUT_ADMIN_CAP_PROCESS_EVENTS`（`:42-48`）+ `createCapDetachedFromProcessHooks()`（`:77-100`）：快照 → `create()` → 差集 → `removeListener`，返回 `{ cap, hooks }` |
| 修改 | `apps/server/libs/security/src/cap/cap.service.ts:20-36` | `AppCapJS` 改由上面的工厂创建；新增 `WALNUT_ADMIN_CAP_DETACHED_HOOKS`（只给排查/单测） |
| 修改 | `apps/server/libs/security/src/cap/cap.service.ts:62-87` | `implements OnModuleInit, BeforeApplicationShutdown`；`beforeApplicationShutdown(signal?)` → `await AppCapJS.cleanup()` + 一行 `[shutdown] CAP token store flushed …`；**失败只记 error 不抛**（抛出去 Nest 会 `process.exit(1)`） |
| 修改 | `apps/server/apps/api/src/main.ts:190-208` | `app.enableShutdownHooks(undefined, { useProcessExit: true })`；注释写清 ① cap 竞争已在 cap 模块根治 ② 为什么必须 `useProcessExit` |
| **新增** | `apps/server/libs/security/src/cap/cap.shutdown.spec.ts` | 4 条：摘 4 个钩子 / 负向对照 / 不误伤 / 漂移守卫 |
| **新增** | `apps/server/libs/security/src/cap/cap.shutdown-order.spec.ts` | 1 条：跑**真 Nest** 的关闭序列，断言 CAP cleanup 早于 PG / Bull |
| 修改 | `apps/server/libs/security/src/cap/cap.service.spec.ts` | +3 条：模块加载后无残留 / `await cleanup` / cleanup 失败不抛 |

**没动**：`libs/guards`（guard 顺序、barrel 一律未碰）、`node_modules`、`pnpm-lock.yaml`、worker / cli 入口、Redis 关闭时机。

正常请求路径的影响：**零**。`AppCapJS` 仍然是模块求值期创建的同一个实例（还是会在 `.data/tokensList.json` 建文件），
`challenge` / `redeem` / `validateToken` 的调用点一行未改；唯一的差别是**进程上不再有它的监听器**。

### 3.3 问题 4：关闭顺序（真 Nest 12.3.2 的序列 + 本项目落点）

`@nestjs/core/nest-application-context.js:152-164` 的 `runShutdownSequence`：

| 段 | Nest 钩子 | 本项目在这里干什么 | 代码位置 |
|----|-----------|-------------------|----------|
| 1 | `prepareClose()` | express adapter 的 `beforeClose`（无操作） | — |
| 2 | `onModuleDestroy` | **Redis**：`client.quit()` → 日志 `Redis client disconnected.` | `libs/cache/src/redis/redis.service.ts:29-33` |
| 3 | `beforeApplicationShutdown(signal)` | **CAP**：`AppCapJS.cleanup()`（清过期 token + 落盘）→ 日志 `[shutdown] CAP token store flushed in Xms (signal=SIGTERM)` | `libs/security/src/cap/cap.service.ts:73-87` |
| 4 | `dispose()` | 停 HTTP server、socket.io | `nest-application.js:64-74` |
| 5 | `onApplicationShutdown(signal)` | **Bull**：每个 `Queue` 的 `close()`（`@nestjs/bull/dist/bull.providers.js:33`）；**PG**：`TypeOrmCoreModule` 关 `DataSource`（`@nestjs/typeorm/dist/typeorm-core.module.js:120`） | — |
| 6 | `unsubscribeFromProcessSignals()` | 摘掉 Nest 自己的信号监听器 | `nest-application-context.js:163` |
| 7 | 信号处理器的收尾 | `useProcessExit: true` ⇒ `process.exit(0)`；默认（false）⇒ `process.kill(process.pid, signal)` 重发 | `nest-application-context.js:244-252` |

修后实测时间轴（§4.3 全文）：

```text
28402ms emit SIGTERM
28415ms cap.cleanup start            ← beforeApplicationShutdown
28416ms cap.cleanup done
28426ms bull.Queue.close start       ← onApplicationShutdown（3 个队列各 ~0.5s，等阻塞客户端）
29974ms bull.Queue.close done (×3)
29980ms pg.DataSource.destroy start
29982ms pg.DataSource.destroy done
29982ms process.exit(0)              ← nest-application-context.js:248（useProcessExit）
29983ms 'exit' event code=0
```

> **注意（与任务书字面顺序的一处偏差）**：任务书写「cap cleanup → PG/**Redis**/Bull 排空」，而 Nest 的
> `onModuleDestroy`（Redis `quit`）是序列**第一段**，因此实测顺序是 **Redis → CAP → Bull/PG**。
> 这在数据面上无影响：cap 的 token store 是**本地文件**，cleanup 不访问 Redis / PG（§1.2）。
> 如果要连 Redis 也排到 CAP 之后，得把 `AppTechRedisService` 的 `quit()` 从 `onModuleDestroy` 挪到
> `beforeApplicationShutdown` 并且**排在我们之后**（同一钩子内的 provider 顺序不可控）——那是 `libs/cache` 的改动，超出本批范围，已列为拍板项。

---

## 4. 问题 3：可验证的断言

### 4.1 单测（进 `pnpm --filter @walnut/server test`，已计入 790）

**① `libs/security/src/cap/cap.shutdown.spec.ts`（4 条）—— 根因消失**

| 用例 | 断言 | 变红意味着 |
|------|------|-----------|
| 摘掉的正是 4 个钩子且不留残留 | `hooks` 的事件集合 = `[beforeExit, SIGINT, SIGTERM, SIGQUIT]`；每个 `process.listeners(event)` 都不含该 listener；前后**逐事件快照相等** | 有未被摘掉的 cap 监听器（= 仍会 `process.exit`） |
| 负向对照 | 直接调用**被摘下来的** SIGTERM listener ⇒ `process.exit` 被以 `0` 调用 | 摘错了对象（摘的不是那个会 exit 的函数） |
| 不误伤 | 先 `process.on('SIGTERM', sentinel)`，摘完后 sentinel 仍在 | 差集写成了「清空所有监听器」 |
| 漂移守卫 | 裸 `new Cap()` 在 `os.constants.signals` + `beforeExit`/`exit` 全域里新增监听器的事件集合必须**恰好**是那 4 个 | cap.js 升级新增了别的进程钩子 ⇒ 本批的清单要跟着改 |

**② `libs/security/src/cap/cap.shutdown-order.spec.ts`（1 条）—— 关闭顺序**

用**真的** `@nestjs/testing` + `moduleRef.init()` / `moduleRef.close()` 跑真关闭序列；三个假依赖挂在
**真实实现所在的同一个钩子**上（Redis→`OnModuleDestroy`、PG→`OnApplicationShutdown`、Bull→`OnApplicationShutdown`），
CAP 用 `vi.spyOn(AppCapJS, 'cleanup')` 记录。断言：

```text
events = [redis.quit, cap.cleanup, pg.dataSource.closed, bull.queue.closed]  （四段都在）
index(cap.cleanup)             > index(redis.quit)
index(pg.dataSource.closed)    > index(cap.cleanup)
index(bull.queue.closed)       > index(cap.cleanup)
process.exit 一次都没被调用
```

这条就是「PG 连接池与 Bull 队列都已关闭，进程才退出」的**机械形态**：顺序断了 / 有人提前 exit 都会红。
（它不依赖真的 PG / Redis，所以进单测；真进程的端到端版本在 §4.2。）

**③ `libs/security/src/cap/cap.service.spec.ts`（+3 条）**

- 模块加载后 `process.listeners(<4 个事件>)` 都不含 `WALNUT_ADMIN_CAP_DETACHED_HOOKS` 的 listener（singleton 侧无残留）；
- `beforeApplicationShutdown` **await** `cleanup()`：用一个手动 resolve 的 Promise 卡住 cleanup，断言钩子 Promise 在此之前**不 settled**，resolve 后才 settled，并打出 `signal=SIGTERM`；
- cleanup 抛错 ⇒ 钩子 `resolves`（只记 `logger.error`）。这一条防的是「关闭钩子抛错 → Nest `process.exit(1)`」的老毛病。

### 4.2 端到端脚本与判据（可复跑）

```powershell
# 1) 构建
cmd /c "pnpm --filter @walnut/server build"

# 2) 起进程（探针 --require 在仓库外/或 reports/batch-7/probe/probe.js，日志写进仓库便于比对）
$env:SIGTERM_PROBE_LOG='D:\walnut-admin\walnut-admin\reports\batch-7\probe\after.log'
Set-Location 'D:\walnut-admin\walnut-admin\apps\server'
node --require 'D:\walnut-admin\walnut-admin\reports\batch-7\probe\probe.js' 'dist/apps/api/src/main.js'
```

探针自己等 `/health/live` 200 后 800ms 发 `process.emit('SIGTERM', 'SIGTERM')`，并给
`process.exit` / `'exit'` / `pg.DataSource.destroy` / `bull.Queue.close` / `cap.cleanup` 打时间戳。

**判据（修后必须同时成立）**

1. `process.exit(0)` 的调用栈是 `@nestjs/core/…/nest-application-context.js:248`（`useProcessExit` 分支），**不是** `@cap.js/server/index.js:210`；
2. 退出前 `pg.DataSource.destroy done` 与 **3 次** `bull.Queue.close done` 都已出现；
3. `cap.cleanup done` 早于上面两者；
4. `'exit' event code=0`；
5. 应用日志里 `Redis client disconnected.` 与 `[shutdown] CAP token store flushed …` 都在退出前出现。

### 4.3 修后实测（同一台机、同一条命令）

```text
 28402ms emit SIGTERM
 28415ms cap.cleanup start
 28416ms cap.cleanup done
 28426ms bull.Queue.close start
 28953ms bull.Queue.close done
 28955ms bull.Queue.close start
 29463ms bull.Queue.close done
 29463ms bull.Queue.close start
 29974ms bull.Queue.close done
 29980ms pg.DataSource.destroy start
 29982ms pg.DataSource.destroy done
 29982ms process.exit(0) stack: at process.exit (probe.js:45:17) <- at process.cleanup (…/@nestjs/core/nest-application-context.js:248:29)
 29983ms 'exit' event code=0
```

应用侧同一时刻的日志（三条按时间）：

```text
[AppTechRedisService] Redis client disconnected.                         ← onModuleDestroy
[SecurityCapService] [shutdown] CAP token store flushed in 1ms (signal=SIGTERM)   ← beforeApplicationShutdown
[MurLock Redis Client] connection closed.                                ← Bull 关闭过程中的正常输出
```

**差值**：SIGTERM → 退出从 **48ms** 变成 **1581ms**，多出来的正是 Bull 的 3 个队列 `close()`
（每个 ~0.5s，等 `BRPOPLPUSH` 的阻塞客户端返回）+ PG 关池（~2ms）。这段以前**每次滚动更新都被 cap 截断**。

---

## 5. 正常请求路径零影响（自查）

| 关注点 | 结论 | 依据 |
|--------|------|------|
| CAP 校验/签发 | 不变 | `AppCapJS` 仍是同一个 `Cap` 实例；`challenge` / `redeem` / `validateToken` 调用点未改（`cap.service.ts:89-111`、`libs/guards/src/guards/cap.guard.ts:235`） |
| 启动行为 | 不变 | 仍是模块求值期 `new Cap(...)`（照旧建 `.data/tokensList.json`、照旧打单实例 warn） |
| guard 顺序 | 未触碰 | `libs/guards/**` 零改动；`apps/api/src/common/monorepo/guard-order.drift.spec.ts` 在 790 条里绿 |
| worker / cli | 不受影响 | `cap.service` 仍不在 worker 的文件级闭包内（`worker-import-closure.drift.spec.ts` 绿） |
| openapi | 零 diff | 没有 controller / DTO 改动 |
| 启动窗口内的 SIGTERM | 行为变化（更干净） | cap 的监听器在模块求值后即被摘掉；启动期收到 SIGTERM 现在是「无监听器 → Node 默认终止」，不再经过 cap 的 `cleanup().then(exit)` |

---

## 6. 验收

### 6.1 `cmd /c "pnpm --filter @walnut/server test"` ✅

```text
 Test Files  95 passed (95)
      Tests  790 passed (790)
   Duration  79.90s
```

基线 93 文件 / 782 条 → **+2 文件 / +8 条**（`cap.shutdown.spec.ts` 4 + `cap.shutdown-order.spec.ts` 1 + `cap.service.spec.ts` +3）。

### 6.2 `pnpm types:check` ✅ / `pnpm boundaries` ✅

```text
types:check →  Tasks: 15 successful, 15 total   Time: 1m29.247s
boundaries  →  Checking packages... Checked 4676 files in 15 packages, no issues found
```

### 6.3 `pnpm lint` ✅

根级终态（最后一次跑）：

```text
 Tasks:    15 successful, 15 total
 Time:    3m5.622s
```

我自己改的 6 个文件单独 scoped 检查也 **exit 0（零输出）**：

```text
cmd /c "cd apps\server && npx eslint libs/security/src/cap/cap.shutdown.ts libs/security/src/cap/cap.shutdown.spec.ts \
  libs/security/src/cap/cap.shutdown-order.spec.ts libs/security/src/cap/cap.service.ts \
  libs/security/src/cap/cap.service.spec.ts apps/api/src/main.ts"
→ exit 0
```

> 过程记录（免得 Lead 以为批数是假的）：会话中途根级 lint 曾经红过 3 处 ——
> `apps/api/src/modules/auth/auth.controller.ts:45`（装饰器顺序）、`apps/api/test/api/auth-session.api-spec.ts:359`（多空行）、
> `packages/tooling/scripts/src/ci/check-package-exports.ts:44`（`perfectionist/sort-imports`）—— **都不是本批文件**，
> 是同一工作树里别的批次在途改动；它们随后各自被修掉，终态 15/15 全绿（server 包只剩 `pg-list.builder.spec.ts` 的 2 条 warning，同样不是本批）。
> 我全程没有碰别人的文件。

### 6.4 没跑的

- `test:integration` / `test:e2e`：本批不需要（没有 DB/HTTP 契约变化），且集成套件会 drop 集成库、与正在跑别的批次的同一工作树抢资源。
- 真 Linux SIGTERM 投递：本机是 Windows（`wsl` 里没有 node），端到端用 `process.emit('SIGTERM','SIGTERM')` 等价替代（§2.1 的理由）。

---

## 7. 工作树状态（**会改变验收读法**）

开工时 `git status --porcelain` 为空（HEAD `d9f4233e`）。收尾时同工作树里出现了**别的批次**的在途改动，我的改动只有这 6 个文件：

```text
 M apps/server/apps/api/src/main.ts
 M apps/server/libs/security/src/cap/cap.service.ts
 M apps/server/libs/security/src/cap/cap.service.spec.ts
?? apps/server/libs/security/src/cap/cap.shutdown.ts
?? apps/server/libs/security/src/cap/cap.shutdown.spec.ts
?? apps/server/libs/security/src/cap/cap.shutdown-order.spec.ts
?? reports/batch-7/            （本报告 + probe/ 证据）
```

不属于我的在途改动（会话中实时变化，仅记录收尾时的快照）：
`apps/docs/**`（3 个 md）、`apps/server/AGENTS.md`、`apps/server/apps/api/src/modules/auth/auth.controller.ts`、
`apps/server/apps/api/test/api/{auth-session.api-spec.ts,ENDPOINTS.md}`、`apps/server/libs/auth/**`（3 个）、
`apps/server/openapi.json`、`packages/tooling/scripts/src/ci/**`（4 个）、`reports/batch-9/`。

⇒ §6.1/6.2/6.3 的「整包/全仓」数字是在**共享工作树**上跑出来的；我的 6 个文件可用 §6.3 的那条 scoped 命令单独复核。

---

## 8. 已知取舍 / 遗留

1. **自然退出不再刷 cap 的 token 文件**：摘掉的 `beforeExit` 只在「进程自然退出」时触发；现在只有走 Nest 关闭序列
   （SIGTERM/SIGINT/SIGQUIT 或显式 `app.close()`）才 `cleanup()`。硬退出（未捕获异常、`process.exit(1)`）时
   `.data/tokensList.json` 不重写 —— 该文件是 token 快照，过期项在下次启动/清理时会再被过滤，**不影响正确性**。
2. **退出码从 143 变 0**（`useProcessExit`）。修前也是 0（cap 自己 exit(0)），所以对编排层**无变化**；但若将来有人把
   `useProcessExit` 去掉，退出码会回到 143 且默认路径有**挂死风险**（§0 H2），这条要一起看。
3. **Redis 先于 CAP 关闭**（§3.3 注意点）。
4. 端到端探针依赖「`process.emit` 等价于真信号」；真实 Linux 环境建议按 §4.2 的判据复跑一次（命令原样可用）。
5. 本批**未**动 CAP 的本地文件存储（CAP-3 单实例前提），也**未**动 worker。

---

## 附录 A：端到端探针 `reports/batch-7/probe/probe.js`（原样）

```js
'use strict'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const Module = require('node:module')

const LOG = process.env.SIGTERM_PROBE_LOG || path.join(__dirname, 'sigterm-probe.log')
const OFFSET = Date.now()
const log = (m) => fs.appendFileSync(LOG, String(Date.now() - OFFSET).padStart(6) + 'ms ' + m + '\n')
const appRequire = Module.createRequire(path.join(process.cwd(), 'package.json'))

log('probe load pid=' + process.pid + ' cwd=' + process.cwd())

function patch(proto, name, label) {
  const original = proto && proto[name]
  if (typeof original !== 'function' || original.__probe) return log('patch skip ' + label)
  const patched = function (...args) {
    log(label + ' start')
    let out
    try { out = original.apply(this, args) }
    catch (e) { log(label + ' sync-throw ' + (e && e.message)); throw e }
    if (out && typeof out.then === 'function') {
      return out.then(v => { log(label + ' done'); return v }, e => { log(label + ' rejected ' + (e && e.message)); throw e })
    }
    log(label + ' done(sync)')
    return out
  }
  patched.__probe = true
  proto[name] = patched
  log('patched ' + label)
}

try { patch(appRequire('typeorm').DataSource.prototype, 'destroy', 'pg.DataSource.destroy') }
catch (e) { log('patch typeorm failed ' + e.message) }
try {
  const bullMod = appRequire('bull/lib/queue')
  const BullQueue = bullMod.Queue || bullMod.default || bullMod
  patch(BullQueue.prototype, 'close', 'bull.Queue.close')
} catch (e) { log('patch bull failed ' + e.message) }
try { patch(appRequire('@cap.js/server').prototype, 'cleanup', 'cap.cleanup') }
catch (e) { log('patch cap failed ' + e.message) }

const realExit = process.exit
process.exit = function (code) {
  const stack = new Error().stack.split('\n').slice(1, 5).map(s => s.trim()).join(' <- ')
  log('process.exit(' + code + ') stack: ' + stack)
  return realExit.call(process, code)
}
process.on('exit', code => log("'exit' event code=" + code))
process.on('beforeExit', code => log("'beforeExit' event code=" + code))

const port = Number(process.env.SIGTERM_PROBE_PORT || 3000)
function retry(attempt, why) {
  if (attempt > 600) return log('app never became ready: ' + why)
  setTimeout(() => waitReady(attempt + 1), 200)
}
function waitReady(attempt) {
  const req = http.get({ host: '127.0.0.1', port, path: '/health/live', timeout: 1000 }, res => {
    res.resume()
    if (res.statusCode === 200) {
      if (globalThis.__sigtermScheduled) return
      globalThis.__sigtermScheduled = true
      log('app is listening; emitting SIGTERM in 800ms')
      setTimeout(() => { log('emit SIGTERM'); process.emit('SIGTERM', 'SIGTERM') }, 800)
    }
    else retry(attempt, 'status ' + res.statusCode)
  })
  req.on('error', e => retry(attempt, e.code || e.message))
  req.on('timeout', () => { req.destroy(); retry(attempt, 'timeout') })
}
waitReady(0)
```

---

## 需要 Lead 拍板

1. **退出码 0 还是 143**：`enableShutdownHooks(undefined, { useProcessExit: true })` 让「排空后退出」以 `exit(0)` 收尾
   （与修前 cap 的 `exit(0)` 一致，但**不是** POSIX 的 143）。若监控/编排依赖 143 判「被 SIGTERM 终止」，要改成
   `useProcessExit: false` 并另想办法让进程真的退出（默认路径会因 main.ts 的 `setDraining` 监听器接住重发信号而**挂死风险**，见 H2）。
2. **Redis 关闭时机**：要不要把 `AppTechRedisService.onModuleDestroy` 的 `quit()` 挪到 `beforeApplicationShutdown`，
   以满足任务书字面的「CAP cleanup → Redis 排空」顺序？代价：动 `libs/cache`（本批范围外），且同钩子内顺序仍需显式编排。
3. **信号集合**：现在沿用 Nest 默认（`Object.values(ShutdownSignal)`，**11 个**，含 SIGSEGV/SIGABRT/SIGBUS…）。
   要不要收窄成 `SIGTERM/SIGINT/SIGQUIT/SIGHUP`？（收窄是行为变化，本批未做）
4. **验收口径（共享工作树）**：§6 的整包数字是在**含别的批次在途改动**的工作树上跑出来的（中途根级 lint 曾被 3 处
   非本批文件弄红——`auth.controller.ts:45`、`auth-session.api-spec.ts:359`、`check-package-exports.ts:44`——随后由各自批次修掉，
   终态 15/15）。合并前是否需要在**干净工作树**上重跑一次 test / types:check / lint / boundaries？
5. **是否把 §4.2 的端到端探针固化成 CI 一步**（Linux runner 上可用真 `kill -TERM`，判据同 §4.2）；本批只作为报告里的可复跑脚本。
6. **`cap.shutdown.ts` 的事件清单是否接受「靠一条单测守漂移」**（cap.js 升级新增进程钩子会让 `cap.shutdown.spec.ts` 的最后一条变红）。
   备选是每次升级 `@cap.js/server` 都人工复核 `index.js:205-213`。
