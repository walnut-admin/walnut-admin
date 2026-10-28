# 安全与 guard 链

后端的准入控制由一组**全局 Nest Guard** 和若干**方法级 Guard** 组成。全局 Guard 在
`apps/server/apps/api/src/app/app.module.ts` 的 `APP_GUARD` 里按顺序装配，方法级 Guard
（权限、角色、敏感操作、functional、throttle）经装饰器挂在具体的 controller/handler 上，
在全局链之后执行。

本文写**当前实现**与部署前提。认证流程本身的端点与令牌语义见 [认证全链](./auth.md)；
守卫链在 `apps/server/AGENTS.md` 里有简表，本文是展开版。

## 1. 全局 guard 链全景

### 1.1 顺序与职责

```
IP -> Security -> Device -> Risk(前) -> CAP(前) -> JWT -> Risk(后) -> CAP(后) -> MFA -> Sign -> Lock
```

| # | Guard | 职责 | 主要失败码 | 跳过装饰器 |
|---|---|---|---|---|
| 1 | `WalnutAdminGuardIP` | 查 `realIp` 是否在永久（`APP:SETTING` 的 `app.global.ipBlackList`）或临时（Redis）黑名单 | 40603 | `@WalnutAdminGuardIpFree()` |
| 2 | `WalnutAdminGuardSecurity` | UA 存在性、恶意路径、bot、可疑请求、OS/浏览器白名单 | 40604 / 40610 / 40608 / 40609 / 40601 / 40602 | 无（仅 dev 的 `isPostman` 旁路） |
| 3 | `WalnutAdminGuardDevice` | 校验签名 `DEVICE_ID` cookie；缓存/DB 查设备行；封禁与锁定判定；IP 漂移时更新设备 IP | 40605 / 40606 / 40607 | `@WalnutAdminGuardDeviceFree()` |
| 4 | `WalnutAdminGuardRisk`（前） | 采集 pre-auth 频率，评估 IP/设备/失败登录/位置/频率，写 `request.risk` | 40666（当前不可达，见 P1-13） | 无 |
| 5 | `WalnutAdminGuardCap`（前） | 读 `request.risk.comprehensive.recommendation`；强制 `CAPJS_TOKEN` cookie 与缓存校验 | 40116 / 40117 | `@WalnutAdminGuardCapFree()` |
| 6 | `JwtAccessGuard` | `Authorization: Bearer <AT>`；`validate` 查 `AUTH:SESSIONS` | 40101 | `@WalnutAdminGuardJwtFree()`；另有 `@WalnutAdminGuardJwtOptional()` |
| 7 | `WalnutAdminGuardRisk`（后） | 合并 post-auth 的 user/userDevice 评估，重写 `request.risk` | 40666（同前） | 无 |
| 8 | `WalnutAdminGuardCap`（后） | 与 #5 同一实现；已有 userId 时把 critical factor 标记为用户-设备维度 | 40116 / 40117 | `@WalnutAdminGuardCapFree()` |
| 9 | `WalnutAdminGuardMFA` | 已登录用户的 `mfaSetup` 强制与设备级 MFA 可信缓存 | 40114 / 40115 | `@WalnutAdminGuardMFAFree()` |
| 10 | `WalnutAdminGuardSign` | HMAC 签名验签（未登录单因子 / 已登录双因子） | 40112 / 40113 | `@WalnutAdminGuardSignFree()` |
| 11 | `WalnutAdminGuardLock` | 用户-设备锁定状态（缓存缺失回源 DB） | 40118 | `@WalnutAdminGuardLockFree()` |

顺序的隐含约束（改装配顺序前必须逐条核对）：

- **CAP 依赖 Risk**：CAP 只在 `request.risk` 已被前置 Risk 写入时工作；Risk 未运行或评估
  异常时 CAP 直接放行。因此把 CAP 提到 Risk 前面等于关掉 CAP。
