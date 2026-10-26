# API 端点全景测绘（API 回归验证 A 段 + B 段 + C 段 + D 段）

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

## 全局守卫链（每个请求都要穿过，除非端点带 Free 装饰器）

装配在 `src/app/app.module.ts` 的 `APP_GUARD`（自上而下执行）：

```
IP → Security(UA/黑名单路径/bot) → Device → Risk(前) → CAP(前) → JWT → Risk(后) → CAP(后) → MFA → Sign(HMAC) → Lock
```

- **Device**：要求签名 cookie `__Host-DEVICE_ID` 且设备行在缓存（`SYS_DEVICE:<id>`）；`DeviceFree` 跳过。
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
  其余角色查缓存 `AUTH_PERMISSIONS:<userId>:<deviceId>`（由 `GET /auth/permissions` 写入）。
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

## 1. app 模块（`modules/app/`）

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
| error | GET `/app/error/:code` | Sign 链 | `app:error:test` | 路由错误码 | **B 段已测**（error.api-spec.ts）：40000/40103/40300/50000 四个 ErrorMap 异常与 contract 码对齐的 code 断言 body.code；枚举外 code → 40099。
  已知历史错位（非迁移回归，未断言）：ErrorMap 的 40112-40117 挂的异常类与 contract 错误码错位（如 40112 挂 CapInteractionRequired，真实码 40116） |
| key | GET `/app/key/current/:type` | Sign 链 | （无 @HasPermission → guard 放行） | type∈RSA_PAIR/AES_KEY_URL | **B 段已测**（key.api-spec.ts）：current 返回 version 最大 ACTIVE 行的 meta；与 app.key.int-spec 双向隔离的数据自洽法（自插高 version 目标行 + afterAll 还原/清空） |
| key | POST `/app/key/init` | 同上 | 无 | — | **B 段已测**：AES_KEY_URL 空表落首条 v1 ACTIVE；二钻 40001。注意 init 不选 JWT_AT——`generateNewKeyByType` 无该分支，恒 20000 且不落行、二钻不可达 |
| key | POST `/app/key/rotate/:type` | 同上+事务 | 无 | — | **B 段已测**：旧行 DEPRECATED + 新行 version+1 ACTIVE 事务两腿齐落，current 随轮转换人 |
| logger | POST `/app/logger/list`（CRUD list） | Sign 链 | `app:logger:list` | list 形态 | **B 段已测**（logger.api-spec.ts）：fileName/logType 过滤 + 无命中空列表；用例自建自清 `logs/{application,error}/api-spec-*.log`（cwd=apps/server） |
| logger | GET `/app/logger/:logType/:fileName` | Sign 链 | `app:logger:read` | 路由参数 | **B 段已测**：第 1 页命中写入行、越界页空内容、不存在文件 → 受控 50000（ENOENT 兜底）；fileSize 出参是 `@TransformSizeToKB` 字符串 |
| monitor/cache | CRUD（read 按 `key`、delete 按 `key`、list、`DELETE /app/monitor/cache/clear`） | Sign 链 + `@HasRole([root,developer])` | `app:monitorCache:*` | key/uuid | **B 段已测**（monitor.api-spec.ts）：真实 Redis 键（shared 类型）set→read/list/delete→clear；read 出参恒 `{}`（`void await get` 钉现状）；delete 是 fire-and-forget（断言轮询等落键）；clear 只清非 built-in/auth/system 类型（AUTH 的 MFA verified 键幸存），故 clear 用例放文件最后 |
| monitor/server | GET `/app/monitor/server/{cpu,mem,os,sys,disk,battery,time,network}` | Sign 链 | `app:monitorServer:*` | — | **B 段已测**：八个只读端点形状冒烟；mem 出参是 `@TransformSizeToGB` 字符串（`x.xx GB`）；无电池主机 battery 字段可空 |
| monitor/user | CRUD list/read + DELETE `force-quit/:id` + POST `state`（Sign/Jwt/Cap/DeviceFree，socket 在线状态上报） | Sign 链 | `app:monitorUser:*` | list/uuid；state 为匿名 | **B 段已测**（monitor-user.api-spec.ts）：state 匿名上报 upsert（auth=false 置空 userId）+ list/read populated + force-quit 撤销 RT 落库（revoked）+ read 40401 + force-quit 无行 20000+false + 非法 uuid 40002。
  **注意**：state 端点的受控错误路径（40099 等）不能进回归——路径尾缀 `/state` 命中 BLPath shouldSkip 后缀表，全局异常过滤器提前 return 不落响应，请求静默悬挂（前迁移时代遗留缺陷，非迁移回归，见文末 B 段补记） |
