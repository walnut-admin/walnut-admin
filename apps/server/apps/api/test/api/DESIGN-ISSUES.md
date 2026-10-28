# API 设计问题清单（DESIGN-ISSUES）

> **唯一真源**：散落在 `ENDPOINTS.md` 各段「钉现状」与 F 段「安全矩阵发现」的行为缺陷/设计问题，
> 自 G+H 段（2026-10-26）起收编为本清单；此后新发现一律记这里，`ENDPOINTS.md` 各段只保留
> 历史叙述并指向本文件，不再双份维护。
>
> **分级口径**：
> - **P0 安全** —— 可被直接利用的攻击面（伪造/重放/绕过），修复优先级最高；
> - **P1 行为缺陷** —— 功能性错误或失效（错误码/数据/清理与预期不符），按影响排期；
> - **P2 语义怪异** —— 行为与直觉/文档不符但属真实设计取舍，改动前需产品/架构决策；
> - **P3 契约不一致** —— 响应形态/错误码层面的毛刺，改动低风险。
>
> 每条四要素：**位置**（源码）、**现象**、**实测证据**（spec + 用例）、**建议**（一句话）。
> 「钉现状」用例属于 characterization test：修复对应问题时必须同步改断言，不是测试坏了。
>
> 统计：**P0 × 5（P0-1 已修：2026-10-26 快照比对 → 2026-10-27 revoke-and-insert 终态；
> P0-2 / P0-3 / P0-4 已于 2026-10-28 修复（批 1）；P0-5 登记为部署强约束、代码不改）｜
> P1 × 12（P1-9 已于 2026-10-27 随 revoke-and-insert 配套修复；P1-4 已于 2026-10-27 修复；
> P1-1 / P1-2 / P1-3 / P1-5 / P1-6 / P1-7 / P1-8 / P1-10 / P1-11 / P1-12 已于 2026-10-28 修复（批 1））｜
> P2 × 10 ｜ P3 × 16（P3-9 已于 2026-10-28 随 OpenAPI codegen 二期修复；共 43 条）**，
> 末节附 G/H 段实测无恙面。

---

## P0 安全

### P0-1 RT 重放实际无拦截 —— 悲观锁没有挡住并发重放（G 段实测，新收编）—— 【已修复：2026-10-26 快照比对 → 2026-10-27 revoke-and-insert 终态】

- **位置**：`apps/api/src/modules/auth/modules/refresh/` —— `shared/refresh.shared.service.ts`
  （`getNewAccessToken` / `updateRefreshToken`）、`repo/refresh.repo.service.ts`（`findByJti` 悲观锁，
  其注释宣称「悲观锁保住重放拦截口」）、`refresh.controller.ts`（`setRTJtiCookie` 原样回种同 jti）。
- **现象（修复前）**：轮换是**同 jti 原地换锁**（`encrypted_token`/`expired_at` 换新、`revoked` 恒 false、
  换发的新 RT JWT 不下发客户端 —— cookie 恒等于同一 jti）。RT_JTI 一旦泄露可**无限并发换发 AT**；
  `findByJti` 的悲观锁只把「读-改-写」轮换腿串行化（防丢更新），等到锁的每个事务读到的都是
  「未撤销、未过期、设备匹配」的新一轮行 —— 全部放行，不构成重放拦截。Mongo 时代的
  「事务写冲突 abort 一方」在 PG 侧没有等价物。
- **实测证据**：`concurrency.api-spec.ts` G1 —— 修复前同一 RT_JTI 五路并发 `POST /auth/refresh`
  **全部 20000**、`auth_refresh_token` 仍单行未撤销；**修复后恰 1 路 20000、其余 40102**，
  旧行 revoked（reason=rotate）+ 新行未撤销（G1 连跑 3 次稳定）；顺序重放
  （旧 jti cookie 再 refresh）在 HTTP 层直接 40102（auth-session spec）。
- **第一轮修法（2026-10-26，已被取代）**：保留原地换锁，`getNewAccessToken` 新增
  `presentedEncryptedToken` 参数，锁内比对「入口时刻 `encrypted_token` 快照（guard 查行时挂
  `request.realRefreshTokenEncrypted`）与库中当前值」，失配 → 40102。**被取代的原因（G1 实测）**：
  快照比对只挡**真正同时到达**的请求 —— 两个请求错峰到达（第二个在胜者提交后才进 guard）时，
  入口各自读到「当前最新密文」，比对通过、双双合法轮换（实测出过 2×20000）；且密文快照拿不到的
  调用方（MFA/TOTP/WebAuthn verify，客户端只持 jti cookie、不走 JwtRefreshGuard）只能跳过比对，
  重放面在 verify 链上始终敞开。根因：客户端 cookie 只存一个 uuid、无 bearer secret，
  **原地轮换永远作废不了它** —— 行不撤销，旧 jti 就永远可用。
- **终态修法（2026-10-27，revoke-and-insert）**：轮换改为「锁内 `findByJti(jti, em, { lock: true })`
  读旧行 → 校验未撤销未过期 → 旧行置 `revoked=true (reason=rotate)` → INSERT 新行（新 jti、同
  user/device、新密文、新过期时间）→ 返回 `{ accessToken, jti: 新jti }`」。旧 jti 行级一次性：
  重放/错峰迟到请求无论何时到达都被撤销判定拦下（guard 入口 `getTokenByJti` 拒撤销行是第一道闸，
  轮换锁内读到撤销行是第二道闸）—— G1 恰 1 路 20000 由时序假设升级为**确定性成立**；cookie 由
  四个轮换端点（refresh / auth/mfa/verify / totp/verify / webauthn authenticate/verify）用新 jti
  回种。`WalnutAdminConstRevokeRTType` 新增 `rotate`，初始迁移 CHECK 同步（dev 库手工 ALTER）。
