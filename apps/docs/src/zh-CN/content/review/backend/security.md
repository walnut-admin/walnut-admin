# 安全审查报告 — walnut-admin 后端（apps/server）

> 审查者：SEC（安全 review sub agent）｜日期：2026-11（基于当前工作区源码）
> 方法：security-audit 技能白盒审查（trust boundary → 源码证据 → 优先级/置信度分离）。
> 范围：认证 / 授权 / 输入注入 / 密钥配置 / 传输响应 / 其它入口（socket、SSE、worker、cli）。
> 约束：纯白盒，未运行任何服务、测试或渗透动作；运行时才能定论的条目归入「待用户裁决」。
> 结论先行：整体安全姿态**明显高于同类模板项目**（OPAQUE/WebAuthn/设备握手/双因子签名/RT 轮换/
> OAuth state 加固均有近期 P0/P1 修复记录），但**实时层（socket/SSE）是当前最薄弱的一环**，
> 存在 1 个 P0 与 2 个 P1。

---

## 一、问题清单（SEC-*）

### SEC-001【P0】Socket.IO Admin UI 无认证暴露（`instrument(..., { auth: false })`）

- **证据**：
  - `apps/server/apps/api/src/socket/socket.gateway.ts:69-73`
    ```ts
    instrument(namespace.server, {
      auth: false,
      mode: process.env.NODE_ENV as 'development' | 'production',
      namespaceName: ns,
    })
    ```
  - `apps/server/apps/api/src/socket/socket.adapter.ts:22-28`：socket 服务 path 取 env `SOCKET_SERVER_PATH`（部署为 `walnut-path`），独立端口 `SOCKET_SERVER_PORT`（部署为 5173）。
  - `deploy/nginx/conf.d/frontend.conf:78-91`：`location /socket/ { proxy_pass http://backend:5173/walnut-path/; ... }` —— `/socket/admin` 会被代理到 `/walnut-path/admin`。
  - `deploy/docker-compose.yml:7-9`：仅 nginx 发布 80/443，即 socket 流量**必然**经这条反代出去。
- **问题描述**：`@socket.io/admin-ui` 的 `instrument` 以 `auth: false` 挂载，即管理台**无任何认证**，且不分环境（`mode` 只影响展示）。socket 服务经 nginx `/socket/` 反代公网可达，admin UI 的约定路径是 `<socket path>/admin`。
- **攻击场景**：任何人打开 `https://<域名>/socket/admin` 即可以管理员身份连接：查看全部连接（`socket.data` 里的 userId/deviceId/fingerprint）、任意 join/leave 房间、向任意房间 emit 事件（如向全站广播 `FORCE_QUIT` 骚扰/钓鱼）、强制断开任意客户端 —— 实时层被整体接管；同时泄露在线用户身份关系数据。
- **影响**：实时层完整控制 + 用户在线数据泄露；`auth: false` 属于明确关闭显式安全控制。
- **修复建议**：生产/预发必须 `auth: { user, password }`（强口令入 env 加密通道）或按环境条件性不挂 `instrument`；同时评估是否应把 admin UI 路径从公网反代中排除（nginx `location ~* ^/socket/admin` → 404，参照 `/health/` 的做法）。
- **置信度**：高（源码 + 部署配置双向印证；最终公网可达性建议部署后一次验证，见「待用户裁决」1）。

---

### SEC-002【P1】Socket.IO 握手不验签：用 `jwtService.decode` 解析 Bearer token

- **证据**：
  - `apps/server/apps/api/src/socket/socket.middleware.ts:42`
    ```ts
    const payload = await this.tokenService.decodeAccessToken(authHeader)
    ```
  - `apps/server/libs/token/src/token.service.ts:114-122`：`decodeAccessToken` 实现是 `this.jwtService.decode(token)`（注释即「decode access token」——只 base64 解 payload，**不校验签名、不校验过期**）。
  - `apps/server/apps/api/src/socket/socket.gateway.ts:88-93`：`client.join(WalnutAdminSocketRooms.USER(userId, fingerprint))` —— 房间键完全来自未验证的 payload 与客户端头。
