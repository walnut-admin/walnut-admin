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
| 1 | `WalnutAdminGuardIP` | 查 `realIp` 是否在永久（`APP:SETTING` 的 `app.global.ipBlackList`）或临时（Redis）黑名单 | 40603 | `@WalnutAdminGuardIpFree()`（**当前 0 处调用**：批次 8 / B3 撤掉了全部 4 处豁免 —— IP 黑名单没有中间件兜底，豁免即缺口） |
| 2 | `WalnutAdminGuardSecurity` | UA 存在性、恶意路径、bot、可疑请求、OS/浏览器白名单 | 40604 / 40610 / 40608 / 40609 / 40601 / 40602 | 无（仅 dev 的 `isPostman` 旁路） |
| 3 | `WalnutAdminGuardDevice` | 校验签名 `DEVICE_ID` cookie；缓存/DB 查设备行；封禁与锁定判定；IP 漂移时更新设备 IP | 40605 / 40606 / 40607 | `@WalnutAdminGuardDeviceFree()` |
| 4 | `WalnutAdminGuardRisk`（前） | 采集 pre-auth 频率，评估 IP/设备/失败登录/位置/频率，写 `request.risk` | 40666（当前不可达，见 P1-13） | 无 |
| 5 | `WalnutAdminGuardCap`（前） | 读 `request.risk.comprehensive.recommendation`；强制 `CAPJS_TOKEN` cookie 与缓存校验 | 40111 / 40116 / 40117 | `@WalnutAdminGuardCapFree()` |
| 6 | `JwtAccessGuard` | `Authorization: Bearer <AT>`；`validate` 查 `AUTH:SESSIONS` | 40101 | `@WalnutAdminGuardJwtFree()`；另有 `@WalnutAdminGuardJwtOptional()` |
| 7 | `WalnutAdminGuardRisk`（后） | 合并 post-auth 的 user/userDevice 评估，重写 `request.risk` | 40666（同前） | 无 |
| 8 | `WalnutAdminGuardCap`（后） | 与 #5 同一实现；已有 userId 时把 critical factor 标记为用户-设备维度 | 40116 / 40117 | `@WalnutAdminGuardCapFree()` |
| 9 | `WalnutAdminGuardMFA` | 已登录用户的 `mfaSetup` 强制与设备级 MFA 可信缓存 | 40114 / 40115 | `@WalnutAdminGuardMFAFree()` |
| 10 | `WalnutAdminGuardSign` | HMAC 签名验签（未登录单因子 / 已登录双因子） | 40112 / 40113 | `@WalnutAdminGuardSignFree()` |
| 11 | `WalnutAdminGuardLock` | 用户-设备锁定状态（两个缓存键都缺失时回源 DB；P1-20 修复了旧实现把 miss 折叠成「未锁定」的洞） | 40118 | `@WalnutAdminGuardLockFree()` |

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
COMBINE 下真正判定；`switchable + and` 是误配组合 —— P3-32（2026-10-29）起直接抛 40106，
不再只打日志静默放行（全仓数组调用方都显式传 `or`，零破坏）。

**visitor 拒绝守卫** `WalnutAdminGuardVisitorDeny`（`@WalnutAdminDecoratorVisitorDeny`）：
方法级守卫，`switchable + currentRoleName=visitor` → 40105；未登录放行（交 JWT 守卫）。
当前挂在 `GET /system/menu/tree`（P2-20：菜单树含隐藏行与权限串，visitor 无导航需求 ——
导航来自 `/auth/permissions`）。

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

### 1.3 数据权限（行级 scope）

功能权限（上一节）决定「能不能调这个接口」，**数据权限**决定「这个接口能看到/改到哪些行」。
方案与取舍见 `apps/docs/src/zh-CN/content/plans/data-scope-design.md` §4（应用层 scope + 基类收口 +
fail-closed 注册表；PG RLS 留作三期硬上限），部门维度的实施计划见
`apps/docs/src/zh-CN/content/plans/data-scope-phase2-3-plan.md` §1。

**执行链**：

```
JWT Guard（request.user）→ ALS 拦截器解析描述符 → handler → 基类仓库注入谓词
```

- `apps/server/libs/guards/src/interceptors/request/als.interceptor.ts` 在请求进入 handler 前
  调 `DataScopeService.resolveForUser()`，把 `userId` 与描述符种进 ALS；
- `apps/server/libs/repository/src/pg-base.repository.ts` 的 `list`（在 `customize` 之后）、
  `readById`、`updateByField`、`deleteSoft*` 统一 `andWhere` / scoped where 注入，
  越权读/改/删一律 **40401**（不泄露行存在性）；