- **Sign 依赖 JWT**：已登录请求的双因子密钥需要 `req.user.userId/sid`；Sign 必须在 JWT 之后。
- **MFA 依赖 JWT**：`mfaSetup/mfaVerified` 来自 AT payload，JWT 之后才有 `req.user`。
- **Lock 依赖 JWT**：锁定判定按 `userId + deviceId`。
- **Risk 跑两次、CAP 跑两次**是为了「登录前按设备/IP 判、登录后叠加用户维度」；
  `app.module.ts` 里 Risk/CAP 各注册了两个 `APP_GUARD` provider（同一个类、两个实例），
  两轮共享 `request.risk`。
- **方法级 Guard 在全局链之后**：`@HasPermission` / `@HasRole` / `@RequireSensitive` /
  functional / throttle 都晚于 Sign 与 Lock。

Free 装饰器的实现都是 `SetMetadata(Symbol(...), true)`，Guard 用
`reflector.getAllAndOverride([handler, class])` 读取，**handler 优先于 controller 类**。
一个端点可以同时挂多个 Free（如 `security/sign/*` 五连 Free），但每个 Guard 只认自己的键。

`req.isPostman` 是开发态旁路：`UserAgentMiddleware` 只在 `isDev` 且 UA 含 `PostmanRuntime`
时置 true；Security / Device / CAP / Sign 四家会跳过。IP / Risk / MFA / Lock 不跳过。

### 1.2 权限与角色（方法级）

**权限守卫** `WalnutAdminGuardPermission`，经 `@WalnutAdminDecoratorHasPermission(permission,
mode = 'and')` 挂载：

1. 没有权限元数据：告警并放行（装饰器使用错误）。
2. 没有 `req.user`：40105。
3. **root 短路**：`roleMode === 'combinable' && roleNames[0] === 'root'`，或
   `roleMode === 'switchable' && currentRoleName === 'root'`，直接放行。
4. **visitor 特例**：`switchable + visitor` 时只允许 `app:shared:ali:sts` 与所有以
   `:list` / `:read` 结尾的权限串；数组按 `every` 判定。
5. 其余用户读缓存 `AUTH:PERMISSIONS:<userId>:<deviceId>`：
   - 键缺失 → **40105（无懒重建）**；
   - 单串：`includes`；
   - 数组：默认 `and`（`every`）或显式 `or`（`some`）。
6. 缓存的**唯一写入口**是 `GET /auth/permissions`（`SysMenuSharedService.getPermissions`）；
   signout 删除该键。缓存 TTL 现状见 P1-15。

**角色守卫** `WalnutAdminGuardRole`（`@WalnutAdminDecoratorHasRole`）只读 AT payload 的
`roleNames` / `currentRoleName`，不走缓存；root 短路与 visitor 拒绝同上。数组 `and` 模式仅在
COMBINE 下真正判定，`switchable + and` 的组合在代码里是「不应出现」分支。

**敏感操作守卫** `WalnutAdminGuardSensitive`（`@WalnutAdminGuardRequireSensitive({ level,
type })`）：要求已登录；Redis 键 `sensitive_op:<userId>:<deviceId>:<level>` 存在即放行
（TTL 15 分钟），否则 40119 并在 `meta` 里带 `checkVerificationStatus` 的结果
（是否需要验证、剩余秒数、可用方式、首选方式）。敏感级别的验证方式策略在
`sensitive.config.ts` 的 `SECURITY_LEVEL_STRATEGIES`；`POST /security/sensitive/verify`
成功后才写授权键。

**functional 守卫**（`WalnutAdminGuardFunctional`，经
`@WalnutAdminDecoratorFunctionalGuard(KEY, detailKey?, options?)`）：读 `APP:SETTING`，
键缺失或 detail 缺失时**放行**，值 `!= 1` 时 50301。这是「零配置默认开启、显式关闭才拦」
的语义。P1-17 起支持 `{ defaultClosed: true }`：键/detail 缺失即 50301（Google 登录
暂时关闭用的就是这条 opt-in 语义）。

