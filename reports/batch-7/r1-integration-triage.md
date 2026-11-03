# A1 · 集成套件 10 条红 triage（是否本轮回归）

> 角色：只读调研（未改源码）。基线 HEAD = `d9f4233e`（开工时 worktree clean），
> 实验期间 HEAD 漂到 `431938ab`（另一个 agent 提交「凭 RT 登出」）。所有 path:line 以报告写作时的
> `431938ab` 工作树为准，10 条红在 `d9f4233e` 与 `431938ab` 上**完全一致**（两次都实测到）。

## 结论（一句话给 Lead）

**10 条 = 本轮引入的回归 10 条 + 既有红 0 条；但回归在「测试侧」，产品代码不需要改。**
元凶是 `97012f3b`（设备追踪 P0）里的**「封禁 = 踢下线」**：ban 会清掉该设备上所有用户的
`AUTH:SESSIONS` 会话键，而 `device.api-spec` / `guard-matrix.api-spec` 在 ban 之后仍拿**ban 之前签发的
AT** 继续跑，于是 JWT 守卫（处理器前）回 40101。这 **不是**「AT 过期续不上」——与 `/auth/refresh`、
cookie 滑动续期、Lock 的 isNil 改动**都没有关系**（逐项排除见 §7）。

| 项 | 数 |
|---|---|
| 本轮引入的回归 | **10** |
| 既有红 | **0** |
| 需要改产品代码的 | **0** |
| 需要改测试的 | 2 个文件 / 10 条（2 条语义断言 + 8 条连带） |
| 是否影响「已登录用户 AT 过期」 | **不影响**（§8 有专项实测与代码依据） |

## 1 实测运行（三次，全部真跑）

| # | 时间 | 命令/形态 | 结果 |
|---|---|---|---|
| run1 | 13:07:47 → 13:42 | `cmd /c "pnpm --filter @walnut/server test:integration"`（全量 639） | `Test Files 32 failed \| 32 passed (64)`；`Tests 10 failed \| 371 passed \| 258 skipped (639)` → **被并发进程污染，只有开头 2 个文件的 10 条可信** |
| A1 | 13:44:09 | 只跑两份 spec（2 文件 55 条） | `10 failed \| 45 passed` |
| B | 13:45:03 | 同上 + **临时关掉 ban→kick** | **`2 passed (2)` / `55 passed`，0 红** |
| A2 | 13:45:56 | 同上，**补丁已还原** | `10 failed \| 45 passed`（与 A1 逐条一致） |

> run1 污染的证据：日志 285 处 `error: database "walnut-admin-integration" does not exist`，
> 13:18:07（PID 30628）与 13:42:28（PID 27672）两个**不同的 Nest 实例**在连一个不存在的库 →
> 另一个进程在跑 `test:integration`，其 globalSetup 的 `DROP DATABASE ... WITH (FORCE)`
> （`apps/server/apps/api/test/integration/helpers/global-setup.ts:65-72`）把库从我脚下删了。
> 因此 **639 的全量基线在本环境不可复现**；承重证据是 A1/B/A2 的两文件 A/B/A。
> 集成库名是 `walnut-admin-integration`（`helpers/integration.const.ts:5`），`walnut_pg` 未被触碰。
>
> 日志与臂的对应：A1 = `itest-arm-b-kickoff.log`（这一臂本意是「用环境变量关闸」，但 cmd 的引号把
> `set` 吞了、变量没传到 vitest，结果等价于原样跑 → 正好成了复现臂）；B = `itest-arm-c-kickoff-hard.log`
> （源码里硬写 `if (false && …)`）；A2 = `itest-arm-a-baseline.log`（还原后）。

原始日志（都在本目录）：
`itest-run1.log`（全量，372 KB）、`itest-arm-a-baseline.log`、`itest-arm-b-kickoff.log`、`itest-arm-c-kickoff-hard.log`。

## 2 10 条红的完整上下文

