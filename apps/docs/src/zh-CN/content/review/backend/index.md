# 后端系统性 Review 汇总报告（FINDINGS）

> 主导：lead ｜ 执行：4 个并行 review sub agent（DOC 接口文档 / ARCH 架构 / CQ 代码质量 / SEC 安全）
> 范围：`apps/server` 全量 —— apps/api 组合根 + apps/worker/cli + 34 个内部 lib + deploy 配置（共 47 controller / 133 module / 195 OpenAPI operations）
> 方法：纯白盒静态 review（只读；未起服务、未连库、未改任何源码）；判据 = `apps/server/AGENTS.md` + backend 规范五篇 + ADR 0022
> 明细报告（同目录）：[api-catalog.md](<api-catalog.md>) · [api-docs-findings.md](<api-docs-findings.md>) · [architecture.md](<architecture.md>) · [code-quality.md](<code-quality.md>) · [security.md](<security.md>)
> 本文件 = 去重合并后的统一问题清单 + 分批实施计划 + 待用户裁决。原始编号 → 统一编号映射见附录 A。
>
> 📦 **迁入说明（2026-11）**：本文与同目录的另外几份明细报告原在 `apps/server` 的 `review/` 目录，
> 2026-11 按「md 文档统一放 `apps/docs`」迁入文档站 —— 与 ADR 同一条口径，**不做门禁特例**。
> **正文是评审当时的快照**：行号、数字、门禁结论都是 2026-11 工作区的口径，未追改；分层与模块现状以
> [ADR 0022](/content/adr/0022-backend-lib-layering-and-composition-roots) 与各专题文档为准。
> 当时「未跟踪的 `reports/` 产物让 `lint:docs-refs` 常红」那批引用已随该目录整体移出仓库（未加任何门禁排除），
> 下方相关表述保留原判断、不再等于现状。

---

## 0. 执行摘要

**总体评价（四线一致）**：工程基础扎实 —— ADR 0022 六层分层与磁盘实际完全一致（全量 import 扫描 0 条向上层间边、madge 实跑 899 文件无环、五处注册面与 34 lib 全等）；HTTP 认证链为近期加固成果（JWT 验签+过期+Redis 会话键三重校验、RT revoke-and-insert 悲观锁轮换、OAuth state HMAC+nonce+设备绑定）；仓库硬规矩（RealPickType/PartialType、装饰器顺序、em 透传、分页排序）零实质违例；openapi 生成门禁链无实质漂移漏洞。

**最薄弱的一环是实时层（socket/SSE）**：3 个 P0 中的 2 个在此（admin UI 无认证 + 握手不验签），且 `apps/api/src/socket/` 与 `libs/sse/` 恰好是全仓零测试覆盖的高风险区。其次是接口文档的三个系统性缺口（security 声明、错误模型、工厂 list summary）与全库 `void` fire-and-forget 的进程稳定性隐患。

| 优先级 | 统一编号 | 数量 | 构成 |
|---|---|---|---|
| P0 | F-01 ~ F-03 | 3 | 2 安全（socket admin UI / socket 握手）+ 1 功能正确性（identity list 返回空对象） |
| P1 | F-04 ~ F-09 | 6 | SSE 通道劫持、fire-and-forget 崩进程、凭据进日志、文档三系统性缺口 |
| P2 | F-10 ~ F-29 | 20 | 安全加固 4 + 文档契约 6 + 健壮性 5 + 架构守卫 3 + 描述失真 2 |
| P3 | F-30 ~ F-54 | 25 | 口径登记 6 + 清理/纵深 19 |
| **合计** | | **54** | 来自 4 线 65 条原始发现，合并 11 条跨线重复 |

---

## 1. P0（立即修，批次 1）

### F-01【P0·安全】Socket.IO Admin UI 无认证挂载，公网反代可达（来源：SEC-001 + CQ-002）

- **证据**：`apps/server/apps/api/src/socket/socket.gateway.ts:69-73` 以 `instrument(ns, { auth: false, mode: process.env.NODE_ENV as ... })` 挂载 admin UI，不分环境、无凭据；`deploy/nginx/conf.d/frontend.conf:78-91` 将 `/socket/` 反代到 `backend:5173/walnut-path/`，`deploy/docker-compose.yml:7-9` 仅 nginx 发布 80/443 ⇒ `<域名>/socket/admin` 公网可达；`:31` 另有 namespace 硬编码 TODO。`NODE_ENV` 直接 as 断言未校验。
- **影响**：任何人可观测全部连接（socket.data 含 userId/deviceId/fingerprint）、任意 join/leave 房间、向任意房间 emit（development 模式可主动 emit，可伪造 LOCK/FORCE_QUIT 骚扰/钓鱼）、强制断开任意客户端 —— 实时层被整体接管 + 在线身份关系泄露。
- **修复方向**：生产/预发 `auth: { user, password }`（凭据走 env 加密通道）或按环境不挂载 instrument；nginx 对 `/socket/admin` 返回 404；namespace 与开关外提 config。*是否保留生产 admin UI 待裁决 Q1；部署后可达性实测见 R1。*

### F-02【P0·安全】Socket 握手不验签：用 `jwtService.decode` 解析 Bearer token（来源：SEC-002 + CQ-001）

- **证据**：`apps/server/apps/api/src/socket/socket.middleware.ts:42` 调 `tokenService.decodeAccessToken`，其实现是 `this.jwtService.decode(token)`（`libs/token/src/token.service.ts:114-122`）—— 仅 Base64 解 payload，**不验签名、不验过期**；对照 HTTP 侧 `jwt-access.strategy.ts:36-51` 是验签+过期+Redis 会话键三重校验。
- **影响**：自编任意 payload 的假 JWT（如 `{"userId":"<受害者id>"}`）即可完成握手并 `join(USER(userId, fp))` 房间（`socket.gateway.ts:88-93`），接收受害者的 FORCE_QUIT/锁屏/monitor 实时事件、批量伪造在线状态污染监控面。HTTP 与 socket 鉴权强度严重不对等。
- **修复方向**：握手改 `verifyAsync` + 与 HTTP 同一套 Redis 会话键存在性校验，失败一律 `next(new Error(...))`。**实施顺序：先补「伪造 JWT 握手必须拒绝」测试再修**（该模块当前零测试）。

### F-03【P0·功能正确性】`POST /system/user/identity/list` 直返无 @Expose 实体，全局序列化剥成空对象行（来源：DOC-01）

- **证据**：`user_identity.controller.ts:40-45` 未做 `plainToInstance` 直返 service 结果；`user_identity.service.ts:41-49` 返回 TypeORM 实体数组；`user-identity.entity.ts` 全文件无一个 `@Expose`；`main.ts:131-136` 全局 `ClassSerializerInterceptor(excludeExtraneousValues: true)` ⇒ `data` 每项退化为 `{}`。本仓 `apps/api/test/api/ENDPOINTS.md:139` 有同一故障模式的已修先例（area）。
- **影响**：端点对前端实际不可用（`{data:[{},…], total:n}`）；文档却声明 `isArray + SysUserIdentityDTO`（含 `value` AES 密文 / `valueHash` / `maskedValue` 全字段）—— 若有人直接给实体补 @Expose「修」它，密文与 HMAC 查找键将按文档口径直接出站，敏感暴露面无人审过。
- **修复方向**：controller 补 `plainToInstance` + 专用 list 响应 DTO（剔除 `value`/`valueHash` 出参，只留 `maskedValue` 等），对齐 `AppMonitorUserController.list` 手法；修后 `pnpm openapi:check` 必红，同步重导出 openapi.json 与前端 `api-types`。*修复口径二选一见裁决 Q2。*

