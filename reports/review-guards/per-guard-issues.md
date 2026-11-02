# I4 · per-guard Issue 列表（供 Lead 逐个立项）

> 配套：`reports/review-guards/review.md`（全景 + 顺序实测）。
> 每条格式：**标题 / 现状 / 待查点 / 建议后续动作 / 优先级**。
> 优先级：P1 = 影响安全或全站可用性，建议本批排；P2 = 有明确缺陷或口径不清，建议下批；
> P3 = 卫生问题（死代码/性能/日志口径）。
> 所有"失败码"都是 **HTTP 200 + body.code**。

---

## G1 · IP —— `WalnutAdminGuardIP`（第 1 位）

**标题**：IP 黑名单有 3 处显式豁免（含整类签名握手控制器），而 health 反而没豁免
**现状**：`ip.guard.ts:35-39` 只查永久黑名单，命中抛 `40603`。`@WalnutAdminGuardIpFree()` 实测有
**3 处**：① `modules/security/sign/sign.controller.ts:36` —— **类级**，整个
`SecuritySignController`（RSA 公钥 / AES key 握手）都豁免；② `user_preference.controller.ts:31`
（`GET /read`，JwtOptional，匿名也能调）；③ `locale.controller.ts:163`（匿名语言包）。
**待查点**：① 让**已被封的 IP** 继续完成签名握手/读偏好是否是有意口径？（语言包"让登录页能渲染"
可以理解，密钥握手性质不同）② 反过来 health/metrics **没有**豁免 —— 被封 IP 的探针会收到 40603，
监控无法区分"服务挂了"与"IP 被封"。③ 只有永久黑名单，无临时封禁。
**建议后续动作**：逐条确认这 3 处豁免的产品理由并写进 controller 注释（现在只有装饰器、没有理由）；
再决定 health 要不要豁免；补一条"黑名单 IP → 40603"的用例（目前 0 覆盖）。
**优先级**：P2（黑名单绕过面）

---

## G2 · Security —— `WalnutAdminGuardSecurity`（第 2 位）

**标题**：OS/浏览器白名单为空时**所有请求都会 40601/40602**（fail-close 全站）
**现状**：`security.guard.ts:87-102` 取 `cacheAppSettingsService.getOSWhiteList()/getBrowserWhiteList()`，
再走 `isInWhiteList`（`:117-125`）：`whiteList = []` ⇒ `.some(...)` 为 false ⇒ 抛。
**即 app_setting 缓存/库缺失（新库未 seed、Redis 被清）时，第 2 个 guard 就把全站打成 40601。**
**待查点**：① 白名单缺失时的期望语义是"全拒"还是"放行（等同于不限）"？
② `getOSWhiteList` 在 Redis miss 时是否回源 `app_setting`？回源失败是否抛（那样就是 50000）？
**建议后续动作**：确认口径并在 guard 注释里写死；补"白名单为空"的用例（现在没有）。
**优先级**：P1（全站可用性）

---

## G3 · Security（第二条）—— `isPostman` 是"注释级安全边界"

**标题**：`isPostman` 直接 return true，安全性只由"生产恒 false"这句注释保证
**现状**：`security.guard.ts:54-56`、`device.guard.ts:57-60`、`cap.guard.ts:68-71`、
`sign.guard.ts:86-89` **四处**都靠 `req.isPostman` 放行；该标记由
`middleware/src/user-agent.middleware.ts` 的 `isPostmanRuntimeRequest` 设置，被 `isDev` 门住。
**待查点**：有没有任何测试断言"生产环境下 `isPostman` 恒 false"？
**建议后续动作**：加一条纯单测（`isPostmanRuntimeRequest` 在 `NODE_ENV=production` 下恒 false）；
或改成"只在 dev 构建里编译进去"。
**优先级**：P2

---

## G4 · Device —— `WalnutAdminGuardDevice`（第 3 位）

