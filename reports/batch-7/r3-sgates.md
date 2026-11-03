# 批次 7 · R3：四条 S 级门禁/链路修复（C1 / C2 / C4 / B7）

> **基线**：HEAD `d9f4233e`（工作树起点 clean）。**本次没有 commit**（按要求）。
> **环境事实（影响归因，先说清）**：我进场后另一个 Agent 正在改 `apps/server/apps/api/src/main.ts`、
> `apps/server/libs/security/src/cap/*`（SIGTERM 批）并新增 `reports/batch-9/`、`.sigterm-probe/`；
> 中途还有一个 `vitest run --config ./apps/api/vitest.config.integration.ts`（**全量 integration**，
> PID 19076，13:07:46 起、本报告收尾时仍在跑）在**同一个 integration 库**上并行跑。后者直接决定了
> §6 里 guard-matrix / permission-chain 的「级联失败」——不是本批改动引入的，证据见 §6。
> 本报告只认「我改的文件」，逐条列在 §0。
>
> 观测口径：全局异常过滤器**永远回 HTTP 200**，真实结果是 `body.code`（崩溃 50000 / 校验拒绝 40099 /
> 鉴权 40101 / MFA 40114 / 设备 40607 …）。

## 0 总表

| 条 | 改动落点 | 负对照（先红 → 后绿） | 门禁 |
|---|---|---|---|
| **C1** guard 顺序写进 AGENTS | `apps/server/AGENTS.md:114-116` | 扰动黄金序列 → `Tests 1 failed \| 3 passed (4)`；还原后 4/4（`git diff` 空） | `lint:doc-budget` 93%（6399/6900）；server 单测 790/790 |
| **C2** exports 的 `*` 跨 `/` | `packages/tooling/scripts/src/ci/check-package-exports.ts:106-136,193-194`；用例 `…/__tests__/check-package-exports.test.ts:87-98` | 新用例先红：`AssertionError: expected [ { …(3) } ] to deeply equal []`（rule `exports-glob-matches`）→ 修后 19/19 | scripts 528/528；`lint:exports` exit 0；`check-turbo-cache` 43/43（共用函数未动） |
| **C4** prepush 加 `test` 段 | `packages/tooling/scripts/src/ci/prepush.ts:109-115`；顺序表 `…/__tests__/prepush.test.ts:136` | 删掉该行 → `prepush.test.ts` 红（`Tests 1 failed \| 27 passed (28)`，gate-wiring 仍绿）；还原后 28/28 | scripts 528/528；gate-wiring 18/18；release 202/202（电池侧**本来就有**，见 §3） |
| **B7** signout 缺 `JwtFree` | `apps/server/apps/api/src/modules/auth/auth.controller.ts:45-74`、`libs/auth/src/auth.service.ts:18-31`、`libs/auth/src/modules/signout/signout.service.ts:60-90`、`libs/auth/src/modules/refresh/shared/refresh.shared.service.ts:112-124`；用例 `apps/api/test/api/auth-session.api-spec.ts:358-407` | 修前该 api-spec：`Tests 1 failed \| 8 passed`，失败正是 `signout with expired AT failed: … code 40101`；修后 **9/9** | api-spec auth-session 9/9（跑两次）；server 790/790；types:check 15/15；lint 15/15；boundaries 4676 files / 15 包 |

**我的改动文件全集**（`git status` 里其余条目属于并行 Agent，我没碰）：

```
apps/server/AGENTS.md
apps/server/apps/api/src/modules/auth/auth.controller.ts
apps/server/libs/auth/src/auth.service.ts
apps/server/libs/auth/src/modules/signout/signout.service.ts
apps/server/libs/auth/src/modules/refresh/shared/refresh.shared.service.ts
apps/server/apps/api/test/api/auth-session.api-spec.ts
apps/server/apps/api/test/api/ENDPOINTS.md
apps/server/openapi.json                                （生成物，重新导出）
apps/docs/src/zh-CN/content/backend/modules/auth.md
apps/docs/src/zh-CN/content/review/backend/api-catalog.md
packages/tooling/scripts/src/ci/check-package-exports.ts
packages/tooling/scripts/src/ci/__tests__/check-package-exports.test.ts
packages/tooling/scripts/src/ci/prepush.ts
packages/tooling/scripts/src/ci/__tests__/prepush.test.ts
reports/batch-7/r3-sgates.md + reports/batch-7/logs/**  （本报告与本次的全部门禁日志）
```

