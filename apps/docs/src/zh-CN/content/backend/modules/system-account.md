# 系统账户外围域（device / user_device / identity / lock / mfa / preference）

系统账户外围域覆盖「设备、身份、锁屏、第二因子、界面偏好」五件事，落地为六个模块：
`system/device`、`system/user_device`、`system/user_identity`、`system/user_lock`、
`system/user_mfa`、`system/user_preference`。它们都在 [系统核心域](./system-core.md) 的
user 主行之外，通过 `user_id` / `device_id` 挂接；权限链路本身不读这些表，但登录准入、
MFA 守卫、Lock 守卫、敏感操作校验都直接依赖它们。

本文写**当前实现**（PostgreSQL 迁移后）。认证与令牌的整体链路见 [认证全链](./auth.md)，
全局守卫的职责与顺序见 [安全与 guard 链](./security.md)；已知缺陷的登记与裁决见
`apps/server/apps/api/test/api/DESIGN-ISSUES.md`（下文以 `P?-?` 引用）。
表设计依据 `docs/plans/postgres-migration-phase2.md` §4.8 ~ §4.14。

源码入口：`apps/server/apps/api/src/modules/system/`。接口矩阵的原始测绘在
`apps/server/apps/api/test/api/ENDPOINTS.md` §5；实测锚点在 `apps/server/apps/api/test/api/`
下的 `device` / `user-device` / `user-identity` / `user-lock` / `user-mfa` / `user-preference`
五份 api-spec（`user-mfa` 一份覆盖 totp 与 webauthn）。

## 1. 域总览

### 1.1 六个模块的职责

| 模块 | 源码目录 | 职责 | 主表 |
|---|---|---|---|
| device | `modules/system/device/` | 匿名设备登记、设备档案、设备级 lock/ban、按设备反查当前/历史用户 | `sys_device` |
| user_device | `modules/system/user_device/` | 用户与设备的绑定行、显示名、踢下线、锁屏入口（用户-设备维度） | `sys_user_device` |
| user_identity | `modules/system/user_identity/` | 登录/安全身份（手机号、邮箱、口令、证件）的绑定、验证、启停 | `sys_user_identity` |
| user_lock | `modules/system/user_lock/` | 锁屏偏好（方式、空闲秒数、跨设备）与 user_device.locked 的读写 | `sys_user_lock` |
| user_mfa | `modules/system/user_mfa/` | TOTP / WebAuthn 凭据、备用码、MFA 状态与验证后的 RT 轮换 | `sys_user_mfa` |
| user_preference | `modules/system/user_preference/` | 语言、可访问性、主题、布局四段界面偏好 | `sys_user_preference` |

所有表都带 `id`（uuid）/ `created_at` / `updated_at`（`sys_log_*` 与 `sys_deleted` 例外，
见 [数据域](./system-data.md)）。软删统一走「写 `sys_deleted` 快照 + 硬删原行」，
实现见 `apps/server/apps/api/src/common/repository/pg-base.repository.ts` 的
`deleteSoftById`。六个模块的表**没有软删 HTTP 通道**；回收站的恢复注册表仍统一注册了
它们（含无软删路径的表），兜住任何来源的历史快照。

### 1.2 表关系

```text
sys_user 1 ── N sys_user_identity        (FK user_id CASCADE; UNIQUE user_id+type+purpose)
sys_user 1 ── N sys_user_device          (FK user_id CASCADE; UNIQUE user_id+device_id)
sys_user 1 ── 1 sys_user_lock            (FK user_id CASCADE; UNIQUE user_id)
sys_user 1 ── N sys_user_mfa             (FK user_id CASCADE)
sys_user 1 ── 1 sys_user_preference      (FK user_id CASCADE; UNIQUE user_id)

sys_device 1 ── N sys_user_device        (FK device_id → sys_device.device_id CASCADE)
sys_device 1 ── N sys_user_mfa           (device_id 松引用，不建 FK)

sys_user_device 1 ── 1 当前用户的锁屏状态  (locked 列；与 sys_device.locked 无关)
```

关键点：

- `sys_device.device_id` 是客户端指纹的**服务端加盐哈希**，也是被引用的**业务键**
  （phase2 Q5）。`sys_user_device` / `auth_refresh_token` 按它建 FK，因此该列 UNIQUE。
- `sys_user_mfa.device_id` 刻意**不建 FK**：MFA 凭据不应随设备行删除而级联消失。
- `sys_user_device.locked` 是**用户-设备的锁屏状态**；`sys_device.locked` 是**设备级管理锁**，
  两者由不同守卫判定（Device guard 40606 / Lock guard 40118），互不联动。
- 用户删除时上述五张 `user_id` 子表（以及本文未展开的 `sys_user_oauth`）由 FK CASCADE
  清空且不进 `sys_deleted` 快照；设备删除时 `sys_user_device` 同理。恢复只插回主行，
  关联数据不回来（P2-18、P2-22）。

## 2. 设备体系

### 2.1 initial 注册：指纹派生业务键

`POST /system/device/initial`（`device.controller.ts`）：

- 守卫：Sign / JWT / CAP / Device 全 Free，Risk 仍运行；另挂 `@WalnutAdminDecoratorThrottle`
  （`SysDeviceSettingService` 硬编码 4 次 / 60 秒，tracker 为 `realIp`）。
