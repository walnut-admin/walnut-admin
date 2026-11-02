# 端到端公私钥交换 review（I3：取公钥 → 会话密钥 → 签名 → 校验 → 响应加密）

> **轮次**：I3 调研轮 ｜ **任务板**：task-3（已 claim）
> **基线**：HEAD `23106e1c` 之后，工作树 clean。**本轮只读，未改任何源码**；临时脚本只在 `node -e` 里跑（无落盘）。
> **观测口径**：全局异常过滤器**永远回 HTTP 200** —— 崩溃 = 200 + `code=50000`、校验拒绝 = 200 + `40099`。
> 本报告所有"失败"一律指 **body 里的 code**，不指 HTTP status。
> **方法**：把服务端（rsa / key 域 / crypto / guards 的两个拦截器 + sign guard）、契约（crypto-wire）、
> 前端（`@walnut/client` 的 5 个密码学模块 + admin 的 axios 拦截器与 security store）**逐行连起来读**，
> 再用 grep 反查"每一环到底有没有生产调用方"。凡是"没有调用方"的环，都单列成死路径。

---

## 0. 结论速览

| # | Lead 的问题 | 我的结论 | 级别 |
|---|------------|---------|------|
| 1 | 全链路时序 | 主链路**只走一半**：签名 + 响应加密在跑；**请求体加密（服务端 RSA 私钥那条腿）完全没在生产里跑过** | 见 §1.3 |
| 2 | 公钥轮换 | **有机制但无宽限期**：每日 00:00 cron，`validEnd` 到期才 rotate；旧 key 立刻 `DEPRECATED`，无重叠窗口（既有登记 P2-30 已提，我补充了"影响面其实是客户端缓存与 URL 掩码，不是旧密文"） | P1 |
| 3 | 公钥过期 | **功能上不存在"过期"**：业务读路径不校验 `validEnd`，响应里也没有 `expireAt`；客户端把服务端公钥缓存在内存里直到刷新页面，**无从得知**轮换/过期 | P1 |
| 4 | 公钥元数据 | **只有 `publicKeyPem` 一个字段**（AES 那条只有 `keyB64`）；**没有** keyId / version / algo / expireAt。前端也确实只用这两个字段 ⇒ 元数据缺失是"设计如此"，不是"前端没用" | P2 |
| 5 | 错误码体系 | **有歧义**：40112 一个码承载 ≥6 种失败；40113 名字叫"签名过期"实为"AES 会话密钥缺失"；**40012（公钥未找到）是不可达死码**；响应加密失败落到 50000 未受控 | **P0（死码 + 空转）** / P2（歧义） |
| 6 | 降级与安全边界 | `AES_GCM_WIRE` 是**纯常量、没有开关**；真正的"关掉/明文"路径只有三条，其中两条是"从来没开过"而不是"能关掉"；唯一的环境相关旁路是 `isPostman`（`isDev` 门住，生产恒 false） | P2/P3 |

**一句话**：签名链路是健康的（且有几处很扎实的加固：不降级、原子 nonce、时序安全比较、日志只打摘要）；
**公私钥交换这条链路有一处 P0 级断点**（服务端"客户端公钥是否存在"的校验是空转，导致恢复路径永不触发，用户侧表现为启动即白屏错误屏）。

---

## 1. 现状时序（实测代码路径）

### 1.1 主链路（ASCII；⚠️ 标记的是死路径）

```
[浏览器 SPA]                                                          [NestJS API]                        [PG app_key]   [Redis]
    │
    │ 0) bootstrap（apps/admin/src/App/src/bootstrap.ts:109 —— sign 是 blocking 步骤）
    │    appStoreSecurity.setupSign()            (store/modules/app/app-security.ts:114)
    │      └─ 本地无 RSA 密钥对时（localStorage，AES-GCM 加密，expire 30d）
    │           generateRsaOaepKeyPair()  ← RSA-2048 / OAEP-SHA256（client/browser/crypto/shared.ts:143）
    │           POST /security/sign/initial {rsaPubKey, force:false} ──────▶ SecuritySignController.initial
    │                                                (apps/api/.../security/sign/sign.controller.ts:42)
    │                                                    └─ SecuritySignService.initial
    │                                                       已缓存且 !force → 回吐缓存串（:24-25）
    │                                                       否则 setRsaPubKeyCache(ttl 30d)（cache.rsa.ts:15）──▶ TTL 30d
    │                                   ◀────────── true | 缓存里的 PEM
    │           ⚠️ 客户端**忽略**这个返回值（永不用回吐的 PEM 覆盖自己的密钥对）
    │
    │      └─ POST /security/sign/aes-key（sign-free 类）───────────────▶ SecuritySignService.getAesKey
    │                                                (libs/security/src/sign/sign.service.ts:34)
    │                                                  ① await getRsaPubKeyCache(deviceId)  ← **返回值被丢弃**
    │                                                  ② 复用/生成 32B base64url aesKey ────────────────────▶ TTL=AT 有效期
    │                                                  ③ 出参过 @WalnutAdminDecoratorEncryptResponse('aesKey')
    │                                                     → EncryptInterceptor → SecurityRsaService
    │                                                       .encryptResponseValueWithClientRsaPubKey
    │                                                       (libs/rsa/src/rsa.service.ts:39)
    │                                                       · 随机 AES-256-GCM key/iv 加密 plaintext
    │                                                       · key|iv|tag(60B) 用**客户端** RSA 公钥 RSA-OAEP 包起来
    │                                                       · 外层 base64(JSON{cipher,key})
    │                                   ◀──────────────── AES 信封字符串
    │           decryptResponseValue()（interceptors/response/crypto.ts:6）用**本地私钥**解 key|iv|tag → AES-GCM 解密
    │           → signAesSecretKey（内存）+ hkdfInfo
    │
    │ 1) 每个业务请求（interceptors/request/interceptor.ts:16）
    │    a) **先**签名（:24）：raw = METHOD|PATH?query|扁平body|timestamp|nonce|ua
    │        未登录 HMAC-SHA256(raw, aesKey)；已登录 HKDF(sessionKeyHash, salt=aesKey, info) 再 HMAC
    │    b) **后**加密 body —— 仅当 config._autoEncryptRequestData 存在（:43）
    │         ⚠️ 全仓 **0 处**设置该字段 ⇒ 这条腿从未执行
    │  ─── X-Sign / X-Timestamp / X-Nonce / UA / DeviceID cookie ──────▶ WalnutAdminGuardSign（guards/sign.guard.ts:68）
    │                                                                  ① sign-free? isPostman? → 放行
    │                                                                  ② 缺头 → 40112（:188-198）
    │                                                                  ③ await getRsaPubKeyCache —— ⚠️ 空转（:102）
    │                                                                  ④ 时间戳 ±5min → 40112（:216）
    │                                                                  ⑤ nonce SET NX EX 300 → 40112（:238-243）
    │                                                                  ⑥ signTicket 比对/续签（:249-273）
    │                                                                  ⑦ AES 会话密钥缺失 → 40113（:319-325）
    │                                                                  ⑧ 双因子派生失败 → 40112，**不降级**（:381-390）
    │                                                                  ⑨ timingSafeEqual → 40112（:159-170）
    │
    │ 2) 响应加密只有 **3 个端点**（@WalnutAdminDecoratorEncryptResponse）：
    │      GET /auth/keys（'B'）、POST /security/sign/aes-key（'aesKey'）、GET /shared/ali/sts（3 字段）
    │    ⚠️ 请求解密（@WalnutAdminDecoratorDecryptRequest）：**0 个端点使用**
    │
    │ 3) 服务端 RSA 私钥（app_key.meta.privateKeyPem）只在"请求解密"那条死腿里被读（rsa.service.ts:77-118）
    │    轮换：每日 00:00 cron（techniques/task/task.service.ts:119-120）→ 仅当 validEnd(30d) 已过才 rotate
```

