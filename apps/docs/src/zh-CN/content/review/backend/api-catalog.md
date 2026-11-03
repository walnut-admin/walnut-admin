# Walnut Admin 后端接口清单（API Catalog）

> DOC- 任务产出 1/2。范围：`apps/server` 全部 47 个 controller（`apps/api/src` 38 + `libs/app-domain/src` 9），
> 另含 WebSocket gateway、SSE 端点与三组**不进 OpenAPI** 的进程级接口面。
> 生成方式：逐文件通读全部 controller 源码 + 以仓库内 `apps/server/openapi.json`（195 operations / 173 paths，
> 与 `@walnut-server` v0.1.24 一致）做全量机器对账。
> 审查发现（DOC-* 问题清单）见 `api-docs-findings.md`；本文件只陈述现状。

## 0. 全局口径

### 0.1 完整 URL

openapi.json 与本文路径均为**版本前缀之外的相对路径**。运行时完整 URL：

```text
/{APP_API_PREFIX}/v{APP_API_VERSION}<路径>
本地开发 env：/w/v1<路径>     （apps/server/apps/api/test/api/ENDPOINTS.md 头注）
```

URI versioning：`main.ts:100-104`（`VersioningType.URI`，prefix = `{APP_API_PREFIX}/v`）。
openapi.json 无 `servers` 字段，版本前缀未进文档（见 DOC-17）。

### 0.2 全局 Guard 链（除端点显式 Free 外全部穿过）

`apps/api/src/app/app.module.ts:65-138` 从上到下：
IP → Security → Device → Risk(前) → CAP(前) → **JWT** → Risk(后) → CAP(后) → MFA → Sign → Lock
（第 12 位 Throttler 在 `modules/techniques/tech.module.ts` 注册）。
本文「认证」列缩写：`Free` = 端点有对应 `WalnutAdminGuardXxxFree()`；`权限点` = `@WalnutAdminDecoratorHasPermission`；
`角色` = `@WalnutAdminDecoratorHasRole`。未标注 Free 的 JWT/MFA/Sign/Lock 均默认生效。

### 0.3 响应包裹

全局拦截器 `WalnutAdminInterceptorResponseSuccess` 把返回值包成 `{ code, msg, data }`
（`libs/guards/src/interceptors/response/success.interceptor.ts:33-49`）；
全局 `ClassSerializerInterceptor` 开 `excludeExtraneousValues: true`（`main.ts:131-136`）——
**只有带 @Expose 的字段能出站**。挂 `@WalnutAdminDecoratorFreeResponse()` 的端点绕过包裹（裸 body）。
错误约定：统一 HTTP 200 + `body.code = 4xxxx/5xxxx`（全局过滤器 `WalnutAdminFilterExceptionAll` 兜底；
`libs/app-domain/src/error/error.module.ts:44-47`）。错误码全集见 `@walnut/contract` response-code 与
`libs/app-domain/src/error/error.controller.ts:84-135` 的 ErrorMap（46 码）。

### 0.4 Swagger 齐备度判定

- ✅ 齐备：有 @ApiTags + @ApiOperation（summary）+ 200 响应包裹 schema + 路径/请求参数已文档化
- ⚠️ 缺部分：缺 summary 或缺部分参数/描述
- ❌ 缺失：无 summary 且无响应 schema
- 全局性缺口（全站 195 op 无一声明错误响应、无一声明 security）不计入单端点判定，统一见 DOC-03 / DOC-04。

### 0.5 统计总览

| 指标 | 数值 |
|---|---|
| OpenAPI operations | **195**（173 paths，`@walnut/server` 0.1.24） |
| ✅ 齐备 | **147** |
| ⚠️ 缺部分 | **24**（19 个 CRUD 工厂 list 缺 summary + 5 个 health 端点缺 summary 且响应形状非项目壳） |
| ❌ 缺失 | **24**（无 summary 且无响应 schema，清单见 §9） |
| SSE 端点 | 2（已含在 195 内） |
| 非 OpenAPI 接口面 | raw 探针 2 · 静态资源 1 · Scalar 文档 1 · WebSocket gateway 1 |

---

## 1. 组合根（apps/api/src/app/）

### AppController（`app/app.controller.ts`，前缀 `/`）— 标签 `App`（类名默认，DOC-12）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET / | AppController.getHello | DeviceFree + JwtFree（Sign 生效） | — | string（i18n index.hello） | ❌ 无 tags 外注解、无 summary、无 schema |
| GET /auth | AppController.getHelloWithAuth | 全链（JWT 必需） | — | string（index.hello.user） | ❌ 同上 |
| GET /deps | AppController.getPkgDeps | 全链（JWT 必需） | — | `AppBackendDepsResponseDTO`（dependencies/devDependencies：Record<string,string>） | ✅（ApiWalnutOkResponse） |

---

## 2. techniques（apps/api/src/modules/techniques/）

### AppTechHealthController（`techniques/health/health.controller.ts`，前缀 `/app/health`）— 角色硬限 ROOT/DEVELOPER

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /app/health/network | checkNetwork | 权限点 app:health:network | — | terminus ping 结果 | ⚠️ @HealthCheck 自带 200/503 声明；无 summary；**文档 503 实际不可达**（DOC-08） |
| GET /app/health/postgres | checkPostgres | 权限点 app:health:postgres | — | 同上 | ⚠️ 同上 |
| GET /app/health/memory-heap | checkMemoryHeap | 权限点 app:health:memory-heap | — | 同上（阈值 200MB） | ⚠️ 同上 |
| GET /app/health/memory-rss | checkMemoryRSS | 权限点 app:health:memory-rss | — | 同上 | ⚠️ 同上 |
| GET /app/health/disk | checkDisk | 权限点 app:health:disk | — | 同上（阈值 75%，路径按平台） | ⚠️ 同上 |