- `device_id = hash(X-Fingerprint, crypto.deviceIdKey)`，由
  `SysDeviceRepositoryService.getDeviceIdByFingerprint` → `AppTechCryptoService.hashDeviceFingerprint`
  计算（HMAC 形态的带盐哈希）。指纹是客户端自报的请求头，设备身份是「自证 + 服务端加盐」，
  不是硬件证明。
- 写库前调 `SharedIpService.getLocationInfoFromFreeAPI` 取地理位置（外网 API；本地 IP 回 `LOCAL`）。
- 落库语义是**按业务键 upsert**：`findOne({ deviceId })` 命中即把整组字段覆盖（`Object.assign`
  + `save`），未命中则插入。覆盖集包含 `deviceName` / `deviceInfo`（与 `req.os` / `req.browser`
  合并、UA 推导 `deviceType`）/ `hardwareInfo` / `sr` / `vp` / `geo*` / `locationInfo` /
  `locationHistory`（重置为单条）/ `ipHistory`（重置为单条）/ `ip` / `active=true`。
- 并发同指纹由 `uq_device_id` 决出唯一胜者，败者受控 40605（G3 实测）。
- `device_name` 有 UNIQUE `uq_device_name`；重名撞 23505 在 catch-all 之前单列，收敛为受控
  40000（P3-2 已修），其余异常仍 40605。
- 事务提交后经 `registerAfterCommitHook` 回填 `SYS_DEVICE:<deviceId>` 缓存；响应
  `{ deviceId, ...location, latitude, longitude, countryCode }`，并下发签名 `DEVICE_ID`
  cookie（`maxAge` 30 天）。后续所有受保护端点都靠这枚 cookie 定位设备。

### 2.2 Device guard：缓存读序与 P2-2 修复后的回源

`apps/server/apps/api/src/guard/device.guard.ts` 的判定顺序：

1. `@WalnutAdminGuardDeviceFree()` → 放行；开发态 `req.isPostman` → 放行。
2. 取签名 `DEVICE_ID` cookie；缺失 → **40605**。
3. 读 `SYS_DEVICE:<deviceId>` 缓存（经 `AppTechCacheDeviceService`，实际 Redis 键带
   `WALNUT_CACHE_` 前缀，无 TTL）。**缓存 miss 时回源 `sys_device`**（P2-2 修复，2026-10-28）：
   查无 → 40605；命中 → 先回填缓存，再走同一判定链。DB 是 `locked` / `banned` 的真源，
   清空 Redis 不再等价于放行。
4. 设备当前 IP 与 `req.realIp` 不同 → 在 `APP:MURLOCK:DEVICE:IP_CHANGE:<deviceId>` 锁内
   double-check 后调 `updateIpAndLocation`（写 IP/位置历史，最多 5 条；提交后回填缓存）。
   该更新会调外网地理 API，IP 频繁变化时有外部依赖成本。
5. 先判 `banned` → **40607**，再判 `locked` → **40606**。

缓存回填与双写的一致性边界见 §8 的 P2-21：guard 用「读库时的整行快照」回填缓存，
与管理端 lock/ban 的 after-commit 双写存在覆盖竞态。

### 2.3 lock / ban 状态机

`sys_device.locked` 与 `sys_device.banned` 是两个独立布尔列，**没有状态迁移图**，只有四个
幂等 setter：

| 端点 | 列 | 权限点 | 说明 |
|---|---|---|---|
| `PATCH /system/device/:id/lock` | `locked=true` | `[system:device:read, system:device:lock]` AND | 设备锁 |
| `PATCH /system/device/:id/unlock` | `locked=false` | `[read, system:device:unlock]` AND | 解设备锁 |
| `PATCH /system/device/:id/ban` | `banned=true` | `[read, system:device:ban]` AND | 封禁 |
| `PATCH /system/device/:id/unban` | `banned=false` | `[read, system:device:unban]` AND | 解封 |

- 四个端点都挂 `@WalnutTx()`，事务内 `findDeviceByDeviceIdAndUpdate` 更新 DB 行；
  事务提交后 `runAfterCommit` 写 `SYS_DEVICE` 缓存（P2-2 修复后的落库双写）。
- 同一设备同时 locked + banned 时 guard 先报 40607；封禁期间连 unlock 端点也会被
  Device guard 拦在路由之前（guard 全局先于方法级），只能由另一台设备/管理端操作。
- `:id` 是 `sys_device` 的行 uuid，**不是** `device_id` 业务键（路由参数走
  `WalnutAdminDecoratorParamUuid`）。`read` / `list` 同样按行 id。
- 注意 `findDeviceByDeviceIdAndUpdate` 是「findOne → Object.assign → save」的读改写，
  并发两把状态位会丢更新（P2-21）。

### 2.4 user_device 绑定

- 绑定发生在登录装配链：`AuthSharedService.generateAuthTokens` →
  `SysUserDeviceSharedService.bindDeviceForUser`，`ON CONFLICT (user_id, device_id) DO UPDATE`
  的幂等 upsert，附带 `device_name`（取 `sys_device.device_name`）。
