# I5 · GUARD skip 矩阵与接口文档挂载描述

> **任务**：task-5（共享任务板）｜ 执行：industry-research ｜ 日期：2026-11-03
> **范围**：`apps/server/libs/{guards,const,throttle}/**` 的 skip 元数据；`apps/server/apps/api/src/modules/**` 与
> `apps/server/libs/*/src/**` 的全部使用点；Swagger 装配（`apps/api/src/common/swagger/**` ·
> `libs/decorators/src/swagger/**`）；`apps/server/openapi.json` 与
> `apps/docs/src/zh-CN/content/review/backend/api-catalog.md`。
> **方法**：AST 扫描（TypeScript 编译器 API，逐 controller 取类级/方法级装饰器）+ `openapi.json` 全量 195 个
> operation 对账 + 逐 guard 读实现。**只读**：未改任何源码，未运行 `pnpm openapi:export`（它会重写工作区，见 §8.4）。
> **观测口径**：本仓全局异常过滤器**永远回 HTTP 200**（崩溃 = 200 + `body.code=50000`，校验拒绝 = 200 + 40099），
> 所以本文所有「拒绝」都指 **body.code**，不指 HTTP 状态码。
> **工作树状态声明**：开工时工作树**不是 clean**（`git status --porcelain` 4 行：`M knip.config.ts`、
> `M packages/platform-any/contract/src/{index,role}.ts`、`?? packages/platform-any/contract/src/__r1-unused-probe.ts`、
> `?? reports/review-guards/`），这些是**其他并行任务的在途改动**，与本报告无关，我未触碰。

---

## 0. 结论摘要（按优先级）

| # | 结论 | 证据 | 优先级 |
|---|------|------|--------|
| 1 | **8 个 skip 元数据键全部「有效」**：每个 guard 都用 `Reflector.getAllAndOverride(key, [handler, class])` 读同一个 Symbol，类级/方法级语义与运行时一致 | ip.guard.ts:25-33 · device.guard.ts:39-47 · cap.guard.ts:73-81 · sign.guard.ts:71-79 · lock.guard.ts:39-46 · mfa.guard.ts:30-37 · jwt-access.guard.ts:41-48/55-72 | — （已正确） |
| 2 | **Security 与 Risk 两个 guard 没有任何 skip 键，Throttler 也没有 skip 机制**（全仓 `SkipThrottle` 命中 0 处）——即「可被跳过的 guard 只有 7 个」，矩阵分母与 `apps/server/AGENTS.md` 的 12 位链不是同一个数 | security.guard.ts:50-60（只读 `req.isPostman`）· risk.guard.ts（无 Free 键）· `grep @SkipThrottle apps/server` → 0 | P3（口径） |
| 3 | **最大 skip 达 6/7**：`POST /security/sign/initial`、`POST /security/sign/aes-key`、`GET /system/locale/message/{locale}`（6 键，且含 `IpFree`）；`GET /system/user/preference/read` 6 键（含 `IpFree`，但 **CAP 未被 skip**） | sign.controller.ts:31-36 · locale.controller.ts:156 · user_preference.controller.ts:24-31 | P1（见 §6） |
| 4 | **「裸奔」组合的实质**：上述 4 个端点跳过 IP 黑名单 + 设备 + 签名 + JWT + 锁 + MFA，仍保留 Security（UA/bot）、Risk、Throttler；其中 `sign/initial` 与 `aes-key` 的 **deviceId 来自未校验的 Cookie**（DeviceFree 关掉了唯一校验该 Cookie 的 guard，而 handler 仍读它） | user.decorator.ts:20-25（直接读 Cookie）· sign.controller.ts:52-57（handler 用 `WalnutAdminDecoratorDeviceId`）· device.guard.ts:39-47（skip 后不再校验存在性/封禁） | P1 |
| 5 | **CAP 存在与元数据无关的 fail-open 旁路**：Risk 未写入 `request.risk` 时（含 Risk guard 抛错降级）CAP 直接放行 —— 所以「没加 CapFree」不等于「CAP 一定生效」 | cap.guard.ts:89-92 · risk.guard.ts:141-151（catch 里 `return true`，不写 risk） | P1（安全面，非 skip 面） |
| 6 | **8 个 skip 是冗余的（no-op）**：8 个 JwtFree 端点上的 `LockFree`、1 个 JwtFree 端点上的 `MFAFree` —— Lock/MFA 在没有 `request.user` 时本来就会自跳过 | lock.guard.ts:50-53 · mfa.guard.ts:40-44 · 受影响端点见 §5 | P3 |
| 7 | **该 skip 却没 skip（3 条实锤 + 1 条待确认）**：`POST /auth/signout` 缺 JwtFree（access token 过期即无法登出）；`GET /`（hello）未 skip Sign（无握手即 40112）；`GET /app/health/*` 5 个「探针」走完整 12 链（真探针是 raw 路由 `/health/ready`）；待确认：8 个 JwtFree 却强制 Sign 的登录端点 | 见 §7 | P2 |
| 8 | **文档面**：`openapi.json` 只表达 JWT 一档（171 挂 bearer / 24 匿名 / 1 可选），**与 Free 元数据 100% 一致（0 漂移）**，但对 IP/Device/CAP/Sign/Lock/MFA 零表达；`api-catalog.md` 有手写的「认证」列但已出现自相矛盾的过期表述（称「无一声明 security」） | swagger.document.ts:36-47/66-121 · openapi.json 统计见 §8.1 · api-catalog.md:46 | P2 |

