# R4 · 两份 spec 适配「封禁 = 踢下线」+ 正向断言 + integration 排他

> 角色：实施（本轮**唯一**的 integration 跑者）。基线 HEAD = `dfdaf4e7`（开工时 worktree clean）。
> **未提交**（按要求不 commit）。
> 观测口径：全局异常过滤器恒 HTTP 200，结论看 `body.code`。
> 所有日志在本目录（`reports/batch-7/r4-*.log`），每条结论都指到具体日志。

## 0 验收结论

| 验收项 | 命令 | 结果 |
|---|---|---|
| **integration** | `cmd /c "pnpm --filter @walnut/server test:integration 2>&1"` | **64/64 文件、639 passed \| 1 skipped、0 failed，exit 0**（883.20s）→ `r4-integration-full-run2.log` |
| **单测不缩水** | `cmd /c "pnpm --filter @walnut/server test"` | **95 文件 / 790 passed**，exit 0（与开工基线逐字一致）→ `r4-unit-baseline.log`（改前）、`r4-unit-after.log`（改后） |
| **types:check** | `pnpm --filter @walnut/server types:check` | exit 0 → `r4-types-check.log` |
| **lint** | `pnpm --filter @walnut/server lint` | exit 0（仅 2 条**既有** warning，都在我没碰的 `libs/repository/src/pg-list.builder.spec.ts`）→ `r4-lint.log` |
| **boundaries** | `cmd /c "pnpm boundaries 2>&1"` | exit 0 → `r4-boundaries.log` |
| **新正向断言有牙（变异测试）** | 把 `device.service.ts:243` 的 kick 临时关成 `if (false && …)` | **1 failed \| 43 passed**（唯一红的就是新断言，报 `expected 1 to be +0`）；还原后 **44/44 绿** → `r4-mutation-kick-off-guard-matrix.log` |

产品代码**零改动**：`git diff -- apps/server/libs/system/src/device/device.service.ts` 为空（变异测试用的是「临时改 → 跑 → 逆操作改回」，跑完 `git diff` 该文件为空）。

## 1 逐条改了什么

改动 6 个文件（4 个测试资产 + 1 个指引 + 1 个我判定为「同类既有无覆盖红」的第三个 spec，见 §6）。

### 1.1 `apps/api/test/api/guard-matrix.api-spec.ts`（主改）

**(a) 新增两个断言 helper**（插在 `redeemFreshCapToken` 之后，:199-222）

- `scanSessionKeys(userId, deviceId)`：扫 `WALNUT_CACHE_AUTH:SESSIONS:<user>:<device>:*` 的所有键。
  为什么按 pattern 扫而不是按已知 sid 断言单个键：要钉的是「**整组**会话键消失」，按 sid 只能覆盖那一个会话。
- `countActiveRt(userId, deviceId)`：`SELECT count(*) … WHERE revoked = false`（现役 RT 行数）。

**(b) 封禁闭环整条重写**（:632，原 :607-621）

旧标题里的「ban/unban 只写 SYS_DEVICE 缓存不落库」正是任务要求清掉的过期描述（P2-2 起就落库，97012f3b 起还踢下线），
连同旧断言一起换成新语义。新用例覆盖：**ban 的全部副作用 + 解封不复活会话 + 唯一恢复路径是重新登录 + 处理器前判别对**：

1. 前置自证：会话键 > 0、`AUTH_MFA_VERIFIED:<user>:<device>` 在场、现役 RT 恰 1 行（否则下面的「清空」不说明任何事）；
2. 第二设备 `apiB` 发 `PATCH …/ban`：DB `banned=true` + SYS_DEVICE 缓存 `banned=true`；
3. 封禁态下本设备请求 **40607**（设备守卫全局 #3，连旧 AT 都到不了 JWT）；
4. **① RT 全撤**：现役行归零 + 存在 `revoke_reason='deviceBanned'` 的行（按**设备**撤，不是按用户那一行）；
5. **② 会话键清空** + MFA verified 键清空。after-commit 钩子由 `WalnutTxInterceptor` 在**返回响应前** await
   （`apps/server/libs/db/src/tx.interceptor.ts:94-104`），所以这里直接断言、不轮询；