| setting | GET `/app/setting/public` | Lock/Sign/Jwt/Cap/Device 全 Free | 无 | — | **B 段已测**（setting.api-spec.ts）：匿名 unsigned 可达，auth/frontend 全布尔形状 |
| setting | GET `/app/setting/private` | LockFree | 无（需 JWT） | — | **B 段已测**：登录态 20000（maskUrl 等四组形状）；匿名 40101 |
| setting | CRUD + POST `cache/refresh` | Sign 链 | `app:setting:*` | setting DTO | **B 段已测**：CRUD 全闭环 + cache/refresh 后 `getAppSettings()` 可读到本轮自建 key（写设置全局生效路径）；自建 `api-spec-*` 行、afterEach/afterAll 删行后重 extract 还原 `APP:SETTING` 缓存，不动 seed 行 |

## 2. auth 模块（`modules/auth/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| 会话 | GET `/auth/permissions` | Sign 链 | 无 | — | **D 段已测**（auth-session.api-spec.ts）：root 权限树含自建 MENU 行（响应顶层是「首个根节点的 children」——单根无子级时顶层数组恒空，须造 CATALOG+MENU 两行）+ AUTH:PERMISSIONS 缓存键写入可复现 + 匿名 40101。
  **空表边界钉现状**：sys_menu 空表时 indexMenuName 组装在 `permissionMenuTree[0].children` 上 TypeError → 50000（Mongo 时代同病，spec 靠自建菜单行绕开） |
| 会话 | POST `/auth/signout` | SignFree+DeviceFree | 无 | — | **D 段已测**：RT 行原地 revoke + `__Host-RT_JTI` cookie Expires 归零 + after-commit 清 permissions/MFA verified 缓存（轮询）+ 旧 AT 再请求 40115（MFA verified 缓存已清，MFA guard 在 Sign guard 之前先拦）。
  **钉现状（非迁移回归，登记）**：AUTH:SESSIONS 键残留 —— revokeSession 走 cacheService.delByPattern，内部 redis.del(数组) 在 node-redis v5 rest-args 语义下抛错（C 段 user-device/monitor spec 同款已知问题），钩子错误被 catch 吞掉 |
| 会话 | GET `/auth/keys` | Sign 链 | 无 | — | **D 段已测**：响应 B 字段是 EncryptResponse 设备握手 RSA 信封（与 aes-key 握手第二步同格式），客户端私钥（api-client 新增 `clientRsaPrivateKeyPem`）解密还原 vendor.baidu 明文 |
| opaque/user | POST `/auth/opaque/user/login/start` | JwtFree（Sign 生效：单因子） | 无 | `{userName,start}` | **基座核心**：真实 opaque 登录前半段。
  A 段试点抓出迁移回归并已修：handler 用 `@WalnutDBSession()` 取 ctx.em 但漏挂 `@WalnutDBTransaction()`，txContext 恒 undefined → 匿名调用必 500；已对齐 login/finish 形态补上事务装饰器 |
| opaque/user | POST `/auth/opaque/user/login/finish` | JwtFree + `AuthOpaqueUserGuard`(passport-local userName/finish) | 无 | `{userName,finish}` | **基座核心**：签发 AT/sessionKey + RT cookie |
| opaque/user | POST `/auth/opaque/user/login/client-error` | JwtFree | 无 | `{userName,clientError,...}` | 恒 40103，冒烟 |
| opaque/user | POST `/auth/opaque/user/register/{start,finish}` | JwtFree（但 handler 读 `req.user.userName` —— 语义上是已登录用户补挂口令，新用户注册走 OTP） | 无 | opaque 消息 | 钉现状：匿名调用 500（handler 解引用 undefined）——登记为已知问题，不作为过据点 |
| opaque/user | POST `/auth/opaque/user/change-password/{start,finish}` | Sign 链 | `me:auth:opaque:changePassword` | opaque 消息 | **D 段已测**（opaque-admin.api-spec.ts）：me 通道真实 opaque 两步改密（服务级 finishRegistration 出 record）→ identity value/valueHash 整体替换 + security-policy 全设备 RT 吊销（revokeReason=updatePass）；旧密码客户端 finishLogin 失败、新密码 login/finish 换发成功 |
| opaque/admin | POST `/auth/opaque/admin/password/update/{start,finish}`、`password/clear` | Sign 链 | `system:user:pass:update` / `clear` | `{id,...}` + opaque 消息 | **D 段已测**（opaque-admin.api-spec.ts）：root 给目标用户改密（按 user 主键 id 定位，真实 opaque 客户端两步）→ identity 替换 + 目标全设备 RT 吊销 + 不存在 id 40000；password/clear 删 password identity、幂等（无行再删恒 true）、清后 login/start 40103 |
| otp | POST `/auth/otp/send`、`verify` | JwtFree + Functional（settings 缺省放行） | 无 | `{type,identifier,...}` | **D 段已测**（otp.api-spec.ts）：缺省配置（OtpSettingService 兜底 sendEnable=0/authEnable=0）→ send/verify 各自 functional guard 50301 EndPointUnavailable（码缓存不落）；种 APP:SETTING 缓存开 email 后 send → 真码落 `AUTH:VERIFY_CODE:visitor:<identifier>`（邮件走 Bull 队列不真发）→ verify 错码 40000、对码换发令牌 + `__Host-RT_JTI` cookie + identity 标记 verified + 码缓存删除 + AUTH:SESSIONS 键落（换发会话可用性另以 security-tab2 探针双因子验证）；type 非法 40099。
  **注意**：JwtFree+Sign 生效路由对登录态 jar 的 anon() 双因子签名一律 40112 —— 闭环请求发在未登录独立客户端（helpers 新增 `overrideAppSettings` 缓存改写+还原） |