---

## 1. 判定口径

每个 skip 点回答三问（任务要求）：

1. **必要吗**：该接口的运行前提是否**排除**了对应的 guard 能力（例如「没有 JWT 可验」「还没有设备 Cookie」「CAP token 尚不存在」）。判据：同族端点的对照 —— 若同族另一端点不 skip 也能工作，则该 skip 可疑。
2. **有效吗**：键是否被对应 guard 读到，且作用域（类级 / 方法级）与预期一致。本仓全部经 `getAllAndOverride` → **类级 + 方法级都生效**（方法级覆盖类级）。
3. **该 skip 却没 skip**：接口在**语义上**不可能满足某 guard（或该 guard 会把它拖死），却没加 Free。

---

## 2. skip 键总表（8 个）

| # | 装饰器（导出函数） | 元数据键（Symbol） | 消费 guard | 读取点 | 语义 | 类型 |
|---|---|---|---|---|---|---|
| 1 | `WalnutAdminGuardIpFree()` | `…DECORATOR_IP_FREE` | WalnutAdminGuardIP | ip.guard.ts:6,25-33 | 跳过 IP 黑名单（**唯一**的 IP 黑名单执行点，中间件不做这件事） | 全跳 |
| 2 | `WalnutAdminGuardDeviceFree()` | `…DEVICE_FREE` | WalnutAdminGuardDevice | device.guard.ts:18,39-47 | 跳过设备 Cookie 存在性/封禁/锁定校验 + IP 变更回写 | 全跳 |
| 3 | `WalnutAdminGuardCapFree()` | `…CAP_FREE` | WalnutAdminGuardCap（注册两次：认证前后） | cap.guard.ts:23,73-81 | 跳过 CAP token 硬校验 | 全跳 |
| 4 | `WalnutAdminGuardSignFree()` | `…SIGN_FREE` | WalnutAdminGuardSign | sign.guard.ts:21,71-79 | 跳过 RSA 握手/时间戳/nonce/signTicket/双因子 HMAC | 全跳 |
| 5 | `WalnutAdminGuardJwtFree()` | `…JWT_FREE` | JwtAccessGuard | jwt-access.guard.ts:10,41-48 | 完全不认证（`canActivate` 直接 true） | 全跳 |
| 6 | `WalnutAdminGuardJwtOptional()` | `…JWT_OPTIONAL` | JwtAccessGuard | jwt-access.guard.ts:20-29,55-72 | 尝试认证，无凭据/失败 ⇒ `user=null` 放行 | 软档 |
| 7 | `WalnutAdminGuardMFAFree()` | `…MFA_FREE` | WalnutAdminGuardMFA | mfa.guard.ts:10,30-37 | 跳过 MFA 已设置 + 已验证校验 | 全跳 |
| 8 | `WalnutAdminGuardLockFree()` | `…LOCK_FREE` | WalnutAdminGuardLock | lock.guard.ts:17,39-46 | 跳过用户锁定校验 | 全跳 |

**不可跳过的 4 项**：Security（UA/黑名单路径/bot，security.guard.ts 无 Free 键）、Risk（两次注册，只评估不拦截）、
Throttler（throttler.guard.ts 只支持「动态限额覆盖」`WalnutAdminDecoratorThrottle(Service)`，无 skip）、
以及 `RequestSign/…` 之外的 Permission/Role/Functional 三类**授权**元数据（不是 skip，是反向要求）。

> 因此矩阵的分母是 **7 个可跳 guard**（IP/Device/CAP/JWT/MFA/Sign/Lock），而 `apps/server/AGENTS.md` 与
> api-catalog.md:23-27 列的 12 位链包含 Security/Risk/Throttler/Permission 等不可 skip 项 —— 两个数都对，
> 但**别混用**（这是本次调研发现的一处口径歧义）。

---

## 3. 穷举矩阵

统计（195 operations / 173 paths / 47 controller，与 openapi.json 全量对齐）：

| 维度 | 数量 |
|---|---|
| operation 总数 | **195** |
| 零 skip（走完整链） | **152** |
| 恰好 1 个 skip | **13** |
| ≥2 个 skip | **30** |
| 其中 6 个 skip（最多） | 4 |