---

## 1 C1：把「改 guard 顺序必须同步 drift spec」写进 `apps/server/AGENTS.md`

### 1.1 改了什么

`apps/server/AGENTS.md:114-116`（`## Security Guard 执行顺序` 小节内，紧接原有「定义在 `app.module.ts`…」）：

```md
**改这个顺序必须同步 `apps/server/apps/api/src/common/monorepo/guard-order.drift.spec.ts`**：
它按「模块扫描序 × providers 数组序」把 APP_GUARD 摊平后与那份 12 元黄金序列逐位比对，
只改装配不改它必红，只改它不改装配则是自欺（顺序的真源是装配，不是 spec）。
```

为什么指向**那个文件**而不是复述序列：顺序的真源有两处（`app.module.ts` 的 `APP_GUARD` 数组 +
`tech.module.ts` 的第 12 位），spec 是唯一把它们**按 Nest 的模块扫描序复算**出来的机械判据
（`guard-order.drift.spec.ts:1-17` 的头注释已解释 scanner 的追加语义）。写进 AGENTS 的是**纪律 +
指针**，不是第二份序列——第二份序列会漂移。

**根 `AGENTS.md` 一个字没动**：`pnpm lint:doc-budget` 实测 `96% 8312 / 8700 AGENTS.md`
（§5 原文），再塞内容必红。`apps/server/AGENTS.md` 的预算是 6900，本次 6215 → 6399（93%），安全。

### 1.2 负对照：「这条纪律守得住」怎么证明

纪律本身没法机械验，**它指向的 spec 有牙**可以验。做法：把 spec 里黄金序列的
`WalnutAdminGuardMFA` / `WalnutAdminGuardSign` 互换一位（模拟「装配没改、spec 被手改」），跑：

```
$ pnpm --filter @walnut/server exec vitest run --config ./apps/api/vitest.config.ts guard-order.drift
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```

失败点正是「12 条 APP_GUARD 的 useClass 序列逐位等于黄金表」；随后逐字还原，
`git diff -- apps/server/apps/api/src/common/monorepo/guard-order.drift.spec.ts` 为空串。
（日志：`reports/batch-7/logs/c1-negative-control.log`。）

反方向（只改 spec 不改装配）不会被 spec 自己拦 —— 这正是 AGENTS 里那句「只改它不改装配则是自欺」
要说的：纪律的价值在于让「改装配的人」知道必须同时动 spec，而不是让 spec 变成真源。

---

## 2 C2：`exports-glob-matches` 的 `*` 语义对齐 Node（跨 `/`）

### 2.1 先确认「删桶之后它为什么是绿的」（任务要求的前置事实）

实测（本机当前树）：

```
$ node -e "console.log(JSON.stringify(require('./packages/platform-web/client/package.json').exports))"
{""./*":"./src/*.ts","./types/*":"./src/types/*.d.ts"}
$ Get-ChildItem packages/platform-web/client/src -Filter *.ts -Name
queue.test.ts
queue.ts
regex.test.ts
regex.ts
```

即：`@walnut/client` 的 `./*` → `./src/*.ts`。旧实现把 `*` 当**单段**（`[^/]*`），
所以它只可能在 `src/` **根下**找 `.ts`；批次 4 删掉 `src/index.ts` 时这条当场红过
（`reports/batch-4/r2-packages.md:377-394` 原文留档），后来 `queue.ts` / `regex.ts` 落在
`src/` 根下，它**自己变绿了**。

也就是说：**现在的绿是「根下恰好有文件」的巧合，不是语义对了**。Node 的真实语义是
「目标里的 `*` 替换成子路径匹配到的那一段，那一段可以含 `/`」——`client/browser/cookie`
正是靠它解析到 `src/browser/cookie.ts`。旧实现从来没考过这种跨段解析。

### 2.2 改了什么

