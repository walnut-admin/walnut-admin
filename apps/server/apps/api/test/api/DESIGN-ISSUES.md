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
> 统计：**P0 × 6（P0-1 已修：2026-10-26 快照比对 → 2026-10-27 revoke-and-insert 终态；
> P0-2 / P0-3 / P0-4 已于 2026-10-28 修复（批 1）；P0-5 登记为部署强约束、代码不改；
> P0-6 已于 2026-10-28 修复（批 A，roadmap §6））｜
> P1 × 19（P1-9 已于 2026-10-27 随 revoke-and-insert 配套修复；P1-4 已于 2026-10-27 修复；
> P1-1 / P1-2 / P1-3 / P1-5 / P1-6 / P1-7 / P1-8 / P1-10 / P1-11 / P1-12 已于 2026-10-28 修复（批 1）；
> P1-13 ~ P1-17 已于 2026-10-28 修复（批 A/B，roadmap §6）；
> P1-18 / P1-19 已于 2026-10-28 修复（批 D，roadmap §6））｜
> P2 × 32（批 2：P2-1 确认为安全立场设计；P2-2 ~ P2-9 已于 2026-10-28 修复；P2-10 已登记；
> P2-11 ~ P2-15 为文档大轮次 A 段新登记，P2-12 / P2-13 / P2-15 已于 2026-10-28 修复（批 C，roadmap §6）；
> P2-16 ~ P2-20 为 B 段新登记，P2-16 / P2-18 已于 2026-10-28 修复（批 D，roadmap §6；P2-18 的
> junction 部分仍登记；P2-22 用户外围条目随其覆盖，剩 oauth 一面）；
> P2-21 ~ P2-29 为文档大轮次 C 段新登记；P2-30 / P2-31 为 D 段新登记；
> P2-32 为 C+D 批复审新登记（2026-10-28，登记不修））｜
> P3 × 30（P3-2 / P3-3 / P3-5 已于 2026-10-28 修复；P3-1 / P3-4 / P3-6 / P3-7 同日裁决登记；
> P3-8 已豁免；P3-9 随 OpenAPI codegen 二期修复；P3-10 ~ P3-16 为 codegen 二期挂单；
> P3-17 为文档复审新登记；P3-18 ~ P3-20 为 B 段新登记；
> P3-21 ~ P3-24 为 C 段新登记；P3-25 ~ P3-30 为 D 段新登记）**，末节附 G/H 段实测无恙面。

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

### P0-6 app/key/current 无授权读取服务器私钥与 AES 密钥（文档大轮次 D 段）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/app/key/key.controller.ts` 的 `@Get('current/:type')`
  （无 `@HasPermission`、无 `@WalnutAdminDecoratorHasRole`）+ `key.service.ts` 的
  `getCurrent`（RSA_PAIR 返回 `publicKeyPem` + `privateKeyPem`，AES_KEY_URL 返回 `keyB64`）。
- **现象**：该端点只走默认全局守卫链，**任何已登录用户（含 visitor）**都能读取服务端 RSA
  私钥与 AES 密钥材料。RSA 私钥正是 `@WalnutAdminDecoratorDecryptRequest` 请求解密所用的
  当前私钥；`GET /security/rsa/public-key` 才是只暴露公钥的公开端点。同 controller 的
  init / rotate 都挂了 root 角色，唯独 current 没有，权限面自相矛盾。
- **实测证据**：`key.api-spec.ts` 的 current 用例断言 `data.privateKeyPem` 含
  `BEGIN PRIVATE KEY`（响应确实带私钥）；`ENDPOINTS.md` §1 该行也注明「无 @HasPermission
  → guard 放行」。root 短路让现有回归只以 root 调用，未暴露普通用户的读取面。
- **建议**：current 挂 `@WalnutAdminDecoratorHasRole([root, developer], OR)`；更稳妥的做法是
  拆公开视图，只返回 `publicKeyPem`，私钥与 `keyB64` 永不出 HTTP。
- **修法（2026-10-28，批 A，决策见 roadmap §6）**：
  ① **私钥永不出 HTTP**：`AppKeyMetaTypeRaw` 删除 `privateKeyPem` 字段（init/rotate 的
  AppKeyDTOSafe 序列化同样剔除）；`key.service.getCurrent` 只组装公开面（RSA
  `publicKeyPem` / AES `keyB64`）；服务端请求解密改走 `getCurrentActiveKey` 的实体 meta
  通道（`security/rsa` 同步改线）。
  ② **RSA 视图加管理权限**：新增 `AppKeyCurrentGuard`（继承 permission.guard 判定）只对
  `type=RSA_PAIR` 校验 `app:key:read`，非 root 未授予 → 40105；`AES_KEY_URL` 保持登录
  可读 —— 它是 admin 前端 URL 掩码的**客户端分发密钥**（`apps/admin` 路由守卫全局按需
  拉取，非 root 用户同样触发），且不是私钥材料；admin 对 `privateKeyPem` 零消费（grep
  确认：仅 `keyB64` 用于 URL 掩码，RSA 公钥走公开端点 `/security/rsa/public-key`）。
  ③ 测试：key.api-spec 断言 current/rotate 响应无 `privateKeyPem` + DB 实体仍持有私钥；
  permission-chain spec 断言非 root 无权限用户 RSA 视图 40105、AES 视图 20000。

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

### P1-13 风险层「阻塞」整条腿不可达 —— 推荐恒 shouldBlock=false + guard 自吞异常（文档大轮次 A 段）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/security/risk/risk.service.ts`（`generateRecommendation`）+
  `apps/api/src/guard/risk.guard.ts`（`canActivate` 的 try/catch）。
- **现象**：`generateRecommendation` 的所有返回分支都把 `shouldBlock` 写死为 `false`
  （crash 场景也只有 `shouldChallenge: true`）；risk.guard 在 `try` 内 `throw
  WalnutAdminExceptionRiskTooHigh`，但同一函数的 `catch` 对所有异常 `return true` ——
  连自己刚抛的控制流异常也被吞掉。结果是 **40666 RiskTooHigh 当前不可达**，风险层只剩
  CAP 挑战，没有阻塞腿；评估过程任何异常也按「优雅降级」放行。
- **实测证据**：本次文档复审读码钉死；`guard-matrix.api-spec.ts` 只钉 CAP 的 40116/40117
  拒绝面，全仓无用例断言 40666。
- **建议**：`generateRecommendation` 按 level 给出 `shouldBlock`（或明确删除该字段，别保留
  「看似有阻塞」的契约）；`catch` 只吞未知异常，`HttpException` 原样 rethrow。
- **修法（2026-10-28，批 B，决策见 roadmap §6）**：口径定为**「风险只触发 CAP 升级，
  不做阻塞」**。①`recommendation` 的 `shouldBlock` 字段从类型（`types.d.ts`）与全部返回
  分支摘除，risk.guard 的两处 `if (shouldBlock) throw RiskTooHigh` 消费点同步删除 ——
  风险结果只写 `request.risk` 供 CAP guard 消费（40116/40117 腿不变）。②risk.guard 的
  `catch` 改为 `HttpException` 原样 rethrow（受控异常直通全局过滤器，40666 若由受控路径
  抛出可达）、未知异常仍优雅降级。③测试：新增 `risk.service.spec.ts`（CRITICAL/MEDIUM/
  LOW 三档推荐均无 shouldBlock、高风险 shouldChallenge=true）与 `risk.guard.spec.ts`
  （RiskTooHigh 不被 catch 吞、未知异常降级放行）。产品口径下正常高风险走 CAP 升级，
  **40666 不再是请求拒绝路径**（本项测试按代码现实断言 CAP 腿，非拒绝）。

### P1-14 opaque register 端点在登录态恒 40001 —— P1-3 只摘 JwtFree，服务层仍是「新用户注册」（文档大轮次 A 段）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/opaque/user/opaque.user.controller.ts`
  （`register/start`、`register/finish` 读 `req.user.userName`）+
  `apps/api/src/modules/auth/modules/opaque/core/opaque.core.service.ts`
  （`startRegister` / `finishRegister` 首步 `findUserByUserName` 查重）。
- **现象**：端点语义被 P1-3 定为「已登录用户补挂口令」，但服务层仍按「新用户注册」实现：
  `startRegister` 查到同名用户即抛 40001 DataExists，`finishRegister` 还要新建用户。
  已登录用户的 `userName` **必然**已存在，因此这两个端点对登录态调用**恒 40001**，
  「补挂口令」不可达；加上 register 端点已摘 JwtFree，匿名也进不来 —— 该族端点整体没有
  可用路径。新用户注册实际只能走 OTP 链。
- **实测证据**：本次读码钉死；P1-3 修复记录只描述守卫层改动，ENDPOINTS §2 仍注明 handler
  读 `req.user.userName`。
- **建议**：改为「按当前 `userId` upsert password identity」（不查重、不建用户），或明确
  下线该族端点；不要把它接回新用户注册语义（与 OTP 链重复）。
- **修法（2026-10-28，批 B，决策见 roadmap §6）**：语义定为**「已登录用户补挂口令」**。
  ①`AuthOpaqueCoreService.startRegister` 删除 `findUserByUserName` 查重；`finishRegister`
  签名改为 `(userId, registrationRecord, em)`，按 `userId` **upsert** password identity
  （存在即替换 value/valueHash，不存在则建），不建用户、不再抛 DataExists；controller
  传入 `req.user.userId`。②repo 新增 `upsertIdentity`（`ON CONFLICT (user_id,type,purpose)`，
  并发补挂原子收敛）。③测试：opaque-admin spec 补「登录态 register start/finish →
  identity 替换、再次补挂仍成功、匿名仍 40101」；concurrency G2 改为「同一用户两路并发
  补挂口令 → 两路皆成功、identity 恰一行」；auth.login-chain int-spec 的注册三例改为
  「补挂 / identity 腿回滚 / 重复补挂 upsert 替换」，新用户由 `createForAuthUser` +
  `finishRegister` 两腿构造（新用户注册仍走 OTP 链）。

### P1-15 AUTH:PERMISSIONS 缓存 TTL 放大 1000 倍 —— 秒级 setEx 收到「秒 × 1000」（文档大轮次 A 段）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/techniques/cache/service/cache.permissions.ts`
  （`setPermissions` 的 `ttl: atTtl * 1000`）。
- **现象**：`AppTechCacheService.set` 的 `ttl` 单位是**秒**（`cache.service.ts` 直接
  `redis.setEx(cacheKey, ttl, ...)`，日志 `TTL: Ns`；cap 的 P0-3 修复注释也明确
  「set 收秒」）。权限缓存却把 `getAccessTokenExpireSeconds()` 再乘 1000 —— AT 若 30 分钟，
  缓存实际驻留约 20.8 天。权限撤销/角色切换后，`permission.guard` 读到的旧权限串会长期
  不失效；只有重新拉 `GET /auth/permissions` 覆盖或 signout 删除才更新。
- **实测证据**：本次读码钉死；同族 `cache.sign.ts`、`cache.mfa.ts` 都直接传秒，唯
  permissions 多乘 1000。