> 另有 raw 探针 `GET /health/live`、`GET /health/ready`（`app/probes.composition.ts`）：裸 Express 路由，
> 逃逸全部 Nest 增强链与 openapi（设计如此），响应 `{status}` / `{status, checks:{pg,redis}}`，503=draining/依赖 down。

---

## 3. app 域（libs/app-domain/src/** + app 侧 monitor/user 组合根）

### AppKeyController（`libs/app-domain/src/key/key.controller.ts`，前缀 `/app/key`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /app/key/current/{type} | getCurrent | AppKeyCurrentGuard（RSA_PAIR 视图校验权限点 app:key:read；AES 视图登录即可） | path type∈{RSA_PAIR,AES_KEY_URL} | `AppKeyCurrentResponseDTO`（publicKeyPem/keyB64 二选一） | ✅ |
| POST /app/key/init | init | 角色 ROOT | body `AppKeyDTOInit` | `AppKeyDTOSafe` | ❌ 无 summary、无响应 schema（body 经 @Body 反射有文档） |
| POST /app/key/rotate/{type} | rotate | 角色 ROOT | path type | `AppKeyDTOSafe` | ❌ 无 summary、无响应 schema（ApiParam 有） |

### AppLoggerController（`libs/app-domain/src/logger/logger.controller.ts`，前缀 `/app/logger`）— 角色 ADMIN/DEVELOPER

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /app/logger/list | list | 权限点 app:logger:list | body `AppLoggerDTOListRequest` | `AppLoggerDTOListResponse`（列表壳） | ⚠️ CRUD list：有 schema、缺 summary |
| GET /app/logger/{logType}/{fileName} | readFile | 权限点 app:logger:read | path logType∈{application,error}+fileName 白名单；query page | `AppLoggerReadResponseDTO`（30 行/页） | ✅（枚举/白名单管道参数未逐个 @ApiParam，仅 path 反射文档化） |

### AppMonitorCacheController（`libs/app-domain/src/monitor/cache/cache.controller.ts`，前缀 `/app/monitor/cache`）— 角色 ROOT/DEVELOPER

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /app/monitor/cache/{key} | read | 权限点 app:monitor:cache:read | path key（白名单管道） | `{ value: unknown }`（`AppMonitorCacheReadResponseDTO`） | ✅ |
| DELETE /app/monitor/cache/clear | clearCache | 权限点 app:monitor:cache:clear | — | true | ❌ 无 summary、无响应 schema |
| DELETE /app/monitor/cache/deleteMany/{keys} | deleteCache | 权限点 app:monitor:cache:delete | path keys（逗号分割，缓存 key 白名单） | fire-and-forget（data 恒空） | ✅ CRUD deleteMany |
| POST /app/monitor/cache/list | list | 权限点 app:monitor:cache:list | body `AppMonitorCacheDTOListRequest` | `AppMonitorCacheDTOListResponse` | ⚠️ CRUD list 缺 summary |

### AppMonitorServerController（`libs/app-domain/src/monitor/server/server.controller.ts`，前缀 `/app/monitor/server`）
— 角色 ROOT/DEVELOPER；标签 `AppMonitorServer`（**无 @ApiTags，全站唯一非 slash 标签**，DOC-12）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /app/monitor/server/cpu | getCpu | 权限点 app:monitor:server:cpu | — | `AppMonitorServerDTOCPU` | ✅ |
| GET /app/monitor/server/mem | getMem | 权限点 app:monitor:server:memory | — | `AppMonitorServerDTOMem` | ✅ |
| GET /app/monitor/server/os | getOS | 权限点 app:monitor:server:os | — | `AppMonitorServerDTOOS` | ✅ |
| GET /app/monitor/server/sys | getSys | 权限点 app:monitor:server:system | — | `AppMonitorServerDTOSystem` | ✅ |
| GET /app/monitor/server/disk | getDisk | 权限点 app:monitor:server:disk | — | `AppMonitorServerDTODisk[]`（isArray） | ✅ |
| GET /app/monitor/server/battery | getBattery | 权限点 app:monitor:server:battery | — | `AppMonitorServerDTOBattery` | ✅ |
| GET /app/monitor/server/time | getTime | 权限点 app:monitor:server:time | — | `AppMonitorServerDTOTime` | ✅ |
| GET /app/monitor/server/network | getNetwork | 权限点 app:monitor:server:network | — | `AppMonitorServerDTONetwork` | ✅ |

（本 controller 挂 `WalnutAdminInterceptorResponseLooseSerializer` 覆盖全局严格序列化。）

### AppSettingController（`libs/app-domain/src/setting/setting.controller.ts`，前缀 `/app/setting`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /app/setting/public | getPublicSettings | Lock/Sign/Jwt/Cap/Device 全 Free | — | `AppSettingDTOPublicResponse`（auth/frontend 布尔面） | ✅ |
| GET /app/setting/private | getPrivateSettings | **仅 LockFree（登录态）**，无权限点 | — | 匿名对象（maskUrl/hijackRefresh/watermark/transition 四组 {status,mode,value}） | ❌ 无 summary、无响应 schema（ENDPOINTS.md L88 登记「保留为前端变换层形状」→ 待用户裁决 DOC-19） |
| POST /app/setting | create | 权限点 app:setting:create | body `AppSettingDTOCreateRequest` | `AppSettingDTOCreateResponse` | ✅ CRUD |
| GET /app/setting/{id} | read | 权限点 app:setting:read | path uuid | `AppSettingDTOReadResponse` | ✅ CRUD |
| PUT /app/setting/{id} | update | 权限点 app:setting:update | body `AppSettingDTOUpdateRequest` | `AppSettingDTOUpdateResponse` | ✅ CRUD |
| POST /app/setting/list | list | 权限点 app:setting:list | body `AppSettingDTOListRequest` | `AppSettingDTOListResponse` | ⚠️ CRUD list 缺 summary |
| POST /app/setting/cache/refresh | refreshCache | 权限点 app:setting:cache:refresh | — | true | ❌ 无 summary、无响应 schema |