- 全仓**没有 unbind/delete 通道**；`sys_user_device` 现存行即该设备的全部绑定历史
  （P2-3 修复后 `history-users` 直接返回这些行，按 `lastActiveAt` 降序）。
- `GET /system/user/device/list` 返回当前用户全部绑定行，逐行装回设备类型与位置，
  `current` 按业务 `deviceId` 与请求 cookie 比对，按 `lastActiveAt` 降序。
- `PUT /system/user/device/update-name/:deviceId` 只改 `sys_user_device.device_name`，
  不影响 `sys_device.device_name`（后者的 UNIQUE 约束不参与）。

### 2.5 force-quit / lock / unlock 与 RT 撤销

| 端点 | 前置 | 行为 | 是否撤 RT |
|---|---|---|---|
| `DELETE /system/user/device/force-quit/:deviceId` | 目标必须存在 `app_monitor_user` 行，否则 40401 | `AuthSignoutService.doSignout(trigger='user-kick-other', deviceId)`：按 `(userId, deviceId)` 撤销全部 RT 行 + socket 通知在线设备 | **是** |
| `PUT /system/user/device/lock/:deviceId` | 同上 40401 | 走 `SysUserLockSharedService.lockUserDevice`：写锁屏偏好 + `sys_user_device.locked` + socket `LOCK` | 否 |
| `PUT /system/user/device/unlock/:deviceId` | 同上 40401；偏好行缺失 40401 | 校验可选 `lockPwdHash` 后同上置 `locked=false` + socket `UNLOCK` | 否 |

- lock 端点的 body 只有 `lockRoute`（可空），**不接受** `lockMode` / `lockPwdHash` /
  `lockCrossDevice`；因此 user_device 的 lock 与 me 的 lock 走同一条共享服务，语义一致。
- force-quit 的 `user-kick-other` **只撤 RT 并通知在线设备**，不清 `AUTH:SESSIONS` /
  `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED`（P2-12）：AT 到期前仍可通过 JWT 层，
  离线设备依赖下次打开页面时前端主动 signout。
- 锁屏不撤 RT：锁屏是「会话仍有效、界面被遮」的语义，由 Lock guard 在 API 层拦 40118，
  解锁后用同一 AT 继续。

## 3. 身份与敏感操作

### 3.1 四 type × 两 purpose 矩阵

`sys_user_identity` 的 `(user_id, type, purpose)` 复合唯一（`uq_identity`）。`type` 取值
`phoneNumber` / `emailAddress` / `idCard` / `password`，`purpose` 取值 `login` / `security`。
实际被业务使用的组合：

| type | purpose=login | purpose=security | 说明 |
|---|---|---|---|
| `phoneNumber` | 有（短信 OTP） | 有（短信 OTP，敏感操作验证方式） | `check/bind` 可同时写 security 行 |
| `emailAddress` | 有（邮件 OTP） | 有（邮件 OTP） | 同上 |
| `password` | 有（OPAQUE registration record，密文存 `value`） | 未写入 | `getStatus` 只按「存在 password 行」报 `set=true` |
| `idCard` | 声明了枚举，无专用 OTP 通道 | 无验证方式 | `getOtpType` 对非 phoneNumber 一律回 `email` |

`SysUserIdentitySharedService` 的加密与查找：

- `value` 是 AES-256-GCM 密文，AAD 固定 `sys_user_identity`；列 `select: false`，
  默认查询不出，取值走仓库的显式 `addSelect` 通道。
- `valueHash = HMAC-SHA256(value, crypto.userIdentitySalt)`，登录/查重按 `(type, value_hash)`
  走 `idx_identity_type_hash`，不需要解密全表。
- `maskedValue` 由 `SharedMaskService.maskIdentityValue` 生成，用于展示。

### 3.2 OTP 绑定验证闭环

所有端点都在 `/system/user/identity` 下，按 token 的 `userId` 自维度操作；只有
`PUT status/:type/:purpose` 挂敏感操作守卫，其余端点**没有** `@HasPermission`。

| 步骤 | 端点 | 行为 |
|---|---|---|
| 0 读状态 | `GET /status/:purpose` | 返回 `{ password: { set, lastChanged }, phoneNumber: { bound, maskedValue, verified, status }, emailAddress: {...} }`；password 不分 purpose，手机/邮箱只取匹配 purpose 的行 |
| 1 预检 + 发码 | `POST /check/:type/:purpose` | 先拒「当前用户已绑该 type+purpose」，再拒「值已被其他用户占用」，然后 `OtpSharedService.sendVerifyCode` 写 `AUTH:VERIFY_CODE:<userId>:<identifier>`（email 走 Bull 队列、从该缓存比对；sms 发送侧另有阿里云 BizId 旁路，校验走阿里云 API） |
| 2 绑定 | `POST /bind/:type/:purpose` | 先在校验码缓存里比对 `verifyCode`；再查重；`verified=true, verifiedAt=now` 落库。`setAsSecurity=true` 且 purpose=login 时，额外 upsert 同 type 的 security 行（同样 `verified=true`，不再单独发码） |
| 3 重发码 | `POST /send-code/:type/:purpose` | 对**已存在**的身份解密 `value` 取 identifier，再发码（用于未验证态的补验证） |
| 4 补验证 | `POST /verify/:type/:purpose` | 校验码通过后把 `verified=true`；这是唯一允许把 `verified` 置真的 HTTP 通道 |
| 5 改值（rebind） | `PUT update/:type/:purpose` | 给 `value` 时查重、重算密文/hash/mask，并强制 `verified=false`、`verifiedAt=null`；给 `verified` 一律 40000 `useVerifyEndpoint`；给 `status` 直接落库 |
| 6 解绑 | `DELETE /unbind/:type/:purpose` | 硬删该身份（不进回收站）。非 password 的 login 身份删除前检查「还有其他已验证且启用的 login 方式，或存在 password」，否则 40000 `unbindAtLeastOneLoginMethodRequired` |
| 7 启停 | `PUT status/:type/:purpose` | 敏感操作 `account_critical` / `email_status_toggle`（`allowChoose`）；通过后才写 `status` |