- **建议**：去掉 `* 1000`（与 AT 同寿命或更短）；补一条 TTL 数量级断言，防回归。
- **修法（2026-10-28，批 A，决策见 roadmap §6）**：`cache.permissions.ts` 的
  `setPermissions` 改为 `ttl: atTtl`（秒直传，与 AT 同寿命）。测试：permission-chain
  spec 的 `GET /auth/permissions` 用例读 Redis 实际 TTL，断言落在 `jwt.access.expire`
  秒数量级（> atTtl-60 且 ≤ atTtl；修复前为 atTtl×1000）。

### P1-16 OTP 发送端点动态限流配置不生效 —— 元数据键 Symbol 与字符串错位（文档大轮次 A 段）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/otp/guard/otp.decorator.ts`
  （`SetMetadata(OTP_THROTTLE_SERVICE_KEY, ...)`，键是 `Symbol(...)`）+
  `apps/api/src/modules/auth/modules/otp/guard/otp-throttle.guard.ts`
  （`getAllAndOverride('OTP_THROTTLE_SERVICE', ...)`，字符串键）。
- **现象**：两处键永不相等，`TargetService` 恒 `undefined`，`OtpSettingService` 的
  `sendLimit` / `sendTtl` 从未被读取；OTP send 实际一直用全局 throttle 的 limit/ttl。
  该 guard 的 `handleRequest` 也不覆盖 `blockDuration`（与 P1-10 同型问题，只是在动态配置
  失效时一并不可见）。
- **实测证据**：本次读码钉死；`throttle.api-spec.ts` 只覆盖 `device/initial` 的
  `WalnutAdminGuardThrottler`，没有 OTP send 的限流用例。
- **建议**：抽一个共享 key 常量（或像 `WalnutAdminDecoratorThrottle` 一样导出 Symbol）；
  同步补 `blockDuration`；补 OTP send 压线用例。
- **修法（2026-10-28，批 A，决策见 roadmap §6）**：新增共享常量
  `guard/otp-throttle.const.ts` 的 `OTP_THROTTLE_SERVICE_KEY`（Symbol），decorator 写键与
  guard 读键同源（避开 decorator↔guard 循环 import）；`handleRequest` 解构
  `blockDuration` 并在动态 ttl 生效时同步覆盖。测试：otp.api-spec 以
  `sendLimit=2 / sendTtl=600` 连发三次 —— 前两次 20000、第三次 42900，`Retry-After ≥ 30`
  证明动态 ttl 进入 blockDuration（修复前元数据键错位、走全局 10s/120 配额）。

### P1-17 Google 登录每次自动新建用户 —— 邮箱复用分支被注释，且不落 user_identity（文档大轮次 A 段）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/google/google.service.ts`
  （`validateGoogle`）。
- **现象**：函数无条件调用
  `getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser({}, deviceId)` ——
  「按邮箱查既有用户」与「按邮箱自动注册」的分支整体被注释。任何通过本地 JWKS 校验的
  Google id_token 都会**新建一个 sys_user**（并每次发送欢迎邮件），既不查重也不写
  `user_identity` / `user_oauth`。同一 Google 账号重复登录得到不同 `userId`，数据与角色
  绑定无法延续；也意味着该 provider 可被用来无限造用户。
- **实测证据**：本次读码钉死；`external-oauth.api-spec.ts` 只覆盖错误路径（functional
  关闭、garbage credential 本地校验失败），未走成功登录。
- **建议**：恢复「email identity 查重 + user_oauth 绑定」逻辑（对齐 gitee/github 的
  `validateIdentity`），或在该 provider 未完成前显式关闭/下线。
- **修法（2026-10-28，批 B，决策见 roadmap §6）**：选**端点暂时关闭**。
  ①`@WalnutAdminDecoratorFunctionalGuard` 新增 `{ defaultClosed: true }` 选项（元数据
  `DEFAULT_CLOSED`）：settings 缓存/键缺失时不再缺省放行而抛 50301；Google 控制器挂上该
  选项。②`validateGoogle` 的建用户逻辑不动 —— 「同邮箱复用 + user_identity/user_oauth
  绑定」补全登记为后续功能开发（恢复前保持 50301）。③测试：external-oauth spec 首例
  「零配置 → 50301」，原「functional 关闭态」与「开启态 garbage → 40107」用例保留
  （显式 authEnable=1 才进入 JWKS 校验腿）。

### P1-18 `current_role_id` 与 `sys_user_role` junction 脱钩 —— SWITCH 用户可沿用已移出角色的权限（文档大轮次 B 段，新登记）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/user/user.basic.repository.ts`（`update` 的
  `replaceRoles` 只整组替换 junction）+ `apps/api/src/modules/system/user/services/user.crud.service.ts`
  （create 的 `roles: []` 仍把 `currentRole` 落 `defaultRole`）+
  `apps/api/src/modules/system/user/shared/user.shared.service.ts`（`checkUserAndRoleStatus`
  的 switch 分支：当前角色不在 `roles_list` 时只记日志继续）+
  `apps/api/src/modules/system/role/shared/role.shared.service.ts`（`getCoreMenus` 对
  SWITCH 直接取 `[user.currentRole]`）。
- **现象**：`sys_user_role` 与 `sys_user.current_role_id` 之间没有联合约束。管理端
  `PUT /system/user/:id` 用 `roles` 整组替换 junction 时，既不重置也不校验
  `current_role_id`；create 给 `roles: []` 时 junction 为空但 `current_role_id` 指向
  `defaultRole`（user.api-spec 文件头已钉现状）。登录时 `checkUserAndRoleStatus` 找不到
  当前角色只写日志；`getCoreMenus` 的 SWITCH 分支仍按这个 `currentRole` 直接查角色与菜单。
  结果是：用户被移出角色 A（junction 里只剩 B）后重新登录，AT 的 `currentRole` 仍是 A，
  权限链路继续按 A 取权限串 —— 只要 B 是启用角色，登录就会放行。
- **实测证据**：本次读码钉死；`user.api-spec.ts` 的 create 用例钉住「junction 空 +
  currentRole 走 defaultRole」；`permission-chain.api-spec.ts` 只覆盖 junction 与
  currentRole 一致的种子用户，未覆盖替换后的脱钩形态。
- **建议**：update roles 时校验 `current_role_id` 仍在新集合内（否则重置为 `roles[0]`），
  `getCoreMenus` 的 SWITCH 分支加 membership 判据；或补 `(current_role_id, user_id)`
  指向 junction 的约束（成本较高，至少先在写路径收敛）。
- **修法（2026-10-28，批 D）**：**根修已落地**（2026-10-28 复审回炉 F1）—— 权限计算不再
  信任 AT payload 自报，`SysRoleSharedService.getCoreMenus` 先按 AT `userId` 从
  `sys_user_role` 现查实际绑定，把 `roleIds` / `currentRole` 过滤到 membership 内：
  COMBINE 取交集，SWITCH 的 `currentRole` 不在绑定集 → 回退绑定集首角色（按 role_id 排序），
  绑定为空 → 空权限。因此旧 AT 重拉 `/auth/permissions` 不会复活被移除角色，恢复用户
  （junction 未恢复）后权限为空（login 由 `checkUserAndRoleStatus` 的 roles_list 空校验
  拒绝，opaque finish 链收敛为 40103 受控）；root/visitor 的 guard 短路读 payload，不受影响。
  写路径同步收敛：`SysUserBasicRepository.update` 在 roles 整组替换时校正
  `current_role_id`（不在新集合 → 新集合首角色；空集合 → null）；`SysUserCrudService.create`
  与 update 口径对齐 —— **显式 `roles: []` 得 junction 空 + currentRole=null**，只有 roles
  未给（undefined）才走 defaultRole 兜底。`SysUserCrudService.update` 在 roles 变更后经
  `runAfterCommit` 调 `AppTechCachePermissionsService.delPermissionsForUser`，按
  `AUTH:PERMISSIONS:<user>:*` 清该用户全部设备缓存。
  user.api-spec 翻转：create `roles: []` 的 currentRole 由 defaultRole 改为 null；update
  `roles: []` 后响应/DB 均 null；新增「移除 current 角色 → 重置为新集合首角色」。
  permission-chain spec 新增：admin 改 roles → DB current 校正 + 缓存键消失（未重拉即
  40105）+ 重登后权限串只剩新角色；**F1 两条**：「旧 AT 重拉不含被移除角色」「恢复用户后
  旧 AT 权限为空 + 重新登录 40104 受控」。

### P1-19 user create / update 的 junction 写入没有事务 —— 主行与角色绑定可半成功（文档大轮次 B 段，新登记）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/user/controllers/user.controller.ts`
  （create / update 均无 `@WalnutTx`）+ `apps/api/src/modules/system/user/user.basic.repository.ts`
  （`create` / `update` 先 `super.create` / `super.update` 写主行，再 `replaceRoles` 做
  delete + insert；em 缺省时走连接级 manager）+ `user.crud.service.ts`（service 不接 em）。
- **现象**：user 的 HTTP create / update 不是事务：主行 save、junction delete、junction
  insert 各自自动提交。create 时 junction 插入失败（如 roles 里含不存在角色的 uuid，
  FK 23503 → 受控 40000）会留下「主行已提交、无任何角色绑定」的脏用户，重试 create 又撞
  `uq_user_name`；update 时 insert 失败会留下 junction 已被 delete 清空的状态 ——
  `roles` 整组替换退化为「权限被清空 + 请求返回失败」，且并发登录可能读到中间态
  （`roles_list` 为空 → 40104 族）。对照：role 的 create/update 已挂 `@WalnutTx`，
  `SysUserRepositoryService.createUser`（自动注册路径）也自起事务，唯独管理端 user 写路径没有。
- **实测证据**：本次读码钉死；`api-rollback.api-spec.ts` 的 rollback 用例只覆盖 role
  create 的 FK 腿，user create 的 junction FK 腿未覆盖；user.api-spec 的 safe role 拦截
  在 service 层前置，走不到 FK。
- **建议**：user create / update 补 `@WalnutTx()` 并让 service 透传 `ctx.em`（与 role
  同款），让主行 + junction 同事务提交/回滚。
- **修法（2026-10-28，批 D）**：`SysUserController.create/update` 挂 `@WalnutTx()` 并注入
  `@WalnutTxSession() ctx`，`SysUserCrudService.create/update` 透传 `ctx.em`（与
  role.controller 同款）。主行 save、junction delete + insert、current_role 校正全部在
  同一事务；任何一腿失败（FK 23503 等）整体回滚 → 受控 40000。api-rollback spec 新增
  两条 HTTP 级用例：create 带不存在角色 → 40000 且 `sys_user` 零残留（无脏用户）；
  update 同时改 status + 带不存在角色 → 40000 且 status 未被半提交。

## P2 语义怪异

### P2-1 mfa.guard 强制所有已登录用户 mfaSetup=true，无开关（F 段发现 6）—— 【确认为安全立场设计 2026-10-28】