| refresh | POST `/auth/refresh` | Lock/Sign/MFA/Jwt/Device 全 Free + `JwtRefreshGuard`（RT cookie） | 无 | — | **D 段已测**（auth-session.api-spec.ts）：RT cookie → 新 AT；轮换是**同 jti 原地换锁**（同一行 encrypted_token/expired_at 换新、revoked 恒 false——钉实现现状，无「旧行 revoked+新行」形态）；新 AT 与旧 AT 同 sid。
  **迁移回归已修**（D 段唯一一处 src 改动）：无 RT cookie 时 guard 直取 cookie 值 undefined 传入 findByJti —— Mongo 版 findOne({jti: undefined}) 查无行 → 受控 40102；PG/TypeORM 把 undefined 当绑定参数下发 → pg 驱动 "bind parameters must not contain undefined" 未受控 50000。已在 `refresh.repo.service.findByJti` 按「查无此 jti」语义收 nil → null |
| mfa | GET `/auth/mfa/status`、POST `/auth/mfa/verify` | MFAFree+LockFree | 无 | verify `{type,code}` | 高优先（MFA 闭环：绑定 totp → verify → 新 AT）—— verify 的 RT 轮换闭环已由 C 段 user-mfa spec（system/user/mfa/totp/verify）覆盖 |
| google | POST `/auth/google`、POST `/auth/google/callback` | Jwt/Sign Free + Functional + `AuthGoogleGuard` | 无 | google id_token | **D 段已测**（external-oauth.api-spec.ts，错误路径专项）：functional 关闭 → 50301 拦在 passport guard 之前；开启 → garbage credential 走本地 JWKS 校验失败 40107（不发外网）。真实 Google id_token 回调不测（外部依赖） |
| oauth/gitee | GET `/auth/oauth/gitee/url`、GET `/auth/oauth/gitee/callback` | Jwt Free + Functional（callback 另 SignFree + `OAuthGiteeGuard`） | 无 | query code | **D 段已测**（external-oauth.api-spec.ts）：functional 关闭 50301；开启 `/url` 构造跳转 URL 形态（authorize + client_id + redirect_uri 原样拼接不转义 + response_type + scope + state JSON{fp,lang}）；callback 缺 code → passport-oauth2 authorize 重定向腿 302（钉现状）。真实 gitee code 回调不测（外部依赖） |
| oauth/github | 同 gitee（`/auth/oauth/github/*`） | 同上 | 无 | query code | **D 段已测**（external-oauth.api-spec.ts）：同 gitee 同构（scope=read:user user:email）。真实 github code 回调不测（外部依赖） |