- **问题描述**：HTTP 侧 JWT 校验走 passport（验签 + 过期 + Redis 会话键三重校验，`jwt-access.strategy.ts:36-51`），而 socket 握手只做 decode。攻击者可用**任意自编 payload** `{"userId":"<受害者id>"}` 通过握手。
- **攻击场景**：伪造 `Authorization: Bearer <自编 JWT>` + 任选 fingerprint 头 → 加入 `USER(受害者userId, fp)` 房间 → 收到本应只发给受害者的 socket 事件（`FORCE_QUIT` 策略通知、monitor 事件，见 `user.shared.service.ts:44-58`）；并可批量伪造「在线用户」污染监控面；还可携受害者 userId/deviceId 触发 `handleSocketInitForceQuit` 查询（只读，无写副作用，已核实 `monitor/user/user.service.ts:103-121`）。
- **影响**：实时层身份伪造（事件泄露/社会工程面/监控污染），不直接拿到会话凭据。
- **修复建议**：握手改用验签通道（`jwtService.verifyAsync` + 与 HTTP 同一套会话键存在性校验），失败一律 `next(new Error(...))`。
- **置信度**：高。

---

### SEC-003【P1】OAuth 结果（accessToken + 原始 sessionKey）经匿名、可劫持的 SSE 频道投递

- **证据**：
  - `apps/server/apps/api/src/modules/auth/modules/oauth/gitee/gitee.controller.ts:135-145`（github 同构，`github.controller.ts:145`）
    ```ts
    // @pseudo
    const successPayload = { success: true, data: { event: ..., accessToken, sessionKey: authSessionKey } }
    this.sseService.sendToClient(this.getSseClientId(fingerprint), successPayload)
    ```
  - `gitee.controller.ts:170-179`：SSE 订阅端点 `@Sse('sse/:fp')` 仅 `@WalnutAdminGuardSignFree()`，**无 JWT/设备/签名校验**，频道键 `oauth/gitee/<fp>` 完全由 URL 参数决定。
  - `libs/sse/src/sse.service.ts:12-16`：`createClient` 直接 `clients.set(clientId, subject)` —— 同名订阅**覆盖**旧频道。
  - `libs/auth/src/modules/shared/shared.service.ts:46`：`authSessionKey` 是 OPAQUE/登录会话根密钥（客户端签名派生的 IKM，Redis 只存哈希，`session.service.ts:127-172`）。
- **问题描述**：OAuth 登录结果中最敏感的两件东西（AT + 会话根密钥）经一个无认证 SSE 频道投递；频道键是客户端可控的 fingerprint，且后订阅者会覆盖先订阅者（原订阅者的 Subject 被替换，token 流向新订阅者）。
- **攻击场景**：知道受害者 fp 的攻击者（共享设备、客户端指纹可预测/泄露、或同机多标签页场景）在受害者完成 IdP 授权前订阅 `oauth/gitee/<受害者fp>` → 受害者的 AT 与 sessionKey 投递给攻击者。注：OAuth `state` 已有 HMAC+nonce+设备绑定（`oauth-state.service.ts`，P2-13 修复），本条是**投递通道**侧的残余缺口。
- **影响**：凭据经未认证信道明文投递 + 信道可劫持；AT 实际可用性还受 (userId, deviceId, sid) 三元组会话校验限制（`jwt-access.strategy.ts`），但 sessionKey 已属根密钥材料泄露。
- **修复建议**：SSE 订阅端点绑定 deviceId 签名 cookie（与 state 的设备绑定同源校验）；`createClient` 改为幂等复用/拒绝同名重建；或改投递后由前端用一次性短 ticket 拉取。
- **置信度**：高（机制）；实际利用前提「知晓 fp」为中等。

---

### SEC-004【P1】OAuth SSE `createClient` 覆盖语义的伴生 DoS（同 fp 后到者顶掉先到者）

> 说明：与 SEC-003 同根因（`sse.service.ts:12-16`），单列以突出可用性面：攻击者对公开可枚举的 `sse/:fp` 连续以同名 fp 订阅，可让受害者的 OAuth/登录结果投递到攻击者频道或黑洞（后订阅者覆盖后，先订阅者的连接 `res.on('close')` 才会清理）。修复同 SEC-003。**置信度**：高。

