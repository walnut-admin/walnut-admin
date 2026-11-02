# I1 设备追踪全链路 review（FE 指纹 → BE deviceId → cookie → DeviceGuard）

> 任务板：`task-1` ｜ 作者：server-review ｜ 性质：**只读调研**（未改任何源码；唯一新增产物是本文件）
> 基线：`HEAD bb2ee648` + 工作树（仅 `apps/docs/.../10-implementation-plan.md` 一处与设备无关的改动）
> 方法：全链路读码 + 2 个只读探针（① PG 里真实设备行形态 ② `HMAC(fp, key) == device_id` 的数学验证）；临时脚本放 `%TEMP%` 已删
> **观测口径**：全局异常过滤器恒回 HTTP 200（`libs/exceptions/src/exception.filter.ts:93`），错误码在 body。下文所有 code 都是 `body.code`。
>
> **并发改动提示（写报告时的工作树状态）**：`apps/admin/src/App/src/bootstrap.ts` 正被另一条评审线改动（给 `sign` 步骤加「重置本机密钥」错误屏按钮），
> 以及 `libs/{cache/rsa,rsa}/**` 有在途改动 —— 这三处与设备链路无关，但 **bootstrap.ts 的行号可能漂移**；本报告对它的引用以语义（步骤名 `device-id` / `sign`）为准。

---

## 0. 结论速览

| # | 问题 | 判定 | 支撑 |
|---|------|------|------|
| 1 | 指纹怎么生成、含哪些字段、可伪造？ | **FingerprintJS v3 组件哈希 + 3 个自定义组件；纯客户端、可任意伪造（就是一个请求头）** | `app-fingerprint.ts:151-172`、`fingerprint.middleware.ts:10-11` |
| 2 | deviceId 何时签发、cookie 形态、续期？ | **只在 `/system/device/initial`（匿名）签发；`__Host-`/`__Secure-DEVICE_ID`，httpOnly+secure+signed，maxAge 30 天；无任何续期** | `device.controller.ts:71-81`、`cookie.service.ts:12-60` |
| 3 | DeviceGuard 校验什么、失败码、谁跳过？ | **只验「cookie 有 deviceId + 缓存/库里存在 + 未 banned/locked」；40605/40606/407；11 个端点显式跳过** | `device.guard.ts:35-115`、`base/406.ts:46-68` |
| 4 | 状态机字段、流转、能否卡死 | **sys_device{active,locked,banned,private} + sys_user_device{locked,trusted+TTL,link,lastActiveAt}；`active` 不参与鉴权；**能卡死**（见 P0-1） | §4 表 |
| 5 | 禁用闭环 | **不闭环**：入口/生效/解禁都有，但 ① 改指纹即绕过 ② 等 cron 删行可绕过 ③ 不吊销会话（refresh 照跑、WebSocket 照连） | P1-1 / P1-2 |
| 6 | 跨端一致性 | **码值对得上**（40605→device / 40606→deviceLocked / 40607→deviceBanned，三个 i18n key 都在 seed 里）；**但没有恢复路径**（40605 是死胡同） | `response/interceptor.ts:101-111`、`sys_locale.json` |
| 7 | device id 可被前端任意指定？ | **是（间接且完全可控）**：`deviceId = HMAC_SHA256(请求头指纹, 服务端 key)`，**已实测确认**；配合「指纹对管理员可见」可冒充任意设备 | §7 + 探针输出 |

**最重的两条**：`P0-1`（cookie 硬过期 30 天 + 前端 localStorage 门闩 ⇒ 到期后无法登录、全站 40605、无自救）、`P0-2`（设备身份可被自报指纹冒充 ⇒ 可订阅他人 OAuth 登录结果流）。

---

## 1. 全链路（8 步，带代码位置）

~~~text
① FE 首次启动   setupFingerprint()  → FingerprintJS.load().get() + 3 自定义组件 → visitorId(32 hex) → localStorage.FINGERPRINT
                 app-fingerprint.ts:147-173
② 每个请求      axios 请求拦截器加请求头 FINGERPRINT: <visitorId>；socket 握手同头
                 utils/axios/interceptors/request/interceptor.ts:20-21 · socket/index.ts:63
③ BE 中间件     FingerprintMiddleware 把请求头原样写入 req.fingerprint（零校验）
                 apps/api/src/middleware/src/fingerprint.middleware.ts:9-14
④ FE 首次启动   setupDeviceId() → POST /system/device/initial（Sign/JWT/CAP/Device 四 Free，匿名）
                 app-geo-ip.ts:41-47 · device.controller.ts:52-63
⑤ BE 签身份     deviceId = HMAC_SHA256(fp, DEVICE_ID_ENCRYPTION_KEY) → upsert sys_device → 种签名 cookie（30 天）
                 device.repo.service.ts:41-43 · crypto.service.ts:130-138 · device.service.ts:82-150 · device.controller.ts:71-81
⑥ 每个请求      DeviceGuard：读 cookie → 缓存 → miss 回源 DB → banned? 40607 : locked? 40606 : 放行（IP 变化顺手更新 ip/定位）
                 device.guard.ts:35-115
⑦ 心跳          POST /app/monitor/user/state（匿名）→ app_monitor_user（键 = body.visitorId）→ 联动 device.active
                 user.controller.ts:131-160 · monitor/user/user.service.ts:38-74
⑧ cron 每 30min active=true 且「没有 left=false 的监控行」的设备 → 删 sys_device 行 + 删监控行
                 task.service.ts:124-141 · user_device.shared.service.ts:119-163
~~~

---

## 2. Q1 — 指纹怎么生成、包含哪些字段、可伪造吗

**生成**（`apps/admin/src/store/modules/app/app-fingerprint.ts`）：

