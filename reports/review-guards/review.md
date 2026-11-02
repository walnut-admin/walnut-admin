# I4 · 全局 GUARD 全景与顺序 review

> 调研 Agent：mongo-audit（task-4）。**只读调研，未改任何源码。**
> 基线：HEAD `bb2ee648`，工作树 clean（`git status --porcelain` 空）。
> 观测口径：全局异常过滤器**永远回 HTTP 200**（`libs/exceptions/src/exception.filter.ts:93`），
> 下面所有"失败码"都是 **body 里的业务码**，不是 HTTP status。

---

## 0. 结论速览

| 项 | 结论 |
|---|---|
| 注册真源 | app.module.ts 11 个 + tech.module.ts 1 个（Throttler） |
| 实测执行顺序 | **IP → Security → Device → Risk(pre) → CAP(pre) → JWT → Risk(post) → CAP(post) → MFA → Sign → Lock → Throttler**，与 AGENTS.md 一致（实测，不是照抄文档） |
| 同类别名注册两次（Risk / CAP） | **不去重，各自跑一次**（实测 `CALL_ORDER`） |
| 顺序的硬依赖 | JWT 之后才有的 `request.user` 被 Risk(post)/CAP(post)/MFA/Sign/Lock 消费；Sign 的模式切换依赖它；Lock 必须在 JWT 后 |
| 最大风险面 | **CAP 与 Risk 在缺少 `recommendation` 时 fail-open 放行**；Device/CAP/Sign/IP/MFA/Lock 都有 free 装饰器绕过面 |
| 门禁盲区 | **没有任何测试断言这 12 个 guard 的顺序**（`getGlobalGuards()` 无消费者）—— 顺序是安全语义，却只靠注释 |

---

## 1. 注册真源与实测顺序

### 1.1 真源

`apps/server/apps/api/src/app/app.module.ts:81-137`（11 个 `APP_GUARD`，注释在 `:79`
写明"top to bottom；controller 装饰器上的顺序是反的"）：

| # | guard | 行 |
|---|-------|----|
| 1 | `WalnutAdminGuardIP` | :83 |
| 2 | `WalnutAdminGuardSecurity` | :87 |
| 3 | `WalnutAdminGuardDevice` | :91 |
| 4 | `WalnutAdminGuardRisk`（pre-auth） | :97 |
| 5 | `WalnutAdminGuardCap`（pre-auth） | :102 |
| 6 | `JwtAccessGuard` | :108 |
| 7 | `WalnutAdminGuardRisk`（post-auth，**同一个类**） | :113 |
| 8 | `WalnutAdminGuardCap`（post-auth，**同一个类**） | :118 |
| 9 | `WalnutAdminGuardMFA` | :124 |
| 10 | `WalnutAdminGuardSign` | :130 |
| 11 | `WalnutAdminGuardLock` | :136 |
| 12 | `WalnutAdminGuardThrottler` | `modules/techniques/tech.module.ts:34-37` |

### 1.2 实测（不是照抄注释）

真实 `AppModule` 起来要 PG + Redis，本轮未起。改用**与真实拓扑同构**的探针
（临时 `apps/server/__tmp_guard_order.cjs`，跑完已删；用同一版 Nest、同一 `APP_GUARD` 机制）：
子模块注册 1 个 APP_GUARD + 根模块注册 11 个，读 `container.applicationConfig.getGlobalGuards()`。

~~~text
VIA=container.applicationConfig
GUARD_ORDER=["WalnutAdminGuardIP","WalnutAdminGuardSecurity","WalnutAdminGuardDevice",
             "WalnutAdminGuardRisk","WalnutAdminGuardCap","JwtAccessGuard",
             "WalnutAdminGuardRiskPost","WalnutAdminGuardCapPost","WalnutAdminGuardMFA",
             "WalnutAdminGuardSign","WalnutAdminGuardLock","WalnutAdminGuardThrottler"]
THROTTLER_INDEX=11        ← 0-based，即第 12 位
TOTAL=12
~~~

**两条结论**：

1. **Throttler 确实排最后**（`index 11`）。机制上：**根模块自己的 APP_GUARD 全部先于
   被 import 的子模块的 APP_GUARD 注册** —— 所以 `tech.module` 里那个"看起来更早被 import"
   的 Throttler 反而在最后。AGENTS.md 与 `tech.module.ts:31-33` 的注释与实测一致。
2. **同类别名注册两次不会去重**（第二个探针 `__tmp_guard_dup.cjs`，跑完已删）：

~~~text
REGISTERED=["WalnutAdminGuardIP","WalnutAdminGuardRisk","JwtAccessGuard","WalnutAdminGuardRisk",
            "WalnutAdminGuardCap","WalnutAdminGuardCap","WalnutAdminGuardLock"]
COUNT_RISK=2   COUNT_CAP=2
CALL_ORDER=["ip","risk","jwt","risk","cap","cap","lock"]     ← 真实发一次 HTTP 拿到的调用序
~~~

⇒ Risk 的 pre/post 与 CAP 的 pre/post **是真的各跑一次**，不是靠"同一次执行里判断两次"。

> ⚠️ **本轮证据的边界**：这是**同构复现**，不是真实 `AppModule` 的 `getGlobalGuards()`。
> 想去掉这个 caveat，需要在集成测试里对真实 app 断言一次（见 §8 拍板 Q3）。
> 未做的原因：真实 bootstrap 需要 PG + Redis，且 `vitest.config.integration.ts` 的
> global-setup 会 **drop 重建**集成库 —— 只读调研不做破坏性操作。

### 1.3 顺序之外的前置链路（guard 之前发生了什么）

guard 读到的一切都来自 `apps/api/src/middleware/middleware.module.ts:27-59` 的中间件链：