---

### SEC-005【P2】Scalar/OpenAPI 文档全环境未认证暴露

- **证据**：
  - `apps/server/apps/api/src/main.ts:139-151`
    ```ts
    const openapiPrefix = 'api'
    app.use(`/${openapiPrefix}`, apiReference({ content: documentFactory, theme: 'moon' }))
    ```
    无任何 `NODE_ENV` / guard 判断；这是 raw express 挂载，**绕过全部 guard 链**（对照 `probes.composition.ts` 对 raw 路由逃逸增强链的说明）。
  - `apps/server/AGENTS.md:164` 自述「**开发模式下** Scalar API Reference 在 /api」—— 文档口径与实现不符。
- **问题描述**：生产环境任何人可访问 `/api` 拿到完整 OpenAPI 文档（47 个 controller 全部路由、DTO、参数、错误码语义），等于把攻击面地图送给扫描器；`/config` 等路径黑名单（`security.guard.ts:17-31`）不含 `/api`。
- **影响**：信息泄露（非机密但显著降低攻击成本），文档与实现口径漂移。
- **修复建议**：prod/stage 不挂载或加环境判断；如需线上保留，加入 nginx 侧 allowlist/IP 白名单；同时把该路径纳入部署后验证脚本。
- **置信度**：高。

---

### SEC-006【P2】密钥材料与敏感数据写入日志

- **证据**（多处）：
  - `libs/auth/src/modules/shared/shared.service.ts:30`
    ```ts
    this.logger.log(`Auth Session created, sessionId: ${sessionId}, authSessionKey: ${authSessionKey.toString('base64')}`)
    ```
    —— 登录会话**根密钥原文**进日志。
  - `libs/guards/src/guards/cap.guard.ts:145-147`：`CAP verification passed - Token: ${capToken}`。
  - `libs/guards/src/guards/sign.guard.ts:158-163`：签名 mismatch 时打印 `Client sign / Server sign / Raw`（raw 含完整 body）。
  - `libs/auth/src/modules/oauth/github/github.strategy.ts:44`：`oauth github: ${JSON.stringify(profile)}`（PII）。
  - `libs/auth/src/modules/refresh/shared/refresh.shared.service.ts` 与 `socket.service.ts:29/45/58/72`：事件数据 `JSON.stringify` 全量进日志。
- **问题描述**：日志管道（Winston 轮转、`/app/logs` 卷挂载持久化，`docker-compose.yml:33`）里出现密钥原文、token、请求 body。LoggerMiddleware 在 prod 有 ``maskSensitiveFields``（`logger.middleware.ts:53-55`），但上述 guard/service 层日志不走该脱敏。
- **攻击场景**：日志被运维/攻击者（拿到容器或日志卷）读取 → sessionKey 原文泄露（配合同时段 AT/日志中的 RT jti 可缩短伪造路径）；capToken 重放窗口内可复用。
- **影响**：横向信息泄露面；与「最小日志」原则冲突。
- **修复建议**：删除/脱敏 sessionKey、capToken、sign 原文与完整 body 的日志；对 `sendToRoom` 类日志做字段白名单。
- **置信度**：高。

---

### SEC-007【P2】`trust proxy: true` + header-first 取 IP：IP 维度控制与部署形态强耦合

- **证据**：
  - `apps/server/apps/api/src/main.ts:71`：`app.set('trust proxy', true)`（不校验跳数）。
  - `middleware/src/ip.middleware.ts:15-18`：`requestIp.getClientIp(req)` 直接读 `X-Forwarded-For` 等 header 取首个地址为 `req.realIp`。
  - 全部 IP 维度控制消费 `realIp`：IP 黑名单（`ip.guard.ts:35`）、扫描路径自动永久拉黑（`blacklist-path.middleware.ts:46`）、限流 tracker（`throttler.guard.ts:34-36`）、设备 IP 变更跟踪（`device.guard.ts:86-100`）、风控与失败登录（`risk.guard.ts:39`）。
  - 缓解面：`deploy/nginx/conf.d/api.conf:50-57` 与 `frontend.conf:58-75` 已按 P0-5 口径**覆写**（非追加）XFF/X-Real-IP 为 `$remote_addr`；`docker-compose.yml` 只发布 80/443。