**throttle** 不是全局 Guard，只在挂了 `@WalnutAdminDecoratorThrottle(...)` 的端点生效
（CAP challenge/redeem、`system/device/initial`、OTP send）。tracker 默认取 `realIp`；
OTP 的 tracker 是 `identifier:ip`。动态覆盖只改该端点的 limit/ttl，P1-10 起同步覆盖
`blockDuration`；P1-16（2026-10-28）修正了 OTP 的元数据键（装饰器 Symbol ↔ 守卫字符串
错位），`OtpSettingService.sendLimit/sendTtl` 自此真实生效，且动态 ttl 同步进
`blockDuration`。超限响应是 **HTTP 200 + `body.code = 42900`**（P3-1 裁决），`Retry-After`
头给出剩余秒数。

## 2. 签名体系

### 2.1 签名原文

`sign.guard.ts` 的 `buildSignRaw` 按固定顺序拼接：

```
METHOD|PATH(去 /{prefix}/v{version})|扁平静态body排序串|timestamp=<ms>|nonce=<32hex>|ua=<User-Agent>
```

- `METHOD` 大写。
- 路径取 `req.url`（**含 query 串**），只去掉 `/{prefix}/v{version}` 前缀；去掉后为空串时用 `/`。
- body 用 `objectToPaths` 扁平化，键排序后拼 `k=v&k=v`；空 body 为空串。
- `timestamp` 是毫秒；`ua` 是原始 `User-Agent` 头，不做归一化。

### 2.2 单因子 / 双因子

| 场景 | 密钥 | 公式 |
|---|---|---|
| 未登录（`req.user` 为空） | 设备握手得到的 `aesKey`（base64url 字符串的 UTF-8 字节） | `HMAC-SHA256(raw, aesKey)` |
| 已登录 | `HKDF-SHA256(ikm = SHA256(sessionKey), salt = aesKey, info = hkdfInfo, len = 32)` | `HMAC-SHA256(raw, derivedKey)` |

- `hkdfInfo` 来自 `APP:SETTING` 的 `app.crypto.hkdfInfo`，缺省 `walnut-admin-api-sign-v1`；
  握手第二步的响应会把它一起返回，客户端据此派生。
- 服务端只存 `SHA256(sessionKey)`（`AUTH:SESSIONS` 的 `authSessionKeyHash`），HKDF 直接以
  该 hash 作为 ikm（等价于 `SHA256(sessionKey)` 再派生）；客户端持有原始 sessionKey。
- 已登录请求的双因子派生失败**不再降级单因子**（P0-2 修复）：直接 40112。未登录请求仍走
  单因子，登录/握手端点因此可用。

### 2.3 nonce、时间窗与 Sign Ticket

- `X-Timestamp` 与服务端时间差超过 **5 分钟**（300000 ms）→ 40112。
- `X-Nonce` 必须是 **32 位十六进制**，否则 40112（格式校验先于签名比对）。
- nonce 记 `SECURITY:SIGN:NONCE:<nonce>`，TTL 300 秒；重复 → 40112。
  现状是「先 GET 再 SET」，不是 `SET NX`（P2-11 已登记），并发同 nonce 存在窄窗口。
- nonce 在签名比对**之前**写入：签名错误的请求也会消耗自己的 nonce。
- `SIGN_TICKET`：
  - 缓存 `SECURITY:SIGN:TICKET:<deviceId>` 存在且 cookie 存在但不相等 → 40112；
  - 缓存存在、cookie 缺失 → 接受并重发同一 ticket（自动补 cookie）；
  - 缓存缺失 → 用分布式锁（`APP:MURLOCK:SIGN:<deviceId>`）生成 16 字节 base64url 新票，
    写缓存与 cookie；因此**首次请求不需要预置 ticket**。
  - 缓存与 cookie 的有效期都是 AT 有效期；每次校验成功都会重写缓存并重发 cookie。
- 设备 AES 密钥缺失（缓存过期/未握手）→ **40113**；其余签名类失败统一 **40112**。
  签名比对用 `timingSafeEqual`，长度不等直接 false。

## 3. CAP

- 挑战参数来自 `app.global.capjs.config`，缺省
  `{ count: 10, size: 16, difficulty: 4, ttl: 3600000, throttleLimit: 4, throttleTtl: 60 }`。