### AppDemoController（`libs/app-domain/src/demo/demo.controller.ts`，前缀 `/app/demo`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /app/demo | create | 权限点 app:demo:create | body `AppDemoDTOCreateRequest` | `AppDemoDTOCreateResponse` | ✅ CRUD |
| GET /app/demo/{id} | read | 权限点 app:demo:read | path uuid | `AppDemoDTOReadResponse` | ✅ CRUD |
| PUT /app/demo/{id} | update | 权限点 app:demo:update | body `AppDemoDTOUpdateRequest` | `AppDemoDTOUpdateResponse` | ✅ CRUD |
| DELETE /app/demo/{id} | delete | 权限点 app:demo:delete | path uuid | `AppDemoDTODeleteResponse` | ✅ CRUD（@WalnutTx） |
| DELETE /app/demo/deleteMany/{ids} | deleteMany | 权限点 app:demo:delete | path uuids | `AppDemoDTODeleteResponse[]` | ✅ CRUD |
| POST /app/demo/list | list | 权限点 app:demo:list | body `AppDemoDTOListRequest` | `AppDemoDTOListResponse` | ⚠️ CRUD list 缺 summary |

### AppErrorController（`libs/app-domain/src/error/error.controller.ts`，前缀 `/app/error`）— 角色 ROOT/DEVELOPER + 权限点 app:error:test

| 方法 路径 | handler | 认证 | 入参 | 出参 | Swagger |
|---|---|---|---|---|---|
| GET /app/error/{code} | error40000 | + `@WalnutAdminDecoratorDevOnly`（非 dev 环境不可用） | path code∈46 码枚举（枚举外 40099） | **恒抛异常**（ErrorMap 40000~50500，无成功路径） | ❌ 文档声明 200 无 schema——与「恒抛」实现不符（DOC-07/09） |

### SharedAliController（`libs/app-domain/src/shared/ali/ali.controller.ts`，前缀 `/shared/ali`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /shared/ali/sts | getSTSToken | 权限点 app:shared:ali:sts | — | `SharedAliOSSDTO`（三个敏感字段为 RSA 信封串，@WalnutAdminDecoratorEncryptResponse） | ✅ |

### SharedAreaController（`libs/app-domain/src/shared/area/area.controller.ts`，前缀 `/shared/area`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /shared/area/children | getChildren | 权限点 app:shared:area:children:list | query pcode（行政区划白名单管道） | `SharedAreaDTO` | ✅（pcode 由反射文档化为 string） |
| GET /shared/area/feedback | feedback | 权限点 app:shared:area:feedback:list | query codes（@ApiQuery + 逗号分割数组管道） | `SharedAreaDTO` 树 | ✅（数组语义文档为单 string，DOC-13） |

### AppMonitorUserController（`apps/api/src/modules/app/monitor/user/user.controller.ts`，前缀 `/app/monitor/user`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /app/monitor/user/list | list | 权限点 app:monitor:user:list | body `AppMonitorUserDTOListRequest` | `AppMonitorUserDTOListResponse` | ⚠️ CRUD list 缺 summary |
| GET /app/monitor/user/{id} | read | 权限点 app:monitor:user:read | path uuid | `AppMonitorUserDTOReadResponse` | ✅ CRUD |
| DELETE /app/monitor/user/force-quit/{id} | forceQuit | 权限点 app:monitor:user:forceQuit | path uuid | service 直返（boolean） | ❌ 无 summary、无响应 schema |
| POST /app/monitor/user/state | monitor | Sign/Jwt/Cap/Device 全 Free（匿名心跳） | body `AppMonitorUserDTOUpdateState` | service 直返 | ❌ 无 summary、无响应 schema |

---

## 4. auth 域（apps/api/src/modules/auth/**）

### AuthController（`auth/auth.controller.ts`，前缀 `/auth`，标签 auth）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /auth/permissions | getPermission | 全链（登录态） | — | `AuthCorePermissionsDTO`（菜单/路由树+权限串+affixedTabs+iframe） | ✅ |
| POST /auth/signout | signout | SignFree + DeviceFree | — | boolean | ✅ |
| GET /auth/keys | getSecretKeys | 全链（登录态） | — | `AuthSecretKeysResponseDTO`（B=RSA 信封串） | ✅ |

### AuthRefreshController（`auth/modules/refresh/refresh.controller.ts`，前缀 `/auth/refresh`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /auth/refresh | refreshAccessTokenByRefreshToken | Lock/Sign/MFA/Jwt/Device 全 Free + `JwtRefreshGuard`（RT cookie） | RT_JTI cookie（经 @WalnutAdminDecoratorJti） | `AuthSuccessDTO`（accessToken）+ 回种 RT cookie | ✅ |

### AuthMfaController（`auth/modules/mfa/mfa.controller.ts`，前缀 `/auth/mfa`）— MFAFree + LockFree

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /auth/mfa/status | getAvailableMethods | 登录态 | — | `AuthMfaStatusDTO[]`（isArray） | ✅ |
| POST /auth/mfa/verify | verify | 登录态 | body `AuthMfaVerifyDTO` | `AuthSuccessDTO` + RT 轮换回种 | ✅ |

### OtpController（`auth/modules/otp/otp.controller.ts`，前缀 `/auth/otp`）— JwtFree + Functional + 系统数据通道

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /auth/otp/send | sendOtp | 匿名（Functional 闸 + 动态限流） | body `OtpSendDTO` | boolean | ✅ |
| POST /auth/otp/verify | authWithOtp | 匿名 + `OtpGuard` | body `OtpVerifyDTO` | `AuthSuccessDTO` + RT cookie | ✅ |