1. `FingerprintJS.load({})` + `fp.get()` 拿到**开源版 FingerprintJS v3** 的全部组件（canvas/webgl/audio/fonts/plugins/…，`:151-153`）；
2. 再叠 3 个自定义组件（`:155-164`）：
   - `storageSig`：`navigator.storage.estimate()` 的配额分级 + **`usage:<MB>`** + `persisted`（`:15-48`）
   - `browserBrand`：UA-CH `userAgentData.brands` / `fullVersionList`，退化到 UA 字符串（`:51-89`）
   - `browserFeatures`：`msLaunchUri` / `chrome.webstore` / `pdfViewerEnabled` / `backdrop-filter` / WebGL vendor（`:92-128`）
3. `FingerprintJS.hashComponents({...})` → `visitorId`（实测 32 位 hex，见 §7 探针）；
4. 落在 **localStorage**（`useAppStorageSync(FINGERPRINT, '', { storage: enhancedBase64LocalStorage() })`，`:130`），**一旦有值就永不重算**（`:148-149`）。

**上报**：每个 axios 请求加 `FINGERPRINT` 头（`const/app.ts:71` → `interceptor.ts:20-21`），socket 握手再加一次（`socket/index.ts:63`）；另外心跳把**同一个值**放进 body 的 `visitorId`（`hooks/web/useMonitor.ts:57`）。

**可伪造吗？—— 完全可以，它就是客户端自报的字符串**：

~~~text
// apps/server/apps/api/src/middleware/src/fingerprint.middleware.ts:9-14
const fp = req.headers[RequestHeaders.FINGERPRINT.toLocaleLowerCase()] as string
req.fingerprint = fp          // ← 零校验、零签名、零来源约束
next()
~~~

服务端**没有任何**「指纹应由浏览器计算」的证明机制（无 WebAuthn、无服务端 challenge、无设备证书）。所以：**指纹是 bearer 式身份声明**，不是硬件标识。

**附带一条设计缺陷**：`storageSig` 里含 `usage:<MB>`（`app-fingerprint.ts:33`）—— 这是一个**会随使用变化的测量值**，却进了「稳定身份」的哈希。localStorage 被清（或换 profile）后重算指纹会因为 usage 不同而得到**不同的 visitorId**，同一台物理设备因此产生多条设备身份（见 P2-2）。

---

## 3. Q2 — deviceId 何时签发、cookie 形态、何时续期

| 项 | 实测 |
|---|---|
| 签发点 | **唯一**：`POST /system/device/initial`（`device.controller.ts:52-89`） |
| 触发时机 | 前端 `setupDeviceId()`：**localStorage 里没有 `GEO_IP_DEVICE_ID` 时才调**（`app-geo-ip.ts:41-47`） |
| deviceId 形态 | `HMAC_SHA256(指纹, DEVICE_ID_ENCRYPTION_KEY)` → 64 位小写 hex（实测 64；`pipes/format.pipe.ts:44` 也按 `^[0-9a-f]{64}$` 校验） |
| cookie 名 | dev `__Host-DEVICE_ID` / **prod `__Secure-DEVICE_ID`** / **stage 裸名 `DEVICE_ID`**（`const/app/cookie.ts:5-22`） |
| cookie 值 | **deviceId 原文（不是密文）** + cookie-parser 签名（`signed: true`） |
| 属性 | `httpOnly: true` · `secure: true` · `path: '/'` · `sameSite: 'lax'`（dev/stage）/ `'none'` + `domain: .<pkg.domain>`（prod）（`cookie.service.ts:12-60`） |
| maxAge | **30 天**（`device.controller.ts:71`：`30*24*60*60*1000`） |
| 续期 | **没有**。全仓 `setResponseCookie({key: DEVICE_ID})` 只有 `device.controller.ts:75` 一处；`initial` 又受 localStorage 门闩限制 ⇒ **cookie 一到期就不会再被续** |
| 清理 | 无（signout 只清 `RT_JTI`，`auth.controller.ts:61`；不清 DEVICE_ID —— 这点是对的） |

**结论**：`deviceId` 是「指纹的确定性函数」，cookie 只是把它签名后交给浏览器保管；**没有任何轮换/续期/绑定用户**的机制。

---

## 4. Q3 — DeviceGuard 每次请求校验什么、失败返回什么、谁跳过

**校验链**（`libs/guards/src/guards/device.guard.ts:35-115`，顺序即代码顺序）：

| 步 | 逻辑 | 行 |
|---|---|---|
| 1 | handler/class 上有 `@WalnutAdminGuardDeviceFree()` ⇒ 直接放行 | `:39-47` |
| 2 | 读签名 cookie `DEVICE_ID`；缺失（含签名不匹配被 cookie-parser 置 false）⇒ **40605** | `:49-54` |
| 3 | `request.isPostman`（**仅 dev 生效**，见 D-09）⇒ 放行 | `:56-60` |
| 4 | 读 Redis 设备缓存 `SYSTEM:DEVICE:<deviceId>`；miss ⇒ **回源 DB**（P2-2 修复）→ 再 miss ⇒ **40605** | `:62-85` |
| 5 | `currentIp` 与本次 `realIp` 不同 ⇒ 加 murlock 锁 → 更新 `ip/location/ipHistory`（**副作用写在 GET 链路上**） | `:87-101` |
| 6 | `banned === true` ⇒ **40607** | `:103-106` |
| 7 | `locked === true` ⇒ **40606** | `:108-111` |
| 8 | 放行 | `:114` |

**失败码**（`libs/exceptions/src/base/406.ts:46-68` → `contract/response-code.ts:102-106`）：`40605 NOT_ACCEPTABLE_DEVICE_UNSUPPORTED` · `40606 …_DEVICE_LOCKED` · `40607 …_DEVICE_BANNED`，全部包在 HTTP 200 里。

**注意：guard 读了 `active` 但从不判定**（`:82` 放进 `deviceState` 后没人用）—— `active` 是「在线心跳」而非「启用」，见 Q4。

