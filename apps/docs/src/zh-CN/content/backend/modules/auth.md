# 认证全链（auth 模块）

认证模块覆盖「从裸设备到可用会话」的整条链路：匿名设备登记、CAP 人机验证、RSA/AES 签名握手、
OPAQUE 口令登录、OTP 注册/登录、AT/RT 双令牌、登录后的轮换与登出，以及外部 OAuth。

本文写**当前实现**。全局守卫的职责与顺序见 [安全与 guard 链](./security.md)；
已知缺陷的登记与裁决见
`apps/server/apps/api/test/api/DESIGN-ISSUES.md`（下文以 `P?-?` 引用条目号）。

源码入口：`apps/server/apps/api/src/modules/auth/`。接口矩阵的原始测绘在
`apps/server/apps/api/test/api/ENDPOINTS.md` §2。

## 1. 模块职责总览

`AuthModule`（`auth.module.ts`）本身只挂 `/auth/permissions`、`/auth/signout`、`/auth/keys`
三个 controller 方法，其余端点由子模块各自声明：

| 子模块 | 目录 | 职责 |
|---|---|---|
| jwt | `modules/auth/modules/jwt/` | AT 的 passport-jwt 策略与 `JwtAccessGuard`；`validate` 补查登录会话键（P0-4） |
| refresh | `modules/auth/modules/refresh/` | RT 行存储、`JwtRefreshGuard`、轮换（revoke-and-insert）、过期清理任务 |
| session | `modules/auth/modules/session/` | Redis 中的登录会话（sessionKey 哈希）与 API 签名子密钥派生 |
| signout | `modules/auth/modules/signout/` | 四类登出触发：主动退出、踢其他设备、管理员踢人、安全策略全撤 |
| opaque/core | `modules/auth/modules/opaque/core/` | OPAQUE 协议服务端：登录 start/finish、注册、改密；口令永不落库为明文 |
| opaque/user | `modules/auth/modules/opaque/user/` | 用户自助端点：`login/start|finish`、`client-error`、`register/*`、`change-password/*` |
| opaque/admin | `modules/auth/modules/opaque/admin/` | 管理员改密/清密（按 `sys_user.id` 定位） |
| otp | `modules/auth/modules/otp/` | 邮箱/短信验证码：发送、校验、自动注册、一次性换发令牌 |
| mfa | `modules/auth/modules/mfa/` | `auth/mfa/status|verify`：设备级 MFA 可信状态与 RT 轮换 |
| google | `modules/auth/modules/google/` | Google FedCM id_token 校验（本地 JWKS）与登录 |
| oauth/gitee · github | `modules/auth/modules/oauth/` | 授权码跳转、回调、SSE 投递令牌 |
| cookie | `modules/auth/modules/cookie/` | `RT_JTI` 签名 cookie 的写入/清除 |
| shared | `modules/auth/modules/shared/` | `generateAuthTokens`：会话 + AT + RT + 设备绑定的一次性装配 |

## 2. 未登录链

未登录链的顺序是**设备登记 → CAP → 签名握手 → 登录**。每一步只依赖前一步落下的
cookie / 缓存，后一步缺前置一律受控失败，不会「自动补做前一步」。

### 2.1 前置：设备登记

`POST /system/device/initial`（系统模块，不属于 auth，但整条链的起点）：

- 守卫：Sign / JWT / CAP / Device 全 Free（风险守卫仍运行），另挂 Throttle（默认 4 次 / 60 秒）。
- `device_id = hash(X-Fingerprint, crypto.deviceIdKey)`（`SysDeviceRepositoryService.getDeviceIdByFingerprint`），
  即设备主键由客户端自报的指纹派生。按 `device_id` 查到即整体覆盖、否则插入；`device_name`
  有唯一约束（冲突受控 40000，P3-2）。
- 写库前调 `SharedIpService.getLocationInfoFromFreeAPI` 取地理位置（外网 API；本地 IP 直接回 `LOCAL`）。
- 事务提交后回填 `SYS_DEVICE:<deviceId>` 缓存；响应 `{ deviceId, locationInfo }`，并下发签名
  `DEVICE_ID` cookie。后续所有受保护端点都靠这枚 cookie 定位设备。

### 2.2 CAP：PoW 挑战与兑换

