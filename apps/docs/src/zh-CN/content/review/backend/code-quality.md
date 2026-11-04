# 代码质量 Review 报告（CQ-）

> Review 范围：`apps/server`（NestJS 12 内部 monorepo：apps/api 组合根 + apps/worker/cli + libs 全集，数量以 `apps/server/libs/` 目录为准）
> 方法：只读调研（read/glob/grep），未改任何源码、未跑测试/构建/连接外部服务。
> 判据：`apps/server/AGENTS.md`（三模式 Repository、Guard 顺序、DTO 硬规矩）、`apps/docs/src/zh-CN/content/backend/{architecture,dto,transactions,configuration,code-style}.md`、ADR 0022。行号以当前工作区为准。

## 总体印象

工程质量整体**高于平均水平**：数据权限 RLS + 基类仓库（`libs/repository/src/pg-base.repository.ts`）设计扎实，软删快照与原行删除同事务、refresh 轮换带悲观锁、大量 P0-P3 编号修复留痕（W2-A、P2-26 等），测试分层（unit 39 spec / integration 18 int-spec / api-spec 45 / e2e 1）与三个 drift spec 门禁齐全。DTO 的 RealPickType/RealPartialType 规矩**全仓零违例**（原生 PickType/PartialType 只出现在包装器 `libs/utils/src/dto.ts` 自身），装饰器顺序有 ESLint 规则实装且抽样未见违例。

主要风险集中在两处：**Socket/SSE 实时通道**（认证不验签 + admin UI 无鉴权 + SSE 订阅无用户绑定，恰好全部落在无测试覆盖的模块）和**全库 `void` fire-and-forget 模式**（Node 默认 unhandled rejection 即进程崩溃）。

---

## Findings

### P0（必须立即修）

#### CQ-001 WebSocket 认证中间件不验签，伪造 JWT 可冒充任意用户接入

- **优先级**：P0（安全漏洞）｜**置信度**：高
- **证据**：
  - `apps/server/apps/api/src/socket/socket.middleware.ts:42`：`const payload = await this.tokenService.decodeAccessToken(authHeader); if (!payload) return next(new Error(...))`
  - `apps/server/libs/token/src/token.service.ts:114-117`：`decodeAccessToken` 实现是 `return await this.jwtService.decode(token)` —— `jwtService.decode` 是 jsonwebtoken 的 **decode（仅 Base64 解码，不验签名）**；对比同文件 `generateJwtAccessToken` 用 `signAsync`。
- **问题**：Socket 握手只检查「能否解码出 payload」，不校验签名。攻击者可自造任意 payload 的假 JWT（header.payload.任意签名）完成握手。
- **影响**：`handleConnection`（socket.gateway.ts:85-116）用伪造 userId 加入 `USER(userId, fingerprint)` 房间，**接收该用户的锁屏/解锁/强制下线等实时事件**，并触发 `handleSocketInitForceQuit` 服务端链路。实时通道鉴权完全失效。
- **修复建议**：改为验签解码（`jwtService.verifyAsync(token, { secret })` 或复用 HTTP guard 验证路径）。
- **备注**：与 security agent 大概率重叠，lead 去重。

#### CQ-002 socket.io admin UI 以 `auth: false` 挂载，无任何鉴权

- **优先级**：P0（安全漏洞）｜**置信度**：高（配置事实）；可利用性取决于 admin UI 端口网络暴露面
- **证据**：`apps/server/apps/api/src/socket/socket.gateway.ts:69-73`：
  ```ts
  instrument(namespace.server, {
    auth: false,
    mode: process.env.NODE_ENV as 'development' | 'production',
    namespaceName: ns,
  })
  ```
  同文件 :31 `// TODO extract to config`（namespace 名亦硬编码）。