- **位置**：`apps/api/src/guard/mfa.guard.ts`（未 setup → 40114 拒）。settings 的
  `app.auth.mfa` 键**不控制**该 guard（只被 `user_mfa.shared` 的 methodsRequiredCount 消费）。
- **实测证据**：`guard-matrix.api-spec.ts` MFA 组。
- **建议**：如需灰度只能改 AT payload 的 mfaSetup 口径 —— 产品决策项。
- **裁决（2026-10-28，批 2）**：**确认为安全立场设计** —— 所有已登录用户强制
  `mfaSetup=true`，无灰度开关。理由：MFA 是登录后的第二因子强制项，灰度开关会让
  未绑定用户获得「无第二因子」的降级面；`app.auth.mfa.methodsRequiredCount` 只调节
  通道数，不取消强制。`backend/architecture.md` 的 Guard 链说明已同步写明。

### P2-2 device lock/ban 只写缓存不落库 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/device/device.service.ts`（lock/unlock/ban/unban）。
- **现象**：Redis 清空/过期即失效；且锁/封期间同设备后续请求被 Device guard 40606/40607
  拦死（连 unlock/unban 都到不了），端点间只能以缓存复位通道衔接。
- **实测证据**：C 段 device spec。
- **建议**：落库 + 缓存双写（或明确登记为「临时封禁」取舍并写入文档）。
- **修法（2026-10-28，批 2）**：`sys_device` 本就有 `locked` / `banned` 列（phase2 4.8），
  四端点改为 `@WalnutTx()` 事务内更新 DB 行 + `runAfterCommit` 写 `SYS_DEVICE` 缓存
  （DB 为真源，缓存 miss 可自愈）。`device.guard.ts` 缓存 miss 时回源
  `SysDeviceRepositoryService.findDeviceByDeviceId`：查无仍 40605，命中则回填缓存再走
  同一 banned/locked 判定 —— 清空 Redis 不再等价于「设备不存在」或放行。device spec
  断言翻转：lock/ban 后 DB 行翻转；清缓存后同设备请求仍 40606/40607 且缓存被回填。

### P2-3 history-users 恒空数组 —— 「只回 user 缺失行」语义反转 —— 【已修复 2026-10-28】

- **位置**：`device.service.getHistoryUsersByDeviceId` →
  `user_device.shared.getAllUsersByDeviceId`（PG 侧 populate 恒命中 → 缺失行恒无）。
- **实测证据**：C 段 device spec。
- **建议**：按 sys_user_device 绑定历史返回，或下线该端点。
- **数据事实（决定修法）**：`sys_user_device` **没有** removedAt / 解绑标记列；绑定是
  `ON CONFLICT (user_id, device_id) DO UPDATE` 幂等 upsert，全仓无 unbind/delete 通道
  （只有 user 被删时的 FK CASCADE）—— 表内现存行就是该设备的全部绑定历史，无需下线。
- **修法（2026-10-28，批 2）**：`getAllUsersByDeviceId` 的过滤从「user 缺失」翻转为
  「user 存在」，返回绑定行上的 `{id, userName, nickName, lastActiveAt}`（repo 已按
  lastActiveAt DESC 排序）。device spec 的「恒空数组」钉现状改为「登录绑定用户 +
  第二用户两条历史，顺序可判」。

### P2-4 monitor/cache read 出参恒 `{}` + delete fire-and-forget —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/app/monitor`（read 腿 `void await get`；delete 先响应后 DEL）。
- **实测证据**：`monitor.api-spec.ts` B 段（delete 靠轮询断言）。
- **建议**：read 补 await；delete 明确 fire-and-forget 语义并写入响应契约。
- **修法（2026-10-28，批 2）**：read 改为 `{ value: await cacheService.get(key) }`（真实值，
  缺失键 null）；delete 保留 fire-and-forget（`void del`，data 恒空）并在 controller 内
  写透「响应先于 DEL、客户端需以 read 复核」的契约（spec 的轮询钉现状保留）。

### P2-5 lang public 响应缓存无失效通道 —— 【已修复 2026-10-28】

- **位置**：`@WalnutAdminDecoratorCache` 的 lang public 端点（1h TTL）× lang CRUD 不主动失效
  （locale 有 runAfterCommit 全量刷新通道，lang 没有）。
- **实测证据**：A 段 lang spec。
- **建议**：lang CRUD 挂对齐 locale 的 after-commit 失效。
- **修法（2026-10-28，批 2）**：`SysLangService` 注入 `AppTechCacheService`，create/update
  成功后经 `runAfterCommit` 删除 `SYS_LANG_LIST_PUBLIC`（locale 的刷新通道同款钩子；无事务
  上下文的 CRUD 路径内联 await，保证响应返回前已失效）。lang spec 新增「CRUD 后 public
  立见新值」用例：create 后新 lang 出现、update status=false 后从 public 消失。

### P2-6 key init 的 JWT_AT 分支不可达 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/app/key/key.service.ts`（`generateNewKeyByType` 无 JWT_AT
  分支 → init JWT_AT 恒 20000 且不落行，二钻 40001 不可达）。
- **实测证据**：`key.api-spec.ts` B 段。
- **建议**：补 JWT_AT 生成分支，或 DTO 层拦 JWT_AT。
- **修法（2026-10-28，批 2）**：选 **DTO 层拦** —— `AppKeyDTOInit` 重声明 `type`，挂
  `@IsEnum + @IsNotEmpty + @Validate(AppKeyInitTypeNotSystemManagedConstraint)`，JWT_AT
  直接校验失败（40000 族受控 40099，不再假成功 20000）。JWT_AT 由系统启动自举，不走
  HTTP init。key spec 的「init JWT_AT 恒 20000 且不落行」钉现状翻转：40099 + 行数不变。

### P2-7 error controller ErrorMap 的 40112-40117 异常类与 contract 错误码错位 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/app/error`（ErrorMap，如 40112 挂 CapInteractionRequired，
  真实码 40116）。
- **实测证据**：`error.api-spec.ts` B 段（选了无错位的 40000/40103/40300/50000 断言绕开）。
- **建议**：对齐映射（注意牵动 guard 真实错误码 40116/40117 的语义归属）。
- **修法（2026-10-28，批 2）**：以 contract response-code 与各 guard 实际抛码为准逐个对齐
  40112-40117：40112 InvalidSignature / 40113 ExpiredSignature / 40114 MfaRequired /
  40115 MfaVerifyFailed / 40116 CapInteractionRequired / 40117 CapRefreshRequired。
  error spec 从「4 个代表码」改为 **ErrorMap 全项**断言（46 个 code 逐一 `body.code === code`）。

### P2-8 dictType HTTP delete 的 data 腿由 DB CASCADE 静默清掉且不产生软删快照 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/dict/dictType`（delete = 快照 + 原行硬删；data 腿
  `fk_dict_data_type` CASCADE，无 data 快照）。
- **实测证据**：C 段 dict spec。
- **建议**：级联软删（data 也进回收站），或登记「字典数据不进回收站」为明确取舍。
- **修法（2026-10-28，批 2）**：`SysDictTypeService.delete` 在同一 em 事务内先
  `dictDataBasicRepo.deleteSoftManyByCondition({ typeId }, userId, em)`（逐行落
  `SYS_DICT_DATA` 快照并删原行），再快照 + 硬删 type 行 —— DB CASCADE 已无行可清。
  dict spec 的「CASCADE 硬删不产生任何 data 快照」钉现状翻转为「3 条快照（type 1 + data 2）
  且先恢复 type、再恢复 data 后可读」。

### P2-9 零配置部署下 COMBINE 用户的「多角色合并」实际不生效（I 段实测，新收编）—— 【已修复 2026-10-28】

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
- **修法（2026-10-28，批 2）**：**已修复：默认改 combinable** —— `defaultFunctionalRole`
  的 `globalValue` 由 `SWITCH` 改为 `COMBINE`，零配置部署下权限合并用户全部角色（用户
  `role_mode` 不再被无视）；scope 语义不变（GLOBAL 恒 globalValue，LOCAL 仍读用户
  roleMode）。seed-pg/ETL 不落该行（默认即所需；仓内 `db/seed/app_setting.json` 的显式
  switchable 行是 demo 数据的显式配置，不属零配置路径）。admin 侧无改动（合并发生在
  服务端）。permission-chain spec 新增默认腿断言（GLOBAL 下 COMBINE 用户合并双角色），
  LOCAL scope 对照用例保持不变。

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

### P2-11 签名 nonce 去重非原子（GET 后 SET）（文档大轮次 A 段，新登记）

- **位置**：`apps/api/src/guard/sign.guard.ts`（`validateAndRecordNonce`）+
  `apps/api/src/modules/techniques/cache/service/cache.sign.ts`（`setNonceCache` 普通 SET）。
- **现象**：先 `getNonceCache` 判空、再 `setNonceCache`，不是 `SET NX EX`。两个携带相同
  `timestamp + nonce + body` 的并发请求可同时通过「未使用」检查并各自写入，nonce 的
  一次性语义只在串行到达时成立。源码注释本身已写「建议使用 Redis NX 操作保证原子性」。
- **实测证据**：本次读码钉死；`guard-matrix.api-spec.ts` 的 nonce 重放用例是顺序第二次
  请求（40112），不覆盖并发。
- **建议**：`set` 改为 SET NX EX 并以写入结果判重（或 Lua 原子脚本）；失败仍映射 40112。

### P2-12 踢下线只撤 RT，不清会话/权限/MFA 缓存 —— AT 到期前仍可用 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/signout/signout.service.ts`
  （`handleUserKickOther` / `handleAdminKick`，对照 `handleUserLogout` 的
  `clearDeviceCache`）。
- **现象**：`user-kick-other` 与 `admin-kick` 只 `revokeRTForUserDevice` + 在线设备
  socket 通知，**不清** `AUTH:SESSIONS` / `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED`。
  P0-4 之后 JWT 层的会话键校验仍能通过，因此被踢设备的 AT 在到期前继续可用；离线设备的
  设计口径是「下次打开页面由前端 socket 初始化触发 signout」，服务端没有强撤。
- **实测证据**：本次读码钉死；user-device / monitor force-quit 用例只断言 RT 行
  `revoked=true`，未断言 AT 失效。
- **建议**：踢人时按设备清三键（sessionId 可用 `AUTH:SESSIONS:<user>:<device>:*` pattern），
  或给 AT 增加会话版本/黑名单；若维持现状，应在文档与前端契约里写明「AT 有效期内不保证
  立即失效」。
- **修法（2026-10-28，批 C）**：`signout.service` 的 `handleUserKickOther` /
  `handleAdminKick` 在 RT 撤销 + socket 通知之后挂 `runAfterCommit`，按设备清三键
  （新私有方法 `clearKickedDeviceCache`，与 signout 的 `clearDeviceCache` 同款口径）：
  `AUTH:SESSIONS:<user>:<device>:*`（`revokeSession(userId, deviceId)`）、
  `AUTH:PERMISSIONS:<user>:<device>`、`AUTH:MFA:VERIFIED:<user>:<device>`。
  配合 P0-4 的 JWT validate 会话键校验，被踢设备的旧 AT **立即** 40101。
  user-device / monitor-user 的 force-quit 用例改为第二设备真实验证（旧 AT 40101 +
  三键全清），此前只断言 RT `revoked=true`。