| 步骤 | 端点 | 形态 |
|---|---|---|
| 挑战 | `POST /security/cap/challenge` | `@FreeResponse`，body 直接是 cap.js 的 `{ challenge: { c, s, d }, token, expires }` |
| 兑换 | `POST /security/cap/redeem` | `@FreeResponse`，body `{ token, solutions }`，返回 `{ success, token?, expires? }` |

- 两个端点都挂 SignFree / CapFree / JwtFree / DeviceFree / LockFree，并共用
  `SecurityCapSettingService` 的动态限流（默认 4 次 / 60 秒）。
- 挑战参数来自 `APP:SETTING` 的 `app.global.capjs.config`；缺省
  `{ count: 10, size: 16, difficulty: 4, ttl: 3600000, throttleLimit: 4, throttleTtl: 60 }`。
- `redeem` 成功时 `SecurityCapService.redeem` 用配置里的 `ttl`（毫秒）设置
  `CAPJS_TOKEN` cookie（`maxAge = ttl * 1000`），body 同时回 `success: true`。
- cap.js 的 token 是**一次性**的：服务端 `validateToken` 成功即从 store 删除。客户端重复兑换
  会得到 `success: false`，而不是统一响应壳里的业务码。

CAP 的**强制时点**不在这里，而在全局 `cap.guard`：风险守卫给出评估结果后，请求必须带
可校验的 `CAPJS_TOKEN`，否则 40116（要求交互）或 40117（要求刷新），详见
[安全与 guard 链](./security.md) 的 CAP 一节。

### 2.3 签名握手：RSA 信封 + AES 会话密钥

| 步骤 | 端点 | 关键行为 |
|---|---|---|
| 第一步 | `POST /security/sign/initial` | body `{ rsaPubKey, force? }`；把**客户端** RSA 公钥按设备缓存（`SECURITY:RSA:PUB_KEY:<deviceId>`）。缓存已存在且 `force !== true` 时原样返回缓存值，否则覆盖 |
| 第二步 | `POST /security/sign/aes-key` | 生成/复用设备级 AES 密钥（`SECURITY:SIGN:AES_KEY:<deviceId>`，TTL = AT 有效期），响应里的 `aesKey` 经 `@EncryptResponse` 用第一步登记的客户端公钥加密；同时返回 `hkdfInfo`（默认 `walnut-admin-api-sign-v1`，取自 `app.crypto.hkdfInfo`） |

- 两个端点 SignFree / CapFree / JwtFree / DeviceFree / LockFree / IpFree，但**仍读 `DEVICE_ID`
  cookie** 取设备键；没有设备 cookie 时缓存键退化成 `undefined`，不是受控失败（实践上必须先做
  设备登记）。
- 第二步的加密信封是「一次性 AES-256-GCM 密钥（32B）+ IV（12B）+ tag（16B）拼成 60B blob，
  RSA-OAEP-SHA256 加密该 blob」，与 `GET /auth/keys`、`GET /shared/ali/sts` 的响应加密同格式。
- 第二步之前没有第一步登记的公钥时，`SecuritySignService.getAesKey` 的读缓存会抛受控异常；
  已持有 AES 密钥、但缓存过期后继续签名的请求在 sign guard 里得到 **40113**（签名过期语义），
  其余签名问题一律 **40112**。
- `GET /security/rsa/public-key` 返回**服务端**当前 RSA 公钥（`app_key` 表 `RSA_PAIR` 的
  version 最大 ACTIVE 行），与「登记客户端公钥」是两件事。

握手完成后客户端持有：设备 `deviceId`（cookie 值）、明文 AES 密钥、`hkdfInfo`。此后每个
请求按 [安全与 guard 链](./security.md) 的签名原文规则现算 HMAC。

### 2.4 OPAQUE 登录

端点与守卫：

| 端点 | 守卫 | 说明 |
|---|---|---|
| `POST /auth/opaque/user/login/start` | JwtFree + Functional(`app.auth.opaque.authEnable`) + 签名（单因子） | body `{ userName, start }`，返回 base64 的 `loginResponse` |
| `POST /auth/opaque/user/login/finish` | JwtFree + Functional + `AuthOpaqueUserGuard`（passport-local，字段 `userName` / `finish`） | 返回 `{ accessToken, sessionKey }` 并下发 `RT_JTI` cookie |
| `POST /auth/opaque/user/login/client-error` | JwtFree + 签名 | body `{ userName, clientError }`；无论哪种 `clientError` 都落一条失败 `log_auth` 并抛 **40103** |

`login/start`（`AuthOpaqueCoreService.startLogin`）：