- **问题**：`@socket.io/admin-ui` 官方文档明确要求生产必须配 `auth: { user, password }`；`auth: false` 表示 admin UI 直接可连。`mode` 只影响可执行操作（development 可 emit/join/leave，production 只读），**不提供认证**。`NODE_ENV` 直接 as 断言，未校验枚举。
- **影响**：任何能触达该端口的客户端可观测全部连接（socket.data 含 userId/deviceId/fingerprint）、房间与事件流量；development 模式下还能从 admin UI 主动向客户端 emit 事件（伪造 LOCK/FORCE_QUIT 事件面）。
- **修复建议**：生产配置账号口令或按 NODE_ENV gate 掉 instrument；namespace 名与开关外提 config（消 :31 TODO）。
- **备注**：与 security agent 重叠。

### P1（明确缺陷，有实际风险）

#### CQ-003 全库 `void` fire-and-forget 无 `.catch()`：单点 Redis/队列抖动可崩整个进程

- **优先级**：P1（健壮性）｜**置信度**：高（机制确定；触发依赖外部依赖抖动）
- **证据**（grep `void this.` 全量盘点，均无 catch 兜底）：

| 位置 | 调用 | 备注 |
|---|---|---|
| `libs/auth/src/modules/otp/shared/otp.shared.service.ts:47` | sendVerifyCodeEmail 入队 | 验证码邮件 |
| `libs/auth/src/modules/otp/shared/otp.shared.service.ts:51` | sendVerifyCodeTextMessage 入队 | 验证码短信 |
| `libs/guards/src/guards/risk.guard.ts:56` | collectPreAuth | **每个请求的 guard 链上** |
| `libs/guards/src/guards/risk.guard.ts:101` | collectPostAuth | 同上 |
| `libs/guards/src/guards/auth.guard.ts:52` | recordAuth | 认证日志 |
| `libs/guards/src/decorators/log.auth.decorator.ts:38,47` | recordAuth | 同上 |
| `libs/auth/src/modules/otp/otp.service.ts:111` | sendWelcomeByType | 欢迎消息 |
| `libs/auth/src/modules/oauth/github/github.service.ts:177`、`gitee/gitee.service.ts:177`、`google/google.service.ts:41` | sendWelcomeByType | 欢迎邮件 |
| `apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:157`（gitee 同款） | failedLoginRiskService.collect | 失败登录风控（Redis hIncrBy 可抛） |
| `libs/app-domain/src/monitor/cache/cache.controller.ts:93` | cacheService.del | 注释声明是契约（P2-4），但 Redis 异常仍是 unhandled rejection |

- **问题**：Node（本仓 Node 24）默认 `--unhandled-rejections=throw`：`void promise` 只消除 lint 提示，**不捕获 rejection**。以上任何一处 reject（Redis 连不上、Bull add 失败）→ 进程级 unhandledRejection → **API 进程崩溃**。`risk.guard.ts:56` 尤其危险：它在每个请求的 guard 链上。
- **修复建议**：统一封装 `fireAndForget(promise, logger)`（内部 catch 记日志），或逐处补 `.catch`；guard 链两处优先。

#### CQ-004 敏感凭据进日志：authSessionKey、OTP 验证码、fingerprint

- **优先级**：P1（日志规范/安全；与 security agent 重叠，lead 去重）｜**置信度**：高
- **证据**：
  - `libs/auth/src/modules/shared/shared.service.ts:30`：日志输出 `authSessionKey.toString(base64)` —— 会话密钥明文进日志。
  - `libs/queue/src/base.processor.ts:12-16`：`onActive` 打 `Data: JSON.stringify(job.data)` —— `PHONE_VERIFY` 任务 data 含 `{ phoneNumber, verifyCode, expireSeconds }`（`libs/sms/src/sms.service.ts:46-55`），**OTP 验证码全文进日志**；`EMAIL_VERIFY` 同理（`libs/mailer/src/mailer.service.ts:42-51`）。
  - `apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:165`：日志输出 fingerprint（gitee 同款）。
- **影响**：拿到日志读权即可取得会话密钥与在途验证码 —— 验证码进日志使 OTP 爆破面从「猜 6 位数」退化为「读日志」。
- **修复建议**：日志脱敏（queue 处理器只打 jobId 不打 data）；authSessionKey 只打 sessionId。

#### CQ-005 SSE 端点按调用方提供的 fp 订阅，无用户绑定：可订阅他人 OAuth 结果通道