## 3. security 模块（`modules/security/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| sign | POST `/security/sign/initial` | Sign/Cap/Jwt/Lock/Device/Ip 全 Free（Risk 仍跑） | 无 | `{rsaPubKey,force?}` | **基座核心**：握手第一步 |
| sign | POST `/security/sign/aes-key` | 同上（响应 aesKey 经客户端 RSA 加密） | 无 | — | **基座核心**：握手第二步（客户端私钥解密） |
| rsa | GET `/security/rsa/public-key` | Sign/Jwt/Cap Free | 无 | — | **D 段已测**（security.api-spec.ts）：返回 app_key 表 current RSA_PAIR（version 最大 ACTIVE 行）meta.publicKeyPem —— 自插高 version 目标行做数据自洽（与 app_key.int-spec / key.api-spec 双向隔离，afterAll 清行还原） |
| cap | POST `/security/cap/challenge`、`/security/cap/redeem` | Cap/Jwt/Device/Lock Free（challenge/redeem 另 SignFree） | 无 | challenge/redeem payload | **D 段已测**（security.api-spec.ts）：FreeResponse 无响应壳 —— challenge 回 cap.js `{challenge:{c,s,d},token,expires}`，redeem 本地 PoW 对解 success:true、错解 success:false（helpers 求解器与 api-client 引导期同源） |
| sensitive | GET `/security/sensitive/check`、POST `/security/sensitive/verify` | Sign 链（`SensitiveGuard` 方法级） | 无 | verify `{basic,action,type,code}` | **D 段已测**（security.api-spec.ts，HTTP 级钉 B7c 已固化的 service 现状，非迁移回归不修）：① 缺 security 身份 → getUserAvailableMethods 对 phone/email security 读腿直接 DataNotFound 40401（而非跳过该方式）；② 造 security email+phone 身份后 check 列出 password/sms/email、mfa 恒不列、首选 password；③ verify password 通道恒失败 40000（opaque record 无法按明文比对）；④ email 错码 40000 不授权；⑤ 对码授权 sensitive_op:* 键 → check 翻转 needsVerification=false + remainingSeconds；⑥ mfa（未实现）→ 40000 verifyMethodNotAllowed |

## 4. shared 模块（`modules/shared/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| ali | GET `/shared/ali/sts` | Sign 链 | `app:shared:ali:sts` | — | **D 段已测**（shared-ali.api-spec.ts）：实现是 env `vendor.ali.OSS` 凭证直连阿里云 STS assumeRole —— env 配了 key 就发真实外网请求，结果取决于外部服务（凭证有效性/网络），不可脚本稳定。钉两端受控形态：成功 → 20000 + 三敏感字段（accessKeyId/accessKeySecret/stsToken）为 EncryptResponse 握手 RSA 信封（客户端私钥可解）、region/bucket 与 env 一致；失败（凭证无效/网络不可达）→ SDK 异常未映射受控异常兜底 50000。两态断言 body.code ∈ {20000, 50000} |
| area | GET `/shared/area/children`、`/shared/area/feedback` | Sign 链 | `system:area:*` | query（父级行政区划） | **B 段已测**（area.api-spec.ts）：集成库 shared_area 为空表，自建 95→9501→950102 三级行（与 int-spec 的 91/77 数据集无交集）；children 冷态回源 + 层级缓存（SHARED:AREA:*，跑前清跑后清）+ feedback 单码/多码回显树（depth/isLeaf）+ 匿名 40101 + 缺 codes 40099。
  **迁移回归已修**（repo.findChildrenByPcode 投影普通对象，对齐 Mongo `.lean()`）：原 TypeORM find 返回无 @Expose 实体，被全局 ClassSerializer（excludeExtraneousValues）在 HTTP 出站剥成 `[{}]`——缓存未命中的冷路径整层丢字段（热路径因 Redis JSON 往返侥幸幸存，service 层 int-spec 不可见），详见 area.api-spec.ts 头注 |

## 5. system 模块（`modules/system/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| lang | CRUD 四件（无 delete）+ GET `/system/lang/list/public` | CRUD：Sign 链；public：Lock/Sign/Jwt/Cap/Device 全 Free + 响应缓存 | `system:lang:*` | `{lang,description,order,status}` | **A 段试点**：CRUD + public 端点（缓存装饰器路径） |
| locale | GET `/system/locale/message/:locale?cache=1` | Lock/Sign/Jwt/Cap/Device/Ip 全 Free | 无 | 路由 locale | **A 段试点已覆盖**：message 拉取 + 缓存开关。
  缓存语义已钉现状：locale create/delete 事务提交后全量刷新 message 缓存（runAfterCommit → extractLocaleMessagesIntoCacheForCronJob，会顺带写 `SYS_LANG_ID_LIST`）；绕过 HTTP 的 PG 直插不触发刷新，cache=1 读旧缓存、cache=0 回源 |