- **问题描述**：源码自身不设防，靠边缘 nginx 覆写头兜底。任何绕过边缘的路径（直连 3000/5173 的运维通道、未来加的第二层代理、或 nginx 配置回退成 `$proxy_add_x_forwarded_for`）都会让 IP 黑名单/限流/风控整体失效，且**永久拉黑可被用来嫁祸任意 IP**（含代理自身 IP → 全站拒绝服务）。
- **影响**：条件性高危；当前部署形态下降为加固项。
- **修复建议**：`trust proxy` 改为具体跳数/网段；IpMiddleware 显式声明可信头来源（如仅 `X-Real-IP` 且仅当 `req.ips` 深度 = 预期）；在 README/部署文档之外的**代码注释**中保留该耦合警示（现有 api.conf 注释很好，但代码侧无提示）。
- **置信度**：高（代码事实）；实际可利用性取决于部署（当前部署已缓解）。

---

### SEC-008【P2】Ali OSS STS：非 visitor 用户签发无 policy 约束的全角色权限 token

- **证据**：`libs/app-domain/src/shared/ali/ali.service.ts:44-63`
  ```ts
  // @pseudo
  const policy = JSON.stringify({ Statement: [{ Effect: 'Allow', Action: ['oss:GetObject', 'oss:ListObjects'], Resource: '*' }], Version: '1' })
  ...
  user.currentRoleName === Role.VISITOR ? policy : undefined,   // 非 visitor 不带 policy
  ```
- **问题描述**：visitor 拿只读 STS，其余登录用户（仅需 `app:shared:ali:sts` 权限）拿到的 STS 无 policy 限制 → 继承 roleArn 的全部权限（通常含写/删）。前端直传 OSS 场景下，该凭据泄露即等于桶级写权限泄露。
- **修复建议**：统一按「最小权限 + 按 userId/路径前缀收窄 Resource」签发 policy；非 visitor 也应限定 Action 集。
- **置信度**：高（源码）；roleArn 实际权限边界需在云侧核实（见待裁决 4）。

---

### SEC-009【P2】异常全量入 Bull→DB 的写入放大 + 限流器为进程内存储

- **证据**：
  - `libs/exceptions/src/exception.filter.ts:60-62`：除 blpath skip 名单外，**所有**异常（含未认证请求打出来的 40099/40101 等）都 `errorReporter.addErrorQueue(...)` 入队，`libs/app-domain/src/error/error.process.ts:19-27` 落库。
  - `libs/throttle/src/throttler.service.ts:14-23`：ThrottlerModuleOptions 未提供 `storage` → `@nestjs/throttler` 默认**进程内存**存储；multi-replica 或 api/worker 分进程时限流各自计数（当前单容器部署可接受）。
- **攻击场景**：分布式/多来源扫描在限流窗口内制造海量可预期异常（如 400 参数错误）→ 每个异常一个 Bull job + 一行 `sys_error` 插入 → DB/Redis 写放大。
- **修复建议**：4xx 客户端错误不入错误库（或采样/去重）；throttler 换 Redis storage（已有 redis 通道）。
- **置信度**：高（机制）；实际阈值取决于密文 env 的 `APP_THROTTLE_TTL/LIMIT`（白盒不可见，见待裁决 5）。

---

### SEC-010【P3】secrets 校验仅 `@IsString`，JWT 未显式钉算法

- **证据**：`libs/config/src/validation.ts:107-142`（`JWT_ACCESS_TOKEN_SECRET` 等 5 个加密根 + 2 个 JWT secret 全部仅 `@IsString()`，无长度/熵校验）；`libs/token/src/jwt.config.ts:10-15` 与 `libs/auth/src/modules/jwt/jwt-access.strategy.ts:28-33` 未传 `algorithms`（passport-jwt 走默认族）。
- **问题/建议**：弱 secret 可静默启动。建议 env 校验加最小长度（如 ≥32B / base64 32B）；jwt verify 显式 `algorithms: ['HS256']`（当前 secret 为对称串，RS 混淆不可达，属钉死纵深）。
- **置信度**：高。