- **取舍**：第一轮的密文快照比对（AES-GCM 随机 IV、逐字节判定无时序窗、锁内零解密）本身正确，
  输在治标 —— 它假设「入口读到的就是当前值」，错峰即失效。revoke-and-insert 治本：不依赖任何
  「同时到达」假设，旧行只要被轮换过就永久不可用；代价是同 (user, device) 维度从单行变多行
  （顺带把 P1-9「findOne 只撤第一行」从潜伏缺陷变成必现安全洞，同批修复）。
  `findByJti` 锁注释同步改为实际语义（锁 = 串行化「读校验+撤销+插入」，防并发双插；
  重放拦截靠行级撤销）。

### P0-2 sign guard 双因子失败静默降级单因子（F 段发现 1）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/guard/sign.guard.ts`（`computeDualFactorSignature` 失败 fallback）。
- **现象**：会话查无/HKDF 派生失败时回落单因子验签 —— 合法客户端（双因子）被 40112 拦，
  攻击者持「正确签名的伪造 AT + 设备 aesKey」**显式发单因子签名即可通过**（含 payload.userId
  不存在的 ghost AT；`mfaVerified` 是 AT payload 自报字段，同样可伪造穿透）。
  会话吊销对「自选签名模式的客户端」不设防。
- **实测证据**：`guard-matrix.api-spec.ts` —— 删除 `AUTH:SESSIONS` 键后旧 AT 双因子 40112
  （拦截者是 sign guard，非 JWT）；F 段发现 1 的对照面。
- **建议**：`req.user` 存在时双因子派生失败应直接拒绝而非降级。
- **修法（2026-10-28，批 1）**：`sign.guard.ts` 的 `computeDualFactorSignature` 删除
  fallback —— 派生失败直接抛 `WalnutAdminExceptionInvalidSignature`（40112）；未登录
  请求仍走单因子（登录/握手端点不受影响）。guard-matrix 的 ghost AT 用例已从「钉现状
  20000」翻转为拒绝；注意 P0-4 同时修复后，ghost AT 在 JWT 层先被 40101 拦下（sign 层
  40112 是会话中途失效时的第二道闸）。

### P0-3 CAP 校验缓存与设备/token 不绑定 + TTL 单位错误（F 段发现 2）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/guard/cap.guard.ts`（`validateCapToken` 只按 deviceId 查 boolean 缓存）+
  `apps/api/src/modules/techniques/cache/service/cache.cap.ts`（`setCapTokenCache` 把
  `getCapJSConfig().ttl` 毫秒当秒传给缓存）。
- **现象**：缓存窗口内把另一台设备的服务端签名 cookie 原样移植即可通过（token 值从不比对）；
  实际信任窗口 ≈ 41 天而非 1h（cookie 本体 1h 过期但服务端不信 cookie 信 TTL）。
- **实测证据**：`guard-matrix.api-spec.ts` CAP 组用例（F 段实测钉死）。
- **建议**：缓存键掺 token 指纹（值绑定设备）；TTL 单位除以 1000 修正。
- **修法（2026-10-28，批 1）**：`cache.cap.ts` 的缓存键改为
  `SECURITY_CAP_TOKEN:<deviceId>:<sha256(token) 前 16 hex>`，读写接口都吃原始 token
  现算指纹；`delCapTokenCache(deviceId)` 按 `<deviceId>:*` pattern 全清。TTL 改为
  `Math.max(1, Math.ceil(config.ttl / 1000))`（毫秒 → 秒）。guard-matrix 的「跨设备移植
  cookie」用例从 20000 翻转为 40117（本设备缓存不命中 → cap.js 真验失败）。

### P0-4 JWT 层不校验用户存在性/会话（F 段发现 5）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/jwt/`（`jwt-access.strategy` 的 `validate`
  原样返回 payload，无 DB/缓存校验）。
- **现象**：passport 层只保证「签名 + 未过期」，身份真实性完全下游化 —— 与 P0-2 叠加成
  完整的 ghost AT 穿透链（伪造签名 AT + 单因子签名 = 任意 userId）。
- **实测证据**：`guard-matrix.api-spec.ts` JWT 组（`payload.userId` 不存在的正确签名 AT
  过 JWT 层，40112 来自 sign guard）。
- **建议**：`validate` 至少查 `AUTH:SESSIONS` 会话键；或明确接受现状并移除下游重复校验的幻觉。
- **修法（2026-10-28，批 1）**：`JwtAccessTokenStrategy` 开启 `passReqToCallback`，`validate`
  用 `AuthSessionService.getAuthSessionKeyHash(userId, deviceId, sid)` 查会话键
  （`AUTH:SESSIONS:<userId>:<deviceId>:<sessionId>`，与 sign guard 同源键构造；deviceId 取
  DEVICE_ID signed cookie）；查无 → `WalnutAdminExceptionAccessTokenExpired`（40101）。
  每请求一次 Redis GET。落点说明：ghost AT / 删会话键后的旧 AT 现在都先被 JWT 层 40101
  拦下（不再由 sign guard 40112 首拦）；sign guard 的双因子失败 40112 保留为会话中途失效
  的第二道闸。

### P0-5 realIp 恒信任 X-Forwarded-For（F 段发现 4）—— 【已登记 2026-10-28：部署强约束，代码不改】

- **位置**：IP 中间件（`@supercharge/request-ip`，首 header 优先、不校验跳数）与
  `app.set('trust proxy', true)` 双通道并存。
- **现象**：进程内可任意伪造 realIp —— IP 黑名单（40603 可被伪造 IP 触发/绕过）与 throttle
  tracker（`getTracker` 返回 realIp）的 IP 维度风控都可被请求头改写绕过/嫁祸。直连暴露时为
  真实缺陷；生产 nginx 覆盖 XFF 时可接受。
- **实测证据**：`guard-matrix.api-spec.ts` IP 组（临时/永久黑名单两态）。
- **建议**：部署口径强约束（nginx 覆盖 XFF）或改 `trust proxy` 跳数配置。
- **裁决（2026-10-28，批 1）**：**登记为部署强约束，代码不改** —— 生产 nginx 必须覆盖
  X-Forwarded-For / X-Real-IP（`proxy_set_header X-Forwarded-For $remote_addr;`
  `proxy_set_header X-Real-IP $remote_addr;`，**不得用 `$proxy_add_x_forwarded_for`**，
  追加会把客户端伪造值留在首位）。`deploy/nginx/conf.d/{api,frontend}.conf` 已按此口径
  修改并在原位注释；guard-matrix IP 组保留「非黑名单伪造 IP 直通」用例作为现状锚。