- **优先级**：P1（安全/设计缺陷）｜**置信度**：中高（机制确定；利用需知道/猜中受害者 fingerprint）
- **证据**：`apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:170-179`（gitee 同款）：
  ```ts
  // @pseudo
  @WalnutAdminGuardSignFree()
  @Sse('sse/:fp')
  async sse(@Res() res, @Param('fp') fp: string) {
    const clientId = this.getSseClientId(fp)
    this.sseService.createClient(clientId)
  ```
  回调侧 :145 把 `{ accessToken, sessionKey }` 经 `sendToClient(getSseClientId(fingerprint), ...)` 推给该通道。
- **问题**：订阅者 fp 完全由 URL 参数提供，未与当前 JWT 用户或 OAuth 发起方绑定。已登录用户 A 事先用 B 的 fp 订阅，B 完成 GitHub/Gitee OAuth 后 **A 收到 B 的新 accessToken 与 sessionKey**。fingerprint 还在 :165 日志出现。
- **修复建议**：clientId 并入当前登录用户 id（SSE 端点本身有 JWT guard），回调推送时校验通道属主；或服务端签发一次性订阅票据。
- **备注**：与 security agent 重叠。

#### CQ-006 `trust proxy: true` 使失败登录 IP 黑名单可被 XFF 伪造绕过

- **优先级**：P1（安全；与 security agent 重叠，lead 去重）｜**置信度**：高（机制）；实际风险取决于部署拓扑可信代理层数
- **证据**：`apps/server/apps/api/src/main.ts:71` `app.set('trust proxy', true)`（无条件信任所有代理跳）；`libs/security/src/risk/modules/failedLogin.service.ts:51-78` 失败计数与 `:69` `addToTemporaryBlacklist(ip, ...)` 全按 ip 维度。
- **问题**：`trust proxy: true` 时 `req.ip` 取 X-Forwarded-For 最左侧（客户端可伪造）。攻击者轮换假 XFF 即绕过「失败 N 次 → IP 临时黑名单」，爆破节流失效；IP Guard 黑名单判定面同理受影响。
- **修复建议**：按实际代理层数设 `trust proxy`（如 1）或枚举可信网段；黑名单维度以 deviceId/identifier 为主、ip 为参考。

### P2（质量/可维护性，有实际影响）

#### CQ-007 i18n key `business.auth.emailAlreadyBound` 两种语言文件都不存在

- **优先级**：P2（错误文案一致性）｜**置信度**：高
- **证据**：抛出点 `libs/auth/src/modules/oauth/github/github.service.ts:108` 与 `gitee/gitee.service.ts:108`（`errMsg: business.auth.emailAlreadyBound`）；`apps/api/src/i18n/zh_CN/business.json` 与 `en_US/business.json` 的 `auth` 节均有 `identityAlreadyBound`/`identityAlreadyUsed`，**没有** `emailAlreadyBound`。
- **影响**：GitHub/Gitee 注册邮箱被他用时用户拿到原始 key 而非翻译文案；`auth.login-chain.pg.int-spec.ts:525` 只断言异常类型，拦不住。
- **修复建议**：两语言补 key（或改用已存在的 `identityAlreadyUsed`）；建议加「代码 errMsg key 均存在 i18n 词条」的 drift spec。

#### CQ-008 functional.guard 对设置值 JSON.parse 无兜底：坏配置打挂整个功能域

- **优先级**：P2（健壮性）｜**置信度**：高
- **证据**：`libs/guards/src/guards/functional.guard.ts:55`：`const parsedMainData = JSON.parse(settingCache[mainKey])` 无 try-catch；settingCache 来自 Redis app settings（管理端可写）。
- **影响**：`APP_AUTH_GITHUB` 等嵌套配置值若为非法 JSON，guard 抛 SyntaxError → 未受控 50000；该 guard 挂在模块**所有**端点前，一个坏值打挂整个功能域入口。对照 `libs/cache/src/cache.service.ts:185-192` 的 get 对同类风险有 catch 兜底，此处漏了。
- **修复建议**：包 try-catch，解析失败按「设置缺失」语义走 defaultClosed 分支并告警。