- 新增 `exportsPatternMatches(pattern, cwd)`（`check-package-exports.ts:106-136`）：
  取「第一个 `*` 之前、最后一个 `/` 之前」的**静态前缀**当根 → `readdirSync(root, { recursive: true,
  withFileTypes: true })` 递归列文件 → 把剩余模式转正则（`*` → `.*`，其余字符按字面量转义）逐个试；
  **只算命中文件**（目录不算），且至少命中一个即通过。
- `collectFindings` 的**通配分支**改用新函数（`:193-194`）。字面量分支仍走 `globMatchesSomething`
  （等价于 `existsSync`）。
- **`globMatchesSomething` 一行没改**：它是「文件 glob」语义（`*` = 单段），对 turbo 的
  `inputs` / `outputs` 是对的。两套语义分开，注释写在文件头 `关键取舍`（`:34-38`）与函数头上。

### 2.3 用例（先红后绿，都是这次新加的）

`check-package-exports.test.ts:87-98`：

```ts
it('通配符跨段命中（`*` 可以匹配 `/`，与 Node 的 exports 子路径模式一致）', () => {
  const { cwd, ignore } = fixture(['pkg/src/browser/cookie.ts'])
  expect(collectFindings([pkg('pkg', { './*': './src/*.ts' })], ignore, cwd)).toEqual([])
})

it('跨段通配不是「随便命中」：扩展名不符仍然红', () => {
  const { cwd, ignore } = fixture(['pkg/src/browser/cookie.js'])
  expect(collectFindings([pkg('pkg', { './*': './src/*.ts' })], ignore, cwd).map(f => f.rule))
    .toEqual(['exports-glob-matches'])
})
```

**修前（第一次跑，只有第一条红）**：

```
 × 通配符跨段命中（`*` 可以匹配 `/`，与 Node 的 exports 子路径模式一致） 17ms
 FAIL  src/ci/__tests__/check-package-exports.test.ts > collectFindings —— 夹具包（负对照） > 通配符跨段命中…
 AssertionError: expected [ { …(3) } ] to deeply equal []
 +     "rule": "exports-glob-matches",
 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
```

**修后**：`19 passed (19)`；同一轮里 `check-turbo-cache.test.ts` **43 passed**（证明共用函数的
turbo 语义没被带歪）。第二条是「负向」，防的是「跨段」被修成「什么都能过」。

### 2.4 真仓复验

`pnpm lint:exports` exit 0（`✅ 目标都存在 / 通配都有命中 / `types` 条件在前 / 与顶层 main·types 不矛盾`），
即修复没有把真仓变红；同时 `@walnut/client` 的跨段解析**现在是被覆盖的**（不再是巧合绿）。

---

## 3 C4：prepush 加 `test` 段（四个地方同时改，其中三处本来就已经有）

### 3.1 改了什么

- `packages/tooling/scripts/src/ci/prepush.ts:109-115` 新增一段（位置对齐发版电池：`types-root` 之后、
  `syncpack` 之前）：

```ts
{
  id: 'test',
  label: '测试（turbo run test，不排任何包）',
  argv: ['exec', 'turbo', 'run', 'test'],
  why: '**这一段的缺位被实测抓到过**（2026-11 · 批次 2 R3）：… prepush 当时 25 段里没有它，于是红着照样推得出去…',
}
```

- `packages/tooling/scripts/src/ci/__tests__/prepush.test.ts:136`：表的顺序断言加 `'test'`。

### 3.2 另外三处：**已经在**，本次不重复加（逐条给证据）

| 地方 | 现状 | 证据 |
|---|---|---|
| `packages/tooling/release/src/release/steps.ts` | **已有** `{ id: 'test', … argv: ['exec','turbo','run','test'] }` | `steps.ts:78` |
| `packages/tooling/release/src/release/__tests__/steps.test.ts`（argv 夹具） | **已有** `['exec','turbo','run','test']` | `steps.test.ts:43` |
| `apps/docs/src/zh-CN/content/monorepo/release.md`（电池表） | **已有** `\| \`test\` \| \`turbo run test\` \|` 行 | `release.md:162` |