按键计数（类级 + 方法级去重后的 operation 数）：

| skip 键 | 类级命中 | 方法级命中 | 去重后 operation | 说明 |
|---|---|---|---|---|
| IpFree | 2 | 2 | **4** | 见 §3.4（3 个可疑） |
| DeviceFree | 7 | 8 | **15** | 引导期端点为主 |
| CapFree | 4 | 6 | **10** | 引导期 + CAP 自身 |
| SignFree | 3 | 15 | **18** | 登录/回调类为主 |
| JwtFree | 13 | 11 | **24** | 与 openapi 匿名 24 个**完全一致** |
| JwtOptional | 0 | 1 | **1** | `preference/read` |
| MFAFree | 11 | 2 | **13** | MFA 自身 + refresh + preference |
| LockFree | 15 | 9 | **24** | 其中 8 个是 no-op（§5） |

### 3.1 ≥2 skip 的 30 个 operation（必要性判定）

「必要性」列：✅ 必要 ｜ ⚠️ 可疑（可收敛） ｜ ❌ 冗余（no-op）。

| # | METHOD 路径 | skip 键 | 位置（file:line） | 必要性 | 备注 |
|---|---|---|---|---|---|
| 1 | GET `/` | Device+Jwt | apps/api/src/app/app.controller.ts:17 | ✅✅ | **Sign 未 skip** → 见 §7-H2 |
| 2 | POST `/app/monitor/user/state` | Sign+Jwt+Cap+Device | …/app/monitor/user/user.controller.ts:131 | Jwt✅ Sign⚠️ Device⚠️ Cap✅ | 匿名心跳可以不带签名，但它是**写**操作且 handler 接受 client 报的 `userId`（旧评审 F-47）→ 见 §6.3 |
| 3 | POST `/auth/signout` | Sign+Device | …/auth/auth.controller.ts:43 | Sign✅ Device✅ | **缺 JwtFree** → §7-H1 |
| 4 | POST `/auth/refresh` | Lock+Sign+MFA+Jwt+Device | …/auth/modules/refresh/refresh.controller.ts:28 | 全部 ✅；MFA ❌冗余 | RT 是唯一凭据（轮换 + 悲观锁），必需 |
| 5 | POST `/auth/google` | Jwt+Sign | …/auth/modules/google/google.controller.ts:36 | ✅✅ | id_token 即凭据 |
| 6-7 | GET `/auth/mfa/status` · POST `/auth/mfa/verify` | MFA+Lock | …/auth/modules/mfa/mfa.controller.ts:21,39 | ✅✅ | MFA 前置流程 |
| 8-11 | GET `/auth/oauth/{gitee,github}/{callback,sse/{fp}}` | Jwt+Sign | gitee.controller.ts:108,219 · github.controller.ts:108,219 | ✅✅ | 浏览器重定向/EventSource 无法自定义签名头 |
| 12 | GET `/security/rsa/public-key` | Sign+Jwt+Cap | …/security/rsa/rsa.controller.ts:14 | ✅✅✅ | 握手第 1 步；**未 skip Device**（依赖 `/system/device/initial` 先跑）→ §7-H5（P3） |
| 13 | POST `/security/sign/initial` | Sign+Cap+Jwt+Lock+Device+**Ip** | …/security/sign/sign.controller.ts:42（类级 :31-36） | 前 5 ✅；**Ip ❌不必要** | 见 §3.4 / §6.1 |
| 14 | POST `/security/sign/aes-key` | 同上 6 键 | sign.controller.ts:59 | 同上 | 返回设备 AES key（RSA 信封） |
| 15-16 | POST `/security/cap/{challenge,redeem}` | Cap+Jwt+Device+Lock+Sign | …/security/cap/cap.controller.ts:79,96 | ✅（鸡生蛋） | Ip 未 skip（正确） |
| 17 | GET `/app/setting/public` | Lock+Sign+Jwt+Cap+Device | libs/app-domain/src/setting/setting.controller.ts:51 | 前 4 ✅；Lock ❌冗余 | 登录前读公开设置 |
| 18 | POST `/system/device/initial` | Sign+Jwt+Cap+Device | …/system/device/device.controller.ts:52 | ✅✅✅✅ | 设备注册；**Ip 未 skip（与 #13 矛盾）** |
| 19 | GET `/system/lang/list/public` | Lock+Sign+Jwt+Cap+Device | …/system/lang/lang.controller.ts:86 | 前 4 ✅；Lock ❌冗余 | 登录页语言列表 |
| 20 | GET `/system/locale/message/{locale}` | 上述 5 + **Ip** | …/system/locale/locale.controller.ts:156 | 前 5 ✅；**Ip ❌不必要** | 登录页文案；Ip 处理与 #19 不一致 |
| 21-28 | `/system/user/mfa/{totp,webauthn}/**`（8 个） | MFA+Lock | …/system/identity/mfa/totp.controller.ts:29,45,62,73,96 · webauthn.controller.ts:28,48,67,84 | ✅✅ | 绑定/解绑/验证 MFA 自身必须绕过 MFA |
| 29 | GET `/system/user/preference/read` | JwtOptional+Lock+Sign+MFA+Device+**Ip** | …/system/identity/user_preference.controller.ts:24 | 前 5 ✅；**Ip ❌不必要** | **Cap 未 skip**；见 §6.2（匿名路径与 CAP 冲突） |
> 说明：#6-7、#8-11、#15-16、#21-28 各合并了同族端点（MFA 8 个、OAuth 4 个），合并后正好覆盖上述 30 个 operation。