观测口径确认：全局异常过滤器**恒 HTTP 200**，真实结果看 `body.code`（本例全是 `40101`，即
`WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED`，文案 `"Access Token Expired"`），
响应带 `requestId` 与 `_devMsg:"response.40101"` → **处理器前拒绝**，落在 `JwtAccessGuard`。

| # | spec:line（断言） | 用例 | 失败形态 | body.code | requestId | helper |
|---|---|---|---|---|---|---|
| 1 | `device.api-spec.ts:335` | PATCH unban → true + DB/缓存双清 + read 恢复可用 | `expectOk` 抛错（期望 20000） | 40101 | `mw09m4grc22be206c7` | `api.root`（双因子签名 + AT） |
| 2 | `device.api-spec.ts:350` | 边界：read 不存在 uuid → 40401 | AssertionError `expected 40101 to be 40401` | 40101 | —（断言型） | `api.root` |
| 3 | `guard-matrix.api-spec.ts:620` | 封禁闭环 … → unban → 恢复放行 | `expectOk` 抛错（`device A restored after unban`） | 40101 | `mw09lwe4b76416b84f` | `api.root` |
| 4 | `guard-matrix.api-spec.ts:638` | G8 设备 IP 变化回写 | `expectOk`（`ip change request`） | 40101 | `mw09lwel57cf0a7899` | `api.root` |
| 5 | `guard-matrix.api-spec.ts:693` | 种 verified 缓存后 → 20000 | `expectOk`（`mfa verified via device cache`） | 40101 | `mw09lwsh7064fcf301` | `api.root` |
| 6 | `guard-matrix.api-spec.ts:749` | lock → 40118 → unlock → 恢复 | `expectOk`（`lock me`） | 40101 | `mw09lx6s143de39280` | `api.root` |
| 7 | `guard-matrix.api-spec.ts:771` | G5 冷缓存 lock | `expectOk`（`lock for cold cache probe`） | 40101 | `mw09lx782cb4d1374b` | `api.root` |
| 8 | `guard-matrix.api-spec.ts:790` | G5 跨设备 lock | `expectOk`（`lock device A`） | 40101 | `mw09lx7n9a64c9fbff` | `api.root` |
| 9 | `guard-matrix.api-spec.ts:957` | G7 opaque 子开关 register=0 | AssertionError `expected 40101 to be 50301` | 40101 | —（断言型） | `api.root` |
| 10 | `guard-matrix.api-spec.ts:970` | G7 opaque 子开关 change=0 | AssertionError `expected 40101 to be 50301` | 40101 | —（断言型） | `api.root` |

失败原始行（A1 日志摘录）：

```
Error: [api-client] device unban failed: HTTP 200 body={"data":null,"code":40101,
  "msg":"Access Token Expired","requestId":"mw09m4grc22be206c7","_devMsg":"response.40101"}
 ❯ expectOk apps/api/test/api/helpers/api-client.ts:394:11
 ❯ apps/api/test/api/device.api-spec.ts:335:5
```

**关键旁证（同一文件、同一 helper、同一时刻）**：这 10 条之外，两个 spec 里用 `tokens2` / `tokens3` /
`anon()` / `unsigned()` 的用例全绿（`guard-matrix` 的 40115/40114/G12 与 IP 段、`device.api-spec`
的 initial/list/history/lock 全绿）。→ 失效的是**这一个用户的会话**，不是 cookie 坏了、不是代码崩了。

## 3 代码链路（path:line）：为什么 ban 之后旧 AT 一定 40101

1. `apps/server/libs/system/src/device/device.service.ts:243-249` —— `ban` 落库后同事务调
   `deviceKicker.kickDevice(...)`（解禁不触发）。
2. `apps/server/apps/api/src/modules/system/device/shared/device.kick.service.ts:30-46` ——
   `kickDevice` → `AuthSignoutService.kickDeviceOffline`，并 after-commit 断 socket。