**跳过 DeviceGuard 的端点（11 个，`@WalnutAdminGuardDeviceFree()` 全量）**：

| 端点 | 位置 | 说明 |
|---|---|---|
| `GET /` | `apps/api/src/app/app.controller.ts:13` | 根路由 |
| `POST /system/device/initial` | `device.controller.ts:57` | 设备注册（必须匿名） |
| `POST /auth/refresh` | `refresh.controller.ts:34` | **刷新令牌**（见 P1-2） |
| `POST /auth/signout` | `auth.controller.ts:46` | 登出（合理） |
| `POST /security/sign/initial` | `sign.controller.ts:35` | 签名握手 |
| `POST /security/cap/challenge` | `cap.controller.ts:71` | 人机验证 |
| `POST /app/monitor/user/state` | `user.controller.ts:136` | 心跳 |
| `GET /app/setting/public` | `app-domain/.../setting.controller.ts:57` | 公共设置 |
| `GET /system/lang/list` 等 | `lang.controller.ts:92` | 语言包 |
| `GET /system/locale/message/:locale` | `locale.controller.ts:162` | 文案 |
| `GET /system/user/preference/read` | `user_preference.controller.ts:30` | 偏好 |

**登录端点不在跳过清单里**（`opaque.user.controller.ts:23-25`、`otp.controller.ts:22-28` 只有 `JwtFree`）⇒ **没有设备 cookie 就登不了录**。这条与 P0-1 叠加，是「死锁」的关键。

---
## 5. Q4 — 设备状态机：字段、流转、能否卡死/绕过

### 5.1 字段全表（两个表）

| 载体 | 字段 | 语义 | 谁写 | 强制点 |
|---|---|---|---|---|
| `sys_device` | `active` | **在线心跳**（不是「启用」）：`initial` 置 true；心跳按 `left` 取反 | `device.service.ts:121`、`user.service.ts:71` | **DeviceGuard 不读**；只有 cron 用它筛候选（`device.repo.service.ts:48-50`） |
| `sys_device` | `locked` | 管理员「锁定设备」 | `PATCH /system/device/:id/lock`（`device.controller.ts:128-152` → `device.service.ts:239-241`） | DeviceGuard → **40606** |
| `sys_device` | `banned` | 管理员「封禁设备」 | `PATCH /system/device/:id/ban`（`device.controller.ts:180-204` → `device.service.ts:246-248`） | DeviceGuard → **40607** |
| `sys_device` | `private` | 客户端自报（无痕模式） | `initial` payload（`device.service.ts:96`） | **无任何强制**（仅展示/风控） |
| `sys_device` | `riskScore` | 风控分数（DDL CHECK 0..100） | 风控模块 | 风控 guard（不在本链路） |
| `sys_user_device` | `locked` | **用户级「锁屏」**（与设备封禁无关） | `/system/user/device/lock`（`user_device.service.ts:95-101`） | **LockGuard** → `40118`（`lock.guard.ts:105-108`） |
| `sys_user_device` | `trusted` + `trustedExpiredAt` | **MFA 信任**（默认 30 天，`user_device.repo.service.ts:44`） | MFA 通过后（`mfa.post.service.ts:37-42`） | 进 AT payload `mfaVerified`（`token.service.ts:107`）→ MfaGuard 跳过（`mfa.guard.ts:59`） |
| `sys_user_device` | `link` / `linkType` | 绑定关系 | `bindDeviceForUser`（登录） | 列表展示 |
| `sys_user_device` | `lastActiveAt` | 最近活跃 | 心跳（`user.service.ts:68`） | 列表排序 / `isTrustedAndValid` 要求非 null |

> **没有 `disabled` 字段** —— 用户问题里的「disabled」在本仓对应 `banned`（设备级）或 `locked`（用户级锁屏）。

### 5.2 流转图

~~~text
initial ──► sys_device(active=true, banned=false, locked=false)
                ├─ 心跳 left=false → active=true；left=true → active=false
                ├─ admin lock → locked=true ──► DeviceGuard 40606
                ├─ admin ban  → banned=true ──► DeviceGuard 40607
                ├─ cron（active 且无 left=false 监控行）→ 删除整行（连 banned/locked 一起抹掉）
                └─ MFA 通过 → sys_user_device.trusted=true(30d) → AT.mfaVerified=true → 跳过 MFA
~~~

### 5.3 能不能卡死？—— **能，而且是普发性的**

**场景 A（30 天硬过期，必然发生）**：cookie `maxAge` 30 天且**无续期**；而 `setupDeviceId` 在 localStorage 有值时**不再 initial**（`app-geo-ip.ts:41-47`）。到期后：