6. 封禁态下 `POST /auth/refresh` 也是 **40607**（拍板-4 摘掉了它的 `DeviceFree`）→ 续不出新 AT；
7. unban（走真实的 HTTP 解封，不是缓存复位）；
8. **③ 解封后旧 AT 立即 40101**；
9. 封禁前那枚 `RT_JTI` cookie 再换 AT → **40102**（撤销行在 `JwtRefreshGuard` 层即死）；
10. 重新登录（`setAuth(null)` → `performHttpOpaqueLogin` → `setAuth` → `seedMfaVerifiedCache`），
    并更新 `tokens1`（后续 describe 的 `afterEach` 与 functional 段都复用它）；恢复放行 20000；
11. 正对照：新会话下同一路径 → 40401。

**「处理器前 vs 处理器内」怎么区分（两条独立证据）**

- **同一枚旧 AT 打「处理器内会回 40401」的路径**（`GET /system/device/<不存在 uuid>`）：拿到的是 **40101 而不是 40401**
  ⇒ 请求根本没进处理器；随后用**新 AT 打同一条路径**得到 **40401**，证明「40401 才是处理器内结果」这条对照有效。
- **回 40101 而不是 40115**：踢下线已清 `AUTH_MFA_VERIFIED`，若 JWT（#6）放行，则 MFA（#9）会先回 40115 ——
  实测 40101，说明拒绝发生在守卫链内、且在 MFA 之前。

**(c) 用例自带兜底还原（关键设计）**：这条用例会「封设备 + 断自己的会话」，两者都用 `try/finally` 里的
`unbanDevice()` / `rebuildSession()` 无条件还原（各自 catch，避免兜底掩盖原始失败）。

> 第一版没有 finally 时，变异测试的效果是 **13 failed \| 31 passed**：断言炸掉 → 设备停在封禁态 → 后面 12 条全被 40607 连带打红，
> 「1 条红」变成「整文件红」，看不出到底是谁在咬。加了兜底后同一次变异是 **1 failed \| 43 passed**。

### 1.2 `apps/api/test/api/device.api-spec.ts`

- **unban 用例重写**（:330，原标题「+ read 恢复可用」）：先复位 SYS_DEVICE 缓存到 `banned=false`（既有的「管理通道解封」
  真实语义通道，否则封禁态连 unban 都到不了）→ **重新登录**（`setAuth(null)` + `performHttpOpaqueLogin` +
  `seedMfaVerifiedCache`）→ 再 `PATCH …/unban` → DB/缓存双清 → `read` 20000。
  标题改成「解封不复活旧会话，重新登录后 read 恢复可用」，把新语义写进名字里。
- **ban 用例加注**（:310-315）：说明这条 ban 同时把本设备踢下线，本设备的登录态在此刻已经死了（下一条用例为什么要重新登录）。
- **文件头「关键现状」补一条**（:28-31）：ban 的「踢下线」副作用（RT 全撤 / 三类缓存键清空 / 解封不复活 / 唯一恢复路径是重新登录），
  并指向 guard-matrix 的封禁闭环（AT/RT 面的正向断言在那里）。

### 1.3 `apps/api/test/integration/helpers/global-setup.ts`（排他）

- 新增 `INTEGRATION_RUN_LOCK_KEY = 730_942_001` / `…_WAIT_MS = 120_000` / `…_POLL_MS = 1_000`。
- `createRunLockDataSource()`：**专用连接**（`database: 'postgres'`、`extra: { max: 1, min: 1, idleTimeoutMillis: 0, keepAlive: true }`）。
  advisory lock 是**会话级**的：连接一关锁就没了，pool 必须锁死 1 条连接，否则「抢锁」与「放锁」可能落到不同连接、
  unlock 静默变 no-op、或锁随空闲连接被回收而提前消失。
- `acquireIntegrationRunLock()`：`pg_try_advisory_lock($1::bigint)` 轮询；第一次失败打一行「另一个 test:integration 正在跑 —— 开始等锁」；
  超过 120s → 查 `pg_locks` × `pg_stat_activity` 打印**持锁者**（pid / user / db / addr / state / query）后 **抛错退出**。
- `releaseIntegrationRunLock()`：`pg_advisory_unlock` + `destroy()`；teardown 的 `finally` 里调用，建库失败的早退路径也放锁。
- 默认导出改成「先抢锁 → 建库（失败放锁）→ 返回 teardown（drop 库后放锁）」，排他窗口覆盖**整轮**（drop/create → 全部用例 → teardown drop）。