### 3.2 恰好 1 个 skip 的 13 个 operation

| METHOD 路径 | skip | 位置 | 判定 |
|---|---|---|---|
| GET `/auth` | Device | app.controller.ts:28 | ✅（登录后 hello；Device 对本机不必要但无害） |
| GET `/deps` | Device | app.controller.ts:37 | ✅（同族一致） |
| POST `/auth/otp/send` · `/auth/otp/verify` | Jwt | …/auth/modules/otp/otp.controller.ts:35,50 | ✅ Jwt；**Sign 仍强制** → §7-H4 |
| POST `/auth/opaque/user/login/{start,finish,client-error}` | Jwt | …/opaque/user/opaque.user.controller.ts:35,104,69 | ✅ Jwt；Sign 仍强制 → §7-H4 |
| GET `/auth/oauth/{gitee,github}/url` | Jwt | gitee.controller.ts:95 · github.controller.ts:95 | ✅ Jwt；Sign 仍强制 → §7-H4 |
| GET `/app/setting/private` | Lock | libs/app-domain/src/setting/setting.controller.ts:72 | ⚠️ LockFree 让「被锁用户」仍能读私有设置 —— 与「锁定=冻结」语义冲突，建议复核 |
| GET `/system/user/lock/read` · PATCH `/system/user/lock` · PATCH `/system/user/lock/unlock` | Lock | …/system/identity/user_lock.controller.ts:18,55,73 | ✅（锁定态必须能查询/解锁） |

### 3.3 零 skip 的 152 个 operation

全部走完 7 个可跳 guard + Security/Risk/Throttler/Permission。**这不是问题**（默认最严），
但意味着任何「只对某一人群开放」的端点都必须由 Permission/Role 表达，而不是 skip。抽查 3 个高危面
（key 轮换、error 测试、monitor force-quit）确认都带 Permission（例如 key.controller.ts:38 手写
`@SetMetadata(PERMISSION)`）。

### 3.4 IpFree 的 4 个点（本次重点）

| # | 端点 | 结论 | 证据 |
|---|---|---|---|
| 1 | POST `/security/sign/initial` | **不必要** | 同族 `POST /system/device/initial`（同样在引导期）**没有** IpFree（device.controller.ts:52-57）—— 说明引导期不需要跳过 IP 黑名单 |
| 2 | POST `/security/sign/aes-key` | **不必要** | 同上（类级 skip，sign.controller.ts:31-36） |
| 3 | GET `/system/locale/message/{locale}` | **不必要** | 同族 `GET /system/lang/list/public` 未 skip IP（lang.controller.ts:86），两者都是登录页静态文案 |
| 4 | GET `/system/user/preference/read` | **不必要** | 同族 `GET /app/setting/public` 未 skip IP（setting.controller.ts:51） |

IP 黑名单是**唯一**在请求早期、不依赖任何凭据的拦截（ip.guard.ts:35-39），且没有中间件兜底
（`grep isIpBlacklisted apps/api/src/middleware` → 0 命中）。跳过它没有任何可用性收益（黑名单只影响
被拉黑的 IP），却有明确的安全收益损失 → 建议全撤（P2，工作量 S）。

---

## 4. 有效性核查（逐 guard）

| guard | 读取方式 | 类级生效 | 方法级生效 | 备注 |
|---|---|---|---|---|
| IP | `getAllAndOverride([handler, class])` ip.guard.ts:25-28 | ✅ | ✅ | — |
| Security | **无 Free 键** | — | — | 只有 `req.isPostman` 旁路（:54-56） |
| Device | :39-42 | ✅ | ✅ | 另有 `req.isPostman` 旁路（:57-60） |
| Risk（×2） | **无 Free 键** | — | — | 只评估不拦截（risk.guard.ts:11-24） |
| CAP（×2） | cap.guard.ts:73-76 | ✅ | ✅ | 两次注册共用一个键（同一类），skip 一次即前后都跳 |
| JWT | jwt-access.guard.ts:41-47 / :57-60 | ✅ | ✅ | Free=不认证；Optional=认证但不强制 |
| MFA | mfa.guard.ts:30-33 | ✅ | ✅ | — |
| Sign | sign.guard.ts:71-74 | ✅ | ✅ | 另有 `req.isPostman` 旁路（:86-89）；**:69 残留注释掉的 `return true`**（调试开关死代码，建议删） |
| Lock | lock.guard.ts:39-42 | ✅ | ✅ | — |
| Throttler | 无 skip（只有动态限额覆盖 throttler.guard.ts:46-73） | — | — | 全仓 `@SkipThrottle` 命中 0 |