## P1 行为缺陷

### P1-1 key rotate 并发产生两条 ACTIVE —— 读腿无锁且无唯一索引兜底（G 段实测，新收编）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/app/key/key.service.ts`（`rotate`）+
  `key.basic.repository.ts`（`getCurrentActiveKey` 无 `FOR UPDATE`）+ InitSchema（`app_key`
  无 `(type, version)` 唯一索引、无 `ACTIVE` 部分唯一索引；`uq_key` 只挡 key 串同毫秒）。
- **现象**：两路并发 rotate 同 type：都在对方提交前读到同一条 current，各 deprecate 一次、
  各插一条 version+1 —— 两条 ACTIVE 并存，`getCurrentActiveKey` 的「version 最大」语义退化
  为同 version 任取。
- **实测证据**：`concurrency.api-spec.ts` G6 —— 两条同 version ACTIVE + 种子行 DEPRECATED。
- **建议**：读腿事务内 `FOR UPDATE`，或加 `(type) WHERE status = 'ACTIVE'` 部分唯一索引
  （败者受控失败）。
- **修法（2026-10-28，批 1）**：选**锁方案**（不加索引；dev 库无需 ALTER）——
  `key.basic.repository.getCurrentActiveKey` 增 `lock?: boolean`，`rotate` 传 true →
  事务内 `FOR UPDATE` 锁当前 ACTIVE 行；HTTP rotate 本就带 `@WalnutTx` 的 ctx.em，cron
  腿由 `rotateForCronJob` 的 `transactional` 包裹。concurrency G6 断言改为「恰一条
  version+1 的 ACTIVE、败者受控 40401（锁恢复后重判 WHERE 读不到 ACTIVE 行）」。

### P1-2 会话键批量清理失效 —— `delByPattern` 内部 `redis.del(数组)` 撞 node-redis v5 rest-args —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/techniques/cache/cache.service.ts`（`delByPattern`）；
  消费方：`auth/modules/signout`、`system/user_device`、`app/monitor`。
- **现象**：`redis.del(keys[])` 在 node-redis v5 需要展开传参 —— 抛错后被 after-commit 钩子的
  catch 吞掉 → `AUTH:SESSIONS` 键残留（permissions / MFA verified 两键正常消失）。
- **实测证据**：`auth-session.api-spec.ts` signout 用例（钉现状断言）+ C 段 user-device/monitor spec。
- **建议**：批量删改 `del(...keys)` 展开或 `unlink(keys)` 数组形态（一处修复三处受益）。
- **修法（2026-10-28，批 1，实测根因订正）**：真正的失效点不是 `del(数组)` 签名（v5.11 收
  「单键或键数组」），而是 `scanIterator` **按批产出 `string[]`**：旧实现
  `Array.isArray(key) ? key[0] : key` 丢弃批内其余键、并把空批变成 `undefined` 混进删除
  数组 → `del` 抛 "must be of type string" 被 after-commit 钩子吞掉。`cache.service.delByPattern`
  改为摊平批次（`push(...keysOfBatch.filter(string))`）+ `unlink(数组)`；
  `deleteKeysInBatch` 同步用 `unlink(数组)` 并跳过空批。auth-session signout 的
  「AUTH:SESSIONS 残留」钉现状翻转为「键已清」。

### P1-3 opaque register 端点匿名调用 500 —— 新用户注册无 HTTP 通道 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/opaque/user/opaque.user.controller.ts`
  （`register/start`、`register/finish` 的 handler 读 `req.user.userName`）。
- **现象**：端点挂 JwtFree 但 handler 解引用未登录的 `req.user` → 匿名 500；语义实为
  「已登录用户补挂口令」，新用户注册（OTP 链）无可用注册面。
- **实测证据**：ENDPOINTS.md §2 登记；`concurrency.api-spec.ts` G2 因此只能下沉 service 层
  测注册竞态。
- **建议**：handler 改读 DTO.userName 并接 OTP 注册链，或显式去掉 JwtFree 明确登录语义。
- **修法（2026-10-28，批 1）**：选**去掉 JwtFree**（register/start、register/finish 两处）——
  端点语义明确为「已登录用户补挂口令」（handler 读 req.user 不变）；匿名调用由全局 JWT
  层 40101 受控拒绝，不再 50000。新用户注册走 OTP 链（concurrency G2 注释与 ENDPOINTS
  同步写明）。

### P1-4 `/state` 后缀请求静默悬挂 —— 全局异常过滤器提前 return —— 【已修复 2026-10-27】

- **位置**：`apps/api/src/modules/shared/BLPath`（`shouldSkip` 后缀表含 `'/state'`）×
  `WalnutAdminFilterExceptionAll`（对命中请求提前 return 不落响应）。
- **现象（修复前）**：`POST /app/monitor/user/state` 等路径上任何异常（含 40099 受控校验错误）都不落
  响应，请求悬挂至客户端超时。前迁移时代遗留，非迁移回归。
- **实测证据**：`monitor-user.api-spec.ts`（B 段，修复前错误断言刻意避开该路径）。
- **修法（2026-10-27）**：`shouldSkip` 的语义本就是「不**观察**」（logger.middleware /
  risk rate.service 用它跳日志与风控采集），异常过滤器把它误用成了「不**响应**」。
  修复收窄语义：过滤器对 skip 名单只跳过 `logger.error` 与 `addErrorQueue`（favicon 类噪声
  依旧不进错误库），统一异常壳的响应恒落盘；`/state`/`/heartbeat` 后缀表项保留（观察豁免
  语义不变）。monitor-user spec 的绕行注释已摘除，`state 非法 body → 40099` 恢复为常规断言。

### P1-5 sensitive：password 通道恒失败 + 可用验证方式探测直接 DataNotFound —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/security/sensitive/`（verify 的 password 比对腿、
  `getUserAvailableMethods`）。
- **现象**：① password 通道恒 40000（identity value 是 opaque record，无法按明文比对还原）；
  ② 缺 security 身份时探测腿直接 40401（而非跳过该方式列出其余可用方式），预期 40119 分支不可达。