注意 `PUT update` 与 `PUT status` 都可改 `status`，但只有后者挂敏感守卫；`unbind` 也不挂
守卫。这条不一致登记为 P2-25。

### 3.3 敏感操作授权：challenge → verify → Redis 生命周期

守卫 `WalnutAdminGuardSensitive`（`@WalnutAdminGuardRequireSensitive({ level, type })`）：

1. 已登录校验（无 `req.user` → 40101 族）。
2. 读 Redis `sensitive_op:<userId>:<deviceId>:<level>`，存在即放行。
3. 不存在 → 40119，`meta` 带 `checkVerificationStatus` 的结果（是否需要验证、剩余秒数、
   可用方式、首选方式）。

两步端点（`modules/security/sensitive/`）：

| 端点 | 行为 |
|---|---|
| `GET /security/sensitive/check?level=&type=` | 有授权 → `{ needsVerification: false, remainingSeconds }`；无授权 → 按 `SECURITY_LEVEL_STRATEGIES[level].supportedMethods` 求 `availableMethods`（security purpose 的已验证手机/邮箱对应的 `sms` / `email`）；完全无可用方式 → **40000** `noVerifyMethodAvailable`（不是 40119） |
| `POST /security/sensitive/verify` | body `{ level, operationType?, method, credential }`；method 必须在 `availableMethods` 内，credential 走 OTP 校验；成功后写 `sensitive_op:<userId>:<deviceId>:<level>`，TTL **900 秒**，值为 `{ operationType, verifyMethod, grantedAt, expiresAt }` |

授权的生命周期与覆盖面：

- 键只以 `(userId, deviceId, level)` 为粒度；`operationType` 只写入值里，**不参与键**，
  也不在 `hasPermission` 里比对。因此同一 level 的任一敏感操作通过验证后，该 level 的
  其他操作在 15 分钟内直接放行。
- signout 会清认证后的风险结果，但**不清** `sensitive_op:*`（见 [认证全链](./auth.md) §3.3
  的清理清单）。授权按 TTL 自然过期。
- `verifyAndGrantPermission` 的 `em` 形参上游未接线（`_em`），当前只写 Redis；身份读腿
  走连接级 manager。这是迁移期原样保留的现状。

### 3.4 password 通道摘除现状

P1-5（已修，2026-10-28）后：

- `getUserAvailableMethods` 不再把 `password` 放进可用方式列表；`verifyPassword` 恒
  `false`（分支保留以维持 switch 穷举）。原因：identity 的 `value` 是 OPAQUE registration
  record，不是可直接比对的明文口令哈希。
- 探测腿改为容错：缺失某类 security 身份时跳过该方式（不再 `getIdentityOrThrow`），
  有其余可用方式即可正常进入 40119；只有一种都没有时才 40000。

## 4. 锁定（user_lock）

### 4.1 双默认值

`sys_user_lock` 一行一个用户的锁屏偏好，`lock_route` 是 jsonb（默认 `{}`），
`lock_pwd_hash` 可空（bcrypt），`lock_mode` ∈ `default|idle|security`，
`lock_idle_sec` / `lock_security_sec` / `lock_cross_device` 三列在实体与 service 里各有一套
默认值：

| 场景 | lockIdleSec | lockSecuritySec | lockCrossDevice | lockMode |
|---|---|---|---|---|
| 无偏好行，service 兜底（`getDefaultLockPreference`） | 300 | 60 | false | default |
| 首次 lock 落行后的 DB 默认值 | 600 | 60 | true | default |

所以「读到一个从未锁过的用户」与「锁过一次再读」会看到不同的空闲秒数与跨设备判据
（C 段 user-lock spec 的双默认值对拍即钉此现状）。`lockRoute` 缺失时落 DB 默认空对象。

### 4.2 lock / unlock me 与跨设备判据

| 端点 | 守卫 | 行为 |
|---|---|---|
| `GET /system/user/lock/read` | LockFree | 无偏好行 → service 默认形态；有行且 `lockCrossDevice=true` → `locked = 任意 user_device 行 locked`；否则只看当前设备行 |
| `PATCH /system/user/lock` | LockFree + `@WalnutTx()` | upsert 偏好（只写 `lockRoute`），再置锁 |
| `PATCH /system/user/lock/unlock` | LockFree + `@WalnutTx()` | 偏好行缺失 → 40401；`lockPwdHash` 非空时 bcrypt 比对，失败 40000；再解锁 |