### AuthGoogleController（`auth/modules/google/google.controller.ts`，前缀 `/auth/google`）— JwtFree + SignFree + Functional(defaultClosed)

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /auth/google | login | 匿名 + `AuthGoogleGuard` | google id_token（guard） | `AuthSuccessDTO` | ✅ |

### OAuthGithubController / OAuthGiteeController（`auth/modules/oauth/{github,github}`，前缀 `/auth/oauth/{github,gitee}`）— JwtFree + Functional 闸

| 方法 路径 | handler | 认证 | 入参 | 出参 | Swagger |
|---|---|---|---|---|---|
| GET .../url | OAuth | 匿名 | — | 跳转 URL 字符串 | ❌ 无 summary、无 schema |
| GET .../callback | callback | 匿名 + SignFree + `OAuth*Guard` | query code（provider 回调）+ state | **@Render HTML 页**（非 JSON） | ❌ 无 summary、无 schema；内容类型文档失真（DOC-15） |
| GET .../sse/{fp} | sse | 匿名 + SignFree | path fp | **SSE 事件流**（`IWalnutAdminSseClientData`，event=token:gitee/github） | ❌ 无 summary、无 schema、无 event-stream 类型（DOC-14） |

### AuthOpaqueAdminController（`auth/modules/opaque/admin/opaque.admin.controller.ts`，前缀 `/auth/opaque/admin`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST .../password/update/start | changePasswordStart | 权限点 system:user:pass:update | body `AuthOpaqueStartChangePasswordForAdminDTO` | string | ✅ |
| POST .../password/update/finish | changePasswordFinish | 同上 | body `AuthOpaqueFinishChangePasswordForAdminDTO` | boolean | ✅ |
| POST .../password/clear | clearPasswordFinish | 权限点 system:user:pass:clear | body `AuthOpaqueClearPasswordForAdminDTO` | boolean | ✅ |

### AuthOpaqueUserController（`auth/modules/opaque/user/opaque.user.controller.ts`，前缀 `/auth/opaque/user`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST .../login/start | startLogin | 匿名（JwtFree + Functional） | body `AuthOpaqueStartSignInDTO` | string | ✅ |
| POST .../login/client-error | reportClientError | 匿名（JwtFree） | body `AuthOpaqueClientErrorDTO` | **恒抛 40103**（文档声明 boolean 200） | ⚠️ 有 summary+schema，但实现恒抛——文档与实现不符（DOC-20） |
| POST .../login/finish | finishLogin | 匿名 + `AuthOpaqueUserGuard` | body `AuthOpaqueFinishSignInDTO` | `AuthSuccessDTO` | ✅ |
| POST .../register/start | startRegister | **登录态**（P1-3 修复，无 Free） | body `AuthOpaqueStartSignUpDTO` | string | ✅ |
| POST .../register/finish | finishRegister | 登录态 | body `AuthOpaqueFinishSignUpDTO` | boolean | ✅ |
| POST .../change-password/start | changePasswordStart | 权限点 me:auth:opaque:changePassword + Functional | body `AuthOpaqueStartChangePasswordDTO` | string | ✅ |
| POST .../change-password/finish | changePasswordFinish | 同上 | body `AuthOpaqueFinishChangePasswordDTO` | boolean | ✅ |

---

## 5. security 域（apps/api/src/modules/security/**）

### SecurityCapController（`security/cap/cap.controller.ts`，前缀 `/security/cap`）— Cap/Jwt/Device/Lock Free + 动态限流

| 方法 路径 | handler | 认证 | 入参 | 出参 | Swagger |
|---|---|---|---|---|---|
| POST /security/cap/challenge | getChallenge | 匿名 + SignFree | — | cap.js 原生 challenge（**FreeResponse，无包裹壳**） | ❌ 无 summary、无 schema |
| POST /security/cap/redeem | getRedeem | 匿名 + SignFree | body cap.js `Solution` | `{success:boolean}`（无壳） | ❌ 无 summary、无 schema |

### SecurityRsaController（`security/rsa/rsa.controller.ts`，前缀 `/security/rsa`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /security/rsa/public-key | getPublicKey | 匿名 + Sign/Jwt/Cap Free | — | RSA 公钥 PEM 字符串 | ❌ 无 summary、无 schema |

### SecuritySensitiveController（`security/sensitive/sensitive.controller.ts`，前缀 `/security/sensitive`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /security/sensitive/check | checkVerificationStatus | 登录态 | **query level（必填）/type（可选）——文档零记录** | `SecuritySensitiveCheckResponseDTO` | ❌ 无 summary、无 schema、parameters:[]（DOC-02） |
| POST /security/sensitive/verify | verify | 登录态（SensitiveGuard 链路） | body `SecuritySensitiveVerifyRequestDTO` | boolean | ✅ |

### SecuritySignController（`security/sign/sign.controller.ts`，前缀 `/security/sign`）— Sign/Cap/Jwt/Lock/Device/Ip 全 Free

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /security/sign/initial | initial | 匿名 | body `SecuritySignHandShakeRequestDTO` | 握手结果（service 直返） | ❌ 无 summary、无 schema |
| POST /security/sign/aes-key | getAesKey | 匿名 | — | `SecuritySignSessionKeyResponseDTO`（aesKey=RSA 信封串） | ✅ |

---

## 6. system 域（apps/api/src/modules/system/**）