**与元数据无关的 4 条旁路**（「有效」≠「一定生效」）：

1. **CAP fail-open**：`recommendation === undefined ⇒ 放行`（cap.guard.ts:89-92）。Risk guard 在
   异常路径不写 `request.risk`（risk.guard.ts:141-151），所以 Risk 抖动 = 全站 CAP 失效（含
   `preference/read` 这类「没加 CapFree」的端点）。
2. **isPostman 旁路**：device/cap/sign/security 四个 guard 都有（device:57 · cap:68 · sign:86 · security:54），
   由 `isPostmanRuntimeRequest` 决定，**production 恒 false**（user-agent.middleware.ts:54-70 有权威说明）。
3. **Lock 自跳过**：无 `request.user` 或无 deviceId 时直接 true（lock.guard.ts:50-53,56-60）。
4. **MFA 自跳过**：无 `request.user` 时 true（mfa.guard.ts:40-44）；visitor 角色也跳过（:47-50）。

---

## 5. 冗余 skip（no-op）清单 —— P3

| 端点 | 冗余键 | 为什么是 no-op |
|---|---|---|
| POST `/auth/refresh` | MFAFree | JwtFree 已让 `request.user` 为 null（jwt-access.guard.ts:41-48），MFA 在 mfa.guard.ts:40-44 自跳过 |
| POST `/auth/refresh` · `/security/sign/initial` · `/security/sign/aes-key` · `/security/cap/challenge` · `/security/cap/redeem` · GET `/app/setting/public` · GET `/system/lang/list/public` · GET `/system/locale/message/{locale}` | LockFree（**共 8 个**） | 这些端点都已 JwtFree ⇒ 无 `request.user` ⇒ Lock 在 lock.guard.ts:50-53 自跳过 |

> 冗余本身**不造成漏洞**，但它制造「我已经控制住了」的错觉，并让矩阵看起来比实际更需要 6 个 skip。
> 清理方式：删掉冗余装饰器（零行为变化），或保留但在报告里注明（本次已注明）。

---

## 6. 危险面（组合分析）

### 6.1 `POST /security/sign/initial` 与 `POST /security/sign/aes-key` —— 6/7 skip（P1）

- **组合**：IP + Device + CAP + JWT + Lock + Sign 全跳，只剩 Security（UA/bot）、Risk、Throttler。
- **实质风险（不是「能直接打穿」）**：DeviceFree 关掉了**唯一**校验 `DEVICE_ID` Cookie 的 guard
  （device.guard.ts:39-47），而两个 handler 仍从该 Cookie 取 deviceId
  （sign.controller.ts:52-57 用 `WalnutAdminDecoratorDeviceId`；user.decorator.ts:20-25 直接读 Cookie）。
  于是 **deviceId 变成客户端可任意声明的值**：攻击者可为任意 deviceId 注册自己的 RSA 公钥
  （`sign/initial` 写缓存），并取走该 deviceId 的 AES key 信封（`aes-key`，需自己的私钥解封）。
  影响半径取决于「deviceId 是否被别处当作可信身份」——deviceId 参与 CAP 缓存键（cap.guard.ts:162,185）、
  sign ticket 绑定（sign.guard.ts:111）、风险画像（risk.guard.ts:39）。**这是一条需要产品/安全决策的边界**（见拍板 Q2）。
- 缓解现状：需要 RSA 私钥才能解封 AES key；`sign/initial` 的 `force` 语义未在此轮深查（属 I3 任务）。

### 6.2 `GET /system/user/preference/read` —— 6 skip 但 CAP 未跳（P2，语义冲突）

- 元数据声明 `JwtOptional`（文档写 `[{bearer:[]},{}]` = 可匿名），但 **CAP Guard 对「缺 capToken」
  是无条件抛**（cap.guard.ts:104-116：shouldChallenge ? 40116 : **40117**）。
- 所以：匿名调用只有在 **Risk 未写 `request.risk`** 时才可能成功；一旦 Risk 正常评估，匿名读偏好会拿到 40117。
  → 文档宣称的「可匿名」在运行时**不成立**（除非客户端先拿 CAP token）。