- `create` 对注册实体自动回填 owner（如 `app_demo.created_by`）；注册项显式开启
  `fillDeptOnCreate` 时**同时回填行级部门归属**（`app_demo.dept_id` 取创建者的
  `sys_employee.dept_id`，无职工行 → NULL）。归属列不接受 DTO 赋值，update 也会剔除。

**六档与多角色**（`sys_role.data_scope`，smallint；二期批 1 起）：

| 值 | 模式 | 行级谓词 |
|---|---|---|
| 1 | ALL | 不注入（root 恒 ALL） |
| 2 | CUSTOM | `dept 列 IN (sys_role_dept 部门清单)`（不递归子树；空清单默认拒绝） |
| 3 | DEPT | `dept 列 IN (user.dept_id)`（dept 为 NULL → 默认拒绝） |
| 4 | DEPT_AND_CHILD | `dept 列 IN (user.dept_id 的递归子树，含自身)` |
| 5 | SELF | `owner 列 = 当前用户` |
| 6 | DEPT_OR_SELF | `owner 列 = 当前用户 OR dept 列 IN (子树)` |

部门子树由 `dept.basic.repository.findSubtreeById` 的递归 CTE（`CYCLE` 环保护）展开；
注册表实体的 `deptColumn` 缺失时，2/3/4 档位默认拒绝（6 档位退化为仅 SELF，不泄露）。
一期 → 二期的数值重映射（旧 2 SELF → 新 5、旧 3 CUSTOM → 新 2）在
`migrations/1793340000000-DataScopePhase2Dept.ts`；**CUSTOM 的「角色成员」语义已废除**，
部门清单由 `sys_role_dept` 承载（角色 create/update 的 `deptIds` 整组替换，read 回显）。

**行级部门归属（`app_demo` 示范）**：批 2 给 `app_demo` 加了 `dept_id uuid NULL`
（FK → `sys_dept` RESTRICT + `idx_demo_dept` partial index）。部门系档位按该列过滤；
NULL 行是「无部门归属」—— 只有 ALL 档位可见，SELF 仍可按 owner 看到自己创建的行，
DEPT / DEPT_AND_CHILD / CUSTOM 不会包含它。admin 的角色表单把 CUSTOM 的部门清单
做成部门树多选（`sys_role_dept`），用户表单把 `sys_user.dept_id` 做成部门树单选；
两处数据源都是 `GET /system/dept/tree`。

多角色按 **effective roleMode**（`SharedScopeResolverService`，与权限计算同口径）：
COMBINE 取各角色部门集合的并集、任一 SELF 时结果保留本人腿（DEPT_OR_SELF）；SWITCH
只看 currentRole；无启用角色 / 非法档位默认拒绝（恒假谓词）。`root` 契约角色恒 ALL；
`visitor` 固定 SELF —— permission.guard 对 visitor 放行所有 `:list` / `:read`，不能让它
落到默认 ALL 读全量业务表。

**注册表与 fail-closed**（`common/repository/data-scope.ts`）：

- 注册 = 强制过滤（`sys_user`、`sys_log_operate`、`sys_log_auth`、
  `app_monitor_user`、`sys_deleted`、`app_demo`、`sys_employee`）；
- 未注册 = 显式豁免，豁免清单逐条写理由（全局共享表、登录/安全面系统表、组织维度表、
  junction）；
- **fail-closed**：已注册实体在 ALS 里没有描述符时直接抛 403，绝不当 ALL。非 HTTP
  通道（cron / 脚本 / 测试）必须显式 `ALSRequestService.runAsSystem()` 进入系统通道；
- 机械守卫：注册表完整性单测（每张实体表必须注册或豁免）+ ESLint
  `no-restricted-syntax`（已注册实体的 `.getRepository()` 直连必须显式豁免并写理由）。

**端到端矩阵**：`apps/server/apps/api/test/api/system/data-scope/data-scope-matrix.api-spec.ts` 用
`app_demo` 作为靶表覆盖 M1-M10 —— 六档可见集合、越权 read/update 404、create 双回填、
多角色并集、visitor 仅本人、无角色登录被拒（空 roles_list 在 opaque 通道统一翻译为
40103）、角色改档位 / 换清单 / 清空清单后下一请求立即生效。