- **实测证据**：`security.api-spec.ts` D 段（B7c service 层现状在 HTTP 层同形）。
- **建议**：password 通道接 opaque challenge 或摘除该方式；探测改容错跳过缺失身份。
- **修法（2026-10-28，批 1）**：`getUserAvailableMethods` 不再返回 password（identity value
  是 opaque registration record，无法明文比对）；phone/email 探测腿改用新增的
  `SysUserIdentitySharedService.findIdentity`（缺失身份返回 null）容错跳过，不再
  `getIdentityOrThrow` → 40401。`verify` 的 password 分支保留但恒 false（正常路径在
  `verifyAndGrantPermission` 的 availableMethods 闸就 40000 verifyMethodNotAllowed）。
  security spec 的钉现状断言改写：无 security 身份 → 40000 noVerifyMethodAvailable；
  正例列表只剩 sms/email、首选 sms。

### P1-6 user_identity HTTP 面四缺陷簇（DTO/守卫）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/user_identity/`（dto + controller）+
  `apps/api/src/guard/sensitive.guard.ts`（RequireSensitive 探测）。
- **现象**：① `POST list` 恒 40099（list DTO 是空类 × 全局 `forbidUnknownValues`）；
  ② bind 的 `setAsSecurity` 未挂 IsOptional（缺字段 40099）；③ `update`（rebind）经 HTTP 恒
  40000（partial DTO 把未给键材料化成显式 null，服务端 `verified !== undefined` 判 null 也命中
  useVerifyEndpoint 拦截，任何 body 到不了改值逻辑）；④ `update/status` → 40401（预期 40119
  分支不可达，探测腿直接 getIdentityOrThrow）。
- **实测证据**：`user-identity.api-spec.ts` C 段（①②③④ 全部钉现状）。
- **建议**：① list DTO 补查询字段或对该路由豁免 forbidUnknownValues；② 补 IsOptional；
  ③④ 判据改 `!= null` 并把探测腿改容错。
- **修法（2026-10-28，批 1）**：① `SysUserIdentityListDTO` 加 `@Allow()` 标记属性（提供
  可判定校验元数据，不约束任何键）；② bind 的 `setAsSecurity` 补 `@IsOptional()`（缺省
  false）；③ update 的 value/verified/status 三个判据全部改 `!= null`；④ 探测腿容错
  （随 P1-5）。user-identity spec 四条钉现状逐一翻转：list 20000 / 缺 setAsSecurity 正常
  绑定 / update 20000 改值回 verified=false / update-status 40119。

### P1-7 唯一键/FK 冲突未映射受控异常 → 兜底 50000 —— 【已修复 2026-10-28】

- **位置**：全局异常过滤器（`libs/exceptions` + 过滤器兜底）—— 23505/23503 无映射。
- **现象**：`system/user` create 同名、`app/demo` create 同手机号 → 23505 兜底 50000；
  role create junction FK 23503 同样 50000。客户端拿到的是「服务器错误」而非受控业务码。
- **实测证据**：C 段 user spec 钉现状；`api-rollback.api-spec.ts` role create FK 用例。
- **建议**：过滤器把 23505/23503 按约束名映射成受控 40000 族业务文案。
- **修法（2026-10-28，批 1）**：`WalnutAdminExceptionHandler` 的 QueryFailedError 分支在
  23514 之外补 23505 / 23503 —— 统一受控 40000，约束名进 `_devMsg`。单测
  `exception-handler.spec` 双码断言；user create 同名 23505 与 api-rollback role FK 23503
  的 50000 钉现状翻转为 40000。
- **进展（2026-10-27）**：同族第三个码 **23514 check_violation 已先行收敛** ——
  `WalnutAdminExceptionHandler` 新增 QueryFailedError 分支（`driverError.code === '23514'`
  → 受控 40000，约束名进 `_devMsg`），单测 `common/exceptions/exception-handler.spec.ts`
  钉映射与 23505/23503 兜底现状双面。23505/23503 本体仍按本条建议挂单。

### P1-8 空表边界 TypeError → 50000（menu tree / auth permissions 同病）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/menu`（`fullTree[0].children` 组装）+
  `apps/api/src/modules/auth/modules/session`（`permissionMenuTree[0].children` 的
  indexMenuName 组装）。
- **现象**：`sys_menu` 空表时两处都在 `[0]` 上解引用 → TypeError → 50000（Mongo 时代同病）。
- **实测证据**：C 段 menu spec + D 段 auth-session spec（均靠自建 CATALOG+MENU 行绕开）。
- **建议**：组装前判空，回空树/空 children。
- **修法（2026-10-28，批 1）**：`menu.shared.service` 两处 —— `indexMenuName` 组装改
  `permissionMenuTree[0]?.children?.[0]`，`getIndexMenuName` 入参可空且空节点回 ''；
  `getMenuTreeAndTreeWithoutTypeElement` 的 `fullTree[0]?.children ?? []`。新增单测
  `menu.shared.service.spec` 覆盖空表两条出口（受控空树/空 indexMenuName）。

### P1-9 force-quit 只撤「查到的第一行」RT —— 【已修复 2026-10-27（revoke-and-insert 配套）】

- **位置**：`apps/api/src/modules/auth/modules/refresh/repo/refresh.repo.service.ts`
  （`updateRevokedAndReason` 走 `findByDeviceIdAndUserId` 的 `findOne`）——
  `app/monitor/user` 与 `system/user/device` 两个 force-quit 端点共用。
- **现象（修复前）**：同 user+device 维度存在多行 RT 时只撤第一行，其余仍可换发。
- **实测证据**：C 段 user-device spec（原钉现状用例已同步改为全量撤销形态）。
- **修法**：改 `update ... where userId+deviceId` 全量撤销。revoke-and-insert（P0-1 终态）
  让同维度多行成为常态（历轮 rotate 旧行 + 恰一行现役行），本缺陷从潜伏变成必现安全洞
  （force-quit 后最新现役行仍在场外可换发），随 P0-1 同批修复；`revokeReason` 仅显式传入时
  覆盖（signout 的无理由撤销不抹掉 rotate 旧行的历史 reason）。