1. 按 `userName` 查 `sys_user`；再查 `user_identity(type='password', purpose='login')` 的
   registration record。任一缺失 → **40103**（不区分「用户不存在」与「未设置口令」）。
2. `opaque.server.startLogin` 生成 `loginResponse` 与 `serverLoginState`；后者写入
   `AUTH:OPAQUE_STATE:<userName>:<deviceId>:SERVER_STATE`，TTL **30 秒**。
3. 失败统一 40103，并在 controller 里补记失败登录日志。

`login/finish`（strategy → `AuthOpaqueUserService.validateOpaqueUser` → controller）：

1. strategy 从 cookie 取 `deviceId`，读回 30 秒窗口内的 `serverLoginState`；缺失/过期 → 40103。
2. `opaque.server.finishLogin` 校验客户端 finish 并派生 `sessionKey`；失败 → 40103。
   `finally` 里删除 server state（无论成败，状态不可复用）。
3. `sessionKey` 暂存 `AUTH:OPAQUE_STATE:<userName>:<deviceId>:SESSION_KEY`（TTL 30 秒），
   由 `AuthOpaqueCoreService.finishLogin` 取出后交给 `AuthSharedService.generateAuthTokens`。
4. `generateAuthTokens`（同一 PostgreSQL 事务）：
   - `AuthSessionService.createAuthSession(userId, deviceId, sessionKey)`：生成 32 hex 的
     `sessionId`，把 `SHA-256(sessionKey)` 写入 `AUTH:SESSIONS:<userId>:<deviceId>:<sessionId>`
     （TTL = RT 有效期），**明文 sessionKey 只在此刻返回一次**；
   - 签发 AT（payload 带 `sid = sessionId`）；
   - `generateRefreshToken`：同 `(userId, deviceId)` 已有未撤销 RT 行 → **40109 Duplicate Auth**；
     否则复用最近一行的 jti（`revoked=false` 复签）或插入新 jti 行；
   - `bindDeviceForUser` 写入 `sys_user_device`；
   - 返回 `{ accessToken, refreshTokenJti, authSessionKey }`。
5. controller 用 `refreshTokenJti` 写 `RT_JTI` 签名 cookie，响应体回
   `{ accessToken, sessionKey }`（`sessionKey` 为 base64）。客户端必须自行保存 `sessionKey`：
   登录后的双因子签名靠它派生，服务端不存明文。

### 2.5 OTP 注册 / 登录链

OTP 既是登录通道，也是**新用户注册的唯一 HTTP 通道**（OPAQUE register 不是，
见 §6 的 P1-14）。

| 端点 | 守卫 | 请求 |
|---|---|---|
| `POST /auth/otp/send` | JwtFree + 签名 + Functional(`authEnable`) + `OtpSendFunctionalGuard`（`sendEnable`）+ 动态限流 | `{ type: 'email' 或 'sms', identifier }` |
| `POST /auth/otp/verify` | JwtFree + 签名 + `OtpFunctionalGuard`（`authEnable`）+ `OtpGuard` + AuthLog | `{ type, identifier, verifyCode }` |

规则：

- 两个端点挂类级 `@WalnutAdminGuardJwtFree()`，签名仍生效（未登录态按单因子验）。
  类级 `OtpFunctionalGuard` 对两者都生效（读 `app.auth.email` / `app.auth.phone` 的
  `authEnable`）；`send` 另加 `OtpSendFunctionalGuard`（同组的 `sendEnable`）。
  配置缺失时 `functional.guard` 的「缓存无此键」分支放行，显式 `sendEnable/authEnable != 1`
  时才 **50301 EndPointUnavailable**。
- 发送：`OtpSharedService.sendVerifyCode` 生成 `verifyFigure` 位数字码，邮件/短信走 Bull 队列
  （不阻塞响应），码写缓存 TTL = `verifyTtl`。
  - 匿名发送写 `AUTH:VERIFY_CODE:visitor:<identifier>`；
  - 已登录的 `system/user/identity/.../send-code` 走带 `userId` 的写法，键为
    `AUTH:VERIFY_CODE:<userId>:<identifier>`。
- 校验（`OtpStrategy.validate`）：`email` 比对缓存码；`sms` 固定走阿里云
  `checkSmsVerifyCode`（发送侧由队列处理器把 Aliyun BizId 写入
  `AUTH:VERIFY_CODE:aliyun:bizId:visitor:<identifier>`）。错码 → 40000
  `business.auth.verifyCodeError`；`type` 非法 → 40000 `business.auth.invalidOtpType`。