---

## 2. P1（批次 2）

### F-04【P1·安全】OAuth 结果（accessToken + 原始 sessionKey）经匿名、可劫持、覆盖语义的 SSE 通道投递（来源：SEC-003 + SEC-004 + CQ-005 + CQ-013）

- **证据**：`gitee/github.controller.ts:135-145` 将 `{ accessToken, sessionKey }` 经 `sendToClient` 投递；订阅端点 `@Sse('sse/:fp')`（`github.controller.ts:170-179`）仅 `@WalnutAdminGuardSignFree()` 无任何认证，频道键 = URL 参数；`libs/sse/src/sse.service.ts:12-16` `createClient` 直接覆盖旧 Subject（不 complete）；`github.controller.ts:174-177` disconnect 按 key 删（多标签页误删新连接）；`sessionKey` 是登录会话签名派生根密钥（Redis 只存哈希，原文仅投递一次）。
- **影响**：知晓受害者 fingerprint 的攻击者可抢注频道截胡其 OAuth 登录结果（AT + sessionKey）；多标签页自伤场景（tab2 覆盖 tab1 后，tab1 关闭反而终结 tab2 的流）。OAuth `state` 本身已加固（HMAC+nonce+设备绑定），本条是**投递通道**侧残余缺口。
- **修复方向**：SSE 订阅绑定登录态/设备（与 state 同源校验）；`createClient` 改幂等或加连接级唯一后缀；或改一次性短 ticket 拉取。*认证方案落地方式依赖裁决 Q4 选取的装饰器口径。*

### F-05【P1·稳定性】全库 14 处 `void this.x()` fire-and-forget 无 `.catch`：Redis/队列抖动即整进程崩溃（来源：CQ-003）

- **证据**（全部无 catch）：`libs/guards/src/guards/risk.guard.ts:56,101`（**每个请求的 guard 链上**）、`auth.guard.ts:52`、`log.auth.decorator.ts:38,47`、`otp.shared.service.ts:47,51`、`otp.service.ts:111`、github/gitee/google.service 欢迎消息 4 处、`github.controller.ts:157`（失败登录风控，gitee 同款）、`monitor/cache/cache.controller.ts:93`（注释声明的契约，但 Redis 异常仍 unhandled）。Node 24 默认 `--unhandled-rejections=throw`。
- **影响**：任一处 reject（Redis 抖动、Bull add 失败）→ 进程级 unhandledRejection → API 崩溃；risk.guard 两处在全部请求热路径上。
- **修复方向**：统一封装 `fireAndForget(promise, logger)`（内部 catch 记日志）或逐处补 `.catch`；guard 链两处优先。cache delete 契约保留、仅补异常兜底（lead 已裁决）。

### F-06【P1·安全/合规】密钥材料与敏感数据进持久化日志（来源：SEC-006 + CQ-004）

- **证据**：`libs/auth/src/modules/shared/shared.service.ts:30` 打印 `authSessionKey` 原文（base64，会话根密钥）；`libs/queue/src/base.processor.ts:12-16` `onActive` 全量 `JSON.stringify(job.data)` —— 含 OTP 验证码（`sms.service.ts:46-55`、`mailer.service.ts:42-51`）；`libs/guards/src/guards/cap.guard.ts:145-147` 打印 capToken；`sign.guard.ts:158-163` 打印 server 签名 + 完整 raw body；`github.strategy.ts:44` 打印 OAuth profile（PII）；`socket.service.ts:29/45/58/72` 事件全量入日志；oauth controller `:165` 打印 fingerprint。日志经 Winston 轮转 + `/app/logs` 卷持久化（docker-compose.yml:33）；LoggerMiddleware 的 prod 脱敏（`logger.middleware.ts:53-55`）管不到 guard/service 层。
- **影响**：读到日志即可取得会话根密钥与在途验证码 —— OTP 爆破面从「猜 6 位数」退化为「读日志」。
- **修复方向**：删改上述日志点（sessionKey 只打 sessionId；queue 只打 jobId 不打 data；sign mismatch 打摘要不打原文）；对 `sendToRoom` 类日志做字段白名单。

### F-07【P1·文档正确性】`GET /security/sensitive/check` 必填 query 参数零文档，端点在文档层面不可调用（来源：DOC-02）

- **证据**：`sensitive.controller.ts:31-32` 的 `level`（必填枚举）/`type` 参数因 union 字面量反射为 `Object` 不被 swagger 自动收编；`openapi.json` 该操作 `parameters: []` 且无响应 schema（handler 实际已 `plainToInstance` SecuritySensitiveCheckResponseDTO）。
- **修复方向**：补 `@ApiQuery({ name:'level', required:true, enum: WalnutAdminConstSecurityLevel })`（type 同款）+ `@ApiWalnutOkResponse`。

### F-08【P1·文档完整性·系统性】全站 195 个 operation 无一个声明 security（@ApiBearerAuth 零使用）（来源：DOC-03）

- **证据**：grep 全仓 0 处；`openapi.json` 已注册 `securitySchemes.bearer` 但全部 op `security` 为空 —— Scalar 的 Authorize 按钮是摆设；实际认证是三级（全公开 / JwtFree 匿名可 / 登录态+权限点），文档完全不表达；JWT 依赖的 RT_JTI、DEVICE_ID cookie 亦零披露。
- **修复方向**：在 `WalnutCrudDecorators` 工厂与 `ApiWalnutOkResponse` 组装点按 Reflector 元数据（JWT guard 的 Public/Free 装饰器已在装饰器链上）批量注入 `@ApiBearerAuth()`，全 Free 端点显式标记匿名。*落地层待裁决 Q4。*

### F-09【P1·文档完整性·系统性】错误模型零文档 + health 503 失真声明（来源：DOC-04 + DOC-08）

- **证据**：`openapi.json` responses 分布 `{"200":190, "200,503":5}` —— 46 码错误体系（40112 签名/40114 MFA/40116-17 CAP/40605-07 设备/42900 限流…）只靠 200 壳内 `code.description` 一句话；全局过滤器把一切异常兜成 HTTP 200 + body.code（`error.module.ts:44-47`）；5 个 health 端点声明 503 而本仓 terminus 实测不抛 503（`ENDPOINTS.md:189`），真正探针是 raw `/health/ready`。
- **影响**：前端/网关无法以文档为据做错误分支；编排方按文档 503 判活会误判；openapi-typescript 生成类型完全不含错误形态。
- **修复方向**：在 `libs/decorators/src/swagger/ok.response.ts` 给 `code` 字段补 `enum: Object.values(WalnutAdminConstAppResponseCode)`（一次生效全站）；health 覆盖 terminus 默认声明移除 503。*503 改文档还是改行为见裁决 Q5。*

---

## 3. P2（批次 3，按四组实施）

### 组 A：安全加固（F-10 ~ F-13）