**标题**：IP 变更段的写库没有容错，PG 抖动会把请求打成 50000
**现状**：`device.guard.ts:87-101`：IP 变了就 `runWithLock` → `updateIpAndLocation`，**无 try/catch**。
**待查点**：这属于"副作用"还是"鉴权"？副作用失败是否应该阻断请求？
**建议后续动作**：把它降级为 `fireAndForget`（本仓已有 `@walnut-server/utils/fire-and-forget`，
risk guard 就是这么用 `rateService` 的），或包 try/catch 后只记 warn。
**优先级**：P2

---

## G5 · Device（第二条）—— `DeviceFree` 实际豁免了半条链

**标题**：`DeviceFree` 不只跳过 Device，还让 Risk/CAP/MFA/Lock 全部走 skip 分支
**现状**：挂 `DeviceFree` 的端点没有 `deviceId` cookie ⇒ Risk(pre) `risk.guard.ts:64-67` 直接
`return true`（不评估）⇒ CAP `cap.guard.ts:89-92` 拿不到 `recommendation` 就放行；MFA/Lock 各自
"无 deviceId 就跳过"。**实际效果 = 风控 + 人机 + MFA + 锁定 全跳**，但装饰器名字只说了 Device。
**待查点**：这是有意的（登录/握手端点本就不该要 deviceId）还是命名误导？
**建议后续动作**：把语义写进装饰器 JSDoc（"= 跳过整条设备/风控链"），或重命名为
`DeviceChainFree`；补一张"端点 × free 装饰器"矩阵（与 task-5 重叠）。
**优先级**：P2

---

## G6 · Risk(pre) —— `WalnutAdminGuardRisk`（第 4 位）

**标题**：Risk 全程 fail-open，且"无 deviceId 就不评估"与 CAP 的 fail-open 组合成"无风控"
**现状**：`risk.guard.ts:141-151` 未知异常一律 `return true`；`:64-67` 无 deviceId 直接
`return true`（不写 `request.risk`）。下游 CAP 见 `recommendation === undefined` 也放行。
⇒ **风控服务挂掉 / 请求无 deviceId ⇒ 机器人防护整体静默消失**（不是"降级但仍拦"，是"完全不拦"）。
**待查点**：产品口径确认 —— 风控不可用时是"放行（可用性优先）"还是"要求 CAP 挑战（安全优先）"？
（P1-13 的注释只说"风险不做阻塞"，没说"风控服务挂了呢"）。
**建议后续动作**：在 Risk 的降级分支里**显式置一个 `riskUnavailable` 标记**，让 CAP 在
"风控不可用"时选择 challenge 或至少记 metric；不要用"没有 recommendation"和"风控正常且无需挑战"
两种语义共用 `undefined`。
**优先级**：P1

---

## G7 · CAP(pre) —— `WalnutAdminGuardCap`（第 5 位）

**标题**：`recommendation === undefined` 直接放行，无法区分"无需挑战"与"风控没跑"
**现状**：`cap.guard.ts:87-92`。见 G6。
**待查点**：同上。
**建议后续动作**：与 G6 一起改（用显式标记替代 `undefined` 双重语义）；改完补两条用例：
"风控正常且无需挑战 → 放行" vs "风控不可用 → 按口径"。
**优先级**：P1（与 G6 同一条立项）

---

## G8 · CAP（第二条）—— pre/post 同一段逻辑，一次请求最多两次校验

**标题**：CAP guard 在认证前后各跑一次，pre 阶段的 `markCriticalFactorsAsHandled` 拿不到 userId
**现状**：类注释 `cap.guard.ts:43-47` 明说"同一类，认证前后各执行一次，逻辑完全一致"；
pre 阶段 `userId` 必为 `undefined`（`:251`），"user-device 级因子"在 pre 阶段标不了，要等 post 重跑。
**待查点**：① post 阶段重复校验/重复标记是否必要？② 若 pre/post 之间 token 轮换，
post 会真的再调一次第三方 `AppCapJS.validateToken`（缓存键是 deviceId+token）—— 有量级评估吗？
**建议后续动作**：把 pre/post 拆成两个显式阶段参数（而不是"靠 userId 是否存在"隐式区分），
这样"pre 只标 device 级因子、post 只标 user-device 级"能一眼看出来；补一条"token 轮换"的用例。
**优先级**：P3

