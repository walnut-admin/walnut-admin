# API 端点全景测绘（API 回归验证 A 段 + B 段 + C 段 + D 段 + F 段）

> 全部 controller 的「模块 → 端点 → 方法/路径 → 守卫 → 请求形态」矩阵，后续 API 级测试批次的清单。
> 路径均相对 `/{APP_API_PREFIX}/v{APP_API_VERSION}`（本地开发 env 为 `/w/v1`，下同省略）。
> 来源：`apps/api/src/**/*.controller.ts` 静态扫描 + 逐文件核对（2026-10-25，分支 refactor/postgres-migration）。
> B 段（2026-10-26）：§1 app 系 + §4 shared/area + §6 health + §7 根 controller 全部落地
> `*.api-spec.ts`（8 份新文件、45 用例），登记见各表格「API 级测试策略」列与文末「B 段补记」。
> C 段（2026-10-26）：§5 system 模块除 lang/locale（A 段）与 deleted/logs（未在本段范围）外全部落地
> `*.api-spec.ts`（11 份新文件、87 用例），登记见各表格与文末「C 段补记」。
> D 段（2026-10-26）：§2 auth 会话链/opaque 管理端/otp、§3 security、§5 的 deleted/log_auth/log_operate、
> §4 shared/ali 与外部 OAuth 错误路径全部落地 `*.api-spec.ts`（9 份新文件、46 用例），
> 登记见各表格与文末「D 段补记」。
> F 段（2026-10-26）：API 安全专项 —— guard/安全策略**拒绝矩阵**，`guard-matrix.api-spec.ts`
> （29 用例：Sign/JWT/Device/CAP/MFA/Lock/IP/functional 全拒绝面 + 安全矩阵发现钉死）与
> `throttle.api-spec.ts`（2 用例：device/initial 4/60s 连发 + 429 形态），见文末「F 段补记」与「安全矩阵发现」。
> G+H 段（2026-10-26）：并发/锁专项 `concurrency.api-spec.ts`（6 用例）+ API 级事务回滚直测
> `api-rollback.api-spec.ts`（3 用例）。
> I 段（2026-10-27）：真实权限链路专项 `permission-chain.api-spec.ts`（7 用例：种子非 root 用户 →
> 权限缓存写/读 → permission.guard 放行/40105 → 缓存读序 → SWITCH/COMBINE 对照 → root 短路对照），
> 种子助手 `helpers/seed-permissions.ts`，登记见文末「I 段补记」。
>
> **设计与行为缺陷清单已收编至 [DESIGN-ISSUES.md](./DESIGN-ISSUES.md)（P0/P1/P2/P3 分级，
> 含位置/实测证据/建议修法）** —— 本文各段「钉现状」自此只作历史叙述、不再新增，
> 新发现一律记 DESIGN-ISSUES.md。

## 全局守卫链（每个请求都要穿过，除非端点带 Free 装饰器）

装配在 `src/app/app.module.ts` 的 `APP_GUARD`（自上而下执行）：

```
IP → Security(UA/黑名单路径/bot) → Device → Risk(前) → CAP(前) → JWT → Risk(后) → CAP(后) → MFA → Sign(HMAC) → Lock
```

- **Device**：要求签名 cookie `__Host-DEVICE_ID` 且设备行在缓存（`SYS_DEVICE:<id>`）；缓存
  miss 时回源 `sys_device`（locked/banned 落库真值）并回填缓存，查无才 40605；`DeviceFree` 跳过。
- **JWT**：`Authorization: Bearer <AT>`；`JwtFree` 跳过（未登录时 `req.user` 为空）。
- **Sign**：HMAC-SHA256；未登录单因子（key=握手 aesKey），已登录双因子
  （key=HKDF(sha256(sessionKey 的 sha256), salt=aesKey, info=appSettings.cryptoHKDF.API_SIGN)）。
  请求头 `X-Sign / X-Timestamp / X-Nonce(32hex) / user-agent` + cookie `DEVICE_ID / SIGN_TICKET`（缺失时 guard 自动签发）。
  签名原文 `METHOD|PATH(去前缀)|扁平化body参数排序串|timestamp=xx|nonce=xx|ua=xx`。`SignFree` 跳过。
- **CAP**：risk 有评估结果时强制 `__Host-CAPJS_TOKEN` cookie + 有效 token 缓存（`SECURITY_CAP_TOKEN:<deviceId>`）；`CapFree` 跳过。
- **MFA**：已登录且角色非 visitor 时强制 `mfaSetup=true` + 设备级 verified 缓存；`MFAFree` 跳过。
- **Lock**：用户-设备锁定状态；`LockFree` 跳过。
- **权限**（controller 方法级 `@HasPermission`，非全局 guard）：root 角色（COMBINE 首角色或 SWITCH 当前角色）短路放行
  （`permission.guard.ts`：`roleMode === 'combinable' && roleNames[0] === 'root'`，A 段试点已核实成立，
  登录态测试用户只需 PG fixture 造 `sys_role(role_name='root')` junction + `role_mode='combinable'`，免造菜单数据）；
  其余角色查缓存 `AUTH_PERMISSIONS:<userId>:<deviceId>`（由 `GET /auth/permissions` 写入；键缺失直接 40105，
  无懒重建 —— guard 只读缓存）。非 root 的真实链路（菜单→角色→用户→缓存写→读→精确匹配→40105）由
  `permission-chain.api-spec.ts`（I 段）覆盖 —— 权限串推导依据与种子形态见文末「I 段补记」。
- **响应形态**：一律 HTTP 200；成功 `body.code = 20000`，业务/校验错误 `body.code = 4xxxx/5xxxx`（`libs/exceptions`）。
  例外：`@WalnutAdminDecoratorFreeResponse()` 端点（如 cap challenge/redeem）body 无统一响应壳。
- **API 级测试基建**（A 段落地，`test/api/helpers/`）：`create-api-app`（bootstrap 同形装配）→
  `api-client`（设备 initial + CAP challenge/redeem 本地 PoW 求解 + 两步签名握手 + 手工 cookie jar，
  `anon`/`root` 双形态自动算 HMAC）→ `auth-login`（opaque 服务级注册 + HTTP login/start→finish，
  root/MFA fixture）。CAP guard 对任何有风险评估的请求都强制 `CAPJS_TOKEN`（缺 token 一律 40116/40117），
  登录/业务端点都绕不开 —— 助手在引导期完成 challenge→solve→redeem。

## CRUD 标准形态（WalnutCrudDecorators 生成）

`POST /`（create）· `GET /:id`（read）· `PUT /:id`（update）· `DELETE /:id`（delete）
· `DELETE /deleteMany/:ids`（批量删，逗号分割）· `POST /list`（list：`{ query, sort[], page{page,pageSize} }`）

---

## 1. app 模块（`libs/app-domain/src/` + app 侧 `modules/app/monitor/user/` 组合根）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| demo | POST `/app/demo` | Sign+MFA+Lock | `app:demo:create` | `{demoString,demoPhoneNumber,demoNumber,demoBoolean,demoDate,demoEnum,demoMongoId,demoObject}` + 6 个数组字段（见下） | **A 段试点**：CRUD 全闭环 + 400。
  A 段试点抓出两处迁移回归并已修：① schema 的 `demoNumber` 校验残留 Mongo 时代 `precision: 4`（要求小数恰好 4 位），与 phase2 定稿的 integer 列自相矛盾 —— create/update 无任何可用负载，已按列型改 `int: true`；② create/update DTO 的 pick 漏了 6 个 NOT NULL 数组列（phase2 4.20「应用侧必须显式给值」），HTTP create 必撞 NOT NULL，已按定稿补齐 pick（数组校验自带 minSize:1）。
  注意 `demoString` 挂 IsUppercase、`demoStringArray` 挂 IsLowercase + `contains('1')`；list 的字符串过滤是 ILIKE 子串（`%`/`_` 被字面量转义，不能自造通配符） |