- 通过后 `OtpService.validateIdentity` 自管 PG 事务：
  - `user_identity` 已有该标识 → 取对应用户的 AT payload；
  - 无标识且 `newUserSignup` 开启 → 自动建用户 + 建 `user_identity`，发欢迎消息；
    关闭 → **40108 Signup Banned**。
- 回到 controller 的 `authWithOtp`：`generateAuthTokens`（sessionKey 缺省随机 32 字节，
  因为 OTP 没有 OPAQUE 的共享密钥）、把 identity 标记 `verified`、下发 `RT_JTI`，
  最后删除验证码缓存。

## 3. 登录后链

### 3.1 AT / RT 双令牌模型

| 令牌 | 载体 | 服务端状态 | 关键约束 |
|---|---|---|---|
| AT | `Authorization: Bearer <jwt>` | 无行存储；`validate` 时查会话键 | 含 `sid`；过期由 JWT 自身；每请求查 `AUTH:SESSIONS:<userId>:<deviceId>:<sid>`，查无 → 40101 |
| RT | `RT_JTI` 签名 cookie 只存 **jti** | `auth_refresh_token` 行（加密后的 RT JWT + 过期时间 + 撤销位） | cookie 与设备绑定；RT JWT 只含 `{ jti, sid }`，`ignoreExpiration: true` 由行过期时间兜底 |

- AT payload（`AppTokenService.getJwtAccessTokenPayload`）：`userId`、`userName`、
  `roleIds`、`roleNames`、`currentRole`、`currentRoleName`、`roleMode`、`mfaSetup`、
  `mfaVerified`（= 设备 `trusted`）、`sid`。
- 会话记录只存 `SHA-256(sessionKey)`；`sessionKey` 用于双因子签名派生（HKDF），
  客户端丢失后只能重新登录。
- 服务端不存 AT 黑名单：AT 的失效靠「会话键被删（signout/踢人/改密）→ JWT 层 40101」
  与「会话键在但撤销事件未覆盖时 sign guard 40112」两道闸。

### 3.2 refresh 轮换：revoke-and-insert

这是本模块最核心的流程（P0-1 终态，2026-10-27 起）：

1. 客户端 `POST /auth/refresh`，只带 `RT_JTI` cookie。该端点 Lock / Sign / MFA / JWT / Device
   全 Free，另挂 `@WalnutTx()` 与 `JwtRefreshGuard`。
2. **第一道闸**：`JwtRefreshGuard.canActivate` 用 cookie 的 jti 调
   `AuthRefreshSharedService.getTokenByJti`（非事务、不锁）：查无行或 `revoked=true`
   → **40102**。轮换过的旧 jti 在此就死，不进入事务。
3. 解出该行的 `encrypted_token`（AES-GCM，key 为 `crypto.rtKey`），交给 passport-jwt 验签
   （`jwt.refresh.secret`，`ignoreExpiration: true`，过期由行时间判）。payload 归入
   `req.RT = { sid, jti }`。
4. controller 在 `@WalnutTx()` 事务里调
   `getNewAccessToken(jti, deviceId, req.RT.sid, ctx.em)`：
   - **第二道闸**：`findByJti(jti, em, { lock: true })` 在事务内加 `pessimistic_write` 行锁
     （锁只在活跃事务里生效）。读不到 / 已撤销 / `deviceId` 不匹配 → **40102**；
   - 行已过期：按 `(userId, deviceId)` 全量撤销后仍抛 **40102**；
   - 查用户与角色、`checkUserAndRoleStatus`（禁用/角色停用 → 40104 族）、
     取设备 `trusted` 作为新 AT 的 `mfaVerified`；
   - **轮换**（`updateRefreshToken`）：旧行置 `revoked=true, revoke_reason='rotate'`，
     生成新 jti（nanoid 24）、新 RT JWT（同 `sid`）、新密文、新过期时间，**INSERT 新行**
     （同 user / device）；不原地复用旧行；
   - `touchAuthSessionTTL`（会话键续到 RT 有效期）与 `touchVerifiedCache`（MFA 设备缓存续期）；
   - 用同一 `sid` 签发新 AT，返回 `{ accessToken, jti: newJti }`。
5. controller 用**新 jti** 重种 `RT_JTI` cookie（`maxAge` = RT 有效期），响应体只回
   `{ accessToken }`。