~~~text
Favicon → I18n → Id → Version → Timezone → Language → Ip → UserAgent → BlacklistPath
→ XSS → CSP → Session → CookieParser → Fingerprint → Cors → Compression → Helmet
→ ResponseTime → Logger
~~~

对 guard 有意义的三个：`IpMiddleware`（`req.realIp`）、`UserAgentMiddleware`
（`req.userAgent/isBot/isSuspicious/isPostman`）、`CookieParserMiddleware`（`req.signedCookies`，
`getWalnutAdminCookie` 读的就是它，`libs/cookie/src/helpers.ts:10`）。
**任一中间件被挪到 guard 之后，对应 guard 会立刻失效或全量 500。**

**ALS 上下文（数据权限）在 guard 之后才建**：`ALSRequestInterceptor` 是 `APP_INTERCEPTOR`
（`app.module.ts:145-148`），而拦截器在 guard 之后执行。它自己的注释写明了这个约束
（`libs/guards/src/interceptors/request/als.interceptor.ts:11-21`）：
"guard 先于拦截器执行，且登录链的前置查询（sys_user/sys_device/user_device）不能带数据权限"。
⇒ **任何 guard 里都不能走数据权限基类仓库**（会 `DataScopeContextMissing` fail-closed）。
现状是安全的：Device 走 `SysDeviceRepositoryService`（`device.repo.service.ts:34-36` 裸
`dataSource.getRepository`，非基类），且 `sys_device` 本身在豁免清单里
（`apps/api/src/common/repository/data-scope.ts:157`）；Lock 走 `SysUserLockService` 的 repo service。

---

## 2. 逐个 guard（12 个 APP_GUARD）

> 每节的"失败码"都是 body 业务码；HTTP 恒 200。

### 2.1 IP —— `WalnutAdminGuardIP`（第 1 位）
**文件**：`libs/guards/src/guards/ip.guard.ts`

- **职责**：查 IP 是否在**永久黑名单**，在就拒。唯一一个"零依赖外部上下文"的 guard（只读 `realIp`）。
- **依赖**：`req.realIp`（IpMiddleware）+ `SharedIpService.isIpBlacklisted`（Redis 缓存 + 库）。
- **失败码**：`40603` `NOT_ACCEPTABLE_IP_BLOCKED`（`exceptions/base/406.ts:30-36` + `response-code.ts:98`）。
- **顺序依赖**：必须是第 1 位 —— 它只依赖 `realIp`，是所有 guard 里**前置条件最少**的；
  放在后面等于"先付出了 Security/Device 的 Redis+DB 成本再拒最脏的流量"。挪后不会功能失效，
  但会让黑名单 IP 白跑完整条链（费用面）。
- **单点失效**：`isIpBlacklisted` 抛错（Redis 挂）→ 异常冒泡 → `50000`，**fail-close**（拦截）。
  这是全链唯一"基础设施故障即全站不可用"的 guard 之一。
- **可疑点**：
  - **`ipFree` 并不是"无豁免面"**（初版判错，已按实测更正）：全仓有 **3 处**显式豁免 IP 黑名单 ——
    `@WalnutAdminGuardIpFree()` 在 `modules/security/sign/sign.controller.ts:36`（**整类**
    `SecuritySignController`：RSA 公钥 / AES key 握手）、
    `modules/system/identity/user_preference.controller.ts:31`（`GET /read`，同处还挂了
    JwtOptional/DeviceFree/SignFree/MFAFree/LockFree）、
    `modules/system/locale/locale.controller.ts:163`（`GET /message/:locale` 匿名语言包）。
    ⇒ **IP 被封的客户端仍能完成签名握手、拉语言包、读偏好**。后两者对"登录页要能渲染"是合理解释，
    **但让黑名单 IP 继续拿 RSA/AES 密钥是安全面的事**，需要口径裁决（见 §7 拍板 Q4）。
  - 反向的一面：health / metrics **没有**豁免 ⇒ IP 被封时探针也会 40603（运维面）。
  - 只查 permanent 黑名单；"临时封禁/速率封禁"都不在这里。

### 2.2 Security —— `WalnutAdminGuardSecurity`（第 2 位）
**文件**：`libs/guards/src/guards/security.guard.ts`

- **职责**：UA 存在性 → 永久黑名单**路径**（命中即把该 IP 永久拉黑）→ bot → suspicious →
  OS 白名单 → 浏览器白名单。5 类拒绝。
- **依赖**：`req.userAgent/isBot/isSuspicious/realIp`（中间件）、`AppTechCacheAppSettingsService`
  （OS/浏览器白名单来自 Redis 里的 app_setting）、`app.api.prefix/version`（`stripApiPrefix`）。
- **失败码**：`40604`（UA 缺失）/ `40610`（黑名单路径）/ `40608`（bot）/ `40609`（suspicious）/
  `40601`（OS）/ `40602`（浏览器）。
- **顺序依赖**：必须在 IP 之后、Device 之前 —— ① 它会给命中黑名单路径的 IP **写**永久黑名单
  （`:68`），这个写入要发生在"后续 guard 决定是否继续"之前；② UA 白名单是"客户端能力"级过滤，
  比 Device（需要 cookie + Redis + DB）便宜得多。挪到 Device 之后：被封 UA 会先把 Device 的
  DB 回源跑一遍。
- **单点失效**：抛错 → `50000`，**fail-close**。
- **可疑点**：
  - **`isPostman` 直接放行**（`:54-56`）：注释说明它被 `isDev` 门住（生产恒 false）。
    这是"注释级安全边界"，**没有测试钉住"生产环境 isPostman 恒 false"** —— 见 per-guard-issues。
  - **黑名单路径命中会写永久黑名单**（`:68`）—— 一个 GET /wp-admin 扫描就把来源 IP 永久封死；
    共享出口（NAT/公司网）会连带。这是产品口径问题，不是 bug。
  - `isSuspicious` 与 `isBot` 的判断在中间件，guard 只读标记 —— 两层语义分散。