所以「上次 release 2 条用例红」的失效面这次**不会**复现：release 的
`id 与顺序逐字等于 RELEASE_BATTERY` 与 `逐行钉住会跑的电池` 两条用例全绿（`12 files / 202 tests`，
§5）。**加一条重复的 `test` 会让 `id 无重复` 那条红**，所以我没加。

> 关于「prepush 相关文档的表格」：**prepush 的门禁表没有文档镜像，这是有意的**——
> `prepush.ts:11-12`（「文档只指向本文件」）与 `apps/docs/…/monorepo/doc-conventions.md:46`
> （「门禁有几段、各段凭什么 → `prepush.ts` 的表（正文里只许写判据）」）。
> `release.md` 那张表是**发版电池**的表，不是 prepush 的表（它已含 `test` 行）。
> 这也是为什么本次没有第四处文档要改。

### 3.3 负对照：删掉新行会红，且**只有** prepush.test 钉得住

把新段整块删掉后再跑 `prepush + gate-wiring`：

```
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 27 passed (28)
```

红的正是 `顺序与 id 稳定 —— 整表列出，不是抽样`（`prepush.test.ts:127-156`）；
`gate-wiring.test.ts` **18 条仍全绿** —— 说明「发版电池是 prepush 的超集」那条断言
**发现不了** prepush 少一段（它只查超集方向）。这恰好复刻上一轮 R3 的失效面：
少一段没有任何闸看得见，除非有人显式钉表。还原后 28/28。

### 3.4 顺手确认 gate-wiring 的两条对新段成立

- **CI 触发面**：新段 `script = 'test'`，`ci.yml:114`（`pnpm exec turbo run test --affected`）与
  `release.yml:85`（`pnpm test`）都在 `ciText` 里 → 通过。
- **电池超集**：`steps.ts` 里有 `'test'` → 通过。

---

## 4 B7：`POST /auth/signout` 加 `JwtFree`，凭 RT 认人

### 4.1 问题（review 已定级，拍板已给）

`reports/review-guard-skip/matrix.md:233-240`（H1）与 `:338`（Q4，推荐 a）：signout 只有
`SignFree + DeviceFree` ⇒ 走 `JwtAccessGuard` ⇒ **AT 一过期就 40101**，而此时服务端那枚 RT
仍然现役。登出的正文就是「删掉 DB 里的 refresh token」，它本质上是以 **RT** 为凭据的操作。

### 4.2 改了什么（四层，各只做一件事）

1. **controller**（`auth.controller.ts:45-74`）：
   ```ts
   @WalnutAdminGuardSignFree()
   @WalnutAdminGuardJwtFree()
   @WalnutAdminGuardDeviceFree()
   @WalnutTx()
   @ApiWalnutOkResponse({ … })
   @UseGuards(JwtRefreshGuard)
   async signout(@WalnutAdminDecoratorJti() jti, @WalnutAdminDecoratorDeviceId() deviceId,
                 @WalnutTxSession() ctx, @Req() req) {
     await this.authService.signoutByRefreshToken({ jti, sid: req.RT.sid, deviceId, ip: req.realIp }, ctx.em)
     this.cookieService.clearCookie(req, [{ key: WalnutAdminConstCookieKeys.RT_JTI }])
     return true
   }
   ```
   装饰器顺序按 eslint `local/sort-nestjs-decorators` 的顺序表（`SignFree → JwtFree → DeviceFree →
   WalnutTx → ApiWalnutOkResponse → UseGuards`）；**第一次写成 `UseGuards` 在前、JwtFree 在 DeviceFree
   之后，被 `pnpm lint` 判红**（`local/sort-nestjs-decorators`），已按表改正（这条是实测，不是猜）。
   挡在它前面的守卫同理：**AT 不再参与**，所以 `req.user` 恒 undefined；`MFA`（`mfa.guard.ts:39-44`）
   与 `Lock`（`lock.guard.ts:51-56`）对「无 user」显式自跳过，`CAP`（`cap.guard.ts:79-115`）与
   `Risk`（`risk.guard.ts:34-92`）照常按 device/ip 评估，`Throttler` 照常。