### SysDeletedController（`system/deleted/deleted.controller.ts`，前缀 `/system/deleted`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /system/deleted/{id} | read | 权限点 system:deleted:read | path uuid | `SystemDeletedDTOReadResponse`（content 已脱敏） | ✅ CRUD |
| DELETE /system/deleted/deleteMany/{ids} | deleteMany | 权限点 deleteMany + 角色 ROOT/DEVELOPER/ADMIN | path uuids | `SystemDeletedDTODeleteResponse[]` | ✅ CRUD |
| POST /system/deleted/list | list | 权限点 system:deleted:list | body `SystemDeletedDTOListRequest` | `SystemDeletedDTOListResponse`（omit content） | ⚠️ CRUD list 缺 summary |
| POST /system/deleted/me/recover | recoverMine | 权限点 system:deleted:recover:mine | body `SysDeletedDTORecoverRequest` | service 直返 | ❌ 无 summary、无 schema |
| POST /system/deleted/recover | recover | 权限点 recover + 角色 ROOT/DEVELOPER/ADMIN | body `SysDeletedDTORecoverRequest` | service 直返 | ❌ 无 summary、无 schema |

### SysDeptController（`system/dept/dept.controller.ts`，前缀 `/system/dept`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| GET /system/dept/tree | tree | 权限点 system:dept:list | — | `SysDeptDTOTree[]`（isArray） | ✅ |
| GET /system/dept/children | children | 权限点 system:dept:list | query parentId（可选，uuid 正则手校） | `SysDeptDTOSafe[]` | ✅（@ApiQuery） |
| GET /system/dept/{id}/subtree | subtree | 权限点 system:dept:list | path uuid | `SysDeptDTOTree` | ✅ |
| POST /system/dept | create | 权限点 system:dept:create | body `SysDeptDTOCreateRequest` | `SysDeptDTOCreateResponse` | ✅ CRUD |
| GET /system/dept/{id} | read | 权限点 system:dept:read | path uuid | `SysDeptDTOReadResponse` | ✅ CRUD |
| PUT /system/dept/{id} | update | 权限点 system:dept:update | body `SysDeptDTOUpdateRequest` | `SysDeptDTOUpdateResponse` | ✅ CRUD |
| DELETE /system/dept/{id} | delete | 权限点 system:dept:delete | path uuid | `SysDeptDTODeleteResponse` | ✅ CRUD |
| POST /system/dept/list | list | 权限点 system:dept:list | body `SysDeptDTOListRequest` | `SysDeptDTOListResponse` | ⚠️ CRUD list 缺 summary |

### SysDeviceController（`system/device/device.controller.ts`，前缀 `/system/device`）

| 方法 路径 | handler | 认证 | 入参 | 出参 data | Swagger |
|---|---|---|---|---|---|
| POST /system/device/initial | initial | Sign/Jwt/Cap/Device 全 Free + 动态限流 | body `SysDeviceDTOInitialRequest` | `SysDeviceDTOInitialResponse` + 种 DEVICE_ID cookie | ✅ |
| GET /system/device/{id}/current-active-user | getCurrentUser | 权限点 read+getCurrentUser（AND） | path uuid | `SysUserDTOReadResponse` | ✅ |
| GET /system/device/{id}/history-users | getHistoryUsers | 权限点 read+getHistoryUsers（AND） | path uuid | `SysDeviceDTOHistoryUsersResponse[]`（isArray，P3-11 补） | ✅ |
| PATCH /system/device/{id}/lock | lock | 权限点 read+lock（AND） | path uuid | boolean | ✅ |
| PATCH /system/device/{id}/unlock | unlock | 权限点 read+unlock（AND） | path uuid | boolean | ✅ |
| PATCH /system/device/{id}/ban | ban | 权限点 read+ban（AND） | path uuid | boolean | ✅ |
| PATCH /system/device/{id}/unban | unban | 权限点 read+unban（AND） | path uuid | boolean | ✅ |
| GET /system/device/{id} | read | 权限点 system:device:read | path uuid | `SysDeviceDTOReadResponse` | ✅ CRUD |
| POST /system/device/list | list | 权限点 system:device:list | body `SysDeviceDTOListRequest` | `SysDeviceDTOListResponse` | ⚠️ CRUD list 缺 summary |

### SysDictDataController（`system/dict/dictData/dictData.controller.ts`，前缀 `/system/dict/data`）— 标准 CRUD 六件

| 方法 路径 | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|
| POST /system/dict/data | 权限点 system:dict:data:create | `SysDictDataDTOCreateRequest` → CreateResponse | ✅ |
| GET /system/dict/data/{id} | system:dict:data:read | uuid → ReadResponse | ✅ |
| PUT /system/dict/data/{id} | system:dict:data:update | UpdateRequest → UpdateResponse | ✅ |
| DELETE /system/dict/data/{id} | system:dict:data:delete | uuid → DeleteResponse（@WalnutTx 级联 locale） | ✅ |
| DELETE /system/dict/data/deleteMany/{ids} | system:dict:data:deleteMany（P1-12 补接线） | uuids → DeleteResponse[] | ✅ |
| POST /system/dict/data/list | system:dict:data:list | ListRequest → ListResponse | ⚠️ list 缺 summary |

### SysDictTypeController（`system/dict/dictType/dictType.controller.ts`，前缀 `/system/dict/type`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/dict/type/s | getDictByType | **登录即可（P2-20 登记豁免）** | query types（必填，逗号分割）→ `SysDictTypeDTOWithDictDataResponse[]` | ✅（数组语义文档为 string，DOC-13） |
| CRUD 五件（create/read/update/delete/list） | — | 权限点 system:dict:type:* | 同标准 CRUD | ✅（list ⚠️ 缺 summary） |

### SysEmployeeController（`system/employee/employee.controller.ts`，前缀 `/system/employee`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| POST /system/employee/{id}/bind-user | bindUser | 权限点 system:employee:update（@WalnutTx） | body `SysEmployeeDTOBindUserRequest` → `SysEmployeeDTOUpdateResponse` | ✅ |
| POST /system/employee/{id}/unbind-user | unbindUser | 同上 | — → `SysEmployeeDTOUpdateResponse`（幂等） | ✅ |
| CRUD 五件 | — | 权限点 system:employee:* | 同标准 CRUD | ✅（list ⚠️ 缺 summary） |