#### CQ-009 dept create/update 与 delete 事务口径不一致：check-then-write 跨事务、防环校验可竞态

- **优先级**：P2（数据一致性）｜**置信度**：高（结构性事实）；并发触发概率中
- **证据**：`apps/api/src/modules/system/dept/dept.controller.ts:98-117` create/update **无 `@WalnutTx()`、不传 em**；:119-131 delete 有 `@WalnutTx()` + `ctx.em`。`libs/system/src/dept/dept.service.ts:36-44`（create：ensureCodeAvailable 读 → create 写，跨两次隐式事务）、:56-111（update：readById → 防环 findSubtreeById :74-77 → update）。注释自证依赖兜底：uq_dept_code「最后防线」(:174)、CYCLE 查询兜底 (:24)。
- **影响**：并发同名 create → 唯一约束兜底但报**未受控 500**（非 40001）；并发两次 move 可各自通过防环校验后落库成环 —— 读侧 CYCLE/buildTree 有兜底不悬挂，但环数据落库、subtree 深度等业务语义失真。
- **修复建议**：create/update 补 `@WalnutTx()` + em 透传（与 delete 对齐）；防环读腿可加 `pessimistic_write` 锁目标父行（对齐文档 refresh 轮换模板）。

#### CQ-010 登录链 duplicate-signin 判定 check-then-act：无锁、实体无部分唯一索引兜底

- **优先级**：P2（竞态）｜**置信度**：中高
- **证据**：`libs/auth/src/modules/refresh/shared/refresh.shared.service.ts:190-192`（读判定 → :203-239 直接写，无锁；对比同文件 `getNewAccessToken` :267 轮换读腿显式 `{ lock: true }`）；`libs/auth/src/modules/refresh/entity/refresh-token.entity.ts:12-44` 索引只有 uq_jti/idx_rt_user/idx_rt_device/idx_rt_expired，**没有** `(user_id, device_id) WHERE NOT revoked` 部分唯一索引。
- **影响**：同设备并发登录两事务都通过判定 → 两条现役 RT 行，破坏注释自述不变量「未撤销行恒恰一行」(:120-123)，duplicate sign-in 保护被并发绕过。
- **修复建议**：migration 加部分唯一索引（冲突转受控 409），或判定读腿加悲观锁。
- **备注**：migration 目录未逐行核对（见待裁决 #6）。

#### CQ-011 `cache.getAllCacheData` 的 BULL 键过滤失效：node-redis v5 批量数组上的子串判断

- **优先级**：P2（正确性，影响监控/清理面）｜**置信度**：高
- **证据**：`libs/cache/src/cache.service.ts:388` `if (key.includes('BULL')) { continue }` —— 而 :269-272 的 P1-2 修复注释明确「node-redis v5 的 scanIterator **按批产出 string[]**」，:392 也按 `Array.isArray(key)` 摊平。数组 `.includes` 是元素全等判断，子串过滤永不命中。
- **影响**：Bull 键（prefix `WALNUT_CACHE_BULL`）混进 MGET 与结果集；`list()`（缓存监控页）被 JSON.parse 失败键污染（:433-439 只 warn 不剔除）；`clear()` 的删除风险低（解析失败恰好被排除），但监控数据与日志失真。
- **修复建议**：摊平后过滤：`keysOfBatch.filter(k => !k.includes('BULL'))`（与 :278-279 同款）。

#### CQ-012 controller 层非空断言掩盖可空契约（`lockPwdHash!` / `sid!` / `operationType!`）