### 2.3 Device —— `WalnutAdminGuardDevice`（第 3 位）
**文件**：`libs/guards/src/guards/device.guard.ts`

- **职责**：从**签名 Cookie** 取 `DEVICE_ID` → 缓存查设备状态（miss 回源库 + 回填）→
  IP 变更时加锁更新 `ip/location` → `banned` → `locked`。
- **依赖**：`req.signedCookies`（CookieParser）、`AppTechCacheDeviceService`（Redis）、
  `SysDeviceRepositoryService`（**裸 repo，非数据权限基类**）、`MurLockService`（分布式锁）。
- **失败码**：`40605`（无 deviceId / 设备不存在）/ `40607`（banned）/ `40606`（locked）。
- **顺序依赖**：必须**早于所有需要 deviceId 的 guard**（Risk/CAP/MFA/Sign/Lock 全都读同一个
  cookie）。它也是第一个"能写库"的 guard（`updateIpAndLocation`）—— 放在 Risk(pre) 之前是必须的，
  因为 Risk 的 pre-auth 评估需要 `deviceId`（`risk.guard.ts:39`）。
- **单点失效**：`getSysDeviceCache` / `findDeviceByDeviceId` 抛错 → `50000`，**fail-close**。
  但注意 **IP 变更那段的写库失败会直接冒泡**（`:87-101` 无 try/catch）：
  PG 抖动时"IP 变了"的用户会被 500，而不是"照常放行"。
- **可疑点**：
  - `deviceFree` 端点（`:44-47`）**完全不校验 deviceId** → 这些端点上 Risk/CAP/MFA/Sign/Lock
    全部会因为"没有 deviceId"走各自的 skip 分支（见 §3/§7-②）。**device-free = 整条设备链豁免**，
    不只是"跳过 Device"。
  - `ipHistory/location` 的写入在 **guard 里**（不是业务层）—— 一次请求的副作用发生在鉴权链中途。
  - `deviceState.currentIp !== request.realIp` 用字符串全等；IPv6 归一化/代理头若上游没统一，
    会触发**每次请求都进锁**（`runWithLock` 200ms）—— 性能面值得压测。

### 2.4 Risk（认证前）—— `WalnutAdminGuardRisk`（第 4 位）
**文件**：`libs/guards/src/guards/risk.guard.ts:51-92`

- **职责**：**只评估不阻塞**。采 rate（fire-and-forget）+ 综合评分 → 写 `request.risk`。
- **依赖**：`req.user?.userId`（此时必为 undefined，用于**分支判断**）、`deviceId`、`realIp`、
  `req.body` 里的 identifier、`SecurityRiskService` / `SecurityRiskRateService`。
- **失败码**：**无**。设计上永不拒绝（`P1-13` 口径：风险只升级 CAP，不阻塞）。
- **顺序依赖**：必须在 JWT **之前** —— 它靠 `isNil(req.user?.userId)` 判断"这是 pre 阶段"
  （`:51`）。挪到 JWT 之后会把 pre 分支当 post 跑，`request.risk.comprehensive.preAuth`
  永远不会被生成，post 阶段拿到 `undefined`（`:110-115` 只 warn）。
  也必须在 Device 之后（要 `deviceId`）。
- **单点失效**：**fail-open**。`catch` 里非 HttpException 一律 `return true`（`:141-151`）。
  ⇒ 风险服务挂了 = **完全没有风险评估**，而下游 CAP 会因为拿不到 `recommendation` 放行（§2.5）。
  这是全链**最重要的 fail-open 组合**。
- **可疑点**：
  - `if (!deviceId) return true`（`:64-67`）：无 deviceId 直接不评估 ⇒ 与 CAP 的放行组合成
    "无设备即无风控"。
  - 用 `req.body` 取 identifier：**依赖 body 已被解析**（中间件顺序），且 body 里的
    `userName/emailAddress/phoneNumber` 会进风控；这三个键名是"业务猜测"而非契约。
  - `_riskPreAuthCollected` / `_riskPostAuthCollected` 挂在 request 上（`:55`、`:100`）——
    只有本 guard 用，属"用 request 当状态机"。

### 2.5 CAP（认证前）—— `WalnutAdminGuardCap`（第 5 位）
**文件**：`libs/guards/src/guards/cap.guard.ts`

- **职责**：读 Risk 的 `recommendation` → CAP token 硬校验（缺/无效 → 40116/40117）→
  通过后把 critical factors 标记为 handled。
- **依赖**：`request.risk.comprehensive.recommendation`（**Risk 的产物**）、`CAPJS_TOKEN` cookie、
  `DEVICE_ID` cookie、`AppTechCacheCapService`、`SecurityRiskChallengeStateService`、`MurLockService`、
  第三方 `AppCapJS.validateToken`。
- **失败码**：`40116`（需交互）/ `40117`（需静默刷新）/ `40111`（判定为 bot，
  来自 `performCapVerification` 内部 throw 后被 catch 成 false → 最终仍是 40116/40117）。
- **顺序依赖**：**必须在 Risk(pre) 之后**（读它的 `recommendation`）；必须在 JWT 之前
  （pre 阶段就要挡住机器人；且 login 端点本身走 JwtFree，JWT 对它无意义）。
- **单点失效**：**混合**。
  - `recommendation === undefined` ⇒ **fail-open**（`:89-92` "No risk evaluation found, allowing request"）。
  - CAP 第三方 API 失败 ⇒ `performCapVerification` 返回 false ⇒ **fail-close**（40116/40117）。
  - 缓存/锁抛错 ⇒ `verifyCapTokenWithLock` 重新抛出（`:197-200`）⇒ 50000，fail-close。