- **F-10（SEC-005）Scalar/OpenAPI 文档全环境未认证暴露**：`main.ts:139-151` raw express 挂 `/api`，无 NODE_ENV 判断、绕过 guard 链；与 AGENTS.md「开发模式下」口径漂移。生产等于送出全部路由/DTO 攻击面地图。修复：prod/stage 不挂载或加白名单。*是否保留线上文档见裁决 Q3。*
- **F-11（SEC-007 + CQ-006）`trust proxy: true` + header-first 取 IP 的部署耦合**：`main.ts:71` 无条件信任代理跳；IP 黑名单/限流/风控/设备 IP 跟踪全按 `realIp` 维度。当前靠边缘 nginx 覆写 XFF 兜底（`api.conf:50-57`），任何绕过边缘的通道都会让 IP 维度控制失效，且永久拉黑可被嫁祸任意 IP。修复：`trust proxy` 设具体跳数/网段 + IpMiddleware 显式可信头来源 + 代码侧留耦合警示注释。
- **F-12（SEC-008）Ali OSS STS：非 visitor 用户签发无 policy 约束的全角色权限 token**：`ali.service.ts:44-63` 仅 visitor 带 policy；其余登录用户（仅需 `app:shared:ali:sts` 权限）继承 roleArn 全部权限。修复：统一最小权限 policy + 按 userId/路径前缀收窄 Resource。*roleArn 实际权限边界需云侧核实（R3），若角色本身只读则降 P3。*
- **F-13（SEC-009）异常全量入 Bull→DB 写放大 + 限流器进程内存储**：`exception.filter.ts:60-62` 所有异常（含未认证请求打出的 4xxxx）都入队落 `sys_error`；`throttler.service.ts:14-23` 未配 storage ⇒ 多副本/分进程时限流各自计数。修复：4xx 不入错误库或采样去重；throttler 换 Redis storage（已有 redis 通道）。*限流真实值依赖 R2。*

### 组 B：接口文档契约补全（F-17 ~ F-22，系统性多项可一次修复）

- **F-17（DOC-06）CRUD 工厂 `WalnutAdminDecoratorList` 不生成 @ApiOperation**：`libs/crud/src/list.ts:14-37` 仅 ApiExtraModels+ApiOkResponse，19 个 `POST */list` 全缺 summary（对照 create/read/update/delete 均有）。一处修复全站生效，修后重导出 openapi。
- **F-18（DOC-07）24 个端点 200 响应无任何 schema**（占全站 12.3%）：根 `/`、key init/rotate、monitor state/force-quit、oauth url/callback/sse、rsa public-key、sign initial、cap challenge/redeem、sensitive check、deleted recover、`/app/error/{code}`（文档 200 实现恒抛）、cache clear、setting private、locale message 等；cap 两端点为 FreeResponse 裸对象。逐个补 `@ApiWalnutOkResponse` 或显式标注恒抛/排除。
- **F-19（DOC-11）`POST /system/locale` / `PUT /system/locale/{id}` 请求体零文档**：wire 是 `{key, oldKey?, <langId>: 翻译值}` 映射（三段自定义管道转换），非 DTO 数组；`openapi.json` requestBody 为 null。补 `@ApiBody` 映射形状 + 转换说明。
- **F-20（DOC-05）`GET /system/locale/message/{locale}`**：路径参数 locale（union 反射 Object）未文档化 + `cache` 标 required 与实现默认值不符；补 `@ApiParam`/`@ApiQuery(required:false)` + 响应 schema。
- **F-21（DOC-10）`GET /system/user/device/list` 描述复制粘贴错误**：`user_device.controller.ts:32-35` description 为 'get security tab1 status'，实现是当前用户设备列表。改 description 即可。
- **F-22（DOC-09）SSE 两端点无事件流契约**：文档呈现为普通 GET 200，无 `text/event-stream` 内容类型与事件说明；事件契约实际在 `@walnut/contract/sse.ts`。补 `@ApiOperation` + SSE 响应声明（与 F-04 安全修复同批改同一文件）。

### 组 C：健壮性 / 数据一致性（F-23 ~ F-29）

- **F-23（CQ-007）i18n key `business.auth.emailAlreadyBound` 两种语言文件都不存在**：抛出点 github/gitee.service.ts:108；用户拿到原始 key。补 key 或改用已有 `identityAlreadyUsed`；建议加「errMsg key 均存在词条」drift spec。
- **F-24（CQ-008）functional.guard 对设置值 JSON.parse 无兜底**：`functional.guard.ts:55` 无 try-catch；管理端可写的坏 JSON 设置会让该 guard 挂掉的域**所有**端点 50000。包 try-catch，失败按缺失语义走 defaultClosed + 告警。
- **F-25（CQ-009）dept create/update 与 delete 事务口径不一致**：`dept.controller.ts:98-117` 无 `@WalnutTx()` 不传 em（delete 有）；防环 check-then-write 可竞态成环（读侧有兜底但环数据落库）。补事务对齐 + 防环读腿 `pessimistic_write` 锁父行。
- **F-26（CQ-010）登录 duplicate-signin 判定无锁 + RT 实体无部分唯一索引**：`refresh.shared.service.ts:190-192` check-then-act（同文件 :267 轮换腿有 `{lock:true}` 对照）；实体索引无 `(user_id,device_id) WHERE NOT revoked` 部分唯一索引 ⇒ 并发可产生两条现役 RT 行。修复：migration 加部分唯一索引（冲突转受控 409）或读腿加锁。**修前先 grep migration 目录确认库侧是否已有同款索引**（lead 已裁决）。
- **F-27（CQ-011）`cache.getAllCacheData` 的 BULL 键过滤在 node-redis v5 批量数组上失效**：`cache.service.ts:388` 对 `string[]` 批量做 `.includes('BULL')`（元素全等判断，永不命中；:269-272 注释已明确批量形态）⇒ Bull 键混进 MGET，缓存监控页/日志失真。摊平后过滤（与 :278 同款）。
- **F-28（CQ-012）controller 层三处非空断言掩盖可空契约**：`user_device.controller.ts:111` `lockPwdHash!`（全可选 DTO，非 security 模式无密码可解锁是现状语义）、`mfa.controller.ts:57` `sid!`、`sensitive.controller.ts:70` `dto.operationType!`（`sensitive.dto.ts:70` 声明 `?` 且无 `default: null`，正是 AGENTS 禁止的双真源）。改显式校验 / DTO 必填化（operationType 改 `default: null` + 受控 400）。
- **F-29（CQ-014）验证码投递失败不可观测**：`mailer.service.ts:50`、`sms.service.ts:54` `removeOnFail:true` + 入队侧 fire-and-forget（F-05）⇒ HTTP 已 200、3 次失败后任务被删，无死信无告警，用户收不到验证码且无痕迹。验证码类任务改 `removeOnFail: false` + failed 事件告警。

### 组 D：架构守卫与一致性（F-14 ~ F-16）

- **F-14（ARCH-01）技术层 19 lib 同层互引无机械守卫，已长出「设施→装配内核」纵向边**：`ip.module.ts:3` 引 `@walnut-server/crud` token、`ip.service.ts:1,10` 引 crud/list；repository→als/list、crud→list/als/cookie、token→cache、sms/mailer→queue。同层互引不在 8 层 banned 内，未来反向即成环且无门禁（madge 只能事后发现）。*拆 tech-base/tech-assemble 还是边清单见裁决 Q8。*
- **F-15（ARCH-02）@Global 42 个中存在冗余**：`SharedMaskModule`（mask.module.ts:3）唯一消费方 error.module.ts:35 已显式 import，@Global 纯多余 —— 摘除行为零变化。建议同时定「消费方 ≥2 模块才 @Global」机械判据。
- **F-16（ARCH-03）libs 内 7 处裸 `console.error` 绕过 WalnutAdminLogger 管道**：cache.config.service、delay.service、ip.service ×2（百度 IP 故障日志恰好漏在管道外）、utils/headers、utils/pkg（模块求值期可留但需注释）。改用已注入的 Nest Logger。

---

## 4. P3（批次 4：清理与口径登记，多项与裁决 Q6/Q7 绑定）