### SysUserMfaTotpController（`system/identity/mfa/totp.controller.ts`，前缀 `/system/user/mfa/totp`）— MFAFree + LockFree

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| POST .../generate | generateTotp | 登录态 | — → `SysUserMfaGenerateTotpResponseDTO`（secret+QR） | ✅ |
| POST .../bind | bindTotp | 登录态 | body `SysUserMfaBindTotpDTO` → `SysUserMfaBindTotpResponseDTO` | ✅ |
| DELETE .../unbind | unbindDevice | 登录态 | — → boolean | ✅ |
| POST .../verify | verifyTotp | 登录态（兼备用码通道，P3-23） | body `SysUserMfaDeviceVerifyTotpDTO` → `AuthSuccessDTO` + RT 轮换 | ✅ |
| PUT .../status | updateStatus | 权限点 system:user:mfa:totp:updateStatus | body `SysUserMfaUpdateStatusDTO` → boolean | ✅ |

### SysUserMfaWebauthnController（`system/identity/mfa/webauthn.controller.ts`，前缀 `/system/user/mfa/webauthn`）— MFAFree + LockFree

| 方法 路径 | handler | 入参 / 出参 | Swagger |
|---|---|---|---|
| POST .../register/options | generateRegistrationOptions | body `SysUserMfaWebauthnRegisterOptionsDTO` → `SysUserMfaWebauthnRegisterResponseDTO` | ✅ |
| POST .../register/verify | verifyAndSaveRegistration | body `SysUserMfaWebauthnRegisterVerifyDTO` → boolean | ✅ |
| POST .../authenticate/options | generateAuthenticationOptions | — → `SysUserMfaWebauthnAuthenticateOptionsDTO` | ✅ |
| POST .../authenticate/verify | verifyAuthentication | body `SysUserMfaWebauthnAuthenticateVerifyDTO` → `AuthSuccessDTO` | ✅ |

### SysUserController（`system/identity/user.controller.ts`，前缀 `/system/user`）— 标准 CRUD 五件，权限点 system:user:*

| 方法 路径 | 入参 / 出参 | Swagger |
|---|---|---|
| POST /system/user | `SysUserDTOCreateRequest` → `SysUserDTOCreateResponse`（@WalnutTx） | ✅ |
| GET /system/user/{id} | uuid → `SysUserDTOReadResponse` | ✅ |
| PUT /system/user/{id} | `SysUserDTOUpdateRequest` → `SysUserDTOUpdateResponse`（@WalnutTx） | ✅ |
| DELETE /system/user/{id} | uuid → `SysUserDTODeleteResponse`（@WalnutTx） | ✅ |
| POST /system/user/list | `SysUserDTOListRequest` → `SysUserDTOListResponse`（字段裁剪面） | ⚠️ 缺 summary |

### SysUserMeController（`system/identity/user.me.controller.ts`，前缀 `/system/user/me`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| PUT /system/user/me/profile | updateProfile | 权限点 system:user:updateProfile | body `SysUserMeDTOUpdateProfileRequest` → `SysUserDTOSafe` | ✅ |
| GET /system/user/me/security-tab2 | getSecurityTab2Status | 登录态 | — → `SysUserMeSecurityTab2ResponseDTO` | ✅ |
| GET /system/user/me/profile | getProfile | 登录态 | — → `SysUserDTOSafe` | ✅ |
| PATCH /system/user/me/role/switch/{roleId} | switchRole | 登录态 | path uuid → boolean | ✅ |
| PATCH /system/user/me/roleMode/switch/{roleMode} | switchRoleMode | 登录态 | path roleMode（枚举管道）→ boolean | ✅（枚举取值未进 schema，枚举管道参数反射为 string） |

### SysUserDeviceController（`system/identity/user_device.controller.ts`，前缀 `/system/user/device`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/user/device/list | getCurrentUserDeviceList | 权限点 system:user:device:list | — → `SysUserDeviceListDTO` | ⚠️ 有 summary+schema，但描述误写 'get security tab1 status'（DOC-10） |
| PUT .../update-name/{deviceId} | updateUserDeviceName | 权限点 updateName | body `SysUserDeviceUpdateNameDTO` → boolean | ✅ |
| DELETE .../force-quit/{deviceId} | forceQuitUserDevice | 权限点 forceQuit | deviceId 管道 → boolean | ✅ |
| PUT .../lock/{deviceId} | lockUserDevice | 权限点 lock | → boolean | ✅ |
| PUT .../unlock/{deviceId} | unlockUserDevice | 权限点 unlock | body `SysUserLockUnLockDto` → boolean | ✅ |

### SysUserIdentityController（`system/identity/user_identity.controller.ts`，前缀 `/system/user/identity`）— 全部登录态（me 自维度）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| POST /system/user/identity/list | list | 登录态 | body `SysUserIdentityListDTO`（空壳 DTO）→ **service 直返 {data:实体[], total}** | ⚠️ 有 summary；schema 声明 `SysUserIdentityDTO[]`（isArray）与 wire 双重不符（**DOC-01**） |
| GET .../status/{purpose} | getStatus | 登录态 | purpose 枚举管道 → `SysUserIdentityStatusResponseDTO` | ✅ |
| POST .../check/{type}/{purpose} | check | 登录态 | body `SysUserIdentityCheckRequestDTO` → boolean | ✅ |
| POST .../bind/{type}/{purpose} | bind | 登录态 | body `SysUserIdentityBindRequestDTO` → boolean | ✅ |
| DELETE .../unbind/{type}/{purpose} | unbind | 登录态 + Sensitive(account_critical) | → boolean | ✅ |
| PUT .../update/{type}/{purpose} | update | 登录态 + Sensitive(account_critical) | body `SysUserIdentityUpdateDTO` → boolean | ✅ |
| POST .../send-code/{type}/{purpose} | sendCode | 登录态 | → boolean | ✅ |
| POST .../verify/{type}/{purpose} | verify | 登录态 | body `SysUserIdentityVerifyRequestDTO` → boolean | ✅ |
| PUT .../status/{type}/{purpose} | updateStatus | 登录态 + Sensitive(account_critical) | body `SysUserIdentityStatusRequestDTO` → boolean | ✅ |