| locale | POST `/system/locale`（数组批量 create）、`GET /:key`、`PUT /:id`、`DELETE /:key`、`DELETE /deleteMany/:keys`、`POST /list` | Sign 链 + 事务 | `system:locale:*` | 数组 `{langId,key,value[,oldKey]}` | **A 段试点**（创建/更新/删除走真实事务） |
| dict/type | GET `/system/dict/type/s` + CRUD | Sign 链 | `system:dictType:*` | dict DTO | **C 段已测**（dict.api-spec.ts）：CRUD + list 附 `populated_dictDataCount` 计数子查询 + `s` 端点按 type 批量回启用 data（order 升序、未知 type 跳过）。
  **FK 语义钉死**：dictType 的 HTTP delete 是「sys_deleted 快照 + 原行硬删」，data 腿由 DB 级 CASCADE（type_id FK）静默清掉且**不产生** data 的软删快照 |
| dict/data | CRUD | Sign 链 | `system:dictData:*` | dict DTO | **C 段已测**：CRUD + 软删快照 + read 40401。
  **无 deleteMany 路由**（Permissions.DELETE_MANY 常量存在但装饰器未接线 → 40400，钉现状）；update 的 DTO 字段全量必填（tagType 漏给 → 40099） |
| menu | GET `/system/menu/tree` + CRUD（delete 带 `?cascade=` query） | Sign 链 | `system:menu:*` | menu DTO | **C 段已测**（menu.api-spec.ts）：meta 拍平出入参往返（19 列组装/回填默认值）+ pid 自引用建树 + `?_cascade=` 两态（=1 额外按 title 级联软删 locale，非删子菜单；pid FK RESTRICT）+ tree 形态（fullTree 只回首根 children、treeWithoutTypeElement 走完整根数组、空表 `fullTree[0].children` TypeError 50000 不进回归）。
  **迁移回归已修**（C 段唯一一处 src 修复）：`flattenSysMenuMeta` 未给键判据原为 `=== undefined`，但 HTTP 入参经 ValidationPipe 深度实例化（meta 挂 @Type）后部分 meta 的未给键是**显式 null** → is_show 等非空列收到 NULL 撞 NOT NULL 约束，HTTP create/update 带部分 meta 必 50000；已改 `??`（null/undefined 都回填 schema 默认值，对齐 Mongo 子文档语义）。service 层 int-spec（B5 menu.role.pg）传的是纯对象不可见，只有 HTTP 层能抓到 |
| role | CRUD 四件（无 deleteMany；无 delete） | Sign 链 | `system:role:*` | role DTO | **C 段已测**（role.api-spec.ts）：menus 赋值落 sys_role_menu junction（create 缺省=空数组、update 未给=junction 不动、给了=delete+insert 整组替换）+ read/list 的 populated_usersCount + root 守卫（create 拒 root/developer、update 拒 roleName=root 与根角色行）+ `findRolesWithPopulatedMenus` 形态（status 过滤 + populated_menusList 组装 meta） |
| user | CRUD + 状态管理 | Sign 链 | `system:user:*` | user DTO | **C 段已测**（user.api-spec.ts）：create roles 必填（给 [] 时 junction 空 + currentRole 走 defaultRole 兜底）、safe role id 拦截、update 启停/roles 整组替换、delete 拒自己与 safe user、list 字段面裁剪 + `me/role/switch`（COMBINE 拒 40000）与 `me/roleMode/switch`（switchable↔combinable 落库、非法枚举 40099）+ opaque admin `password/clear`（删 password identity、幂等恒 true）。
  用户名重复 → DB 23505 未映射受控异常，兜底 50000（钉现状） |