### P1-10 throttle 动态覆盖不覆盖 blockDuration（F 段发现 7）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/guard/throttler.guard.ts`（`WalnutAdminGuardThrottler` 只覆盖 limit/ttl）。
- **现象**：触发封禁后的 block 时长仍是全局 ttl（dev 10s）—— 连发攻击者在 block 窗口后
  每 10s 可再打 4 发。
- **实测证据**：`throttle.api-spec.ts`（device/initial 4/60s 连发 + 429 形态）。
- **建议**：动态覆盖补 blockDuration，或显式设置独立全局值。
- **修法（2026-10-28，批 1）**：`WalnutAdminGuardThrottler.handleRequest` 解构
  `blockDuration`，动态 ttl 生效时同步 `blockDuration = ttl`（`@nestjs/throttler` 6.5.0
  的 blockDuration 在 canActivate 默认取全局 ttl）。throttle spec 断言 429 响应的
  `Retry-After ≥ 30`（秒），与修复前 ≈10 区分。

### P1-11 security.guard 黑名单路径分支不可达 —— 自动拉黑死代码（F 段发现 3）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/guard/security.guard.ts`（`isBlacklistedPath` 用含 `/w/v1` 前缀的
  `req.path` 对 `startsWith('/admin')` 等裸常量匹配）。
- **现象**：所有真实路由都带 API 前缀 → 40610 永不命中；扫描器打的裸路径不匹配任何路由 →
  40400，guard 链根本不执行；`addToPermanentBlackList` 的自动拉黑副作用是死代码。
- **实测证据**：`guard-matrix.api-spec.ts`（`/w/v1/admin → 40400` 钉现状）。
- **建议**：匹配前 strip API 前缀（对齐 sign guard 的路径规范化口径）。
- **修法（2026-10-28，批 1，含现实冲突订正）**：guard 内按 sign guard 同口径 strip
  `/{prefix}/v{version}`；但**未命中路由的请求不执行 guard 链**（Nest not-found handler
  直接 404），单改 guard 无法让 `/w/v1/admin` 命中 —— 故新增
  `BlacklistPathMiddleware`（`forRoutes('*')`，用 `req.originalUrl` 取完整路径：
  Nest 11 的通配中间件会把匹配段从 req.url 剥掉）承载同一判定（黑名单常量与判定函数
  从 security.guard 导出复用），命中 → `addToPermanentBlackList(realIp)` + 40610。
  guard-matrix 的 `/w/v1/admin → 40400` 钉现状翻转为 40610（用独立伪造 IP 承载拉黑
  副作用，用后移除）。

### P1-12 dict/data 无 deleteMany 路由 —— 常量在、装饰器未接线 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/dict/dictData`（`Permissions.DELETE_MANY` 常量存在
  但对应装饰器未挂）。
- **现象**：`DELETE /system/dict/data/deleteMany/:ids` → 40400。
- **实测证据**：C 段 dict spec。
- **建议**：补挂 deleteMany 装饰器，或删除死常量明确不提供。
- **修法（2026-10-28，批 1）**：controller 补 `@WalnutAdminDecoratorDeleteMany()` +
  `Permissions.DELETE_MANY`，service 补 `deleteMany`（`deleteSoftByIdMany` 逐行软删 +
  按 label 级联软删 locale，与单删同语义）。dict spec 的 40400 钉现状改为正常批量删
  （两行各落快照、读腿 40401）。

## P2 语义怪异

### P2-1 mfa.guard 强制所有已登录用户 mfaSetup=true，无开关（F 段发现 6）

- **位置**：`apps/api/src/guard/mfa.guard.ts`（未 setup → 40114 拒）。settings 的
  `app.auth.mfa` 键**不控制**该 guard（只被 `user_mfa.shared` 的 methodsRequiredCount 消费）。
- **实测证据**：`guard-matrix.api-spec.ts` MFA 组。
- **建议**：如需灰度只能改 AT payload 的 mfaSetup 口径 —— 产品决策项。

### P2-2 device lock/ban 只写缓存不落库

- **位置**：`apps/api/src/modules/system/device/device.service.ts`（lock/unlock/ban/unban）。
- **现象**：Redis 清空/过期即失效；且锁/封期间同设备后续请求被 Device guard 40606/40607
  拦死（连 unlock/unban 都到不了），端点间只能以缓存复位通道衔接。
- **实测证据**：C 段 device spec。
- **建议**：落库 + 缓存双写（或明确登记为「临时封禁」取舍并写入文档）。

### P2-3 history-users 恒空数组 —— 「只回 user 缺失行」语义反转

- **位置**：`device.service.getHistoryUsersByDeviceId` →
  `user_device.shared.getAllUsersByDeviceId`（PG 侧 populate 恒命中 → 缺失行恒无）。
- **实测证据**：C 段 device spec。
- **建议**：按 sys_user_device 绑定历史返回，或下线该端点。

### P2-4 monitor/cache read 出参恒 `{}` + delete fire-and-forget

- **位置**：`apps/api/src/modules/app/monitor`（read 腿 `void await get`；delete 先响应后 DEL）。
- **实测证据**：`monitor.api-spec.ts` B 段（delete 靠轮询断言）。
- **建议**：read 补 await；delete 明确 fire-and-forget 语义并写入响应契约。

### P2-5 lang public 响应缓存无失效通道

- **位置**：`@WalnutAdminDecoratorCache` 的 lang public 端点（1h TTL）× lang CRUD 不主动失效
  （locale 有 runAfterCommit 全量刷新通道，lang 没有）。
- **实测证据**：A 段 lang spec。
- **建议**：lang CRUD 挂对齐 locale 的 after-commit 失效。

### P2-6 key init 的 JWT_AT 分支不可达

- **位置**：`apps/api/src/modules/app/key/key.service.ts`（`generateNewKeyByType` 无 JWT_AT
  分支 → init JWT_AT 恒 20000 且不落行，二钻 40001 不可达）。
- **实测证据**：`key.api-spec.ts` B 段。
- **建议**：补 JWT_AT 生成分支，或 DTO 层拦 JWT_AT。