| 编号 | 标题 | 来源 | 位置 | 建议 |
|---|---|---|---|---|
| F-30 | error.service 直读 process.env.NODE_ENV 绕过 const 叶子 | ARCH-04 | libs/app-domain/src/error/error.service.ts:67 | 改用 WalnutAdminEnv |
| F-31 | lib 数据面第 4 形态（裸 service 直持 DataSource）未登记进「三种 Repository 模式」口径 | ARCH-05 + CQ-016 | user_preference.service.ts:14-44、device.service.ts、github/gitee/otp 自管 QueryRunner | AGENTS 补登记豁免行（均有 B1/B7 批次注释）或重构回 repo；**见 Q6** |
| F-32 | 三套 AsyncLocalStorage（als/context/db.hook）分属三库，新字段无唯一落点 | ARCH-06 | request.service.ts:19、logger-context.als.ts:17 | 补分工注释或合并；见裁决（ARCH 待裁决④） |
| F-33 | 组合根跨目录 import 相对路径与 @ 别名混用 | ARCH-07 | app.module.ts:10-22 vs socket.module.ts:2 | 统一 @/ 别名（worker/cli 复用除外） |
| F-34 | 宽 barrel（auth 61 个 export *）使内部改名=破坏性变更、knip 失效 | ARCH-08 | libs/auth/src/index.ts 等 | 维持现状 + 文档补一句「内部移动视同 API 变更」 |
| F-35 | ALSRequestService set/get 每次调用两行 debug 日志（含 JSON.stringify 热路径开销） | ARCH-09 | libs/als/src/request.service.ts:55-74 | 删除或惰性化 |
| F-36 | health controller 直注 DataSource 探活，撞「controller 不触数据层」字面规矩 | ARCH-10 | techniques/health/health.controller.ts | AGENTS 登记「探针除外」或下沉 probe service；**见 Q6** |
| F-37 | dto-entity drift 完备性扫描窄口（只认 .dto.ts + DTOBase 后缀） | ARCH-11 | dto-entity.drift.spec.ts:273-285,314 | 放宽扫描面或加 lint selector 显式约束 |
| F-38 | DTO `id?:` 系统模式（15-20 处，B1 模板注释）与个别裸 class-validator | CQ-015 + DOC-16 | user.dto.ts:30-34 等多处；IsOptional/Allow 直用 8 处 | 登记官方例外或按硬规矩清理（涉及 wire 兼容验证）；**见 Q6** |
| F-39 | cron 过期 RT 清理静默吞失败 + `CrobJob` 拼写 | CQ-017 | refresh.shared.service.ts:104-115 | rejected 补日志/告警 + 改名 |
| F-40 | SSE getClientObservable 空回退返回永不发射的冷 Observable | CQ-018 | sse.service.ts:28 | 回退改 throw 或 EMPTY（随 F-04 一起改） |
| F-41 | 软删事件链 logOperateId 回写失败无补偿 | CQ-019 | event.service.ts:15-19 | 监听器补 catch+告警或登记审计说明 |
| F-42 | 加密 secret 校验仅 @IsString；JWT verify 未显式钉算法 | SEC-010 | config/validation.ts:107-142、jwt.config.ts:10-15 | env 加最小长度校验；显式 algorithms: ['HS256'] |
| F-43 | dev CORS `origin:'*'` + `credentials:true` 矛盾；stage cookie secure:false | SEC-011 | middleware.config.ts:20、cors.middleware.ts:23-30、cookie.service.ts:37-46 | dev 白名单 localhost；stage 补 secure |
| F-44 | UA/Postman 豁免与检测均为客户端可伪造信号（isPostman 已被 isDev 门住，OK） | SEC-012 | user-agent.middleware.ts:52-54、各 guard 豁免点 | 注释/文档标明属噪声过滤非安全边界 |
| F-45 | OPAQUE startLogin 用户枚举时序侧信道（不存在用户跳过计算与 Redis 写） | SEC-013 | opaque.core.service.ts:61-103 | 不存在用户执行等时假计算 + 等量写 |
| F-46 | `/app/setting/private` 无权限点（登录即可读四组功能开关）+ 无响应 schema | SEC-014 + DOC-19 | setting.controller.ts:71-76 | 补 DTO；是否加权限点涉及 admin store 消费面；**见 Q9** |
| F-47 | 匿名心跳 `POST /app/monitor/user/state` 可自报 userId 关联（污染在线监控） | SEC-015 | user.controller.ts:83-97、user.service.ts:38-74 | userId 仅在认证链回填时接受；**实施时核对 DTO 白名单**（对应 SEC 待裁决②） |
| F-48 | 标签不一致：AppMonitorServer/App 无 @ApiTags；system/user/oauth 空壳 controller 空标签 | DOC-12 | server.controller.ts:37-40、app.controller.ts:9-11、user_oauth.controller.ts | 补 @ApiTags；空壳去留 **见 Q7** |
| F-49 | 数组 query（types/codes）文档为单个 string，未表达逗号分割语义 | DOC-13 | dictType.controller.ts:50-55、area.controller.ts:45-50 | @ApiQuery type:[String] + 注明约定 |
| F-50 | `?_cascade=` 与 `?cache=` 文档 required:true，实现均有默认值 | DOC-14 | delete.decorator.ts:22-30、locale.controller.ts:130 | 补显式 @ApiQuery(required:false) |
| F-51 | OAuth callback 是 @Render HTML 页，文档声明 application/json 200 | DOC-15 | github.controller.ts:85-118 | @ApiExcludeEndpoint 或 text/html 声明 |
| F-52 | openapi.json 无 servers 字段，URI 版本前缀未体现 | DOC-17 | swagger.options.ts | 按环境 .addServer(prefix)；**见 Q10** |
| F-53 | openapi 门禁三边界：fork PR 无 ENV_KEYS 静默跳过 / git diff 不查暂存 / check 红时改写工作区 | DOC-18 | prepush.ts:57,149-154、ci.yml:305-381 | fork PR 退化近似检查或 CODEOWNERS；check 加 --cached |
| F-54 | `POST /auth/opaque/user/login/client-error` 文档 boolean 200，实现恒抛 40103 | DOC-20 | opaque.user.controller.ts:69-96 | 响应声明改错误码语义 |

---

## 5. 分批实施计划（待用户确认后执行，全部派 sub agent 实施）

| 批次 | 内容 | 验收门禁 |
|---|---|---|
| **批次 1（P0）** | F-01、F-02（先补 socket 测试：伪造 JWT 握手必须拒绝 / admin UI 需凭据 → 再修实现）；F-03（修 wire + 专用 list DTO 剔除密文出参） | 新增 socket 单测/int-spec 绿；`pnpm --filter @walnut/server test`、`types:check`、`lint` 绿；`openapi:check` 通过（含 openapi.json 与 api-types 重导出） |
| **批次 2（P1）** | F-05（fireAndForget 封装 + 14 处收编）、F-06（日志脱敏）、F-04 + F-40 + F-22（SSE 通道安全与契约，同文件一次改完）、F-07/F-08/F-09（文档系统性：工厂层注入 bearer、code enum、sensitive/check 参数） | 全量测试绿；openapi 重导出后 `openapi:check` 绿；新增「伪造 SSE 订阅拒绝」类测试 |
| **批次 3（P2，四个子批可并行）** | 3a 安全：F-10、F-11、F-12、F-13；3b 文档契约：F-17~F-21；3c 健壮性：F-23、F-24、F-25、F-26、F-27、F-28、F-29；3d 架构守卫：F-14、F-15、F-16 | 同上 + F-26 前先核实 migration；F-25 新增 dept 并发 int-spec；eslint 新分层规则跑 `pnpm lint` 全绿 |
| **批次 4（P3）** | 不涉裁决的项先做（F-30、F-33、F-34、F-35、F-37、F-39、F-41、F-42、F-43、F-44、F-45、F-47、F-49、F-50、F-51、F-54）；涉裁决项（F-31、F-36、F-38、F-46、F-48、F-52）随 Q6/Q7/Q9/Q10 结论执行 | `pnpm prepush` 全表绿 |