### 1.2 每一环的输入/输出/失败码（含"到底有没有人在用"）

| 环 | 输入 | 输出 | 失败码 | 生产在用？ |
|----|------|------|--------|-----------|
| `POST /security/sign/initial` | `{rsaPubKey: string, force?: boolean}` | `true` 或**缓存里的旧 PEM**（二态，见 `sign.controller.ts:16-27`） | 无专属码；DTO 无 PEM 校验 ⇒ 任意串都能入库 | ✅ 每次首次注册 |
| `POST /security/sign/aes-key` | DeviceID cookie | `{aesKey: 信封串, hkdfInfo}` | 客户端公钥缺失 ⇒ **50000**（见 P0-1） | ✅ |
| `GET /security/rsa/public-key` | — | **裸 PEM 字符串**（`rsa.controller.ts:23-25`） | key 不存在 ⇒ `undefined`（无码） | ❌ 唯一调用方在死路径里 |
| `GET /app/key/current/:type` | type | `{publicKeyPem}` 或 `{keyB64}`（`key.dto.ts:172-190`） | 40105（仅 RSA 视图，`key.current.guard.ts:33-37`） | ✅ `AES_KEY_URL` 被 URL 掩码用；RSA 视图仅管理面 |
| 签名校验（全局 guard） | 6 个头/cookie + body | 放行 | **40112**（6 类）/ **40113**（AES 缺失） | ✅ |
| 响应加密（3 端点） | 出参字段 | base64(JSON{cipher,key}) | 客户端公钥缺失 ⇒ **50000** | ✅ |
| 请求解密（0 端点） | 信封串 | 明文 | **40011** | ❌ |

### 1.3 三条死路径（本轮最意外的发现）

**(1) 请求体加密整条腿是死的。** 逐跳验证：
- 客户端只在 `config._autoEncryptRequestData` 存在时才加密（`request/interceptor.ts:43`）；
- 全仓 grep 该字段：只有拦截器自身、类型声明、文档，**0 处设置**（`git grep -n "_autoEncryptRequestData" -- apps packages` 输出 8 行，其中设置点 0）；
- 服务端 0 个端点标 `@WalnutAdminDecoratorDecryptRequest`（只有装饰器定义 + 类型注释 + 测试文档）；
- ⇒ `SecurityRsaService.decryptRequestValueWIthServerRsaPrivKey`（`rsa.service.ts:77`）**从未在生产被调用**；
- ⇒ **服务端 RSA 私钥（30 天轮换、存 PG jsonb）在生产里从未被使用**；
- ⇒ 40011 只在 `/app/error/40011` 演练端点可达（`error.controller.ts:109`）。

**(2) 40012（`BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND`）是不可达死码。** 见 P0-1。
它唯一的抛点 `cache.rsa.ts:23` 在一个**永远为假**的 `isNil` 后面。

**(3) 客户端的两个恢复分支各有一半是死的：**
- 40012 分支（`response/interceptor.ts:88-91` → `rsaPubKeyNotFound.ts` → 重新登记公钥）：因为 (2)，**永不触发**；
- 40011 分支（`:80-85` → `rsaDecrypt.ts` → 清缓存重取服务端公钥）：因为 (1)，**永不触发**。

> 也就是说：这套代码里**唯一真正在跑的密钥交换**是「客户端 RSA 密钥对 ↔ 服务端响应加密」，
> 加上「AES 会话密钥 ↔ HMAC 签名」两条；图里看起来对称的"双向 RSA"，实际是单向的。

---

## 2. 六个问题的逐条回答

### 2.1 全链路时序（输入输出与失败码）

主链路见 §1.1，失败码汇总见 §1.2。三点必须点名：