### P2-7 error controller ErrorMap 的 40112-40117 异常类与 contract 错误码错位

- **位置**：`apps/api/src/modules/app/error`（ErrorMap，如 40112 挂 CapInteractionRequired，
  真实码 40116）。
- **实测证据**：`error.api-spec.ts` B 段（选了无错位的 40000/40103/40300/50000 断言绕开）。
- **建议**：对齐映射（注意牵动 guard 真实错误码 40116/40117 的语义归属）。

### P2-8 dictType HTTP delete 的 data 腿由 DB CASCADE 静默清掉且不产生软删快照

- **位置**：`apps/api/src/modules/system/dict/dictType`（delete = 快照 + 原行硬删；data 腿
  `fk_dict_data_type` CASCADE，无 data 快照）。
- **实测证据**：C 段 dict spec。
- **建议**：级联软删（data 也进回收站），或登记「字典数据不进回收站」为明确取舍。

### P2-9 零配置部署下 COMBINE 用户的「多角色合并」实际不生效（I 段实测，新收编）

- **位置**：`apps/api/src/modules/techniques/cache/service/cache.appSettings.ts`
  （`defaultFunctionalRole`：`{ scope: GLOBAL, globalValue: 'switchable', localKey: 'roleMode' }`）
  + `apps/api/src/modules/shared/scopeResolver/scope-resolver.service.ts`（`resolve`：scope GLOBAL
  恒返回 `globalValue`，`target[localKey]` 只在 LOCAL 分支被读）→
  `system/role/shared/role.shared.service.ts getCoreMenus`（`payload = effective === COMBINE ?
  user.roleIds : [user.currentRole]`）。
- **现象**：`app_setting` 无 `app.functional.role` 行（集成库 migrations 只建结构，零配置部署同态）
  时 effective roleMode 恒 `switchable` —— 用户行上的 `role_mode='combinable'` 被完全忽略，
  `getCoreMenus` 只取 `[currentRole]` 单角色的菜单/权限串。与 `permission.guard` 的 root 短路
  （直接读 AT payload 的 roleMode/roleNames）不对称：COMBINE 用户的非 current 角色权限静默不可用，
  无任何报错。只有管理员显式把 `app.functional.role` 配成 `scope: 'local'` 后，用户自身
  roleMode 才参与判定。
- **实测证据**：`permission-chain.api-spec.ts` SWITCH/COMBINE 对照用例 —— 同一用户
  （junction 双角色、current_role 指主角色）：默认设置下 `GET /auth/permissions` 只含主角色
  权限串；把 `APP:SETTING` 缓存的 `app.functional.role` 改写为 LOCAL scope 后 COMBINE 腿
  合并双角色、role_mode 改 switchable 重登后回落单角色（三态断言全绿）。
- **建议**：属产品/架构决策，不在迁移批修复 —— 确认零配置默认应为 GLOBAL/switchable
  还是 GLOBAL/combinable（或 ETL 期把该设置行落成显式数据）；若维持现状，把
  「COMBINE 需显式配 `app.functional.role` scope=local 才生效」写进部署文档。

### P2-10 locale body 管道局部放宽全局校验不变式 —— 有意设计，已登记（2026-10-27）

- **位置**：`apps/api/src/modules/system/locale/locale.controller.ts`（`TransformedLocaleBody`
  的 ValidationPipe：`whitelist: false` + `skipMissingProperties: true`）。
- **现象**：该端点的请求管道**局部放宽**了全局 ValidationPipe 的 whitelist +
  forbidNonWhitelisted + 全量必填三条不变式。
- **裁决**：**有意设计，不改行为。** 理由在 wire 形状：create/update 的 body 是
  `{ key, oldKey?, <langId-uuid>: 翻译值 }` 翻译映射，键名是运行时 lang uuid，永远不可能
  出现在静态 DTO 属性集里 —— 全局 pipe 会把 uuid 键剥掉/拒掉，批量翻译一个都到不了
  service。校验没有消失而是二段式后移：① 宽松 pipe 只做 transform（保留 uuid 键）；
  ② `LocalePayloadTransformPipe` 把 uuid 键映射成 `[{ langId, key, value, oldKey }]`；
  ③ `ParseArrayPipe` 才对每个元素按 `SysLocaleDTOCreateRequest` 严格校验。
- **机械保障**：controller 内注释已把「为什么必须放宽」写透（2026-10-27 补全）；放宽只覆盖
  第一段，wire 契约仍由第三段钉死 —— locale.api-spec 的批量 create/update 用例即回归面。

## P3 契约不一致

### P3-1 throttle 429 形态是 HTTP 200 + body.code 42900

- **位置**：全局异常过滤器统一 200 壳的副作用 —— 429 语义仅存于业务码。
- **实测证据**：`throttle.api-spec.ts`。
- **建议**：接受现状并写入前端契约，或为 ThrottlerException 例外放行 HTTP 429。

### P3-2 device initial 重名 device_name（23505）被 catch-all 吞掉 → 误导性 40605

- **位置**：`device.service.initial` 的 catch-all（一切异常改抛 NOT_ACCEPTABLE_DEVICE_UNSUPPORTED）。
- **实测证据**：F 段补记「测试踩坑」。
- **建议**：catch 内单列 23505 → 受控 40000。

### P3-3 gitee/github callback 缺 code → passport-oauth2 authorize 重定向腿（302）

- **位置**：`auth/modules/oauth` callback 端点（无受控错误壳）。
- **实测证据**：`external-oauth.api-spec.ts` D 段。
- **建议**：controller 前置 code 校验，缺码直接受控 40000。

### P3-4 `/auth/permissions` 顶层是「首个根节点的 children」—— 单根无子级时顶层数组恒空

- **位置**：`auth/modules/session`（permissions 组装）。
- **实测证据**：`auth-session.api-spec.ts` D 段。
- **建议**：返回完整根数组，或把「单根 + children」约定写进前端契约。

### P3-5 webauthn register/verify 带 garbage response → 未受控异常兜底 50000