| demo | GET `/app/demo/:id` | 同上 | `app:demo:read` | 路由 uuid | **试点**：404 路径 |
| demo | PUT `/app/demo/:id` | 同上 | `app:demo:update` | Partial(create) | **试点** |
| demo | DELETE `/app/demo/:id` | 同上+事务 | `app:demo:delete` | 路由 uuid | **试点**：软删 |
| demo | DELETE `/app/demo/deleteMany/:ids` | 同上+事务 | `app:demo:delete` | 逗号 uuid | **试点** |
| demo | POST `/app/demo/list` | 同上 | `app:demo:list` | `{query,sort,page}` | **试点**：过滤/分页 |
| error | GET `/app/error/:code` | Sign 链 | `app:error:test` | 路由错误码 | **B 段已测**（error.api-spec.ts）：P2-7 已修（2026-10-28）—— ErrorMap 的 40112-40117 与 contract 错误码逐个对齐，spec 对 **ErrorMap 全项**（46 code）断言 body.code 即路由 code；枚举外 code → 40099。 |
| key | GET `/app/key/current/:type` | Sign 链 + `AppKeyCurrentGuard`（仅 RSA_PAIR 校验 `app:key:read`） | RSA_PAIR: `app:key:read`；AES_KEY_URL: 登录即可读 | type∈RSA_PAIR/AES_KEY_URL | **B 段已测**（key.api-spec.ts）：current 返回 version 最大 ACTIVE 行的公开面（RSA 只含 publicKeyPem、AES 含 keyB64）。P0-6 已修（2026-10-28）：①私钥永不出 HTTP（DTO/Safe 层剔除，内部解密走实体通道）；②RSA 视图加 `app:key:read`（无权限用户 40105，permission-chain spec）；AES 视图保持登录可读（admin 前端 URL 掩码的客户端分发密钥）。**swagger 收尾批**（2026-10-29）补 `AppKeyCurrentResponseDTO`（publicKeyPem / keyB64 双形态 optional，wire 零变化） |
| key | POST `/app/key/init` | 同上 + `@HasRole(root)` | 无 | — | **B 段已测**：AES_KEY_URL 空表落首条 v1 ACTIVE；二钻 40001。P2-6 已修（2026-10-28）：JWT_AT 在 DTO 层被拒（40099，系统启动自举，不走 init），不再假成功 20000 |
| key | POST `/app/key/rotate/:type` | 同上 + `@HasRole(root)` + 事务 | 无 | — | **B 段已测**：旧行 DEPRECATED + 新行 version+1 ACTIVE 事务两腿齐落，current 随轮转换人；响应同样不含私钥（P0-6） |
| logger | POST `/app/logger/list`（CRUD list） | Sign 链 | `app:logger:list` | list 形态 | **B 段已测**（logger.api-spec.ts）：fileName/logType 过滤 + 无命中空列表；用例自建自清 `logs/{application,error}/api-spec-*.log`（cwd=apps/server） |
| logger | GET `/app/logger/:logType/:fileName` | Sign 链 | `app:logger:read` | 路由参数 | **B 段已测**：第 1 页命中写入行、越界页空内容、不存在文件 → 受控 50000（ENOENT 兜底）；logType 枚举外 / fileName 穿越 payload → 40099（ParamEnum + 白名单管道，2026-10-27 起；service 层另有 resolve 包含性断言纵深）；fileSize 出参是 `@TransformSizeToKB` 字符串。**swagger 收尾批**（2026-10-29）补 `AppLoggerReadResponseDTO`（fileName/fileContent/filePath） |
| monitor/cache | CRUD（read 按 `key`、delete 按 `key`、list、`DELETE /app/monitor/cache/clear`） | Sign 链 + `@HasRole([root,developer])` | `app:monitorCache:*` | key/uuid | **B 段已测**（monitor.api-spec.ts）：真实 Redis 键（shared 类型）set→read/list/delete→clear；read 出参是真实缓存值 `{value}`（P2-4 已修 2026-10-28，缺失键 value=null）；delete 仍是 fire-and-forget（响应先于 DEL，data 恒空，客户端以 read 复核；断言轮询保留）；clear 只清非 built-in/auth/system 类型（AUTH 的 MFA verified 键幸存），故 clear 用例放文件最后 |
| monitor/server | GET `/app/monitor/server/{cpu,mem,os,sys,disk,battery,time,network}` | Sign 链 | `app:monitorServer:*` | — | **B 段已测**：八个只读端点形状冒烟；mem 出参是 `@TransformSizeToGB` 字符串（`x.xx GB`）；无电池主机 battery 字段可空。**swagger 收尾批**（2026-10-29）补 8 个轻量 DTO（只文档化 service 逐字段投影的 systeminformation 子集，wire 零变化） |
| monitor/user | CRUD list/read + DELETE `force-quit/:id` + POST `state`（Sign/Jwt/Cap/DeviceFree，socket 在线状态上报） | Sign 链 | `app:monitorUser:*` | list/uuid；state 为匿名 | **B 段已测**（monitor-user.api-spec.ts）：state 匿名上报 upsert（auth=false 置空 userId）+ list/read populated + force-quit 撤销 RT 落库（revoked）+ read 40401 + force-quit 无行 20000+false + 非法 uuid 40002 + state 非法 body 40099（P1-4 已修 2026-10-27：过滤器对 skip 名单只跳过错误记录、响应恒落盘，不再悬挂）。
  **P2-31 已修（2026-10-29）**：已存在行收到 `auth=false` 时显式 `SET user_id = NULL`（旧实现 null 被 nil 过滤丢弃，残留上次登录用户直到 cron）；spec 覆盖「登录 → 登出上报 → user_id 为 null + read 不装回 user」 |
| setting | GET `/app/setting/public` | Lock/Sign/Jwt/Cap/Device 全 Free | 无 | — | **B 段已测**（setting.api-spec.ts）：匿名 unsigned 可达，auth/frontend 全布尔形状 |
| setting | GET `/app/setting/private` | LockFree | 无（需 JWT） | — | **B 段已测**：登录态 20000（maskUrl 等四组形状）；匿名 40101。swagger 无 response schema —— 收尾批保留为 admin store 消费形态（`IStoreSetting.Scope`），登记为前端变换层形状 |
| setting | CRUD + POST `cache/refresh` | Sign 链 | `app:setting:*` | setting DTO | **B 段已测**：CRUD 全闭环 + cache/refresh 后 `getAppSettings()` 可读到本轮自建 key（写设置全局生效路径）；自建 `api-spec-*` 行、afterEach/afterAll 删行后重 extract 还原 `APP:SETTING` 缓存，不动 seed 行 |

## 2. auth 模块（`modules/auth/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| 会话 | GET `/auth/permissions` | Sign 链 | 无 | — | **D 段已测**（auth-session.api-spec.ts）：root 权限树含自建 MENU 行（响应顶层是「首个根节点的 children」——单根无子级时顶层数组恒空，须造 CATALOG+MENU 两行）+ AUTH:PERMISSIONS 缓存键写入可复现 + 匿名 40101。
  **前端消费契约（P3-4 裁决 2026-10-28）**：`permissionMenuTree` 恒为「首个根节点的 children」数组（不是完整根数组）；单根无子级时为空数组，admin 菜单/首页装配按此形状消费，服务端不改形。
  **空表边界钉现状**：sys_menu 空表时 indexMenuName 组装在 `permissionMenuTree[0].children` 上 TypeError → 50000（Mongo 时代同病，spec 靠自建菜单行绕开） |
| 会话 | POST `/auth/signout` | SignFree+DeviceFree | 无 | — | **D 段已测**：RT 行全量 revoke（revoke-and-insert 时代同维度多行，update where userId+deviceId 撤干净）+ `__Host-RT_JTI` cookie Expires 归零 + after-commit 清 permissions/MFA verified 缓存（轮询）+ 旧 AT 再请求 40115（MFA verified 缓存已清，MFA guard 在 Sign guard 之前先拦）。
  **钉现状（非迁移回归，登记）**：AUTH:SESSIONS 键残留 —— revokeSession 走 cacheService.delByPattern，内部 redis.del(数组) 在 node-redis v5 rest-args 语义下抛错（C 段 user-device/monitor spec 同款已知问题），钩子错误被 catch 吞掉 |
| 会话 | GET `/auth/keys` | Sign 链 | 无 | — | **D 段已测**：响应 B 字段是 EncryptResponse 设备握手 RSA 信封（与 aes-key 握手第二步同格式），客户端私钥（api-client 新增 `clientRsaPrivateKeyPem`）解密还原 vendor.baidu 明文。**swagger 收尾批**（2026-10-29）补 `AuthSecretKeysResponseDTO`（B 为信封字符串） |
| opaque/user | POST `/auth/opaque/user/login/start` | JwtFree（Sign 生效：单因子） | 无 | `{userName,start}` | **基座核心**：真实 opaque 登录前半段。
  A 段试点抓出迁移回归并已修：handler 用 `@WalnutTxSession()` 取 ctx.em 但漏挂 `@WalnutTx()`，txContext 恒 undefined → 匿名调用必 500；已对齐 login/finish 形态补上事务装饰器 |
| opaque/user | POST `/auth/opaque/user/login/finish` | JwtFree + `AuthOpaqueUserGuard`(passport-local userName/finish) | 无 | `{userName,finish}` | **基座核心**：签发 AT/sessionKey + RT cookie |
| opaque/user | POST `/auth/opaque/user/login/client-error` | JwtFree | 无 | `{userName,clientError(枚举)}` | **E 段终审补测**（opaque-admin.api-spec.ts）：上报恒 40103 InvalidCredential（含失败 log_auth 落库）；clientError 枚举外 → 40099 校验拒绝 |
| opaque/user | POST `/auth/opaque/user/register/{start,finish}` | JWT 生效（无 Free；未登录 40101） | 无 | opaque 消息 | **D 段已测**（opaque-admin.api-spec.ts）：P1-14 已修（2026-10-28）—— 语义定为「已登录用户补挂口令」，finish 按 `req.user.userId` upsert password identity（存在替换 value/valueHash、不存在建，不建用户、不查重抛 40001）；登录态 start/finish 闭环 20000、再补挂仍成功且行恒一条；匿名 40101。新用户注册走 OTP 链（concurrency G2 已改为「同用户并发补挂」用例） |
| opaque/user | POST `/auth/opaque/user/change-password/{start,finish}` | Sign 链 | `me:auth:opaque:changePassword` | opaque 消息 | **D 段已测**（opaque-admin.api-spec.ts）：me 通道真实 opaque 两步改密（服务级 finishRegistration 出 record）→ identity value/valueHash 整体替换 + security-policy 全设备 RT 吊销（revokeReason=updatePass）；旧密码客户端 finishLogin 失败、新密码 login/finish 换发成功。**P2-32 已修（2026-10-29）**：security-policy 在 after-commit 里按用户维度清 `AUTH:SESSIONS`（全设备）/ `AUTH:PERMISSIONS:<user>:*` / `AUTH:MFA:VERIFIED:<user>:*`；用例升级为双设备真实验证（两台设备旧 AT 均立即 40101、三键逐个核对已清） |
| opaque/admin | POST `/auth/opaque/admin/password/update/{start,finish}`、`password/clear` | Sign 链 | `system:user:pass:update` / `clear` | `{id,...}` + opaque 消息 | **D 段已测**（opaque-admin.api-spec.ts）：root 给目标用户改密（按 user 主键 id 定位，真实 opaque 客户端两步）→ identity 替换 + 目标全设备 RT 吊销 + 不存在 id 40000；password/clear 删 password identity、幂等（无行再删恒 true）、清后 login/start 40103 |
| otp | POST `/auth/otp/send`、`verify` | JwtFree + Functional（settings 缺省放行） | 无 | `{type,identifier,...}` | **D 段已测**（otp.api-spec.ts）：缺省配置（OtpSettingService 兜底 sendEnable=0/authEnable=0）→ send/verify 各自 functional guard 50301 EndPointUnavailable（码缓存不落）；种 APP:SETTING 缓存开 email 后 send → 真码落 `AUTH:VERIFY_CODE:visitor:<identifier>`（邮件走 Bull 队列不真发）→ verify 错码 40000、对码换发令牌 + `__Host-RT_JTI` cookie + identity 标记 verified + 码缓存删除 + AUTH:SESSIONS 键落（换发会话可用性另以 security-tab2 探针双因子验证）；type 非法 40099。**P1-16 已修（2026-10-28）**：动态限流元数据键统一为共享 Symbol，`sendLimit/sendTtl` 真实生效（spec：sendLimit=2 时第三次 42900，Retry-After 反映动态 blockDuration）。
  **注意**：JwtFree+Sign 生效路由对登录态 jar 的 anon() 双因子签名一律 40112 —— 闭环请求发在未登录独立客户端（helpers 新增 `overrideAppSettings` 缓存改写+还原） |