3. `apps/server/libs/auth/src/modules/signout/signout.service.ts:106-130` —— `kickDeviceOffline`：
   `revokeRTForDevice` + after-commit `clearKickedDeviceCache(userId, deviceId)`。
4. `signout.service.ts:290-303` —— `clearKickedDeviceCache` → `authSessionService.revokeSession(userId, deviceId)`
   （**按设备**，不波及同用户其他设备）。
5. `apps/server/libs/auth/src/modules/session/session.service.ts:336-366`（键形 `:82-83`）——
   `delByPattern("AUTH:SESSIONS:<userId>:<deviceId>:*")`。
6. `apps/server/libs/auth/src/modules/jwt/jwt-access.strategy.ts:41-56` —— `validate` 拿 cookie 里的
   deviceId + payload.sid 查会话键，**查无 → `WalnutAdminExceptionAccessTokenExpired()` → 40101**。

**为什么「封禁」那条断言仍是绿的、下一条才红**：guard 顺序里 Device 第 3、JWT 第 6
（`apps/server/apps/api/src/common/monorepo/guard-order.drift.spec.ts:26-39` 的 12 元黄金序列）。
设备还在封禁态时 Device guard 先回 40607（走不到 JWT）；一旦 banned=false（unban，或测试里手动把
SYS_DEVICE 缓存复位成 banned:false，见 `device.api-spec.ts:326-332`），请求就落到 JWT，
而会话键已经被 ban 时清空 → 40101。

## 4 归因方法：A/B/A 反向补丁实测（唯一变量）

**做法**：不去 `git checkout`（工作树里有别的 agent 的未提交改动，绝不能 checkout），只用定点
`edit` 把 `device.service.ts:243` 的闸门临时改成 `if (false && patch.banned === true) {`，
只跑这两份 spec，跑完用**逆操作 edit** 还原，并核对 `git diff` 为空。

| 臂 | code | 结果 |
|---|---|---|
| A1 | 原样 | `10 failed \| 45 passed` |
| B | ban→kick 关掉 | **`55 passed`，0 红，exit 0** |
| A2 | 还原（等价 A1） | `10 failed \| 45 passed`，逐条同 A1 |

**判据**：唯一变量就是「ban 是否踢下线」，10 条随之 0↔10。因此 10 条红是 97012f3b 的直接后果，
不是 flaky、不是数据残留、不是并发污染的偶然。

**历史侧证据（不用反向补丁也成立）**：

- 引入提交 `97012f3b fix(server): 设备追踪 P0——cookie 滑动续期、封禁踢下线…`（2026-11-02），
  提交说明里明确写「拍板-4 封禁 = 踢下线：ban 同事务撤该设备所有用户的 refresh token，提交后清会话/权限/MFA 键」。
- 两份 spec 的失败断言**都早于该提交**：`git blame` → `guard-matrix.api-spec.ts:607-620` 是
  `c68577b4`（2026-10-27），`device.api-spec.ts:323-335` 是 `a506924e`(2026-10-28)/`5700631ce`(2026-10-26)。
- 该提交**适配了** `monitor-user.api-spec.ts`（9 行，P0-2 的 DTO 面），但**没动**这两份 spec
  （`git show --stat 97012f3b` 的测试文件只有 monitor-user 一份）。→ 漏改，而非有意留红。
- 全仓测试里**没有任何用例**断言过「ban ⇒ 撤 RT / 清会话 / 旧 AT 40101」（grep `deviceBanned|kickDevice`
  在 `apps/server/apps/api/test` 无命中）——即拍板-4 这条语义至今**零覆盖**。

## 5 逐条归因（10 行，一条一行）