- `POST /security/cap/challenge` 创建挑战；`POST /security/cap/redeem` 校验 PoW 解，
  成功时写签名 `CAPJS_TOKEN` cookie（`maxAge = ttl * 1000`，即默认 1 小时）。
  两者都是 `@WalnutAdminDecoratorFreeResponse()`：body 直接是 cap.js 协议形态，无 `{code,data}` 壳。
- cap.js token **一次性**：服务端 `validateToken` 成功即删除；客户端再次兑换得到
  `success: false`，必须重新 challenge。
- 全局 CAP Guard 的触发条件：`request.risk.comprehensive.recommendation` **存在**。
  - 不存在（Risk 未运行/无 deviceId/评估异常）→ 放行；
  - 存在但 cookie 缺失或校验失败：`shouldChallenge` 为 true → **40116**，否则 → **40117**。
- 校验缓存键是 `SECURITY:CAP_TOKEN:<deviceId>:<sha256(token) 前 16 hex>`，TTL 为
  `ceil(config.ttl / 1000)` 秒（P0-3 修复后：与设备 + token 双重绑定，毫秒转秒）。
  缓存未命中时在 `APP:MURLOCK:CAP:<deviceId>` 锁内调 `AppCapJS.validateToken` 真验。
- 真验失败时 `performCapVerification` 内部抛 40111 但被自身 catch 吞掉，最终返回 false，
  客户端看到的是 40116/40117，而不是 40111。
- 校验通过后 `SecurityRiskChallengeStateService.markChallengeHandled` 把本次
  `criticalFactors` 标记为已处理：键形如
  `risk:challenge:<scope>:<值...>:<factor>`（scope 由 factor 前缀决定：device / user-device /
  user / ip / location），TTL 24 小时。未处理的 critical factor 会让下一轮风险评估继续
  要求挑战。

## 4. Device / Risk / IP

### 4.1 设备注册与指纹

- 注册端点 `POST /system/device/initial`（系统模块）：Sign/JWT/CAP/Device Free，
  Throttle 4 次 / 60 秒，Risk 仍运行。
- `device_id = hash(X-Fingerprint, crypto.deviceIdKey)`；指纹是**客户端自报**的请求头，
  设备身份因此是「自证 + 服务端加盐哈希」，不是硬件证明。
- 同 `device_id` 再注册是整体覆盖（设备名、屏幕、硬件信息、IP/位置历史等），
  `device_name` 唯一冲突 → 40000（P3-2）。
- 注册时调外网 IP 地理 API（本地 IP 回 `LOCAL`）；响应 `{ deviceId, locationInfo }`，
  并下发签名 `DEVICE_ID` cookie；事务提交后写 `SYS_DEVICE:<deviceId>` 缓存。

### 4.2 Device Guard

1. 取签名 `DEVICE_ID` cookie；缺失 → 40605。
2. `SYS_DEVICE` 缓存未命中时回源 `sys_device`（P2-2：DB 是 `locked/banned` 真源），
   查无 → 40605；命中则回填缓存。
3. 设备当前 IP 与 `realIp` 不同：在 `APP:MURLOCK:DEVICE:IP_CHANGE:<deviceId>` 锁内
   double-check 后调 `updateIpAndLocation`（写 IP/位置历史，最多 5 条；提交后回填缓存）。
   该更新会调外网地理 API，IP 频繁变化时有外部依赖成本。
4. `banned` → **40607**；`locked` → **40606**（先判 banned）。
5. 设备锁定/封禁的写入口是 `PATCH /system/device/:id/{lock,unlock,ban,unban}`，
   DB 事务 + after-commit 缓存双写。

### 4.3 Risk

前置（pre-auth）与后置（post-auth）分别计算加权分，综合分是两者的 **50/50** 平均；
等级阈值 `CRITICAL >= 0.8`、`HIGH >= 0.6`、`MEDIUM >= 0.3`，其余 LOW。