置锁/解锁的公共腿 `lockUserDeviceMainLogic`：

- `lockCrossDevice=true`：`updateLockStatusForAllDevices(userId, locked)` 更新该用户**所有**
  `sys_user_device` 行，并向该用户全部在线 monitor 发 `LOCK` / `UNLOCK` socket 事件。
- `lockCrossDevice=false`：只更新 `(userId, deviceId)` 一行，只向该设备房间发事件。
- 事务提交后写缓存：跨设备键 `SECURITY_LOCK:<userId>:global`，单设备键
  `SECURITY_LOCK:<userId>:<deviceId>`，**无 TTL**。二者不会同时存在，`checkIsLocked`
  先读全局、再读设备键。

Lock guard（`guard/lock.guard.ts`）的顺序：LockFree → 无 `req.user` 放行（未登录）→
无 deviceId 放行 → 缓存命中即判 → 未命中在 `APP:MURLOCK:LOCK_GUARD:<userId>:<deviceId>`
锁内 double-check 后调 `SysUserLockService.getLockForGuard` 回源 DB（按偏好行的
`lockCrossDevice` 选「任意设备」或「本设备」），回填缓存；锁定 → **40118**。

### 4.3 密码与 security 模式的现状

`injectOrUpdateUserLockPre` 的写入路径支持 `lockPwdHash`（bcrypt 加盐），但 **HTTP 没有任何
端点写入该列**：`SysUserLockDoLockDto` 只收 `lockRoute`，read DTO 只读，user_device 的 lock
同样只传 `lockRoute`。因此：

- `lockMode=security` / `lockSecuritySec` 虽然可读，无法通过 API 设置；
- unlock 的 `lockPwdHash` 是可选字段，缺省时直接跳过比对 —— 锁屏密码校验实际不可达。

登记为 P2-26。

## 5. MFA（user_mfa）

### 5.1 表形态与密文列

`sys_user_mfa` 一行一个凭据（`type` ∈ `totp|webauthn`），`device_id` 松引用。
四个密文列 `select: false`：`totp_secret_ciphertext`、`webauthn_public_key`、
`phone_number_ciphertext`、`backup_codes_ciphertext`。默认查询不出，读取走仓库的显式
`addSelect` 通道：

| 方法 | 用途 | 带回的密文列 |
|---|---|---|
| `findTotpWithSecretByUserId` | TOTP verify | `totpSecretCiphertext`（且 `status=true`） |
| `findWebauthnWithPublicKeyByUserIdAndCredentialId` | WebAuthn authenticate/verify | `webauthnPublicKey`（且 `status=true`） |
| `findTotpWithBackupCodesByUserId` | 备用码校验 | `backupCodesCiphertext` |
| 其余 `findTotpByUserId` / `findWebauthnBy*` | 状态、查重、列表 | 无（密文列不查） |

响应面不序列化实体：`user/me/security-tab2` 只回 `{ status, verified }`；
`SysUserMfaDTOBase` 里的密文字段仅作为 DTO 元数据基座，实际请求 DTO 只 pick
`name` / `status` / `trusted`。generate 返回的 TOTP `secret` 与 bind 返回的备用码是
**一次性的明文展示**，落库始终是密文/hash。暴露面复盘见 §8 的 P3-23。

### 5.2 TOTP 真闭环

| 步骤 | 端点 | 关键行为 |
|---|---|---|
| 生成 | `POST /system/user/mfa/totp/generate` | 已有**启用中**的 totp 行 → 40001 DataExists；`otplib.generateSecret` + `generateURI` + QR dataURL；secret 加密后写 `AUTH:MFA:TOTP:<userId>:<deviceId>`（TTL 30 秒）；返回 `{ totpId: "<userId>,<deviceId>", secret, qrCode, account }` |
| 绑定 | `POST /system/user/mfa/totp/bind` | body `{ name, code, tempTotpId }`；`tempTotpId` 必须与 token 的 `userId,deviceId` 一致；查重按 `(userId, deviceId, type=totp)`（**不看 status**）；从缓存取加密 secret，`otplib.verify`（`epochTolerance: 30`，即 ±30 秒）；成功后生成 10 枚备用码（明文返回一次，`hash(code)` 后写入同一 totp 行的 `backup_codes_ciphertext`）；事务提交后删缓存 |
| 验证 | `POST /system/user/mfa/totp/verify` | body `{ trusted, code }`；取启用中的 totp 行与 secret，验码；更新 `lastUsedAt`；调 `AuthMfaPostVerificationService.handlePostVerification`：写 `sys_user_device.trusted`、事务后写 `AUTH:MFA:VERIFIED`、轮换 RT 并回种新 `RT_JTI` cookie |
| 启停 | `PUT /system/user/mfa/totp/status` | 权限点 `system:user:mfa:totp:updateStatus`；按 `(userId, type=totp)` 改 `status`，无行 40401 |
| 解绑 | `DELETE /system/user/mfa/totp/unbind` | 按 `(userId, type=totp)` 物理删除整行；备用码随行同删（没有独立 backup_codes 行）；删除 0 行 40401 |

