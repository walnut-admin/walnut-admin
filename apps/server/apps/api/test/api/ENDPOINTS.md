# API 端点全景测绘（API 回归验证 A 段）

> 全部 controller 的「模块 → 端点 → 方法/路径 → 守卫 → 请求形态」矩阵，后续 API 级测试批次的清单。
> 路径均相对 `/{APP_API_PREFIX}/v{APP_API_VERSION}`（本地开发 env 为 `/w/v1`，下同省略）。
> 来源：`apps/api/src/**/*.controller.ts` 静态扫描 + 逐文件核对（2026-10-25，分支 refactor/postgres-migration）。

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
| error | GET `/app/error/:code` | Sign 链 | `app:error:test` | 路由错误码 | 触发指定异常（错误通道冒烟） |
| key | GET `/app/key/current/:type` | Sign 链 | （无 @HasPermission → guard 放行） | type∈RSA_PAIR/AES_KEY_URL | 已有 int-spec 覆盖 service 层；API 级低优先 |
| key | POST `/app/key/init` | 同上 | 无 | — | 同上（二钻 40001） |
| key | POST `/app/key/rotate/:type` | 同上+事务 | 无 | — | 同上 |
| logger | POST `/app/logger/list`（CRUD list） | Sign 链 | `app:logger:list` | list 形态 | 低优先（读日志文件） |
| logger | GET `/app/logger/:logType/:fileName` | Sign 链 | `app:logger:read` | 路由参数 | 低优先 |
| monitor/cache | CRUD（read 按 `key`、delete 按 `key`、list、`DELETE /app/monitor/cache/clear`） | Sign 链 + `@HasRole([root,developer])` | `app:monitorCache:*` | key/uuid | 需真实 Redis 键；中优先 |
| monitor/server | GET `/app/monitor/server/{cpu,mem,os,sys,disk,battery,time,network}` | Sign 链 | `app:monitorServer:*` | — | 只读冒烟，中优先 |
| monitor/user | CRUD list/read + DELETE `force-quit/:id` + POST `state`（Sign/Jwt/Cap/DeviceFree，socket 在线状态上报） | Sign 链 | `app:monitorUser:*` | list/uuid；state 为匿名 | force-quit 有副作用；中优先 |
| setting | GET `/app/setting/public` | Lock/Sign/Jwt/Cap/Device 全 Free | 无 | — | 匿名可访问，冒烟 |
| setting | GET `/app/setting/private` | LockFree | 无（需 JWT） | — | 登录态冒烟 |
| setting | CRUD + POST `cache/refresh` | Sign 链 | `app:setting:*` | setting DTO | 中优先（写设置影响全局，需快照还原） |

## 2. auth 模块（`modules/auth/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| 会话 | GET `/auth/permissions` | Sign 链 | 无 | — | **基座核心**：登录态拉权限（写权限缓存） |
| 会话 | POST `/auth/signout` | SignFree+DeviceFree | 无 | — | 登出闭环（RT revoke + 清 cookie） |
| 会话 | GET `/auth/keys` | Sign 链 | 无 | — | 响应体 RSA 加密字段（`EncryptResponse('B')`），需客户端私钥解密 |
| opaque/user | POST `/auth/opaque/user/login/start` | JwtFree（Sign 生效：单因子） | 无 | `{userName,start}` | **基座核心**：真实 opaque 登录前半段。
  A 段试点抓出迁移回归并已修：handler 用 `@WalnutDBSession()` 取 ctx.em 但漏挂 `@WalnutDBTransaction()`，txContext 恒 undefined → 匿名调用必 500；已对齐 login/finish 形态补上事务装饰器 |