---

## G9 · JWT —— `JwtAccessGuard`（第 6 位）

**标题**：所有 JWT 失败都塌缩成 40101，且 JWT 失败**不记 `sys_log_auth`**
**现状**：`jwt-access.guard.ts:70-72`：只要 `err` 非空/无 user/ user===false 就抛
`WalnutAdminExceptionAccessTokenExpired`（40101）—— 过期、签名错、会话不存在全都 40101。
且它**不继承** `WalnutAdminGuardAuth` mixin（`guards/src/guards/auth.guard.ts`），
所以 `recordAuth` 不会被调用；而登录端点（opaque/otp/oauth）走 mixin 会记。
**待查点**：① 前端能否只靠 40101 区分"刷新 AT"与"重新登录"？（refresh 端点存在，说明刷新是
独立流程，可能不需要区分）② 失败审计缺口是否可接受（安全面通常要记"AT 失效"事件）。
**建议后续动作**：确认 40101 的单一码是产品口径；若需要区分，新增一个码（如 40102 已存在？
需核对 `response-code.ts`）而不是复用 40101；审计缺口按需补。
**优先级**：P2

---

## G10 · Risk(post) —— `WalnutAdminGuardRisk`（第 7 位）

**标题**：pre 结果缺失时只 warn 继续，合并结果是"半截"
**现状**：`risk.guard.ts:109-115`：取 `request.risk?.comprehensive?.preAuth`，`isNil` 时只
`logger.warn`，然后继续用 `preAuth = undefined` 调 `evaluateComprehensivePostAuth`。
**待查点**：① `evaluateComprehensivePostAuth` 在 preAuth 为 undefined 时的行为是"少一维"还是
"内部兜底"？② 这条 warn 在生产会不会常态出现（因为 deviceFree 端点天然没有 pre 结果）？
**建议后续动作**：把"无 pre 结果"的两种原因（端点被豁免 / pre 异常降级）分开记；
若是豁免端点，压根不该走到 post 评估。
**优先级**：P3

---

## G11 · MFA —— `WalnutAdminGuardMFA`（第 9 位）

**标题**：两个并列的"已验证"信任来源，吊销路径未归口
**现状**：`mfa.guard.ts:59-70`：先看**会话内** `user.mfaVerified`（JWT payload），
再看**跨会话**的 `cacheMfaService.getVerifiedCache(userId, deviceId)`。
**待查点**：① 用户在 A 设备通过 MFA 后，B 设备是否共享？② 吊销（改密/踢设备/降权）时
两处是否都清？③ visitor 角色整段跳过 MFA（`:47-50`）—— visitor 能访问哪些端点由谁来定？
**建议后续动作**：梳理"mfaVerified 的写入点 / 设备信任缓存的写入点 / 两处的清除点"三张表，
补一条"踢设备后 MFA 缓存必失效"的用例（`user-device.api-spec` 可能已覆盖，需核对）。
**优先级**：P2

---

## G12 · Sign —— `WalnutAdminGuardSign`（第 10 位）

**标题**：`signTicket` 缺省时**不比对**（ticket 的"必须携带"没被强制）
**现状**：`sign.guard.ts:249-269`：服务端缓存里有 ticket，但客户端没送（`isNil(signTicket)`）时
跳过比对，直接续签通过。只有"客户端送了且不匹配"才 40112。
**待查点**：ticket 的作用是会话绑定还是"可选增强"？如果它防的是 cookie 移植，缺省即放行就有洞。
**建议后续动作**：确认口径；若要强制，把 `isNil(signTicket)` 也纳入 40112；补两条用例
（"服务端有 ticket + 客户端不送" / "送错"）—— 现有 `sign.guard.spec.ts` 有 169 行，需核对是否已覆盖。
**优先级**：P2

---