备用码并入 totp 行是 phase2 §4.12 的定案：PG 的 `type` CHECK 只放行 totp/webauthn，
`varchar(8)` 也容不下 `backup_codes`。`verifyBackupCode` 服务方法仍在，但**没有 controller
路由**（P3-23）；`phone_number_ciphertext` 同样没有写入路径（SMS MFA 未实现）。

`generate` 用「启用中的 totp 行」判重，`bind` 用「任意 totp 行」判重：`PUT status=false`
后再次 generate 会成功并缓存新 secret，但 bind 必定 40000 `alreadyBound`，必须解绑后重绑。

### 5.3 WebAuthn 形状边界

| 端点 | 形状 / 边界 |
|---|---|
| `POST register/options` | body `{ name }`；`generateRegistrationOptions`：`rpName=app.name`、`rpID`/`origin` 取 env `auth.mfa.webauthn.rpId|origin`，`authenticatorAttachment=platform`、`residentKey/userVerification=preferred`，算法 `ES256(-7)` / `RS256(-257)`，`excludeCredentials` 为已有启用 webauthn 行；challenge 写 `AUTH:MFA:WEBAUTN:<userId>:<deviceId>:registration`（30 秒）；返回 `{ options, deviceName }` |
| `POST register/verify` | body `{ name, response }`；challenge 缓存缺失 40000；`verifyRegistrationResponse` 抛错统一包装 40000（P3-5）；`registrationInfo.credential` 的 `id/publicKey/counter` 落库，公钥用 `crypto.mfaKey` 加密；凭据 id 全局唯一（`uq_user_mfa_credential` partial unique），重复 40000 `alreadyBound` |
| `POST authenticate/options` | 无启用 webauthn 行 → 40401；`allowCredentials` 列出凭据；challenge 写 `...:authentication`（30 秒） |
| `POST authenticate/verify` | body `{ trusted, response }`；challenge 缺失 40000；按 `(userId, credentialId)` + `status=true` 取行与公钥；`verifyAuthenticationResponse` 校验 origin/rpID/userVerification，失败统一 40000；成功后更新 `webauthn_counter` 与 `lastUsedAt`，删 challenge，走同一个 post-verification（trusted + MFA 缓存 + RT 轮换） |

正向注册/认证需要浏览器真实凭证，API 回归只覆盖形状与错误路径（ENDPOINTS §5 的
user_mfa/webauthn 行）。

### 5.4 auth/mfa 与 user_mfa 两套端点的分工

| 端点 | 是否校验第二因子 | 职责 |
|---|---|---|
| `GET /auth/mfa/status` | 否 | 当前用户/当前设备可用的方法：`[{ type: totp, enabled }, { type: webauthn, enabled }]`；totp 按用户、webauthn 按当前设备 |
| `POST /auth/mfa/verify` | **否**（只查已绑定记录） | body `{ trusted }`；用 `methodsRequiredCount` 计算 `enabledCount >= required`，满足后写 `sys_user.mfa_setup=true`、设备 trusted、`AUTH:MFA:VERIFIED`，并轮换 RT |
| `POST /system/user/mfa/totp/verify` | 是（TOTP 码） | 验码成功后同一 post-verification |
| `POST /system/user/mfa/webauthn/authenticate/verify` | 是（WebAuthn 断言） | 验签成功后同一 post-verification |

因此 `/auth/mfa/verify` 是「登录后的设备可信声明」，不是输入验证码的端点；真正的第二因子
校验在 system 模块的两个通道。两条链最终都落到同一 `handlePostVerification`（trusted 落库、
`AUTH:MFA:VERIFIED`、RT revoke-and-insert、回种新 jti cookie）。

MFA 成立判据有两套：`/auth/mfa/verify` 与 cron 用「类型数 + 已绑定行数」，
`getCurrentUserMfaSetupStatus` 的 webauthn 腿只看**当前设备**；跨设备登记多个 webauthn
时两者可能给出不同结论（P2-24）。

## 6. 偏好（user_preference）

`sys_user_preference` 一行一个用户，`user_id` UNIQUE。读写面：

- `GET /system/user/preference/read`：`JwtOptional` + Lock/Sign/MFA/Device/Ip Free；
  匿名或未登录时 `userId` 为空，直接返回 service 默认形态（locale `zh_CN`、
  `fontSize=14`、`colorMode=default`、`CVD=default`、`dark=false`、`layoutMode=left-menu`、
  一份带 header/tabs/breadcrumb/menu/footer 的默认 layout）。
- `PATCH /basic` / `accessibility` / `theme` / `layout`：分别 pick `[locale]`、
  `[fontSize, reducedMotion, CVD, colorMode]`、`[dark]`、`[layoutMode, layout]`；
  权限点 `system:user:preference:updateBasic|updateAccessibility|updateTheme|updateLayout`。
- 四段共用同一条 upsert：`INSERT ... ON CONFLICT (user_id) DO UPDATE`，
  只回写本次 payload 携带的列；未给列首次插入走 DB 默认值，冲突路径保留旧值。
  因此四段 PATCH 可以并发（G4 实测：行锁自然串行，四段齐落、无丢段）。
- 空 payload 时走 `ON CONFLICT DO NOTHING`（首插语义，对齐 Mongo 版）。
- 读形态是「四段分组」而不是实体平铺：`{ basic, accessibility, theme, layout }`。
- 默认值有细微差异：service 默认 `CVD='default'`，而 DB 列默认 NULL；用户行由首插
  建立且未带 CVD 时，read 返回的 `CVD` 是 `null`。