| refresh | POST `/auth/refresh` | Lock/Sign/MFA/Jwt/Device 全 Free + `JwtRefreshGuard`（RT cookie） | 无 | — | **D 段已测**（auth-session.api-spec.ts）：RT cookie → 新 AT；轮换是 **revoke-and-insert**（2026-10-27 终态：旧行置 `revoked=true (reason=rotate)` + INSERT 新行，响应 Set-Cookie 回种新 jti；同维度多行为常态）；新 AT 与旧 AT 同 sid。
  **P0-1 已修（两轮迭代）**：第一轮（2026-10-26）轮换锁内比对「入口时刻 encrypted_token 快照（guard 挂
  `request.realRefreshTokenEncrypted`，已随终态方案摘除）vs 库中当前值」—— 只挡真正同时到达的请求，
  错峰到达实测出过 2×20000，已被取代。终态（2026-10-27）revoke-and-insert：旧 jti 行级作废，重放/
  错峰请求在 guard 撤销判定或轮换锁内撤销判定被拦，恰 1 路成功确定性成立（concurrency G1 五路连跑
  3 次稳定）；HTTP 层顺序重放（旧 jti cookie 再 refresh）→ 40102（auth-session spec）。根因与取舍
  见 DESIGN-ISSUES P0-1。
  **迁移回归已修**（D 段唯一一处 src 改动）：无 RT cookie 时 guard 直取 cookie 值 undefined 传入 findByJti —— Mongo 版 findOne({jti: undefined}) 查无行 → 受控 40102；PG/TypeORM 把 undefined 当绑定参数下发 → pg 驱动 "bind parameters must not contain undefined" 未受控 50000。已在 `refresh.repo.service.findByJti` 按「查无此 jti」语义收 nil → null |
| mfa | GET `/auth/mfa/status`、POST `/auth/mfa/verify` | MFAFree+LockFree | 无 | verify `{trusted}` | 高优先（MFA 闭环：绑定 totp → verify → 新 AT）—— verify 的 RT 轮换闭环已由 C 段 user-mfa spec（system/user/mfa/totp/verify）覆盖。**P2-24 已修（2026-10-29）**：`/auth/mfa/verify` 的就绪判据改为用户维度已启用类型数（`COUNT(DISTINCT type)`，跨设备去重），与 cron 的 `updateMfaSetupStatusForCronJob` 同源；int-spec `user.mfa.pg` 覆盖「两台设备各一个 webauthn → typeCount=1」与停用后回落 |
| google | POST `/auth/google`（勘误：callback 路由不存在——初版测绘把 strategy 层 callbackURL 误记为 HTTP 端点） | Jwt/Sign Free + Functional（P1-17 起 `defaultClosed`）+ `AuthGoogleGuard` | 无 | google id_token | **D 段已测**（external-oauth.api-spec.ts，错误路径专项）：P1-17 已修（2026-10-28）—— 端点暂时关闭，零配置（settings 缺失）即 50301；显式 authEnable=1 开启后 garbage credential 走本地 JWKS 校验失败 40107（不发外网）。真实 Google id_token 回调不测（外部依赖） |
| oauth/gitee | GET `/auth/oauth/gitee/url`、GET `/auth/oauth/gitee/callback` | Jwt Free + Functional（callback 另 SignFree + `OAuthGiteeGuard`） | 无 | query code | **D 段已测**（external-oauth.api-spec.ts）：functional 关闭 50301；开启 `/url` 构造跳转 URL 形态（authorize + client_id + redirect_uri 原样拼接不转义 + response_type + scope + state JSON{fp,lang}）；callback 缺 code → **受控 40000**（P3-3 已修 2026-10-28：guard 前置校验，不再 302）。真实 gitee code 回调不测（外部依赖） |
| oauth/github | 同 gitee（`/auth/oauth/github/*`） | 同上 | 无 | query code | **D 段已测**（external-oauth.api-spec.ts）：同 gitee 同构（scope=read:user user:email）；callback 缺 code 同 P3-3 → 受控 40000。真实 github code 回调不测（外部依赖） |

## 3. security 模块（`modules/security/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| sign | POST `/security/sign/initial` | Sign/Cap/Jwt/Lock/Device/Ip 全 Free（Risk 仍跑） | 无 | `{rsaPubKey,force?}` | **基座核心**：握手第一步 |
| sign | POST `/security/sign/aes-key` | 同上（响应 aesKey 经客户端 RSA 加密） | 无 | — | **基座核心**：握手第二步（客户端私钥解密）。**swagger 收尾批**（2026-10-29）补 `SecuritySignSessionKeyResponseDTO`（aesKey 文档标注为 RSA 信封字符串） |
| rsa | GET `/security/rsa/public-key` | Sign/Jwt/Cap Free | 无 | — | **D 段已测**（security.api-spec.ts）：返回 app_key 表 current RSA_PAIR（version 最大 ACTIVE 行）meta.publicKeyPem —— 自插高 version 目标行做数据自洽（与 app_key.int-spec / key.api-spec 双向隔离，afterAll 清行还原） |
| cap | POST `/security/cap/challenge`、`/security/cap/redeem` | Cap/Jwt/Device/Lock Free（challenge/redeem 另 SignFree） | 无 | challenge/redeem payload | **D 段已测**（security.api-spec.ts）：FreeResponse 无响应壳 —— challenge 回 cap.js `{challenge:{c,s,d},token,expires}`，redeem 本地 PoW 对解 success:true、错解 success:false（helpers 求解器与 api-client 引导期同源） |
| sensitive | GET `/security/sensitive/check`、POST `/security/sensitive/verify` | Sign 链（`SensitiveGuard` 方法级） | 无 | verify `{level,operationType?,method,credential}`（P3-17 订正） | **D 段已测**（security.api-spec.ts）：P1-5 修复后 —— ① 缺 security 身份探测腿容错跳过，无可用方式 → 40000 noVerifyMethodAvailable；② 造 email/phone security 身份后 check 列 sms/email（password 已摘除、mfa 未实现不列）、首选 sms；③ email 错码 40000 不授权、对码授权 basic 键；④ password/mfa 通道 → 40000 verifyMethodNotAllowed。**K 段 G6 补**：basic 授权不放行 account_critical（40119），verify account_critical 后 `PUT identity status` 20000 且 status 落库。**P2-25 补**：operation 枚举新增 `identity_manage`（account_critical 覆盖 email/sms），供 identity update/unbind 使用 |

## 4. shared 模块（`libs/app-domain/src/shared/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| ali | GET `/shared/ali/sts` | Sign 链 | `app:shared:ali:sts` | — | **D 段已测**（shared-ali.api-spec.ts）：实现是 env `vendor.ali.OSS` 凭证直连阿里云 STS assumeRole —— env 配了 key 就发真实外网请求，结果取决于外部服务（凭证有效性/网络），不可脚本稳定。钉两端受控形态：成功 → 20000 + 三敏感字段（accessKeyId/accessKeySecret/stsToken）为 EncryptResponse 握手 RSA 信封（客户端私钥可解）、region/bucket 与 env 一致；失败（凭证无效/网络不可达）→ SDK 异常未映射受控异常兜底 50000。两态断言 body.code ∈ {20000, 50000}。**swagger 收尾批**（2026-10-29）补 `SharedAliOSSDTO` 响应引用（三敏感字段文档标注 RSA 信封字符串） |
| area | GET `/shared/area/children`、`/shared/area/feedback` | Sign 链 | `system:area:*` | query（父级行政区划） | **B 段已测**（area.api-spec.ts）：集成库 shared_area 为空表，自建 95→9501→950102 三级行（与 int-spec 的 91/77 数据集无交集）；children 冷态回源 + 层级缓存（SHARED:AREA:*，跑前清跑后清）+ feedback 单码/多码回显树（depth/isLeaf）+ 匿名 40101 + 缺 codes 40099。
  **迁移回归已修**（repo.findChildrenByPcode 投影普通对象，对齐 Mongo `.lean()`）：原 TypeORM find 返回无 @Expose 实体，被全局 ClassSerializer（excludeExtraneousValues）在 HTTP 出站剥成 `[{}]`——缓存未命中的冷路径整层丢字段（热路径因 Redis JSON 往返侥幸幸存，service 层 int-spec 不可见），详见 area.api-spec.ts 头注 |

## 5. system 模块（`modules/system/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| lang | CRUD 四件（无 delete）+ GET `/system/lang/list/public` | CRUD：Sign 链；public：Lock/Sign/Jwt/Cap/Device 全 Free + 响应缓存 | `system:lang:*` | `{lang,description,order,status}` | **A 段试点**：CRUD + public 端点（缓存装饰器路径）；P2-5 已修（2026-10-28）：create/update 经 after-commit 失效 `SYS_LANG_LIST_PUBLIC`，响应返回后 public 立见新值。**P2-17 已修（2026-10-29）**：同一 after-commit 通道再重算 `SYS_LANG_ID_LIST` 与 `SYS_LOCALE_MESSAGES`（改 lang 代号时清旧代号 messages 键）—— lang spec 覆盖「新建语言后立即可写翻译（不再 40099）」与「改代号后旧键消失、新键含翻译」。**swagger 收尾批**（2026-10-29）补 public 响应 `SysLangDTOListPublicResponse[]`（order/lang/description 三列 raw 投影） |
| locale | GET `/system/locale/message/:locale?cache=1` | Lock/Sign/Jwt/Cap/Device/Ip 全 Free | 无 | 路由 locale | **A 段试点已覆盖**：message 拉取 + 缓存开关。
  缓存语义已钉现状：locale create/delete 事务提交后全量刷新 message 缓存（runAfterCommit → extractLocaleMessagesIntoCacheForCronJob，会顺带写 `SYS_LANG_ID_LIST`）；绕过 HTTP 的 PG 直插不触发刷新，cache=1 读旧缓存、cache=0 回源 |
| locale | POST `/system/locale`（数组批量 create）、`GET /:key`、`PUT /:id`、`DELETE /:key`、`DELETE /deleteMany/:keys`、`POST /list` | Sign 链 + 事务 | `system:locale:*` | 数组 `{langId,key,value[,oldKey]}` | **A 段试点**（创建/更新/删除走真实事务） |
| dict/type | GET `/system/dict/type/s` + CRUD | Sign 链 | CRUD `system:dict:type:*`；`s` **无**（登录即可读，P2-20 登记豁免） | dict DTO | **C 段已测**（dict.api-spec.ts）：CRUD + list 附 `dictDataCount` 计数子查询 + `s` 端点按 type 批量回启用 data（order 升序、未知 type 跳过）。
  **P2-20 登记（2026-10-29）**：`s` 是登录用户的公共字典通道（只回启用行/启用 data，非管理面），显式登记为设计豁免；permission-chain spec 覆盖 visitor 与普通非 root 均 20000。CRUD 权限串实际前缀是 `system:dict:type:*` / `system:dict:data:*`（旧文写 `system:dictType:*` 已更正）。
  **级联软删（P2-8 已修 2026-10-28）**：dictType 的 HTTP delete 在同一事务内先逐行软删关联 dictData（各落 `SYS_DICT_DATA` 快照），再快照 + 硬删 type 行 —— DB CASCADE 无行可清，回收站可先恢复 type 再恢复 data |