2. **controller 级 service**（`auth.service.ts:18-31`）：`signout(payload, deviceId, ip, em)` →
   `signoutByRefreshToken(session, em)`。语义变化写在注释里：**没有 AT payload 了**。

3. **shared service**（`refresh.shared.service.ts:112-124`）：新增 `getRefreshSessionOwner(jti)`
   ——`jti` → `{ userId, deviceId }`，行不存在/已撤销 → `40102`（与 `JwtRefreshGuard` 同语义，
   纵深兜底）。**没有**复用 `getTokenByJti`：那个返回解密后的令牌串，是给验签用的；
   为了拿 userId 把令牌解出来是把两件事绑在一起。

4. **signout 服务**（`signout.service.ts:60-90`）：`signoutByRefreshJti()` —— 从行上取
   `userId` / `deviceId`，**cookie 的 `DEVICE_ID` 只做一致性核对**（不一致 40102，
   与刷新链「cookie deviceId == 行 deviceId」同口径，防「A 设备的 cookie 撤 B 设备的 RT」），
   然后走既有的 `user-logout` 分支（撤 `(user, device)` 全部 RT + after-commit 清
   permissions / sessions / MFA / 风险缓存）—— 那一支一行没改。

### 4.3 api-spec：用**已过期 AT + 有效 RT** 登出

`apps/server/apps/api/test/api/auth-session.api-spec.ts:358-407`（D 段最后一条）：

1. 新设备 `WalnutApiClient.create` + `performHttpOpaqueLogin`（保证有一枚**现役** RT）；
2. 造「签名合法但已过期」的 AT：`jwtService.signAsync(payload, { secret, expiresIn: '-10s' })`
   （与 `guard-matrix.api-spec.ts:406-419` 的过期 AT 同款手法）；
3. **正对照**：同一枚 AT 打 `GET /auth/permissions` → `40101`（证明它**真的**过期，否则
   「能登出」不说明任何事）；
4. `POST /auth/signout` → `20000`、`data === true`；
5. RT 行全 `revoked = true`（PG 直查 `auth_refresh_token`）；
6. **失效可验**：同一枚 RT 再 `POST /auth/refresh` → `40102`；
7. 清理：删 `sys_device`（`fk_rt_device` / `fk_user_device_device` 都是 `ON DELETE CASCADE`，
   `apps/api/migrations/1792922206018-InitSchema.ts:399,623`）+ 清缓存键。

**修前（负对照，真实输出）**：

```
 ✓ signout → 20000：RT revoke + RT_JTI cookie 清除 + 会话系缓存全清 105ms
 × B7：已过期 AT + 有效 RT → 仍能登出（JwtFree 凭 RT 认人），且 RT 全部失效 3777ms
Error: [api-client] signout with expired AT failed: HTTP 200 body={"data":null,"code":40101,
       "msg":"Access Token Expired",…}
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

**修后**（同一文件，两次跑）：

```
 ✓ apps/api/test/api/auth-session.api-spec.ts (9 tests) 15522ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### 4.4 `guard-matrix.api-spec.ts` 的同步面

- **它没有断言 signout 的 guard 集合**（全文唯一相关是 `:523` 的注释：「旧会话键已删、旧 AT 已不可用于
  任何登录态端点（含 signout）—— 直接 SQL 撤销本用户未撤销的 RT」）。该注释描述的是**该用例自己**
  的操作顺序（先删会话键 → 再 SQL 撤 RT 才能重登），在 JwtFree 之后**仍然成立**（signout 不再看 AT，
  但那条用例根本没调 signout），所以我没改它。
- 同步了**文档里手写的 guard 集合**（4 处）：
  `apps/docs/…/backend/modules/auth.md:226`（§3.3 段首）、`:330`（接口表）、
  `apps/docs/…/review/backend/api-catalog.md:192`、`apps/server/apps/api/test/api/ENDPOINTS.md:98`。

### 4.5 生成物：openapi.json（`/auth/signout` 变成匿名）

```diff
@@ -2028,11 +2028,6 @@
-        "security": [
-          {
-            "bearer": []
-          }
-        ],
         "summary": "Signout, remove refresh token in db",
```

