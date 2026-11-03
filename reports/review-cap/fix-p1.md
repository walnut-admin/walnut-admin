# CAP 配置错位 + Lock 判空 —— P1 修复报告

> 基线：HEAD `0e152d36`（工作树 clean）｜**未 commit**｜分支：工作区直接改动
> 依据：`reports/review-cap/review.md`（CAP-1/CAP-2/CAP-4/CAP-5/CAP-6/CAP-3）+ `reports/review-guards/review.md`（Lock `deviceId === null`）
> 观测口径：全局异常过滤器**永远回 HTTP 200**，下文所有 code 都是 `body.code`（崩溃 50000、校验拒绝 40116/40117、机器人 40111）。
> 本轮遵守 Lead 已拍板的四条：**ttl 统一按秒**、**缓存窗口 = min(ttl, 20min)**、**多副本只做单实例前提声明**、**40111 保留并修好**。

---

## 0. 结论速览

| # | 任务 | 状态 | 关键落点 |
|---|------|------|----------|
| 1 | CAP `ttl` 三种单位统一成**秒**，三处从同一常量派生 | 完成 | `apps/server/libs/const/src/app/cap.ts`（新增，唯一真源）；`cap.service.ts:53` / `:64`；`cache.cap.ts:46` |
| 2 | 缓存窗口 `min(ttl, 20min)` + 为什么是 20 分钟的注释 | 完成 | `const/src/app/cap.ts:24`（常量，带 cap.js 源码行号）、`:84`（resolver） |
| 3 | 畸形 cookie（`CAPJS_TOKEN=s:<坏签名>`）→ 40116/40117，不再 50000 | 完成 | `libs/cookie/src/helpers.ts:29`（新 helper）、`cap.guard.ts:117` |
| 4 | 40111 唤醒（不再被自身 catch 吞掉） | 完成（窄口径，见文末「需要 Lead 拍板」第 1 条） | `cap.guard.ts:249`：`throw` 挪到 `try` **之外** |
| 5 | Lock 守卫判空改 isNil 语义 | 完成 | `lock.guard.ts:65-66` |
| 6 | 前端 40117 单次重试标记 + 刷新失败不重放 | 完成 | `interceptor.ts:63-76`、`axios/types.d.ts:21` |
| 7 | 多副本：启动日志 + 文档写清「单实例前提」 | 完成 | `cap.service.ts:36`（`onModuleInit` 启动 WARN）、三篇文档 |

**门禁全绿**：server test 86 文件 / 715 用例；`types:check`（server + 全仓 15 包）；`lint`（15 包）；`boundaries`（4662 文件）；admin `types:check`（含在 turbo 全仓跑里）。逐条命令与输出见 §8。

---

## 1. CAP `ttl`：三种单位 → 统一「秒」（review CAP-1）

### 修复前的事实（三方互斥，没有任何取值能让三处同时正确）

| 消费方 | 位置 | 旧写法 | 单位解读 |
|--------|------|--------|----------|
| cap.js challenge | `cap.service.ts:27`（旧） | `expiresMs: config.ttl` | 当**毫秒** |
| cookie `maxAge` | `cap.service.ts:36`（旧） | `maxAge: config.ttl * 1000` | 当**秒** |
| 校验缓存 TTL | `cache.cap.ts:39`（旧） | `Math.max(1, Math.ceil(config.ttl / 1000))` | 当**毫秒** |
| 代码默认值 | `cache.appSettings.ts:132`（旧） | `ttl: 60 * 60 * 1000` | 与种子 `3600` 差 1000 倍 |

### 修复后：唯一真源 + 三个 resolver

新增 `apps/server/libs/const/src/app/cap.ts`（放在 `libs/const` 而不是 `libs/security`：`libs/cache` 与 `libs/guards` 都要用，反向依赖 security 会破坏分层）：

- `cap.ts:24` `WalnutAdminConstCapTokenLifetimeSeconds = 20 * 60`：cap.js token 本体寿命（**第三方硬编码**，注释指向 `@cap.js/server@4.0.5 index.js:343`）
- `cap.ts:31` `WalnutAdminConstCapTtlDefaultSeconds = 60 * 60`：缺省 ttl，与 `db/seed/app_setting.json:46` 的 `"ttl":3600` **逐字对齐**
- `cap.ts:63` `resolveCapChallengeExpiresMs(ttl)` = `normalize(ttl) * 1000` → 给 `createChallenge({ expiresMs })`
- `cap.ts:71` `resolveCapCookieMaxAgeMs(ttl)` = `normalize(ttl) * 1000` → 给 Express `maxAge`
- `cap.ts:84` `resolveCapCacheTtlSeconds(ttl)` = `max(1, min(ttl, 20min))` → 给 Redis `set({ ttl })`
- `cap.ts:46-58` `normalizeCapTtlSeconds`：非有限/非正数回落缺省值；**刻意不做「大于某阈值就除以 1000」的毫秒猜测**（那就又把单位变成两个真源）