### P2-13 OAuth state 未签名 + SSE 按客户端自报 fingerprint 投递 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/auth/modules/oauth/gitee/gitee.controller.ts` 与
  `.../github/github.controller.ts`（`getOAuthURL` / `sse`）。
- **现象**：`state` 是 `JSON.stringify({ fp, lang })` 原文拼进授权 URL，无服务端签名、
  无一次性存储、不绑定发起会话；`GET .../sse/:fp` 允许任何持有设备 cookie 的客户端订阅
  任意 `fp` 频道，回调成功后 `accessToken/sessionKey` 就发到该频道。可构造登录 CSRF
  （攻击者取自己的授权 URL 诱导受害者完成 IdP 登录，令牌投递到攻击者订阅的频道）。
  令牌与受害者 `deviceId` 绑定，跨设备直接使用受限，但「把受害者登入攻击者账号」成立。
- **实测证据**：本次读码钉死；`external-oauth.api-spec.ts` 只覆盖 URL 拼装形态与缺 code。
- **建议**：`state` 改为服务端签发的一次性 nonce（Redis 关联 device/session），SSE 频道
  绑定发起时的设备；回调校验 state 后再投递。
- **修法（2026-10-28，批 C）**：新增公共 `OAuthStateService`（`oauth/shared/`，gitee/github
  对称消费）。`/url` 签发 `state = base64url(JSON{fp,lang,nonce}) + "." + HMAC-SHA256`
  （签名密钥复用既有 `app.session.secret` 通道），nonce + 发起请求的 **deviceId** 落 Redis
  `AUTH:OAUTH_STATE:<nonce>`（10 分钟 TTL）。callback 的 guard 在换 code **之前**验签
  （时序安全比较）→ 校验 deviceId 绑定 → `DEL` 计数 = 1 才消费（并发重放只有一个赢家），
  任何失败走既有受控 40000（不进入外部 token 交换，302/Render 流程不动）。跨设备 state
  （登录 CSRF 的攻击形态）因 deviceId 不匹配直接被拒。external-oauth spec 覆盖：state 形态
  翻转（不再是明文 JSON）、篡改 / 重放 / 跨设备受控拒、service 层合法签发-消费闭环。
  SSE 频道本身的订阅面未收紧（P2-13 建议的第二半），本轮以 state 的设备绑定堵住 CSRF 主路径。

### P2-14 并发 login/finish 的 Duplicate Auth 判据是「读后写」

- **位置**：`apps/api/src/modules/auth/modules/refresh/shared/refresh.shared.service.ts`
  （`generateRefreshToken` / `isCurrentUserInThisDeviceHasSignIn`）+
  `refresh.repo.service.ts`（`findActiveByDeviceIdAndUserId`）。
- **现象**：登录时先查「同 (user, device) 是否已有未撤销 RT 行」，无行则取最新历史行复签
  同一 jti。两个并发 `login/finish` 都能通过判据：各自创建 `sid`/sessionKey，各自把
  `encrypted_token` 写进同一行，后写覆盖前写 —— 两个响应都 20000，但只有后写者的
  sessionKey 与 RT 行匹配，另一客户端下次 refresh 后双因子签名失配（40112）。
  表上无 `(user_id, device_id) WHERE revoked = false` 唯一索引兜底。
- **实测证据**：本次读码钉死；`concurrency.api-spec.ts` G2 覆盖的是同名注册竞态，不是
  同 user+device 重复登录。
- **建议**：登录事务内加 `(user, device)` 维度的锁/`FOR UPDATE`，或加部分唯一索引让并发
  败者受控（40109）。

### P2-15 永久 IP 黑名单写腿在零配置下静默 no-op —— 依赖 `app.global.ipBlackList` 行预先存在 —— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/shared/ip/ip.service.ts`（`addToPermanentBlackList`）→
  `apps/api/src/modules/app/setting/repo/setting.repo.service.ts`
  （`updateAppSettingByKey`：`findOne` 查无行时直接跳过 save）。
- **现象**：黑名单路径命中时（`BlacklistPathMiddleware` / `security.guard`）会调用
  `addToPermanentBlackList(realIp)`；但该写腿先 `findAppSettingByKey`，无行则拼出 `[ip]`
  再交给 `updateAppSettingByKey` —— 后者对不存在的 key **静默不写**。只跑 migration、
  未 seed `app.global.ipBlackList` 的部署（零配置）因此永远不会真正积累永久黑名单，
  扫描器每次只拿到 40610，IP 不被记住。读取腿 `getPermanentBlackList` 对缺失键走
  JSON.parse 异常兜底 `[]`，不报错，问题完全静默。
- **实测证据**：本次读码钉死；guard-matrix 的永久黑名单用例通过直接改造 `APP:SETTING`
  缓存构造，未覆盖「无 setting 行」的自愈路径。
- **建议**：`addToPermanentBlackList` 在行缺失时走 insert（或首次写入前 seed 该键）；
  顺带把读改写放进事务/锁，避免并发拉黑丢更新。
- **修法（2026-10-28，批 C）**：按 roadmap §6 拍板走 **seed 显式默认行**。核对结论：
  `apps/server/db/seed/app_setting.json` 已含 `app.global.ipBlackList`（`settingValue: "[]"`，
  `$oid`/`$date` Extended JSON 形态，与既有条目同款），`db:seed:pg` 的映射会将其写入
  `setting_value` text 列 —— 写腿锚点在 seed 通道已落实，`addToPermanentBlackList` 不改。
  为防止未来再导出/裁剪时该行被静默丢掉，`packages/tooling/scripts/src/ci/check-seed.ts`
  新增机械判据 `REQUIRED_APP_SETTING_KEYS`（key 必须存在 + settingValue 可解析为 JSON
  字符串数组），反例用例覆盖缺行 / 非法 JSON / 非数组三种形态。集成库 globalSetup 仍只跑
  migrations、不 seed —— guard-matrix 的永久黑名单用例继续用 settings 缓存注入，不需要改。

### P2-16 角色 / 菜单 / 用户切换都不失效 AUTH:PERMISSIONS —— 权限撤销没有服务端通道（B 段，新登记）—— 【已修复 2026-10-28】

- **位置**：`apps/api/src/modules/system/menu/menu.service.ts`（create / update / delete
  三处 `TODO remove all cache auth data when menu changed`）+
  `apps/api/src/modules/system/role/role.service.ts`（menus 整组替换后无失效）+
  `apps/api/src/modules/system/user/shared/user.shared.service.ts`（`switchRole` /
  `switchRoleMode` 只写库）。
- **现象**：`AUTH:PERMISSIONS` 的唯一写入口是 `GET /auth/permissions`，唯一主动删除点是
  signout 的 `clearDeviceCache`（P2-12 已登记踢人不清）。角色授权整组替换、菜单
  `meta.permission` 改动或删除、角色停用、用户切换角色/角色模式都不清除或重算缓存；
  `permission.guard` 只读缓存且无懒重建。叠加 P1-15 的 TTL 放大，权限撤销在缓存层面
  可驻留约 1000 倍 AT 时长。缓存键按 `(userId, deviceId)` 分布，服务端当前没有
  「按角色反查用户 → 批量清键」的通道。
- **实测证据**：本次读码钉死；`menu.service.ts` 三处 TODO 注释；
  `grep delPermissions` 只有 signout 一处消费（`menu.shared.service` 自身除外）。
- **建议**：角色 / 菜单写路径的 after-commit 里按 `sys_user_role` / `sys_role_menu`
  反查受影响的 userId，批量删除其 `AUTH:PERMISSIONS:*`（或落一个「权限版本号」进 AT）；
  `me/role/switch` 与 `me/roleMode/switch` 至少清本设备键。
- **修法（2026-10-28，批 D）**：两条失效通道。
  ①**角色维度**（反查用户）：`SysRoleService.update` 在 `menus` 整组替换或 `status` 翻转时，
  先按 `sys_user_role` 反查该角色全部 userId（`SysRoleRepoService.findUserIdsByRoleId`），
  after-commit 逐个 `delPermissionsForUser`（清该用户全部设备的 `AUTH:PERMISSIONS:<user>:*`）。
  ②**菜单维度**（全量清）：`menu.service` 的 create / update / delete 统一
  `runAfterCommit → SysMenuSharedService.clearAllPermissionsCache`（`AUTH:PERMISSIONS:*`
  前缀全删）。取舍写明：菜单 permission 变更影响所有「角色 → 菜单」链条用户，按 menu 反查
  不现实；权限缓存是客户端可重拉 `/auth/permissions` 重建的派生数据，全清代价可接受。
  `me/role/switch` 与 `me/roleMode/switch` 本轮不动 —— AT payload 的 roleIds/currentRole
  在登录时固化，仅清缓存会让用户在重登前持续 40105（现有契约就是「切换后需重新登录」），
  等前端契约与 AT 版本化方案落地再一并处理。测试：permission-chain 新增「改角色 menus →
  缓存键立即消失、守卫 40105、重拉反映新授权」；menu spec 用哨兵键断言菜单 update 清全量前缀。

### P2-17 lang 与 locale 的缓存刷新不对称 —— 新语言写翻译被白名单缓存挡下（B 段，新登记）

- **位置**：`apps/api/src/modules/system/lang/lang.service.ts`
  （`triggerPublicListCacheRefresh` 只删 `SYS_LANG_LIST_PUBLIC`）+
  `apps/api/src/modules/system/locale/shared/locale.shared.service.ts`
  （`SYS_LANG_ID_LIST` 只在 `extractLocaleMessagesIntoCacheForCronJob` 写）+
  `apps/api/src/modules/system/locale/locale.validate.ts`。
- **现象**：`SYS_LANG_ID_LIST` 是 locale 入参的白名单缓存，只有 locale 的
  create/update/delete/deleteMany 触发的全量刷新会写它。`POST /system/lang` 新建语言后
  该列表仍是旧的：紧接着给新 langId 写翻译，`LocaleLangIdValidate` 命中旧缓存 →
  `Invalid of langId`（40099），直到某次不依赖新 langId 的 locale 变更/删除触发刷新
  （缓存键完全缺失时校验反而放行）。`PUT /system/lang/:id` 改 `lang` 代号也不会重算
  `SYS_LOCALE_MESSAGES`：旧代号的消息缓存继续存在、新代号要等 locale 变更后才进缓存。
- **实测证据**：本次读码钉死；A 段 locale API spec 只覆盖「已有 langId + 已有缓存」的
  批量创建/缓存语义，未覆盖新建 lang 后的首次翻译。
- **建议**：lang create/update 也调 `extractLangIdsIntoCache`（或直接复用
  `extractLocaleMessagesIntoCacheForCronJob`），与 locale 的 after-commit 通道对齐。

### P2-18 软删恢复不恢复 junction —— 恢复菜单丢全部角色授权、恢复用户无法登录（B 段，新登记）—— 【已修复 2026-10-28（用户外围联动；junction 部分维持登记）】