| user/me | PUT `/system/user/me/profile`、GET `security-tab2`、GET `profile` | Sign 链 | `me:profile:update` 等 | — | **C 段已测**（user-me.api-spec.ts）：GET profile populated_roles_list、PUT profile 持久化 + 40099（缺必填/越枚举）、security-tab2 双通道形状（totp 行 SQL 直插对拍 verified/status 语义）、匿名 40101 |
| device | POST `/system/device/initial`（Sign/Jwt/Cap/Device Free + Throttle）+ GET `:id/current-active-user`、`:id/history-users` + PATCH `:id/{lock,unlock,banned,unbanned}` + read/list | Sign 链 | `system:device:*`（AND 模式组合） | uuid + PATCH | **C 段已测**（device.api-spec.ts）：initial 同指纹幂等回同 deviceId（upsert 覆盖 deviceName）+ 新指纹新行（裸 supertest 发，避免 cookie jar 吃下第二台设备的 DEVICE_ID 重签导致 CAP 40116 串台；Throttle 4/60s 压线）+ read/list（`:id` 是行 uuid 非业务键；sr/vp 组装回嵌套；current-active-user 空态回 null 填充壳）+ lock/ban 只进 SYS_DEVICE 缓存不落库 → 锁/封期间同设备请求被 Device guard 40606/40607 拦死（连 unlock/unban 都到不了），端点间以缓存复位通道衔接 + history-users 恒空数组（populate 恒命中，「只回 populated_user 缺失行」语义反转，钉现状） |
| deleted | read/list + `POST me/recover`、`POST recover`（recover 系另有 `@HasRole([root,developer,admin])`） | Sign 链 | `system:deleted:*` | uuid/ids | **D 段已测**（deleted.api-spec.ts，B9 int-spec 已盖 service 层，此处 HTTP 层复刻核心三态）：demo create → HTTP delete 软删 → read（快照 content/modelName/deletedBy + populated_user toMatchObject——read 面带额外 null 键）/ list（content ::text 关键字过滤 + total，出参不带 content）→ recoverMine 属主恢复（原行回来 + sys_deleted 行同事务消失）→ 管理端 recover（root 短路 @HasRole）→ deletedId 不匹配两态（recoverMine 40401 双键定位不命中 / recover 40000 recoverFail）→ deleteMany（deleteReal）硬删快照、原表不回来。
  **注意**：demoString 挂 IsUppercase（uuid 片段 hex 抬大写）；deletedBy 是 uuid 列不走模糊白名单，列表过滤走 content 关键字 |
| log/auth | CRUD delete/deleteMany/list（`@UseGuards(JwtAccessGuard)` 显式重复挂） | Sign 链 | `system:logAuth:*` | list | **D 段已测**（log-auth.api-spec.ts）：日志行由真实登录链自然产生（beforeAll opaque HTTP 登录产成功行；未知 userName 的 login/start 产失败行——recordAuth fire-and-forget，断言轮询）→ list（deviceId 过滤 + type 数组过滤命中/空命中 + 分页）+ 行字段面（成功行 userId/userName/type=opaque、失败行 userId/userName 双 null、msg 为 i18n 文案）+ delete（软删 → sys_deleted 快照 SysLogAuthModel）+ deleteMany + 不存在 id 40401 |
| log/operate | GET `:id/device`、`:id/snapshot`、read、list | Sign 链 | `system:logOperate:*` | uuid | **D 段已测**（log-operate.api-spec.ts）：日志行由 dictType create/update（CRUD 装饰器自带操作日志）自然产生，拦截器 `void insertToLogOperate` fire-and-forget 断言轮询 → list（deviceId 过滤 + 分页）+ 行字段面（title/actionType/method/statusCode/success/userId/os/browser/requestData jsonb）+ `:id/snapshot`（pg-base.update 的 ALS 快照两腿 before/after name 翻转）+ `:id/device`（deviceId 业务键反查 sys_device 组装回嵌套）+ read（Safe DTO 无快照列）+ 不存在 id 40401（read/snapshot 同型）。
  **钉现状**：CRUD update 装饰器只传 title/action → operation 列恒 null |
| user_device | GET `list`、PUT `update-name/:deviceId`、DELETE `force-quit/:deviceId`、PUT `lock/:deviceId`、`unlock/:deviceId` | Sign 链 | `system:userDevice:*` | — | **C 段已测**（user-device.api-spec.ts）：list（登录绑定行 current=true + deviceType/location 装回）+ update-name 持久化 + lock/unlock（建 sys_user_lock 偏好行、lockRoute 落 DB 默认空对象、cross_device 默认 true → 锁后 Lock guard 40118，端点间清 SECURITY_LOCK 缓存衔接）+ force-quit 撤 RT（revoked + userKickOther；updateRevokedAndReason 走 findOne 只撤第一行，钉现状）+ 无 monitor 行 40401 |
| user_identity | POST `list`、GET `status/:purpose`、POST `check/bind`、DELETE `unbind`、PUT `update/status`、POST `send-code/verify`（均 `/:type/:purpose`） | Sign 链 | （me 自维度，多数无 @HasPermission） | — | **C 段已测**（user-identity.api-spec.ts）：OTP 真实闭环（check 发码进 AUTH:VERIFY_CODE 缓存 —— 邮件走 Bull 队列测试环境不真发；用例从缓存读回真码 bind）+ status 形态/maskedValue + unbind（有 password 兜底可解）+ value 被他人占用拦截（第二 root 用户对拍）。
  **钉现状（非迁移回归，未修）**：① `POST list` 恒 40099 —— list DTO 是空类，forbidUnknownValues 对无校验元数据类体恒抛，身份读腿走 status；② bind 的 setAsSecurity 未挂 IsOptional，缺字段 40099；③ `update`（rebind）经 HTTP 恒 40000 —— partial DTO 把未给键材料化成显式 null，服务端 `verified !== undefined` 判 null 也命中 useVerifyEndpoint 拦截，任何 body 到不了改值逻辑（未验证态由用例 SQL 制造后走 send-code/verify 闭环）；④ `update/status` → 40401 —— RequireSensitive 守卫的可用验证方式探测对缺失的 phoneNumber/security 身份直接 getIdentityOrThrow，DataNotFound 在守卫链上抛出，预期 40119 分支不可达 |