三处消费方改为（不再自己乘除）：

- `apps/server/libs/security/src/cap/cap.service.ts:53` `expiresMs: resolveCapChallengeExpiresMs(config.ttl)`
- `apps/server/libs/security/src/cap/cap.service.ts:64` `maxAge: resolveCapCookieMaxAgeMs(config.ttl)`
- `apps/server/libs/cache/src/service/cache.cap.ts:46` `const ttl = resolveCapCacheTtlSeconds(config.ttl)`
- `apps/server/libs/cache/src/service/cache.appSettings.ts:135` `ttl: WalnutAdminConstCapTtlDefaultSeconds`（= 3600 秒）
- `apps/server/libs/const/src/app/setting.ts:57` 接口注释补充「`ttl` 单位：秒」

### 验收用例如何钉住旧写法

`apps/server/libs/const/src/app/cap.spec.ts`（6 条）——**种子值 3600 手算**：

| 断言 | 期望 | 旧写法会得到 |
|------|------|--------------|
| `resolveCapChallengeExpiresMs(3600) / 1000` | **3600 s = 60 分钟** | 3.6 s（`expiresMs: 3600`） |
| `resolveCapCookieMaxAgeMs(3600) / 1000` | **3600 s = 60 分钟** | 415 天（若把 `3600` 当秒再 `*1000` 两次） |
| `resolveCapCacheTtlSeconds(3600)` | **1200 s = 20 分钟** | 4 s（`ceil(3600/1000)`） |
| `challenge === cookie`（毫秒口径逐字相等） | 相等 | 相差 1000 倍 |
| `cache === min(3600, 20*60)` | 1200 | 4 |

消费侧另有两道同级钉子（防止「resolver 对了但调用点没接上」）：

- `libs/security/src/cap/cap.service.spec.ts:58`：spy `AppCapJS.createChallenge`，断言 `expiresMs === 3600000` 且 `not.toBe(3600)`
- `libs/cache/src/service/cache.cap.spec.ts`：断言 `options.ttl === 1200` 且 `not.toBe(ceil(3600/1000))`

---

## 2. 缓存窗口 = `min(ttl, 20min)`（review CAP-2）

- `const/src/app/cap.ts:76-90` 的注释写清**为什么是 20 分钟**：cap.js `redeemChallenge` 里
  `const expires = Date.now() + 20 * 60 * 1000`（`@cap.js/server@4.0.5 index.js:343`），
  而传进去的 `expiresMs` 只作用于 challenge 本身（同文件 `:279`）。缓存**不得长于** token 寿命，
  否则缓存命中 = 放行一枚 cap.js 已经不认的凭据；`ttl` 配得比 20 分钟短时以 `ttl` 为准。
- 下限 1 秒（`cap.ts:39`）：`AppTechCacheService.set` 的 `ttl <= 0` 语义是**永不过期**
  （`cache.service.ts:103-109`），不能让畸形配置把 CAP 缓存变成永久放行。
- 用例：`cache.cap.spec.ts` 三条 —— `ttl=3600→1200`、`ttl=600→600`、`ttl=86400→1200`。

---

## 3. 畸形 cookie → 50000 修成 40116/40117（review CAP-4）

**机制**：`cookie-parser@1.4.7 index.js:150` 对「以 `s:` 开头但签名错」的值返回 **`false`**（不是 `undefined`）；
`libs/cookie/src/helpers.ts` 只做了 `as string` 断言；`cap.guard.ts` 只判 `isNil` ⇒ `false` 不算 nil ⇒
一路走到 `cache.cap.ts` 的 `createHash('sha256').update(false)` ⇒ `ERR_INVALID_ARG_TYPE` ⇒ `body.code = 50000`。

**修复**：
- `apps/server/libs/cookie/src/helpers.ts:29` 新增 `getWalnutAdminCookieString()`：非字符串 / 空串一律归一成 `undefined`；
  原 `getWalnutAdminCookie` 保留（其注释已写明「返回 `false` 时类型断言是假的」）。