为什么这样能防重放：旧 jti 的行在轮换事务提交后永久 `revoked`。并发或错峰到达的重放请求，
要么在 guard 的第一道闸读到撤销行，要么在轮换锁内读到撤销行，两者都映射 **40102**。
锁的作用只是把「读校验 + 撤销 + 插入」串行化，保证同维度不会出现两条未撤销行；
**恰 1 路成功由行级撤销保证，不依赖请求同时到达的时序假设**。

同一套轮换有四个 HTTP 入口，都必须回种新 jti cookie：

- `POST /auth/refresh`
- `POST /auth/mfa/verify`
- `POST /system/user/mfa/totp/verify`
- `POST /system/user/mfa/webauthn/authenticate/verify`

### 3.3 signout：三清

`POST /auth/signout`（SignFree + DeviceFree；JWT、MFA、Lock 仍生效）：

1. **撤 RT**：`AuthRefreshSharedService.revokeRTForUserDevice` 按 `(userId, deviceId)`
   一次撤掉该维度全部行（`updateRevokedAndReason`，不传 reason 时保留各行原 reason）。
2. **清 cookie**：`AppTechCookieService.clearCookie` 把 `RT_JTI` 置为过期。
3. **事务提交后清缓存**（`AuthSignoutService.clearDeviceCache`）：
   - `AUTH:PERMISSIONS:<userId>:<deviceId>`
   - `AUTH:SESSIONS:<userId>:<deviceId>:<sid>`
   - `AUTH:MFA:VERIFIED:<userId>:<deviceId>`
   - 认证后的风险结果（`risk:user`、`risk:user_device` 与 challenge 标记）

清除完成后再发请求：JWT 层查不到会话键 → **40101**（P0-4 修复后的口径；修复前由 MFA
guard 的 40115 首拦）。

### 3.4 MFA verify 双通道

| 端点 | 守卫 | 行为 |
|---|---|---|
| `GET /auth/mfa/status` | MFAFree + LockFree | 返回 `[{ enabled, type }]`：当前用户/设备可用的 MFA 方法状态 |
| `POST /auth/mfa/verify` | MFAFree + LockFree + `@WalnutTx()` | body `{ trusted }`；校验 `sys_user_mfa` 已绑定，未绑定 → 40000 `business.auth.mfa.verifyFail`；随后把 `sys_user.mfa_setup` 置 true、把 `sys_user_device.trusted` 写成客户端传入值、事务后写 `AUTH:MFA:VERIFIED`，并轮换 RT（新 jti cookie） |

真正的第二因子校验发生在系统模块的两个通道，它们同样挂 MFAFree + LockFree，并在成功后
调用同一轮换：

- TOTP：`POST /system/user/mfa/totp/verify`
- WebAuthn：`POST /system/user/mfa/webauthn/authenticate/verify`

全局 `mfa.guard` 的判定顺序是：未登录放行 → visitor 角色放行 → `mfaSetup=false` 拒
**40114** → AT 的 `mfaVerified=true` 放行 → 设备级 `AUTH:MFA:VERIFIED` 缓存命中放行 →
否则 **40115**。因此 `POST /auth/mfa/verify` 是「登录后的设备可信声明」，不是「输入验证码」
的端点。

### 3.5 踢下线与 force-quit

`AuthSignoutService.doSignout` 有四种触发：

| trigger | 调用方 | 撤销范围 | 在线设备 |
|---|---|---|---|
| `user-logout` | `POST /auth/signout` | 本 `(user, device)` 全部 RT + 三类缓存 | 无 |
| `user-kick-other` | `DELETE /system/user/device/force-quit/:deviceId` 等自助踢人 | 目标 `(user, device)` 全部 RT（reason=`userKickOther`） | socket 通知 |
| `admin-kick` | 管理端 `force-quit` | 同上，reason 由调用方给 | socket 通知 |
| `security-policy` | 改密/清密、密码重置链 | 该用户**所有设备**的 RT（`revokeRTForUser`）+ 全设备清 `AUTH:SESSIONS` / `AUTH:PERMISSIONS:<user>:*` / `AUTH:MFA:VERIFIED:<user>:*`（P2-32） | 事务提交后批量 socket 通知 |

P2-12 修复后（2026-10-28）：`user-kick-other` / `admin-kick` 在撤 RT + socket 通知之外，
事务提交后按设备清 `AUTH:SESSIONS` / `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED` 三键。
配合 JWT validate 的会话键校验，被踢设备的旧 AT 立即 40101（不再有「AT 到期前仍可用」的
窗口）。