1. **签名在加密之前算，且签的是明文 body**（`request/interceptor.ts:24` 先、`:43` 后）。
   服务端的签名校验跑在 guard 阶段（早于拦截器），读的也是 `req.body`（`sign.guard.ts:127`）——
   两边都是明文，**当前是一致的**。但一旦有人把 `_autoEncryptRequestData` 打开，
   客户端签的仍是明文、服务端 guard 看到的是信封串（解密拦截器只写 `request._decryptedBody`，
   不改 `request.body`，见 `decrypt.interceptor.ts:95`）⇒ **立刻全量 40112**。
   这条"埋着的雷"值得写进任何启用请求加密的工单里。
2. **AES 会话密钥同时是"签名 HMAC 的 key"与"双因子 HKDF 的 salt"**（`sign.guard.ts:114`、`:374-379`）。
   它的生命周期是「访问令牌有效期」（`cache.sign.ts:28`），不是"会话"也不是"设备"。
3. **响应加密用的密钥方向与直觉相反**：不是"服务端 RSA 私钥加密"，而是
   「随机 AES 加密内容 + **客户端** RSA 公钥包 AES 材料」（`rsa.service.ts:39-72`）。
   所以客户端私钥才是解密能力的根 —— 它落在 localStorage 里（见 P3-4）。

### 2.2 公钥轮换：有什么、缺什么

**有什么**（完整实现，非纸面）：
- 数据模型有 `status(ACTIVE/DEPRECATED/DISABLED)`、`version`、`validStart/validEnd/rotateAfter`（`key.entity.ts:35-53`）；
- 轮换动作 `rotate()`：事务内 `FOR UPDATE` 锁当前 ACTIVE 行 → 置 `DEPRECATED` → 插 `version+1` 新行（`key.service.ts:131-143`）；
- 触发：**每日 00:00 的 cron**，对 `RSA_PAIR` 与 `AES_KEY_URL` 各跑一次（`task.service.ts:119-120`），
  且**只在 `validEnd` 已过**时才真正轮换（`key.service.ts:161-175`）；
- 手动：`POST /app/key/rotate/:type`（root only，带事务，`key.controller.ts:59-74`）；
- 并发安全：W2-A 修复把过期判断挪进事务内重判，双进程不会连环作废新 key（`key.service.ts:145-160` 的注释 + `task.service.ts` 测试）。
- 有效期写死 30 天（`key.service.ts:51`、`:80`）。

**缺什么**：
1. **没有宽限期**：旧行轮换瞬间即 `DEPRECATED`，读路径只取"version 最大的 ACTIVE 行"
   （`key.basic.repository.ts:38-53`），**没有按 version 回退解密**。既有登记 P2-30 已写这条。
2. **`rotateAfter` 是死列**：`git grep rotateAfter` 只命中实体、迁移 DDL、DTO、openapi，**无任何写入/读取逻辑**。
   ⇒ schema 暗示"可以预排轮换时间"，实际只有"到期后下一次 cron 才轮"这一个触发条件。
3. **"到期"不等于"轮换"**：`getCurrentActiveKey` 不校验 `validEnd`（同 P2-30 后半），
   所以 key 的实际可用寿命是 **30 天 ~ 31 天**（到期后要等到次日 00:00）。
4. **轮换对"已发出的客户端"的真实影响（P2-30 没覆盖的两个面）**：
   - `RSA_PAIR`：客户端把服务端公钥缓存在**内存**里（`app-security.ts:100-107`），刷新页面才会重取；
     但因为"请求加密腿"是死的（§1.3），**当前轮换它没有任何用户可见影响** —— 只影响那条死路径。
   - `AES_KEY_URL`：这是**真的会影响用户**的那一半，见 P1-3（旧掩码 URL 全 404）。

**轮换时已发出去的客户端会怎样**（按真实在跑的链路）：
| 客户端状态 | 服务端轮换 `RSA_PAIR` | 服务端轮换 `AES_KEY_URL` |
|-----------|----------------------|------------------------|
| 已持有客户端 RSA 密钥对（localStorage 30d） | 无影响（服务端只用**客户端**公钥做响应加密） | 无影响 |
| SPA 一直开着（未刷新） | 无影响（同上；死路径才会用到服务端公钥） | **旧 AES key 继续用于加密 URL 掩码** ⇒ 生成的新链接别人/自己刷新后解不开 |
| 刷新后 | 无影响 | 会拉到新 key；**旧链接 404** |

### 2.3 公钥过期：客户端如何得知？

**结论：得知不了，而且服务端也不认为它过期。**

| 环节 | 有无过期语义 | 证据 |
|------|-------------|------|
| 服务端读当前公钥 | **无**：只按 `type + status=ACTIVE + version DESC` 取行 | `key.basic.repository.ts:47-52` |
| 服务端响应 | **无** `expireAt`/`version`/`keyId` | `AppKeyCurrentResponseDTO` 只有 2 个 optional 字段（`key.dto.ts:172-190`）；`/security/rsa/public-key` 直接返回裸 PEM 串（`rsa.controller.ts:23-25`） |
| 客户端缓存 | **无 TTL**：内存缓存，直到刷新页面 | `app-security.ts:100-107` |
| 客户端失效信号 | 只有 40011（且该码不可达） | `response/interceptor.ts:80-85` + §1.3 |

⇒ "过期后的返回值与错误码"这个问题**当前没有答案**：不存在"公钥过期"这个可观测状态。
唯一带 TTL 的是"客户端公钥在 Redis 里 30 天"（`cache.rsa.ts:15`）与"客户端本地密钥对 30 天"（`app-security.ts:23-25`）。

**顺带一个真实存在的过期相关缺陷**：服务端 Redis 的 30 天与客户端 localStorage 的 30 天**各自独立计时**，
而客户端的续登记条件是"本地没有密钥对才登记"（`app-security.ts:114-122`）——
一旦 Redis 侧丢了（flush / 驱逐 / 无持久化重启），客户端**不会**自动补登记，因为它本地还有密钥对。这就是 P0-2。

### 2.4 接口返回值：元数据齐不齐、前端用不用

**结论：字段不全，且前端确实只用两个字段 —— 两者互为因果，不能只说"前端没用"。**