- `apps/server/libs/guards/src/guards/cap.guard.ts:117` 改用新 helper，`:123` 的 `isNil` 判空因此**真的能命中** `false`。

**用例**（`cap.guard.spec.ts`，3 条）：签名错的 `false` + `shouldChallenge=true/false`、空串。
断言点：抛 40116/40117，且 `getCapTokenCache` **一次都没被调用**（旧代码会带着 `false` 调进去 → 真链路 50000）。

**HTTP 级实测**（dev 3000，见 §5）：`CAPJS_TOKEN=s:forgedsignaturevalue` → `{"code":40116}`，**不是 50000**。

---

## 4. 40111「判定为机器人」唤醒（review CAP-6 / P3-31）

**旧代码**：`performCapVerification` 在 `try` 内 `throw new WalnutAdminExceptionYouAreBot()`，
同函数的 `catch` 把它连同基础设施异常一起压成 `return false` ⇒ 客户端只能见 40116/40117。

**新代码**（`apps/server/libs/guards/src/guards/cap.guard.ts:227-272`）：按「谁能证明什么」切成三条出口，
`throw` 落在 `try` **外面**（`:249`），物理上不再可能被吞：

| 输入 | 出口 | 理由 |
|------|------|------|
| cookie 值不是 cap.js token 形态（`<id>:<vertoken>`，两段 hex；`:35` `isWellFormedCapJsToken`） | **40111** | 本地即可证的伪造/损坏凭据；重放同一枚坏 cookie 不会自愈 |
| `validateToken` 抛异常（`.data` 存储坏 / 只读 FS / 磁盘满） | 40116/40117 | 设施故障，不能冤枉用户是机器人（`:252-260`） |
| `success:false`（一次性 token 已消费 / 过期 / 非本机签发） | 40116/40117 | **可自愈**路径，前端刷新后重放（`:262-265`） |

**为什么 `success:false` 不抛 40111**（与 review 建议的 option (a) 有偏差，理由见文末「需要 Lead 拍板」第 1 条）：
cap.js `validateToken` 对「token 已被消费」与「判定为机器人」返回的是**同一个** `{ success: false }`
（`index.js:409-437`，无 message 区分），而缓存窗口只有 20 分钟 ⇒ **每个正常用户 20 分钟后第一次请求**
都会命中这条分支。若抛 40111，前端 `interceptor.ts:134` 会把用户跳到 `/not-allowed`，
等于**每 20 分钟踢一次全部在线用户**。故 40111 只承担「本地可证」的那一面。

**可达性验证**（不是死码）：客户端完全可以构造「签名合法但不是 cap.js token」的 `CAPJS_TOKEN` ——
**cookie 名互换**：`DEVICE_ID` 与 `CAPJS_TOKEN` 用同一把 cookie secret 签名，把 DEVICE_ID 的签名值
塞进 `CAPJS_TOKEN`，`cookie-parser` 解签成功、拿到的是 64 位 hex（无冒号）⇒ 形态非法 ⇒ 40111。
本地用真实 `cookie-parser` 复现（`apps/server` 下跑 node）：

```text
A. 名互换（DEVICE_ID 的签名值塞进 CAPJS_TOKEN）：
   signedCookies.CAPJS_TOKEN = "af8ab40f38c5bf224c68a0b4c709adb76f667a4854229bb3822c70292e5d8c93"
   typeof = string
   isWellFormedCapJsToken = false      ← ⇒ guard 抛 40111
B. 坏签名 CAPJS_TOKEN=s:forged：
   signedCookies.CAPJS_TOKEN = false   ← typeof boolean ⇒ 走「凭据缺失」40116/40117
```

**用例**（`cap.guard.spec.ts`，2 条）：`'not-a-capjs-token'` / `'forged:value:with:extra'` ⇒
`toBeInstanceOf(WalnutAdminExceptionYouAreBot)` 且 `not.toBeInstanceOf(CapInteractionRequired)`，
并断言非法形态在本地就拒、不调第三方。旧的 3 条「断言不是 YouAreBot」的用例已按新语义重写。

---

## 5. Lock 守卫判空（review-guards P1）

- 旧：`lock.guard.ts:57` `if (deviceId === null)`。`getWalnutAdminCookie` 缺省返回 **undefined**（cookie 缺失）、
  签名错返回 **false** ⇒ 分支**永不命中** ⇒ `undefined` 被拼进 `APP:MURLOCK:LOCK_GUARD:<userId>:undefined`
  与锁缓存键，所有无设备凭据的请求共用一个退化键空间查锁。