- 这也是 §4 旁路 1 的镜像：CAP 的放行与否由 Risk 是否成功决定，不由端点的 Free 元数据决定。

### 6.3 `POST /app/monitor/user/state` —— 4 skip 且匿名（P2）

- Sign+Jwt+Cap+Device 全跳，IP 保留。handler 接受客户端上报的 `userId` 做关联（旧评审 F-47 已登记）。
- 判定：**JwtFree/CapFree 必要**（心跳来自可能已过期的页面），**SignFree 可疑**（它是 POST 写操作，
  签名能力在登录后一定具备），**DeviceFree 使 deviceId 不可信**（同 §6.1）。
- 建议：至少恢复 Sign（客户端此时已有会话），或把 `userId` 从入参改成「仅在认证链回填」。

### 6.4 「同时 skip 多个关键 guard」的完整名单

| skip 数 | 端点 | 剩余防线 |
|---|---|---|
| 6 | `sign/initial` · `sign/aes-key` · `locale/message/{locale}` · `preference/read` | Security + Risk + Throttler（preference 另有 CAP） |
| 5 | `auth/refresh` · `cap/challenge` · `cap/redeem` · `setting/public` · `lang/list/public` | + IP（这 5 个都没 skip IP） |
| 4 | `monitor/user/state` · `device/initial` | + IP + Lock/MFA（它们因无 user 而自跳过） |

结论：**没有一个端点把「8 个键」全跳**（最多 6），且 Security/Risk/Throttler 恒在；但 4 个 6-skip 端点里
有 **3 个的 IpFree 属于不必要**（§3.4），撤掉后「裸奔度」立刻下降一档。

---

## 7. 该 skip 却没 skip（单列）

### H1 `POST /auth/signout` 缺 JwtFree —— P1（可用性，不是安全）

- 证据：auth.controller.ts:43-63，只有 `SignFree + DeviceFree`，无 JwtFree ⇒ 走 JwtAccessGuard，
  access token 过期即 40101（jwt-access.guard.ts:69-72），**用户无法登出**，服务端 RT 仍现役。
- 语义矛盾：signout 的正文是「删掉 DB 里的 refresh token」（auth.controller.ts:57-62），它本质上是
  **以 RT Cookie 为凭据**的操作，不需要 AT。
- 修法（需拍板）：a) 加 JwtFree + 用 RT Cookie 认人；b) 保留 AT 要求，前端在 401 时本地清态（现状）；
  c) 加 `JwtOptional`（有 AT 用 AT，没有就用 RT）。

### H2 `GET /`（hello）未 skip Sign —— P3

- 证据：app.controller.ts:13-26：类级只有 `DeviceFree`，方法级只有 `JwtFree`；Sign guard 仍执行，
  要求 RSA 握手 + 时间戳 + nonce + signTicket（sign.guard.ts:92-111）。
- 后果：任何**未完成握手**的客户端（含 LB/监控探活、curl）拿到 40112 而不是 hello。
- 影响有限：`apps/admin/src/api` 内 0 处调用 `/`（`grep` 实测），nginx 的健康检查用的是前端静态页。
- 建议：要么加 `SignFree`（推荐，hello 无副作用），要么把该端点从 OpenAPI 移除（它已是「演示端点」）。

### H3 `GET /app/health/*`（5 个）走完整 12 链 —— P2

- 证据：health.controller.ts:33-36 类级 `HasRole([ROOT, DEVELOPER])` + 每端点 `HasPermission`；
  **无任何 Free**，因此需要 JWT + Device + CAP + Sign + Lock + MFA 全部通过。
- 真探针在别处：raw Express 路由 `/health/live` / `/health/ready`（probes.composition.ts:43-44），
  由 docker healthcheck 使用（deploy/docker-compose.yml:41-45），且 nginx 对公网 `/health/` 返回 404
  （deploy/README.md:133）。所以这 5 个 Nest 端点是**运维诊断面**，不是编排探针。
- 问题：诊断面的用途是「排查故障」，但它要求**安全链本身完好**（握手缓存、CAP 缓存、MFA 会话都在）。
  当故障正好出在这些缓存/依赖上时，这 5 个端点不可用 —— 与用途相反。
- 建议（需拍板）：至少给它们 `SignFree + CapFree + MFAFree`（保留 JWT+Role+Permission），
  或明确声明「它们是受保护诊断接口」并改名（`/app/health/*` → `/app/diagnostics/*`）。

### H4 JwtFree 却强制 Sign 的 8 个登录端点 —— P3（待确认，可能是设计）

- 证据：`/auth/otp/{send,verify}`、`/auth/opaque/user/login/{start,finish,client-error}`、
  `/auth/oauth/{gitee,github}/url` 全部只有 JwtFree（单 skip 表），Sign 仍强制。