**缓存与失效**：`AUTH:DATA_SCOPE:<userId>`（不带 deviceId，TTL 与访问令牌同寿命）。
失效点：角色 dataScope/status 修改（按角色成员反查）、`sys_role_dept` 部门清单变更
（该角色成员）、部门移动（旧/新祖先链 + 被移动子树）、部门删除（删除前取的子树）、
用户角色整组替换 / 部门变更 / 删除 / 恢复 / 切换当前角色 / 角色模式（都只影响本人 ——
CUSTOM 改为部门清单后，角色成员变化不再影响同角色其他成员）。角色删除端点当前不存在；
新增删除通道时必须先按 roleId 反查成员再失效。

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
  P2-11 修复后（2026-10-29）：写入是单命令 `SET NX EX`（`AppTechCacheService.setIfAbsent`），
  写入失败即视为重复 —— 并发同 nonce 只有一路通过，不再有 GET 后 SET 的窄窗口。
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

cap.js 本身的接入方式、前端 widget 的挑战/兑换两段、以及 40116（要交互）/ 40117（无感刷新）两条
重试路的完整时序见 [cap.js 人机校验](../../shared/capjs.md)；本节只写**守卫侧**的口径。

- 挑战参数来自 `app.global.capjs.config`，缺省
  `{ count: 10, size: 16, difficulty: 4, ttl: 3600, throttleLimit: 4, throttleTtl: 60 }`。
- **`ttl` 的权威单位是「秒」**（与 `apps/server/db/seed/app_setting.json` 的 `"ttl":3600` 一致）。
  三个消费方的换算**只允许**走 `apps/server/libs/const/src/app/cap.ts` 的 `resolve*`：
  `expiresMs = ttl * 1000`（cap.js 要毫秒）、cookie `maxAge = ttl * 1000`（Express 要毫秒）、
  校验缓存 `ttl = min(ttl, 20min)`（Redis 要秒）。
  历史问题是同一配置被当成**毫秒 / 秒 / 毫秒**三种解释，**不存在任何一个取值能让三处同时正确**：
  种子部署下 challenge 只有 3.6 秒、缓存只有 4 秒；空表部署下 cookie `maxAge` 变成 41.7 天。
- `POST /security/cap/challenge` 创建挑战（`expiresMs = ttl * 1000`，种子值下 ≈ 60 分钟）；
  `POST /security/cap/redeem` 校验 PoW 解，成功时写签名 `CAPJS_TOKEN` cookie
  （`maxAge = ttl * 1000`，种子值下 ≈ 60 分钟）。
  两者都是 `@WalnutAdminDecoratorFreeResponse()`：body 直接是 cap.js 协议形态，无 `{code,data}` 壳。
- cap.js token **本体寿命是 20 分钟**，第三方硬编码（`Date.now() + 20 * 60 * 1000`），
  **与 `ttl` 无关** —— `ttl` 只决定 challenge 有效期与 cookie 的 `maxAge`。
  token **一次性**：服务端 `validateToken` 成功即删除；客户端再次兑换得到
  `success: false`，必须重新 challenge。
- 全局 CAP Guard 的触发条件：`request.risk.comprehensive.recommendation` **存在**。
  - 存在但 cookie 缺失或校验失败：`shouldChallenge` 为 true → **40116**，否则 → **40117**。
  - **不存在**（Risk 未运行 / 无 deviceId / 评估异常）时按端点敏感度分级，与 risk.guard 同口径
    （见 4.3 的「风控降级分级」）：**敏感端点 → 40667**（fail-close），其余端点放行并把
    `request.riskDegraded ??= 'risk-recommendation-missing'` 留痕。这一条是守卫链的第三腿 ——
    即使将来有人把 Risk Guard 从 `APP_GUARD` 里挪走或调换顺序，凭据面也不会裸奔。
- 校验缓存键是 `SECURITY:CAP_TOKEN:<deviceId>:<sha256(token) 前 16 hex>`（P0-3 起与
  设备 + token 双重绑定），TTL = **`min(ttl, 20min)` 秒** —— 缓存**不得长于** token 本体寿命，
  否则缓存命中等于放行一枚 cap.js 已经不认的凭据。
  缓存未命中时在 `APP:MURLOCK:CAP:<deviceId>` 锁内调 `AppCapJS.validateToken` 真验。