（type/purpose 路径枚举参数反射为 string，取值集 phoneNumber/emailAddress/idCard/password × login/security 未进 schema。）

### SysUserLockController（`system/identity/user_lock.controller.ts`，前缀 `/system/user/lock`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/user/lock/read | get | LockFree | — → `SysUserLockPreferenceDTO` | ✅（codegen 二期已修为真实 DTO） |
| PATCH /system/user/lock/preference | updatePreference | **登录态（刻意不挂 LockFree，P2-26）** | body `SysUserLockPreferenceUpdateDto` → boolean | ✅ |
| PATCH /system/user/lock | lock | LockFree | body `SysUserLockDoLockDto` → boolean | ✅ |
| PATCH /system/user/lock/unlock | unlock | LockFree | body `SysUserLockUnLockDto` → boolean | ✅ |

### SysUserOauthController（`system/identity/user_oauth.controller.ts`，前缀 `/system/user/oauth`）

空壳 controller（0 个 handler），仍注册 @ApiTags('system/user/oauth') —— openapi 出现空标签组（DOC-12）。

### SysUserPreferenceController（`system/identity/user_preference.controller.ts`，前缀 `/system/user/preference`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/user/preference/read | get | JwtOptional + Lock/Sign/MFA/Device/Ip Free | — → `SysUserPreferenceResponseDTO` | ✅ |
| PATCH .../basic | basic | 权限点 me:preference:updateBasic | body `SysUserPreferenceDTOBasicRequest` → boolean | ✅ |
| PATCH .../accessibility | accessibility | 权限点 updateAccessibility | `SysUserPreferenceDTOAccessibilityRequest` → boolean | ✅ |
| PATCH .../theme | theme | 权限点 updateTheme | `SysUserPreferenceDTOThemeRequest` → boolean | ✅ |
| PATCH .../layout | layout | 权限点 updateLayout | `SysUserPreferenceDTOLayoutRequest` → boolean | ✅ |

### SysLangController（`system/lang/lang.controller.ts`，前缀 `/system/lang`）— CRUD 四件（无 delete）

| 方法 路径 | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|
| POST /system/lang | 权限点 system:lang:create | `SysLangDTOCreateRequest` → CreateResponse | ✅ |
| GET /system/lang/{id} | system:lang:read | → ReadResponse | ✅ |
| PUT /system/lang/{id} | system:lang:update | → UpdateResponse | ✅ |
| POST /system/lang/list | system:lang:list | → ListResponse | ⚠️ 缺 summary |
| GET /system/lang/list/public | Lock/Sign/Jwt/Cap/Device 全 Free + 响应缓存 | — → `SysLangDTOListPublicResponse[]` | ✅ |

### SysLocaleController（`system/locale/locale.controller.ts`，前缀 `/system/locale`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/locale/message/{locale} | getLocaleMessage | Lock/Sign/Jwt/Cap/Device/Ip 全 Free | path locale（枚举管道）+ query cache（默认 1） | ❌ 无 summary/schema；**path 参数 locale 未文档化**；cache 标 required（实可选）（DOC-05） |
| POST /system/locale | create | 权限点 system:locale:create（@WalnutTx） | body=翻译映射 `{key,oldKey?,<langId>:value}`（三段管道后转数组校验） | ❌ **requestBody 完全未文档化**（自定义参数装饰器无 swagger 元数据，DOC-11） |
| GET /system/locale/{key} | read | 权限点 system:locale:read | path key（CRUD Read('key')） | ✅ |
| PUT /system/locale/{id} | update | 权限点 update | 同 create 的映射体 | ❌ requestBody 未文档化（DOC-11） |
| DELETE /system/locale/{key} | delete | 权限点 delete | path key → `SysLocaleDTODeleteResponse[]` | ✅ |
| DELETE /system/locale/deleteMany/{keys} | deleteMany | 权限点 deleteMany | path keys 逗号分割 → `SysLocaleDTODeleteResponse[]` | ✅ |
| POST /system/locale/list | list | 权限点 system:locale:list | → `SysLocaleDTOListResponse` | ⚠️ 缺 summary |

### SysLogAuthController（`system/logs/auth/log.auth.controller.ts`，前缀 `/system/log/auth`）— 显式 `@UseGuards(JwtAccessGuard)` 叠加全局链

| 方法 路径 | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|
| DELETE /system/log/auth/{id} | 权限点 system:log:auth:delete | uuid → `SysLogAuthDTODeleteResponse` | ✅ |
| DELETE .../deleteMany/{ids} | system:log:auth:deleteMany | uuids → DeleteResponse[] | ✅ |
| POST /system/log/auth/list | system:log:auth:list | `SysLogAuthDTOListRequest` → ListResponse | ⚠️ 缺 summary |

### SysLogOperateController（`system/logs/operate/log.operate.controller.ts`，前缀 `/system/log/operate`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/log/operate/{id}/device | getDevice | 权限点 read+getDevice（AND） | uuid → `SysDeviceDTOReadResponse` | ✅ |
| GET /system/log/operate/{id}/snapshot | getSnapshot | 权限点 read+getSnapshot（AND） | uuid → `SysLogOperateDTOSnapshotResponse` | ✅ |
| GET /system/log/operate/{id} | read | 权限点 read | uuid → `SysLogOperateDTOReadResponse` | ✅ |
| POST /system/log/operate/list | list | 权限点 list | `SysLogOperateDTOListRequest` → ListResponse | ⚠️ 缺 summary |