- **可疑点**：
  - **fail-open 的组合面**：Risk 的 fail-open（§2.4）+ 本 guard 的 `recommendation === undefined`
    放行 ⇒ **风控服务一挂，CAP 门槛整体消失**，而这是"机器人防护"的唯一执行点。
  - **pre 与 post 是同一段逻辑**（注释 `:43-47` 明说）：post 阶段会**再验一次同一个 token**
    （缓存命中快速路径），并在成功后**再次** `markCriticalFactorsAsHandled`。是否有必要跑两次
    值得确认（一次请求两次 Redis + 一次可能的第三方校验）。
  - `markCriticalFactorsAsHandled` 在 pre 阶段 `userId` 必为 undefined（`:251`），
    所以 "user-device 级因子" 在 pre 阶段标记不了、要等 post —— 依赖关系隐式。

### 2.6 JWT —— `JwtAccessGuard`（第 6 位）
**文件**：`libs/auth/src/modules/jwt/jwt-access.guard.ts`（`AuthGuard('jwt-access')`）

- **职责**：passport-jwt 校验 access token → `request.user`；`JwtFree` 直接放行；
  `JwtOptional` 无 token 时 `user = null`。
- **依赖**：AT Cookie/Header、JWT secret、`AuthSessionService`（策略里查会话）、Redis。
- **失败码**：**`40101` 恒定**（`jwt-access.guard.ts:70-72` 把所有失败都翻成
  `WalnutAdminExceptionAccessTokenExpired`）。过期 / 签名错 / 会话不存在 —— 客户端看到的都是 40101。
- **顺序依赖**：**整条链的枢纽**。之后才有 `request.user`：
  Risk(post) 靠它切分支（`risk.guard.ts:98`）、CAP(post) 靠它标 user-device 因子、
  MFA 靠它判 `mfaSetup/mfaVerified/roleMode`、Sign 靠它切双因子、Lock 靠它取 userId、
  Roles/Permission/Sensitive 直接用 `request.user`。
  **挪前**：Risk 会把 post 当 pre（`request.user` 还没有）；**挪后**：Sign 会退回单因子
  （`sign.guard.ts:139-156` 的 `if (userSession)` 分支），双因子绑定失效（历史 P0-2 就栽在这里）。
- **单点失效**：策略抛错 → `40101`，**fail-close**。
- **可疑点**：
  - **错误语义坍缩**：过期与"token 结构非法/签名错"都是 40101，客户端无法区分"该刷新"与"该重登"。
  - `JwtAccessGuard` **不走** `WalnutAdminGuardAuth` mixin（`guards/src/guards/auth.guard.ts`），
    所以 **JWT 失败不会记 `sys_log_auth`**；而登录端点（opaque/otp/oauth）走 mixin 会记。
    两套失败记录口径不一致。
  - `JwtOptional` 返回 `null`（`:64`）而 passport 惯用 `false`；下游有
    `user === false` 的判空（`:70`）说明两种形态都出现过 —— `ALSRequestInterceptor:36-39`
    的注释也专门提了这件事。

### 2.7 Risk（认证后）—— `WalnutAdminGuardRisk`（第 7 位）
- **职责**：与 pre 同一个类，**合并 pre 结果 + user/userDevice 维度**重算。
- **依赖**：`request.user.userId`（JWT）、`request.risk.comprehensive.preAuth`（第 4 位）、`deviceId`。
- **失败码**：**无**（同 pre）。
- **顺序依赖**：**必须在 JWT 之后**（否则 `userId` 为空，永远走 pre 分支、_riskPostAuthCollected
  永不置位）；必须在 CAP(post) 之前（后者读它重算后的 `recommendation`）。
- **单点失效**：**fail-open**（同 pre）。
- **可疑点**：
  - **pre 结果缺失时只 warn 继续**（`:110-115`）：若上游 Risk(pre) 被跳过（如 device-free 端点、
    或 pre 抛错被降级），post 会用 `undefined` 的 preAuth 继续算 —— 合并结果的语义是"半截"。
  - **一次请求跑两次全量评估**（pre + post）：评分服务被调用两次，Redis 读写翻倍。
    设计如此（注释 `:20-23`），但**没有性能预算记录**。

### 2.8 CAP（认证后）—— `WalnutAdminGuardCap`（第 8 位）
- **职责/依赖/失败码**：同 §2.5（同一个类）。
- **顺序依赖**：必须在 Risk(post) 之后（读重算后的 `recommendation`），必须在 MFA/Sign/Lock 之前
  （机器人不该进到会话级校验；也避免给可能被封的会话做签名派生）。
- **单点失效**：同 §2.5（`recommendation === undefined` ⇒ fail-open）。
- **可疑点**：
  - **同一请求最多两次第三方 CAP 校验**（pre 一次、post 一次，各自走缓存/锁）。
    pre 已经 `markCriticalFactorsAsHandled`，post 重算后若 criticalFactors 仍非空 →
    token 已缓存 ⇒ 走缓存命中（不重复调第三方）。但**缓存键是 (deviceId, token)**，
    若 pre/post 之间 token 被轮换（前端刷新），post 会真的再调一次第三方。
  - **pre 与 post 的 skip 条件完全相同**（capFree / isPostman）：给某个端点挂 `CapFree`
    等于**同时**跳过 pre 与 post —— 语义上无法只跳一个。

### 2.9 MFA —— `WalnutAdminGuardMFA`（第 9 位）
**文件**：`libs/guards/src/guards/mfa.guard.ts`

- **职责**：`mfaSetup` 未开 → 40114；开了但本会话未验证 → 查"设备级临时信任"缓存，命中放行，
  否则 40115。
- **依赖**：`request.user`（JWT 写入的 `mfaSetup / mfaVerified / roleMode / currentRoleName / userId`）、
  `DEVICE_ID` cookie、`AppTechCacheMfaService`。