| opaque/user | POST `/auth/opaque/user/login/finish` | JwtFree + `AuthOpaqueUserGuard`(passport-local userName/finish) | 无 | `{userName,finish}` | **基座核心**：签发 AT/sessionKey + RT cookie |
| opaque/user | POST `/auth/opaque/user/login/client-error` | JwtFree | 无 | `{userName,clientError,...}` | 恒 40103，冒烟 |
| opaque/user | POST `/auth/opaque/user/register/{start,finish}` | JwtFree（但 handler 读 `req.user.userName` —— 语义上是已登录用户补挂口令，新用户注册走 OTP） | 无 | opaque 消息 | 钉现状：匿名调用 500（handler 解引用 undefined）——登记为已知问题，不作为过据点 |
| opaque/user | POST `/auth/opaque/user/change-password/{start,finish}` | Sign 链 | `me:auth:opaque:changePassword` | opaque 消息 | 中优先（真实改密 + 会话吊销） |
| opaque/admin | POST `/auth/opaque/admin/password/update/{start,finish}`、`password/clear` | Sign 链 | `system:user:pass:update` / `clear` | `{id,...}` + opaque 消息 | 中优先（root 管理他人凭证） |
| otp | POST `/auth/otp/send`、`verify` | JwtFree + Functional（settings 缺省放行） | 无 | `{type,identifier,...}` | send 不真发邮件（sendEnable=0）；verify 走 OtpGuard；中优先 |
| refresh | POST `/auth/refresh` | Lock/Sign/MFA/Jwt/Device 全 Free + `JwtRefreshGuard`（RT cookie） | 无 | — | 刷新轮换闭环：RT cookie → 新 AT；高优先 |
| mfa | GET `/auth/mfa/status`、POST `/auth/mfa/verify` | MFAFree+LockFree | 无 | verify `{type,code}` | 高优先（MFA 闭环：绑定 totp → verify → 新 AT） |
| google | POST `/auth/google`、POST `/auth/google/callback` | Jwt/Sign Free + Functional + `AuthGoogleGuard` | 无 | google id_token | **外部依赖**：API 级只测 functional 关闭/参数缺失错误路径，或跳过 |
| oauth/gitee | GET `/auth/oauth/gitee/url`、GET `/auth/oauth/gitee/callback` | Jwt Free + Functional（callback 另 SignFree + `OAuthGiteeGuard`） | 无 | query code | **外部依赖**：url 端点可测（构造跳转 URL）；callback 需真实 gitee code —— 错误路径/跳过 |
| oauth/github | 同 gitee（`/auth/oauth/github/*`） | 同上 | 无 | query code | **外部依赖**：同 gitee |

## 3. security 模块（`modules/security/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| sign | POST `/security/sign/initial` | Sign/Cap/Jwt/Lock/Device/Ip 全 Free（Risk 仍跑） | 无 | `{rsaPubKey,force?}` | **基座核心**：握手第一步 |
| sign | POST `/security/sign/aes-key` | 同上（响应 aesKey 经客户端 RSA 加密） | 无 | — | **基座核心**：握手第二步（客户端私钥解密） |
| rsa | GET `/security/rsa/public-key` | Sign/Jwt/Cap Free | 无 | — | 服务端密钥（app_key 表），冒烟 |
| cap | POST `/security/cap/challenge`、`/security/cap/redeem` | Cap/Jwt/Device/Lock Free（challenge/redeem 另 SignFree） | 无 | challenge/redeem payload | redeem 依赖 Cap.js 本地验证（`@cap.js/server` 本地算题，非外网）——可测；中优先 |
| sensitive | GET `/security/sensitive/check`、POST `/security/sensitive/verify` | Sign 链（`SensitiveGuard` 方法级） | 无 | verify `{basic,action,type,code}` | 中优先（B7c 已钉 service 现状） |

## 4. shared 模块（`modules/shared/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| ali | GET `/shared/ali/sts` | Sign 链 | `app:shared:ali:sts` | — | 需阿里云 vendor key（env 有则冒烟，否则 5xxxx） |
| area | GET `/shared/area/children`、`/shared/area/feedback` | Sign 链 | `system:area:*` | query（父级行政区划） | 只读冒烟；需 seed/自建 area 行 |

## 5. system 模块（`modules/system/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| lang | CRUD 四件（无 delete）+ GET `/system/lang/list/public` | CRUD：Sign 链；public：Lock/Sign/Jwt/Cap/Device 全 Free + 响应缓存 | `system:lang:*` | `{lang,description,order,status}` | **A 段试点**：CRUD + public 端点（缓存装饰器路径） |
| locale | GET `/system/locale/message/:locale?cache=1` | Lock/Sign/Jwt/Cap/Device/Ip 全 Free | 无 | 路由 locale | **A 段试点已覆盖**：message 拉取 + 缓存开关。
  缓存语义已钉现状：locale create/delete 事务提交后全量刷新 message 缓存（runAfterCommit → extractLocaleMessagesIntoCacheForCronJob，会顺带写 `SYS_LANG_ID_LIST`）；绕过 HTTP 的 PG 直插不触发刷新，cache=1 读旧缓存、cache=0 回源 |