P2-32 修复后（2026-10-29）：`security-policy`（改密/敏感操作）在 after-commit 同样清三键，
但作用域是**该用户全部设备**（`revokeSession(userId)` 不带 deviceId + 两个 `<user>:*`
前缀清）。双设备用例实测：改密后两台设备的旧 AT 均立即 40101，三键逐个核对已清。

## 4. 外部 OAuth

### 4.1 functional 开关

三个 provider 的开关都读 `APP:SETTING` 的 `app.auth.{google,gitee,github}.authEnable`，
经 `@WalnutAdminDecoratorFunctionalGuard` 在业务前拦截：

- 缓存里没有该键 → 放行（零配置可用的既有语义）；**Google 例外（P1-17）**：控制器用
  `{ defaultClosed: true }` 显式要求 `authEnable === 1`，settings 缺失即 **50301**；
- 值不为 `1` → **50301 EndPointUnavailable**，且发生在 passport guard 之前。

### 4.2 Google（FedCM）

- `POST /auth/google`，body `{ credential }`（Google id_token）。
- `AuthGoogleStrategy.verify`：从 id_token 头部取 `kid`，在**本地 JWKS 快照**
  `apps/api/src/public/json/google-jwk.json` 里取公钥，`jose.jwtVerify` 校验
  `issuer`（`https://accounts.google.com` / `accounts.google.com`）与 `audience`
  （`auth.google.clientId`）；失败一律 **40107 OAuth Failed**，不发外网请求。
- **P1-17（已修复，2026-10-28，端点暂时关闭）**：`AuthGoogleService.validateGoogle` 的
  「按邮箱查既有用户」分支仍被注释，每次有效登录会新建用户且不写 `user_identity` /
  `user_oauth`。处置 = **端点暂时关闭**（functional `defaultClosed`，settings 缺失即
  50301）；补全（email 复用 + identity/oauth 绑定）作为后续功能开发，恢复前不要改成
  缺省放行。
- 本地 JWKS 是静态快照：Google 轮换签名密钥后需要更新该文件，否则新 kid 的 id_token 全 40107。

### 4.3 gitee / github（授权码 + SSE）

| 端点 | 守卫 | 行为 |
|---|---|---|
| `GET /auth/oauth/{gitee,github}/url` | JwtFree + Functional；签名生效 | 返回 IdP 授权 URL：`state = base64url(JSON{fp,lang,nonce}) + "." + HMAC-SHA256`（P2-13，签名密钥复用 `app.session.secret`；nonce + 发起 deviceId 落 Redis `AUTH:OAUTH_STATE:<nonce>`，10 分钟 TTL） |
| `GET /auth/oauth/{gitee,github}/callback` | JwtFree + SignFree + Functional + `OAuth{Gitee,GitHub}Guard` + `@WalnutTx()` + AuthLog + `@Render('template/oauth/done')` | guard 在换 code 前验 state：缺 `code` / 验签失败 / 重放 / 跨设备 → **40000**（受控壳，不进入外部 token 交换）；成功则签发令牌并把 `accessToken/sessionKey` 投递到 SSE |
| `GET /auth/oauth/{gitee,github}/sse/:fp` | JwtFree + SignFree；Device 等其余全局守卫仍生效 | `@Sse` + `@Res()` 直写流，不属于统一响应壳（P3-8 豁免） |

- 回调成功后先 `generateAuthTokens`（同 §2.4 的装配，事务内），再把回调用户（gitee/github
  绑定或自动注册，见 `OAuthGiteeService.validateIdentity` / `OAuthGitHubService.validateIdentity`）
  的 `emailAddress` 身份标记 `verified`，最后通过 `AppTechSseService.sendToClient` 向
  `oauth/{provider}/{fp}` 频道发 `{ success, message, data }`：`event` 为 `token:gitee`
  或 `token:github`，`data` 携带 `accessToken` 与 `sessionKey`。
- 失败同样走 SSE：`{ success: false, message: <i18n 文案>, data: {} }`，并异步记失败登录风险。
- P2-13 修复后（2026-10-28）：`state` 由服务端签发（HMAC 签名 + 一次性 nonce + deviceId
  绑定），callback guard 先验签再换 code；SSE 频道按 `fp` 订阅的客户端侧信任边界不变
  （`fp` 只从已验签的 state 取得），但跨设备/重放/篡改的登录 CSRF 形态全部被拒。