- **优先级**：P2（DTO 硬规矩相关；服务端已有兜底，安全影响有限）｜**置信度**：高
- **证据**：
  - `apps/api/src/modules/system/identity/user_device.controller.ts:111`：`body.lockPwdHash!` —— `SysUserLockUnLockDto = RealPartialType(RealPickType(SysUserLockDto, [lockPwdHash]))`（`libs/identity/src/user_lock/dto/user_lock.dto.ts:111`）全字段可选；服务端兜底在 `libs/identity/src/user_lock/shared/user_lock.shared.service.ts:70-74`（P2-26：security 模式缺密码受控拒绝）——**非 security 模式下不带密码直接解锁**是现状语义，断言把它藏进类型层。
  - `apps/api/src/modules/auth/modules/mfa/mfa.controller.ts:57`：`user.sid!`（sid 由 generateAuthTokens/getNewAccessToken 生成时 spread 补进，见 `libs/auth/src/modules/shared/shared.service.ts:33`）。
  - `apps/api/src/modules/security/sensitive/sensitive.controller.ts:70`：`dto.operationType!`，对应 `libs/security/src/sensitive/sensitive.dto.ts:70` 声明 `operationType?:` 且无 `default: null` —— 正是 AGENTS.md 禁止的双真源形态。
- **影响**：必填性两个真源；sensitive verify 若客户端真省略 operationType，undefined 流入 `verifyAndGrantPermission`，类型面在撒谎。
- **修复建议**：sensitive.dto 的 operationType 改 `default: null` 并显式判空受控 400；其余两处断言改显式校验或 DTO 必填化。

#### CQ-013 SSE 客户端注册：createClient 覆盖不 complete、disconnect 误删新连接

- **优先级**：P2（连接管理正确性）｜**置信度**：高
- **证据**：`libs/sse/src/sse.service.ts:12-16` `createClient` 直接 set 覆盖旧 Subject（不 complete）；`apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:174-177` 每连接 createClient + `res.on(close, () => disconnectClient(clientId))`（gitee 同款）。
- **问题**：同一 fingerprint 开两个标签页：tab2 覆盖 tab1 的 Subject；tab1 关闭时 disconnectClient complete 的是 **tab2 的 Subject** —— tab2 的 SSE 流被静默终结、OAuth 结果丢失；tab1 旧 Subject 泄漏。
- **修复建议**：clientId 加连接级唯一后缀（fp + nanoid），或覆盖前 complete 旧实例、disconnect 按实例而非 key。

#### CQ-014 验证码投递失败不可观测：attempts:3 + removeOnFail:true + 入队 fire-and-forget

- **优先级**：P2（可观测性）｜**置信度**：高
- **证据**：`libs/mailer/src/mailer.service.ts:50`、`libs/sms/src/sms.service.ts:54`：`{ removeOnComplete: true, removeOnFail: true, attempts: 3, priority: 10 }`；入队侧 fire-and-forget 见 CQ-003（otp.shared.service.ts:47/51）。
- **影响**：HTTP 已 200（入队即返回）→ 3 次投递失败 → 任务被 removeOnFail **直接删除，无死信无告警** → 用户收不到验证码且系统无痕迹；缓存里的验证码照常写入（otp.shared.service.ts:56-60）。
- **修复建议**：验证码类任务 `removeOnFail: false` 保留现场 + failed 事件告警。

### P3（轻微/风格）

#### CQ-015 DTO `id?: string` 系统性模式（约 15-20 处）与个别裸 class-validator

- **优先级**：P3（有注释意图的既成模式）｜**置信度**：高
- **证据**（代表）：`apps/api/src/modules/system/user/dto/user.dto.ts:30-34`：`@Expose() @IsOptional() @WalnutAdminDecoratorValidatorUuid(...) id?: string`，注释明说「主键只走路由参数、IsOptional 仅为 list 查询可选过滤」。同款还有 role/dept/device/post/locale/lang/menu/dictType/dictData/employee/setting/demo/key/log.operate/log.auth/deleted 等 DTO。
- **问题**：违反「字段不写 `?`，可选写 `default: null`」字面规矩；`@IsOptional` 属裸 class-validator（但配合了项目 validator 装饰器）。webauthn.dto.ts 的 `?` 字段是对 WebAuthn API 形状的镜像。
- **修复建议**：统一改 `default: null`，或在 dto.md 登记官方例外，消除规矩与代码漂移（见待裁决 #3）。

#### CQ-016 `user_preference.service.ts` 直持 DataSource：与三模式硬规矩字面冲突（有 in-code 决策注释）