~~~text
cookie 消失
  → 任意受保护请求（含登录端点 /auth/opaque/*、/auth/otp/* —— 它们都不在 DeviceFree 清单）
  → body.code = 40605 → 前端拦截器跳 notAllowed 页（response/interceptor.ts:101-111）
  → 刷新页面：bootstrap 的 device-id 步骤因 localStorage 有值直接早退（bootstrap.ts:108 + app-geo-ip.ts:42-44）
  → 永远不会重新 initial → 永久 40605，**用户连重新登录都做不到**
自救：手工清 localStorage（或等一次会清 storage 的版本升级；migrate.ts:13-15 目前只对 1.13.0 开）
~~~

**场景 B（行被 cron 删掉）**：`updateDeviceActiveStatusForCronJob` 对「active=true 且没有 left=false 监控行」的设备调 `deleteNonMonitorUserDevice`（`user_device.shared.service.ts:134-156`；repo 过滤 `left: false` 见 `monitor/user/repo/user.repo.service.ts:82-85`）。设备行没了但 cookie 还在 ⇒ DeviceGuard 回源 DB 查不到 ⇒ **40605**，之后与场景 A 同样死锁。

### 5.4 能不能绕过？—— **能，两条都非常便宜**

1. **换指纹**：`FINGERPRINT` 是请求头，改一个字符 ⇒ 新 `deviceId` ⇒ 新设备行（banned=false）⇒ 后续请求照常。
2. **等 cron 删行**（3 个请求，无需改指纹）：`POST /app/monitor/user/state {left:true}`（active 置 false、监控行 left=true）→ `POST /system/device/initial`（active 回 true，监控行仍 left=true）→ 下一个 30 分钟 tick 删掉设备行 → 再 `initial` ⇒ 干净新行。

---
## 6. Q5 — 禁用逻辑是否闭环

| 环节 | 现状 | 判定 |
|---|---|---|
| 入口 | `PATCH /system/device/:id/{lock,unlock,ban,unban}`，权限点 `system:device:{lock,unlock,ban,unban}` + `READ`（`device.controller.ts:20-29,128-230`） | 有 |
| 生效范围 | **所有非 DeviceFree 的 HTTP 请求**，下一次请求即生效（缓存 after-commit 双写 + miss 回源） | 基本正确 |
| 已登录会话 | **不吊销**：AT 会话键不删、`/auth/refresh` 是 DeviceFree（`refresh.controller.ts:30-34`）⇒ 可无限续 AT；只是续出的 AT 在受保护端点上被 40606/40607 拦 | **未闭环**（P1-2） |
| WebSocket | 握手只验 JWT + 会话键，**不查 banned/locked**（`socket.middleware.ts:33-71`） | **未闭环**（P1-2） |
| 持久性 | `banned/locked` 只存在 `sys_device` 行上，而该行会被 cron 删除、也可被换指纹绕过 | **未闭环**（P1-1） |
| 解禁 | `unlock` / `unban` 同入口，写 DB + 缓存 | 有 |

**结论**：`ban` 是「让这台**自称的**设备在 HTTP 面立刻不好使」的临时降噪，不是「让这个人/这台机器不能用」的安全控制。仓库有一条 happy-path api-spec（`guard-matrix.api-spec.ts:607-614`：第二设备 HTTP ban → 本设备 40607 → unban → 恢复放行），**未覆盖**上面两条绕过。

---

## 7. Q6 — 跨端一致性：前端如何感知「设备被禁用」

**码值对得上**（`apps/admin/src/utils/axios/interceptors/response/interceptor.ts:94-111`）：

~~~text
40605 → 'device'       → $t('app.base.device')       → 当前设备不受支持
40606 → 'deviceLocked' → $t('app.base.deviceLocked') → 设备已被锁定
40607 → 'deviceBanned' → $t('app.base.deviceBanned') → 设备已被封禁
三者都 → AppRouter.replace({ name: notAllowed, query: { type } }) → 文案 app.base.notAllowedDetail({ type })
~~~

- 三个 i18n key **都存在**（`apps/server/db/seed/sys_locale.json` 可查到 `app.base.device` / `deviceLocked` / `deviceBanned` / `notAllowed` / `notAllowedDetail`）⇒ **文案不是 bug**。
- **问题是 40605 被当成「永久拒绝」**：它实际还表示「cookie 过期 / 被删 / 行被删」三种**可自愈**情形，而前端没有任何自愈动作（对比：40101 有 `SingletonPromiseRefreshToken` 自动续、40113 有自动重签）。
- 40605 **无法区分**「设备被拒」与「需要重建设备」⇒ 建议新增独立码（P2-3）。

---

## 8. Q7 — 「设备 id 可被前端任意指定」这类越权面

### 8.1 直接指定 deviceId？—— 不行

- cookie 是 `signed: true`（`cookie.service.ts:83`），篡改会被 cookie-parser 置 false ⇒ guard 视为缺失 ⇒ 40605；有 api-spec 守着（`guard-matrix.api-spec.ts:594-603`「篡改 DEVICE_ID → 40605」）。
- 也不能用 A 的 cookie + B 的 AT：会话键是 `(userId, deviceId, sid)`（`jwt-access.strategy.ts:41-56`），跨设备重放直接 40101（`guard-matrix.api-spec.ts:499`）。

### 8.2 但可以「间接指定」—— deviceId 是指纹的确定性函数（本轮实测确认）

探针（只读：读 env 里的 key 做一次 HMAC 比对，**未打印 key**）：

~~~text
monitor.visitor_id (raw fp) = 020ce1fb9ab27da269915faff17a6814 | len 32
sys_device.device_id        = b134ab6a6a04dcf3185f5600d2e72c768acab4e3ab15f35c2a324609c0f99bea | len 64
HMAC_SHA256(fp, DEVICE_ID_ENCRYPTION_KEY) = b134ab6a6a04dcf3185f5600d2e72c768acab4e3ab15f35c2a324609c0f99bea
MATCH = true
device_name = DESKTOP_020CE1 | fp.slice(0,6).toUpperCase() = 020CE1
~~~

⇒ **`device_id == HMAC(fp)`**（实证）。于是「知道某台设备的指纹」≈「能拿到它的 deviceId」，而 `POST /system/device/initial` 是**匿名**的、会为传入指纹**签发一枚合法签名 cookie**（`device.controller.ts:52-89`；api-spec `device.api-spec.ts:105` 明写「同指纹重放 → 幂等回同一 deviceId + cookie 重签」）。

### 8.3 指纹从哪来？—— 它就在管理端响应里

`AppMonitorUserDTOBase.visitorId` 的 swagger title 直接写着 **fingerprint for auth and no auth users**（`libs/app-domain/src/monitor/user/dto/user.dto.ts:21-26`），并且出现在 `POST /app/monitor/user/list` / `read` 的响应里（api-spec 即断言 `data[0].visitorId`，`monitor-user.api-spec.ts:189`）。PG 实测：`app_monitor_user.visitor_id` 长度 32（原生指纹），`sys_device.device_id` 长度 64（HMAC）。

### 8.4 拿到别人设备身份之后能干什么（按危害排序）

1. **订阅别人的 OAuth 登录结果流 → 账号接管**（最严重）：SSE 频道键 = `oauth/<provider>/device/<deviceId>`（`github.controller.ts:72-81`），订阅端点 `@Sse('sse/:fp')` **JWT-free**（类级 `@WalnutAdminGuardJwtFree()`，`:37`），且 `createClient` 是**同键多订阅共享同一 Subject**（`sse.service.ts:44-66`，注释原话「同频道的订阅者都能收到」）。攻击者用伪造指纹铸出的 cookie 订阅受害者频道后，受害者完成 OAuth 时 `sendToClient` 会把 `accessToken + sessionKey` **同时投给攻击者的流**。
2. **改写别人的设备行**：`initial` 是 upsert 整体覆盖（`device.service.ts:94-126` + `device.basic.repository.ts:39-53`）→ 覆盖 `deviceName`/`deviceInfo`/`hardwareInfo`/`locationInfo`/`locationHistory`/`ip`/`ipHistory`/`active`（`banned`/`locked` 不在写集，这点是好的）。可污染设备记录、制造 `uq_device_name` 冲突（把别人 initial 打到 40000）。
3. **把监控行指向自己**：见 P1-3。

> 注意：这**不等于**账号接管本体（AT 还需匹配 `(userId, deviceId, sid)`），但第 1 条是实打实的凭据窃取面。

---
## 9. 发现清单

> 每条给：**是否确认 / 复现步骤 / 修复方案 / 影响面**。「能推断」= 代码路径确定但未起服务实跑；「能复现」= 已有实测输出或仓库内已有 api-spec 钉住。

### P0-1 设备 cookie 30 天硬过期 + 前端 localStorage 门闩 ⇒ 到期后**无法登录**、全站 40605、无自救

- **是否确认**：**能复现**（后端 40605 由 `guard-matrix.api-spec.ts:582-592` 钉住；前端无恢复路径由代码确定；cookie 唯一写入点已全仓核过）
- **证据**：`device.controller.ts:71-81`（唯一写 cookie 处，maxAge 30 天）· `app-geo-ip.ts:41-47`（localStorage 有值就不调 initial）· `useAppStorageSync` 默认 localStorage + `expire: Infinity`（`packages/platform-web/client/src/persistent/storage/sync.ts:24-35`）· `response/interceptor.ts:101-111`（40605 只跳转）· `bootstrap.ts:107-109`（device-id 是 degraded 步骤，失败不阻塞）· 登录端点不在 DeviceFree 清单（`opaque.user.controller.ts:23-25` / `otp.controller.ts:22-28`）
- **复现步骤**（dev，3 分钟）：① 打开后台任意页面 → ② DevTools 删 `__Host-DEVICE_ID` → ③ 刷新：Network 里**没有** `/system/device/initial`（localStorage 有 `GEO_IP_DEVICE_ID`）→ 任意接口 `body.code=40605` → 被 replace 到 notAllowed → ④ 尝试重新登录：同样 40605 → ⑤ 清 localStorage 后刷新才恢复
- **修复方案**：
  1. **前端自愈（推荐，最小改动）**：把 40605 接成与 40101 同款的一次性重试 —— `initialDeviceAPI()` 成功后重放原请求（带「只重试一次」的标记，避免死循环）；
  2. 去掉纯 localStorage 门闩：`setupDeviceId` 改为「localStorage 与 cookie 都在」才早退；
  3. 后端纵深：在 guard 里对「cookie 剩余有效期 < 7 天」的响应重签（需要拦截器带 res），或加 `POST /system/device/touch`（DeviceFree）供前端定期换 cookie。
  4. **与在途改动的呼应**：同一时刻 `bootstrap.ts` 正在给 `sign` 步骤加「重置本机密钥并重试」按钮（同类病：blocking/degraded 步骤失败后刷新治不好）。设备这一步可以照同一形态做 —— 错误屏加「重置设备标识并重试」（清 `GEO_IP_DEVICE_ID` + reload），但**更好的仍是 1（自动重试）**，因为设备 40605 发生在**运行期**而不只是启动期。
- **影响面**：**全体用户**；生产第 31 天开始所有会话撞 40605；dev 删 cookie 即复现。当前唯一自救是手工清 localStorage。

### P0-2 设备身份可被自报指纹冒充（可劫持他人 OAuth 登录结果）

- **是否确认**：**能复现**（`device_id == HMAC(fp)` 已实测 MATCH=true；其余为读码 + 现有 api-spec 佐证）
- **证据**：`fingerprint.middleware.ts:10-11`（指纹原样取请求头）· `device.repo.service.ts:41-43` + `crypto.service.ts:130-138`（HMAC 派生）· `device.controller.ts:52-89`（initial 匿名 + 铸签名 cookie）· `monitor/user/dto/user.dto.ts:21-26` + `monitor-user.api-spec.ts:189`（原始指纹随 monitor 列表出参）· `github.controller.ts:37,72-81,243-257`（SSE 频道键=deviceId，端点 JWT-free）· `sse.service.ts:44-66`（同键多订阅者共享 Subject）
- **复现步骤**：① 用带 `app:monitor:user:list` 的账号取某用户 `visitorId` → ② `POST /system/device/initial` 带请求头 `FINGERPRINT: <该指纹>` → 拿到该设备合法签名 cookie → ③ `GET /auth/oauth/github/sse/x`（带这枚 cookie）挂上 `oauth/github/device/<deviceId>` → ④ 对方完成 GitHub 登录 → 攻击者流收到 `{accessToken, sessionKey}`
- **修复方案**：
  1. **立刻止血**：monitor 的 `visitorId` 出参改为短哈希/设备名（不再回原始指纹）——需重导出 openapi；
  2. **正解**：SSE 频道键改成**一次性 ticket**（`POST /auth/oauth/start` 返回 ticket，`sse/:ticket` 60s 一次性消费），不再用持久 deviceId 当频道键；
  3. 纵深：`initial` 对「已存在的设备行」要求额外证明（携带既有 cookie / 同日 IP 段 / CAP），代价是「换浏览器首用」体验。
- **影响面**：**持有 monitor 读权限的账号**可对任意走 OAuth 登录的用户实施账号接管；若该权限被授予非 SRE 角色，等同 P0。另附带：可匿名覆盖任意设备的记录（§8.4-2）。

### P1-1 封禁/锁定可被绕过（换指纹 / 等 cron 删行）

- **是否确认**：**能推断**
- **证据**：`banned/locked` 只存 `sys_device` 行（`device.entity.ts:72-76`）· `initial` 的写集不含 banned/locked（`device.service.ts:94-122`）· cron 会删行（`user_device.shared.service.ts:134-156` + `task.service.ts:127`，每 30 分钟）· 指纹可任意改（`fingerprint.middleware.ts`）
- **复现步骤**：① 被封禁后 `POST /app/monitor/user/state {left:true}`（DeviceFree，把 active 置 false）→ ② `POST /system/device/initial`（active 回 true，监控行仍 left=true）→ ③ 等 ≤30 分钟 cron 删行 → ④ `initial` 得干净新行。或更简单：改 `FINGERPRINT` 请求头一个字符。
- **附带影响**：新行 `createdAt` 重置 ⇒ `getDeviceCreatedDays` 变小 ⇒ 设备年龄风控分被清零（风险模块 `risk/modules/device.service.ts:108` 在用）
- **修复方案**：把设备黑名单从行内布尔提升为**与行生命周期解耦**的存储（独立表按 `fingerprint` 或 `deviceId` 记，`initial` 时查黑名单拒绝/回填 banned）；或至少 cron 删除时跳过 `banned or locked` 的行。
- **影响面**：封禁从「安全控制」降级为「提示」。

### P1-2 封禁不吊销会话：refresh 与 WebSocket 不受影响

- **是否确认**：**能推断**
- **证据**：`refresh.controller.ts:28-34`（`JwtFree + DeviceFree`）· `refresh.shared.service.ts:352-354` 只校验「cookie deviceId == RT 行 deviceId」· `socket.middleware.ts:33-71`（只验 JWT 验签 + 会话键，**不读 sys_device**）· `socket.gateway.ts:111-116` 照常 join 房间
- **复现步骤**：ban 后 ① `POST /auth/refresh`（带 RT cookie）→ 仍返回新 AT；② 已建立的 WS 连接不断、仍收 `LOCK/FORCE_QUIT` 等事件（新连接也能建）。
- **修复方案**：ban/lock 时 ① `revokeRTForUserDevice`（已有方法）② 删 auth session key ③ socket 握手加一次设备状态检查（`AppTechCacheDeviceService` 已在 guards 里可注入）④ 用 socket adapter 主动断开该设备房间。
- **影响面**：被封设备的「后台在线 + 实时事件」能力保留；审计上会显示「封禁了但还在动」。

### P1-3 `/app/monitor/user/state` 可改写他人监控行（deviceId 被重指向 / userId 被清空）

- **是否确认**：**能推断**
- **证据**：`user.controller.ts:144-159`（`deviceId` 取自 cookie，`visitorId` 取自 **body**）· `monitor/user/user.service.ts:55-60`（`findOneAndUpdate({visitorId}, { deviceId, ...update })`）· `user.repo.service.ts:46-69`（upsert 整体赋值）
- **复现步骤**：任意登录态（甚至匿名，因为该端点 DeviceFree）`POST /app/monitor/user/state {"visitorId":"<别人的指纹>","left":true,"auth":false}` → 目标行 `device_id` 变成本机、`user_id` 被置 null、`left=true`。
- **修复方案**：行键只用服务端推导值（`deviceId`）或复合键 `(deviceId, visitorId)` 且**禁止改写 deviceId**；`auth:false` 的 userId 清零只在 `deviceId` 匹配时生效。这是 F-47 的同类残留（F-47 只修了 `userId` 的信任来源，没修 `deviceId` 的写入方向）。
- **影响面**：在线监控数据可被任意登录用户污染（在线状态、用户关联、设备归属）；`force-quit` 之后可能打错设备。

### P2-1 `initial` 每次把 IP/位置历史重置为单条

- **是否确认**：**能复现**（PG 实测 `array_length(ip_history,1)=1`，且 `location_history` 只有 1 条）
- **证据**：`device.service.ts:112-120`（`locationHistory: [单条]` / `ipHistory: [req.realIp]`）与 `device.guard.ts:87-101`（IP 变化时**追加**到 history，最多 5 条）互相打架：一次 `initial` 就把 guard 攒的 history 抹平。
- **修复方案**：upsert 分支保留既有 history（仅当为空时初始化）；或 `initial` 不写 history，统一交给 guard 维护。
- **影响面**：IP/位置历史实际只有 1 条（异地登录检测形同虚设，不过该功能当前**无消费方**，见 P3-6）；「设备最近 IP 变化轨迹」在管理端永远是空的。

### P2-2 指纹混入易变特征（`storage.usage`）⇒ 同一浏览器可能产生多条设备身份

- **是否确认**：**能推断**
- **证据**：`app-fingerprint.ts:33`（`usage:${Math.floor((est.usage||0)/1000000)}mb` 进了哈希）；`:148-149`（有缓存就不重算）· 存储清理/换 profile 后重算，usage 必然不同 ⇒ 新 `visitorId` ⇒ 新 deviceId ⇒ 新设备行；旧行成为孤儿（等 cron 清理）。
- **修复方案**：从指纹组件里去掉 `usage`（保留 quota 分级），或对 usage 分桶（如 100MB 粒度）。
- **影响面**：设备身份漂移（设备列表重复、审计断层、封禁目标漂移）；也是 §8.4 里「换指纹重置风控」的**误伤版**。

### P2-3 40605 语义过载，前端无法区分「需重建设备」与「设备被拒」

- **是否确认**：**能推断**
- **证据**：`device.guard.ts:51-54`（cookie 缺失/签名失败）、`:68-74`（行不存在）都抛同一个 `40605`；前端只有一个 `'device'` 分支（`response/interceptor.ts:101`）。
- **修复方案**：新增独立码（如 `40611 DEVICE_RESET_REQUIRED`）用于「cookie 缺失/过期/行不存在」，`40605` 只留「设备形态非法」；前端对 40611 做 `initial + 重放`（与 P0-1 修复合并做最省）。
- **影响面**：P0-1 的修复质量取决于这一条。

### P2-4 dev 下 `isPostman` 可一次性跳过设备/签名/CAP/风控/黑名单校验

- **是否确认**：**能推断**（`isPostmanRuntimeRequest = isDev && UA includes PostmanRuntime`，`user-agent.middleware.ts:70-72`）
- **证据**：`device.guard.ts:56-60`、`sign.guard.ts:84-86`、`cap.guard.ts:67-68`、`security.guard.ts:53-54`、`blacklist-path.middleware.ts:33-34`、两个拦截器（decrypt/encrypt）都读它。
- **修复方案**：无需改代码（注释已声明「dev 不得暴露公网」），但可以加一条**机械守卫**：`NODE_ENV=development` + 非 localhost 的 `HOST` 时启动 warn/fail（防止把 dev 镜像部署出去）。
- **影响面**：纯部署纪律，当前无门禁。

### P3（各 1 行）

- **P3-1 `=== null` 判空写错**：`crypto.service.ts:25,133` 与 `:58` 用 `=== null` 判 `configService.get(...)`，缺值时得到 `undefined` 不会命中 ⇒ 会抛 `TypeError [ERR_INVALID_ARG_TYPE]` 而不是自定义错误。当前被 `validation.ts:210-211` 的启动校验兜住，属健壮性问题。
- **P3-2 `lock.guard.ts:57` 的 `deviceId === null` 分支永不成立**（`getWalnutAdminCookie` 返回 `undefined`）⇒ 该防御性 early-return 是死代码。
- **P3-3 指纹落 localStorage 且进日志**：`app-fingerprint.ts:130` 用 `enhancedBase64LocalStorage`（仅混淆）+ `socket.gateway.ts:113` 打印 `fingerprint` ⇒ XSS / 日志读权即可拿到「准设备凭据」。
- **P3-4 stage 的 cookie 名没有 `__Secure-`/`__Host-` 前缀**（`const/app/cookie.ts:5-15` 的 else 分支返回裸名），与 dev/prod 不一致；子域 cookie tossing 面更大。
- **P3-5 测试标题过期**：`guard-matrix.api-spec.ts:607` 仍写「ban/unban 只写 SYS_DEVICE 缓存不落库」，而 P2-2 修复后已 DB+缓存双写。
- **P3-6 `SysDeviceSettingService` 命名误导**：它实际是**设备端点限流配置**（4 次 / 60 秒，`device.setting.service.ts:11-22`），不是「设备设置」。
- **P3-7 死代码**：`hasLocationJump` / `getIpLocationHistory` / `getCurrentLocation`（`device.shared.service.ts:44-109`）全仓**零消费方**（含 spec）。
- **P3-8 `device_name` 唯一约束 vs 只取指纹前 6 位**：`DESKTOP_<fp[:6]>`（`app-fingerprint.ts:141-143`）+ `uq_device_name`（`device.entity.ts:25-27`）；跨设备撞名概率约 1/1.6e7，可忽略，但配合 P2-2 的指纹漂移会累积孤儿行。

---
## 10. 已核对无误（避免下一轮重复报案 / 误报）

| 项 | 结论 | 证据 |
|---|---|---|
| 指纹头 → HMAC → 64 hex 的口径一致 | ✅ | `crypto.service.ts:130-138`、`format.pipe.ts:44`（`/^[0-9a-f]{64}$/i`）、PG 实测 device_id 长度 64 |
| cookie 属性齐全 | ✅ | `httpOnly` + `secure` + `signed` + `path=/` + `sameSite`，dev `__Host-`/prod `__Secure-`（`cookie.service.ts:12-60`、`const/app/cookie.ts:5-22`） |
| 缓存 miss 回源 DB 的 P2-2 修复**有效** | ✅ | `device.guard.ts:62-85`；`device.service.ts:209-227` 事务内写 DB + after-commit 双写缓存 |
| 跨设备 AT 重放被拦 | ✅ | 会话键 `(userId, deviceId, sid)`（`jwt-access.strategy.ts:41-56`）+ api-spec `guard-matrix.api-spec.ts:499` |
| 篡改 device cookie 被拦 | ✅ | `guard-matrix.api-spec.ts:594-603` |
| SSE 频道键已不用客户端指纹 | ✅（F-04 已修） | `github.controller.ts:72-81`（键 = `oauth/<p>/device/<deviceId>`）；`github.controller.spec.ts:106` 断言调用参数里不含客户端 fp |
| 40605/40606/40607 与前端 type + i18n key 三者对齐 | ✅ | `response/interceptor.ts:101-103`、`sys_locale.json` 里三个 key 都存在 |
| `initial` 不会清掉 banned/locked | ✅ | 写集 `device.service.ts:94-122` 不含这两列；`upsertByDeviceId` 只 `Object.assign` 写集（`device.basic.repository.ts:46-50`） |
| signout 不清 DEVICE_ID | ✅（正确） | `auth.controller.ts:61` 只清 `RT_JTI` |
| 正常关标签页不会被 cron 误删 | ✅ | 关闭前 beacon `left:true` → `updateState` 把 `active` 置 false（`user.service.ts:71`）⇒ 不在 `getAllActiveDevices()` 候选里 |
| `active` 不参与鉴权 | ✅（设计如此） | `device.guard.ts:79-85` 读入但不判定 §1 表 |

---

## 11. 需要 Lead 拍板

### 拍板-1 设备身份要不要改成「服务端签发、与指纹解耦」？

| 选项 | 内容 | 代价 |
|---|---|---|
| a) 维持现状 | 指纹 = 身份（`HMAC(fp)`），封禁只当降噪；把这条写进 ADR/AGENTS，禁止再当成安全控制 | 零代码；但要接受 P0-2 / P1-1 |
| **b) 服务端签发随机 deviceId（推荐）** | 首次 `initial` 由服务端生成随机 uuid 存 cookie（`sys_device.device_id` 语义从「指纹派生」改为「签发」），指纹降级为风控特征（仍可入库做「同指纹多设备」告警） | 中：DB 里既有 64-hex 行需兼容（可双读一版）；一次性解决 P1-1 的两条绕过 + P2-2 的漂移 |
| c) WebAuthn / 客户端证书 | 真·设备凭据 | 大：要动前端注册流程与全部登录链 |

**推荐 b**。理由：P0-2 与 P1-1 的根因是同一句「身份是客户端自报值的函数」，改存储口径即可一次性收口；本仓已有 cookie 签名、会话键 `(userId,deviceId,sid)` 的成熟机制，换成随机签发几乎不需要新机制。

### 拍板-2 P0-1（30 天过期死锁）修在哪一侧？

| 选项 | 内容 |
|---|---|
| **a) 前端自愈（推荐先做）** | 40605 → `initial()` → 重放一次原请求（学 40101 的写法）；去掉 localStorage 门闩 |
| b) 后端滑动续期 | guard/拦截器在 cookie 剩余 < 7 天时重签；cookie 永不过期 |
| c) 两者都做 | a 止血 + b 纵深 |

**推荐 a（本周）→ c（下批）**。理由：a 是纯前端、当天可验（删 cookie 复现）；b 需要碰 guard/响应层，收益是「再也不会因为 cookie 老化而重建设备」。

### 拍板-3 monitor 列表还能不能返回原始指纹？

| 选项 | 内容 |
|---|---|
| **a) 不再返回原始指纹（推荐）** | `visitorId` 出参改短哈希或直接给 `deviceName`；运维排障用 deviceName/deviceId 足够 |
| b) 保留，但把 monitor 权限收敛到 SRE 角色 | 依赖角色治理，且审计上仍会扩散 |
| c) 维持现状 | 零改动，P0-2 的前置条件保留 |

**推荐 a**。它同时是 P0-2 的「立刻止血」项，且只改一个 DTO 字段 + 重导出 openapi。

### 拍板-4 「封禁」的语义是「挡住 HTTP」还是「把人踢下线」？

| 选项 | 内容 |
|---|---|
| **a) 完整封禁（推荐）** | ban/lock 时 revoke 该设备 RT + 删会话键 + 断 WS + 停心跳（= P1-2 修复） |
| b) 只挡 HTTP | 现状；WS 与 refresh 保留（需要在管理端文案里说清「不是踢下线」） |

**推荐 a**。管理端的 `banDeviceAPI` 语义在 UI 上就是「封禁」，用户预期是断掉；且实现成本低（`revokeRTForUserDevice` 已有、socket adapter 有）。

### 拍板-5 `sys_device` 行是否还允许被 cron 删除？

| 选项 | 内容 |
|---|---|
| a) 保留删除（现状） | 清理脚本/爬虫留下的空行；但会造出 P0-1 的场景 B |
| **b) 改为标记 stale，不删行（推荐）** | `active=false` + `stale=true`，行与 cookie 生命周期解耦；存储增长需配一个 90 天清理任务 |
| c) 保留删除 + 前端自愈兜住 | 依赖拍板-2 落地 |

**推荐 b**：它同时消掉 P1-1 的第 2 条绕过（行不会被删 ⇒ banned 不会被抹掉）与场景 B 的死锁。

---

## 附录 A：可复跑命令

~~~powershell
# 1) 代码层 grep（只读）
git grep -n "WalnutAdminGuardDeviceFree()" -- apps/server            # 11 个跳过端点
git grep -n "DEVICE_ID" -- apps/server | Select-String "setResponseCookie|cookie("   # 唯一写 cookie 处

# 2) DB 形态（本机 PG，只读）
#   探针脚本放 %TEMP%，连 env-local/.env.development 的 DATABASE_PG_*：
#   select device_id, array_length(ip_history,1), banned, locked, active from sys_device;
#   → 实测 device_id 长度 64、ip_history 长度 1
#   select length(visitor_id), count(*) from app_monitor_user group by 1;  → 长度 32（原始指纹）

# 3) 证明 device_id == HMAC_SHA256(monitor.visitor_id, DEVICE_ID_ENCRYPTION_KEY)
#   node <temp>/dev_probe2.cjs   → 输出 MATCH = true（本轮已跑，见 §8.2）

# 4) 后端既有用例（覆盖 40605/40606/40607 主路径，需 PG+Redis）
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm vitest run --config ./apps/api/vitest.config.integration.ts guard-matrix device.api-spec"
~~~

## 附录 B：本轮未做（说明边界）

- **没有起服务跑端到端**：P0-2 的「铸 cookie → 订阅 SSE → 收 AT」链条由读码 + 数学验证 + 仓库既有 api-spec 拼成，未在真实双客户端环境复演；P0-1 的前端死锁同理（后端那一半有 api-spec 钉住）。若 Lead 需要 100% 复演，起一次 dev server + 两个浏览器 profile 即可（我可以再做一轮）。
- **没有动任何源码/配置**；临时脚本已从 `%TEMP%` 删除。