- **位置**：`apps/api/src/common/repository/pg-base.repository.ts`（`deleteSoftById`：
  只快照主行，随后硬删原行）+ `apps/api/src/modules/system/deleted/deleted.service.ts`
  （`recoverSnapshot` 只按快照插回主行）+ phase2 §4.1 / §4.2 的 junction FK CASCADE。
- **现象**：`sys_user_role` / `sys_role_menu` 没有独立软删通道，主行硬删时由 FK CASCADE
  静默清空，且 junction 不在 `sys_deleted.content` 里。从回收站恢复菜单后，所有角色对该
  菜单的授权为空；恢复用户后 `roles_list` 为空，`checkUserAndRoleStatus` 直接
  40104 族拒绝登录。恢复动作本身成功（20000），不提示授权丢失。
- **实测证据**：本次读码 + phase2 DDL 钉死；`deleted.api-spec.ts` 只用 `app/demo` 行
  覆盖恢复三态，没有 user/menu 的 junction 面。
- **建议**：把 junction 纳入快照/恢复注册器（先恢复主行再重放 junction），或在恢复端点
  显式返回「关联授权未恢复」并把该行为登记为取舍。
- **修法（2026-10-28，批 D）**：按 roadmap §6 的裁定修**用户侧外围**（identity /
  preference / device / mfa / lock），junction 部分维持登记。
  ①删除侧：`SysUserBasicRepository.deleteSoftById` 在主行快照/硬删之前，先给五张外围表逐行
  落 `sys_deleted` 快照（identity 的 `value`、mfa 的四个密文列是 `select: false`，用
  addSelect 显式带出，否则恢复后凭据不可用）；同一 em 事务，回滚不留快照。
  ②恢复侧：`sys_user` 从通用恢复器改为组合恢复器（`deleted/repo/user.recoverer.ts`）：
  插回主行 → 按 `content->>'userId'` 找回外围快照（同 deletedId 只取最新）逐行重放并删快照；
  identity/preference 失败整体回滚，device/mfa/lock 失败用 savepoint 跳过（外部行可能已
  单独清理），不阻断用户本体恢复。恢复注册清单仍含 SYS_USER（漂移守卫对账不变）。
  ③测试：deleted spec 新增「造 user + password identity + preference → 删用户（多份快照）→
  recover user → 主行/外围行联动恢复、identity 密文完整、外围快照已消费」。
  ④F2（同批复审）：回收站 read / deleteMany 的响应会带 `content`（list 已 omit），
  快照里的 identity `value` / MFA 四列密文在 **DTO 层**遮蔽为 `***`
  （`maskDeletedSnapshotContent`，恢复走实体读取 jsonb，不受影响）；deleted spec 断言
  read 出参密文已遮蔽、非密文字段原样、恢复后 DB 密文完整。
  ⑤**取舍说明**：部分恢复（外围快照缺失或 device 腿 savepoint 跳过）不改失败语义 ——
  缺 MFA 行的用户由 `mfa.guard` fail-closed 拦住（无安全降级）；可用性缺口 = 需重新绑定
  MFA / 重新分配角色。
  ⑥**仍登记**：`sys_user_role` junction 与 `sys_role_menu` junction 不进快照 —— 恢复用户
  后 roles_list 仍为空（需管理员重新分配角色），恢复菜单后角色授权仍需重挂。这是「junction
  无独立软删通道」的结构性取舍，与 P2-22（账户外围，已随本修基本覆盖，oauth 绑定仍不恢复）/
  P2-23（locale 级联）同族，留待 junction 快照方案统一处理。

### P2-19 effective roleMode 只作用于权限计算 —— 零配置下 switchRole 对所有用户恒 40000（B 段，新登记）

- **位置**：`apps/api/src/modules/techniques/cache/service/cache.appSettings.ts`
  （P2-9 后 `defaultFunctionalRole` = GLOBAL/combinable）+
  `apps/api/src/modules/system/user/shared/user.shared.service.ts`（`switchRole` 用
  effectiveRoleMode 判 COMBINE）+ `apps/api/src/modules/shared/token/token.service.ts`
  （AT payload 的 `roleMode` 取用户行）+ `apps/api/src/guard/permission.guard.ts`
  （root/visitor 短路按 payload 的行值）。
- **现象**：零配置部署的 effective roleMode 恒为 combinable，`switchRole` 因此对**所有**
  用户返回 40000，即使其 `sys_user.role_mode` 仍是 `switchable`；而前端角色切换入口、
  权限守卫的 root/visitor 判据都按行值工作（AT payload 里也是行值）。
  `roleMode/switch` 改行值也不会改变 effective —— 用户可把行切成 switchable 后依旧
  无法切换角色。`user.api-spec.ts` 的「切到 switchable 后不在 junction 的角色拒」用例
  拿到的 40000 实际来自 effective=COMBINE，而非 membership 判据，掩盖了这层差异。
- **实测证据**：本次读码 + `user.api-spec.ts` L180-197；`permission-chain.api-spec.ts`
  的 LOCAL scope 对照用例证明 effective 只在显式配 LOCAL 后才跟随行值。
- **建议**：明确产品口径 —— 要么 `switchRole` 也按行值判（与 payload/守卫一致），要么
  前端在 effective=GLOBAL/combinable 时隐藏角色切换并登记「零配置不支持切换」；
  补一条零配置下 switchable 用户 switchRole 的用例。

### P2-20 菜单树与字典批量读端点没有权限点 —— 任何登录用户可读全量目录（B 段，新登记）

- **位置**：`apps/api/src/modules/system/menu/menu.controller.ts` 的 `@Get('tree')`
  （只有 `@ApiWalnutOkResponse`，无 `@HasPermission`）+
  `apps/api/src/modules/system/dict/dictType/dictType.controller.ts` 的 `@Get('s')`。
- **现象**：两个 GET 只走默认全局守卫链，不触发方法级权限守卫：任何已登录用户
  （包括 switchable 的 visitor）都能读到全量菜单树（含隐藏菜单与 `status=false` 的行，
  `tree` 用的是 `findAllMenus`）以及全部启用字典数据。`ENDPOINTS.md` §5 把 menu 行登记在
  `system:menu:*`、dict 行登记在 `system:dictType:*` 之下，与代码不符；字典 `s` 被前端
  公共消费可能是刻意豁免，但没有 Free / 豁免登记。
- **实测证据**：本次读码钉死；`permission-chain.api-spec.ts` 只覆盖 `app/demo` 的
  权限点拒绝面，未覆盖这两个端点。
- **建议**：`menu/tree` 挂 `system:menu:list`（或 read）；dict `s` 若确为登录用户的公共
  字典通道，显式写进契约（或加 `@HasPermission` 的 OR 白名单），不要靠「没挂装饰器」实现。

### P2-21 device 锁/封的读改写与 guard 回填竞态 —— 状态位可丢更新、缓存可被旧快照覆盖（C 段，新登记）

- **位置**：`apps/api/src/modules/system/device/device.service.ts`（`updateLockOrBanStatus`）+
  `device/repo/device.repo.service.ts`（`findDeviceByDeviceIdAndUpdate`：`findOne` →
  `Object.assign` → `save`）+ `guard/device.guard.ts`（缓存 miss 回源分支）。
- **现象**：两个层面。
  1. 状态位更新是 read-modify-write，没有行锁也不是原子 `UPDATE`；并发 `lock` 与 `ban`
     各自读到旧行再整行 `save`，后写者会覆盖前者的状态位（丢更新）。
  2. guard 缓存 miss 时读到 `dbDevice` 后先 `setSysDeviceCache(dbDevice)` 再判定；若同一
     窗口内管理端 PATCH 提交并 after-commit 写入新缓存，guard 的旧快照会把新缓存覆盖回去。
     `SYS_DEVICE` 缓存没有 TTL（`setSysDeviceCache` 不传 ttl），DB 的 `locked/banned` 会被
     长期遮蔽，直到下一次缓存 miss 才回源。
- **实测证据**：本次读码钉死；C 段 `device.api-spec.ts` 只覆盖顺序 lock/ban 与「清缓存后
  guard 回源」，不覆盖两个写请求/「回填与双写」交错。
- **建议**：状态位改原子 `UPDATE ... SET locked/banned = ... RETURNING *`（或事务内
  `FOR UPDATE`）；guard 回填前重新读库或用版本列比较，缓存加 TTL 作为兜底。

### P2-22 恢复用户不恢复账户外围 —— identity / oauth / device / lock / mfa / preference 全丢（C 段，新登记）

- **位置**：`apps/api/src/common/repository/pg-base.repository.ts`（`deleteSoftById` 只快照
  主行）+ `apps/api/src/modules/system/deleted/deleted.service.ts`（`recoverSnapshot` 只插
  主行）+ phase2 §4.9 ~ §4.14 的 `FK user_id CASCADE`。
- **现象**：删除用户时 `sys_user_identity` / `sys_user_oauth` / `sys_user_device` /
  `sys_user_lock` / `sys_user_mfa` / `sys_user_preference` 由 FK CASCADE 硬删且不进
  `sys_deleted`。恢复用户只插回 `sys_user` 主行：没有 password/OTP 身份（无法登录）、
  没有 MFA 凭据（`mfaSetup` 与运行时判据脱钩）、没有偏好行。恢复端点返回成功，不提示
  外围丢失。这是 P2-18（junction 不恢复）在账户侧的同族问题。
- **实测证据**：本次读码 + phase2 DDL 钉死；`deleted.api-spec.ts` 只用 `app/demo` 行
  覆盖恢复三态，没有 user 的外围面。
- **建议**：恢复用户时在同一事务内把六张外围表按 `user_id` 纳入快照/重放，或在恢复端点
  显式返回「外围数据未恢复」并把该行为登记为取舍。
- **修法进度（2026-10-28，批 D）**：用户删除/恢复链路已随 P2-18 修法覆盖
  identity / preference / device / lock / mfa 五张表（删除前快照 + 恢复时按 userId 重放）；
  **`sys_user_oauth` 绑定仍未纳入**（OAuth 绑定在恢复后需重新授权）—— 本条目保留登记，
  仅剩 oauth 一面。

### P2-23 恢复不联动级联软删的 locale 行 —— menu `_cascade=1` / dictData 删除后的翻译不回来（C 段，新登记）

- **位置**：`apps/api/src/modules/system/menu/menu.service.ts`（删除时按 `title` 软删 locale）+
  `apps/api/src/modules/system/dict/dictData/dictData.service.ts`（按 `label` 软删 locale）+
  `deleted.service.ts`（`recoverSnapshot` 只插主行）。
- **现象**：menu 删除带 `_cascade=1`、dictData 单删/批量删都会把对应 locale 翻译行软删进
  `sys_deleted`（各自快照 `SYS_LOCALE`），但恢复 menu / dictData 时只插回主行，翻译行仍留在
  回收站。前端随后按 key 取不到翻译，显示原始 key。两种级联的「正向」都有测试断言，
  「反向恢复」没有。