- **优先级**：P3（口径冲突，见待裁决 #1）｜**置信度**：高（事实清楚，定性需拍板）
- **证据**：`libs/identity/src/user_preference/services/user_preference.service.ts:26-37`：注入 DataSource + getRepository(SysUserPreferenceEntity)；文件头 :14-16 注释「本模块无独立仓库，服务即数据面；B1 定案……服务直持 DataSource 即承接」。同类：`libs/auth/src/modules/oauth/{github,gitee}/*.service.ts` 与 `otp.service.ts` 自管 QueryRunner（:50-54 注释：guard 阶段拿不到拦截器 txContext）。
- **说明**：这些点的**数据访问均已穿过 repo service**（只是事务句柄/DataSource 由服务持有），均有迁移批次书面理由；但 AGENTS.md 硬规矩未同步豁免口径。

#### CQ-017 cron 过期 RT 清理静默吞失败 + `CrobJob` 拼写

- **优先级**：P3｜**置信度**：高
- **证据**：`libs/auth/src/modules/refresh/shared/refresh.shared.service.ts:104-115`：`revokeExpiredRefreshTokenForCrobJob` 用 allSettled 后只 filter fulfilled，rejected 静默丢弃，无日志。
- **影响**：过期 RT 撤销失败反复重试不可见；`CrobJob` → `CronJob` 拼写（多处）。
- **修复建议**：补 rejected 日志/告警；顺带改名。

#### CQ-018 SSE `getClientObservable` 空回退返回永不发射的冷 Observable

- **优先级**：P3｜**置信度**：高
- **证据**：`libs/sse/src/sse.service.ts:28`：`return this.clients.get(clientId)?.asObservable() || new Observable()`
- **影响**：键不存在时返回永不发射也永不 complete 的 Observable —— 客户端静默挂死而非受控 404/断开（与 CQ-013 叠加时更迷惑）。
- **修复建议**：回退改 `throw` 或返回 `EMPTY`（立即 complete）。

#### CQ-019 软删事件链：logOperateId 回写失败无补偿

- **优先级**：P3｜**置信度**：中
- **证据**：`apps/api/src/modules/techniques/event/event.service.ts:15-19`：`@OnEvent(LOG_OPERATE_DELETE, { async: true })` → `updateDeletedWithLogOperateId`；删除主流程（`pg-base.repository.ts:432-453` 快照+remove 同事务）扎实，但 logOperateId 关联是**事务外异步**回写。
- **影响**：监听器抛错时 sys_deleted 行缺 logOperateId，删除审计与「按操作日志找回删除记录」缺链，无重试/补偿。
- **修复建议**：监听器补 catch+告警；或登记进 recoverable 审计说明。

---

## 仓库硬规矩逐条核对结论

| # | 规矩 | 结论 |
|---|------|------|
| 1 | controller 级 service 不直接数据访问 | **基本合规**。`*.repo.service.ts` 持 DataSource 合规；`data-scope.policy.ts:97-104` 的 getRepository 有注释豁免（eslint 豁免区）。唯一边缘案例 `user_preference.service.ts` → CQ-016 |
| 2a | 必须用 RealPickType/RealPartialType | **合规**。原生 PickType/PartialType 仅出现在包装器 `libs/utils/src/dto.ts:3`；全仓 DTO 无直接使用 |
| 2b | 字段不写 ?/! | **系统性偏离**。约 15-20 处 `id?: string` 模式（多带注释意图）→ CQ-015；3 处 controller `!` 断言 → CQ-012；`sensitive.dto.ts:70` 是无 default 的真违例 |
| 2c | 用 field 装饰器不裸 class-validator | **基本合规**。个别处（user.dto.ts:31 IsOptional）配合项目 validator 装饰器使用 |
| 3 | 装饰器顺序 | **合规**。ESLint `local/sort-nestjs-decorators` 实装为 error（`packages/tooling/eslint-config/nest.ts:90`）；抽样 github/sensitive/mfa/user_device/dept controller 均符合 dto.md 顺序表 |
| 4 | 事务 em 逐层透传 | **总体健康**。github/gitee/otp 自管 QueryRunner 是有书面理由的 guard 阶段特例（release 均在 finally）；dept create/update 漏 → CQ-009；登录链 check-then-act 无锁 → CQ-010。抽查 user_lock/mfa/user_device/role 链路 em 传递完整，`registerAfterCommitHook`/`runAfterCommit` 使用正确 |