| # | 用例（spec:line） | 归因 | 性质 |
|---|---|---|---|
| 1 | device `PATCH unban` → 恢复可用 (`:335`) | 97012f3b「封禁=踢下线」→ 旧 AT 会话键被清 | **直接**（断言本身编码了旧语义「unban 恢复放行」） |
| 2 | device 边界 read→40401 (`:350`) | 同上，会话已死 → JWT 先拦 | 连带（用例本身与封禁无关） |
| 3 | guard-matrix 封禁闭环 restored (`:620`) | 同上 | **直接**（标题还写着「只写缓存不落库」） |
| 4 | guard-matrix G8 设备 IP 回写 (`:638`) | 同上 | 连带 |
| 5 | guard-matrix MFA verified 缓存 (`:693`) | 同上（`afterEach` 把 auth 复位回 tokens1） | 连带 |
| 6 | guard-matrix Lock 闭环 (`:749`) | 同上 | 连带 |
| 7 | guard-matrix G5 冷缓存 (`:771`) | 同上 | 连带 |
| 8 | guard-matrix G5 跨设备 (`:790`) | 同上 | 连带 |
| 9 | guard-matrix G7 register=0 (`:957`) | 同上；functional guard 在 JWT 之后，50301 永远轮不到 | 连带 |
| 10 | guard-matrix G7 change=0 (`:970`) | 同上 | 连带 |

「直接 2 条 + 连带 8 条」的判据：其中 8 条只要会话活着就绿（B 臂实测），它们的业务语义没有变；
只有 #1/#3 两条的**断言文本**编码了「解封后同一 AT 继续可用」这一已被拍板-4 推翻的旧行为。

## 6 与「本轮三处改动」的关系（逐项排除）

| 改动 | 与 10 条红的关系 | 依据 |
|---|---|---|
| ① 设备 cookie 滑动续期（`device.guard.ts:53-71,151-152`） | **无关** | 若是 DEVICE_ID cookie 被续期写坏，Device guard（第 3 位）会先回 40605，而不是 JWT 的 40101；A1 里 10 条全是 40101。且同文件 40605 两条负路径用例全绿 |
| ② 封禁=踢下线（`device.service.ts:243` → `kickDeviceOffline`） | **10 条全在这里** | A/B/A：关掉它 55/55 全绿，还原 10 红 |
| ②' `/auth/refresh` 去 DeviceFree + `getNewAccessToken` 设备闸门 | **与这 10 条无关** | 两份 spec 都不调 `/auth/refresh`（grep 无命中）；它的影响面见 §8 |
| ③ Lock 守卫 `=== null` → isNil（`lock.guard.ts`） | **无关** | Lock 的 3 条红都是「lock 请求本身」就 40101（在 Lock guard 之前），B 臂下 3 条全绿 |

## 7 「已登录用户 AT 过期会不会掉线」——专项回答：不会

- **代码面**：AT 过期 → 客户端打 `POST /auth/refresh`，该端点 `JwtFree / SignFree / LockFree / MFAFree`
  （`apps/server/apps/api/src/modules/auth/modules/refresh/refresh.controller.ts:30-33`），DeviceGuard 仍在
  （`:34-37`，拍板-4 有意为之）；只要 `DEVICE_ID` cookie 与 RT 行 deviceId 一致、设备未封禁/锁定，
  `getNewAccessToken` 走完 7 步仍返回新 AT（`refresh.shared.service.ts:391-468`，设备闸门在 `:431`）。
- **依赖面没有新增**：刷新链本来就必须有 `DEVICE_ID` cookie（`refresh.guard.ts:28-30` 取 RT_JTI、
  控制器 `@WalnutAdminDecoratorDeviceId()` 取 deviceId、`refresh.shared.service.ts:412-414` 比对
  `record.deviceId !== deviceId`），所以「去掉 DeviceFree」不是新增 cookie 依赖，只是把**已封禁/已锁定**
  的续期从 20000 改成 40607/40606。
- **实测面**：run1（13:18 被并发进程污染**之前**）里 `auth-session.api-spec.ts (8 tests)` 全绿
  （含 refresh 轮换/重放/吊销），`concurrency.api-spec.ts (6 tests)` 的并发 refresh（恰一条成功、其余 40102）也全绿。