## 7. 接口表

统一响应壳 HTTP 200 + `body.code`（成功 20000）。「守卫链」只写与默认全链不同的部分；
未列出的全局守卫照常执行。`list` 端点的请求体是分页 / 过滤 / 排序 DTO。

### 7.1 device

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/device/initial` | Sign/JWT/CAP/Device Free + Throttle 4/60s | 无 | `{ deviceName, sr, vp, hardwareInfo, deviceInfo, private }` → `{ deviceId, latitude, longitude, countryCode }` + DEVICE_ID cookie |
| GET `/system/device/:id` | 全链 | `system:device:read` | 行 uuid → 设备行（sr/vp/geoLocation 组装回嵌套） |
| POST `/system/device/list` | 全链 | `system:device:list` | list DTO（`location` 走 jsonb ILIKE）→ 裁剪行 |
| GET `/system/device/:id/current-active-user` | 全链 | `[system:device:read, system:device:getCurrentUser]` AND | 行 uuid → 当前活跃用户或 `{}` |
| GET `/system/device/:id/history-users` | 全链 | `[read, system:device:getHistoryUsers]` AND | 行 uuid → `[{ id, userName, nickName, lastActiveAt }]` |
| PATCH `/system/device/:id/lock` | 全链 + `@WalnutTx()` | `[read, system:device:lock]` AND | — → `true`（DB + 缓存） |
| PATCH `/system/device/:id/unlock` | 全链 + `@WalnutTx()` | `[read, system:device:unlock]` AND | — → `true` |
| PATCH `/system/device/:id/ban` | 全链 + `@WalnutTx()` | `[read, system:device:ban]` AND | — → `true` |
| PATCH `/system/device/:id/unban` | 全链 + `@WalnutTx()` | `[read, system:device:unban]` AND | — → `true` |

### 7.2 user_device

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/system/user/device/list` | 全链 | `system:user:device:list` | — → `{ data: [{ deviceId, deviceName, locked, lastActiveAt, deviceType, current, auth, location }], total }` |
| PUT `/system/user/device/update-name/:deviceId` | 全链 | `system:user:device:updateName` | `{ deviceName }` → `true` |
| DELETE `/system/user/device/force-quit/:deviceId` | 全链 + `@WalnutTx()` | `system:user:device:forceQuit` | — → `true`（撤 RT） |
| PUT `/system/user/device/lock/:deviceId` | 全链 + `@WalnutTx()` | `system:user:device:lock` | `{ lockRoute? }` → `true` |
| PUT `/system/user/device/unlock/:deviceId` | 全链 + `@WalnutTx()` | `system:user:device:unlock` | `{ lockPwdHash? }` → `true` |

### 7.3 user_identity

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/user/identity/list` | 全链 | 无 | `{}` → `{ data: 身份行（无 value 密文）, total }` |
| GET `/system/user/identity/status/:purpose` | 全链 + `@WalnutTx()` | 无 | purpose 枚举 → `{ password, phoneNumber, emailAddress }` |
| POST `/system/user/identity/check/:type/:purpose` | 全链 | 无 | `{ identifier }` → `true`（发码） |
| POST `/system/user/identity/bind/:type/:purpose` | 全链 + `@WalnutTx()` | 无 | `{ identifier, verifyCode, setAsSecurity? }` → `true` |
| DELETE `/system/user/identity/unbind/:type/:purpose` | 全链 + `@WalnutTx()` | 无 | — → `true`（硬删） |
| PUT `/system/user/identity/update/:type/:purpose` | 全链 + `@WalnutTx()` | 无 | 身份行部分字段 → `true` |
| POST `/system/user/identity/send-code/:type/:purpose` | 全链 + `@WalnutTx()` | 无 | — → `true` |
| POST `/system/user/identity/verify/:type/:purpose` | 全链 + `@WalnutTx()` | 无 | `{ verifyCode }` → `true` |
| PUT `/system/user/identity/status/:type/:purpose` | 全链 + `@WalnutTx()` + Sensitive(`account_critical`) | 无 | `{ status }` → `true` |

`type` / `purpose` 由 `WalnutAdminPipeParamEnum` 校验，枚举外 40099。

### 7.4 user_lock

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/system/user/lock/read` | LockFree | 无 | — → `{ locked, lockRoute, lockCrossDevice, lockMode, lockIdleSec, lockSecuritySec }` |
| PATCH `/system/user/lock` | LockFree + `@WalnutTx()` | 无 | `{ lockRoute? }` → `true` |
| PATCH `/system/user/lock/unlock` | LockFree + `@WalnutTx()` | 无 | `{ lockPwdHash? }` → `true`（偏好行缺失 40401） |

三个端点都是 LockFree，因此**不能**用它们验证 Lock guard；验证锁定态必须用非 LockFree
端点（如 `GET /auth/permissions`）。