| 字段 | `/security/rsa/public-key` | `/app/key/current/:type` | `/security/sign/initial` | 前端是否消费 |
|------|---------------------------|--------------------------|--------------------------|-------------|
| 公钥 PEM | ✅（**裸字符串**，不是对象） | ✅ `publicKeyPem`（仅 RSA_PAIR） | ❌（返回的是"客户端公钥"或 `true`） | ✅ 用于 RSA-OAEP 加密 |
| `keyB64`（AES） | ❌ | ✅（仅 AES_KEY_URL） | ❌ | ✅ URL 掩码 |
| `keyId` / 名字 | ❌ | ✅ 有 `key` 字段（形如 `rsa_pair-1738…`）但**前端不取** | ❌ | ❌ |
| `version` | ❌ | ✅ | ❌ | ❌ |
| `algo` / `bits` / `cipher` | ❌ | ✅ 在 `meta` 里（`bits:2048, cipher:'AES-256-GCM'`，`key.service.ts:52-57`） | ❌ | ❌ 客户端算法是**硬编码**的（`RSA_OAEP.NAME/HASH`） |
| `validStart` / `validEnd` / `rotateAfter` | ❌ | ✅ | ❌ | ❌ |

⇒ 三条接口返回**三种形状**（裸串 / 投影对象 / 二态 `string\|boolean`），且客户端要用的算法参数全靠约定。
后果：① 客户端无法感知轮换（没有 version/keyId 可对比）；② 若将来换算法（如 3072 位或不同 OAEP hash），
客户端硬编码的 `RSA_OAEP` 会静默失败；③ 运维无法从响应里判断"这是不是过期 key"。

### 2.5 错误码体系：分别返回什么、有没有歧义或泄漏

| 场景 | 实际返回 | 证据 | 问题 |
|------|---------|------|------|
| 签名头缺失 | 40112 | `sign.guard.ts:188-198` | 与下面 5 种**无法区分** |
| 时间戳超窗（±5min） | 40112 | `:216-224` | 同上 |
| nonce 重放/格式错 | 40112 | `:232-243` | 同上 |
| signTicket 不匹配 | 40112 | `:249-263` | 同上 |
| 双因子派生失败（会话没了） | 40112 | `:381-390` | 同上（且**不降级**是对的） |
| 签名不匹配 | 40112 | `:159-170` | 同上 |
| AES 会话密钥不存在 | **40113**（名字是"签名过期"） | `:319-325` | 语义漂移：它真正的含义是"AES 会话密钥缺失" |
| **客户端公钥未找到** | **应为 40012，实际从不返回** | `cache.rsa.ts:18-27` | **P0-1 死码** |
| 请求解密失败 | 40011（仅演练端点可达） | `rsa.service.ts:115-117`、`error.controller.ts:109` | 生产不可达 |
| **响应加密失败** | **50000** | `encrypt.interceptor.ts:75-81` → 兜底 `exception.filter.ts:28` | 未受控：依赖异常被当"服务端 bug"告警，客户端只弹 toast（`response/interceptor.ts:144-147`） |
| 公钥接口本身拿不到 key | 20000 + `data: undefined` | `key.service.ts:110-126` 返回 `{publicKeyPem: undefined}` | 无码、无声失败 |

**歧义**：40112 一个码承载 ≥6 种语义 ⇒ 客户端无法分支重试（只能统一走 40113 的"重取 AES key"），
排障也难（服务端日志有 `signMode` 与摘要，但客户端只看到"签名无效"）。
**泄漏**：50000 的 `msg` 走 i18n 翻译（`exception.filter.ts:17-18,76-84`），未见原始 `error.message` 直出 ⇒
**没有堆栈泄漏**；但"响应加密失败"被归到 50000 会让监控把它当服务端 bug（其实往往是"设备侧公钥丢失"这种客户端可自愈的问题）。

### 2.6 降级与安全边界：`AES_GCM_WIRE` 开关与环境

**先说结论：`AES_GCM_WIRE` 不是开关。** 它是 4 个整数字面量（`contract/src/crypto-wire.ts:12-21`：
`KEY_LENGTH:32/IV_LENGTH:12/TAG_LENGTH:16/MIN_PAYLOAD_LENGTH:28`），被服务端 `crypto.service.ts:11-12`、
`rsa.service.ts:44-45` 与前端 `@walnut/utils/crypto/const.ts:15-19` 派生使用；**没有任何环境分支读它**。

真正的"能不能关掉/会不会明文"只有三条路径：

| 路径 | 判定条件 | 生效环境 | 风险 |
|------|---------|---------|------|
| `req.isPostman`：跳过 sign / decrypt / encrypt 三个环节 | `isDev && UA 含 PostmanRuntime`（`user-agent.middleware.ts:70-72`） | **仅 dev 构建**（`isDev` 是模块求值常量，生产恒 false） | 生产安全；但"dev 环境不能暴露公网"这条部署纪律必须成立（该文件 `:63-65` 已写明） |
| 客户端请求体不加密 | `config._autoEncryptRequestData` 未设置 | **所有环境**（因为 0 处设置） | 不是"能关"，是"从来没开"（§1.3）；body 明文但有签名与 TLS |
| 服务端响应不加密 | 端点未标 `@EncryptResponse` | 所有环境（仅 3 个端点标了） | 同上：默认明文，靠标注选入 |
| localStorage 明文 | `enhancedAesGcmLocalStorage(forceEncrypt=true)` 被客户端私钥/公钥用（`app-security.ts:23-25`） | 所有环境 | 无明文回退 ✅ |

⇒ **没有"偷偷降级成明文"的隐蔽路径**（这是本项的好消息）；反过来，**默认是明文**这件事必须写清：
"加密"在本仓是**逐端点选入**的（响应 3 个、请求 0 个），签名才是全局强制的（sign-free 白名单除外）。

---

## 3. 发现清单（P0-P3）