| dict/data | CRUD | Sign 链 | `system:dictData:*` | dict DTO | **C 段已测**：CRUD + 软删快照 + read 40401。
  **无 deleteMany 路由**（Permissions.DELETE_MANY 常量存在但装饰器未接线 → 40400，钉现状）；update 的 DTO 字段全量必填（tagType 漏给 → 40099） |
| menu | GET `/system/menu/tree` + CRUD（delete 带 `?cascade=` query） | Sign 链 | CRUD `system:menu:*`；tree **visitor 拒绝**（P2-20） | menu DTO | **C 段已测**（menu.api-spec.ts）：meta 拍平出入参往返（19 列组装/回填默认值）+ pid 自引用建树 + `?_cascade=` 两态（=1 额外按 title 级联软删 locale，非删子菜单；pid FK RESTRICT）+ tree 形态（fullTree 只回首根 children、treeWithoutTypeElement 走完整根数组、空表 `fullTree[0].children` TypeError 50000 不进回归）。
  **P2-20 已修（2026-10-29）**：`tree` 挂 `@WalnutAdminDecoratorVisitorDeny`（switchable + current_role=visitor → 40105）；普通非 root 用户保持可用（菜单管理/角色授权视图的数据源，导航数据来自 `/auth/permissions` 不受影响）。permission-chain spec 覆盖 visitor 40105 + 普通非 root 20000。
  **迁移回归已修**（C 段唯一一处 src 修复）：`flattenSysMenuMeta` 未给键判据原为 `=== undefined`，但 HTTP 入参经 ValidationPipe 深度实例化（meta 挂 @Type）后部分 meta 的未给键是**显式 null** → is_show 等非空列收到 NULL 撞 NOT NULL 约束，HTTP create/update 带部分 meta 必 50000；已改 `??`（null/undefined 都回填 schema 默认值，对齐 Mongo 子文档语义）。service 层 int-spec（B5 menu.role.pg）传的是纯对象不可见，只有 HTTP 层能抓到 |
| role | CRUD 四件（无 deleteMany；无 delete —— **P3-7 裁决「角色不删」是明确设计约束**，停用走 update status） | Sign 链 | `system:role:*` | role DTO | **C 段已测**（role.api-spec.ts）：menus 赋值落 sys_role_menu junction（create 缺省=空数组、update 未给=junction 不动、给了=delete+insert 整组替换）+ read/list 的 usersCount + root 守卫（create 拒 root/developer、update 拒 roleName=root 与根角色行）+ `findRolesWithPopulatedMenus` 形态（status 过滤 + menusList 组装 meta） |
| user | CRUD + 状态管理 | Sign 链 | `system:user:*` | user DTO | **C 段已测**（user.api-spec.ts）：create roles 必填（给 [] 时 junction 空 + currentRole 走 defaultRole 兜底）、safe role id 拦截、update 启停/roles 整组替换、delete 拒自己与 safe user、list 字段面裁剪 + `me/role/switch`（行值 COMBINE 拒 40000）与 `me/roleMode/switch`（switchable↔combinable 落库、非法枚举 40099）+ opaque admin `password/clear`（删 password identity、幂等恒 true）。
  **P2-19 已修（2026-10-29）**：`me/role/switch` 准入改按用户行值 `role_mode`（与 AT payload / permission guard 同源）；spec 覆盖「零配置（effective=GLOBAL/combinable）下 switchable + junction 双角色 → 切换成功并落 current_role_id」。
  用户名重复 → DB 23505 未映射受控异常，兜底 50000（钉现状） |
| user/me | PUT `/system/user/me/profile`、GET `security-tab2`、GET `profile` | Sign 链 | `me:profile:update` 等 | — | **C 段已测**（user-me.api-spec.ts）：GET profile roles_list、PUT profile 持久化 + 40099（缺必填/越枚举）、security-tab2 双通道形状（totp 行 SQL 直插对拍 verified/status 语义）、匿名 40101。security-tab2 的 swagger 已补 `SysUserMeSecurityTab2ResponseDTO`（2026-10-29，P3-12；admin 改用生成类型 `MeSecurityTab2Status`） |
| device | POST `/system/device/initial`（Sign/Jwt/Cap/Device Free + Throttle）+ GET `:id/current-active-user`、`:id/history-users` + PATCH `:id/{lock,unlock,ban,unban}` + read/list | Sign 链 | `system:device:*`（AND 模式组合） | uuid + PATCH | **C 段已测**（device.api-spec.ts）：initial 同指纹幂等回同 deviceId（upsert 覆盖 deviceName）+ 新指纹新行（裸 supertest 发，避免 cookie jar 吃下第二台设备的 DEVICE_ID 重签导致 CAP 40116 串台；Throttle 4/60s 压线）+ 重名 device_name（23505）→ 受控 40000（P3-2 已修 2026-10-28，其余异常仍 40605）+ read/list（`:id` 是行 uuid 非业务键；sr/vp 组装回嵌套；current-active-user 空态回 null 填充壳）+ lock/unlock/ban/unban **落库 + 缓存双写**（P2-2 已修 2026-10-28：DB 为真源，清缓存后 guard 回源库、锁/封仍 40606/40607）+ history-users 返回绑定用户（P2-3 已修 2026-10-28：sys_user_device 行即绑定历史，按 lastActiveAt 降序）。
  **Throttle 前端契约（P3-1 裁决 2026-10-28）**：超限响应是 **HTTP 200 + body.code 42900**（统一响应壳），不是原生 HTTP 429 —— 前端限流提示按 body.code 分支，`Retry-After` 头仍给出剩余秒数。
  **swagger 收尾批**（2026-10-29）：initial 响应补 `SysDeviceDTOInitialResponse`（deviceId + 可选经纬度/countryCode，按 wire 事实收窄，旧 IntersectionType 声明过 country/region/city/timezone 等从未下发的字段） |
| deleted | read/list + `POST me/recover`、`POST recover`（recover 系另有 `@HasRole([root,developer,admin])`） | Sign 链 | `system:deleted:*`（me/recover = `system:deleted:recover:mine`，管理端 recover = `system:deleted:recover`；P3-21 已接线 2026-10-28） | uuid/ids | **D 段已测**（deleted.api-spec.ts，B9 int-spec 已盖 service 层，此处 HTTP 层复刻核心三态）：demo create → HTTP delete 软删 → read（快照 content/modelName/deletedBy + user toMatchObject——read 面带额外 null 键）/ list（content ::text 关键字过滤 + total，出参不带 content）→ recoverMine 属主恢复（原行回来 + sys_deleted 行同事务消失）→ 管理端 recover（root 短路 @HasRole）→ deletedId 不匹配两态（recoverMine 40401 双键定位不命中 / recover 40000 recoverFail）→ deleteMany（deleteReal）硬删快照、原表不回来。
  **P2-22/P2-23 已修（2026-10-29）**：user 快照恢复联动 oauth 绑定；menu / dictData / dictType 的组合恢复器重放级联软删的 locale（dictType 连同 dictData）。spec 覆盖「user+oauth 快照 → recover → oauth 行恢复」与 menu/dict 两族级联恢复。
  **注意**：demoString 挂 IsUppercase（uuid 片段 hex 抬大写）；deletedBy 是 uuid 列不走模糊白名单，列表过滤走 content 关键字 |
| log/auth | CRUD delete/deleteMany/list（`@UseGuards(JwtAccessGuard)` 显式重复挂） | Sign 链 | `system:logAuth:*` | list | **D 段已测**（log-auth.api-spec.ts）：日志行由真实登录链自然产生（beforeAll opaque HTTP 登录产成功行；未知 userName 的 login/start 产失败行——recordAuth fire-and-forget，断言轮询）→ list（deviceId 过滤 + type 数组过滤命中/空命中 + 分页）+ 行字段面（成功行 userId/userName/type=opaque、失败行 userId/userName 双 null、msg 为 i18n 文案）+ delete（软删 → sys_deleted 快照 SysLogAuthModel）+ deleteMany + 不存在 id 40401 |
| log/operate | GET `:id/device`、`:id/snapshot`、read、list | Sign 链 | `system:logOperate:*` | uuid | **D 段已测**（log-operate.api-spec.ts）：日志行由 dictType create/update（CRUD 装饰器自带操作日志）自然产生，拦截器 `void insertToLogOperate` fire-and-forget 断言轮询 → list（deviceId 过滤 + 分页）+ 行字段面（title/actionType/method/statusCode/success/userId/os/browser/requestData jsonb）+ `:id/snapshot`（pg-base.update 的 ALS 快照两腿 before/after name 翻转）+ `:id/device`（deviceId 业务键反查 sys_device 组装回嵌套）+ read（Safe DTO 无快照列）+ 不存在 id 40401（read/snapshot 同型）。
  **钉现状**：CRUD update 装饰器只传 title/action → operation 列恒 null。
  **P2-29 已修（2026-10-29）**：`sys_deleted.log_operate_id` 回填事件改走 `runAfterCommit`（事务提交后才发），仓库侧更新条件补 `log_operate_id IS NULL`（历史快照不覆盖）。int-spec `log.bypass.pg` 覆盖「钩子队列未执行前不落库」与「已有 logOperateId 的历史快照不被新日志改写」 |
| user_device | GET `list`、PUT `update-name/:deviceId`、DELETE `force-quit/:deviceId`、PUT `lock/:deviceId`、`unlock/:deviceId` | Sign 链 | `system:userDevice:*` | — | **C 段已测**（user-device.api-spec.ts）：list（登录绑定行 current=true + deviceType/location 装回）+ update-name 持久化 + lock/unlock（建 sys_user_lock 偏好行、lockRoute 落 DB 默认空对象、cross_device 默认 true → 锁后 Lock guard 40118，端点间清 SECURITY_LOCK 缓存衔接）+ force-quit 撤 RT（revoked + userKickOther；updateRevokedAndReason 走 findOne 只撤第一行，钉现状）+ 无 monitor 行 40401 |
| user_identity | POST `list`、GET `status/:purpose`、POST `check/bind`、DELETE `unbind`、PUT `update/status`、POST `send-code/verify`（均 `/:type/:purpose`） | Sign 链；`update` / `unbind` / `status` 另挂 Sensitive(`account_critical`) | （me 自维度，多数无 @HasPermission） | — | **C 段已测**（user-identity.api-spec.ts）：OTP 真实闭环（check 发码进 AUTH:VERIFY_CODE 缓存 —— 邮件走 Bull 队列测试环境不真发；用例从缓存读回真码 bind）+ status 形态/maskedValue + unbind（有 password 兜底可解）+ value 被他人占用拦截（第二 root 用户对拍）。
  **P1-5/P1-6 已修（2026-10-28）**：list 空 DTO、bind setAsSecurity 缺省、update 的 null 判据、update/status 探测腿容错（有 security email 身份即可抛 40119）均已处理。
  **P2-25 已修（2026-10-29）**：`PUT update` 与 `DELETE unbind` 挂 `account_critical` 敏感守卫（operation `identity_manage`，支持 email/sms 验证）—— 未授权调用 → 40119；update 不再能绕过 status 的守卫直接改启停；unbind 的 keep-one 判据把 password 纳入（仅口令用户解绑 password → 40000）。spec 覆盖两路径 40119 + 授权键存在时成功 + 仅口令 keep-one |