---

## 6. 待用户裁决

### 方向类（需要拍板）

| # | 事项 | 关联 | 选项（★=lead 推荐） |
|---|---|---|---|
| Q1 | socket.io admin UI 生产处置 | F-01 | ★a) 保留但强口令（env 加密通道）+ nginx 对 /socket/admin 404；b) 生产不挂载 instrument；c) 限内网 |
| Q2 | identity list 修复口径 | F-03 | ★a) 修 wire + 专用 list DTO 并剔除 value/valueHash 出参；b) 仅修文档遮蔽密文字段 |
| Q3 | 生产是否保留在线 API 文档 /api | F-10 | ★a) 仅 dev/stage 挂载；b) 保留 + 白名单鉴权；c) 接受现状 |
| Q4 | @ApiBearerAuth 全站注入落地层 | F-08 | ★a) CRUD 工厂 + ApiWalnutOkResponse 组装点按 guard 元数据批量注入；b) 逐端点手补；c) 暂不做 |
| Q5 | health 503 失真 | F-09 | ★a) 改文档（覆盖 terminus 声明移除 503）；b) 改行为（探针真抛 503） |
| Q6 | 规矩口径三连（改代码还是改规矩） | F-31/F-36/F-38 | ★登记豁免：「模块内数据面 service」「health 探针直注 DataSource」「DTO id?: B1 模板 + 个别裸 IsOptional」写进 AGENTS.md/dto.md；或反向按硬规矩重构（F-38 涉及 15-20 个 DTO 的 wire 兼容验证） |
| Q7 | system/user/oauth 空壳 controller 去留 | F-48 | ★保留但摘 @ApiTags（ENDPOINTS.md:182 有「C 段复核维持」记录）；或连 module 与 contract 路由常量一起删 |
| Q8 | 技术层防环守卫 | F-14 | ★a) 拆 tech-base / tech-assemble 两条 layer（改 eslint.config.ts + drift spec LAYER_MATRIX）；b) 仅加边清单；c) 维持现状。附带：WALNUT_ADMIN_IP_LOCATION_RESOLVER token 是否从 crud 迁回 libs/ip |
| Q9 | /app/setting/private 权限收敛 | F-46 | 登录即可读现状维持 vs 加管理端权限点（涉及 admin store 消费面改动） |
| Q10 | openapi servers 字段 | F-52 | ★按环境 .addServer(prefix)；或保持现状 |

### 核实类（需运行时 / 云侧 / 密文配置信息，源码无法定论）

| # | 事项 | 关联 |
|---|---|---|
| R1 | 部署后实测 `https://<域名>/socket/admin`（及 api 域名同路径）可达性 —— 定 F-01 最终影响面 | F-01 |
| R2 | `APP_THROTTLE_TTL/LIMIT` 与 SYS:SETTING 动态限流真实值（env 密文不可见） | F-13 |
| R3 | `VENDOR_KEYS_ALI_OSS_ROLE_ARN` 云侧实际权限边界（若角色只读则 F-12 降 P3） | F-12 |
| R4 | Google JWKS 静态 pin（google-jwk.ts 仓库常量）：接受「Google 轮换密钥后 Google 登录不可用」的可用性风险，还是改为运行时拉取+缓存（★lead 推荐改） | SEC 待裁决⑥ |

### lead 已自行裁决的实施口径（告知即可）

1. socket 模块**先补测试再修**（伪造 JWT 握手拒绝 / admin UI 需凭据两条测试先行）。
2. cache delete 的 fire-and-forget 契约保留，异常兜底并入 F-05 统一修复。
3. sensitive verify 的 em 接线问题在批次 3c 实施时核实并修复。
4. F-26 动手前先 grep migration 目录确认是否已有部分唯一索引。
5. F-47 实施时先核对 AppMonitorUserDTOUpdateState 是否白名单放行 userId，再定该项 P2/P3。

---

## 7. 已确认无问题的面（防重复劳动，各线交叉验证）

- 分层与注册：ESLint 五份名单 ≡ 磁盘 34 lib ≡ 五处注册面；0 条向上层间边；madge 899 文件无环；子路径 banned 通配实测可拦（多段子路径导入受分层约束）；libs 零运行时动态 import；相对路径零跨 lib 逃逸；app↔lib 零反向依赖；两处交错点仍成立。
- 依赖注入：19 个 WALNUT_ADMIN_* token 绑定全部跟随实现所在层；forFeature 39/39 显式 WalnutPGConnectionName；InjectDataSource 47 处全带连接名。
- HTTP 认证链：JWT 三重校验、RT 悲观锁轮换 + AES-256-GCM 落库、OAuth state HMAC+nonce+设备绑定、Google id_token jose 验签、双因子签名链认证态不降级、nonce SET NX EX。
- 输入与传输：全局 ValidationPipe whitelist+forbidNonWhitelisted+forbidUnknownValues；helmet+CSP+nginx 安全头+HSTS；错误响应 _devMsg 仅 dev；prod 日志 body/query/params 走 maskSensitiveFields（middleware 层）；探针裸路由极简且 nginx 404；IDOR 抽查（user.me/user_device/user_oauth/logs/setting/key/demo/error）均按 userId 绑定或 Role+Permission 双闸，未发现水平越权实锤。
- DTO 与事务纪律：RealPickType/RealPartialType 全仓零违例（原生 PickType/PartialType 仅在包装器自身）；装饰器顺序 ESLint error 级实装且抽样合规；自管 QueryRunner 三处 release 均在 finally；分页排序统一走 CreateWalnutAdminRequestListDTO。
- openapi 门禁链：export/generate/check + prepush + CI 同源性成立；RealPickType 改名 + swagger12 IntersectionType 唯一命名 ⇒ schema 零泛名碰撞（机器验证）；探针不进 openapi（设计如此）。
- 接口清单口径：195 operations / 173 paths 与 controller 47（app 38 + libs 9）逐字吻合 ADR 0022 Decision 4。

---

## 附录 A：原始编号 → 统一编号映射

| 来源 | 统一 | 来源 | 统一 | 来源 | 统一 | 来源 | 统一 |
|---|---|---|---|---|---|---|---|
| SEC-001 | F-01 | SEC-002 | F-02 | SEC-003 | F-04 | SEC-004 | F-04 |
| SEC-005 | F-10 | SEC-006 | F-06 | SEC-007 | F-11 | SEC-008 | F-12 |
| SEC-009 | F-13 | SEC-010 | F-42 | SEC-011 | F-43 | SEC-012 | F-44 |
| SEC-013 | F-45 | SEC-014 | F-46 | SEC-015 | F-47 | | |
| ARCH-01 | F-14 | ARCH-02 | F-15 | ARCH-03 | F-16 | ARCH-04 | F-30 |
| ARCH-05 | F-31 | ARCH-06 | F-32 | ARCH-07 | F-33 | ARCH-08 | F-34 |
| ARCH-09 | F-35 | ARCH-10 | F-36 | ARCH-11 | F-37 | | |
| CQ-001 | F-02 | CQ-002 | F-01 | CQ-003 | F-05 | CQ-004 | F-06 |
| CQ-005 | F-04 | CQ-006 | F-11 | CQ-007 | F-23 | CQ-008 | F-24 |
| CQ-009 | F-25 | CQ-010 | F-26 | CQ-011 | F-27 | CQ-012 | F-28 |
| CQ-013 | F-04 | CQ-014 | F-29 | CQ-015 | F-38 | CQ-016 | F-31 |
| CQ-017 | F-39 | CQ-018 | F-40 | CQ-019 | F-41 | | |
| DOC-01 | F-03 | DOC-02 | F-07 | DOC-03 | F-08 | DOC-04 | F-09 |
| DOC-05 | F-20 | DOC-06 | F-17 | DOC-07 | F-18 | DOC-08 | F-09 |
| DOC-09 | F-22 | DOC-10 | F-21 | DOC-11 | F-19 | DOC-12 | F-48 |
| DOC-13 | F-49 | DOC-14 | F-50 | DOC-15 | F-51 | DOC-16 | F-38 |
| DOC-17 | F-52 | DOC-18 | F-53 | DOC-19 | F-46 | DOC-20 | F-54 |