- 三种出口**都真实可达**（P3-31 的死码已修）：
  - **40111** Bot Verify Failed：cookie 里的值不是一枚 cap.js token（伪造/损坏/被改写）——
    本地即可判定的客户端不可信，重放同一枚坏 cookie 不会自愈；
  - **40116** Interaction Required：需用户显式交互，或凭据缺失且 `shouldChallenge=true`；
  - **40117** Refresh Required：凭据缺失，或凭据已被 cap.js 判过期/已消费（一次性）——
    客户端无感刷新后重放即可自愈。
  `validateToken` **抛异常**（`.data/tokensList.json` 存储坏 / 只读文件系统 / 磁盘满）按
  **40116/40117** 处理，不按 40111 —— 设施故障不能冤枉用户是机器人。
- **CAP 只有单实例能力**：cap.js 的 token 存在**进程内本地文件** `.data/tokensList.json`，
  副本 A 签发的 token 在副本 B 查不到 ⇒ 多副本部署下校验必失败（40116/40117 风暴）。
  当前部署形态是**单实例**（启动日志会显式打印这条前提）；上多副本前必须先把 token 存储
  换成 Redis（cap.js 的 `storage.tokens` 适配器）或让所有副本共享同一持久卷。
- 校验通过后 `SecurityRiskChallengeStateService.markChallengeHandled` 把本次
  `criticalFactors` 标记为已处理：键形如
  `risk:challenge:<scope>:<值...>:<factor>`（scope 由 factor 前缀决定：device / user-device /
  user / ip / location），TTL 24 小时。未处理的 critical factor 会让下一轮风险评估继续
  要求挑战。

## 4. Device / Risk / IP

### 4.1 设备注册与身份签发

- 注册端点 `POST /system/device/initial`（系统模块）：Sign/JWT/CAP/Device Free，
  Throttle 4 次 / 60 秒，Risk 仍运行。
- `device_id` 由**服务端随机签发**：`generateDeviceId()` = `d1_` + `randomBytes(16).toString('hex')`
  （`libs/system/src/device/device-id.ts`）。**指纹不参与身份派生** —— 客户端自报的
  `X-Fingerprint` 影响不了自己的身份，这也是它与「自证 + 服务端加盐」那种设计的根本差别。
- 形态判据只有一处（`libs/const/src/app/device.ts` 的 `isValidDeviceId`：`d1_` + 32 位小写
  hex）；DB 侧另有同形态 CHECK `ck_device_device_id_form` 兜底，旧裸 64 hex 写不进去。
- **幂等键是 cookie**：带合法 `DEVICE_ID` cookie 再来 = 复用该 id 并整体覆盖（屏幕 / 硬件 /
  IP / 位置历史）；无 cookie 或形态非法 = 新签一个。
- **设备名由签发方决定**：每次 initial 都重新生成 `<设备类型>_<8 位随机 hex>` 并覆盖，客户端
  **不能传**（请求体带 `deviceName` 会被全局白名单判成 40099）。唯一性由服务端保证
  （`uq_device_name` 全局唯一，真撞了仍收敛为受控 40000，P3-2）。
- 注册时调外网 IP 地理 API（本地 IP 回 `LOCAL`）；响应是**拍平**形态
  `{ deviceId, latitude?, longitude?, countryCode? }`（定位服务无结果时只有 `deviceId`），
  并下发签名 `DEVICE_ID` cookie（30 天 maxAge）；事务提交后写 `SYSTEM:DEVICE:<deviceId>` 缓存。

### 4.2 Device Guard

1. 取签名 `DEVICE_ID` cookie；缺失**或形态不是** `d1_` + 32 位小写 hex（旧裸 64 hex /
   伪造 / 空）→ **40605**。判据唯一真源是 `libs/const/src/app/device.ts`，DB 侧同形态 CHECK。
2. `SYSTEM:DEVICE:<deviceId>` 缓存未命中时回源 `sys_device`（P2-2：DB 是 `locked/banned`
   真源），查无 → 40605；命中则回填缓存。
3. 设备当前 IP 与 `realIp` 不同：在 `APP:MURLOCK:DEVICE:IP_CHANGE:<deviceId>` 锁内
   double-check 后调 `updateIpAndLocation`（写 IP / 位置历史，两段按 `arrayOptions.maxSize`
   等长裁剪；提交后回填缓存）。
   该更新会调外网地理 API，IP 频繁变化时有外部依赖成本。
4. `banned` → **40607**；`locked` → **40606**（先判 banned）。
5. 设备锁定/封禁的写入口是 `PATCH /system/device/:id/{lock,unlock,ban,unban}`，
   DB 事务 + after-commit 缓存双写。**封禁 = 踢下线**（拍板-4）：同一事务里撤该设备上所有用户的
   RT，提交后清会话键并断开该设备的 WS；解禁不触发任何踢人。