- **位置**：`system/user/mfa` webauthn verify（simplewebauthn 异常未包装）。
- **实测证据**：`user-mfa.api-spec.ts` C 段。
- **建议**：包装成受控 40000。

### P3-6 `/shared/ali/sts` 在 env 配有 vendor key 时发真实外网请求

- **位置**：`shared/ali`（STS assumeRole 直连阿里云）—— 结果取决于外部服务，不可脚本稳定。
- **实测证据**：`shared-ali.api-spec.ts` D 段（受控两态断言：20000 信封 XOR 50000 兜底）。
- **建议**：STS 客户端注入化（测试可替换），或加 dry-run 开关。

### P3-7 role 无 delete / deleteMany 端点（CRUD 四件缺二）

- **位置**：`system/role` controller —— 只有 CRUD 四件中的 create/read/update/list。
- **实测证据**：C 段 role spec（文件头登记）。
- **建议**：确认设计意图：补端点，或在 API 文档登记「角色不删」为明确约束。

### P3-8 cap challenge/redeem 无响应壳 + OAuth SSE `@Res()` 直写 —— 确认设计内，已豁免（2026-10-27）

- **位置**：① `security/cap` 的 `challenge` / `redeem`（`@WalnutAdminDecoratorFreeResponse()`，
  全仓仅此两处）—— body 即 cap.js 协议形态 `{challenge,token,expires}` / `{success,...}`，
  无 `{code,data}` 统一壳；② `auth/oauth` gitee/github 的 `sse` 端点（`@Res()` 直写
  `IWalnutAdminExpressResponse`）—— SSE 流式响应必须绕过 Nest 拦截器管道。
- **裁决**：**确认为设计内，已豁免，不修。** 前者是第三方 cap.js 协议对接（壳由协议定），
  后者是 SSE 传输语义（拦截器包装会破坏流式分帧）。两者均不进统一壳契约，安全矩阵与
  spec 断言按各自协议形态钉（security.api-spec D 段 / external-oauth.api-spec）。

> 以下 P3-9 ~ P3-16 为 OpenAPI codegen 二期（2026-10-28，admin 全模块切换生成类型）批量
> 核对 openapi.json 与真实 wire 时发现——生成类型暴露的是 **swagger 文档层** 的缺口，
> wire 行为本身有 430 测试锚定、零变化；admin 侧已按 wire 事实在 `@walnut/api-types`
> 别名层兜底（`process` 补声明 / read 端点手写响应形状），server 修复另行排期。

### P3-9 `/system/user/lock/read` swagger 谎报 `primitive: 'boolean'` —— 【已修复：2026-10-28 装饰器 DTO 化】

- **位置**：`system/user_lock/user_lock.controller.ts` `@Get('read')`。
- **现象**：`@ApiWalnutOkResponse({ primitive: 'boolean' })` 但处理器实际
  `return new SysUserLockPreferenceDTO(res)` —— 文档层 data 是 boolean，wire 是
  `{locked, lockRoute, lockMode, lockIdleSec, lockSecuritySec, lockCrossDevice}` 对象。
  admin 的锁屏状态类型因此无法从生成类型推导。
- **实测证据**：`user-lock.api-spec.ts` 断言对象形态（`locked`/`lock_cross_device` 等）；
  openapi.json `GET /system/user/lock/read` 曾是 `data: boolean`。
- **修法（2026-10-28，codegen 二期例外流程）**：装饰器改 `DTO: SysUserLockPreferenceDTO`
  并重新 export/generate —— 只动 swagger 元数据，wire 零变化（断言不受影响）。

### P3-10 lang / locale list 行的 `process` 未入 swagger

- **位置**：① `system/lang/lang.basic.repository.ts`（PG list 覆写注入 `process`，`SysLangDTO`
  无该字段声明）；② `system/locale/dto/locale.dto.ts`（`process` 声明在子类
  `SysLocaleDTOSafe`，但 `SysLocaleDTOListResponse` 经 RealPickType 归并回 `SysLocaleDTO[]`，
  生成 schema 丢失）。
- **现象**：wire 上 list 行真实携带 `process`（admin 列表的「翻译进度」列直接消费），
  生成类型无声明。
- **实测证据**：`lang.basic.repository.ts` L88 `process: (localesFinishedCount / localesTotalCount) * 100`；
  生成 `SysLangDTO` / `SysLocaleDTO` schema 均无 process。
- **建议**：① `SysLangDTO` 补 `@Expose() process?: number`（或 list 专用行 DTO）；
  ② locale 的 ListResponse 改用含 process 的行 DTO。admin 已在别名层补 `process?: number` 兜底。

### P3-11 `GET /system/device/{id}/history-users` 装饰漏 `isArray`

- **位置**：`system/device/device.controller.ts` `@Get(':id/history-users')`。
- **现象**：`@ApiWalnutOkResponse({ DTO: SysDeviceDTOHistoryUsersResponse })` 未带
  `isArray: true`，openapi 文档 data 是单对象；处理器 `plainToInstance(..., 数组)` 实返数组。
- **实测证据**：admin `getDeviceHistoryUsersAPI` 直接 `.map` 消费（device/index.vue 历史用户表）。
- **建议**：装饰器补 `isArray: true`，重新 export/generate 即可（admin 已按数组消费）。

### P3-12 `GET /system/user/me/security-tab2` `DTO: null` 实返对象

- **位置**：`system/user/controllers/user.me.controller.ts` `@Get('security-tab2')`
  （装饰与端点均自带 `// TODO should remove`）。
- **现象**：openapi 文档 `data: null`，实际返回 `{totp: {status, verified}, webauthn: {status, verified}}`
  （admin `IResponseData.Me.Security.Tab2Status` 手写兜底中）。
- **实测证据**：admin me/security tab2 直接消费该形状（`userMeService.getSecurityTab2Status`）。
- **建议**：端点既标记待移除，二选一：补一个 tab2 状态 DTO 的 `@ApiWalnutOkResponse`，或按 TODO 下线端点。

### P3-13 `SysUserPreferenceDTOAccessibilityRequest.fontSize` 枚举生成 `never`