## G13 · Sign（第二条）—— nonce 在验签之前就被消费

**标题**：签名错误的请求也会吃掉 nonce（客户端重试必须换 nonce）
**现状**：`sign.guard.ts:108`（`validateAndRecordNonce`）早于 `:159`（比对签名）。
顺序本身是防重放竞态的正确做法，但**外部不可见**。
**待查点**：前端在签名失败重试时是否复用 nonce？复用 ⇒ 永远 40112。
**建议后续动作**：在 `@walnut/utils/sign-raw` 的文档/前端 http 层注明"每次重试必须新 nonce"；
若前端已有重试逻辑，确认它换 nonce。
**优先级**：P3

---

## G14 · Lock —— `WalnutAdminGuardLock`（第 11 位）

**标题**：`deviceId === null` 分支**永不命中**（`getWalnutAdminCookie` 缺省返回 `undefined`）
**现状**：`lock.guard.ts:57` `if (deviceId === null) return true`，但
`libs/cookie/src/helpers.ts:8-15` 直接返回 `req.signedCookies[key]` —— cookie 不存在时是
`undefined`，**不是 `null`**。⇒ 本应"跳过锁检查"的分支走不到，继续用
`undefined` 拼 cache key（`${userId}:undefined`）并可能回源 DB。
**待查点**：① 是否存在"已登录 + 无 deviceId"的真实路径（`DeviceFree` 端点 + 已登录 = 有）？
② 用 `undefined` 当 deviceId 查锁，会不会误判"该用户在该设备被锁"或反之（漏判）？
**建议后续动作**：改成 `if (isNil(deviceId))`（与其他 guard 一致）；补一条
"已登录 + 无 deviceCookie"的用例。
**优先级**：P2（**这是本轮最像 bug 的一条**：判空写法与 helper 返回值语义不一致）

---

## G15 · Throttler —— `WalnutAdminGuardThrottler`（第 12 位）

**标题**：内存存储 + tracker=realIp，多副本下等于"每副本各自限流、NAT 用户共享桶"
**现状**：`throttler.service.ts:11-29` 自己写了两条演进建议（换共享存储 / 前移到 nginx）、
以及 `realIp` 的可信度依赖边缘；`throttler.guard.ts:34-36` tracker 就是 `realIp`。
**待查点**：① 生产是否单副本部署（若是，内存存储可接受）？② 反代是否正确覆写 `X-Forwarded-For`
（`IpMiddleware` 的取值策略决定 tracker 是否可被伪造/合并）？
**建议后续动作**：确认部署形态后写进 ADR；若多副本，按注释建议 1 接 Redis 或按建议 2 前移边缘。
**优先级**：P3

---

## G16 · Role —— `WalnutAdminGuardRole`（`@UseGuards`）

**标题**：装饰器挂了但没给角色 ⇒ **只 warn 然后放行**（fail-open 误配）
**现状**：`roles.guard.ts:35-41`：`payloadRole` 为 nil 时 `logger.warn` + `return true`。
**同样的模式在 Permission`permission.guard.ts:54-60`。** ⇒ 一次"忘了传参"的装饰器写法
（`@HasRole()`）= 该端点**无鉴权**。
**待查点**：有没有 lint/单测能抓"空装饰器"？`route-catalog.drift.spec.ts` 是否覆盖？
**建议后续动作**：改成 fail-close（`throw` 或启动期报错）—— 误配就该红，不该静默；
至少加一条静态 spec 扫全仓 `@HasRole()`/`@HasPermission()` 的调用点参数非空。
**优先级**：P2

---

## G17 · Role（第二条）—— visitor 口径与 Permission 冲突

**标题**：visitor 在 Role 里全拒、在 Permission 里有白名单（见 review.md §8 拍板 Q1）
**现状**：`roles.guard.ts:65-69` 硬拒；`permission.guard.ts:27-35` 白名单 =
硬编码 `app:shared:ali:sts` + 任意 `:list`/`:read` 结尾。
**待查点**：visitor 的只读面到底由谁定义？挂 Role 的只读端点对 visitor 是关的，挂 Permission 的开。
**建议后续动作**：先补"端点 × visitor 可否"矩阵测试钉住现状，再由产品裁决是否统一。
**优先级**：P2（口径不清 + 行为不一致）