**与 drop/create 流程有没有冲突：没有。**锁连接连的是维护库 `postgres`（与 drop/create 的管理通道同一个库），
`DROP DATABASE … WITH (FORCE)` 只杀**目标库**上的连接；advisory lock 又按库分区，所以两个进程必须在同一个库上抢同一把锁才互斥
（这也是「锁连接必须连 postgres」的原因）。因此**没有退化成**「创建前探测 + 报错」：那种探测有 TOCTOU 窗口（探测到不存在 →
另一个进程随后建库/建表 → 本轮再 drop 掉），排不住；advisory lock 是内核里的原子状态，进程异常退出时随连接自动释放，不需要清理逻辑。

### 1.4 `apps/server/AGENTS.md`（指引）

「测试」小节补一段：**同一 worktree 同时只允许一个 `test:integration`（`test:e2e` 同理）** —— 集成库是共享单实例、
globalSetup 一进来就 drop 重建、并发跑会互删库、读数全不可信；并写明这条已由 advisory lock 机械保证（抢不到就等，超时报错并打印持锁者），
「别靠『我记得没人在跑』」。文件 6399 → 6687 字符（预算 6900，仍在内）。

### 1.5 `apps/api/test/api/permission-chain.api-spec.ts`（第 11 条既有红，见 §6）

`beforeAll` 里存下 root 的 `RT_JTI` cookie，G10 的 signout 前种回；signout 后再显式断言「root 已无现役 RT」。

## 2 integration 前后对比（同一台机、同一命令、串行独占）

| # | 时点 | 命令 | 读数 | exit |
|---|---|---|---|---|
| 前 | r1 triage 的记录 | 全量 | 10 failed（被并发污染，只有开头 2 文件可信） | — |
| 前 | 本轮动手前 | 两份 spec | 10 failed \| 45 passed（r1 的 A 臂，复现一致） | 1 |
| 中 | 只跑两份 spec（适配后，第一次） | `vitest run … device.api-spec guard-matrix.api-spec` | **55 passed / 0 failed**（2 文件） | **0** |
| 中 | 只跑两份 spec（最终版，含 finally 兜底） | 同上 | **55 passed / 0 failed** | **0** |
| 中 | 全量 #1（含未修的 G10） | `test:integration` | **2 failed \| 637 passed \| 1 skipped（640）/ 62 文件** | 1 |
| **后** | **全量 #2（最终）** | `test:integration` | **0 failed \| 639 passed \| 1 skipped（640）/ 64 文件**，883.20s | **0** |

全量 #1 的 2 条红**都不是 r1 triage 的 10 条**（详见 §6）：`permission-chain` G10（确定性）+ `concurrency` G6（偶发，单跑 6/6 绿）。
全量 #2 全绿（G10 已修；G6 本轮未复现）。

## 3 r1 的 10 条红 —— 逐条现状（全绿，行号已右移）

| # | r1 的 spec:line | 用例 | 现位置 | 状态 |
|---|---|---|---|---|
| 1 | device:335 | PATCH unban → … read 恢复可用 | device:330（用例重写） | 绿（改成「重新登录后 read 恢复」） |
| 2 | device:350 | 边界 read 不存在 uuid → 40401 | device:366 | 绿（连带解除） |
| 3 | guard-matrix:620 | 封禁闭环 restored after unban | guard-matrix:632（用例重写） | 绿（改成「unban 后旧 AT 仍 40101 → 重新登录才恢复」） |
| 4 | guard-matrix:638 | G8 设备 IP 变化回写 | guard-matrix:752 | 绿（连带解除） |
| 5 | guard-matrix:693 | 种 verified 缓存后 20000 | guard-matrix:819 | 绿（连带解除） |
| 6 | guard-matrix:749 | lock → 40118 → unlock 恢复 | guard-matrix:876 | 绿（连带解除） |
| 7 | guard-matrix:771 | G5 冷缓存 | guard-matrix:898 | 绿（连带解除） |
| 8 | guard-matrix:790 | G5 跨设备 | guard-matrix:917 | 绿（连带解除） |
| 9 | guard-matrix:957 | G7 opaque register=0 → 50301 | guard-matrix:1080 | 绿（连带解除） |
| 10 | guard-matrix:970 | G7 opaque change=0 → 50301 | guard-matrix:1093 | 绿（连带解除） |

判据：两份 spec 的文件级读数是 `2 passed (2) / 55 passed (55)` —— 文件内没有 skip、没有 failed，
所以「连带 8 条」确实随会话重建自动转绿（不是被跳过）。

## 4 新增正向断言（本轮的覆盖 gap）