6. 校验**全通过**之后按续期窗口重发 cookie（滑动续期）：窗口闸是
   `SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`（TTL = 有效期的 80%），命中就重发并把 maxAge 拉满，
   于是 cookie 剩余寿命恒大于 20%。被封禁 / 锁定的设备走不到这一步。

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
- **口径（P1-13，2026-10-28）：不因「风险分高」阻塞**。`recommendation` 不含
  `shouldBlock`（旧实现恒 false 的幻觉字段已从类型与消费点摘除），risk.guard 只写
  `request.risk` 供 CAP guard 消费；受控 `HttpException`（如 40666 RiskTooHigh）原样放行到
  全局异常过滤器。
- 失败登录计数：键 `risk:failed_login:<identifier>:<deviceId>`（Redis Hash，TTL 15 分钟），
  计数达到 **5** 次即调 `SharedIpService.addToTemporaryBlacklist`，临时封 IP 30 分钟。
- 频率阈值（每分钟）：IP 120、设备 120、用户 120；另有一条 IP 5 分钟 400。超出按对数曲线
  计分；采集是 fire-and-forget，不阻塞请求。

#### 风控降级分级（敏感端点 fail-close · 批次 8 / B2）

「风险分」与「风控可用性」是两件事：前者从不阻塞，后者按端点分级 —— 混为一谈就会写出「风控一挂
也能放行登录」这种错的结论。

| 端点 | 风控不可用 / 拿不到 deviceId / 评估抛异常 | 留痕 |
|---|---|---|
| **敏感端点**（凭据面） | **fail-close**：受控 **40667**（`NOT_ACCEPTABLE_RISK_UNAVAILABLE`） | 不进响应壳（请求已被拒），`_devMsg` 带 `<reason> @ <METHOD path>` |
| 其余端点 | fail-open：放行 | 响应壳 `meta.riskDegraded` = `no-device-id` / `risk-evaluation-failed` / `risk-recommendation-missing` |

- **清单是唯一真源**：`libs/guards/src/guards/risk.sensitivity.ts`。它把 `/auth/**` 与
  `/security/**` 的**每一个**路由显式归类（各带一句归类理由），默认值是 fail-open；新增这两个
  家族的路由不同步这张表，`risk.sensitivity.spec.ts` 会直接红（报错里给出缺的 `METHOD path`）。
  全量登记而非只登记 fail-close 几条的理由：漏登记是**静默**的，默认 fail-open 会替新端点兜底。
- 不在清单里的路由 = fail-open，不需要登记。
- 40667 与 40666 刻意分开：40666 是「算出来了、分数太高」，40667 是「压根没算出来」（风控服务
  异常 / 没有 deviceId 可评估）。合成一个码，值班就分不清「有人在爆破」与「风控挂了」。
- 不做全局 fail-close：本仓没有风控 SLA，全关等于把风控服务变成全站单点。
- `meta.riskDegraded` 是**响应壳新增的可选字段**（成功拦截器只在非 `undefined` 时带它），缺省不传
  ⇒ 既有响应零 diff。不敏感端点维持 fail-open 是既定口径，但「这条 200 是在机器人防护缺席时放行
  的」必须能被排查到 —— 前端排障、运维看日志、自动化回归都直接读它。

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
  2026-10-29 复核：`deploy/nginx/conf.d/api.conf` 的 `/`、`frontend.conf` 的 `/api/`、
  `/socket/` 与静态 `location /` 全部为覆盖式（`$remote_addr`）并带 `X-Real-IP`；新增任何
  后端入口都必须照此写。
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
- **P2-11（已修复，2026-10-29）**：nonce 去重改为单命令 `SET NX EX`，并发同 nonce 恰一通过
  （guard-matrix 新增 `Promise.all` 双请求用例）。
- **P2-15（已修复，2026-10-28）**：永久 IP 黑名单的锚点行 `app.global.ipBlackList` 由 seed
  显式落盘（`apps/server/db/seed/app_setting.json`，值与读腿同为 JSON 字符串数组），
  `check-seed` 新增机械判据防止未来再导出时丢行。
- **P2-12（已修复，2026-10-28）**：踢下线（force-quit / admin-kick）在撤 RT 之外，事务
  提交后按设备清 `AUTH:SESSIONS` / `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED`；旧 AT 立即失效。
- **P3-17（新登记）**：`ENDPOINTS.md` 把 `security/sensitive/verify` 的请求登记为
  `{basic,action,type,code}`，与 DTO 实际字段 `{level,operationType,method,credential}` 不符。