- 新：`lock.guard.ts:65-66` `getWalnutAdminCookieString` + `isNil(deviceId)`（`lodash.isNil` 是类型谓词，
  之后 `deviceId` 收窄成 `string`，`checkIsLocked`/`getLockForGuard` 的入参类型不用改）。
- 新增 `apps/server/libs/guards/src/guards/lock.guard.spec.ts`（7 条）。钉住旧写法的是前 3 条：
  cookie 缺失 / `false` / 空串 ⇒ 直接放行，且 `checkIsLocked` 与 `runWithLock` **一次都没被调用**。
  另 4 条覆盖正常面：缓存命中已锁 → 40606、命中未锁 → 放行且不回源、缓存 miss → 锁内回源 + 回填缓存
  （并断言锁键含真实 `deviceId`、不含 `undefined`）、lockFree / 无 user 直接放行。

---

## 6. 前端 40117 重试上限（review CAP-5）

- `apps/admin/src/utils/axios/interceptors/response/interceptor.ts:63-76`：加 `_capRefreshRetried` 单次标记
  （照 `_deviceResetRetried` / 40101 的写法），**只有 `SingletonPromiseCapJSRefresh()` 真返回非空 token 才重放**；
  空串（`comp-capjs.ts:56-59` 的失败出口）落到函数末尾兜底：`useAppMsgError` + reject，不再重放、也不跳 `/not-allowed`。
- `apps/admin/src/utils/axios/types.d.ts:21` 加 `_capRefreshRetried?: boolean`（axios 模块增强，与既有私有字段同处）。
- 说明：admin 没有单测工程（`pnpm test` 不覆盖 admin），本条以 `vue-tsc`（admin `types:check`）+ `lint` 为门禁；
  逻辑等价物（40101/40605）同样只有类型与人工验证，未降低本仓既有标准。

---

## 7. 多副本：本轮只做「明确单实例前提」

- `apps/server/libs/security/src/cap/cap.service.ts:36` `onModuleInit()` 打一条 **WARN**：
  token 存储是 `.data/tokensList.json`（常量 `:16`），CAP **必须以单实例运行**（或所有副本共享该持久卷），
  否则多副本下校验必失败（40116/40117 风暴），并指向 `reports/review-cap/review.md CAP-3`。
- 文档：`apps/docs/src/zh-CN/content/backend/modules/security.md` CAP 一节新增「CAP 只有单实例能力」段落。
- 用例：`cap.service.spec.ts` 断言 `onModuleInit` 的 WARN 文案包含 `.data/tokensList.json` 与 `SINGLE instance`。
- **不做**：cap.js `storage.tokens` 适配器 / Redis 存储（另批）。

---

## 8. 门禁实测

全部命令按环境要求写成 `cmd /c "pnpm ..."`；跑完 `git status` 核对：**lockfile 未被改写**，工作区只有本轮意图内改动。

| 门禁 | 命令 | 结果 |
|------|------|------|
| server test | `cmd /c "pnpm --filter @walnut/server test"` | `Test Files 86 passed (86)` / `Tests 715 passed (715)`，exit 0 |
| server types:check | `cmd /c "pnpm --filter @walnut/server types:check"` | exit 0（`tsc --noEmit` 无输出） |
| 全仓 types:check | `cmd /c "pnpm types:check"` | `Tasks: 15 successful, 15 total`（含 admin `vue-tsc --noEmit`），exit 0 |
| 全仓 lint | `cmd /c "pnpm lint"` | `Tasks: 15 successful, 15 total`，exit 0 |
| server lint（单独） | `cmd /c "pnpm --filter @walnut/server lint"` | exit 0 |
| boundaries | `cmd /c "pnpm boundaries"` | `Checked 4662 files in 15 packages, no issues found`，exit 0 |
| admin types:check | 由 `pnpm types:check` 覆盖（`@walnut/admin:types:check: cache miss, executing` → `vue-tsc --noEmit` 成功） | 同全仓 exit 0 |
| docs 引用/代码块（改了文档，顺带跑） | `cmd /c "pnpm lint:docs-refs"` + `cmd /c "pnpm lint:doc-ts"` | `329 篇活文档` / `125 个 ts 块` 全通过 |