- `apps/server/openapi.json`：`0 insertions / 5 deletions`（只有这一处）。
- `packages/generated/api-types/src/schema.d.ts`：**0 改动**（该文件只有 DTO 类型，不含 security）。
- **幂等已验证**：重新跑一遍 `openapi:export` + `openapi:generate`，`git diff --numstat` 仍是 `0 5`。
- `openapi:check` 在**未提交**的工作区**必然红**（它比的是 index vs HEAD，见 `prepush.ts:177-186`
  的 F-53 边界①）——提交时必须让 `openapi.json` 与源码进**同一个** commit。

---

## 5 门禁原始输出（全部实测，日志在 `reports/batch-7/logs/`）

| 门禁 | 命令 | 结果 | 日志 |
|---|---|---|---|
| server 单测 | `cmd /c "pnpm --filter @walnut/server test"` | **95 files / 790 tests passed**，exit 0 | `server-test.log` |
| scripts 单测 | `cmd /c "pnpm --filter @walnut/scripts test"` | **33 files / 528 tests passed**，exit 0 | `scripts-test.log` |
| release 单测 | `cmd /c "pnpm --filter @walnut/release test"` | **12 files / 202 tests passed**，exit 0 | `release-test.log` |
| 类型检查 | `cmd /c "pnpm types:check"` | **15 successful / 15 total**，exit 0 | `types-check.log` |
| lint | `cmd /c "pnpm lint"` | **15 successful / 15 total**，exit 0（server 侧 `0 errors, 2 warnings`，警告在 `libs/repository/src/pg-list.builder.spec.ts:453,474`，非本次文件） | `lint.log` |
| 边界 | `cmd /c "pnpm boundaries"` | `Checked 4676 files in 15 packages, no issues found`，exit 0 | `boundaries.log` |
| 文档预算 | `pnpm lint:doc-budget` | 6 个常驻文件全在预算内：`96% 8312/8700 AGENTS.md`、`93% 6399/6900 apps/server/AGENTS.md` | `lint-doc-budget.log` |
| 文档引用 / ts 块 / emoji / ADR / exports | 各自 `pnpm lint:*` | 全 exit 0（`lint:exports`：15 包 / 11 个声明 `exports`，目标都存在） | `lint-*.log` |
| api-spec（B7 专项） | `… vitest run --config ./apps/api/vitest.config.integration.ts auth-session` | **9 passed (9)** | `api-spec-auth-session.log` |

> 注：`api-spec`（`*.api-spec.ts`）**不在** `pnpm --filter @walnut/server test` 的 include 里
> （`apps/api/vitest.config.ts:20` 只收 `apps/api/src/**/*.spec.ts` + `libs/*/src/**/*.spec.ts`），
> 它们由 `vitest.config.integration.ts:40-45`（`apps/api/test/api/**/*.api-spec.ts`，第 44 行）收进来跑。所以 B7 的验收必须额外跑上面那一行。

---

## 6 环境阻塞：guard-matrix / permission-chain 的级联失败**不是本次改动**

同一条命令我跑了三次，失败集合与失败码**每次都不同**，且其中一次的对照是「把我的 4 个 server
文件 checkout 回 HEAD」：

| # | 代码状态 | 结果 | 首个/主要失败签名 |
|---|---|---|---|
| A（13:23） | 带 B7 | `8 failed / 44` | `40101 Access Token Expired`（封禁闭环、G8、MFA、Lock） |
| B（13:26） | **B7 已还原到 HEAD**（A/B 对照） | `21 failed / 23` | `会话吊销…` → `[auth-login] login failed: code=40103`，之后 `root() requires setAuth() first` 全线级联 |
| C（13:40） | 带 B7 | `10 failed / 34` | 连**第一条** `放行基线` 都红：`40114 MFA Required` |

对照组 B 比 A 差一倍 ⇒ 级联与「有没有我的改动」无关。共同的环境因素（同时间段实测）：

```
Get-CimInstance Win32_Process -Filter "ProcessId=19076" | % CommandLine
node "...\vitest\vitest.mjs" run --config ./apps/api/vitest.config.integration.ts
# 13:07:46 启动，直到本报告写完（13:45+）仍在跑
```