| user_lock | GET `read` + PATCH（lock/unlock me） | LockFree | 无 | — | **C 段已测**（user-lock.api-spec.ts）：两套默认值对拍（无偏好行 service 兜底 lockIdleSec=300/crossDevice=false；首次 lock 落行后 DB 默认 lockIdleSec=600/crossDevice=true → read 走跨设备腿）+ lock/unlock 落 sys_user_device.locked + 无偏好行 unlock 40401 |
| user_mfa/totp | POST `generate/bind/verify`、DELETE `unbind`、PUT `status`（status 端点挂权限 `system:user:mfa:totp:status`） | MFAFree+LockFree | 大多无 | totp payload | **C 段已测**（user-mfa.api-spec.ts）：totp 真实闭环（generate 拿真 secret → otplib 同库客户端算码 → bind → verify RT 轮换取新 AT → status 开关 → unbind；备份码 10 枚 + secret/qrCode 形状；bind 后 generate 重入 40001）+ security-tab2 跨验。
  bind 后 verify 的 RT 轮换会更新 RT_JTI cookie（客户端 jar 原样回传） |
| user_mfa/webauthn | POST `register/{options,verify}`、`authenticate/{options,verify}` | MFAFree+LockFree | 无 | webauthn payload | **C 段已测**（user-mfa.api-spec.ts，仅形状/错误路径）：register/options 公钥选项形状（rp/user/challenge/alg/excludeCredentials）+ authenticate/options 无凭证 40400 + authenticate/verify 无 challenge 缓存 40000 + register/verify 带 garbage response（challenge 在 TTL 内）→ simplewebauthn 未受控异常兜底 50000。正向 register/verify 需浏览器凭证，不进回归 |
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
  **勘误**：`/deps` 返回的是 package.json 依赖清单（`getPkgDeps`），不是 PG/Redis 连通状态——原记录与本表来源核对时不符，已按实现修正 |

---

## 汇总

- **controller 数**：45（含 1 个空壳 `system/user/oauth`）。
- **端点数**：约 150（CRUD 工厂展开后）。
- **守卫形态分布**：全公开（全 Free）约 10 个；匿名握手/登录类（JwtFree+Sign 生效）约 12 个；登录态（全链 + 权限点）约 128 个。
- **外部依赖端点**（API 级只测错误路径或跳过）：google / gitee / github 的 callback（真实 OAuth code 不可脚本获得）、webauthn register/authenticate verify（浏览器凭证）。
- **A 段试点**：`app/demo`（标准 CRUD 模板）+ `system/lang` + `system/locale`（含公开 message 端点、批量数组 create、按 key 删除三种非标形态）——
  三份 `*.api-spec.ts` 已落地 `test/api/` 并入 `pnpm test:integration`（23 用例，describe 级握手+登录一次）。
  lang public 端点（`@WalnutAdminDecoratorCache`）已钉现状：命中后 1h TTL 内不回源，lang CRUD 不主动失效该键。
- **C 段**：§5 system 模块主体（dict/menu/role/user 系 + device 系 + me 系共 11 份 spec、87 用例）已落地，
  基线 236 → 323；未覆盖余量：`deleted`（回收站 read/list/recover）与 `logs`（logAuth/logOperate）两系。