- **失败码**：`40114`（未开通）/ `40115`（需验证）。
- **顺序依赖**：**必须在 JWT 之后**（要 `request.user.mfaSetup`）；必须在 Lock 之前（
  被锁账号不该先拿到"MFA 已通过"的判定）—— 当前顺序满足。
- **单点失效**：缓存抛错 → `50000`，**fail-close**。但 `!user` 时 `return true`（`:40-44`）
  —— 对 JwtFree/Optional 端点是"自然放行"，不是漏洞（那些端点本来无会话）。
- **可疑点**：
  - **visitor 角色整段跳过**（`:47-50`）：visitor 不强制 MFA 是产品口径，但意味着
    "切到 visitor 角色"能绕过 MFA 门槛（只要业务上允许切到 visitor 且该角色能访问目标端点）。
    与 Roles/Permission 里的 visitor 特殊分支（`:65-69` / `:84-98`）叠加时，需要确认
    "visitor 能干什么"这一条口径是单点定义的。
  - `mfaVerified` 是**会话内**标记（JWT payload），而设备信任缓存是**跨会话**的 ——
    两个信任来源并列，吊销路径必须都清（谁负责清？见 per-guard-issues）。

### 2.10 Sign —— `WalnutAdminGuardSign`（第 10 位）
**文件**：`libs/guards/src/guards/sign.guard.ts`（426 行，全链最复杂）

- **职责**：RSA 已握手 → 时间戳（±5min）→ nonce 原子去重（Redis SET NX）→ sign ticket 校验/续签 →
  取 AES key → **按是否登录选单因子/双因子 HMAC** → 时序安全比对。
- **依赖**：`sign/ua/nonce/timestamp` 头、`DEVICE_ID`/`SIGN_TICKET` cookie、
  `AppTechCacheSignService`/`AppTechCacheRsaService`、`AuthSessionService.deriveApiSignKey`、
  `req.user`、`req.body`、`req.url`（`splitPathAndQuery` + `stripApiPrefix`）、`MurLockService`。
- **失败码**：`40112`（签名错/头缺失/nonce 重复/ticket 不匹配/双因子派生失败）、
  `40113`（AES key 缺失 = 握手过期）。
- **顺序依赖**：**注释明写必须在 JWT 之后**（`app.module.ts:127`）。机制：`req.user` 存在
  → 双因子（`sign.guard.ts:139-150`）；不存在 → 单因子。挪到 JWT 之前：所有登录态请求都会
  用单因子验签，**会话绑定消失**（P0-2 记录过这条被利用的路径，`:382-390`）。
  也必须在 MFA 之后（未通过 MFA 的会话不该拿到"双因子签名有效"的结论）。
- **单点失效**：redis/锁/派生失败全部抛 → 40112/40113/50000，**fail-close**。
  唯一 fail-open 是 `isPostman`（`:86-89`，dev-only）。
- **可疑点**：
  - `validateSignTicket` 里 **`signTicket` 可以缺省**（`:254` `!isNil(signTicket) && ...`）：
    服务端有 ticket、客户端不送 → **不比对**，直接续签通过。ticket 的"必须携带"没被强制。
  - **nonce 先写后校验签名**（`:108` 早于 `:159`）：签名错的请求也会**消费掉 nonce**。
    这是防重放的正确顺序（避免"先验签再记 nonce"的竞态），但意味着客户端一个错误签名
    会让该 nonce 失效（重试必须换 nonce）—— 属易踩坑，需在前端口径里写明。
  - `getSignTicketCache` 命中时**每个请求都续签**（`:266`）→ 每请求一次 Redis 写。
  - `TIMESTAMP_TOLERANCE_MS = 5 分钟`：靠客户端时钟；偏差大的设备会全量 40112。

### 2.11 Lock —— `WalnutAdminGuardLock`（第 11 位）
**文件**：`libs/guards/src/guards/lock.guard.ts`

- **职责**：查 (userId, deviceId) 的锁定状态：缓存 → 分布式锁 double-check → 回源
  `SysUserLockService.getLockForGuard`（含"跨设备锁定"策略）→ 回填缓存。
- **依赖**：`request.user.userId`、`DEVICE_ID` cookie、`AppTechCacheLockService`、
  `SysUserLockService`（repo service）、`MurLockService`。
- **失败码**：`40118` `UNAUTHORIZED_ACCOUNT_LOCKED`。
- **顺序依赖**：**必须在 JWT 之后**（`app.module.ts:133` 注释）—— 需要 `userId`；且它读的是
  "账号级"状态，放在 MFA 之后可以避免对"未通过 MFA 的会话"又做一次 DB 回源。
- **单点失效**：抛错 → `50000`，**fail-close**。
- **可疑点**：
  - `if (deviceId === null)`（`:57`）—— 但 `getWalnutAdminCookie` 返回的是
    `req.signedCookies[key]`，**缺省时是 `undefined` 不是 `null`**（`cookie/src/helpers.ts:10`）。
    ⇒ 这个分支**永不命中**，会继续用 `undefined` 拼 cache key（`${userId}:undefined`）。
    实测面：deviceFree 端点 + 已登录 → Lock 会用 undefined 当 deviceId 查一次缓存/DB。
    这是**真实的代码级 bug 候选**（优先级 P2，见 per-guard-issues）。
  - 缓存 miss 一律进分布式锁（3s）：热点用户在缓存过期瞬间会被串行化。

### 2.12 Throttler —— `WalnutAdminGuardThrottler`（第 12 位）
**文件**：`libs/guards/src/guards/throttler.guard.ts` + `libs/throttle`

- **职责**：按 `req.realIp` 计数限流；支持端点级动态覆盖
  （`@WalnutAdminDecoratorThrottle(Service)` → limit/ttl/blockDuration 一起覆盖，`:44-73`）。