- 两面性：若客户端在登录前已完成握手（device/initial → rsa → sign/initial → aes-key），则单因子签名可用
  （sign.guard.ts:29-38 明确写了「未登录单因子模式用于注册、握手等公开接口」）⇒ **这是有意设计**。
- 但风险：**握手不可用即登录不可用**（鸡生蛋），且 OpenAPI 完全没写这一层。建议在文档里显式声明这 8 个端点的
  「登录前必须完成握手」，或评估给它们 SignFree（会降低整体签名覆盖率，需安全决策）。

### H5 `GET /security/rsa/public-key` 未 skip Device，且是握手第 1 步 —— P3

- 证据：rsa.controller.ts:14-17 只有 Sign/ Jwt / Cap Free；Device guard 仍要求 `DEVICE_ID` Cookie。
- 后果：客户端必须**先**调 `/system/device/initial` 拿到 Cookie（device.controller.ts:71-75 才写 Cookie），
  才能取 RSA 公钥。顺序写死在实现里（device → rsa → sign），但**任何文档都没写**（见 §8）。若 Cookie 因
  SameSite/第三方策略被浏览器拦，握手链直接断。

---

## 8. 接口文档现状

### 8.1 openapi.json：只有 JWT 一档（且 0 漂移）

| 指标 | 实测 |
|---|---|
| openapi 版本 / paths / operations | 3.0.0 ／ **173** ／ **195** |
| 声明 `security` 的 operation | **171**（170 × `[{bearer:[]}]` + 1 × `[{bearer:[]},{}]`） |
| 未声明 security（= 匿名） | **24** |
| 与 Free 元数据的一致性 | 匿名 24 个 ⇔ `JwtFree` 的 24 个 operation —— **0 例外**（脚本对账） |
| securitySchemes | 只有 `bearer` |
| 文档级 `security` | 未声明（swagger.options.ts:17-18 有意如此） |
| 任何 `x-*` 扩展 / 逐 op 的 guard 描述 | **无**（逐 op 只有 summary/parameters/responses/tags） |
| 提到 guard 类字样的 summary/description | 6 个（多为 mfa/device 的语义，不是挂载说明） |

**结论**：`openapi.json` 精确表达了「JWT 有没有」，但 **IP / Device / CAP / Sign / Lock / MFA / Throttler 7 项全部不可见**。
唯一的相关说明在**文档级**描述里（swagger.options.ts:33-44）：「未声明 security 的 operation 是公开的：不需要 JWT
（JwtFree / all-Free）—— 但**请求签名、设备与风险 guard 仍可能拒绝调用**」。这句是对的，但它是一句**全局免责**，
读者无法知道**哪个**端点会被哪一层拒。

### 8.2 api-catalog.md：有手写「认证」列，但已出现自相矛盾

- 有：§0.2 记录 12 链（api-catalog.md:23-29），逐端点表格有「认证」列并标注 Free
  （例：:67 `GET / | DeviceFree + JwtFree（Sign 生效）`）。
- 过期：§0.4 写「全局性缺口（全站 195 op **无一声明 security**）」（api-catalog.md:46）—— 与实测
  171/195 已声明 **矛盾**（bearer 注入已落地，见 swagger.document.ts:107-113）。
- 结构风险：它是**手写的**（api-catalog.md:5-7 自述「逐文件通读 + 与 openapi.json 机器对账」），
  与源码没有机械绑定 ⇒ 每次端点变更都可能漂移，且**没有任何门禁**在查它。

### 8.3 已有的「从元数据生成文档」基建（可直接复用）

`apps/api/src/common/swagger/swagger.document.ts` 已经做了**同类事情**，只是只做了 JWT：

- 它用 `DiscoveryService + MetadataScanner` 遍历全部 controller/handler（:66-83）；
- 对每个 handler 用**与运行时同一套** `Reflector.getAllAndOverride(JwtFree/JwtOptional, [handler, class])`
  读元数据（:85-96）；
- 结果写进 OpenAPI：`ApiBearerAuth()` / `ApiSecurity({})`（:107-113），并做幂等标记（:98-99,114）；
- 头注释 :36-47 给出「三档判据」表，并说明为什么不能放在 DTO 工厂里（装饰器求值顺序）。

⇒ **「接口 × guard 矩阵」不需要新扫描器，只需要在同一个循环里多读 6 个键**（实现方案见 proposal.md）。

### 8.4 与门禁的关系（重要）

- `openapi.json` 是 **check-in 的生成物**，由 `pnpm openapi:check` 守（apps/server/package.json:38-40：
  导出 → 生成 `schema.d.ts` → `git diff --exit-code`），并接在 prepush 门禁表的 `openapi` 段
  （packages/tooling/scripts/src/ci/prepush.ts:162-184）。
- **该段会重写工作区**（prepush.ts:181-183 明写）。所以本轮调研**没有**跑 `openapi:export`，
  也建议实施时先确认工作树干净（当前不干净，见文件头声明）。