### SysMenuController（`system/menu/menu.controller.ts`，前缀 `/system/menu`）

| 方法 路径 | handler | 认证 | 入参 / 出参 | Swagger |
|---|---|---|---|---|
| GET /system/menu/tree | getTree | 登录态 + **visitor 显式拒绝**（P2-20） | — → `SysMenuDTOTreeResponse`（fullTree/treeWithoutTypeElement/menuActiveNamesOptions） | ✅ |
| CRUD 五件 | — | 权限点 system:menu:*（delete 带 `?_cascade=` 0/1） | 同标准 CRUD | ✅（list ⚠️ 缺 summary；_cascade 标 required 实可选 DOC-16） |

### SysPostController（`system/post/post.controller.ts`，前缀 `/system/post`）— CRUD 五件，权限点 system:post:*（list ⚠️ 缺 summary）

### SysRoleController（`system/role/role.controller.ts`，前缀 `/system/role`）— CRUD 四件（无 delete，P3-7 裁决「角色不删」），权限点 system:role:*（list ⚠️ 缺 summary）

---

## 7. 非 OpenAPI 接口面

### 7.1 WebSocket gateway（`apps/api/src/socket/socket.gateway.ts`）

| 项 | 值 |
|---|---|
| 通道 | socket.io，namespace `walnut-namespace` |
| 握手认证 | `SocketAuthMiddleware`：Bearer AT（decode 校验）+ fingerprint 头 + DEVICE_ID cookie，缺一拒连 |
| 连接行为 | 加入 `user:{userId}:{fingerprint}` 房间；检查强制退出并按策略 emit force:quit |
| Server→Client 事件 | `lock:lock` · `lock:unlock` · `force:quit`（payload `{strategy}`；契约 `@walnut/contract` socket.ts） |
| Client→Server 事件 | `hello`（仅日志回显 `onMessage`，调试面，未进类型契约） |
| 管理面 | `@socket.io/admin-ui` instrument 以 `auth: false` 挂载（socket.gateway.ts:69-73）→ **范围外安全观察**，见待用户裁决 |

### 7.2 SSE（已含在 195 op 内，此处汇总）

| 路径 | 认证 | 事件 |
|---|---|---|
| GET /auth/oauth/github/sse/{fp} | 匿名 + SignFree | `data:` JSON `IWalnutAdminSseClientData<IWalnutAdminSseOAuthPayload>`（event=token:github） |
| GET /auth/oauth/gitee/sse/{fp} | 同上 | event=token:gitee |

### 7.3 其它进程级面

- `GET /health/live`、`GET /health/ready` — raw Express 探针（probes.composition.ts），公开可探测面由 nginx 对外 404 兜底。
- `/{prefix}/v{version}/static/**` — 静态资源（main.ts:86-92）。
- `GET /api` — Scalar API Reference（main.ts:145-151，theme moon）。
- `apps/cli/src/export-openapi.ts` — 离线导出 openapi.json（不监听端口）。

---

## 8. openapi.json ↔ 前端类型契约（生成链）

```text
controller 装饰器反射
  └─ openapi:export   = nest build cli + node dist export-openapi.js（WALNUT_ADMIN_BOOTSTRAP_TASKS=off；需 PG/Redis 在线）
       └─ apps/server/openapi.json（check-in，2 空格 + 尾换行，version=npm_package_version）
            └─ openapi:generate = openapi-typescript → packages/generated/api-types/src/schema.d.ts
                 └─ openapi:check = export + generate + git diff --exit-code（两文件）
  门禁：prepush 'openapi' 段 + CI ci.yml:305「OpenAPI drift」job（fork PR 无 ENV_KEYS 时跳过并打 notice）
```

运行时 Scalar（main.ts）与离线导出共用 `buildSwaggerDocumentOptions()`（common/swagger/swagger.options.ts，
DocumentBuilder 唯一来源）——同源性成立。顺序敏感点（ADR 0022 Decision 4）：wire DTO 留 app、
`SysDeleted` controller 夹在 demo/error 之间的注册序、`/app/monitor/user` 排在 `/app/demo` 前——
schema 键序决定 openapi.json 字节形态，由 diff 门禁兜住。门禁缺陷评估见 DOC-18。

---

## 9. ❌ 缺失端点全集（无 summary 且无响应 schema，24 个）

```text
GET  /                                        （根 hello）
GET  /auth                                    （登录问候）
POST /app/key/init                            POST /app/key/rotate/{type}
POST /app/monitor/user/state                  DELETE /app/monitor/user/force-quit/{id}
GET  /auth/oauth/gitee/url|callback|sse/{fp}
GET  /auth/oauth/github/url|callback|sse/{fp}
GET  /security/rsa/public-key                 POST /security/sign/initial
POST /security/cap/challenge                  POST /security/cap/redeem
GET  /security/sensitive/check                （且 query 参数零文档）
POST /system/deleted/me/recover               POST /system/deleted/recover
GET  /app/error/{code}                        （恒抛，文档 200 失真）
DELETE /app/monitor/cache/clear               GET /app/setting/private
POST /app/setting/cache/refresh               GET /system/locale/message/{locale}（path 参数也缺）
```

## 10. 交叉引用

- 问题清单与修复建议：`apps/docs/src/zh-CN/content/review/backend/api-docs-findings.md`（DOC-01 ~ DOC-20 + 待用户裁决）。
- 历史测绘基线：`apps/server/apps/api/test/api/ENDPOINTS.md`（2026-10-25/26，45 controller 口径）。
- 错误码全集：`libs/app-domain/src/error/error.controller.ts` ErrorMap + `@walnut/contract` response-code.ts。