- **依赖**：`req.realIp`；`@nestjs/throttler` 的**内存 storage**（`throttler.service.ts:11`）。
- **失败码**：`42900`（默认）/ `42901`（`TOO_MANY_REQUESTS_RATE_LIMITED`，动态档）。
- **顺序依赖**：**排最后是"最贵的东西最后拦"**的排序结果：限流桶本身要花一次 Redis/内存写，
  放在敏感路径之后可以让"已被 IP/Device/Sign 拒掉"的流量不消耗桶。反向的代价是
  **攻击流量已经付过 Risk/CAP/Sign 的成本**才被限流 —— 这是本链最值得讨论的顺序取舍（§8 拍板 Q2）。
- **单点失效**：内存 storage 不会抛"外部依赖"错；但 `moduleRef.get(TargetService)` 失败会抛
  → 50000（fail-close，只影响挂了动态装饰器的 2 个端点）。
- **可疑点**：
  - **进程内存储**：多副本部署时每个副本独立计数（`throttler.service.ts:11-25` 自己写了
    这条演进建议）。
  - **tracker = `realIp`**：NAT 后所有用户共享一个桶（`throttler.service.ts:27` 也点到了
    `realIp` 的可信度依赖边缘）。

---

## 3. 四个非 APP_GUARD 的 guard（`@UseGuards` 挂载）

这四个不在全局链上，**按端点/装饰器**挂载，因此它们的"顺序"是"相对全局链的末尾"
（Nest 的执行顺序：全局 guard → controller 级 → 方法级）。关键含义：**它们总能拿到
`request.user`**，且**不受 free 装饰器影响**。

| guard | 挂载方式 | 职责 | 失败码 | 依赖 | 失败姿态 |
|-------|---------|------|--------|------|---------|
| `WalnutAdminGuardRole` | `@HasRole()` → `UseGuards` | 角色集合匹配（含 combine/switch 两种 `roleMode`、root 短路、visitor 显式拒） | `40106` | 仅 `request.user`（**零 IO**） | fail-close |
| `WalnutAdminGuardPermission` | `@HasPermission()` → `UseGuards` | 权限串匹配（AND/OR 模式、root 短路、visitor 白名单 `:list`/`:read`） | `40105` | `request.user` + **Redis 权限缓存** | fail-close（缓存缺失即拒） |
| `WalnutAdminGuardFunctional` | `@Functional()` → `UseGuards` | 功能开关（app_setting 里的开关值） | `50301` | `AppTechCacheAppSettingsService` | **fail-open**（默认；`defaultClosed` 端点才 fail-close） |
| `WalnutAdminGuardSensitive` | `@WalnutAdminGuardRequireSensitive()` → `UseGuards` | 敏感操作二次验证等级 | `40119` / `40101`(无 user) | `request.user` + deviceId + `SecuritySensitiveService` | fail-close |

**可疑点**：

- **Roles vs Permission 的 visitor 口径分叉**：Roles 里 visitor **一律拒**（`roles.guard.ts:65-69`）；
  Permission 里 visitor 有白名单（`permission.guard.ts:27-35`：固定放行 `app:shared:ali:sts`，
  且**任何** `:list`/`:read` 结尾的权限都放行）。⇒ 只挂 `@HasPermission` 的端点对 visitor 开放
  读面，只挂 `@HasRole` 的全拒。**这是有意的产品设计还是历史遗留，需要确认**（§8 拍板 Q1）。
- **Functional 的 fail-open 面**：设置缺失/坏 JSON 一律放行（除 `defaultClosed`）
  —— 意味着"清空 app_setting 的某个开关"= 打开功能。
- **Sensitive 无 user 时抛 40101**（`sensitive.guard.ts:60-62`）：语义上应该是 401 未登录，
  但它挂在 JwtFree 端点上时会掩盖真实原因。
- **Permission 的缓存缺失即拒**（`:106-108`）：Redis 被清 → 所有非 root 用户 40105，
  直到缓存重建。属 fail-close 的既有取舍，但"重建触发点"在哪需要确认。

---

## 4. 顺序依赖图

~~~mermaid
flowchart TD
  subgraph MW["中间件链（guard 之前）"]
    IPMW["IpMiddleware<br/>req.realIp"]
    UAMW["UserAgentMiddleware<br/>req.userAgent / isBot / isSuspicious / isPostman"]
    CPMW["CookieParserMiddleware<br/>req.signedCookies"]
  end

  subgraph GLOBAL["全局 guard（APP_GUARD，顺序即安全语义）"]
    G1["1 IP<br/>realIp"]
    G2["2 Security<br/>UA + 路径黑名单 + 白名单"]
    G3["3 Device<br/>deviceId → banned/locked"]
    G4["4 Risk(pre)<br/>写 request.risk.preAuth"]
    G5["5 CAP(pre)<br/>读 recommendation"]
    G6["6 JWT<br/>写 request.user"]
    G7["7 Risk(post)<br/>合并 pre + user"]
    G8["8 CAP(post)<br/>读新 recommendation"]
    G9["9 MFA<br/>user.mfaSetup/Verified"]
    G10["10 Sign<br/>单因子 or 双因子（看 user）"]
    G11["11 Lock<br/>user + deviceId"]
    G12["12 Throttler<br/>realIp 计数"]
  end

  subgraph EP["端点级 guard（UseGuards，恒在全局链之后）"]
    R["Role<br/>40106"]
    P["Permission<br/>40105"]
    F["Functional<br/>50301"]
    S["Sensitive<br/>40119"]
  end

  ALS["ALSRequestInterceptor（APP_INTERCEPTOR，**guard 之后**）<br/>数据权限上下文"]
  H["handler"]

  IPMW --> UAMW --> CPMW --> G1 --> G2 --> G3 --> G4 --> G5 --> G6 --> G7 --> G8 --> G9 --> G10 --> G11 --> G12
  G12 --> R
  G12 --> P
  G12 --> F
  G12 --> S
  R --> ALS
  P --> ALS
  F --> ALS
  S --> ALS
  ALS --> H

  G4 -. "request.risk" .-> G5
  G4 -. "preAuth" .-> G7
  G6 -. "request.user" .-> G7
  G6 -. "user" .-> G9
  G6 -. "user → 双因子" .-> G10
  G6 -. "userId" .-> G11
  G3 -. "deviceId cookie" .-> G4
  G3 -. "deviceId" .-> G10