- **实测证据**：本次读码；`menu.api-spec.ts` 与 `dict.api-spec.ts` 只断言删除时的级联软删
  与快照存在，未覆盖恢复后的翻译面。
- **建议**：恢复主行时按同一 key 反查回收站并一并恢复 locale 行（同事务），或在恢复响应里
  返回级联副作用清单。

### P2-24 MFA 就绪判据两套 —— cron 按行数跨设备计数，运行时按类型 + 当前设备（C 段，新登记）

- **位置**：`apps/api/src/modules/system/user_mfa/shared/user_mfa.shared.service.ts`
  （`getCurrentUserMfaSetupStatus` 的 webauthn 腿按 `(userId, deviceId)`；`getIsCurrentUserMfaVerified`
  用 `enabledCount >= methodsRequiredCount`）+
  `updateMfaSetupStatusForCronJob`（`aggregateMfaStats` 按 `(userId, type)` 统计**全部设备**的
  启用行数）+ `apps/api/src/modules/auth/modules/mfa/mfa.service.ts`。
- **现象**：`methodsRequiredCount=2` 时，用户在设备 A、B 各注册一个 webauthn，cron 的
  `deviceCount=2` 会把 `sys_user.mfa_setup` 置 true；但在设备 A 调 `/auth/mfa/verify` 时
  `getCurrentUserMfaSetupStatus` 只看到 A 的 webauthn（totp 未启用）→ `enabledCount=1` →
  `verified=false` → 40000。反向地，`PUT totp/status=false` 后 cron 未跑之前
  `sys_user.mfa_setup` 仍是 true，mfa.guard 继续要求 MFA。两套判据在跨设备/停用时给出
  不一致结论。
- **实测证据**：本次读码；C 段 `user-mfa.api-spec.ts` 用单设备 totp 闭环，未覆盖多设备
  webauthn 与停用后的窗口。
- **建议**：统一判据维度（cron 也按 `userId + deviceId` 重算，或运行时改成按用户维度只看
  类型集合），并补多设备与停用窗口的用例。

### P2-25 identity 敏感操作面不一致 —— `update` 可绕过 status 的敏感守卫，`unbind` 无校验（C 段，新登记）

- **位置**：`apps/api/src/modules/system/user_identity/user_identity.controller.ts`
  （只有 `PUT status/:type/:purpose` 挂 `@WalnutAdminGuardRequireSensitive`；
  `PUT update/:type/:purpose` 与 `DELETE unbind/:type/:purpose` 没有）+
  `user_identity.service.ts`（`update` 的 `status` 直接落库；`assertCanUnbind` 把 `password`
  排除在「至少保留一种登录方式」检查之外）。
- **现象**：
  1. `PUT update` 的 DTO 含 `status`，可绕过敏感操作直接关闭登录/安全身份（status 端点
     要求 `account_critical` 验证）。
  2. `unbind` 没有任何敏感校验；`type='password'` 时跳过 keep-one 检查，只有 password 一种
     登录方式的用户可以解绑 password，导致账号无任何可用登录方式。
- **实测证据**：本次读码；`user-identity.api-spec.ts` 覆盖 status 端点与 unbind 的
  「有 password 兜底可解」，未覆盖绕过路径与仅密码用户。
- **建议**：`update` 禁止携带 `status`（或同挂敏感守卫）；`unbind` 挂敏感守卫并把
  password 纳入 keep-one 判据。

### P2-26 锁屏 security 模式无写入通道 —— `lockPwdHash` / `lockMode` 不可设置，unlock 缺省即跳过密码校验（C 段，新登记）

- **位置**：`apps/api/src/modules/system/user_lock/dto/user_lock.dto.ts`
  （`SysUserLockDoLockDto` 只 pick `lockRoute`）+ `user_lock.service.ts`（`lock` 只传
  `lockRoute`）+ `shared/user_lock.shared.service.ts`（`unLockUserDevice` 仅当 `lockPwdHash`
  非空才 `compareLockPwdHash`）。
- **现象**：仓库写入路径 `insertOrUpdateUserLockPre` 支持 bcrypt hash，但 HTTP 没有任何端点
  写入 `lockPwdHash` / `lockMode` / `lockSecuritySec`；同时 unlock 的 `lockPwdHash` 是可选，
  缺省直接跳过比对。因此 `lockMode=security` 无法通过 API 进入，锁屏密码校验实际不可达。
- **实测证据**：本次读码；`user-lock.api-spec.ts` 覆盖 lock/unlock 与两套默认值，没有
  security 模式用例（因为无法构造）。
- **建议**：补锁屏偏好更新端点（挂敏感守卫）并让 security 模式强制带密码；或把该模式从
  DTO/枚举/read 响应中移除并登记为未实现。

### P2-27 appSettings 进程内 memo 的失效覆盖面 —— 多实例与外部删键都失效不到（C 段，新登记）

- **位置**：`apps/api/src/modules/techniques/cache/service/cache.appSettings.ts`
  （`appSettingsMemo` / `settingMemo`）。
- **现象**：memo 只在本地 `setAppSettings` 时清空；多实例部署下其他实例写 setting 不会失效
  本进程 memo，本进程最长要等到下一次本地写才回正。绕过服务直删 Redis 键（非监控台删缓存
  端点）也不会失效；代码注释自述当前依赖单实例部署，但该边界没有进 DESIGN-ISSUES。
- **实测证据**：本次读码 + 源码注释；无多实例环境可实测。
- **建议**：扩多实例前补 Redis pub/sub 或 keyspace 通知失效；短期给 memo 加短 TTL 并在
  部署文档写明单实例前提。

### P2-28 定时任务没有分布式锁，且启动期同步跑全量任务（C 段，新登记）

- **位置**：`apps/api/src/modules/techniques/task/task.service.ts`（六个 `@Cron`）+
  `task.module.ts`（`onModuleInit` 依次调用六个任务）+
  `apps/api/src/modules/auth/modules/refresh/repo/refresh.pg.purge.service.ts`（每小时 purge）。
- **现象**：`@Cron` 是进程内的，没有分布式锁或执行标记；多实例部署时每个实例都会各跑一遍
  全量配置/语言重算、RT 标记、key 轮换、设备清理与 MFA 重算。每次启动 `onModuleInit` 还会
  同步执行一遍（含 `rotateAppKey` 与设备清理），启动耗时与副作用随数据量增长。
  幂等性依赖各任务自身的 upsert/条件判断；`updateDeviceActiveStatusForCronJob` 在 dev 下
  直接返回全零，开发环境不会执行设备清理。
- **实测证据**：本次读码；无多实例环境可实测。
- **建议**：引入 Redis 分布式锁（`murlock` 或 `SET NX` + 过期）或 job 注册表；启动期只保留
  settings/locale 预热，把 rotate / 清理挪出同步执行路径。

### P2-29 `logOperateId` 回填是异步旁路 —— 可能早于事务提交，且按 `deletedId` 覆盖历史快照（C 段，新登记）

- **位置**：`apps/api/src/decorators/walnut/log.operate.decorator.ts`（DELETE / DELETE_MANY
  成功后 `eventEmitter.emit`）+ `apps/api/src/modules/techniques/event/event.service.ts`
  （`@OnEvent(..., { async: true })`）+ `deleted/repo/deleted.repo.pg.service.ts`
  （`updateDeletedWithLogOperateId` 按 `deletedId` 更新）。
- **现象**：
  1. 事件在日志行插入后立即发出，但业务事务（`@WalnutTx`）的提交时机不保证更早；监听器
     用连接级 manager 更新 `sys_deleted`，早到时 `affected=0`，只记一条日志，关联永久丢失。
  2. 更新条件是 `{ deletedId }`，同一行被软删多次（恢复后再删）时，所有历史快照的
     `log_operate_id` 都会被最新日志覆盖，旧快照的操作日志关联被改写。
- **实测证据**：本次读码；D 段 `log-operate.api-spec.ts` 只断言日志行与快照两腿，
  没有断言 `sys_deleted.log_operate_id` 的回填。
- **建议**：在 after-commit 钩子里发事件（或把本次快照的 `sys_deleted.id` 带进事件、
  按主键更新），失败时重试并记录。

### P2-30 key 轮转没有重叠窗口 —— 旧公钥密文在 rotate 后不可解，且 current 不校验 validEnd（D 段，新登记）

- **位置**：`apps/api/src/modules/app/key/key.service.ts`（`rotate` / `rotateForCronJob`）+
  `apps/api/src/modules/security/rsa/rsa.service.ts`（`getCurrentRsaPrivateKey`）+
  `apps/api/src/interceptors/request/decrypt.interceptor.ts`。
- **现象**：rotate 在事务内把旧行置 `DEPRECATED` 并插入新 ACTIVE 行；请求解密只读
  「version 最大的 ACTIVE 行」的私钥。轮转瞬间用旧公钥加密、尚未到达的请求密文，在新私钥下
  解密失败并映射 **40011**。当前没有 grace 窗口、没有按 key version 回退解密。
  另一面：`getCurrentActiveKey` 只按 `type + status=ACTIVE + version DESC` 取行，**不校验
  `validEnd`** —— 已过期但 cron 尚未轮转的 key 仍被当作当前 key 使用。
- **实测证据**：本次读码钉死；`key.api-spec.ts` 只覆盖 current 投影与 rotate 两腿的数据形态，
  没有「轮转前后同一密文」的用例；`DecryptRequest` 的生产消费方也未被轮转用例覆盖。
- **建议**：轮转保留短时重叠窗口（按 `version` 记录可解密的旧私钥，或延迟 DEPRECATED 生效），
  或在 rotate 前等待在途请求排空；`getCurrent` 对 `validEnd` 过期给出明确语义（自动轮转 /
  受控 503），不要静默继续用过期 key。

### P2-31 monitor/state 的 auth=false 不清 userId —— 在线监控残留上次登录用户（D 段，新登记）

- **位置**：`apps/api/src/modules/app/monitor/user/user.service.ts`（`updateState`：
  `if (dto.auth === false) dto.userId = null`，随后 `Object.entries(...).filter(([_, v]) => !isNil(v))`
  又把 null 丢掉）+ `app/monitor/user/shared/user.shared.service.ts`（02:00 cron 的
  `updateAuthState` 才会把 `auth=false` 且 `user_id=null` 落库）。
- **现象**：已存在的 monitor 行收到 `auth=false` 上报时，`user_id` 不会被清空；列表 / read 仍按
  `user_id` 装回上一个登录用户，在线监控显示「已登出但仍是某人」的脏状态，最长持续到下一次
  cron（每 2 小时）。新插入的行走 insert 缺省列，不受影响。
- **实测证据**：本次读码钉死；`monitor-user.api-spec.ts` 覆盖 upsert、auth 字段与 force-quit，
  未覆盖「登录 → 登出上报 → user_id 应为 null」。
- **建议**：`auth=false` 时显式 `SET user_id = NULL`（不要走 nil 过滤），或把清零写进同一
  update 语句；补一条登出上报的断言。

### P2-32 `handleSecurityPolicy`（改密/敏感操作）只撤 RT 不清 AUTH:SESSIONS —— 旧 AT 有效至过期（C+D 批复审新登记，2026-10-28）