### P0-1 `cache.rsa.ts` 少一个 `await`：40012 是死码，两处"RSA 握手校验"是空转

- **结论**：`getRsaPubKeyCache` 永不抛错、缺 key 时返回 `null`。
- **证据**：
  ```ts
  // libs/cache/src/service/cache.rsa.ts:18-27
  async getRsaPubKeyCache(deviceId: string) {
    const cached = this.cacheService.get<string>(`...`)   // ← 缺 await：cached 是 Promise
    if (isNil(cached)) {                                   // ← Promise 恒不为 nil ⇒ 永不进入
      throw new WalnutAdminExceptionRsaPubKeyNotFound()    // ← 40012 死码
    }
    return cached                                          // async 返回 → 调用方 await 后拿到 null
  }
  ```
  `AppTechCacheService.get` 的签名是 `public async get<T>(key): Promise<T | null>`（`libs/cache/src/cache.service.ts:182`）。
  **可复跑**（用自己的 `node -e` 复刻同一形态，lodash `isNil` + 真实语义）：
  ```
  $ node -e "const {isNil}=require('lodash'); async function cacheGet(){return null} async function getRsaPubKeyCache(){const cached=cacheGet(); if(isNil(cached)){throw new Error('40012')} return cached} (async()=>{try{console.log('RESOLVED with:', await getRsaPubKeyCache())}catch(e){console.log('THREW:', e.message)}})()"
  RESOLVED with: null | typeof: object
  ```
- **影响**（两处调用方都当它是"握手已完成的守卫"）：
  - `sign.guard.ts:101-102` 注释「4. 验证 RSA 证书（确保已完成握手）」→ 实际什么都没验证；
  - `sign.service.ts:35-36` 注释「1. should have rsa pubkey in cache」→ 实际没检查，设备可以不登记公钥就拿到 AES 会话密钥；
  - 用户可见后果见 P0-2（客户端恢复路径依赖 40012）。
- **建议**：补 `await`（一行），并在两处调用点显式处理返回值（缺失时 40012 / 明确跳过 + 注释）。
- **优先级**：**P0** ｜ **工作量**：S（一行 + 两处注释/断言）

### P0-2 服务端 Redis 丢了"客户端公钥" ⇒ 客户端启动即错误屏，且无自愈路径

- **结论**：这是 P0-1 的放大版，用户侧表现是**白屏错误屏 + 刷新死循环**。
- **证据链**：
  1. 客户端首启登记公钥后，密钥对存 localStorage 30 天（`app-security.ts:23-25`），Redis 侧 TTL 也 30 天（`cache.rsa.ts:15`）——**两套计时器互不知情**；
  2. `setupSign` 只在"本地没有密钥对"时才登记（`:114-122`）⇒ Redis 丢了**不会补登记**；
  3. 紧接着 `getSignAesKey` → `POST /security/sign/aes-key` 要**用客户端公钥加密**（`rsa.service.ts:41,57-64`）⇒ 公钥缺失时 `publicEncrypt({key:null})` 抛 TypeError；
  4. 由于 P0-1，本该出现的 40012 变不成 40012 ⇒ 落到 50000（`encrypt.interceptor.ts:75-81` 上抛 → 兜底）；
  5. 客户端对 50000 **没有分支**（`response/interceptor.ts:144-147` 只弹 toast 并 reject）；
  6. `setupSign` 是 **blocking 步骤**（`bootstrap.ts:109`）⇒ 启动直接 fatal：`main.ts:55-57` 渲染错误屏，**只有"重新加载"按钮**（`bootstrap.ts:194-197`），没有任何"重置本机密钥"入口。
- **影响**：一次 Redis flush / 驱逐 / 无持久化重启 = 所有 30 天内活跃的设备**启动失败**，只能手工清 localStorage 或等 30 天。
  这也是"看起来是后端 bug、实际是客户端状态不可恢复"的典型。
- **建议**：① P0-1 的一行修掉后，40012 会自动走到客户端已有的 `SingletonPromiseRsaPubKeyNotFound`（重新登记）；
  ② 错误屏增加"重置本机密钥并重试"按钮（清 `RSA_PUBLIC_KEY`/`RSA_PRIVATE_KEY` 后 reload）。
- **优先级**：**P0** ｜ **工作量**：S（P0-1 一行）+ S（错误屏按钮）

### P1-1 请求体加密那条腿整条是死的（连带"服务端 RSA 私钥从未被使用"）

- **结论**：见 §1.3(1)。它不是"坏了"，是**从来没被接上**。
- **证据**：`git grep -n "_autoEncryptRequestData" -- apps packages` = 8 行，**0 个设置点**；
  `WalnutAdminDecoratorDecryptRequest` 全仓 0 个使用点（只有定义、类型注释、测试文档各一处）；
  `git grep -n "getServerRsaPubKey"` 的 2 个调用点（`request/crypto.ts:24`、`rsaDecrypt.ts:14`）都在死路径里。
- **影响**：
  1. **安全面**：请求体在传输中是明文（靠 TLS + HMAC 签名 + 重放保护），与"文档给人的印象"不符；
  2. **维护面**：`RSA_PAIR` 这套 30 天轮换、私钥落库（PG jsonb 明文 PEM，`key.service.ts:52-57`）、
     `/security/rsa/public-key`、40011 重试链、`decrypt.interceptor` 全都在为一个不存在的调用方付成本；
  3. **风险面**：谁哪天把 `_autoEncryptRequestData` 打开，会立刻全量 40112（§2.1 第 1 点）。
- **建议**：二选一（需拍板，见 §6-Q1）：删干净，或真接上并先修"签名/加密顺序"。
- **优先级**：**P1** ｜ **工作量**：删 = S（~6 文件）；接上 = M/L（含顺序重构 + 端到端用例）

### P1-2 轮换无宽限期 + 读路径不校验 `validEnd`（既有 P2-30 的复核与重估）