### 7.5 user_mfa

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/user/mfa/totp/generate` | 类级 MFAFree + LockFree；`@WalnutTx()` | 无 | — → `{ totpId, secret, qrCode, account }` |
| POST `/system/user/mfa/totp/bind` | 同上 | 无 | `{ name, code, tempTotpId }` → `{ backupCodes }` |
| DELETE `/system/user/mfa/totp/unbind` | 同上；`@WalnutTx()` | 无 | — → `true` |
| POST `/system/user/mfa/totp/verify` | 同上；`@WalnutTx()` | 无 | `{ trusted, code }` → `{ accessToken }` + 新 RT cookie |
| PUT `/system/user/mfa/totp/status` | 同上；`@WalnutTx()` | `system:user:mfa:totp:updateStatus` | `{ status }` → `true` |
| POST `/system/user/mfa/webauthn/register/options` | 类级 MFAFree + LockFree | 无 | `{ name }` → `{ options, deviceName }` |
| POST `/system/user/mfa/webauthn/register/verify` | 同上 | 无 | `{ name, response }` → `true` |
| POST `/system/user/mfa/webauthn/authenticate/options` | 同上 | 无 | — → `{ options }` |
| POST `/system/user/mfa/webauthn/authenticate/verify` | 同上；`@WalnutTx()` | 无 | `{ trusted, response }` → `{ accessToken }` + 新 RT cookie |

### 7.6 user_preference

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/system/user/preference/read` | JwtOptional + Lock/Sign/MFA/Device/Ip Free | 无 | — → `{ basic, accessibility, theme, layout }` |
| PATCH `/system/user/preference/basic` | 全链 | `system:user:preference:updateBasic` | `{ locale }` → `true` |
| PATCH `/system/user/preference/accessibility` | 全链 | `system:user:preference:updateAccessibility` | `{ fontSize, reducedMotion, CVD, colorMode }` → `true` |
| PATCH `/system/user/preference/theme` | 全链 | `system:user:preference:updateTheme` | `{ dark }` → `true` |
| PATCH `/system/user/preference/layout` | 全链 | `system:user:preference:updateLayout` | `{ layoutMode, layout }` → `true` |

## 8. 已知行为注记

以下均已在 `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 登记，这里只写现状与指向：

- **P2-2（已修复）**：device lock/ban 从「只写缓存」改为 DB 事务更新 + after-commit 缓存
  双写；Device guard 缓存 miss 回源库，清 Redis 不再放行。
- **P2-3（已修复）**：`history-users` 从「只回 user 缺失行」改为返回真实绑定用户，
  按 `lastActiveAt` 降序。
- **P3-2（已修复）**：initial 重名 `device_name` 的 23505 收敛为受控 40000。
- **P3-5（已修复）**：webauthn register/verify 的 simplewebauthn 未受控异常包装为 40000。
- **P1-5（已修复）**：sensitive 的 password 通道摘除；可用方式探测改为容错。
- **P1-6（已修复）**：identity 的 `POST list` 空 DTO、bind 的 `setAsSecurity` 缺省、
  `update` 的 null 判据、`update/status` 的探测腿四簇已处理。
- **P2-12**：force-quit 只撤 RT，不清会话/权限/MFA 缓存；AT 到期前仍可用。
- **P2-21（C 段新登记）**：device 的 lock/ban 是 read-modify-write，无行锁；并发两把状态位
  会丢更新。Device guard 缓存 miss 时用「读库时的整行快照」回填缓存，若与 lock/ban 的
  after-commit 双写交错，旧快照会覆盖新缓存，DB 的 locked/banned 在缓存无 TTL 的情况下
  可被长期遮蔽（只有下一次缓存 miss 才回源）。
- **P2-22（C 段新登记）**：删除用户只快照 `sys_user` 主行；identity / oauth / user_device /
  lock / mfa / preference 由 FK CASCADE 清空且不进 `sys_deleted`。恢复用户后没有登录身份、
  没有 MFA、没有偏好，实际不可登录（P2-18 的账户外围同类）。
- **P2-24（C 段新登记）**：MFA 成立判据两套。`/auth/mfa/verify` 与 cron 用「类型数 +
  已绑定行数」（webauthn 跨设备计数），运行时 `getCurrentUserMfaSetupStatus` 的 webauthn
  腿只认当前设备；跨设备登记多个 webauthn 时可能 cron 判 true、verify 判 false。
- **P2-25（C 段新登记）**：identity 敏感操作面不一致。只有 `PUT status/:type/:purpose` 挂
  `RequireSensitive`；`PUT update` 可携带 `status` 直接改启停，`unbind` 无敏感校验。
  另外 unbind 的「至少保留一种登录方式」检查把 password 排除在外：仅剩 password 的用户
  可以解绑 password，导致无任何登录方式。
- **P2-26（C 段新登记）**：lock 的 `lockPwdHash` / `lockMode=security` 没有 HTTP 写入通道
  （lock body 只收 `lockRoute`），unlock 的 `lockPwdHash` 缺省即跳过比对，security 锁屏
  密码校验实际不可达。
- **P3-21（C 段新登记）**：deleted 的 `system:deleted:recover:mine` 常量已声明但未接线，
  `POST me/recover` 复用 `system:deleted:recover`。
- **P3-23（C 段新登记）**：MFA 备用码校验 `verifyBackupCode` 没有 controller 路由，
  且使用裸 `BadRequestException` / `UnauthorizedException`；`phone_number_ciphertext`
  列没有写入路径（SMS MFA 未实现）。