---

## 9. 需要 Lead 拍板

| # | 问题 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| **Q1** | 4 个 `IpFree` 要不要全撤？ | a) 全撤（4 处）；b) 只撤 3 个「与同族不一致」的，保留 `sign/initial`（引导期）；c) 维持现状 | **a** | 同族对照证明引导期不需要跳 IP（device/initial 未跳也能工作）；IP 黑名单是无凭据早期拦截，无可用性收益 |
| **Q2** | `sign/initial` 与 `aes-key` 的「未校验 deviceId」怎么处理？ | a) 加回 Device 校验（会要求先 device/initial，顺序已有）；b) 保持 DeviceFree，但把 deviceId 改为**服务端签发的一次性 bootstrap token**；c) 接受现状并写进 ADR | **b（若要动业务代码）/ 至少 c** | deviceId 参与 CAP 缓存键、sign ticket、风险画像（§6.1），作为「可任意声明的值」是被下游信任的；a 的代价最小但可能打破「设备不存在也能握手」的初衷 |
| **Q3** | `GET /system/user/preference/read` 的「可匿名」到底要不要成立？ | a) 加成 `CapFree`（让匿名真的可用）；b) 去掉 `JwtOptional`（改为受保护，文档改回 `[{bearer}]`）；c) 维持现状（匿名只在 Risk 缺省时可用） | **a 或 b**（取决于产品：登录页是否需要读偏好） | 现状是「文档说可匿名、运行时多半 417」的自相矛盾（§6.2） |
| **Q4** | `POST /auth/signout` 是否允许「仅凭 RT 登出」？ | a) 加 `JwtFree` + 用 RT 认人；b) 保持现状（AT 过期即不能登出，前端本地清态）；c) `JwtOptional` | **a** | 登出的本质是撤销 RT（auth.controller.ts:57-62），AT 过期仍应能撤销 |
| **Q5** | `GET /app/health/*`（5 个）定位？ | a) 降级为「受保护诊断接口」并改名 + 补 Free（Sign/Cap/MFA）；b) 改成真探针（JwtFree+全 Free），但会与 raw 探针重复；c) 维持现状 | **a** | 真探针已有（probes.composition.ts:43-44 + docker healthcheck）；这 5 个的价值在「带业务上下文的诊断」，不该被安全链拖死 |
| **Q6** | 接口 × guard 文档化落哪一层？ | a) 写进 openapi（`x-walnut-guards` + description 一行）；b) 独立生成 `docs/…/guard-matrix.md`（不动 openapi）；c) 先做 lint 门禁（skip allowlist），文档暂缓 | **C → B → A 分三步**（详见 proposal.md §6） | C 防回归（最小成本、最高收益）；B 零 diff 风险；A 才有机器可读契约但会让 openapi.json 全量重排一次 |
| **Q7** | 8 个 JwtFree 但强制 Sign 的登录端点算不算问题？ | a) 维持（有意设计）并在文档显式声明「登录前须完成握手」；b) 给它们 SignFree（提高可用性、降低签名覆盖）；c) 逐个评估 | **a** | sign.guard.ts:29-38 已声明单因子模式用于公开接口；真正缺的是**文档**而不是代码 |

---

## 附：可复跑的判据（只读）

```powershell
# 1) skip 键与消费者（应命中 8 个键 + 7 个 guard 读取点）
Select-String -Path (Get-ChildItem -Recurse apps/server/libs/guards/src/guards/*.ts).FullName -Pattern 'FreeKey' | Measure-Object

# 2) 全仓是否有 @SkipThrottle（应为 0）
(Get-ChildItem -Recurse -Include *.ts apps/server | Select-String -Pattern '@SkipThrottle').Count

# 3) openapi 三档统计（171 / 24 / 1）
node -e "const d=require('./apps/server/openapi.json');let a=0,b={};for(const[p,i]of Object.entries(d.paths))for(const[m,o]of Object.entries(i)){if(!['get','post','put','patch','delete'].includes(m))continue;const k=JSON.stringify(o.security);b[k]=(b[k]||0)+1}console.log(b)"

# 4) Free 使用点计数（按装饰器）
foreach ($n in 'IpFree','DeviceFree','CapFree','SignFree','JwtFree','JwtOptional','MFAFree','LockFree') { $c=(Get-ChildItem -Recurse -Include *.ts apps/server | Select-String -Pattern ("WalnutAdminGuard"+$n+"\()")).Count; "$n = $c" }
```

> 临时脚本位于 `%TEMP%\guard-matrix-*.js` 与 `guard-matrix-*.json`，本轮结束已删除；
> 脚本逻辑（AST 取装饰器 + openapi 对账）已完整写入 `proposal.md` §7，可直接复现。