- **位置**：`system/user_preference/dto/user_preference.dto.ts` +
  `preference.const.ts` 的 `fontSizeConst`（数字自映射对象 `{10: 10, ...}`）。
- **现象**：`WalnutAdminDecoratorFieldEnum(() => fontSizeConst)` 把整个对象直传
  `ApiProperty({ enum })`，swagger 产出的 enum 形态无法被解析为 number 枚举，
  openapi-typescript 生成 `fontSize: never` —— 该 schema 整体不可用作消费类型
  （admin 用户偏好响应只能保留手写形状）。
- **实测证据**：生成 `schema.d.ts` `fontSize: never`（`@enum {number}`）。
- **建议**：`fontSizeConst` 改数组（或 FieldEnum 侧传 `Object.values(...)`），注意
  `WADVE` 校验器同源消费需一并核对。

### P3-14 logger / monitor-cache 行无 `id`，两个 read 端点无 schema

- **位置**：① `app/logger`（list 行 = `AppLoggerDTO`，无 id；`read` 手工返回
  `{fileName, filePath, fileContent: string[]}` 无任何 swagger 装饰）；②
  `app/monitor/cache`（list 行 = `AppMonitorCacheDTO`，无 id；`read` 手工返回 `{value}`）。
- **现象**：admin `BaseAPI<T extends { id: string }>` 下这两个模块的行类型被迫带
  约束性虚构 `id`（CRUD 实际用 `filePath` / `key` 做 rowKey）；read 端点响应与 list 行
  不同形且无 schema，admin 只能手写。
- **实测证据**：`logger.service.read` / `cache.controller.read` 返回字面量；
  `views/app/logger/index.vue` `keyField = 'filePath'`、`views/app/monitor/cache/index.vue`
  `keyField = 'key'`。
- **建议**：给 read 端点补专用响应 DTO（顺带修 `dictData` 同类的「手工返回无文档」面）；
  id 虚构可在 server 决定是否给两表真实主键后再摘。

### P3-15 `AppMonitorUserDTO.userId` 标必填 `string`，wire 上未登录访客为 `null`

- **位置**：`app/monitor/user/dto/user.dto.ts`（`@Expose() userId: string` 无可空标记）。
- **现象**：生成类型 `userId: string`（ListResponse 行内必填）；实体列可空，未登录访客
  监控行 userId 为 null。admin `/state` 上报也直接发 `userId: null`。
- **实测证据**：admin `useMonitor.ts` `sendUserMonitorBeacon({ userId: null, auth: false })`；
  生成 `AppMonitorUserDTO.userId: string`。
- **建议**：DTO 侧声明可空（`userId?: string | null` 形态的装饰），swagger 同步；
  admin 已按 `userId?: string | null` 兜底。

### P3-16 `SysDictTypeDTOSafe.dictData` 声明为必填单对象，PG list 行不材料化

- **位置**：`system/dict/dictType/dto/dictType.dto.ts`（`dictData?: SysDictDataDTOPopulatedDictData`
  虚拟字段 + 生成 schema 标为 required）+ `dictType.basic.repository.ts`（PG list 只注入
  `dictDataCount`）。
- **现象**：Mongo 版 `$lookup` 曾材料化 dictData；PG 迁移后 list 行只有
  `dictDataCount`，`dictData` 恒缺失 —— 生成类型却声明必填的单对象，与 wire 不符
  （admin 不消费该字段，走 `GET /system/dict/type/s` 的 `WithDictDataResponse` 数组形态）。
- **实测证据**：`dictType.basic.repository.ts` 的 list 行接口仅 `& { dictDataCount: number }`。
- **建议**：摘除或改可选（Mongo 时代虚拟残留；顺带核对 `dictDataCount` 的 required 标记是否属实）。

---

## G/H 段实测无恙面（并发与回滚的正面结论）

> 以下竞态面**实测守住**，对应的钉现状用例在修复 P0-1 / P1-1 时须同步复核
> （P0-1 已修，2026-10-27 二次重构为 revoke-and-insert，G1 断言已同步改为终态形态）。

| 竞态面 | 实测结论 | 证据 |
|---|---|---|
| RT 并发重放（同一 jti 五路 refresh） | 【已修面，原 P0-1】revoke-and-insert：轮换 = 旧行置撤销（reason=rotate）+ INSERT 新行，旧 jti 行级作废 —— 恰 1 路成功、其余受控 40102 **确定性成立**（败者 guard 层或锁内读到撤销行；连跑 3 次稳定）；顺序重放（旧 jti cookie 再 refresh）在 guard 层直接 40102 | `concurrency.api-spec.ts` G1 + `auth.refresh-token.pg.int-spec.ts` 重放用例 + `auth-session.api-spec.ts` HTTP 重放用例 |
| 同名注册并发（service 级 finishRegister 双事务） | `uq_user_name` 恰一胜出；败者受控（预检 DataExists / 23505 收敛 InvalidCredential），user/identity/junction 恰一行 | `concurrency.api-spec.ts` G2 |
| 同指纹并发 device/initial | 「查到即覆盖/否则插入」在 `uq_device_id` 上决出唯一胜者，败者受控 40605，库里恰一行，无 50000 | `concurrency.api-spec.ts` G3 |
| 同 user 四段并发 preference PATCH | `ON CONFLICT (user_id) DO UPDATE` 按列回写：单语句 upsert 行锁自然串行，四段齐落、无死锁无丢段 | `concurrency.api-spec.ts` G4 |
| 同一 sys_deleted 行并发 recover | 原表 insert 在 PK 上串行化 + 拦截器回滚：恰一成功一受控失败（40000/40401），快照行不复活 | `concurrency.api-spec.ts` G5 |
| 事务回滚传播（HTTP 级） | role create 第二腿 FK 拒绝 → 主行+junction 零残留；recover 撞唯一键 → 40000 recoverFail + 快照行完好；拦截器对真实 HTTP 请求的 rollback 生效 | `api-rollback.api-spec.ts` |
| after-commit 钩子时序 | device initial 响应返回时 `SYS_DEVICE` 缓存已落（钩子在 commit 后、响应 flush 前执行，零轮询断言成立） | `api-rollback.api-spec.ts` |