| 阶段 | 因子（括号为权重） |
|---|---|
| pre-auth | IP 永久/临时黑名单（1.0 / 0.8）、`DEVICE_NEW`（0.3，critical）、`DEVICE_RECENT`（0.15，critical）、设备当前/历史 IP 黑名单（0.3 / 0.2）、`DEVICE_BANNED`（1.0）、`DEVICE_LOCKED`（0.5）、`DEVICE_PRIVATE`（1.0，critical）、`LOCATION_HIGH_RISK_COUNTRY` / `LOCATION_VPN_OR_PROXY` / `LOCATION_JUMP`（0.6 / 0.4 / 0.3，均 critical）、`FAILED_LOGINS`（0.5）、`RATE_LIMIT_EXCEEDED`（0.3） |
| post-auth | `USER_DISABLED` / `USER_NO_PASSWORD` / `USER_NO_MFA`（0.5 / 0.1 / 0.1）、`USER_DEVICE_UNTRUSTED` / `TRUST_EXPIRED` / `LOCKED`（0.6 / 0.4 / 0.4，均 critical）、`USER_DEVICE_INACTIVE`（0.2） |

模块权重：IP 0.25、Device 0.25、FailedLogin 0.2、Location 0.15、Rate 0.15；post-auth 为
User 0.2、UserDevice 0.3。

- critical factor 未处理时，推荐直接是 `shouldChallenge: true`；然后 HIGH/CRITICAL → 挑战，
  MEDIUM → 只记录，LOW → 无动作。
- **口径（P1-13，已修复，2026-10-28）：风险只触发 CAP 升级，不做阻塞**。
  `recommendation` 不再含 `shouldBlock`（旧实现恒 false 的幻觉字段已从类型与消费点摘除），
  risk.guard 只写 `request.risk` 供 CAP guard 消费；其 catch 只吞未知异常，受控
  `HttpException`（如 40666 RiskTooHigh）原样放行到全局异常过滤器。
- 失败登录计数：键 `risk:failed_login:<identifier>:<deviceId>`（Redis Hash，TTL 15 分钟），
  计数达到 **5** 次即调 `SharedIpService.addToTemporaryBlacklist`，临时封 IP 30 分钟。
- 频率阈值（每分钟）：IP 120、设备 120、用户 120；另有一条 IP 5 分钟 400。超出按对数曲线
  计分；采集是 fire-and-forget，不阻塞请求。

### 4.4 IP 与部署前提

- `realIp` 由 `IpMiddleware` 用 `@supercharge/request-ip` 从请求取（首 header 优先），
  同时写 `X-IP` 头与 `req.realIp`。所有 IP 维度风控（黑名单、throttle tracker）都信任它。
- **部署强约束（P0-5）**：生产 nginx 必须**覆盖**而非追加转发头：

  ```nginx
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Real-IP $remote_addr;
  ```

  **不得使用 `$proxy_add_x_forwarded_for`**（它会把客户端伪造值留在首位）。直连暴露时
  客户端可任意伪造 `realIp`，黑名单与限流都可被绕过或嫁祸。
- 永久黑名单存在 `APP:SETTING` 的 `app.global.ipBlackList`（JSON 数组），写入走 setting
  repo 并触发配置缓存刷新；临时黑名单是 Redis `risk:ip_blacklist:<normalizedIp>`，
  TTL 1800 秒，IPv6 的冒号会替换为下划线，本地 IP 统一 `127.0.0.1`。
- 黑名单路径：`WALNUT_ADMIN_PERMANENT_BLACKLIST_PATHS`（`/admin`、`/wp-admin`、`/.env` 等）。
  `security.guard` 只覆盖已路由请求；未命中路由的扫描路径由 `BlacklistPathMiddleware`
  （`forRoutes('*')`，用 `originalUrl`）兜底：命中即把 `realIp` 写入永久黑名单并回 **40610**
  （P1-11 修复）。guard 内部匹配前按 API 前缀 strip，常量本身是裸路径。

## 5. 接口表（security 模块）