> 过程中 lint 曾红过 6 条（`test/prefer-lowercase-title`、`walnut-comment/no-emoji`、`ts/no-unnecessary-type-assertion` ×3），
> 已全部修掉并复跑归零 —— 红→绿的输出见本轮会话记录，最终值以上表为准。

---

## 9. 「旧写法会红」的变异实测（逐条改回旧代码 → 跑 → 还原）

每一条都是：**只把该处改回修复前的写法 → 跑对应 spec → 记录失败用例 → 用反向 edit 还原**（还原后 5 个 spec 复跑 31/31 全绿）。

| # | 改回旧写法 | 变红的用例 | 结果 |
|---|-----------|-----------|------|
| 1 | `cap.service.ts` `expiresMs: config.ttl` | `challenge：ttl=3600 秒 ⇒ expiresMs = 3600000（≈60 分钟），不是 3600（=3.6 秒）` | `Tests 1 failed \| 2 passed (3)` |
| 2 | `cache.cap.ts` `Math.max(1, Math.ceil(config.ttl / 1000))` | 3 条全红：`种子 ttl=3600 秒 ⇒ 缓存 ttl=1200 秒（≈20 分钟），不是 4 秒`、`ttl 短于 20 分钟…`、`ttl 长于 20 分钟…` | `Tests 3 failed \| 1 passed (4)` |
| 3 | `cap.guard.ts` 改回 `getWalnutAdminCookie` + `isNil` | 3 条：坏签名 `false`（two states）+ 空串 | `Tests 3 failed \| 8 passed (11)` |
| 4 | `cap.guard.ts` 把 40111 放回 `try` 内被自身 catch 吞掉 | 2 条：`cookie 是字符串但不是 cap.js token 形态 ⇒ 40111…`、`shouldChallenge=false 时形态非法仍是 40111…` | `Tests 2 failed \| 9 passed (11)` |
| 5 | `lock.guard.ts` `if (deviceId === null)` | 3 条：cookie 缺失 / `false` / 空串（`checkIsLocked` 被调用即红） | `Tests 3 failed \| 4 passed (7)` |

---

## 10. HTTP 级实测（dev 3000，真实链路）

未登录、新设备（`POST /w/v1/system/device/initial` 拿签名 `DEVICE_ID`）后打 `GET /w/v1/`：

```text
--- register: {"data":{"deviceId":"6890632f6d80a4b8…","countryCode":null},"code":20000,"msg":"Success"}

--- A: 无 CAP token
{"data":null,"code":40116,"msg":"CAPTCHA Interaction Required"}

--- B: CAPJS_TOKEN=s:forgedsignaturevalue（坏签名 —— P1-3 的原始触发条件）
{"data":null,"code":40116,"msg":"CAPTCHA Interaction Required"}      ← 修复前这里是 50000
```

对照修复前的机制证据（review 侧已测）：`createHash('sha256').update(false,'utf8')` ⇒ `ERR_INVALID_ARG_TYPE`。
**局限**：`CAPJS_TOKEN` 的用户可构造形态只有「坏签名 / 未签名 / 名互换」三种，其中前两种被 cookie 层丢弃、
第三种指向 40111（已在 §4 用真实 `cookie-parser` 复现）；**本轮没能抓到一次 HTTP 级 40111**——
后续几次探测里该设备的 `recommendation` 已不再触发（CAP 走 fail-open，响应变成 40112 Sign），
属于环境状态问题而非代码问题。40111 的 **HTTP 断言**列为下一轮补测项（本轮只有单测 + cookie-parser 机制复现）。

---