---

### SEC-011【P3】dev CORS `origin: '*'` + `credentials: true`；stage cookie `secure: false`

- **证据**：`libs/config/src/modules/middleware.config.ts:20`（`allowOrigin: isProd ? 'https://www.<domain>' : '*'`）+ `middleware/src/cors.middleware.ts:23-30`（恒 `credentials: true`）；`libs/cookie/src/cookie.service.ts:37-46`（stage 分支 `secure: false`）。
- **问题/建议**：浏览器会拒绝 `*` + credentials 组合（实际危害有限），但属配置矛盾；stage 环境 cookie 可经明文 HTTP 传输。建议 dev 显式白名单 localhost 域，stage 补 `secure: true`（若 stage 也走 https）。
- **置信度**：高。

---

### SEC-012【P3】UA/Postman 类守卫豁免与检测均为客户端可伪造信号

- **证据**：`middleware/src/user-agent.middleware.ts:52-54`（`isPostman = isDev && UA 含 'PostmanRuntime'`）→ sign/device/cap/security/blacklist-path 守卫对 Postman 全豁免（`sign.guard.ts:84-87`、`device.guard.ts:56-59`、`cap.guard.ts:67-70`、`security.guard.ts:53-55`、`blacklist-path.middleware.ts:33-36`）；`security.guard.ts:81-83` 可疑 UA 关键词黑名单。
- **问题**：`isPostman` 已被 `isDev` 门住（生产无效，OK）；UA 检测是 best-effort（换 UA 即绕过）。建议：在注释/文档标明这些只是噪声过滤而非安全边界（部分已有注释），避免后续依赖。
- **置信度**：高（事实）；风险低。

---

### SEC-013【P3】OPAQUE `startLogin` 用户枚举时序侧信道

- **证据**：`libs/auth/src/modules/opaque/core/opaque.core.service.ts:61-103`：用户不存在/无凭据时**不做** OPAQUE 计算即抛 40103；存在用户则执行 `opaque.server.startLogin` + 写 Redis（`setOpaqueServerStateCache`）。错误码/文案统一（40103），但响应时间与副作用（Redis 写）可区分用户存在性。
- **建议**：对不存在用户执行等时假计算（dummy registration record 的 startLogin 或固定延迟 + 等量 Redis 写）。
- **置信度**：高（机制差异确定）；可利用性中低（需稳定计时）。

---

### SEC-014【P3】`GET /app/setting/private` 无权限装饰器（命名与防护不一致）

- **证据**：`libs/app-domain/src/setting/setting.controller.ts:71-76`：仅 `@WalnutAdminGuardLockFree()`，无 `HasPermission/HasRole` → 任何登录用户（含 visitor 角色）可读。当前实现返回的是前端功能配置（`setting.service.ts:117-145`，maskUrl/watermark 等，非机密）。
- **建议**：补 `HasPermission('app:setting:read')` 或改名 `/frontend-functional`，消除「private 语义 + 零权限」的漂移。
- **置信度**：高。

---

### SEC-015【P3】匿名心跳端点 `POST /app/monitor/user/state` 可自报 userId 关联

- **证据**：`apps/server/apps/api/src/modules/app/monitor/user/user.controller.ts:83-97`（Sign/Jwt/Cap/Device 全 Free，仅要求签名 cookie 的 deviceId）+ `libs/app-domain/src/monitor/user/user.service.ts:38-74`（`updateState` 用 body 中 dto 字段 upsert，`clearUserId` 分支显式写 userId）。
- **问题**：匿名请求可将任意 `userId`（如管理员 id）关联到自己的 monitor 行，污染在线监控（管理员看到的「某管理员在线于此设备」可被伪造），进而诱导管理员误用 `force-quit/:monitorId`。属监控面数据可信性问题，非权限绕过。
- **建议**：`updateState` 的 userId 字段仅在「本次连接确实以该 userId 完成过认证」（如 socket 握手验证后回填）时才接受；或在 DTO 中收窄允许的字段。
- **置信度**：中（`AppMonitorUserDTOUpdateState` 是否白名单 userId 未逐一核对，见待裁决 2）。