r1 §4 已确认：全仓测试里**没有任何用例**断言过「ban ⇒ 撤 RT / 清会话 / 旧 AT 40101」。现在由
`guard-matrix.api-spec.ts:632` 一条用例钉住，共 6 类断言：

1. `auth_refresh_token`：现役行（`revoked = false`）归零，且存在 `revoke_reason = 'deviceBanned'` 的行；
2. Redis `WALNUT_CACHE_AUTH:SESSIONS:<user>:<device>:*` 扫为空（按 pattern，覆盖**全部**会话）；
3. `WALNUT_CACHE_AUTH_MFA_VERIFIED:<user>:<device>` 消失（这也是「40101 先于 40115」的依据）；
4. 封禁态：本设备 **40607**，`POST /auth/refresh` 也 **40607**；
5. 解封后：旧 AT **40101**、旧 RT 换 AT **40102**；判别对见 §1.1（旧 AT 40101 vs 新 AT 40401）；
6. **变异可用**：关掉 kick ⇒ 该用例在「现役 RT 归零」这一步红（`expected 1 to be +0`），其余 43 条不受连带。

## 5 排他机制的实测（不是「加了代码就宣布生效」）

| 实验 | 做法 | 结果 | 日志 |
|---|---|---|---|
| A 等锁路径 | 用 `pg` 客户端在 `postgres` 库上 `pg_try_advisory_lock(730942001)` 持锁 40s，随后起一次 integration | 跑批打印「另一个 test:integration 正在跑 —— 开始等锁（key=…，最长 120s）」，**等 36s 后拿到锁**并跑完（device.api-spec 11/11 绿，exit 0） | `r4-lock-wait-path.log` |
| B 超时路径 | 临时把 `…_WAIT_MS` 调到 8s（跑完已还原 120s），持锁 45s，起一次 integration | **exit 1** + `等锁超时（8s）… 持锁者：pid=627476 app= user=walnut db=postgres addr=172.18.0.1 state=idle query=SELECT pg_try_advisory_lock($1::bigint) …` + 指向 AGENTS.md | `r4-lock-timeout-path.log` |
| C 正常路径 | 无人持锁 | 打印「已拿到排他锁（key=730942001，等待 0s）」，不改变任何既有读数（全量 #2 = 0 failed） | `r4-integration-full-run2.log` |

> B 里的 8s 只用于验证报错分支，**终态是 120s**（已核对 `global-setup.ts:97`）。
> vitest 对 globalSetup 的调用**没有超时包装**（`cli-api.*.js:10727` `await globalSetupFile.setup?.(this)`），
> 所以「等锁 120s」不会被 hookTimeout 打断。

## 6 顺手发现并处理的问题（不在 r1 的 10 条里）

### 6.1 已修：`permission-chain.api-spec.ts` G10（确定性、既有、与本批改动无关）

- **现象**：全量 #1 里 G10 在**重新登录**处 `[auth-login] login failed: code=40109`（DuplicateSignIn）。
- **确定性证据**：与我的两个 spec 无关 —— 只跑 `concurrency + permission-chain` 两个文件（都不含我改的 spec）仍然 1 failed；
  用 `-t "G10 root SWITCH"` 跳过其余 14 条用例仍然 1 failed（beforeAll 才是根因所在）。
- **根因**：`431938ab` 的 B7「凭 RT 登出」让 `POST /auth/signout` 按 **RT cookie 对应行的 userId/deviceId** 认人（AT 不再参与）。
  而该 spec 的 `beforeAll`（:126-130）为了省 `device/initial` 的 throttle 配额，让 visitor **复用 admin 的同一台设备**登录 ——
  jar 里的 `RT_JTI` 因此变成 visitor 的；之后只 `admin.setAuth(rootTokens)` 换 AT、不换 cookie。
  于是 G10 的 signout 撤的是 **visitor** 的 RT，root 的现役 RT 还在 ⇒ root 重登撞 40109。
- **判定**：与 r1 的 10 条**同一类**——spec 编码了「signout 用 AT 认人」的旧语义；r1 的全量基线被并发污染，所以这条没人看到。
- **修法（只动测试，不动产品）**：`beforeAll` 在 visitor 登录**前**存下 root 的 `RT_JTI`（`rootRtCookie`），
  G10 signout 前 `admin.setCookie(RT_JTI, rootRtCookie)` 种回；signout 后加一条「root 已无现役 RT」的显式断言，
  让以后若再撤错人，失败点落在**原因**上而不是下游的 40109。
- **验证**：单跑该文件 **15/15 绿**（`r4-permission-chain-fixed.log`），全量 #2 里也绿。