## 分页/排序一致性

统一走 `CreateWalnutAdminRequestListDTO`（`libs/list/src/list.dto.ts`）：page 默认 1、pageSize 默认 10（max 9999）、sort 白名单 `sortOnlyIn` 由各模块声明、查询层列收敛在 pg-list.builder。**未发现不一致**。

## 资源释放

抽查点均合规：自管 QueryRunner 三处（otp/github/gitee）commit/rollback/release 均在 try/catch/finally；`withScopedManager`（pg-base.repository.ts:139-164）release 在 finally、rollback 前判 isTransactionActive；探针 timer（probes.composition.ts:132-136）clearTimeout 在 finally；main/worker 均 enableShutdownHooks。未发现泄漏点。

## Bull 队列消费

- 幂等/重试：邮件/短信任务显式 attempts: 3；验证码任务失败即删无死信 → CQ-014。
- `base.processor` 只打日志，job.data 全量打印含验证码 → CQ-004。
- 全局 Bull 配置（`libs/queue/src/queue.config.ts:14-25`）无 default job options，重试策略散在各 add 调用——可接受但建议收敛。
- `sms.processor.JobSendWelcomeTextMessage` 是 TODO 桩（见盘点）。

## Socket.io / SSE（与 security agent 重叠面）

Socket 两个 P0（CQ-001/002）+ SSE 两个问题（CQ-005/013）全部落在**无测试覆盖**的 `apps/api/src/socket/` 与 `libs/sse/`。房间模型本身（`USER(userId, fingerprint)`）未发现其他越权 join 入口；`sendToRoom` 系列在 socket 未初始化时静默 no-op（`this.socket?`）——启动早期丢事件无告警，轻微、未单列 finding。

---

## 高风险无测试文件清单

静态盘点（39 unit spec + 18 int-spec + 45 api-spec + 1 e2e-spec 对照），以下高风险文件**没有任何直接测试**：

| 文件 | 风险面 |
|---|---|
| `apps/api/src/socket/socket.gateway.ts` | P0×2 所在；连接生命周期、force-quit 初始化链 |
| `apps/api/src/socket/socket.middleware.ts` | **CQ-001 所在**——一条「伪造 JWT 不得握手」的测试就能拦住 |
| `apps/api/src/socket/socket.service.ts` / `socket.adapter.ts` | 房间事件投递 |
| `libs/sse/src/sse.service.ts` | CQ-013/018 所在 |
| `libs/token/src/token.service.ts` | token 生成/解码核心（仅 api-spec 间接覆盖） |
| `libs/queue/src/base.processor.ts` | 队列日志/生命周期 |
| `libs/sms/src/sms.processor.ts` / `libs/mailer/src/mailer.processor.ts` | 验证码投递主链 |
| `libs/cache/src/cache.service.ts`（主服务） | get/set/del/delByPattern/clear 核心（appSettings、cron-lock 有专测，主服务没有——CQ-011 所在） |
| `libs/security/src/sensitive/sensitive.service.ts` | 敏感操作验证主链（含两处未实现 TODO） |
| `libs/auth/src/modules/otp/otp.shared.service.ts` | OTP 发码/验码核心（otp.api-spec 有 HTTP 级部分覆盖） |
| `libs/auth/src/modules/oauth/{github,gitee}/*.service.ts` 自管事务段 | external-oauth.api-spec 部分覆盖 happy path，事务回滚路径无测 |

## e2e / integration 配置结论