---

## 二、已确认的良好实践（抽样核验，供回归基线）

1. **JWT/会话**：AT 校验 = 验签 + 过期 + Redis 会话键存在性（`jwt-access.strategy.ts:36-51`，P0-4）；RT 轮换 revoke-and-insert + 悲观锁防重放（`refresh.shared.service.ts:259-336`）；RT 密文落库（AES-256-GCM，`crypto.service.ts`）。
2. **OAuth**：state = HMAC 签名 + Redis 一次性 nonce + deviceId 绑定（`oauth-state.service.ts`，P2-13/F5）；Google id_token 走 `jose.jwtVerify`（issuer+audience，`google.strategy.ts:52-79`）。
3. **签名链**：双因子 HMAC（会话派生密钥），认证态派生失败直接拒绝不降级（`sign.guard.ts:373-381`，P0-2）；nonce SET NX EX 原子判重（`sign.guard.ts:225-239`）。
4. **输入**：全局 ValidationPipe `whitelist + forbidNonWhitelisted + forbidUnknownValues`（`main.ts:110-125`）；logger/area/cache-key/文件名均有管道级白名单闸；路径穿越在 logger read 有 resolve 包含性断言（`logger.controller.ts:42-50` 注释 + service 兜底）。
5. **密钥治理**：dotenvx 加密 env 入库、`.env.keys` 1Password/CI secret；5 个加密根有「不许改」文档口径；RLS 运行时角色启动强校验且拒绝 dev 引导密码上生产（`pg-app-password.ts:45-63`）。
6. **传输**：helmet + CSP(SELF) + nginx 安全头与 HSTS + `server_tokens off` + `/health/` 双层 404（大小写兜底）；错误响应 `_devMsg` 仅 dev 输出（`utils/response.ts:17-36`）；prod 日志 body/query/params 走 ``maskSensitiveFields``（`logger.middleware.ts:53-55`）。
7. **探针**：裸路由只回 `status/checks` 二值，无版本/主机/耗时（`probes.composition.ts:27-44`），且被 nginx 404 于公网。
8. **cli**：`export-openapi` 仅反射 schema 落 `openapi.json`，无 env/密钥混入（`apps/cli/src/export-openapi.ts`）。

---

## 三、待用户裁决（需运行时验证或产品/部署拍板）

1. **SEC-001 公网可达性确认**：部署后访问 `https://<域名>/socket/admin`（以及直接 `https://api.<域名>/socket/admin` 是否也被代理）验证 admin UI 是否可达；可达即按 P0 处置。★建议最优先。
2. **SEC-015 DTO 字段核对**：`AppMonitorUserDTOUpdateState`（`modules/app/monitor/user/dto/user.dto.ts`）是否白名单放行 `userId`；若放行则按 P2 处置。
3. **SEC-005 产品决策**：生产是否需要在线 API 文档（决定「环境门禁」还是「鉴权/白名单」方案）。
4. **SEC-008 云侧核实**：`VENDOR_KEYS_ALI_OSS_ROLE_ARN` 的实际权限边界；若该角色本身只读则本条降为 P3。
5. **限流基线确认**：`APP_THROTTLE_TTL/LIMIT` 与 SYS:SETTING 动态限流值在 env-encrypted 密文中，白盒不可见；建议在报告中补一次真实值核对（影响 SEC-009 评估）。
6. **Google JWKS 静态 pin**（`google-jwk.ts` 为仓库内常量）：Google 轮换密钥后登录会不可用（可用性而非安全）。建议改为运行时拉取 JWKS + 缓存。
7. **多副本规划**：若未来 api 多副本，SEC-009 的 throttler in-memory 与 SEC-001/002 的影响面都需重估。

---

## 四、统计

| 优先级 | 数量 | 编号 |
|--------|------|------|
| P0 | 1 | SEC-001 |
| P1 | 3 | SEC-002, SEC-003, SEC-004 |
| P2 | 5 | SEC-005, SEC-006, SEC-007, SEC-008, SEC-009 |
| P3 | 6 | SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015 |
| 合计 | 15 | 另含待裁决 7 条 |