- **结论**：既有登记 `apps/server/apps/api/test/api/DESIGN-ISSUES.md:145-160`（P2-30）描述准确，我复核成立；
  但它的**影响面判断需要更新**：因为请求解密是死的（P1-1），"旧密文不可解"这条在生产里**不会发生**；
  真正会发生的是 §2.2 表里的两行（客户端内存缓存 + URL 掩码）。
- **证据**：`key.service.ts:131-143`（置 DEPRECATED 后立即插新行）、`key.basic.repository.ts:47-52`（只取 ACTIVE/version DESC）、
  `key.service.ts:161-175`（只在 `validEnd` 过期后轮换）；`git grep rotateAfter` 无写入/读取。
- **影响**：key 实际寿命 30~31 天；"到期"与"轮换"之间有最多 24h 的窗口，期间 `validEnd` 已过但仍在用。
- **建议**：① 读路径对 `validEnd` 给出明确语义（自动轮换 or 受控错误码），不要静默；② 若要保留解密宽限，
  按 `version` 保留最近的旧私钥可解；③ 删掉 `rotateAfter` 或实现它。
- **优先级**：**P1**（把 P2-30 从"backlog 观察"提上来，理由：现在它是唯一会影响用户的功能性轮换问题）｜**工作量**：S/M

### P1-3 `AES_KEY_URL` 轮换会让**旧掩码 URL 全部 404**

- **结论**：URL 掩码用的就是 `AES_KEY_URL` 那把 key，轮换后旧链接解不开 → 前端直接跳 404。
- **证据**：`app-key.ts:40-52`（取 `keyB64` 导入 AES key，内存缓存）→ `router/utils/crypto.ts:18-26` 加密、`:28-48` 解密；
  解密失败分支：`console.warn` + `useAppRouterPush({name: layoutConst.notFound.name})` + 返回 `null`（`:44-47`）。
  调用点：`router/guard/modules/encrypt/params.ts:14,18`、`querys.ts:14,18`。
- **影响**：掩码 URL 是**可分享物**（书签、聊天里贴的链接）。每次 `AES_KEY_URL` 轮换（约每 30 天）
  ⇒ 之前所有掩码链接变成 404，且**没有任何提示**（只 `console.warn`）。
- **建议**：三选一（见 §6-Q3）：掩码 URL 里带 key 版本前缀（回退到旧 key 直到旧行被清）、
  或把掩码 key 与 `AES_KEY_URL` 解耦（掩码专用 key 不轮换/长周期）、或明确接受"链接 30 天有效"并写进文档。
- **优先级**：**P1** ｜ **工作量**：M

### P2-1 公钥响应缺元数据，且三条接口三种形状

- **结论/证据**：见 §2.4 的表。`/security/rsa/public-key` 返回**裸字符串**（`rsa.controller.ts:23-25`），
  `/app/key/current/:type` 返回投影对象（`key.dto.ts:172-190`），`/security/sign/initial` 返回 `string\|boolean` 二态（`sign.controller.ts:16-27`）。
- **影响**：客户端无法感知轮换（无 keyId/version 可比）、算法参数硬编码（`RSA_OAEP` 常量）、运维无法从响应判断 key 年龄。
- **建议**：统一成对象 + 加 `keyId/version/algo/bits/expireAt`；这同时是 P2-1 与 §2.3 的解法。
- **优先级**：P2 ｜ **工作量**：M（契约 + 前后端 + openapi 零 diff）

### P2-2 40112 语义过载、40113 名不副实

- **证据**：§2.5 表（6 种失败 → 40112；`sign.guard.ts:319-325` 的 40113 实为"AES 会话密钥缺失"）。
- **影响**：客户端无法按原因重试（现在只能统一"重取 AES key"）；排障成本高。
- **建议**：40112 附 `meta.reason`（`missing_header\|timestamp\|nonce\|ticket\|signature\|session`），
  或拆出 4012x 子码；40113 改名/改文档为"会话密钥缺失"。
- **优先级**：P2 ｜ **工作量**：S/M

### P2-3 响应加密失败落 50000（未受控）

- **证据**：`encrypt.interceptor.ts:75-81` 直接 rethrow → `exception.filter.ts:28` 兜底 50000。
- **影响**：把"设备侧公钥丢失/被清"这类可自愈问题当服务端 bug 告警；客户端无分支（只 toast）。
- **建议**：加密前显式取公钥，缺失 → 40012（配合 P0-1 即可自然达成）；
  加密异常 → 新增/复用受控码，并让客户端走"重新登记公钥"分支。
- **优先级**：P2 ｜ **工作量**：S

### P2-4 `rotateAfter` 是死列；"到期"与"轮换"之间有窗口

- **证据**：`git grep rotateAfter` 只命中 `key.entity.ts:49-50`、迁移 DDL、`key.dto.ts:132`、`openapi.json`。
- **影响**：schema 暗示能力不存在；运维以为能预排轮换。
- **建议**：要么实现（cron 读 `rotateAfter` 提前轮换），要么删列（DDL + DTO + openapi 同步）。
- **优先级**：P2 ｜ **工作量**：S

### P2-5 没有 key 时"静默空响应"

- **证据**：`key.service.ts:110-126` 在拿不到行时返回 `{publicKeyPem: undefined}`；序列化后 `data: {}`。
  客户端 `app-key.ts:48` 用 `res.keyB64!` 直接 `base64ToArrayBuffer(undefined)` ⇒ 抛错（非受控）。
- **影响**：新部署未跑 seed（`db/seed/README.md:33` 说 key 由 `db:seed:pg` **现生成**）时，
  URL 掩码/公钥接口静默失败，报错位置离根因很远。
- **建议**：key 缺失返回受控码（如 50300 或复用 40401）；启动期做一次存在性自检并打 warn。
- **优先级**：P2 ｜ **工作量**：S

### P3 清单（低风险，但都是真问题）