存在且指向合理：`vitest.config.ts`（unit）、`vitest.config.integration.ts`（int-spec + api-spec，真实 PG/Redis 集成库、串行 + globalSetup drop/rebuild）、`vitest.config.e2e.ts`（全量 AppModule，1 份 `test/e2e/app.e2e-spec.ts`）。集成配置注释记录的 node-redis v5 批量形态与 keyv 双包隐患处理是高质量工程记录。无 finding。

---

## TODO/FIXME 盘点（in-source 共 24 条，按类归档）

**功能未实现（4）**

1. `libs/auth/src/modules/opaque/opaque.module.ts:6` — 还差注册和忘记密码流程
2. `libs/security/src/sensitive/sensitive.service.ts:192` 与 `:286` — MFA 校验未实现（敏感操作链缺口）
3. `libs/sms/src/sms.processor.ts:24` — welcome 短信桩
4. `apps/api/src/modules/system/identity/mfa/totp.controller.ts:11` — `// TODO fulfill`（端点实际已实现，注释过时）

**待下线/待改（4）**

5. `apps/api/src/modules/system/identity/user.me.controller.ts:39` — should remove
6. `apps/api/src/modules/auth/auth.controller.ts:65` — change controller
7. `libs/auth/src/modules/session/session.service.ts:57` — remove
8. `apps/api/src/main.ts:89` — static assets Content-Disposition not working

**配置外提（2）**

9. `apps/api/src/socket/socket.gateway.ts:31` — namespace 硬编码（与 CQ-002 相关）
10. `libs/identity/src/user_device/repo/user_device.repo.service.ts:43` — 阈值 30 硬编码

**i18n/校验缺口（1）**

11. `libs/decorators/src/validator/base/string.validator.ts:99-100` — validator 报错未走 i18n

**死代码（3）**

12. `libs/exceptions/src/base/404.ts:12`、`libs/exceptions/src/app/database.ts:4` — not used
13. `libs/auth/src/modules/google/google.service.ts:36` — 空 TODO

**其他（杂项）**：`libs/identity/src/user_mfa/totp/totp.service.ts:286`（伪需求注记）、`libs/identity/src/shared/base.model.ts:26`（序列化排除）、`libs/guards/src/guards/risk.guard.ts:40`（identifier 维度）、`libs/identity/src/user/dto/user.dto.ts:71`（oss prefix）、`libs/app-domain/src/demo/dto/demo.dto.ts:95`（too strict）。

另：`DESIGN-ISSUES-ARCHIVE.md` 内 6 条为归档文档引用，非活代码 TODO。menu 域三处「remove all cache auth data when menu changed」TODO 已在归档批次清零（grep 证实）。

---

## 待用户裁决（不做默认定论）

1. **「服务即数据面」口径**：`user_preference.service.ts` 直持 DataSource、`github/gitee/otp` service 自管 QueryRunner，均有迁移批次（B1/B7a/B7b）in-code 决策注释，但与 AGENTS.md「三模式」硬规矩字面冲突。是「补文档豁免条款」还是「重构回 repo 层」？建议前者（改动小、决策留痕完整），需用户确认口径写进哪份文档。
2. **Socket 两个 P0 的处置窗口**（CQ-001/002）：socket 模块当前无任何测试。建议先补「伪造 JWT 握手必须拒绝」与「admin UI 需凭据」两条测试再动实现；修复归属 security agent 还是本线，请 lead 分派。
3. **DTO `id?: string` 模式**（CQ-015）：承认为准例外出文档，还是按硬规矩清理（涉及约 15-20 个 DTO 与 admin 端 list 过滤参数 wire 兼容性验证）。
4. **cache.controller deleteCache 的 fire-and-forget 契约**（P2-4 已有测试钉住）：契约本身合理，但 Redis 异常时仍是 unhandled rejection（并入 CQ-003 修复即可）——确认无需单独整改响应语义。
5. **sensitive verify 的 em 接线**（sensitive.controller.ts:74-76 注释自述「上游 em 形参未接线」）：属 security agent 深挖范围还是本报告跟进？本 review 仅登记，未判定影响。
6. **CQ-010 的 migration 侧确认**：本 review 只核对了实体注解层面无部分唯一索引；migration 目录未逐行排查，修复前请确认库侧是否已有同款索引。