~~~

**三条最硬的边**（挪动会立刻改变安全语义）：

1. `G4 → G6`：Risk(pre) 靠 **没有 user** 判定自己是 pre。JWT 一旦挪到它前面，pre 分支永不执行。
2. `G6 → G10`：Sign 靠 **有 user** 切双因子。JWT 挪到 Sign 之后 ⇒ 全站退回单因子（会话绑定消失）。
3. `G6 → G11`：Lock 要 `userId`。反过来把 Lock 放到 JWT 前 ⇒ 它对所有请求都"跳过"（`:49-53`），
   等于**锁定功能静默失效**（不是报错，是放行 —— 更危险）。

---

## 5. guard × 依赖上下文 矩阵

图例：● 强依赖（缺了就失效） · ○ 弱依赖（缺了走另一分支） · — 不需要

| guard | realIp | userAgent<br/>isBot/isSusp | cookies<br/>(deviceId) | request.user | request.risk | request.body | Redis<br/>缓存 | PG/DB | 外部服务 | 分布式锁 |
|-------|:------:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 IP | ● | — | — | — | — | — | ● | ○ | — | — |
| 2 Security | ● | ● | — | — | — | — | ● | — | — | — |
| 3 Device | ○ | — | ● | — | — | — | ● | ● | — | ● |
| 4 Risk(pre) | ● | — | ● | ○（需**无** user） | — | ○ | ● | ● | ○ | — |
| 5 CAP(pre) | — | — | ● | — | ● | — | ● | — | ●(CAP API) | ● |
| 6 JWT | — | — | ○ | —（写入者） | — | — | ● | ○ | — | — |
| 7 Risk(post) | ● | — | ● | ● | ○（pre 结果） | ○ | ● | ● | ○ | — |
| 8 CAP(post) | — | — | ● | ○（因子标记） | ● | — | ● | — | ● | ● |
| 9 MFA | — | — | ● | ● | — | — | ● | — | — | — |
| 10 Sign | — | — | ● | ●（切双因子） | — | ● | ● | — | — | ● |
| 11 Lock | — | — | ● | ● | — | — | ● | ● | — | ● |
| 12 Throttler | ● | — | — | — | — | — | —（进程内） | — | — | — |
| Role | — | — | — | ● | — | — | — | — | — | — |
| Permission | — | — | ○ | ● | — | — | ● | — | — | — |
| Functional | — | — | — | — | — | — | ● | — | — | — |
| Sensitive | — | — | ● | ● | — | — | ○ | ● | — | — |

**读法**：`request.user` 的列有 6 个 ●，全部在 JWT 之后 —— 这就是"JWT 必须在第 6 位"的量化依据；
`deviceId` 一列 8 个 ●，是**第二重要的枢纽**（Device 必须在第 3 位）。

---

## 6. 横切发现（不属于单个 guard）

### ① 顺序是安全语义，但**没有门禁**

`git grep getGlobalGuards` → **0 命中**。12 个 guard 的先后只写在 `app.module.ts:79` 的注释、
AGENTS.md 表格、以及 `tech.module.ts:31-33` 的说明里。任何一次"整理 providers 顺序"、
或把 `AppTechModule` 挪位置/改成 `@Global`，都可能静默改变安全语义，而 lint/类型/单测全绿。
**这是本轮最大的一条系统性风险。**

### ② 三种"豁免"是**不同粒度**的，容易混用

| 装饰器 | 只跳 | 连带影响 |
|--------|------|---------|
| `IpFree` | IP（第 1 位） | 3 处：签名握手**整类** / 偏好读 / 匿名语言包 —— 被封 IP 仍可访问这些面 |
| `DeviceFree` | Device | **连带** Risk(pre) 无 deviceId → 不评估；CAP 无 recommendation → 放行；MFA/Lock 读不到 deviceId → 走跳过分支 |
| `CapFree` | CAP（pre **和** post） | 无法只跳一个阶段 |
| `JwtFree` | JWT | 下游 6 个 guard 的 `request.user` 全部为空 → Risk 走 pre、Sign 走单因子、MFA/Lock/Role/Permission 走各自 skip/throw |
| `MFAFree` / `LockFree` / `SignFree` | 各自 | 单点 |

⇒ **`DeviceFree` 与 `JwtFree` 是"重"豁免**（实际关掉半条链）。当前用到它们的都是登录/握手端点
（refresh、cap、rsa、oauth、app.controller），符合预期；但没有一张"哪些端点挂了哪些 free"的
矩阵门禁（那是 task-5 的范围，本轮只标出耦合）。

### ③ 失败的观测口径

所有 guard 的拒绝都是 **HTTP 200 + body.code**（`exception.filter.ts:93`）。
唯一会变成 `50000` 的是"guard 内部基础设施异常"（Redis/PG/锁/第三方），
而 `50000` 会被 `shouldReportException` 判为服务端故障 → 入 `sys_error` 队列
（`exception.filter.ts:36-41`）。⇒ **风控/限流的依赖故障会污染错误库**，需要区分"预期拒绝"与"依赖故障"。