| 编号 | 问题 | 证据 | 建议 |
|------|------|------|------|
| P3-1 | 无启动自检 / `initFirst` 只被测试调用 | `git grep "initFirst"` 生产 0 调用；生产依赖 seed | 启动期检查 RSA_PAIR/AES_KEY_URL 是否存在，缺失打 warn 或自建 |
| P3-2 | `crypto.service.ts` 判空写成 `=== null`，缺键实际是 `undefined` | `crypto.service.ts:25,58,135`（`configService.get` 缺键返回 undefined） | 改 `isNil` |
| P3-3 | `rsaPubKey` 无 PEM 格式/长度校验 | `sign.dto.ts:3-9` 只有 `FieldString` | 加 PEM 正则 + 最大长度（Redis 30 天存储） |
| P3-4 | 客户端私钥 at-rest 加密的威胁模型未写明 | 私钥 PEM 存 localStorage，用 IDB 主密钥 AES-GCM 加密（`enhance/index.ts:11-16` + `idb/index.ts:24-33`，主密钥 `extractable=true`） | 文档写清"防磁盘/备份窥探，不防 XSS"；考虑主密钥不可导出 |
| P3-5 | 文档漂移 | `apps/docs/.../frontend/base/axios.md:26,95` 写 `_autoEncryptRequestDataFields`（真实字段 `_autoEncryptRequestData`）且称"依赖 crypto-js"（实为 WebCrypto） | 顺手订正 |
| P3-6 | 注释漂移 | `session.service.ts:255` 写 "IKM: session root 密钥的前 2 字节"，实现是完整 hash buffer | 订正注释 |
| P3-7 | 错误屏提示仍写"Mongo 是空库" | `bootstrap.ts:191` | 改 Pg/或删掉具体存储名 |

---

## 4. 修复方案（分三档，按投入产出排序）

### 4.1 止血批（≤1 人日，建议立刻做）

1. **补 `await`**（P0-1）：`cache.rsa.ts:20` → `const cached = await this.cacheService.get<string>(…)`。
   连带把 `sign.guard.ts:102` / `sign.service.ts:36` 的注释与行为对齐（要么显式 40012，要么删掉那两行"校验"）。
   **收益**：恢复 40012 ⇒ 客户端既有恢复分支复活 ⇒ P0-2 从"白屏死循环"降级为"自动重登记后正常"。
2. **响应加密前置检查**（P2-3）：`rsa.service.ts:41` 之后显式判空，缺失抛 40012（而不是让 `publicEncrypt` 抛 TypeError → 50000）。
3. **错误屏加"重置本机密钥"**（P0-2 兜底）：清 `RSA_PUBLIC_KEY/RSA_PRIVATE_KEY` 后 reload（2 行 + 1 个按钮）。

### 4.2 系统化批（1 周内）

4. **公钥响应带元数据**（P2-1）：统一 `{keyId, version, algo: 'RSA-OAEP-SHA256', bits, publicKeyPem, expireAt}`，
   客户端按 `keyId` 缓存（现在是"取一次用一辈子"）；配套 openapi 零 diff 门禁。
5. **轮换语义收口**（P1-2）：读路径校验 `validEnd` 并给出受控语义；保留最多 N 个旧私钥可解（按 version 回退）；
   或实现 `rotateAfter`。
6. **错误码分层**（P2-2）：40112 + `meta.reason`；40113 语义订正；加密失败受控化。
7. **URL 掩码与 key 轮换解耦**（P1-3）：在掩码串前加 key 版本前缀，解密时按版本取 key（旧行保留期决定链接寿命）；
   或在文档里把"掩码链接 30 天有效"写成已知行为。

### 4.3 结构性批（需拍板）

8. **请求加密腿：删还是接**（P1-1）。删的话可连带删掉 `RSA_PAIR` 整个 key 类型 + 40011 + decrypt 拦截器；
   接的话必须先解决"签名在加密前算、服务端 guard 看到信封"的顺序问题（把签名改成对密文算，或把解密提到 guard 之前）。
9. **`RSA_PAIR` 私钥落库策略**：若保留，考虑加密存储（现在 PG jsonb 明文 PEM）；若不保留，随 8 一起删。

---

## 5. 与既有登记的关系（不要重复造轮子）

| 既有条目 | 出处 | 本轮关系 |
|---------|------|---------|
| **P2-30** 轮换无重叠窗口 + current 不校验 validEnd | `apps/server/apps/api/test/api/DESIGN-ISSUES.md:145-160` | **复核成立**，但影响面需重估：请求解密腿已死 ⇒ "旧密文不可解"不会发生；真实影响是客户端内存缓存与 URL 掩码。建议把 P2-30 从"backlog 观察"提为 P1，并改写影响段 |
| **P0-6** HTTP 永不下发 RSA 私钥 | `key.service.ts:64-68`、`key.dto.ts:25-27`、`rsa.ports.ts:12-13` | **确认已修且有效**（我逐层看过投影与 DTO） |
| **P0-2** 双因子派生失败不降级单因子 | `sign.guard.ts:381-390` | **确认有效**（这是本链路最扎实的一处加固） |
| **P2-11** nonce 原子 `SET NX EX` | `cache.sign.ts:40-47` | **确认有效**（TTL 5min = 时间戳窗口） |
| **F-06** 签名/原文不入日志 | `sign.guard.ts:163-168, 404-406` | **确认有效**（摘要 8 hex） |
| `ENDPOINTS.md:525` 已记「已登录 + 派生失败 → 40112」 | `apps/server/apps/api/test/api/ENDPOINTS.md:525` | 与本轮 40112 语义过载的结论一致，可作为回归基线 |

> 与 P2-30 的差别一句话：**它假设"旧公钥密文还在路上"，我认为那批密文根本不存在（没人加密过请求），
> 真正被轮换伤到的是客户端缓存与可分享的掩码 URL。**

---

## 需要 Lead 拍板

> 下面 7 条都**不是"我还没查清"**（事实与证据都在正文），而是产品/架构取舍。
> 每条给选项 + 我的推荐 + 理由；推荐可以否，但请连着"代价"一起看。