### 6.2 未修（建议单列排期）：`concurrency.api-spec.ts` G6（偶发、既有）

- **现象**（全量 #1）：`expected 3 to be 1003` —— rotate 没命中自插的高 version 种子行（`MAX+1000`），
  而是按 version 2 轮换出 3。断言本身没坏，是**种子行对轮换事务不可见**。
- **判据**：单跑该文件 **6/6 绿**（`r4-failing-two-files-alone.log`），全量 #2 也绿 ⇒ 与全量顺序/时序相关，**不是我引入的**，也不是确定性 bug。
- **可疑方向**（未验证，别当结论）：应用连接池上**会话级 RLS GUC 残留**会让「造种子的那条连接」与「轮换事务那条连接」看到不同的 `app_key` 行
  （该 spec 自己的注释就记过「管理连接是独立池，种子行来不及被事务看到」）。要根治得单独开一条：用固定连接造种子 / 显式 `SET LOCAL` 复位。
- **对验收的影响**：全量读数**不再稳定**（可能偶发 1 failed）。建议后续把它当作 flake 正式修掉，而不是按「今天绿了」结案。

## 7 我做了什么 / 没做什么

- 改：`guard-matrix.api-spec.ts` · `device.api-spec.ts` · `permission-chain.api-spec.ts` · `integration/helpers/global-setup.ts` · `apps/server/AGENTS.md`。
- **没改**：任何产品代码（`device.service.ts` 只在变异测试期间被临时改，已用逆操作还原，`git diff` 为空）。
- **没做**：`git commit` / `git checkout` / `git stash` / 删库（集成库只由 globalSetup 自己 drop/create）。
- 一次性调试资产已移出仓库：`zz-debug-g10.api-spec.ts` → `%TEMP%\walnut-zz-debug-g10.api-spec.ts.bak`；
  锁探针脚本在 `%TEMP%\walnut-lock-probe.js`（两者都不在 worktree 里）。

## 8 复现命令（照抄即可）

```bash
# 0) 单测基线（790）
cmd /c "pnpm --filter @walnut/server test"

# 1) 只跑本轮改的两个 spec（55 条）
cmd /c "pnpm --filter @walnut/server exec vitest run --config ./apps/api/vitest.config.integration.ts apps/api/test/api/device.api-spec.ts apps/api/test/api/guard-matrix.api-spec.ts"

# 2) 全量 integration（640 条；本轮终态 0 failed）
cmd /c "pnpm --filter @walnut/server test:integration 2>&1"

# 3) 变异测试（新正向断言必须有牙）：把 device.service.ts:243 改成 if (false && patch.banned === true) {
#    然后只跑 guard-matrix → 期望 1 failed | 43 passed；改回后 44/44
cmd /c "pnpm --filter @walnut/server exec vitest run --config ./apps/api/vitest.config.integration.ts apps/api/test/api/guard-matrix.api-spec.ts"

# 4) 排他机制（可选）：先持锁再起跑批，观察「开始等锁 → 等 Ns → 继续」
$env:NODE_PATH='apps\server\node_modules'; node "$env:TEMP\walnut-lock-probe.js" . 40000 730942001
```

## 9 日志索引（都在本目录）

| 文件 | 内容 |
|---|---|
| `r4-unit-baseline.log` / `r4-unit-after.log` | 单测 790（改前 / 改后） |
| `r4-two-specs-run1.log` / `r4-two-specs-run2.log` | 两份 spec 55 passed（第一次 / 最终版） |
| `r4-mutation-kick-off-guard-matrix.log` | 变异测试（1 failed \| 43 passed） |
| `r4-lock-wait-path.log` / `r4-lock-timeout-path.log` | 排他：等锁路径 / 超时路径 |
| `r4-integration-full.log` | 全量 #1（2 failed：G10 + G6） |
| `r4-integration-full-run2.log` | **全量 #2（终态：0 failed）** |
| `r4-failing-two-files-alone.log` | 归因：两文件单独跑（concurrency 绿、permission-chain 红） |
| `r4-g10-isolated-case.log` | 归因：`-t "G10"` 仍红（根因在 beforeAll） |
| `r4-permission-chain-fixed.log` | 修后 permission-chain 15/15 绿 |
| `r4-debug-g10.log` | 一次性调试 spec 的输出（signout 行级证据；spec 已移出仓库） |
| `r4-types-check.log` / `r4-lint.log` / `r4-boundaries.log` | 三道门禁 |