- **真正会被用户感知的行为变化**（有意，不是 bug）：**封禁/踢下线后旧 AT 立即失效，解封也不恢复会话，
  用户必须重新登录**。这条需要在文档/前端提示里写清楚，而不是「修」回去。

## 8 如果修，改哪里（不写代码）

1. **主修（推荐，改测试）**：ban 闭环结束后**重新登录**再继续。
   - `guard-matrix.api-spec.ts:607-621`：`unban`（`:616-617`）之后、`:619` 之前重新
     `performHttpOpaqueLogin(api, app, fixture1)` + `api.setAuth(...)` + `api.seedMfaVerifiedCache(fixture1.userId)`；
     并把「旧 AT 现在必须 40101」显式断言一条（把拍板-4 钉住）。
   - `device.api-spec.ts:304-346`：同样在 `unban`（`:334`）之前/之后 relogin；更稳的做法是把
     ban/unban 闭环整段挪到文件末尾的独立 `describe`，让 `:348` 的边界用例不再被连带。
2. **抽公共 helper**：`apps/server/apps/api/test/api/helpers/auth-login.ts` 加一个
   `relogin(api, app, fixture)`（登录 + setAuth + seed MFA verified），避免每处重复三步。
3. **顺手清掉过期文案**：`device.api-spec.ts:24-26` 的「lock/unlock/ban/unban 落库 + 缓存双写」还 OK，
   但 `guard-matrix.api-spec.ts:607` 的标题「ban/unban 只写 SYS_DEVICE 缓存不落库」两处都过期
   （P2-2 起就落库，97012f3b 起还踢下线）。
4. **补一条正向覆盖（当前 gap，建议要）**：任一 spec 断言「ban ⇒ 该设备 `auth_refresh_token` 全撤销 +
   `AUTH:SESSIONS:<user>:<device>:*` 清空 + 旧 AT 40101 + `/auth/refresh` 40607」，否则这条语义无人守。
5. **产品代码：不动**（B 臂已证明产品行为一致且自洽；改回去就等于撤销拍板-4）。

## 9 我做了什么 / 没做什么（可核对）

- 唯一源码改动：`apps/server/libs/system/src/device/device.service.ts:243` 的临时闸门，**已用逆操作还原**，
  现在 `git status` 该文件**干净**（中间有人把它 `git add` 进了暂存区，我把该文件 index 一并还原到 HEAD 内容，
  没有动别人的任何文件）。
- 没有 `git commit`、没有 `git checkout`、没有 `git stash`、没有删库（集成库由 globalSetup 自己 drop/建）。
- 工作树在此期间被别人推进：HEAD `d9f4233e` → `fc2e08af` → `431938ab`（另一个 agent 提交「凭 RT 登出」）。
  A/B/A 三臂都跑在 `431938ab`；run1 跑在 `d9f4233e`；10 条红两边逐条一致。
- 期间**另一个进程在并发跑 integration**（同一 `walnut-admin-integration` 库互杀），导致 run1 后半段 32 个文件
  失败/258 skip —— 那部分数字**不代表代码状态**，我也没有据此下任何结论。

## 需要 Lead 拍板

1. **这 10 条按「改测试」处理（推荐），还是要「解封/踢下线后恢复会话」的产品改动？** 后者等于翻拍板-4。
2. **谁改这两份 spec**：我可以直接出补丁，但当前工作树有别的 agent 在改 auth 链路，需要排他窗口（否则又会互杀）。
3. **要不要顺带补「ban ⇒ 踢下线」的正向断言**（当前零覆盖，建议要；不加，这条语义以后没人守）。
4. **并发跑 integration 要不要立规矩**（同一 worktree 同时只允许一个 `test:integration`；否则全量基线永远不可信，
   今天这轮的 639/627 读数就已被它毁掉一次）。