- 外部边界：真实 IdP 的 `code` 交换与回调需要外部网络与有效应用配置，API 回归覆盖
  「functional 关闭 50301 / 缺 code 40000 / state 篡改·重放·跨设备 40000 / `/url` 拼装形态 /
  本地校验失败」这些纯本地路径。

## 5. 接口表

响应形态统一为 HTTP 200 + `body.code`（成功 20000）；标 `FreeResponse` 的两处例外见 §2.2。
「守卫链」列只写与默认全链不同的 Free/附加 guard；未列出的全局守卫照常执行。

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/auth/permissions` | 全链 | 无 | — → `AuthCorePermissionsDTO`（菜单树/路由树/权限串/keepAlive/indexMenuName/affixedTabs/internalIframeList；顶层是首个根节点的 children，P3-4） |
| POST `/auth/signout` | SignFree + DeviceFree | 无 | — → `true`（清 RT 行 + `RT_JTI` cookie） |
| GET `/auth/keys` | 全链 | 无 | — → `{ B: <EncryptResponse 信封> }`（vendor.baidu） |
| POST `/auth/opaque/user/login/start` | JwtFree + Functional(`authEnable`) | 无 | `{ userName, start }` → base64 `loginResponse` |
| POST `/auth/opaque/user/login/finish` | JwtFree + Functional + `AuthOpaqueUserGuard` | 无 | `{ userName, finish }` → `{ accessToken, sessionKey }` + RT cookie |
| POST `/auth/opaque/user/login/client-error` | JwtFree | 无 | `{ userName, clientError }` → 恒 40103 |
| POST `/auth/opaque/user/register/start` | JWT 生效（无 Free） | 无 | `{ start }` → string；已登录补挂口令（P1-14：不再按 userName 查重） |
| POST `/auth/opaque/user/register/finish` | JWT 生效 + `@WalnutTx()` | 无 | `{ finish }` → boolean；按 `userId` upsert password identity（存在替换 / 不存在建） |
| POST `/auth/opaque/user/change-password/start` | Functional(`change`) | `me:auth:opaque:changePassword` | `{ start }` → string |
| POST `/auth/opaque/user/change-password/finish` | Functional(`change`) + `@WalnutTx()` + 操作日志 | `me:auth:opaque:changePassword` | `{ finish }` → boolean；全设备撤 RT（reason=`updatePass`） |
| POST `/auth/opaque/admin/password/update/start` | 全链 | `system:user:pass:update` | `{ id, start }` → string |
| POST `/auth/opaque/admin/password/update/finish` | `@WalnutTx()` + 操作日志 | `system:user:pass:update` | `{ id, finish }` → boolean；目标用户全设备撤 RT |
| POST `/auth/opaque/admin/password/clear` | `@WalnutTx()` + 操作日志 | `system:user:pass:clear` | `{ id }` → boolean（幂等；删 password identity） |
| POST `/auth/otp/send` | JwtFree + Sign + Functional(`authEnable`) + Functional(`sendEnable`) + OTP 限流（P1-16 起动态 `sendLimit`/`sendTtl` 生效且同步 blockDuration） | 无 | `{ type, identifier }` → boolean；关闭 50301 |
| POST `/auth/otp/verify` | JwtFree + Sign + Functional(`authEnable`) + `OtpGuard` + AuthLog + `@WalnutTx()` | 无 | `{ type, identifier, verifyCode }` → `{ accessToken, sessionKey }` + RT cookie |
| POST `/auth/refresh` | Lock/Sign/MFA/JWT/Device 全 Free + `JwtRefreshGuard` + `@WalnutTx()` | 无 | RT cookie → `{ accessToken }` + 新 RT cookie |
| GET `/auth/mfa/status` | MFAFree + LockFree + `@WalnutTx()` | 无 | — → `[{ enabled, type }]` |
| POST `/auth/mfa/verify` | MFAFree + LockFree + `@WalnutTx()` | 无 | `{ trusted }` → `{ accessToken }` + 新 RT cookie |
| POST `/auth/google` | JwtFree + SignFree + Functional + `AuthGoogleGuard` + `@WalnutTx()` | 无 | `{ credential }` → `{ accessToken, sessionKey }` + RT cookie |
| GET `/auth/oauth/gitee/url` | JwtFree + Functional | 无 | — → 授权 URL 字符串 |
| GET `/auth/oauth/gitee/callback` | JwtFree + SignFree + Functional + `OAuthGiteeGuard` + `@WalnutTx()` | 无 | `?code&state` → `@Render` 页面 + SSE 投递 |
| GET `/auth/oauth/gitee/sse/:fp` | JwtFree + SignFree + Functional；Device 等其余全局守卫生效 | 无 | — → text/event-stream |
| GET `/auth/oauth/github/url` | 同 gitee（`/auth/oauth/github/*`） | 无 | 同 gitee |
| GET `/auth/oauth/github/callback` | 同 gitee | 无 | 同 gitee（`event: 'token:github'`） |
| GET `/auth/oauth/github/sse/:fp` | 同 gitee | 无 | 同 gitee |

登录成功后所有端点返回的 AT 都带 `sid`；AT 与 RT 的有效期来自 `jwt.access.expire` /
`jwt.refresh.expire`（秒）。

## 6. 已知行为注记

以下均已在 `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 登记，这里只写现状与指向：

- **P0-1（已修复）**：RT 轮换为 revoke-and-insert；旧 jti 行级一次性，重放确定性 40102。
  同维度多行是常态（历轮 `rotate` 撤销行 + 恰一行现役行），判「已登录」必须筛
  `revoked=false`（`findActiveByDeviceIdAndUserId`）。
- **P0-2 / P0-4（已修复）**：双因子派生失败不再降级单因子（40112）；JWT `validate` 每请求
  查 `AUTH:SESSIONS`，查无 40101。会话吊销的拦截层级因此是「JWT 先于 sign」。
- **P0-3（已修复）**：CAP 校验缓存键掺 token 指纹，TTL 按毫秒转秒。
- **P1-1 / P1-9（已修复）**：key rotate 读腿加锁；RT 撤销按 `(userId, deviceId)` 全量。
- **P1-3 / P1-14（已修复，2026-10-28）**：opaque register 端点摘掉 JwtFree（匿名 40101）；
  服务层改为按 `req.user.userId` **upsert** password identity（存在即替换 value/valueHash，
  不存在则建），不再按 userName 查重抛 40001、不建用户 —— 语义明确为「已登录用户补挂
  口令」；新用户注册走 OTP 链。
- **P2-1（设计立场）**：所有已登录非 visitor 用户强制 `mfaSetup=true`，无灰度开关；
  settings 的 `app.auth.mfa` 不控制该 guard。
- **P2-9（已修复）**：`app.functional.role` 缺省为 GLOBAL/combinable，零配置下 COMBINE
  用户的全部角色参与权限合并；权限串由 `GET /auth/permissions` 写入，permission.guard 只读缓存。
- **P3-4（裁决接受）**：`/auth/permissions` 的 `permissionMenuTree` 顶层是「首个根节点的
  children」，单根无子级时为空数组；前端菜单装配按此形状消费。
- **P3-5（已修复）**：webauthn verify 的 simplewebauthn 异常已包装为受控 40000。
- **P1-15（已修复，2026-10-28）**：`AUTH:PERMISSIONS` 缓存 TTL 与 AT 有效期同秒数
  （修复前写成 `AT 秒数 * 1000`，30 分钟 AT 实际驻留 ~20.8 天）；permission-chain spec
  断言缓存 TTL 落在 AT 秒数量级。
- **P1-17（已修复，2026-10-28）**：Google 端点以 functional `defaultClosed` 暂时关闭
  （零配置 → 50301）；「同邮箱复用 + user_identity/user_oauth 绑定」补全作为后续功能开发。
- **P2-12（已修复，2026-10-28）**：`user-kick-other` / `admin-kick` 撤 RT 之外，事务提交后
  按设备清会话/权限/MFA verified 三键；配合 P0-4 的 JWT 会话校验，旧 AT 立即 40101。
- **P2-13（已修复，2026-10-28）**：OAuth `state` 改为签名 + 一次性 nonce + deviceId 绑定，
  callback guard 在换 code 前校验；篡改 / 重放 / 跨设备一律受控 40000。
- **P2-14（新登记）**：并发 `login/finish` 的 Duplicate Auth 判据是「读后写」，无锁/无唯一
  索引兜底；两个并发登录都可能返回成功，RT 行被后写者覆盖，仅一个会话实际存活。
- **P2-32（已修复，2026-10-29）**：`security-policy`（改密/清密）在 all-device 撤 RT 之外，
  after-commit 清全设备会话/权限/MFA verified 三键；双设备用例断言旧 AT 均立即 40101。