### ④ `GuardEnv` / `GuardVisitorDeny` 疑似死代码

`git grep WalnutAdminGuardEnv` / `WalnutAdminGuardVisitorDeny` → 只有定义与自身装饰器，
**零业务引用**（`guards/src/guards/env.guard.ts`、`visitor.guard.ts`）。barrel 仍导出
（`guards/src/index.ts:33,45`）。死代码在安全面里的成本是"读代码的人以为它在生效"。

---

## 7. 需要 Lead 拍板

### Q1 · Visitor 角色的权限口径要不要统一？
**背景**：Roles guard 对 visitor **一律拒**（`roles.guard.ts:65-69`）；Permission guard 对 visitor
有白名单 —— **任何** `:list`/`:read` 权限都放行 + 硬编码 `app:shared:ali:sts`
（`permission.guard.ts:27-35`）。⇒ visitor 能不能读某个列表，取决于该端点挂的是 Role 还是 Permission。
**选项**：
- **A. 保持现状**（现状即口径，补一条测试钉住"visitor + 只读端点"的矩阵）。零改动。
- **B. 统一到 Permission 的白名单**（Roles 对 visitor 也走白名单）。行为变宽（visitor 能访问挂了 Role 的只读端点）。
- **C. 统一到 Roles 的全拒**（Permission 去掉 visitor 白名单）。行为变窄，**可能打断现有 demo/visitor 体验**。
**推荐 A + 补矩阵测试**：这是一条"必须有唯一口径、但本轮不该改行为"的规则；先钉住现状，谁要改谁提产品需求。

### Q2 · Throttler 排在最后（第 12 位）是否符合预期？
**背景**：实测确认它在最后。好处是"已被前 11 个 guard 拒掉的流量不消耗限流桶"；
坏处是**攻击流量要先付 Risk/CAP/Sign 的成本才被限流**（CAP 可能触发第三方调用）。
**选项**：
- **A. 保持最后**（现状）。省钱在"合法但被拒"的流量上。
- **B. 提到第 1 位之后（第 2 位）**：最便宜的粗筛先做，攻击流量几乎零成本被挡；
  代价是"被限流桶计数"的语义变成"包括已被 IP 拒掉的请求"，且要重新评估 CAP 端点
  自己的动态限流档（`@WalnutAdminDecoratorThrottle`）与全局桶的关系。
- **C. 折中：放在 Device 之后、Risk 之前**（第 4 位）。在"有 identity 可用"（deviceId）
  与"最贵的风控之前"之间。
**推荐 C**（若要做）：限流的目标是"挡住打过来的流量"，而 Risk/CAP/Sign 是本链最贵的三步；
放在它们之前才有防护意义。若本轮不改，至少把"为什么在最后"写进 ADR/AGENTS 的理由栏。

### Q3 · 要不要给"12 个 guard 的顺序"加一条机械门禁？
**背景**：顺序只存在于注释。实测方法已跑通（`container.applicationConfig.getGlobalGuards()`，
同构探针 20 行）；对一个真实 app 断言需要 PG+Redis（集成测试环境已有）。
**选项**：
- **A. 加集成测试**：在 `vitest.config.integration.ts` 里起真实 app，断言 12 个 guard 的
  构造器顺序 + total=12。**最硬**，但需要真实 bootstrap（慢、依赖库）。
- **B. 加纯静态 spec**：读 `app.module.ts` + `tech.module.ts` 的源码顺序 + 断言"根模块 APP_GUARD
  全部先于子模块"这条 Nest 语义（我本轮探针已证明）。零依赖、快，但只测"源码写了什么"，
  不测"Nest 最终怎么排"。
- **C. 不加门禁**，只在 AGENTS.md 补一句"顺序是安全语义，改动必须人工评审"。
**推荐 A**（本轮已有实测方法可直接固化）；退一步至少 B。**这是我认为最该做的一条。**

### Q4 · IP 黑名单的 3 处豁免是否都要保留？
**背景**：`@WalnutAdminGuardIpFree()` 实测 3 处（见 §2.1）：签名握手**整类**
（`security/sign/sign.controller.ts:36`）、偏好读（`user_preference.controller.ts:31`）、
匿名语言包（`locale.controller.ts:163`）。⇒ **已被判为黑名单的 IP 仍能拿 RSA/AES 密钥、
读偏好、拉语言包。** 而 health/metrics 反而没有豁免。
**选项**：
- **A. 保持现状**：登录页可用性优先（拿不到语言包/密钥就打不开登录页），黑名单只挡"业务面"。
- **B. 收窄到只留语言包**（去掉 sign 与 user_preference 的 IpFree）：黑名单 IP 不能再握手；
  代价是"被封 IP 客户端连登录页都初始化不了"（可能反而更难排查）。
- **C. 保留 3 处豁免，但给 sign 握手加二级限制**（如仍校验 deviceId/或只允许公钥读取、
  不允许 AES 协商）。
**推荐 A + 补理由注释**：这三处的共同点是"首屏/握手必需"，把它们打掉会让黑名单 IP 连错误提示
都看不到；但必须在 controller 上写明"为什么豁免"，否则下一个人无法判断能不能删。
若安全侧坚持收窄，走 B 而不是 C（C 引入新的分层语义，成本高）。

---

## 8. 附：本轮方法与可复跑性

- 顺序实测：临时探针 `apps/server/__tmp_guard_order.cjs` / `__tmp_guard_dup.cjs`
  （plain CJS，`node` 直跑；**跑完已删**，`git status --porcelain` 已回空）。
- 复跑命令：`cd apps/server && node __tmp_guard_order.cjs`（需按 §1.2 的内容重建探针）。
- 未做：真实 `AppModule` 的 `getGlobalGuards()`（需 PG+Redis + 会 drop 集成库）、
  api-spec/int-spec（同上）、任何源码改动。