- **D 段**：§2 auth 会话链（permissions/refresh/signout/keys）+ opaque 管理端/me 通道改密 + otp + §3 security
  （rsa/cap/sensitive）+ §4 shared/ali + 外部 OAuth 错误路径 + §5 的 deleted/log_auth/log_operate 共
  9 份 spec、46 用例已落地，基线 323 → 369。

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
- **钉现状（非迁移回归，断言固化，未修）**：
  - `POST /auth/signout` 的会话键清理腿失效 —— revokeSession 走 `cacheService.delByPattern`，
    内部 `redis.del(数组)` 在 node-redis v5 的 rest-args 语义下抛错（C 段 user-device/monitor spec
    已登记同款），after-commit 钩子错误被 catch 吞掉 → AUTH:SESSIONS 键残留（permissions/MFA
    verified 两键正常消失）；旧 AT 再请求被 MFA guard 以 40115 先拦（MFA verified 缓存已清且
    MFA guard 在 Sign guard 之前）；
  - `GET /auth/permissions` 在 sys_menu 空表时 indexMenuName 组装 TypeError → 50000（Mongo 时代
    同病，spec 靠自建 CATALOG+MENU 两行绕开；响应顶层是「首个根节点的 children」，单根无子级
    时顶层数组恒空）；
  - RT 刷新轮换是**同 jti 原地换锁**（同一行 encrypted_token/expired_at 换新、revoked 恒 false），
    不存在「旧行 revoked + 新行」两行形态；
  - CRUD update 装饰器不传 operateType → sys_log_operate.operation 列恒 null；
  - `security/sensitive` 的 password 通道恒失败（identity value 无法按明文比对还原）与
    getUserAvailableMethods 对缺失 security 身份直接 DataNotFound —— B7c service 层钉的现状在
    HTTP 层同形（40401/40000）；
  - gitee/github callback 缺 code → passport-oauth2 走 authorize 重定向腿（HTTP 302 Location），
    钉现状；
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
- **前迁移遗留缺陷（登记，未修）**：`SharedBLPathService.shouldSkip` 的后缀表含 `'/state'`，全局异常过滤器
  （`WalnutAdminFilterExceptionAll`）对尾缀 `/state` 的请求**提前 return 不落响应**——`POST /app/monitor/user/state`
  等路径上任何异常（含 40099 受控错误）都会让请求静默悬挂。非迁移回归（该逻辑自 monorepo merge 起未变），
  修复属独立缺陷处理，monitor-user spec 只避开该路径的错误断言。
- **其他钉现状（非回归，断言固化）**：`monitor/cache read` 出参恒 `{}`；cache delete 是 fire-and-forget（响应先于
  DEL 落 Redis）；`logger list` 的 fileSize 是 `x.xx KB` 字符串、`monitor/server mem` 是 `x.xx GB` 字符串；terminus
  健康检查出参无 `{status,info,details}` 外壳、超阈不抛 503 而是返回 `status:'down'`；error controller ErrorMap 的
  40112-40117 异常类与 contract 错误码错位（选了无错位的 40000/40103/40300/50000 断言）。
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
  - `system/dict/data` 无 deleteMany 路由（Permissions.DELETE_MANY 常量存在但装饰器未接线 → 40400）；
  - `system/user` create 用户名重复 → DB 23505 未映射受控异常，兜底 50000；
  - `system/user/identity` 的 `POST list` 恒 40099（空 DTO 类 × forbidUnknownValues）；bind 的
    setAsSecurity 未挂 IsOptional（缺字段 40099）；`update`（rebind）经 HTTP 恒 40000（partial DTO 把
    未给键材料化成显式 null，服务端 `!== undefined` 判 null 也命中 useVerifyEndpoint 拦截）；
    `update/status` 在守卫链上 40401（RequireSensitive 的可用验证方式探测对缺失的 phoneNumber/security
    身份直接 getIdentityOrThrow，预期 40119 分支不可达）；
  - `system/device` 的 lock/unlock/ban/unban 只写 SYS_DEVICE 缓存不落库；锁/封期间同设备后续请求被
    Device guard 40606/40607 拦死（连 unlock/unban 都到不了）；`history-users` 恒空数组（「只回
    populated_user 缺失行」的语义反转 + PG 侧 populate 恒命中）；current-active-user 空态回 null 填充壳
    （`?? {}` 后经 plainToInstance 深度实例化）；
  - `system/user/device` 的 force-quit 只撤「查到的第一行」RT（updateRevokedAndReason 走 findOne），
    非同维度全部 RT；
  - `system/menu` 的 tree 空表时 `fullTree[0].children` TypeError → 50000（不进回归）；fullTree 只回首根
    （order 最小的根）的 children。
- **测试基建口径补记**：多设备类用例的第二指纹 initial 必须走裸 supertest（客户端 cookie jar 吃下第二台
  设备的 DEVICE_ID 重签后，后续请求带错配的 CAPJS_TOKEN 必 40116）；device initial 的 Throttle 是
  4 次/60s（tracker=realIp），单文件 initial 调用总数要压在限额内；user-device 锁定会把
  `SECURITY_LOCK:<userId>:global`（cross-device 默认 true）写进 Redis 且不随集成库 drop 清掉，
  afterEach 必须显式清，否则同文件后续用例 40118。