| locale | POST `/system/locale`（数组批量 create）、`GET /:key`、`PUT /:id`、`DELETE /:key`、`DELETE /deleteMany/:keys`、`POST /list` | Sign 链 + 事务 | `system:locale:*` | 数组 `{langId,key,value[,oldKey]}` | **A 段试点**（创建/更新/删除走真实事务） |
| dict/type | GET `/system/dict/type/s` + CRUD | Sign 链 | `system:dictType:*` | dict DTO | 后续批次 |
| dict/data | CRUD | Sign 链 | `system:dictData:*` | dict DTO | 后续批次 |
| menu | GET `/system/menu/tree` + CRUD（delete 带 `?cascade=` query） | Sign 链 | `system:menu:*` | menu DTO | 后续批次（权限数据源，配合角色菜单） |
| role | CRUD 四件（无 deleteMany；无 delete） | Sign 链 | `system:role:*` | role DTO | 后续批次 |
| user | CRUD + 状态管理 | Sign 链 | `system:user:*` | user DTO | 后续批次 |
| user/me | PUT `/system/user/me/profile`、GET `security-tab2`、GET `profile` | Sign 链 | `me:profile:update` 等 | — | 后续批次（me 系不加权限串的读端点） |
| device | POST `/system/device/initial`（Sign/Jwt/Cap/Device Free + Throttle）+ GET `:id/current-active-user`、`:id/history-users` + PATCH `:id/{lock,unlock,banned,unbanned}` + read/list | Sign 链 | `system:device:*`（AND 模式组合） | uuid + PATCH | 后续批次 |
| deleted | read/list + `POST me/recover`、`POST recover`（recover 系另有 `@HasRole([root,developer,admin])`） | Sign 链 | `system:deleted:*` | uuid/ids | 后续批次（B9 回收站已有 int-spec） |
| log/auth | CRUD delete/deleteMany/list（`@UseGuards(JwtAccessGuard)` 显式重复挂） | Sign 链 | `system:logAuth:*` | list | 后续批次 |
| log/operate | GET `:id/device`、`:id/snapshot`、read、list | Sign 链 | `system:logOperate:*` | uuid | 后续批次 |
| user_device | GET `list`、PUT `update-name/:deviceId`、DELETE `force-quit/:deviceId`、PUT `lock/:deviceId`、`unlock/:deviceId` | Sign 链 | `system:userDevice:*` | — | 后续批次 |
| user_identity | POST `list`、GET `status/:purpose`、POST `check/bind`、DELETE `unbind`、PUT `update/status`、POST `send-code/verify`（均 `/:type/:purpose`） | Sign 链 | （me 自维度，多数无 @HasPermission） | — | 后续批次（B7c 覆盖 service 层） |
| user_lock | GET `read` + PATCH（lock/unlock me） | LockFree | 无 | — | 后续批次 |
| user_mfa/totp | POST `generate/bind/verify`、DELETE `unbind`、PUT `status`（status 端点挂权限 `system:user:mfa:totp:status`） | MFAFree+LockFree | 大多无 | totp payload | 后续批次（与 auth/mfa 组合闭环） |
| user_mfa/webauthn | POST `register/{options,verify}`、`authenticate/{options,verify}` | MFAFree+LockFree | 无 | webauthn payload | **外部依赖**（浏览器 WebAuthn 凭证不可脚本伪造）：仅测 options 形状/错误路径 |
| user_oauth | `@Controller('system/user/oauth')` 无方法（空壳） | — | — | — | 无端点，标注不测 |
| user_preference | GET `read`（Lock/Sign/MFA/Device/Ip Free）+ PATCH `{basic,accessibility,theme,layout}` | Sign 链 | `me:preference:*` | — | 后续批次 |

## 6. techniques 模块（`modules/techniques/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| health | GET `/app/health/{network,postgres,memory-heap,memory-rss,disk}` | Sign 链 | `app:health:*` | — | 只读冒烟（postgres 端点直接验 PG 连通，迁移回归相关，优先级高） |

## 7. 根 controller（`src/app/`）

| 端点 | 方法/路径 | 守卫 | 权限点 | 请求形态 | API 级测试策略 |
|---|---|---|---|---|---|
| app | GET `/`（DeviceFree+JwtFree）、`/auth`、`/deps` | 其余全局链仍跑 | 无 | — | `/deps` 返回 PG/Redis 连通状态，迁移回归相关，冒烟 |

---

## 汇总

- **controller 数**：45（含 1 个空壳 `system/user/oauth`）。
- **端点数**：约 150（CRUD 工厂展开后）。
- **守卫形态分布**：全公开（全 Free）约 10 个；匿名握手/登录类（JwtFree+Sign 生效）约 12 个；登录态（全链 + 权限点）约 128 个。
- **外部依赖端点**（API 级只测错误路径或跳过）：google / gitee / github 的 callback（真实 OAuth code 不可脚本获得）、webauthn register/authenticate verify（浏览器凭证）。
- **A 段试点**：`app/demo`（标准 CRUD 模板）+ `system/lang` + `system/locale`（含公开 message 端点、批量数组 create、按 key 删除三种非标形态）——
  三份 `*.api-spec.ts` 已落地 `test/api/` 并入 `pnpm test:integration`（23 用例，describe 级握手+登录一次）。
  lang public 端点（`@WalnutAdminDecoratorCache`）已钉现状：命中后 1h TTL 内不回源，lang CRUD 不主动失效该键。