| user_lock | GET `read` + PATCH（lock/unlock me）+ PATCH `preference` | read/lock/unlock：LockFree；preference：登录态（非 LockFree） | 无 | — | **C 段已测**（user-lock.api-spec.ts）：两套默认值对拍（无偏好行 service 兜底 lockIdleSec=300/crossDevice=false；首次 lock 落行后 DB 默认 lockIdleSec=600/crossDevice=true → read 走跨设备腿）+ lock/unlock 落 sys_user_device.locked + 无偏好行 unlock 40401。
  **P2-26 已修（2026-10-29）**：新增 `PATCH /system/user/lock/preference`（`lockMode` / `lockPwdHash` 明文入参走仓库 bcrypt / `lockIdleSec` / `lockSecuritySec` / `lockCrossDevice`）；`lockMode=security` 写入需密码，unlock 在 security 模式下密码必填并比对。spec 覆盖 security 设置（hash 落库）+ 跨设备解锁缺密/错密 40000、对密成功 |
| user_mfa/totp | POST `generate/bind/verify`、DELETE `unbind`、PUT `status`（status 端点挂权限 `system:user:mfa:totp:status`） | MFAFree+LockFree | 大多无 | totp payload | **C 段已测**（user-mfa.api-spec.ts）：totp 真实闭环（generate 拿真 secret → otplib 同库客户端算码 → bind → verify RT 轮换取新 AT → status 开关 → unbind；备份码 10 枚 + secret/qrCode 形状；bind 后 generate 重入 40001）+ security-tab2 跨验。
  **P3-23 已修（2026-10-29）**：备用码存储改为 `SHA-256(固定域:userId:code)` 确定性哈希再逐项 AES-GCM 加密；`verify` 端点复用为备用码通道 —— 6 位数字先 TOTP、失败回落备用码（命中即消费、一次性；列表空置 `status=false`），响应与 TOTP 成功同形态（RT 轮换 + 新 AT）；错误统一 40000 `verifyCodeError`。spec 覆盖：正确备用码 20000 → 二次同码 40000、错误备用码 40000、TOTP 仍成功、DB `cardinality` 10→9→8。旧绑定（随机盐 HMAC）不可解密 → **需 unbind 后重新 bind**。
  bind 后 verify 的 RT 轮换会更新 RT_JTI cookie（客户端 jar 原样回传） |
| user_mfa/webauthn | POST `register/{options,verify}`、`authenticate/{options,verify}` | MFAFree+LockFree | 无 | webauthn payload | **C 段已测**（user-mfa.api-spec.ts，仅形状/错误路径）：register/options 公钥选项形状（rp/user/challenge/alg/excludeCredentials）+ authenticate/options 无凭证 40400 + authenticate/verify 无 challenge 缓存 40000 + register/verify 带 garbage response（challenge 在 TTL 内）→ **受控 40000**（P3-5 已修 2026-10-28：simplewebauthn 异常统一包装）。正向 register/verify 需浏览器凭证，不进回归。**swagger 收尾批**（2026-10-29）：options 从 `{ [key:string]: unknown }` 改为按 simplewebauthn PublicKeyCredential*OptionsJSON 逐字段文档化（字符串枚举收窄），admin 可直接喂 startRegistration/startAuthentication |
| user_oauth | `@Controller('system/user/oauth')` 无方法（空壳） | — | — | — | 无端点，标注不测（C 段复核维持） |
| user_preference | GET `read`（Lock/Sign/MFA/Device/Ip Free）+ PATCH `{basic,accessibility,theme,layout}` | Sign 链 | `me:preference:*` | — | **C 段已测**（user-preference.api-spec.ts）：read 默认形态（CVD 默认 'default'）+ 匿名同可达（JwtOptional）+ 四段 PATCH upsert（ON CONFLICT 只回写携带列，basic.locale 跨段不丢）→ read 断言持久化 + 40099（locale/fontSize 越枚举） |

## 6. techniques 模块（`modules/techniques/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| health | GET `/app/health/{network,postgres,memory-heap,memory-rss,disk}` | Sign 链 | `app:health:*` | — | **B 段已测**（health.api-spec.ts）：postgres 断言 up（迁移回归直接验证）；memory-heap/rss/disk 断言受控二值（20000 + indicator status up/down——本仓库 terminus 不抛 503；或超阈兜底 50000）。出参形状实测只有 indicator 键、无 `{status,info,details}` 外壳。network 外连 baidu.com，外部依赖不进回归（只登记不测） |

## 7. 根 controller（`src/app/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| app | GET `/`（DeviceFree+JwtFree）、`/auth`、`/deps` | 其余全局链仍跑 | 无 | — | **B 段已测**（health.api-spec.ts）：`/` 匿名单因子签名可达 + 缺签名头 40112；`/auth`、`/deps` 登录态 20000 / 匿名 40101。
  **勘误**：`/deps` 返回的是 package.json 依赖清单（`getPkgDeps`），不是 PG/Redis 连通状态——原记录与本表来源核对时不符，已按实现修正。
  **swagger 收尾批**（2026-10-29）：`/deps` 补 `AppBackendDepsResponseDTO`（dependencies/devDependencies 为 `additionalProperties: { type: 'string' }`）；`/auth/keys` 补 `AuthSecretKeysResponseDTO`（见 §3 会话行） |

---

## 汇总

- **controller 数**：45（含 1 个空壳 `system/user/oauth`）。
- **端点数**：约 150（CRUD 工厂展开后）。
- **守卫形态分布**：全公开（全 Free）约 10 个；匿名握手/登录类（JwtFree+Sign 生效）约 12 个；登录态（全链 + 权限点）约 128 个。
- **外部依赖端点**（API 级只测错误路径或跳过）：google / gitee / github 的 callback（真实 OAuth code 不可脚本获得）、webauthn register/authenticate verify（浏览器凭证）。
- **A 段试点**：`app/demo`（标准 CRUD 模板）+ `system/lang` + `system/locale`（含公开 message 端点、批量数组 create、按 key 删除三种非标形态）——
  三份 `*.api-spec.ts` 已落地 `test/api/` 并入 `pnpm test:integration`（23 用例，describe 级握手+登录一次）。
  lang public 端点（`@WalnutAdminDecoratorCache`）的失效通道已补（P2-5 已修 2026-10-28：
  lang create/update 经 after-commit 删缓存键，响应返回后立见新值）。
- **C 段**：§5 system 模块主体（dict/menu/role/user 系 + device 系 + me 系共 11 份 spec、87 用例）已落地，
  基线 236 → 323；未覆盖余量：`deleted`（回收站 read/list/recover）与 `logs`（logAuth/logOperate）两系。
- **D 段**：§2 auth 会话链（permissions/refresh/signout/keys）+ opaque 管理端/me 通道改密 + otp + §3 security
  （rsa/cap/sensitive）+ §4 shared/ali + 外部 OAuth 错误路径 + §5 的 deleted/log_auth/log_operate 共
  9 份 spec、46 用例已落地，基线 323 → 369。
- **G+H 段**：并发/锁专项 + API 级事务回滚直测共 2 份 spec、9 用例已落地，基线 404 → 413；
  设计问题清单收编至 [DESIGN-ISSUES.md](./DESIGN-ISSUES.md)（P0 × 5 ｜ P1 × 12 ｜ P2 × 8 ｜ P3 × 7）。
- **I 段**：真实权限链路专项（1 份 spec、7 用例 + 种子助手 `seed-permissions.ts`）已落地，
  基线 414 → 421 —— 权限链路从 root 短路绕行改为真实链路覆盖；推导链实测结论与
  COMBINE 默认失效登记见文末「I 段补记」与 DESIGN-ISSUES P2-9。

## F 段补记与安全矩阵发现（2026-10-26）

- **新增 2 份 spec、31 用例**：`guard-matrix`（29）+ `throttle`（2）。基线 **373 → 404**（373 + 31）。
  通用约定沿用：describe 级握手+登录一次、自建自清、断言 `body.code` 契约。测试基建新增：
  api-client 暴露 `setCookie/dropCookie/getCookie`（cookie jar 直操，负路径构造）与
  `handshakeAesKey`（手工构造「故意错误/重放」签名）。
- **拒绝矩阵覆盖面**（guard × 场景 × 码，全部实测钉死）：
  - **Sign**：body 篡改重放原签名 40112；X-Timestamp 漂移 -6min（窗口常量 5min）40112 且 nonce 未记录；
    nonce 重放第二次 40112（一次性 nonce 存储 `SECURITY_SIGN_NONCE` TTL 5min 真实生效）；
    **P2-11 已修（2026-10-29）**：nonce 写入改原子 `SET NX EX`，新增同 nonce 双请求并发用例
    （`Promise.all`）恰一 20000、一 40112；
    X-Nonce 非 32hex 40112（格式校验先于签名比对）；缺 SIGN_TICKET + ticket 缓存清空 → guard
    分布式锁路径**自动签发**放行（20000 + Set-Cookie，不拒）。
  - **JWT**：AT 过期（-10s 签发）40101；换 secret 的 HS256 40101；`alg=none` 空签名段 40101；
    payload.userId 不存在（正确签名）+ 双因子签名 → 40112（sign guard 查无会话）；删除
    `AUTH:SESSIONS` 键（会话吊销）后旧 AT 双因子 40112 —— session 校验真实查缓存。
  - **Device**：缺 DEVICE_ID 40605；篡改 DEVICE_ID（signed cookie 验签失败被 cookie-parser 丢弃）
    40605；封禁闭环：第二设备 HTTP `PATCH :id/ban` → 本设备 40607 → HTTP `unban` → 恢复放行
    （P2-2 已修 2026-10-28：ban/unban 落库 + 缓存双写，原「只写缓存」口径作废）。
  - **CAP**：risk 有评估（新设备 `DEVICE_NEW` critical 因子未处理）+ 缺 CAPJS_TOKEN → 40116；
    `DEVICE_NEW` 处理后（shouldChallenge=false）缺 token → 40117（策略降级仍拒）；缓存清空 +
    已消费 token（真验路径）→ 40117；重新 challenge/redeem 恢复 20000。
  - **MFA**（已登录态）：mfa_setup=true + 未种设备 verified 缓存 → 40115（登录时 isTrusted=false →
    payload.mfaVerified=false）；种缓存后 20000；mfa_setup=false → 40114（mfa.guard P5：未启用
    MFA 的用户无法使用系统，钉现状）。settings 的 `app.auth.mfa` 键**不控制** mfa.guard
    （只被 user_mfa.shared 的 methodsRequiredCount 消费）——登记于发现节。
  - **Lock**：`PATCH /system/user/lock`（LockFree）真锁 → 全链端点 40118 → unlock → 恢复 20000
    （探针必须用非 LockFree 端点，user_lock 自家 read/lock/unlock 全 LockFree 锁不住）。
  - **IP**：临时黑名单（Redis `risk:ip_blacklist:<ip>`）→ 40603 → 移除后放行；永久黑名单
    （APP:SETTING 缓存 `APP_GLOBAL_IP_BLACKLIST`）→ 40603；见发现节的 X-Forwarded-For 口径。
  - **functional**：opaque login/start 关 `APP_AUTH_OPAQUE.authEnable` → 50301（guard 先于
    passport 与 DTO 校验；与 D 段 google 对照不重复）。
  - **Throttle**（独立文件）：`device/initial` 动态覆盖 limit=4/ttl=60s（`SysDeviceSettingService`
    硬编码非 settings），内存存储按 app 实例隔离；引导期已耗 1 次 → 3 次压线通过 → 第 5 次
    **HTTP 200 + body.code 42900**（原生 ThrottlerException 由异常过滤器统一 200 壳；P3-1 裁决
    2026-10-28 接受该形态并写入前端契约）；blockDuration 已随 P1-10（2026-10-28）同步动态覆盖
    （60s，Retry-After ≥30 断言）。