- **位置**：`apps/api/src/modules/auth/modules/signout/signout.service.ts`
  （`handleSecurityPolicy`：`revokeRTForUser` + socket 通知）+
  `apps/api/src/modules/auth/modules/opaque/admin/opaque.admin.service.ts` /
  `opaque/user/opaque.user.controller.ts`（改密、密码清理等敏感操作统一走该 trigger）。
- **现象**：P2-12 修好后，`user-kick-other` / `admin-kick` 会按设备清会话三键，但
  `security-policy` 分支只撤该用户全部 RT 并通知在线设备，**不清** `AUTH:SESSIONS` /
  `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED`。P0-4 起 JWT validate 只认会话键是否存在 ——
  改密后旧 AT 仍在 `AUTH:SESSIONS` 有效期内可用，直到过期（或用户主动 signout）。
  「改密即全端下线」的产品语义因此只兑现了 RT 面（无法换发），未兑现 AT 面。
- **实测证据**：本次读码钉死；`opaque-admin.api-spec.ts` / `user-me` 等只断言撤 RT，
  未断言旧 AT 立即失效（P2-12 的 force-quit 双设备用例只覆盖 kick 分支）。
- **建议**：复用 P2-12 的清扫手法 —— `handleSecurityPolicy` 在 after-commit 里按用户维度
  `revokeSession(userId)`（无 deviceId 即全设备）+ 按 `AUTH:PERMISSIONS:<user>:*` /
  `AUTH:MFA:VERIFIED:<user>:*` 前缀清缓存；补「改密后旧 AT 40101」用例。本轮**登记不修**
  （与 P2-12 同族，手法可复用，排独立批次）。

## P3 契约不一致

### P3-1 throttle 429 形态是 HTTP 200 + body.code 42900 —— 【裁决：接受 2026-10-28】

- **位置**：全局异常过滤器统一 200 壳的副作用 —— 429 语义仅存于业务码。
- **实测证据**：`throttle.api-spec.ts`。
- **建议**：接受现状并写入前端契约，或为 ThrottlerException 例外放行 HTTP 429。
- **裁决（2026-10-28，批 2）**：**接受现状（HTTP 200 + body.code 42900）并写入前端契约** ——
  不放行原生 HTTP 429（统一响应壳是全站契约，单点例外会破坏前端响应拦截器的唯一分支）。
  `ENDPOINTS.md` 的 throttle/device initial 行已补「前端消费事实契约」说明。

### P3-2 device initial 重名 device_name（23505）被 catch-all 吞掉 → 误导性 40605 —— 【已修复 2026-10-28】

- **位置**：`device.service.initial` 的 catch-all（一切异常改抛 NOT_ACCEPTABLE_DEVICE_UNSUPPORTED）。
- **实测证据**：F 段补记「测试踩坑」。
- **建议**：catch 内单列 23505 → 受控 40000。
- **修法（2026-10-28，批 2）**：catch-all 之前单判 `QueryFailedError` 且
  `driverError.code === '23505'` → `WalnutAdminExceptionBadRequest`（40000，
  约束名进 `_devMsg`）；其余异常仍走 40605。device spec 新增「重名 device_name → 40000」
  用例与「service 层空请求 → 40605」对照。

### P3-3 gitee/github callback 缺 code → passport-oauth2 authorize 重定向腿（302）—— 【已修复 2026-10-28】

- **位置**：`auth/modules/oauth` callback 端点（无受控错误壳）。
- **实测证据**：`external-oauth.api-spec.ts` D 段。
- **建议**：controller 前置 code 校验，缺码直接受控 40000。
- **修法（2026-10-28，批 2）**：在 `OAuthGiteeGuard` / `OAuthGitHubGuard` 的
  `canActivate` 前置校验 `req.query.code`（guard 先于 controller，@UseGuards 之前无法在
  handler 里拦），缺失/空串直接 `WalnutAdminExceptionBadRequest`（40000）。external-oauth
  spec 的两条 302 钉现状翻转为 HTTP 200 + body.code 40000（无 Location）。

### P3-4 `/auth/permissions` 顶层是「首个根节点的 children」—— 单根无子级时顶层数组恒空 —— 【裁决：接受 2026-10-28】

- **位置**：`auth/modules/session`（permissions 组装）。
- **实测证据**：`auth-session.api-spec.ts` D 段。
- **建议**：返回完整根数组，或把「单根 + children」约定写进前端契约。
- **裁决（2026-10-28，批 2）**：**接受现状并把「单根 + children」写进前端契约** ——
  `permissionMenuTree` 顶层 = 首个根节点的 children（admin 侧菜单渲染即按此消费）；
  改返回完整根数组会牵动前端菜单树装配，收益不足。`ENDPOINTS.md` 的
  `GET /auth/permissions` 行已补前端消费契约说明。

### P3-5 webauthn register/verify 带 garbage response → 未受控异常兜底 50000 —— 【已修复 2026-10-28】

- **位置**：`system/user/mfa` webauthn verify（simplewebauthn 异常未包装）。
- **实测证据**：`user-mfa.api-spec.ts` C 段。
- **建议**：包装成受控 40000。
- **修法（2026-10-28，批 2）**：`verifyRegistrationResponse` / `verifyAuthenticationResponse`
  两处调用包 try/catch → `WalnutAdminExceptionBadRequest({ errMsg:
  'business.auth.mfa.verifyFail', _devMsg: 原始 message })`。user-mfa spec 的
  「malformed response → 50000」钉现状翻转为 40000。

### P3-6 `/shared/ali/sts` 在 env 配有 vendor key 时发真实外网请求 —— 【裁决：登记 2026-10-28】

- **位置**：`shared/ali`（STS assumeRole 直连阿里云）—— 结果取决于外部服务，不可脚本稳定。
- **实测证据**：`shared-ali.api-spec.ts` D 段（受控两态断言：20000 信封 XOR 50000 兜底）。
- **建议**：STS 客户端注入化（测试可替换），或加 dry-run 开关。
- **裁决（2026-10-28，批 2）**：**登记为已知测试边界，客户端注入化延后** —— 现有 spec
  的双态断言已覆盖「不崩」；注入化需要给 @alicloud SDK 包一层 provider，收益是测试确定性、
  成本是生产接线改动，排到独立批次。

### P3-7 role 无 delete / deleteMany 端点（CRUD 四件缺二）—— 【裁决：登记 2026-10-28（角色不删）】

- **位置**：`system/role` controller —— 只有 CRUD 四件中的 create/read/update/list。
- **实测证据**：C 段 role spec（文件头登记）。
- **建议**：确认设计意图：补端点，或在 API 文档登记「角色不删」为明确约束。
- **裁决（2026-10-28，批 2）**：**「角色不删」是明确设计约束** —— role 是权限链的稳定
  引用（sys_user_role / sys_role_menu / current_role_id 多处关联），不提供 delete /
  deleteMany；停用走 update status，解绑走 junction 调整。`ENDPOINTS.md` 的 role 行同步
  标注该约束。

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

### P3-17 ENDPOINTS.md 的 sensitive verify 请求形态与 DTO 不符（文档大轮次 A 段，新登记）

- **位置**：`apps/api/test/api/ENDPOINTS.md` §3 `security/sensitive` 行 vs
  `apps/api/src/modules/security/sensitive/sensitive.dto.ts`
  （`SecuritySensitiveVerifyRequestDTO`）。
- **现象**：ENDPOINTS 把 verify 请求登记为 `{basic,action,type,code}`，实际 DTO 是
  `{level, operationType?, method, credential}`（`security.api-spec.ts` 用例也按后者发）。
  另外 check 用 query `type`、verify 用 body `operationType`，同一概念两个名字。
- **实测证据**：本次文档复审读码 + `security.api-spec.ts` 的 verify 用例字段。
- **建议**：修正 ENDPOINTS 行；若允许破坏性改动，统一 check/verify 的参数命名。

### P3-18 多根菜单部署下树被截断 —— fullTree / permissionMenuTree 只取第一个根（B 段，新登记）

- **位置**：`apps/api/src/modules/system/menu/shared/menu.shared.service.ts`
  （`getMenuTreeAndTreeWithoutTypeElement` 的 `fullTree[0]?.children`；`getCorePermissions`
  的 `permissionMenuTree[0]?.children`）+ `apps/api/src/modules/system/menu/repo/menu.repo.service.ts`
  （`findRootMenu` 用 `findOne`，`findAllMenus` 无 ORDER BY）。
- **现象**：`sys_menu` 若有多个 `pid IS NULL` 的根，`GET /system/menu/tree` 的 `fullTree`
  与 `/auth/permissions` 的 `permissionMenuTree` 都只返回「某一个根」的 children ——
  其余根整棵不可见，且选中哪个根由 `findOne` / 无排序查询决定。同一次响应里
  `treeWithoutTypeElement` 反而保留全部根（口径不一致）。P3-4 已把「单根 + children」
  定为前端契约，但 DDL 与服务层都没有保证单根（无根节点唯一性约束）。
- **实测证据**：本次读码钉死；C 段 `menu.api-spec.ts` 与 I 段 `permission-chain.api-spec.ts`
  的种子都只有一个根，无法触发。
- **建议**：要么把单根做成显式约束（迁移断言 / create 时校验根节点唯一），要么
  `fullTree` 返回完整根数组并同步前端契约与 P3-4 的裁决。

### P3-19 ENDPOINTS.md 把 me/profile 的权限点登记为 `me:profile:update`，代码是 `system:user:updateProfile`（B 段，新登记）

- **位置**：`apps/api/test/api/ENDPOINTS.md` §5 user/me 行 vs
  `apps/api/src/modules/system/user/controllers/user.me.controller.ts` 的
  `Permissions.UPDATE_PROFILE = 'system:user:updateProfile'`。
- **现象**：文档与代码的权限串不一致；`user-me.api-spec.ts` 用 root 调用（权限守卫 root
  短路），差异不会暴露。若前端菜单 seed 按文档串配置，非 root 用户改资料会 40105。
- **实测证据**：本次读码 + 全仓 grep：`me:profile:update` 只出现在 ENDPOINTS.md。
- **建议**：修正 ENDPOINTS 行；若确定统一到 `me:` 前缀，则同步改 controller 与菜单 seed。

### P3-20 locale 映射 body 无任何 langId 键时直落 service —— TypeError 兜底 50000（B 段，新登记）

- **位置**：`apps/api/src/modules/system/locale/locale.pipe.ts`
  （只保留 uuid 键，无匹配键时产出 `[]`）+ `locale.controller.ts` 的 `ParseArrayPipe`
  （空数组不校验任何 item）+ `locale.service.ts` 的 `create` / `update`
  （`payload[0].key` / `payload[0].oldKey` 解引用）。
- **现象**：`POST /system/locale` 或 `PUT /system/locale/:id` 的 body 若为 `{}`、或只含
  `key` 而不含任何 `<langId>: value`，二段式管道第三段对空数组直接放行，service 在
  `payload[0]` 上解引用 → TypeError → 全局兜底 50000，而不是受控 40099。