---

## 附录 B：裁决记录（用户拍板）

| 项 | 决定 | 对批次的影响 |
|---|---|---|
| Q1 | **a**：保留 admin UI + 强口令（SOCKET_ADMIN_UI_USER / SOCKET_ADMIN_UI_PASSWORD，未配置则不挂载 fail-closed）+ nginx 对 /socket/admin 返回 404 | 批次1 实施中（SA1） |
| Q2 | **a**：修 wire + 专用 list DTO，出参剔除 value/valueHash | 批次1 实施中（SA2） |
| Q3 | **a**：/api 文档仅 dev/stage 挂载，生产不挂 | 批次3a（F-10） |
| Q4 | **a**：CRUD 工厂 + ApiWalnutOkResponse 组装点按 guard 元数据批量注入 @ApiBearerAuth | 批次2（F-08） |
| Q5 | **a**：改文档，覆盖 terminus 声明移除 503 | 批次2（F-09） |
| Q6 | **b：按硬规矩重构，不登记豁免** | 批次4/5：F-31 把 user_preference/device 重构回 Repository 三模式；F-36 探活下沉 probe service；F-38 清理约 15-20 个 DTO 的 ?/裸 validator（含 admin list 过滤参数 wire 兼容验证） |
| Q7 | 追问后裁定：来历为三仓合并占位（见附录 C），**保留空壳但摘 @ApiTags**（Q7a）；「用户第三方账号绑定/解绑管理接口」从未实现，登记为独立 feature 待办，不混入优化批次 | 批次3b（F-48 的标签部分） |
| Q8 | **a**：拆 tech-base / tech-assemble 两条 ESLint layer（同步改 drift spec LAYER_MATRIX） | 批次3d（F-14）；IP_LOCATION_RESOLVER token 迁回 libs/ip 一并做 |
| Q9 | **a**：维持现状，不加权限点 | F-46 只补响应 DTO 文档 |
| Q10 | **a**：按环境 .addServer(prefix) | 批次3b（F-52） |
| R1 | 用户实测 **https://<域名>/socket/admin 当前不可达**（当前部署面未暴露） | F-01 仍按 P0 修代码侧：auth:false 是潜伏雷（换部署形态即暴露），nginx 404 照做防配置回退 |
| R2 | env-local 实读：**production TTL=60s / LIMIT=120**（dev 10/120，stage 60/120） | F-13 维持 P2：基线尚可，但未认证 4xx 也全量入错误库，120 条/分钟/IP 的写放大仍值得修 |
| R3 | env-local 实读 roleArn = acs:ram::1869171916880830:role/**aliyunosstokengeneratorrole**（阿里云开通 OSS STS 时的默认角色，默认挂 AliyunOSSFullAccess，与用户「总管账号」记忆一致） | F-12 维持 **P2**，批次3a 统一按最小权限 policy 签发（所有角色都限 Action + 按路径前缀收窄 Resource）；建议用户顺带在 RAM 控制台复核该角色策略 |
| R4 | **运行时拉取 JWKS + 短 TTL 缓存；拉取失败抛明确错误**（背景：当年静态 pin 是因为国内云服务器拉不到该 JSON） | 批次3a 新增工作项：google.strategy / jwt-jwk 改造 + 失败路径测试（可保留静态常量作注释说明历史） |

> 批次1 = SA1（socket 安全 F-01/F-02，先测试后修）+ SA2（F-03 identity list），已于裁决后并行派发。

---

## 附录 C：批次进展与后续登记

### 批次 1（P0）✅ 已完成并验收（2026-11-02）
- F-01：admin UI 改为 SOCKET_ADMIN_UI_USER/PASSWORD 双配才挂载（fail-closed）+ 启动 warn；nginx /socket/admin 双层 404。**部署注意：PASSWORD 必须是 bcryptjs.hash(强口令,10) 输出（上游包要求，明文启动即 throw）**。
- F-02：握手三重校验（verifyAsync + 过期 + Redis 会话键；缺 device cookie/payload.sid 一并拒），失败一律 next(Error)。
- F-03：identity list 补 plainToInstance + 专用 list DTO（value/valueHash 密文面永不出 wire）；api-types 一处手写别名同步修复。
- 验收：server types/lint/test（43 files/316 tests）全绿；新增 27 用例（socket 21 + identity api-spec 改写）；openapi 重导出字节确定；全仓 types:check 16/16。

### 批次 2（P1）✅ 已完成并验收（2026-11-02）
- F-04：SSE 频道键改为服务端签名 device cookie 推导的 deviceId（URL fp 不参与键、不进日志）；createClient 句柄化引用计数（多标签页互不误删）；空回退 throw；事件契约补 text/event-stream schema。
- F-05：新增 fireAndForget（libs/utils），收编全部 14+3 处（含 risk.guard 每请求热路径、delay 调度、locale 提交后刷新、Google JWK 导入链）；delay 新增 3 例回归测试（process 级 unhandledRejection 判据）。
- F-06：日志脱敏（sessionKey→sessionId、OTP 验证码/job.data、capToken、sign raw body→sha256 摘要、OAuth profile→id+掩码邮箱、socket 事件 payload、IP geo 全量响应），base.processor 加测试钉住。
- F-07/F-08/F-09：sensitive/check 参数与响应 schema；**全站 195 op 文档补齐 security 声明**（171 受保护 op 声明 bearer / 24 匿名 op 不声明；落地层为文档组装点 swagger.document.ts，main.ts 与 export-openapi 同源，DiscoveryService + 与 JwtAccessGuard 完全相同的 JwtFree 判据，幂等注入）；响应壳 code 补 46 值 enum（一处生效全站）；health 五端点移除失真 503 并重写 200 壳（terminus swaggerDocumentation:false + 显式声明，行为零改动）。
- 验收：server types/lint/test（52 files/354 tests）全绿；全仓 types:check 16/16（code 字面量联合未破坏消费侧）；openapi 重导出 214 schemas、195 ops 无丢失。

### 新登记后续项（不属于已批批次，随批次3/4 或独立处理）
1. ~~oauth_state.fp 死字段~~ —— **已解决（6-B）**：确认 fp 只剩「自比」，`issueState(lang, deviceId)` 去掉 fp 入参，明文段只剩 lang/nonce。
2. ~~回调侧 deviceId 取本请求 cookie~~ —— **已解决（6-B）**：`consumeState` 返回 Redis 里签发时的绑定 deviceId，guard 挂 `req.oauthState`，handler 不再回读 cookie、也不再二次解析 state。
3. ~~JwtOptional key 未导出~~ —— **已解决（6-B）**：key 已从 libs/auth 导出，optional op 在文档声明 `security: [{bearer:[]},{}]`（运行时零变化）。
4. apps/api/test/api/ENDPOINTS.md:190 仍写 health 503 旧口径（批次2 后失真），随批次3 顺手更新。
5. 限流器进程内存储（libs/throttle）为多副本前置条件，已注释登记，切换 Redis storage 需单独评估。
6. JwtOptional/「设备+一次性 ticket」更严的 SSE 二段式投递（超出当前评审范围，记录在案）。

### 批次 3（P2）进行中（2026-11-02 派发，4 个 sub agent 并行）
- 3A 安全加固：F-10（/api 文档仅非生产挂载）/ F-11（trust proxy 具体跳数）/ F-12（OSS STS 全角色最小权限 policy）/ F-13（4xx 不入错误库；限流 storage 注释登记）。
- 3B 文档契约：F-17（CRUD list summary）/ F-18（剩余端点 200 schema）/ F-19（locale 映射 body）/ F-20（locale message 参数）/ F-52（servers 字段）。
- 3C 健壮性：F-23（i18n key）/ F-24（functional.guard JSON.parse）/ F-25（dept 事务+防环锁）/ F-26（登录竞态+RT 部分唯一索引，先查 migration）/ F-27（cache BULL 过滤）/ F-28（非空断言）/ F-29（验证码任务 removeOnFail）/ F-21（user_device 描述）。
- 3D 架构守卫：F-14（技术层拆 tech-base/tech-assemble + IP_LOCATION_RESOLVER token 迁回 ip，Q8a）/ F-15（mask @Global 摘除）/ F-16（console.error→Logger）。
- 批次 3 完成后由 lead 统一重导出 openapi（3B 改了文档装饰器）并跑全量门禁。

### 批次 3（P2）✅ 已完成并验收（2026-11-02）
- 3A：F-10（/api 文档 PROD 跳过挂载）/ F-11（APP_TRUST_PROXY_HOPS 可配置，默认 1；含显式 @Transform 兼容非 tsc 链路）/ F-12（OSS STS 全角色最小权限 policy 纯函数，visitor 只读、非 visitor 无 Delete、资源按前缀收窄或 Action 白名单）/ F-13（shouldReportException：code>=50000 才入错误库；限流 storage 注释登记多副本前置）。
- 3B：F-17（CRUD list summary 一处全站生效）/ F-18（重算 21 个缺 schema 端点全部补齐；cap 裸 schema、sign oneOf、error 按错误语义、callback text/html）/ F-19（locale 映射 body）/ F-20（locale message 参数+响应）/ F-52（servers=['/w/v1']，相对 URL，经 AppConfig 读前缀）。
- 3C：F-23（emailAlreadyBound + 顺带 authFailed/invalidOtpType，附 i18n drift spec）/ F-24（functional.guard JSON.parse 兜底）/ F-25（dept 事务对齐 + 锁「被移动行+目标父行」按 id 升序防死锁）/ F-26（**库侧原无索引** → 新迁移 uq_rt_active_device_user 部分唯一索引 + 读腿锁 + 只认该约束名的 23505→40109；存量收敛保留）/ F-27（cache BULL 批量过滤）/ F-28（三处非空断言显式校验；sensitive.operationType default:null）/ F-29（验证码任务 removeOnFail:false + failed 事件日志）/ F-21（user_device 描述）。
- 3D：F-14（**Q8a 拆层**：tech-base 14 / tech-assemble 5 两条 layer，assemble→base 单向；IP_LOCATION_RESOLVER token 迁回 libs/ip；drift spec 9/9）/ F-15（mask @Global 摘除）/ F-16（console.error→Logger，utils/pkg 模块求值期豁免并注明）。
- DOCS：ADR 0022 / backend·monorepo 架构页 / glossary / server AGENTS.md 五处口径与拆层对齐（lint:adr / lint:doc-ts / lint:doc-budget / build:docs 全绿）。
- **验收（lead 独立跑）**：server types/lint/test **434 tests 全绿**；openapi 重导出 **195 ops、0 个缺 200 schema**（❌ 清零）、220 schemas、servers=/w/v1、171 受保护/24 匿名；全仓 types:check **16/16**。

### 批次 4（P3）进行中（2026-11-02 派发，2 个 sub agent 并行）
- 4A：F-30（env 直读）/ F-33（组合根相对路径→@ 别名）/ F-34（宽 barrel 文档口径）/ F-35（ALS debug 日志）/ F-37（drift spec 扫描窄口）/ F-39（cron 吞失败 + CrobJob 拼写）/ F-41（软删回写补偿）/ F-48（@ApiTags 一致性 + 空壳摘标签）/ F-49（数组 query 文档）/ F-50（required 失真）/ F-53（openapi 门禁 --cached 边界）/ **13 个缺 summary 的 op**（先扩展 ESLint DEFAULT_METHOD_ORDER 收录 ApiOperation/ApiResponse/ApiExcludeEndpoint + 同步 dto.md）/ ENDPOINTS.md health 旧口径。
- 4B：F-42（secrets 最小长度 + JWT 显式 algorithms）/ F-43（dev CORS 白名单 + stage cookie secure）/ F-44（UA 豁免注释定性）/ F-45（OPAQUE startLogin 时序等时化）/ F-47（monitor state userId 仅验签 AT 时接受）。

### 新登记后续项（批次 4/5 之外）
1. **「六层」常驻文档预算红线**：apps/server/AGENTS.md 已到 6889/6900（100%），后续任何一行新增都会触发 lint:doc-budget —— 需收紧别处或重设预算（单独立项）。
2. **lint:docs-refs 当前红**：11 处失效引用全部来自未跟踪的 reports/architecture-review/*.md（他人进程产物，非本仓文档）；处置二选一：check-doc-refs.ts 排除 reports/（有 adr/ 先例）或产出方清理。
3. **monorepo/architecture.md 的「五处注册面」枚举**用「磁盘」顶替了 ADR 的「eslint 分层名单」——口径错位，随下次文档修订统一。
4. **SharedLocationDTO 单真源** —— **6-B 调研结论：原方案被阻塞**（libs/types 是 d.ts-only 全局声明层，放不下带装饰器的类；且另有第三份同型声明在 libs/security 的全局 types.d.ts）。已做等价守卫：`libs/ip` 导出 `ISharedIpLocationCore`，`libs/list/src/shared-location.contract.ts` 用编译期 `SameType` 断言把「任一侧改名/删字段/改类型」变成 types:check 红色（新增字段不红，有意）。彻底下沉需动 libs/types + libs/list + libs/security，单独排期。
5. **F-15 的「消费方≥2 才 @Global」机械判据**未做（42 个 @Global 中 17 个 repo 模块属约定内，需白名单设计）——单独立项。
6. **F-16 的 lint 级防回归**：nest 预设 no-console:'off' 是刻意的（main.ts 启动横幅），要做需在预设层定义「libs 禁 console、apps 允许」。
7. **ApiOperation/ApiResponse/ApiExcludeEndpoint 顺序规则**（4A 落地后）——以后新加装饰器要同步顺序表与 dto.md。
8. ~~oauth_state.fp / consumeState deviceId / JwtOptional key~~ —— **已解决（批次 6-B）**。
9. **roleArn 侧纵深（运维）**：本次只约束接口签发的 STS；role 本身仍是 FullAccess，建议阿里云侧收窄或加 PermissionsBoundary。
10. **F-26 用 40109 而非 409**（contract 无 409 码族）；**迁移含存量自动收敛**（reason=forceQuitOnline）——均为已记录的决策口径。

### 批次 4（P3）✅ 已完成并验收（2026-11-02）
- 4A：ESLint DEFAULT_METHOD_ORDER 收录 ApiOperation/ApiResponse/ApiExcludeEndpoint（+5 例规则测试、dto.md 同步、@Sse 移到最末的踩坑记录）；**13 个 op 补齐 summary（全站 noSummary=0）**；F-30/33/34/35/37/39/41/48/49/50/53；ENDPOINTS.md health 口径。
- 4B：F-42（7 个密钥 env @MinLength(32)，env-local 实读最短 38 不自伤；JWT 钉 HS256 —— verifyOptions 与 passport 两处）、F-43（CORS 改显式白名单 + APP_CORS_ALLOW_ORIGINS 覆盖 + 通配源启动告警；stage cookie secure:true）、F-44（UA 豁免定性注释 7 处）、F-45（OPAQUE 不存在用户也完整跑一遍：nil-uuid identity 读 + registrationRecord:null 的 fake record 等量计算 + 等量 Redis 写，之后统一 40103）、F-47（monitor state 的 userId 只认验签 AT，请求体一律覆盖；匿名心跳仍可用）。
- 验收（lead 独立跑）：server types/lint/**498 tests 全绿**；openapi 重导出 195 ops / **0 缺 schema / 0 缺 summary** / 220 schemas；全仓 types:check **16/16**；4B 遗留 23 个 lint 错误（自动可修）已由 lead 清零；4A/4B 造成的 DI 破坏（openapi-response-schema.spec 缺 AppTokenService provider）已由 lead 修复并验证。

### 批次 4C / 5A / 5B 进行中（2026-11-02 派发，3 个 sub agent 并行）
- 4C：**F-47 前端跟进（功能回归修复）** —— apps/admin 心跳 sendBeacon → fetch(keepalive) 带 Authorization；文档补 APP_TRUST_PROXY_HOPS / APP_CORS_ALLOW_ORIGINS / SOCKET_ADMIN_UI_*（bcrypt 要求）；cors.md 旧口径更新。
- 5A：**Q6=b 重构** —— F-31（user_preference/device 数据面下沉 Repository 三模式，行为零变化）/ F-36（health 探针下沉 probe service）。
- 5B：**Q6=b 重构** —— F-38（DTO 问号/裸 class-validator 清理 ≈15-20 处 id? + 8 处 IsOptional/Allow；wire 零变化 + 全仓 types:check 验证；WebAuthn 镜像形状保留并注释）。
- 批次 5 完成后由 lead 统一重导出 openapi（5B 会动 DTO 默认值/可选性）并跑全量门禁。

### 批次 4 新增登记项
11. **F-47 的隐患面**：可选 AT 会让公开端点对伪造 token 触发 verifyAccessToken 的 logger.warn —— 若日志噪声明显，可在 libs/token 侧降级/去重（未动）。
12. **OPAQUE 的代价**：不存在 userName 会多写一个 30s SERVER_STATE 键（有登录限流兜底，已记录）。
13. **F-44 的写范围**：7 处 guard/interceptor 注释超出枚举范围但按任务描述执行（纯注释，git diff 逐行核对过）。
14. **monitor-user.api-spec.ts 更新未执行**（需 PG+Redis，交 CI integration）。

---

## 附录 D：最终验收（全部批次完成，2026-11-02）

### 批次 4C / 5A / 5B ✅ 已完成
- 4C：F-47 前端跟进 —— admin 心跳 sendBeacon → fetch(keepalive) 带 Authorization（token 从现有 pinia store 同步读取，卸载期可读；credentials:'include' 对齐 sendBeacon 的 cookie 语义）；文档补 APP_TRUST_PROXY_HOPS / APP_CORS_ALLOW_ORIGINS / SOCKET_ADMIN_UI_*（bcrypt 要求），cors.md 旧口径更新（admin build 0、无 circular；doc-ts/doc-budget/build:docs 全绿）。
- 5A：Q6=b 重构 —— user_preference 补 Basic Repository（exists/find/upsert，SQL 逐字迁移、em 透传、forFeature 形态不变）；device 复用既有 basic repo 新增 upsertByDeviceId；health 探活下沉 AppTechHealthProbeService（与 terminus pingCheck 逐项等价：SELECT 1 + 1000ms 超时 + {status,responseTime} 壳，失败不抛）。
- 5B：Q6=b 重构 —— 16 个 id? 模板 + 19 个其它 ? 字段 + 13 处裸 class-validator 全部按硬规矩收编（字段不写 ?/!，可选性走装饰器 default；WebAuthn 26 处按外部协议形状保留 + 豁免注释）；新增 dto-field-shape.spec.ts 机械防回潮；唯一行为差异：POST /system/deleted/recover 的 id 从「声明可选但实际被基座 IsOptional 继承」变成真必填（与已发布 swagger 一致，修正了子类 declare 从未生效的事实）；两处 repo create() 入参改 Omit（纯类型）。

### 最终验收矩阵（lead 独立执行，含真实 DB 验证）
| 门禁 | 结果 |
|---|---|
| server types:check | 0 |
| server lint | 0 |
| server test（unit） | 74 files / **506 tests** 全绿 |
| server test:integration（真实 PG/Redis） | 63 files / **562 passed + 1 skipped** 全绿（含 F-26 部分唯一索引、monitor-user F-47） |
| server test:e2e | 1 file / 1 test 全绿 |
| 全仓 types:check | **16/16 tasks** 0 |
| openapi 产物 | 195 ops / **0 缺 200 schema** / **0 缺 summary** / 220 schemas / servers=['/w/v1'] / 171 受保护 + 24 匿名 |
| admin | types:check 0 · lint 0 · build 0（无 circular 告警） |
| docs | lint:docs-refs **0** · lint:doc-ts 0 · lint:doc-budget 0 · build:docs 0 · lint:adr 0 |

### 改动规模
160+ 已跟踪文件变更（+17972 / -3054）+ 新增 spec/迁移/文档；**未提交**（批次 6 完成后按 conventional commits 细粒度提交）。

### 剩余待决 / 后续项（汇总）
| # | 事项 | 建议 |
|---|---|---|
| A1 | reports/ 让 lint:docs-refs 常红 | **已解决**：评审文档按「md 一律住 apps/docs」迁入 content/review/backend + sidebar；reports/ 移出仓库到 %TEMP%\\walnut-external-reports-2026-11-02；**未加任何门禁排除** |
| A2 | apps/server/AGENTS.md 预算 100% | **已解决**：优化后 **5796/6900 = 84%**（余 1104 字符），doc-budget 绿 |
| A3 | DTO 同类残留（base.model 公共基座、monitor/user ×2、logger、sensitive、list/device-geo） | **用户已批准扩范围，批次 6-A 实施中** |
| A4 | oauth_state.fp 死字段 + consumeState 返回 deviceId | **已解决（6-B）**：fp 移除、deviceId 从 Redis 绑定随 consumeState 返回、handler 用 req.oauthState |
| A5 | JwtOptional 文档表达 | **已解决（6-B）**：key 导出；optional op 声明 `[{bearer:[]},{}]`，spec 钉住三档 |
| A6 | SharedLocationDTO 单真源 | **部分**：原方案被 libs/types 定位阻塞；已加 `shared-location.contract.ts` 编译期断言守卫，彻底下沉单独排期 |
| A7 | roleArn 云侧仍是 OSS FullAccess | 运维侧收窄或加 PermissionsBoundary（代码侧已只约束本接口签发的 STS） |
| A8 | 需真实 DB 的用例 | **已在本机 WSL 的 PG/Redis 实跑：integration 562 + e2e 1 全绿**（F-26 索引、recover、setAsSecurity、monitor-user 均覆盖） |
| A9 | 全部改动未提交 | 待 6-A/6-B 完成 → 全量验证 → 按 conventional commits 细粒度分批提交 |
| A10 | 探针临时文件 | `undefined/opaque-probe.cjs` 已移到 %TEMP%\\walnut-junk-20261102；其余在仓库外，不影响提交 |