- **测试踩坑（防复踩）**：
  - SIGN_TICKET 自动签发用例**不可还原旧 ticket**——guard 已换新票（jar 自动捕获新值），把旧值
    种回去 = cookie/缓存失配，后续所有签名请求 40112；
  - cap.js 的 token 是**一次性**的（`validateToken` 成功即从 store 删除）——CAP guard 缓存一旦被清，
    旧 cookie 永远过不了真验，复原必须重新 challenge/redeem；
  - `sys_device.device_name` 有唯一约束 `uq_device_name`，重名 INSERT 撞 23505 ——
    P3-2 已修（2026-10-28）：initial 的 catch 在 catch-all 之前单列 23505 → 受控 40000
    （其余异常仍 40605「Unsupported Device」）；
  - 重登同一用户+设备前必须先 signout，否则 login/finish 撞 40109 Duplicate Auth；登录链是
    JwtFree+Sign 生效路由，登录态 jar 的双因子 anon() 必 40112，重登前须 `setAuth(null)`。

## G+H 段补记（2026-10-26）

- **新增 2 份 spec、9 用例**：`concurrency`（6，真实并行 = 单测试内 Promise.all 多请求）+
  `api-rollback`（3，HTTP 级事务回滚直测）。基线 **404 → 413**。
- **实测结论（详见 DESIGN-ISSUES.md）**：
  - **P0-1（已修 2026-10-26）**：原实测同一 RT_JTI 五路并发 refresh **全部成功** —— `findByJti`
    的悲观锁只串行化轮换写腿（防丢更新），同 jti 原地换锁 + revoked 恒 false ⇒ 重放拦截实际
    不存在（锁注释宣称与实际不符）。修法：`getNewAccessToken` 锁内比对「入口密文快照 vs 库中
    当前值」，失配 40102 —— G1 断言同步改为「恰 1 路成功、其余 40102」并连跑 3 次稳定；
  - **P1-1（已修 2026-10-28）**：两路并发 rotate 同 type 曾产生两条同 version ACTIVE（读腿
    无锁）—— 修复为读腿事务内 FOR UPDATE，G6 断言改为「恰一条 ACTIVE、败者受控 40401」；
  - 无恙面：同名注册竞态（uq_user_name 恰一胜出）、同指纹 initial 竞态（uq_device_id 恰一行、
    败者受控 40605）、preference 并发 upsert（按列回写四段齐落）、回收站并发 recover（恰一成功
    一受控失败）—— 见 DESIGN-ISSUES.md「实测无恙面」表；
  - 回滚传播 HTTP 级验证：role create 第二腿 FK 拒绝 → 主行+junction 零残留（23503 已随 P1-7
    映射为受控 40000）；recover 撞唯一键 → 40000 recoverFail + 快照行完好；after-commit 钩子
    （device initial → SYS_DEVICE 缓存）在响应返回时已执行（零轮询断言）。
- **测试基建口径**：并行请求共用同一 api-client 的 cookie jar 是安全的（refresh 响应回种的
  RT_JTI 同值；签名请求各自现算 timestamp/nonce）；注册竞态用 service 级双事务直测
  （P1-3 修复后 HTTP register 面语义为「已登录补挂口令」，新用户注册走 OTP 链）；
  device initial 的 Throttle 4/60s 按 spec 文件独立计数（concurrency 文件 bootstrap 1 +
  竞态 3 = 压线 4）。

## 安全矩阵发现（F 段实测登记，2026-10-28 批 1 全部处置）

> 已收编至 [DESIGN-ISSUES.md](./DESIGN-ISSUES.md)（P0-2/3/4 已修复、P0-5 登记为部署强约束、
> P1-10/11 已修复、P2-1 保持现状），本节保留原始叙述，后续更新以 DESIGN-ISSUES.md 为准。

> 按「拒绝条件的真源是 guard 源码」纪律：行为与直觉/文档不符但属真实设计取舍的钉死断言；
> 属缺陷/加固空间的逐条登记如下（均已在 spec 内用例或注释钉现状）。

1. **【已修复 2026-10-28】** **sign guard 双因子失败会静默降级单因子**（`sign.guard.ts` computeDualFactorSignature）：
   会话查无/派生失败时 fallback 到单因子验签。后果：**会话吊销对「自选签名模式的客户端」不设防** ——
   合法客户端（双因子）被 40112 拦，但攻击者持「正确签名的伪造 AT + 设备 aesKey」显式发单因子
   签名即可 20000 通过（含 payload.userId 不存在的 ghost AT；MFA guard 的 `mfaVerified` 是 AT
   payload 自报字段，同样可伪造穿透）。建议方向：req.user 存在时派生失败应直接拒绝而非降级。
2. **【已修复 2026-10-28】** **CAP token 与设备不绑定 + 校验结果缓存超长**：guard 验证缓存 `SECURITY_CAP_TOKEN:<deviceId>`
   只存 boolean、**从不比对 token 值/设备绑定** —— 缓存窗口内把另一台设备的服务端签名 cookie
   原样移植即可通过（spec 钉死）。叠加 `setCapTokenCache` 把 `getCapJSConfig().ttl`（毫秒，
   默认 3,600,000）当秒传给缓存 → 实际 TTL ≈ 41 天而非 1 小时（cookie 本体 1h 过期，但服务端
   信任窗口远超之）。建议方向：缓存键掺 token 指纹；TTL 单位修正。
3. **【已修复 2026-10-28】** **security.guard 黑名单路径分支不可达**：`isBlacklistedPath` 用完整 `req.path`（含 `/w/v1`
   前缀）对 `startsWith('/admin')` 等常量匹配 —— 所有真实路由都带 API 前缀，永不命中 40610；
   而扫描器打的真实裸路径（`/admin`）不匹配任何路由 → 40400，guard 链根本不执行。
   `addToPermanentBlackList` 的自动拉黑副作用因此是死代码。spec 以 `/w/v1/admin → 40400` 钉现状。
4. **【登记为部署强约束 2026-10-28，代码不改】** **realIp 恒信任 X-Forwarded-For**：IpMiddleware 用 `@supercharge/request-ip`，首 header 优先、
   不校验跳数（与 `app.set('trust proxy', true)` 双通道并存）。进程内实测可任意伪造 realIp ——
   IP 黑名单（40603 可用伪造 IP 触发/绕过）与 Throttle tracker（`getTracker` 返回 realIp）的
   IP 维度风控都可被请求头改写绕过。直连暴露时为真实缺陷；生产 nginx 覆盖 XFF 时可接受。
5. **【已修复 2026-10-28】** **JWT 层不校验用户存在性/会话**：`jwt-access.strategy` 的 validate 原样返回 payload，
   无 DB/缓存校验（与发现 1 叠加）。passport 层只保证「签名+未过期」，身份真实性完全下游化。
6. **mfa.guard 强制所有已登录用户 mfaSetup=true**（40114 否则拒）：未启用 MFA 的用户无法使用
   任何登录态端点 —— 属产品级强策略，钉现状；settings 无开关可关（`app.auth.mfa` 键与该 guard
   无关），如需灰度只能改 AT payload 的 mfaSetup。
7. **【已修复 2026-10-28】** **throttle 动态覆盖不覆盖 blockDuration**：`WalnutAdminGuardThrottler` 只覆盖 limit/ttl，
   触发封禁后的 block 时长仍是全局 ttl（dev 10s）——连发攻击者在 block 窗口后每 10s 可再打 4 发。

## D 段补记（2026-10-26）

- **新增 9 份 spec、46 用例**：`auth-session / opaque-admin / otp / security / external-oauth /
  log-operate / log-auth / deleted / shared-ali`。基线 323 → 369，`pnpm test:integration` 连续两轮全绿。
  通用约定沿用 A/B/C 段：describe 级握手+登录一次（root 短路权限）、afterEach/afterAll 自建自清、
  fire-and-forget（操作日志/登录日志落库、after-commit 清缓存）断言一律短轮询、断言 `body.code` 契约。
  测试基建新增：helpers `app-settings.ts`（APP:SETTING 缓存改写+原值还原，functional guard 系列
  用）、api-client 暴露 `clientRsaPrivateKeyPem`（EncryptResponse 响应字段解密）。
- **迁移回归修复（1 处，本段唯一 src 改动）**：`auth/refresh` 无 RT cookie 时 guard 把 undefined
  jti 直传 `AuthRefreshRepositoryService.findByJti` —— Mongo 版 findOne({jti: undefined}) 查无行 →
  受控 RefreshTokenExpired（40102）；PG/TypeORM 把 undefined 当绑定参数下发 → pg 驱动
  "bind parameters must not contain undefined" 未受控 50000。已在 findByJti 按「查无此 jti」语义
  收 nil → null（两个调用方本就有 null 分支，轮换写腿行为不变）。