- **实测证据**：本次读码钉死；A 段 `locale.api-spec.ts` 只覆盖正常映射 body 与缓存语义。
- **建议**：`LocalePayloadTransformPipe` 产出空数组时直接
  `WalnutAdminExceptionRequestDataError`（40099 族），或 controller 入口判空。

### P3-21 deleted 的 `system:deleted:recover:mine` 常量未接线 —— `me/recover` 复用管理端权限点（C 段，新登记）

- **位置**：`apps/api/src/modules/system/deleted/deleted.controller.ts` 的 `Permissions`
  （`RECOVER_MINE: 'system:deleted:recover:mine'` 声明后未使用；`me/recover` 挂的是
  `Permissions.RECOVER`）。
- **现象**：`POST /system/deleted/me/recover` 与 `POST /system/deleted/recover` 使用同一个
  权限点 `system:deleted:recover`；前者只靠「无 `@HasRole` + 属主校验」区分。`RECOVER_MINE`
  是死常量，`ENDPOINTS.md` 的「recover 系另有 `@HasRole`」表述也没有区分两个端点。
- **实测证据**：本次读码；`deleted.api-spec.ts` 用 root 短路，未覆盖非管理员的权限差异。
- **建议**：给 `me/recover` 接线独立权限点（并授予所有登录角色），或删除常量并把
  「两路径同权限点」写进契约。

### P3-22 `GET /app/health/disk` 硬编码 Windows 路径 `C:/`（C 段，新登记）

- **位置**：`apps/api/src/modules/techniques/health/health.controller.ts` 的
  `checkStorage('disk', { thresholdPercent: 0.75, path: 'C:/' })`。
- **现象**：非 Windows 部署（容器 / Linux）没有 `C:/`，`DiskHealthIndicator` 抛错，经全局
  异常过滤器兜底为 HTTP 200 + `body.code = 50000`，磁盘健康检查恒失败。
- **实测证据**：本次读码；B 段 `health.api-spec.ts` 在 Windows 开发机运行，未覆盖 Linux。
- **建议**：路径取自 env 或按 `process.platform` 选根路径（Linux 用 `/`），并补平台分支。

### P3-23 MFA 备用码校验无 HTTP 通道 + 裸 Nest 异常；SMS 密文列无写入路径（C 段，新登记）

- **位置**：`apps/api/src/modules/system/user_mfa/totp/totp.service.ts`
  （`verifyBackupCode` 无 controller 路由；抛 `BadRequestException` / `UnauthorizedException`）+
  `user_mfa/entity/user-mfa.entity.ts` 的 `phone_number_ciphertext`（selector 有、写入点无）。
- **现象**：备用码在 bind 时生成并返回一次，但唯一的校验方法 `verifyBackupCode` 没有对外
  端点，属于不可达服务代码；其异常是裸 Nest 异常，若未来接线会绕过统一错误码。SMS MFA 的
  密文列、`webauthnTransports` 的写入也未实现。
- **实测证据**：本次读码；C 段 `user-mfa.api-spec.ts` 覆盖 totp 主闭环与备用码形状，未覆盖
  备用码登录路径（无端点）。
- **建议**：补备用码校验端点（接入同一 post-verification 与错误码体系），或删除死代码；
  未实现的列在实体注释里标注「预留」。

### P3-24 `log_operate.action_type` 的 const 与 DB CHECK 不一致（C 段，新登记）

- **位置**：`@walnut-server/const/decorator/logOperate` 的 `WalnutAdminConstDecoratorLogOperateAction`
  + `apps/api/src/modules/system/logs/operate/entity/log-operate.entity.ts` 的列注释
  （CHECK 只含 `OTHER/CREATE/UPDATE/DELETE/DELETE_MANY/IMPORT/EXPORT/CLEAR`）。
- **现象**：const 里另有 `REFRESH` / `AUTH`；若以这两个 action 写日志，会撞 CHECK
  （23514），经全局兜底成为 50000。当前装饰器调用点未使用这两个值，属潜在契约缺口。
- **实测证据**：本次读码 + 实体注释（迁移时已记录「待维护者定夺」），DESIGN-ISSUES 未登记。
- **建议**：把两值纳入 migration 的 CHECK（若确需记录刷新/认证类操作），或从 const 删除并
  在装饰器类型上收窄。

- **D 段复核（2026-10-28）**：当前 migration 的 `ck_log_operate_action_type` **已包含**
  `REFRESH` / `AUTH`（共 10 个值），本条「撞 23514」的前提不成立；需要修的是实体注释
  与 phase2 小节的值域说明，见 P3-25。

### P3-25 实体注释与 migration 的 CHECK 取值域漂移（menu cache_key_strategy / log_operate action_type）（D 段，新登记）

- **位置**：`apps/api/src/modules/system/menu/entity/menu.entity.ts` 的
  `cache_key_strategy` 注释（写 `('name','path')`）；`apps/api/src/modules/system/logs/operate/entity/log-operate.entity.ts`
  的 `action_type` 注释（写 8 个值）；对照
  `apps/api/migrations/1792922206018-InitSchema.ts` 的 `ck_menu_cache_key_strategy`
  / `ck_log_operate_action_type`。
- **现象**：migration 的 menu CHECK 已含 `custom`（2026-10-27 枚举三方守卫抓出后补齐），
  log_operate 的 action CHECK 已含 `REFRESH` / `AUTH`（10 个值）；两处实体注释仍是旧值域。
  P3-24 依据实体注释推断「REFRESH/AUTH 会撞 23514」，在当前 migration 上不成立，会给维护者
  错误的排期依据。
- **实测证据**：本次读码逐项对照 migration；`ck_log_operate_action_type` 的 IN 列表第 583 行、
  `ck_menu_cache_key_strategy` 的 IN 列表第 308 行。
- **建议**：以 migration 为准更新两处实体注释，并把 P3-24 标记为「前提不成立 / 仅剩注释同步」；
  后续把实体注释纳入 lint（或直接从 migration 生成取值域说明），避免再漂。

### P3-26 setting 没有 delete / deleteMany 端点，但登记为 CRUD（D 段，新登记）

- **位置**：`apps/api/src/modules/app/setting/setting.controller.ts`（只挂
  `WalnutAdminDecoratorCreate/Read/Update/List` + `POST cache/refresh`）对照
  `ENDPOINTS.md` §1 的「CRUD + POST cache/refresh」。
- **现象**：`DELETE /app/setting/:id` 与 `deleteMany` 都不存在；配置行只能新增/修改。直接改库
  删除行不会触发 `APP:SETTING` 刷新，配置键会在缓存里残留到下一次全量重算。前端按「标准 CRUD」
  消费会得到 40400（路由不存在）。
- **实测证据**：本次读码；`setting.api-spec.ts` 的 CRUD 闭环只覆盖 create/read/update/list。
- **建议**：要么补 delete / deleteMany（并挂 after-commit 刷新），要么把 ENDPOINTS 与前端契约
  改成「配置不删」的明确取舍；二者选一，不要维持「文档说 CRUD、代码只有四分之三」的现状。

### P3-27 JWT_AT / JWT_RT 没有生产写入点 —— DTO 声称的「启动自举」不存在（D 段，新登记）

- **位置**：`apps/api/src/modules/app/key/dto/key.dto.ts`（`AppKeyInitTypeNotSystemManagedConstraint`
  的提示语「bootstrapped by the system at startup」）+ `key.const.ts` 的 `JWT_AT` / `JWT_RT`
  + 全仓 grep。
- **现象**：两类 key 只出现在枚举、CHECK 与 DTO 拒绝分支；没有启动期写入 `app_key` 的代码，
  也没有消费 `app_key` 中 JWT 行的签名路径（JWT 实际读 env `jwt.access.secret` /
  `jwt.refresh.secret`）。因此 DTO 的拒绝文案描述了一个不存在的自举机制，维护者按提示去找
  启动代码会扑空。
- **实测证据**：本次全仓 grep `JWT_AT` / `JWT_RT`：除实体/常量/DTO/测试外无生产消费方；
  `key.api-spec.ts` 的 JWT_AT 用例只断言 40099 与行数不变。
- **建议**：删除两个枚举值（连同 CHECK）或真正实现启动自举并在文档写明密钥来源；不要把
  「系统管理」写成一句无法验证的注释。

### P3-28 shared_area 的递归 CTE 能力未接线 —— 无端点、无调用方（D 段，新登记）

- **位置**：`apps/api/src/modules/shared/area/area.basic.repository.ts` 的
  `findSubtreeByCode` / `assembleSubtree`。
- **现象**：整子树 / 限深查询（递归 CTE + `CYCLE` 环保护）已实现，但 `SharedAreaService` 与
  controller 都没有调用；对外只有 children（单层）与 feedback（向上收集同级）两个端点。
  phase2 §5.1 设计的「整树一次性拉取」在 HTTP 面不可达，属预留能力或死代码。
- **实测证据**：本次读码 + 全仓 grep：两个方法只在本文件与 service 头注出现。
- **建议**：补一个子树端点（可带 maxDepth），或明确标注「预留，未接线」并在 knip/清理批次
  决定去留；不要让读者以为线上有整树能力。

### P3-29 monitor/server 八个端点各自执行宿主机探测 —— 无缓存 / 无合并 / 无限流（D 段，新登记）

- **位置**：`apps/api/src/modules/app/monitor/server/server.controller.ts` +
  `server.service.ts`。
- **现象**：cpu / mem / os / sys / disk / battery / time / network 每个请求各调一次
  `systeminformation`（部分方法会 spawn 系统命令）；没有短 TTL 缓存、没有聚合端点、没有
  throttle。管理台监控页按固定间隔轮询八个端点时，宿主机探测次数是请求数的 8 倍。
- **实测证据**：本次读码；`monitor.api-spec.ts` 只做八端点形状冒烟，没有并发/频率面。
- **建议**：加一个聚合端点（一次采集返回八项）或 5–10 秒 TTL 缓存；至少给该 controller 挂
  throttle，避免监控页轮询变成对宿主机的压力源。

### P3-30 app_monitor_user 列表默认排序 lastActiveAt 无索引（D 段，新登记）

- **位置**：`apps/api/src/modules/app/monitor/user/dto/user.dto.ts` 的 list 白名单
  （`lastActiveAt` 是 admin 列表默认排序）+ `apps/api/migrations/1792922206018-InitSchema.ts`
  的 `app_monitor_user` 索引（只有 `uq_monitor_visitor` / `idx_monitor_device` /
  `idx_monitor_user`）。
- **现象**：monitor 行随访客增长（每个匿名访客一行），默认列表按 `last_active_at DESC` 排序
  没有索引支撑，量级上来后走内存 Sort；phase2 §4.21 的索引清单也没有这一列。
- **实测证据**：本次读码 + DDL 对照；DTO 注释已自述「无索引 → 见报告建议补索引」。
- **建议**：补 `idx_monitor_last_active (last_active_at DESC)`，或把默认排序改成有索引的
  `first_visit_at` 并同步前端默认排序。

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