## 11. 改动清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `apps/server/libs/const/src/app/cap.ts` | 新增 | ttl 单位唯一真源：2 个常量 + 3 个 resolver + 归一化 |
| `apps/server/libs/const/src/app/cap.spec.ts` | 新增 | 三处换算一致 + 种子 3600 手算（6 条） |
| `apps/server/libs/const/src/app/setting.ts` | 改 | `ttl` 接口注释写明「秒」 |
| `apps/server/libs/cookie/src/helpers.ts` / `index.ts` | 改 | 新增 `getWalnutAdminCookieString`（`false`/`''` → `undefined`） |
| `apps/server/libs/security/src/cap/cap.service.ts` | 改 | `expiresMs`/`maxAge` 走 resolver；`onModuleInit` 单实例 WARN；存储路径提常量 |
| `apps/server/libs/security/src/cap/cap.service.spec.ts` | 新增 | challenge/cookie 单位 + 启动日志（3 条） |
| `apps/server/libs/cache/src/service/cache.cap.ts` | 改 | 缓存 TTL 走 resolver（`min(ttl,20min)`），类注释重写 |
| `apps/server/libs/cache/src/service/cache.cap.spec.ts` | 新增 | 窗口三态 + 键形状（4 条） |
| `apps/server/libs/cache/src/service/cache.appSettings.ts` | 改 | 默认 `ttl` 从 `60*60*1000` 改为 `3600` 秒常量 |
| `apps/server/libs/guards/src/guards/cap.guard.ts` | 改 | 畸形 cookie 判空；40111 出口；`isWellFormedCapJsToken`；头注释重写 |
| `apps/server/libs/guards/src/guards/cap.guard.spec.ts` | 改 | 11 条（新增畸形 cookie / 40111 / 设施故障面，重写旧 40111 死码断言） |
| `apps/server/libs/guards/src/guards/lock.guard.ts` | 改 | `deviceId === null` → `isNil` + 字符串归一 |
| `apps/server/libs/guards/src/guards/lock.guard.spec.ts` | 新增 | 7 条（判空 3 条 + 正常查锁 4 条） |
| `apps/admin/src/utils/axios/interceptors/response/interceptor.ts` | 改 | 40117 单次重试 + 刷新失败不重放 |
| `apps/admin/src/utils/axios/types.d.ts` | 改 | `_capRefreshRetried` |
| `apps/docs/.../backend/modules/security.md` | 改 | CAP 一节：秒单位 / 20 分钟窗口 / 三种出口 / 单实例前提；guard 表加 40111 |
| `apps/docs/.../backend/modules/auth.md` | 改 | ttl 秒 + `maxAge = ttl*1000` |
| `apps/docs/.../shared/capjs.md` | 改 | 时序图两处 ttl 标注 |
| `apps/server/apps/api/test/api/DESIGN-ISSUES.md` | 改 | P3-31 标【已修复 2026-11-03】+ 修复口径 |
| `apps/server/apps/api/test/integration/helpers/seed-layer.ts` | 改 | 过时注释（「ttl=3600 是毫秒」）订正 |

**不做（按指示）**：`CapFree` 的 8 处 skip、cap.js 分布式存储、40112 拆码。工作区 **未 commit**。

> 注意：本轮期间工作区里还出现了**不属于本批**的改动 —— `.github/workflows/ci.yml`、`apps/server/Dockerfile`、
> `deploy/docker-compose.yml`、`apps/server/apps/worker/README.md`（并行批次写的）。提交时请按文件挑选，
> 不要把它们算进本 P1。

---

## 需要 Lead 拍板

1. **40111 的语义范围**（本轮我按「窄口径」实现，与 review CAP-6 推荐的 option (a) 有偏差，需你确认）
   - 现状：`success:false`（一次性 token 已消费/过期）仍走 **40116/40117 自愈**；只有「cookie 值不是 cap.js token 形态」
     抛 40111。
   - 若按 option (a) 把 `success:false` 也归 40111：cap.js 对「已消费」与「机器人」返回同一个 `{success:false}`，
     而缓存窗口只有 20 分钟 ⇒ **每个正常用户 20 分钟后第一次请求都会被跳到 `/not-allowed`**。
     要走这条路，必须先给前端 40111 加恢复动作（静默 re-challenge 而不是跳错误页）。
2. **40116 交互分支仍无重试上限**：本轮只按指示给 40117 加了 `_capRefreshRetried`；
   40116 在「模态框被卸载/登出/路由切换」时 Promise 不 settle（review CAP-5 第 2 条），要不要同批加标记？
3. **多副本前提的强度**：现在是「启动 WARN + 文档」。要不要升级成**启动失败**（检测到多副本/无持久卷时拒绝启动），
   或直接排期接 Redis 存储？
4. **存量配置迁移**：代码不再猜毫秒。若某环境的 `APP:SETTING` 里存的是旧的 `3600000`（而非种子值 `3600`），
   升级后会被当成 3600 秒 →challenge/cookie 变 41.7 天（缓存仍被 20 分钟封顶，不会放大放行窗口）。
   要不要附一条一次性订正脚本/SQL？
5. **40111 的前端落点**：现在仍是 `/not-allowed?type=capjsTokenInvalid`（无恢复动作）。若形态非法真发生，
   客户端只能清 cookie 才能回来 —— 要不要把 40111 也做成「清 CAP cookie + 静默重试一次」？