---

## G18 · Permission —— `WalnutAdminGuardPermission`（`@UseGuards`）

**标题**：权限缓存缺失即 40105（fail-close），但"重建触发点"未在 guard 侧体现
**现状**：`permission.guard.ts:100-108`：`getPermissionsFromCache(userId, deviceId)` 返回空即
`throw 40105`；root 短路在缓存查询之前（`:72-78`）。
**待查点**：① 缓存 miss 时是否会回源（方法名叫 `getPermissionsFromCache`，看名字像不回源）？
若真不回源，"Redis 被清"= 所有非 root 用户 40105，直到下次登录重建。② 重建触发点在哪？
**建议后续动作**：确认 miss 行为；若确实不回源，考虑在 guard 里显式回源一次（带锁），
或至少把"缓存清空 = 全员 40105"写进运维手册。
**优先级**：P2

---

## G19 · Functional —— `WalnutAdminGuardFunctional`（`@UseGuards`）

**标题**：默认 fail-open，且坏 JSON 被当"设置缺失"吞掉
**现状**：`functional.guard.ts:45-51`（cache miss → 放行）、`:94-117`（坏 JSON → null → 放行）；
只有 `defaultClosed` 端点在缺失时抛 `50301`（`response-code.ts:150`）。
**待查点**：哪些端点挂了 `defaultClosed`？（Google 登录据说有）其余开关"缺失=开"是否都是产品口径？
**建议后续动作**：为每个挂 Functional 的端点补一张"缺失时的期望值"表；坏 JSON 除了 warn
建议再加一个 metric（它意味着有人把设置写坏了，属运维事件）。
**优先级**：P3

---

## G20 · Sensitive —— `WalnutAdminGuardSensitive`（`@UseGuards`）

**标题**：无 user 时抛 40101（"AT 过期"），语义容易误导
**现状**：`sensitive.guard.ts:60-62`：`if (!user) throw WalnutAdminExceptionAccessTokenExpired`。
而它实际是"未认证"，不是"token 过期"。
**待查点**：它只会挂在需要登录的端点上吗？若某端点同时 `JwtFree + RequireSensitive`，
客户端会收到 40101 而不知道"要先登录"。
**建议后续动作**：核对挂载点；若无 `JwtFree` 混用则可保持；否则换成 401（未认证）语义的码。
**优先级**：P3

---

## 跨 guard（不属于单条，但建议单独立项）

**X1 · 12 个 guard 的顺序没有任何门禁** —— 顺序只写在注释里（`app.module.ts:79`、AGENTS.md、
`tech.module.ts:31-33`），`git grep getGlobalGuards` **0 命中**。本轮已跑通实测方法
（同构探针读 `container.applicationConfig.getGlobalGuards()`，20 行）。建议固化成集成测试。
**优先级**：P1（系统性风险，见 review.md 拍板 Q3）

**X2 · `GuardEnv` / `GuardVisitorDeny` 是死代码** —— `guards/src/guards/env.guard.ts`、
`visitor.guard.ts` 全仓零业务引用，但 barrel 仍导出（`index.ts:33,45`）。
安全面里的死代码成本是"读代码的人以为它在生效"。
**建议后续动作**：删，或标注 `@deprecated` + 注释说明"未挂载"。
**优先级**：P3

**X3 · guard 依赖故障会污染错误库** —— guard 内部的基础设施异常（Redis/PG/锁/第三方）冒泡成
`50000`，被 `exception.filter.ts:36-41` 判为服务端故障并入 `sys_error`。
风控/限流依赖抖动会产生大量"错误"，与真正的代码 bug 混在一起。
**建议后续动作**：给"依赖不可用"单独一个业务码段（如 503xx）并在 filter 里区分入库策略。
**优先级**：P3