- **钉现状（非迁移回归，断言固化；2026-10-28 批 1 处置）**：
  > 已收编 DESIGN-ISSUES.md（P1-2 / P1-8 / P0-1 / P1-7 同族 / P1-5）—— 本节为历史叙述。
  - `POST /auth/signout` 的会话键清理腿曾失效（delByPattern 弄丢 scanIterator 批次 →
    after-commit 钩子吞错 → AUTH:SESSIONS 残留）—— **P1-2 已修 2026-10-28**：三键全清；
    旧 AT 再请求现在由 P0-4 的 JWT 会话校验先拦 40101（修复前是 MFA guard 40115）；
  - `GET /auth/permissions` 在 sys_menu 空表时曾 TypeError → 50000 —— **P1-8 已修 2026-10-28**
    （受控空树；spec 仍造 CATALOG+MENU 两行以断言「首根 children」树形状）；
  - RT 刷新轮换是**同 jti 原地换锁**（P0-1 第一轮修法）—— 已是历史：2026-10-27 起为
    revoke-and-insert（旧行 revoked + 新行两行形态，见 DESIGN-ISSUES P0-1 终态）；
  - CRUD update 装饰器不传 operateType → sys_log_operate.operation 列恒 null；
  - `security/sensitive` 的 password 通道恒失败 + getUserAvailableMethods 缺失身份直接
    DataNotFound —— **P1-5 已修 2026-10-28**（password 摘除；探测腿容错；无可用方式 →
    40000 noVerifyMethodAvailable）；
  - gitee/github callback 缺 code 曾走 passport-oauth2 authorize 重定向腿（HTTP 302 Location）——
    **P3-3 已修 2026-10-28**：guard 前置校验 → 受控 40000；
  - `/shared/ali/sts` 在 env 配有 vendor key 时发真实外网请求（STS assumeRole），结果取决于外部
    服务 —— spec 断言受控两态（20000 信封形状 XOR 50000 兜底），真实 STS 成功率不进回归。
- **JwtFree + Sign 生效路由的签名口径（D 段反复踩坑，通用口径）**：登录态客户端的 `anon()` 会签
  双因子（无 Authorization 头）→ 服务端按单因子验 → 40112。所有匿名断言要么发在未登录独立客户端
  （opaque-admin / otp / external-oauth 的做法），要么先 `setAuth(null)` 回单因子（log-auth 的做法）。
- **外部依赖端点不进回归**：google fed_cm 真实 id_token、gitee/github 真实 code 回调（外部 IdP）——
  已覆盖部分为纯本地错误路径（functional 开关 / 本地 JWKS 校验 / url 构造 / 缺 code 重定向腿）。

## B 段补记（2026-10-26）

- **新增 8 份 spec、45 用例**：`setting / error / key / monitor(cache+server) / logger / monitor-user / health(含根 controller) / area`。
  通用约定沿用 A 段：describe 级握手+登录一次（root 短路权限）、afterEach/afterAll 自建自清（PG 行 + `WALNUT_CACHE_*` 键）、断言 `body.code` 契约。
- **迁移回归修复（1 处）**：`shared/area` children/feedback 的缓存未命中冷路径曾整层丢字段——B4 把 Mongo `.lean()`
  普通对象换成无 `@Expose` 的 PG 实体实例，全局 ClassSerializerInterceptor（excludeExtraneousValues: true）出站剥成
  `[{}]`（热路径因 Redis JSON 往返侥幸幸存，service 层 int-spec 不可见）。已在 `repo.findChildrenByPcode`
  最小修复（投影回 `{name, code, pcode}`，对齐 Mongo lean 版），`area.tree.int-spec` 的行形态断言同步更新。
- **前迁移遗留缺陷（已修，2026-10-27）**：
  > 已收编 DESIGN-ISSUES.md（P1-4，已修复）。`SharedBLPathService.shouldSkip` 的后缀表含 `'/state'`，全局异常过滤器
  （`WalnutAdminFilterExceptionAll`）原先对该名单**提前 return 不落响应**——`POST /app/monitor/user/state`
  等路径上任何异常（含 40099 受控错误）都会让请求静默悬挂。修复把 skip 语义收窄为「不观察」（只跳错误日志与
  错误入库），响应壳恒落盘；monitor-user spec 的 `state 非法 body → 40099` 断言已恢复为常规回归。
- **其他钉现状（非回归，断言固化；2026-10-28 批 2 已处置 P2-4/P2-7）**：`monitor/cache read` 已补
  await（返回真实 value，P2-4 已修）；cache delete 仍是 fire-and-forget（响应先于 DEL 落 Redis，
  契约见 controller 注释）；`logger list` 的 fileSize 是 `x.xx KB` 字符串、`monitor/server mem` 是
  `x.xx GB` 字符串；terminus 健康检查出参无 `{status,info,details}` 外壳、超阈不抛 503 而是返回
  `status:'down'`；error controller ErrorMap 的 40112-40117 已与 contract 错误码对齐（P2-7 已修，
  spec 全项断言）。
- **测试基建口径**：`anon()` 在 `setAuth()` 之后签的是双因子（无 Authorization 头），对 JwtFree+Sign 生效的路由
  （如 `GET /`）会 40112——匿名断言需先 `setAuth(null)` 回单因子；外部依赖端点（`/app/health/network` 外连
  baidu.com）不进回归。
- **测试基建修复（1 处）**：helpers `cleanupFixedCacheKeys` 原样 `redis.del` 逻辑键，漏加
  `AppTechCacheService` 落键时的 `WALNUT_CACHE_` 前缀——DEL 恒为静默 no-op（A 段 lang spec 的清场因此一直
  未生效，只是缓存内容确定才没暴露）。已修为删除前补前缀，area 层级缓存（跨轮共享）的跨 suite 污染随之消除。

## C 段补记（2026-10-26）

- **新增 11 份 spec、87 用例**：`dict / menu / role / user / user-me / device / user-device /
  user-identity / user-lock / user-mfa / user-preference`（`system/user/oauth` 空壳无端点不测；
  `deleted` 与 `logs` 两系不在本段范围）。基线 236 → 323，`pnpm test:integration` 连续两轮全绿。
  通用约定沿用 A/B 段：describe 级握手+登录一次（root 短路权限）、afterEach/afterAll 自建自清
  （PG 行 + `WALNUT_CACHE_*` 固定键；锁/设备缓存键无 seed 片段，按逻辑键显式 DEL——`delByPattern`
  在 node-redis v5 的 del rest-args 语义下会炸，用例一律逐键删）。
- **迁移回归修复（1 处，本段唯一 src 改动）**：`system/menu` 的 `flattenSysMenuMeta`（dto/menu.dto.ts）
  未给键判据原为 `=== undefined`；HTTP 入参经全局 ValidationPipe 的 plainToInstance 深度实例化
  （meta 挂 @Type）后，**部分 meta 的未给键以显式 null 落在实例上** → is_show/cache/status 等非空拍平列
  收到 NULL，带部分 meta 的 menu create/update 必撞 NOT NULL 约束（50000）。已改 `??`（null/undefined
  都回填 schema 默认值，对齐 Mongo 版「meta 子文档整体替换 + 默认值」语义）。B5 的 service 层 int-spec
  传纯对象不可见——该类回归只有真实 HTTP 层能抓到。
- **钉现状（非迁移回归，断言固化，未修）**：
  > 已收编 DESIGN-ISSUES.md（P2-4 / P2-6 / P2-7）。
  - 【已修 2026-10-28，P1-12】`system/dict/data` 曾有 DELETE_MANY 常量但装饰器未接线（40400）——
    现补挂 deleteMany（逐行软删 + locale 级联）；
  - 【已修 2026-10-28，P1-7】`system/user` create 用户名重复的 23505 由兜底 50000 收敛为 40000；
  - 【已修 2026-10-28，P1-5/P1-6】`system/user/identity`：`POST list` 的空 DTO 补 @Allow（20000）；
    bind 的 setAsSecurity 补 IsOptional（缺省 false）；update 的 null 判据改 `!= null`（HTTP 可
    改值，回 verified=false）；`update/status` 的探测腿容错（有 email security 身份 → 40119 可达）；
  - `system/device` 的 lock/unlock/ban/unban 曾只写 SYS_DEVICE 缓存不落库 —— **P2-2 已修
    2026-10-28**（DB 事务更新 + after-commit 双写，guard 缓存 miss 回源库）；`history-users`
    曾恒空数组（「只回 user 缺失行」的语义反转）—— **P2-3 已修**（返回绑定用户）；
    current-active-user 空态回 null 填充壳（`?? {}` 后经 plainToInstance 深度实例化）；
  - `system/user/device` 的 force-quit 只撤「查到的第一行」RT（updateRevokedAndReason 走 findOne），
    非同维度全部 RT；
  - `system/menu` 的 tree 空表时曾 `fullTree[0].children` TypeError → 50000 —— 【已修 2026-10-28，
    P1-8】受控空树（单测覆盖）；fullTree 只回首根（order 最小的根）的 children。
- **测试基建口径补记**：多设备类用例的第二指纹 initial 必须走裸 supertest（客户端 cookie jar 吃下第二台
  设备的 DEVICE_ID 重签后，后续请求带错配的 CAPJS_TOKEN 必 40116）；device initial 的 Throttle 是
  4 次/60s（tracker=realIp），单文件 initial 调用总数要压在限额内；user-device 锁定会把
  `SECURITY_LOCK:<userId>:global`（cross-device 默认 true）写进 Redis 且不随集成库 drop 清掉，
  afterEach 必须显式清，否则同文件后续用例 40118。

## I 段补记（2026-10-27）

- **新增 1 份 spec、7 用例 + 种子助手 `helpers/seed-permissions.ts`**：`permission-chain.api-spec.ts`。
  基线 414 → 421，`pnpm test:integration` 连续两轮全绿。权限链路自此从「root 短路绕行」改为真实
  链路覆盖：种子（最小菜单树 + 角色 + 非 root 用户）由本 spec 的 beforeAll 调用、afterAll 按 seed
  片段清理，**不进 globalSetup**（库级 drop/重建仍是 global-setup 的职责，业务数据零预置的既有
  自清假设不被污染）。
- **权限串的推导依据（读实现钉形，种子据此设计，非猜测）**：权限串 = `sys_menu.permission` 列
  （meta 19 字段拍平列之一，`*:*:*` 形态直存）**一行一串** —— `getCorePermissions → getStrings`
  的过滤判据只有 `Boolean(meta.permission)`；element 行不进菜单树（`getMenuTree` 按 type 过滤）
  但进权限串，因此「N 个权限点 = N 根 element 行」。非 root 用户可用菜单 = 种子角色的
  `menusList`（sys_role_menu junction，`menu.status=true` 过滤）+ `findRootMenu()`
  兜底的根行 —— 种子 CATALOG 根（pid=NULL）不挂 junction，挂了反而与 findRootMenu 的返回值重复
  出现在 menuArr 里。