统一响应壳 HTTP 200 + `body.code`；CAP 两个端点例外（`FreeResponse`，见 §3）。
「守卫链」只列与默认全链不同的部分。

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/security/sign/initial` | Sign/CAP/JWT/Lock/Device/IP 全 Free（Risk 仍跑） | 无 | `{ rsaPubKey, force? }` → 已缓存的公钥或 `true` |
| POST `/security/sign/aes-key` | 同上 | 无 | — → `{ aesKey: <EncryptResponse 信封>, hkdfInfo }` |
| GET `/security/rsa/public-key` | Sign/JWT/CAP Free | 无 | — → 服务端 RSA 公钥 PEM 字符串 |
| POST `/security/cap/challenge` | CAP/JWT/Device/Lock Free + SignFree + Throttle | 无 | — → `{ challenge, token, expires }`（无壳） |
| POST `/security/cap/redeem` | 同上 | 无 | `{ token, solutions }` → `{ success, token?, expires? }`（无壳），成功下发 `CAPJS_TOKEN` |
| GET `/security/sensitive/check` | 全链（JWT 生效） | 无 | query `level`（枚举）、`type`（可选枚举） → `{ needsVerification, remainingSeconds?, availableMethods?, preferredMethod? }` |
| POST `/security/sensitive/verify` | 全链 + `@WalnutTx()` | 无 | `{ level, operationType?, method, credential }` → `true`；成功后写 15 分钟授权键 |

补充（不属于 security controller，但同属安全面）：设备注册
`POST /system/device/initial`（Device/Sign/JWT/CAP Free + Throttle）与设备锁定/封禁
`PATCH /system/device/:id/{lock,unlock,ban,unban}`（全链 + `system:device:*`）。

## 6. 已知行为注记

- **P0-5（部署强约束）**：`realIp` 恒信任 `X-Forwarded-For`；生产 nginx 必须覆盖转发头，
  代码不做跳数校验（裁决见 DESIGN-ISSUES）。
- **P1-10（已修复）**：动态 throttle 的 `blockDuration` 与 ttl 同步覆盖；超限仍是
  HTTP 200 + body.code 42900、`Retry-After` 秒数。
- **P1-11（已修复）**：黑名单路径判定拆到中间件，未命中路由的扫描路径也能 40610 并自动拉黑。
- **P2-1（设计立场）**：`mfa.guard` 强制已登录非 visitor 用户 `mfaSetup=true`，无开关；
  `app.auth.mfa` 只影响敏感操作的方式数，不影响该 guard。
- **P3-1（裁决接受）**：429 语义只存在于 body.code，不放行原生 HTTP 429。
- **P3-8（豁免）**：CAP challenge/redeem 与 OAuth SSE 不走统一响应壳，属于协议/传输语义。
- **P1-13（已修复，2026-10-28）**：风险层口径定为「只触发 CAP 升级、不做阻塞」——
  `shouldBlock` 字段摘除；risk.guard 不再自行拒绝请求，受控异常不再被自身 catch 吞掉
  （40666 若未来由受控路径抛出可直达全局过滤器）。
- **P1-15（新登记）**：`AUTH:PERMISSIONS` 缓存 TTL 被写成 `AT 秒数 * 1000`，权限撤销/角色
  调整在缓存层面可驻留约 1000 倍 AT 时长；permission.guard 只读该缓存。
- **P1-16（新登记）**：OTP 发送端点的动态限流不生效 —— 装饰器写元数据的键是 Symbol，
  `OtpThrottleGuard` 用字符串 `'OTP_THROTTLE_SERVICE'` 读取，永远取不到 provider，
  实际退回全局 throttle 配置。
- **P2-11（新登记）**：nonce 去重是「先查后写」，非 `SET NX`；并发同 nonce 存在重放窗口。
- **P2-15（新登记）**：永久 IP 黑名单的写腿依赖 `app.global.ipBlackList` setting 行已存在；
  零配置部署下 `updateAppSettingByKey` 对缺失键静默不写，自动拉黑不会真正积累。
- **P2-12（新登记）**：踢下线类操作只撤 RT，不清 `AUTH:SESSIONS` / `AUTH:PERMISSIONS` /
  `AUTH:MFA:VERIFIED`；AT 到期前仍可通过 JWT 层。
- **P3-17（新登记）**：`ENDPOINTS.md` 把 `security/sensitive/verify` 的请求登记为
  `{basic,action,type,code}`，与 DTO 实际字段 `{level,operationType,method,credential}` 不符。