这是**另一个 Agent 的全量 integration 运行**（同一台机、同一个 `walnut-admin-integration` 库、
同一套 `globalSetup` 的 drop/create/migration/seed、同一个 Redis）。它在 13:07 之后一直与我
共享这两份状态，而这些 spec 的失效面正是「用户/设备/会话/缓存键忽然不存在」
（40103 无效凭据 / 40607 设备封禁 / 40114 未启 MFA / 40101 会话键没了）。

旁证（双向的）：`reports/batch-7/` 这个目录也是共用的 —— 里面的 `r2-sigterm.md` / `probe/` /
`itest-run1.log` 是那个 Agent 的，我的只有 `r3-sgates.md` + `logs/`。而他那份 266 KB 的
`itest-run1.log`（最后写入 13:39:21）尾部是 `pg-protocol` 的 socket 报错 —— 也就是说他的全量
integration 这一轮同样没跑干净：**互相踩是双向的**，不是「我先跑、他后来」的单向问题。

**我没有**为了让它们变绿去改这些 spec —— 那会把「环境争用」伪装成「代码修好了」。
需要的是**串行化或隔离**（见 §7 第 1 条），然后在干净环境里复跑一次。

补充：同窗口里 `auth-session.api-spec`（真正覆盖 signout 的那个文件，9 条）**两次全绿**，
说明这些级联不是「所有 api-spec 都坏」，而是那两个**强状态依赖**的 spec 在争用下不稳。

## 未做

- **没有 commit**（按要求）。因此 `openapi:check` / `pnpm prepush` 全表在「未提交 + 另一 Agent 未提交改动」
  的工作区上无法给出可归因的结论：前者必红（index vs HEAD），后者冷跑是分钟级且会把别人的红算进来。
  已用 §5 的分段门禁覆盖同一批命令。
- 没碰 `apps/server/apps/worker`、`libs/guards/src/guards/*.guard.ts` 的**顺序**、`cap.service`、`main.ts`。

---

## 需要 Lead 拍板

1. **integration 库的跨进程互斥**（这条是本次唯一「没拿到确定性绿灯」的原因）：
   `vitest.config.integration.ts` 的 `globalSetup` 每轮 drop/create 同一个库。两个 Agent 并行跑
   integration 就必然互相踩（本次三跑的失败集合各不相同）。建议加一把 PG advisory lock
   （`globalSetup` 里 `pg_advisory_lock`，拿不到就 `exit 2` 并打印「另一个 integration 运行在跑」），
   或让库名带上进程/分支标识。要不要我在下一批做？
2. **signout 在「RT 也没了」时的语义**：现在 `JwtRefreshGuard` 会 40102（RT cookie 缺失/已撤销）。
   我的实现按「RT 是凭据」处理——**没有**放宽成「无 RT 也 20000」。前端登出需要容忍 40102
   并本地清态；如果 Lead 要求「幂等登出」（无 RT 也 20000），那是另一种口径，我按要求改。
3. **`openapi.json` 的提交归属**：它必须与这 4 个 server 文件进**同一个** commit，否则 CI 的
   openapi job（index vs HEAD）会红。请指定由哪条提交带上（我按纪律没有 commit）。
4. **`ENDPOINTS.md` 那处文档改动要不要留**：`apps/server/apps/api/test/api/ENDPOINTS.md:98` 是
   「测试策略」文档，我把 signout 的守卫与 B7 用例写进去了。若 Lead 只想改 docs 站（`auth.md` /
   `api-catalog.md`），我可以回退这一处。
5. **prepush 的 `test` 段耗时**：本机 `turbo run test` 冷跑是分钟级（server 单跑 `~100s`、scripts
   `~75s`，热跑命中缓存是秒级）。我**没有**加 `PREPUSH_SKIP_TEST` 之类的旁路——那正是本仓反复
   强调的「静默弱化门禁」。如果推送耗时不可接受，正确的做法是把 test 段改成「只跑 affected」
   （`--affected` 需要 `TURBO_SCM_BASE`，prepush 的 cwd 是仓库根，能取 `origin/main`），
   要不要改由 Lead 定。