- **实测结论（全部断言钉进 spec）**：
  - `GET /auth/permissions` 是权限缓存的唯一写入口（`AUTH:PERMISSIONS:<userId>:<deviceId>`，
    root 也写）；permission.guard 对非 root **只读缓存** —— 键缺失直接 40105（无懒重建），
    命中后 `includes()` 全串精确匹配。「缓存缺失 40105」与「缓存命中但串不在 40105」两条拒绝
    路径分用例钉死；「清缓存 → 放行端点转 40105 → 重拉恢复放行」闭环成立。
  - 真实链路未抓出迁移回归：授予 → 放行、未授予 → 40105、写路径可重入，均与读码预期一致。
  - **COMBINE 默认失效（P2-9 已修 2026-10-28）**：`app.functional.role` 缺省曾为
    `scope: GLOBAL / globalValue: switchable`，scopeResolver 在 GLOBAL 分支恒返回 globalValue ——
    用户行 `role_mode='combinable'` 被忽略，非 root 链路恒取 `[currentRole]` 单角色菜单。
    现默认改 GLOBAL/combinable（零配置即合并全部角色），spec 既有 LOCAL scope 对照用例保留
    （验证 LOCAL 下仍看用户自身 role_mode），另加默认腿断言。
  - root 短路对照：root 用户全程不拉 `/auth/permissions`（权限缓存键不存在）同端点仍 20000 ——
    短路判据（AT payload `roleMode==='combinable' && roleNames[0]==='root'`）不经过缓存链路。
- **测试基建口径**：
  - 同一客户端给同一用户二次 opaque 登录前必须先 `POST /auth/signout`（真实撤本设备 RT）——
    login/finish 的 duplicate 判据是 `(userId, deviceId)` 存在未撤销 RT 行，否则 40109
    （`refresh.shared.service.generateRefreshToken`）；且重登前 `setAuth(null)` 回单因子签名
    （D 段口径：登录态 anon() 签双因子无 Authorization 头 → 40112）。
  - `demoString` 出参被 DTO 折成小写（A 段已钉），断言比较前 `toUpperCase()`。

## C+D 批复审修复补记（2026-10-28）

> 决策见 `docs/plans/modernization-roadmap.md` §6；问题条目与完整修法见 `DESIGN-ISSUES.md`。
> 本节只记**行为修订**与对应的 spec 翻转，供后续读端点时对照。

- **P2-12 踢下线清缓存**：`system/user/device` 与 `app/monitor/user` 的 force-quit
  （user-kick-other / admin-kick）在撤 RT 之外，事务提交后按设备清 `AUTH:SESSIONS` /
  `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED`。user-device / monitor-user spec 的 force-quit
  用例改为第二设备真实验证：旧 AT 立即 40101（此前只断言 RT `revoked=true`），三键全清。
- **P2-13 OAuth state**：gitee/github `/url` 的 `state` 从明文 `JSON{fp,lang}` 改为
  `base64url(JSON{fp,lang,nonce}) + "." + HMAC-SHA256`，nonce 与发起 deviceId 落 Redis
  `AUTH:OAUTH_STATE:<nonce>`（10 分钟 TTL）。callback guard 在换 code 前验签 + 设备绑定 +
  DEL 一次性消费，失败一律受控 40000。external-oauth spec 覆盖 state 形态翻转、篡改 /
  重放 / 跨设备拒绝、service 层合法签发-消费闭环。
- **P2-15 永久黑名单锚点**：`app.global.ipBlackList` 显式默认行在
  `apps/server/db/seed/app_setting.json`（`"[]"`），`check-seed` 新增必需键机械核对
  （缺行 / 非法 JSON / 非数组三种反例）。集成库仍只跑 migrations，不 seed。
- **P1-18 current_role 校正 + F1 根修**：`PUT /system/user/:id` 的 roles 整组替换后，若
  `current_role_id` 不在新集合 → 重置为新集合首角色（空集合 → null）；create 与 update
  口径对齐（显式 `roles: []` → currentRole=null，roles 未给才 defaultRole）。根修：
  `getCoreMenus` 先按 AT userId 从 `sys_user_role` 现查实际绑定，把 payload 的
  roleIds/currentRole 过滤到 membership 内（COMBINE 交集；SWITCH current 失效回退绑定集
  首角色，空则空）—— 旧 AT 重拉不复活被移除角色，恢复用户后权限为空。
  user spec：create `roles: []` 的 currentRole 翻转（defaultRole → null）+ 新增「移除
  current 角色」用例；permission-chain spec 新增「改 roles → 缓存消失（未重拉 40105）→
  重登后权限串按新角色」+ F1 两条（旧 AT 重拉 / 恢复用户后重登 40103 受控）。
- **P1-19 user 写路径事务**：`POST /system/user`、`PUT /system/user/:id` 挂 `@WalnutTx`，
  主行 + junction + current_role 校正同事务。api-rollback spec 新增 create/update 两条
  回滚用例（roles=[有效, 不存在] 命中 junction FK → 40000，主行零残留 / status 与既有
  junction 不半提交）。
- **P2-16 角色/菜单失效权限缓存**：`PUT /system/role/:id` 的 menus / status 变更按
  `sys_user_role` 反查用户并清其全部设备权限缓存；菜单失效按 F3 收窄 —— delete 全量清，
  update 仅在 permission/status 真变化时清，create 不清。permission-chain spec 新增
  「改角色 menus → 缓存键消失 + 守卫 40105 + 重拉空授权」；menu spec 用哨兵键断言
  create/普通 update 保留、permission 变更清空。
- **P2-18 恢复用户联动外围**：删除用户时在硬删前给 identity / preference / user_device /
  mfa / lock 五表逐行落快照；`sys_user` 恢复器改为组合恢复器（主行 + 按 `userId` 重放外围
  快照，同 deletedId 取最新；device/mfa/lock 失败 savepoint 跳过）。deleted spec 新增
  「user + password identity + preference → 删 → recover → 联动恢复、密文完整、快照消费」；
  F2：回收站 read/deleteMany 的 content 在 DTO 层遮蔽 identity `value` / MFA 四列密文
  （`***`），恢复走实体不受影响。`sys_user_role` / `sys_role_menu` junction 仍不进快照
  （登记保留）。

## K 段补记（guard 分支覆盖补齐批，2026-10-29）

> 覆盖审计的 G1-G15 落地记录。G15（permission.guard 数组权限无 mode 的放行面）**跳过**：
> 全仓数组调用方都显式传 mode、无 HTTP 可达路径 —— 已在 DESIGN-ISSUES P3-33 纯登记，不写
> 无法触发的用例。其余逐条对应 spec / 用例 / 断言码如下。

- **G1 Security guard 拒绝面**（guard-matrix「Security guard」组）：UA 缺失 40604（裸
  supertest 无 user-agent 头）、bot UA 40608、可疑 UA 40609；`APP:SETTING` 收紧 OS 白名单
  → 40601、收紧浏览器白名单 → 40602。目标端点 `security/rsa/public-key`（无 Free 标记）。
- **G2 JWT 跨设备 AT 重放**（guard-matrix JWT 组）：B 的 DEVICE_ID cookie + A 的 AT →
  40101（`AUTH:SESSIONS:<user>:<deviceB>:<sidA>` 查无）。校验序 JWT 先于 Sign，故不是
  40112；若会话键存在而双因子派生失配，第二道闸才是 40112。
- **G3/G4 sign.guard 单测**（`sign.guard.spec.ts`）：缺 X-Sign 40112、时间戳非数字 40112、
  ticket cookie↔缓存不一致 40112、AES 缓存缺失 40113、timingSafeCompare 长度不等 40112；
  已登录 + `deriveApiSignKey → null` → 40112（P0-2 不降级），未登录不调用派生腿。
- **G5 Lock 冷缓存 + 跨设备**（guard-matrix Lock 组）：lock 后删 SECURITY_LOCK 两键 →
  回源 DB 仍 40118 且全局缓存回填（**P1-20**：`checkIsLocked` 修前把双 miss 折叠为 false，
  冷缓存实际放行）；A 设备锁 → B 设备客户端探针 40118（默认跨设备锁）。
- **G6 Sensitive 按 level 授权**（security.api-spec）：basic 授权键存在时打
  `RequireSensitive(account_critical)` 的 `PUT /system/user/identity/.../status` → 40119；
  verify account_critical 对码后同端点 20000 且 identity.status 落库。
- **G7 functional 细分**（guard-matrix functional 组）：google `app.auth.google={}`
  （defaultClosed + detailKey 缺失）→ 50301；opaque `authEnable=1 + register=0` →
  register/start 50301；`authEnable=1 + change=0` → change-password/start 50301。
- **G8 Device IP 变化回写**（guard-matrix Device 组）：已登录请求换 XFF（127.0.0.2）→
  `sys_device.ip` 回写且 updated_at 变化；同 IP 再请求不再写库（updated_at 不变）；
  用例末尾无 XFF 请求把 IP 还原。
- **G9 CAP 真验失败**（`cap.guard.spec.ts`）：`AppCapJS.validateToken → success=false` +
  缓存 miss：shouldChallenge=true → 40116、false → 40117；并钉 P3-31 现状（40111 被自吞，
  外部不可达）。
- **G10 Permission SWITCH root 短路**（permission-chain spec）：root `role_mode` 改
  switchable + signout 重登 → AT payload `{roleMode:'switchable', currentRoleName:'root'}`
  → `/app/demo/list` 20000 且无 AUTH:PERMISSIONS 键（与 COMBINE 对照用例成对）。
- **G11 Risk HIGH 层**（risk.service.spec）：0.7 分（0.6 ≤ x < 0.8）→ shouldChallenge=true /
  理由 HIGH_RISK，无 shouldBlock。
- **G12 MFA payload mfaVerified 短路**（guard-matrix MFA 组）：服务端密钥重签同会话 AT
  并置 mfaVerified=true、设备级 verified 缓存显式清空 → 20000（mfa.guard P6 只信 AT payload）。
- **G13 CAP throttle 桶**（`cap-throttle.api-spec.ts`，独立文件）：challenge 桶 4/60s
  （与 device/initial 桶独立）；引导耗 1 次 → 3 次压线成功 → 第 5 次 42900 + Retry-After ≥30。
- **G14 IpFree + 黑名单**（guard-matrix IP 组）：临时拉黑 IP 打非 IpFree 端点
  `security/rsa/public-key` → 40603；同 IP 打 IpFree 的 `security/sign/initial` → 20000
  （现状钉死：IpFree 显式放弃 IP 维度风控，属设计内取舍）。