**Q1 请求体加密那条腿：删掉，还是真接上？**
- A：**删**。连带删 `RSA_PAIR` key 类型、40011、decrypt 拦截器、客户端 40011 恢复分支，文档改成"明文 + 签名 + TLS"。
- B：**接上**。先重构顺序（签名改对密文算，或解密前移到 guard 之前），再补端到端用例与轮换 grace。
- C：保留代码但显式标注"未启用"（类注释 + 文档 + 一条 lint/测试断言"无设置点"）。
- **推荐 A**。理由：这条腿从来没跑过（0 调用点），而它带来的复杂度是"服务端私钥落库 + 30 天轮换 + 两套错误码 + 一段顺序埋雷"。
  若确实要"请求体保密"，B 的成本是 M/L 且必须先解决顺序问题。C 是最差解：留着一颗"打开就全量 40112"的雷。

**Q2 `RSA_PAIR` 私钥继续明文存 PG jsonb？**
- A：随 Q1-A 一起删（不再有服务端私钥）。
- B：保留但加密存储（用已有的 `MFA_ENCRYPTION_KEY` 一类 env 密钥做 at-rest 加密）。
- C：保持现状（明文 jsonb），只在文档标注"库里是密钥材料，库即信任边界"。
- **推荐 A**（若 Q1 选 A）；若 Q1 选 B，则 B 必须做。理由：现在这把私钥**没有任何生产读取路径**，却每天占着"落库即泄露面"。

**Q3 `AES_KEY_URL` 轮换 vs 掩码 URL 的寿命（P1-3）？**
- A：掩码串里带 key 版本（`v1:base64...`），解密时按版本回退取旧 key，旧行保留 N 天 ⇒ **链接寿命可控**。
- B：把掩码 key 与 `AES_KEY_URL` 解耦（单独一把不参与轮换的 key）⇒ 简单，但"永久密钥"本身又是负担。
- C：接受"掩码链接 30 天后失效"，写进文档与 notFound 提示（提示"链接已过期"而不是 404）。
- **推荐 A**（若只想花小成本则 C）。理由：A 把"链接寿命"变成显式旋钮（旧行保留期），B 引入了永不轮换的密钥，
  C 最省事但会让用户困惑（现在是静默 404，至少该改成"链接已过期"）。

**Q4 轮换宽限期（P1-2 / P2-30）？**
- A：不加 grace，只把"到期未轮换"窗口收掉（读路径校验 `validEnd`，过期即触发轮换或受控错误）—— 因为解密腿已死，grace 没有消费方。
- B：加"保留最近 N 个旧私钥可解"的通用机制（为将来真接上请求加密留路）。
- C：维持现状，把 P2-30 留在 backlog。
- **推荐 A**。理由：grace 的唯一消费者是请求解密（已死）。真正该修的是"`validEnd` 过了还在用"这个静默窗口；
  等 Q1 定案后再决定 B 是否值得做。

**Q5 公钥响应加元数据（P2-1）？**
- A：加 `{keyId, version, algo, bits, publicKeyPem, expireAt}` 并让客户端按 `keyId` 缓存/失效（契约改动 + openapi 零 diff）。
- B：只加字段不改缓存策略（客户端仍"取一次用一辈子"）⇒ 收益只有可观测性。
- C：不改，等 Q1 定案（若删 RSA_PAIR，这条自动消失）。
- **推荐 C → 视 Q1**。理由：如果 Q1 选 A（删请求加密），服务端公钥就没有消费方，加元数据是给死接口化妆；
  若 Q1 选 B，则必须做 A。

**Q6 客户端"服务端丢公钥"的恢复入口（P0-2）？**
- A：修 40012 后**自动恢复**（客户端已有 `SingletonPromiseRsaPubKeyNotFound`），再加错误屏"重置本机密钥"按钮兜底。
- B：只做自动恢复（不加按钮）。
- C：只加按钮 + 文档（不动 40012 死码）。
- **推荐 A**。理由：A 的第一半是一行修（P0-1），第二半是 20 行 UI；C 等于让用户自己去开 DevTools 清 localStorage。

**Q7 40112 拆码（P2-2）？**
- A：保持 40112，加 `meta.reason`（`missing_header/timestamp/nonce/ticket/signature/session`）—— 契约变更最小。
- B：拆成 4012x 子码族 —— 语义最清晰，但涉及 contract 快照 + 前端分支 + 文档。
- C：不动（排障靠服务端日志）。
- **推荐 A**。理由：客户端当前唯一的差异化行为是"重取 AES key"，而 A 已经足够支撑；
  B 的收益主要在外部集成方，本仓没有这样的消费方。

---

## 附：可复跑的核对命令

```bash
# 1) 死路径：请求体加密 0 个设置点 / 请求解密 0 个使用点
git grep -n "_autoEncryptRequestData" -- apps packages
git grep -n "WalnutAdminDecoratorDecryptRequest" -- apps packages

# 2) P0-1 的静态证据（异步 get + 无 await）
sed -n '18,27p' apps/server/libs/cache/src/service/cache.rsa.ts
sed -n '182,183p' apps/server/libs/cache/src/cache.service.ts

# 3) P0-1 的语义复现（输出 RESOLVED with: null）
node -e "const {isNil}=require('lodash'); async function cacheGet(){return null} async function f(){const c=cacheGet(); if(isNil(c))throw new Error('40012'); return c} (async()=>{try{console.log('RESOLVED with:', await f())}catch(e){console.log('THREW:', e.message)}})()"

# 4) 轮换：只按 status/version 取行，不看 validEnd
sed -n '38,53p' apps/server/libs/app-domain/src/key/key.basic.repository.ts
git grep -n "rotateAfter" -- apps/server

# 5) 40112 的 6 个抛点
git grep -n "WalnutAdminExceptionInvalidSignature" -- apps/server/libs/guards/src/guards/sign.guard.ts
```
