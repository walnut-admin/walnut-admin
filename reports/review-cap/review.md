# I2 · CAP 人机校验 review（token 生命周期 / 双阶段判定 / skip 面 / 失败路径）

> **任务**：task-2（I2）｜**基线**：HEAD `bb2ee648`（工作树 clean）｜**只读轮**：未改任何源码
> **范围**：`libs/guards/src/guards/cap.guard.ts`、`libs/security/src/cap/**`、`libs/cache/src/service/cache.cap.ts`、
> `libs/security/src/risk/**`（推荐决策来源）、`apps/api/src/app/app.module.ts`（两次注册）、
> `apps/api/src/modules/security/cap/cap.controller.ts`、`apps/admin/src/{components/Global/Cap,store/modules/component/comp-capjs.ts,utils/axios/interceptors/response/*}`
> **观测口径**（按 Lead 要求）：全局异常过滤器**永远回 HTTP 200**；校验拒绝是 `body.code = 40116/40117`，
> 崩溃/未捕获异常是 `body.code = 50000`。**本文所有判断都按 body.code，不看 HTTP 状态码。**

---

## 0. 结论速览

| # | 判定 | 一句话 |
|---|------|--------|
| 1 | **P1** | `ttl` 这一个配置项被**三处按三种单位**消费（毫秒 / 秒 / 毫秒）——**不存在任何一个取值能让三处同时正确**；种子值与代码默认值还差 1000 倍 |
| 2 | **P1** | cap.js 的 token **实际寿命硬编码 20 分钟**（第三方库内），与 `ttl`、cookie `maxAge`、校验缓存**全都不一致**；命中缓存时等于放行一个 cap.js 已判过期的 token |
| 3 | **P1** | token 存储是**单机文件** `.data/tokensList.json` ⇒ 多副本部署下「A 签发、B 校验」必失败；只读根文件系统时 redeem 直接炸 |
| 4 | **P2** | 伪造 `CAPJS_TOKEN=s:xxx`（带 `s:` 前缀但签名错）会走到 `createHash().update(false)` ⇒ **抛 TypeError ⇒ 500（50000）**，而不是 40116/40117 |
| 5 | **P2** | 前端 40117 分支**无重试上限**：refresh 失败返回 `''` 后仍重试原请求 ⇒ 失败循环，最终被 CAP 自己的 4/60s 限流打到 `42900` ⇒ **被跳到 /not-allowed 页** |
| 6 | **P2** | 40111（判定为机器人）是**死码**：guard 内部 throw 被自身 catch 吞掉（已知 P3-31），其前端分支同样不可达 —— "机器人"这个语义实际不存在 |
| 7 | **P2** | 一次请求可能**连弹两次 CAP**（认证前因子 + 认证后因子是两套 critical 集合，各自独立挑战） |
| 8 | Q6 答案 | **Redis 挂 ⇒ fail-open**（risk guard 降级放行 ⇒ 无 recommendation ⇒ CAP 直接 return true）；**cap.js 存储坏 ⇒ fail-close**（40116/40117 + 前端循环）。两种故障两种口径 |

---

## 1. token 的完整生命周期（Q1）

`@cap.js/server@4.0.5` + 本仓封装的真实链路（四段 TTL 彼此不一致，已在 §2 的表里逐一对齐）：

`%%%%%%%
POST /security/cap/challenge           POST /security/cap/redeem                   任意受保护请求
        │                                      │                                        │
        ├─ AppCapJS.createChallenge({          ├─ AppCapJS.redeemChallenge(solutions)   ├─ CAP guard 读 cookie
        │    count,size,difficulty,            │   · 校验 PoW                          │   ├─ 无 cookie → 40116/40117
        │    expiresMs: ttl })   ← ttl 当 ms   │   · 通过 ⇒ 生成 token 并**落盘**       │   ├─ 有 cookie ⇒ 先查 Redis 缓存
        │  challenge 有效期 = ttl（见 P1-1）    │   · **token 寿命硬编码 20min**         │   │   命中 → 放行（不再问 cap.js）
        │                                      │   · Set-Cookie CAPJS_TOKEN            │   └─ 未命中 ⇒ 分布式锁 + 真验
        ▼                                      │     maxAge = ttl * 1000  ← ttl 当秒    │        · cap.js validateToken
   PoW 求解（浏览器）                          ▼                                        │          **成功即删除 token**（一次性）
                                        浏览器持有 cookie                              │        · 成功 ⇒ 写缓存 ttl/1000 ← 当 ms
                                                                                        ▼        · 失败 ⇒ 40116 / 40117
`%%%%%%%

**四段 TTL 的真身**（这是本轮最硬的证据）：

| 段 | 取值来源 | 单位解读 | 默认配置下 | 种子配置下 |
|----|---------|---------|-----------|-----------|
| challenge 有效期 | `cap.service.ts:27` `expiresMs: config.ttl` | **毫秒** | 1 小时 | **3.6 秒** |
| token 本体寿命 | `@cap.js/server` `index.js:343` `Date.now() + 20*60*1000` | 毫秒（硬编码） | 20 分钟 | 20 分钟 |
| cookie `maxAge` | `cap.service.ts:36` `maxAge: config.ttl * 1000` | **秒** | **41.7 天** | 1 小时 |
| 校验缓存 TTL | `cache.cap.ts:39` `Math.ceil(config.ttl / 1000)` | **毫秒** | 1 小时 | **4 秒** |

> 默认配置 = `cache.appSettings.ts:132` 的 `ttl: 60 * 60 * 1000`（毫秒）；
> 种子配置 = `apps/server/db/seed/app_setting.json:46` 的 `"ttl":3600`（秒）。
> 两者都自称"1 小时"，但传进同一份代码后行为完全不同。

### 过期后的行为（按 body.code）

| 触发 | 后端口径 | 前端动作 |
|------|---------|---------|
| 无 `CAPJS_TOKEN` 且 `shouldChallenge=true` | 40116 | 打开 CAP 弹窗（需用户交互）→ 成功后重放原请求 |
| 无 token 且 `shouldChallenge=false` | 40117 | 无感 refresh（后台解一次 PoW）→ 重放 |
| token 存在但 cap.js 判无效（已消费 / 过期 / 非本机签发） | 同上 40116 / 40117 | 同上 |
| 缓存命中 | 直接放行，**不问 cap.js** | — |

---

## 2. 认证前 vs 认证后两次 CAP 的差异（Q2）

两次注册在 `apps/api/src/app/app.module.ts:99-103`（认证前）与 `:115-119`（认证后），**同一个类**，
逻辑完全一样（`cap.guard.ts:44-46` 自述"pre/post 校验逻辑完全一致"）。差异**全部来自上游 Risk Guard**：

| 维度 | 认证前 CAP | 认证后 CAP |
|------|-----------|-----------|
| 读谁的结果 | 第一个 `WalnutAdminGuardRisk`（`:95-98`） | 第二个 `WalnutAdminGuardRisk`（`:111-114`） |
| 因子来源 | `preAuth.device.factors + preAuth.location.factors`（`risk.service.ts:261`） | `postAuth.userDevice.factors`（`risk.service.ts:266`，`userId` 为空直接返回 `[]`） |
| critical 集合 | `PRE_AUTH_CRITICAL_FACTORS`（`risk.config.service.ts:208-214`）：`DEVICE_NEW / DEVICE_RECENT / DEVICE_PRIVATE / LOCATION_*` | `POST_AUTH_CRITICAL_FACTORS`（`:216-222`）：`USER_DEVICE_UNTRUSTED / USER_DEVICE_TRUST_EXPIRED / USER_DEVICE_LOCKED` |
| 分数阈值（共用） | `CRITICAL ≥ 0.8 / HIGH ≥ 0.6 ⇒ shouldChallenge=true`；`MEDIUM ≥ 0.3` 只记录（`risk.config.service.ts:226-246`） | 同左 |
| 挑战状态键 | `risk:challenge:device:<deviceId>` 等（`challenge.service.ts:24-30`） | 含 `userId` 的 `user-device / user / ip / location 键 |

**两处值得注意**：
- 阈值与"是否挑战"的最终判定在 **Risk**，CAP 只执行；风险层已按 P1-13 口径**不再阻塞**（`risk.service.ts:219-221`），
  所以 CAP 是**唯一**的拒绝腿。
- 两套 critical 集合**不重叠** ⇒ 同一次请求可能被判两次挑战（见 P2-5）。

---

## 3. skip 面：`CapFree` 的 8 个使用点（Q3）

装饰器在 `cap.guard.ts:23-30`；判定在 `:73-81`（`getAllAndOverride` 同时看 handler 与 class）。
另有两条**非装饰器**的旁路：`request.isPostman`（`:68-71`，生产恒 false）与 `recommendation === undefined`（`:89-92`，见 §6）。

| # | 位置 | 范围 | 是否必要 | 是否有效（真的跳过了吗） | 判定 |
|---|------|------|---------|------------------|------|
| 1 | `cap.controller.ts:69` | 类级（challenge + redeem） | **必要**：拿 CAP token 的入口自己不能要 CAP token | 有效（两个方法都免） | 合理 |
| 2 | `rsa.controller.ts:17` | 方法（取 RSA 公钥） | **必要**：请求加密的前置，客户端还没有任何凭据 | 有效 | 合理 |
| 3 | `sign.controller.ts:32` | 类级（签名会话 / AES key） | **必要**：Sign Guard 在 CAP 之后（`app.module.ts:127-131`），签名握手必须先完成才能过后续 guard | 有效 | 合理 |
| 4 | `device.controller.ts:56` | 方法（`POST /system/device/initial`） | **必要**：新设备在这一步才拿到 `DEVICE_ID`，而 CAP 缓存键与因子都依赖它 | 有效 | 合理（但见 P3-2：缺 deviceId 时缓存键退化） |
| 5 | `lang.controller.ts:91` | 方法（`GET /system/lang/list/public`） | **存疑**：公开只读、低敏；但**此时已有 deviceId**，不 skip 也能挑战 | 有效 | 可保留（弱理由：登录页要先取语言包） |
| 6 | `locale.controller.ts:161` | 方法（locale 公共列表） | **存疑**：同上 | 有效 | 可保留 |
| 7 | `setting.controller.ts:56` | 方法（公共设置） | **存疑**：同上 | 有效 | 可保留 |
| 8 | `monitor/user/user.controller.ts:135` | 方法（在线用户上报） | **存疑**：这是**写接口**（上报在线状态），且已在认证后（有 userId/JWT） | 有效 | **建议复核**：写接口跳过 CAP 的理由应写明 |

**结论**：前 4 个是结构性的"先有鸡还是先有蛋"，必须 skip；后 4 个是"公开读接口 + 写上报"，
skip 不是错，但**没有一处写了理由**（装饰器无注释），建议逐条补一句判据，否则下一轮无法区分"必要 skip"与"顺手 skip"。

> 补充：`CapFree` 只短路 CAP 这一层；这些端点仍受 IP/Security/Device/Risk/JWT/Sign/Throttle 约束（`ENDPOINTS.md:130` 有对照表）。

---

## 4. 失败路径：后端 code 与前端再唤起是否一致（Q4）

| 后端 code | 后端语义 | 前端动作（`interceptor.ts`） | 一致？ |
|-----------|---------|------------------------------|--------|
| 40116 | 需要用户交互（`cap.guard.ts:111/132`） | `:49-52` 打开 CAP 弹窗 → 成功后重放 | ✅ |
| 40117 | 无需交互，静默刷新（`:115/135`） | `:56-59` 后台解 PoW → 重放 | ✅ 语义一致，但**失败后无上限**（P2-2） |
| 40111 | 判定为机器人（`cap.guard.ts:214`） | `:95` 映射到 not-allowed?`type=capjsTokenInvalid` | ❌ **后端永不发出该码**（死码，P2-4） ⇒ 前端这条分支也永远不会触发 |
| 50000 | 未捕获异常 | `:144` 走 `useAppMsgError` 提示 | 一致（但见 P2-1：畸形 cookie 会走这条） |
| 42900 | 限流（CAP 桶 4/60s） | `:105/108` **跳转 /not-allowed 页** | ⚠️ 用户在解 CAP 时被限流 → 直接被踢到错误页（P2-2 的终点） |

**"连续失败会不会锁死"**：不会"锁死"（没有账号级锁定），但会形成三种恶性循环：
1. 40117 → refresh 失败（返回 `''`）→ 重放 → 40117 …（**无计数上限**，靠 4/60s 限流才刹住）；
2. 40116 弹窗在异常路径（组件卸载 / 登出 / 路由切换）下 **Promise 永不 settle**（`comp-capjs.ts:71-86` 只有 onSuccess 能 resolve；`onCloseCapModal` 只清状态）⇒ 原请求悬挂 + `capJSInteractionQueue` 永久占位（后续 40116 全部排队等待）；
3. 种子配置下（§2 表）缓存只有 4 秒 ⇒ 正常用户也会持续触发 40117，把循环 1 常态化。

---

## 5. token 能否被重放 / 共用（Q5）

**分三层看，答案不同**：

| 层 | 是否一次性 | 证据 |
|----|-----------|------|
| cap.js 库层 | **一次性**（校验成功即从存储删除） | `@cap.js/server` `index.js:427-433`（`_deleteToken`）；`ENDPOINTS.md:263` 亦记载 |
| 本仓 CAP guard 层 | **可重放**，窗口 = Redis 缓存 TTL | `cap.guard.ts:162-167`（命中缓存直接 true，不再问 cap.js）；`cache.cap.ts:35-45` |
| 跨设备 | **不可**（缓存键掺 token 指纹 + deviceId） | `cache.cap.ts:23`；HTTP 用例 `guard-matrix.api-spec.ts:549-564`（移植另一台设备的 cookie → 40117） |

所以准确表述是：**"cap.js token 一次性"只在缓存失效后才生效**；缓存有效期内，**同一 token 可以被任意多次请求复用**，而且
这个窗口（`ttl`）与 token 自身寿命（20 分钟）**不挂钩** —— 默认配置下缓存 1 小时 > token 20 分钟，
即**缓存期内放行的是 cap.js 已经不认的 token**。

另有一条不绑定维度：缓存键只有 `deviceId + token 指纹`，**不含 IP / UA**（`cache.cap.ts:23`）。
cookie 是 `httpOnly + secure + signed`（`cookie.service.ts:12-60`），所以"拿到 cookie"本身已等价于"拿到设备"；
但生产环境 `sameSite: 'none' + __Secure-` 前缀（`cookie.service.ts:25-35`、`const/src/app/cookie.ts:5-15`）
意味着该 cookie 会随跨站请求发出，配合 1 小时的重放窗口，暴露面比 `__Host-` 大（P3）。

---

## 6. Redis 不可用时的降级（Q6）：**两种故障、两种口径**

**结论：CAP 自己不做 fail-open/fail-close 的决策 —— 它跟着上游客风险评估的口径走。**

| 故障点 | 链路 | 结果 |
|--------|------|------|
| **Redis（整挂 / 连不上）** | `risk.guard.ts:141-151`：非 HttpException ⇒ log + `return true`（**不写 request.risk**）→ `cap.guard.ts:87-92` 读到 `recommendation === undefined` ⇒ `return true` | **fail-open（CAP 被整体跳过）** |
| Redis 只挂「CAP 缓存」这一个 key 的读写 | `cache.service.ts:197-200` 的 `get` 把异常吞成 `null`（= 缓存未命中）→ 继续走 `runWithLock` → murlock 也用 Redis ⇒ 抛错 → `cap.guard.ts:197-200` **rethrow** ⇒ 500（50000） | **fail-close（500）** |
| **cap.js 文件存储坏**（只读 FS / 磁盘满 / 文件损坏） | `cap.guard.ts:223-226` `catch ⇒ return false` ⇒ 40116/40117 | **fail-close（但语义伪装成"你的 token 无效"）** |
| cap.js 判 token 无效（正常业务路径） | 同上 | 40116/40117（正确语义） |

**这条最值得改**：`performCapVerification` 的 catch（`:223-226`）把「基础设施异常」和「真的验不过」**压成同一个 `false`**，
于是磁盘/文件故障表现为"用户是机器人/需要重新验证"，用户重试只会再撞一次，运维也看不到 500。

---

## 7. 问题清单（P0–P3）

### CAP-1【P1】`ttl` 的单位三方不一致 —— 没有取值能让三处同时正确

- **证据**：
  - `libs/security/src/cap/cap.service.ts:27` `expiresMs: config.ttl`（cap.js 要毫秒）
  - `libs/security/src/cap/cap.service.ts:36` `maxAge: config.ttl * 1000`（Express `maxAge` 要毫秒 ⇒ 这里把 ttl 当**秒**）
  - `libs/cache/src/service/cache.cap.ts:39` `Math.ceil(config.ttl / 1000)`（缓存 `set` 要秒 ⇒ 这里把 ttl 当**毫秒**）
  - 默认值 `libs/cache/src/service/cache.appSettings.ts:132` `ttl: 60*60*1000` vs 种子 `apps/server/db/seed/app_setting.json:46` `"ttl":3600`
- **影响**（两种部署各错一半，见 §1 表）：
  - **种子部署**（`pnpm db:seed:pg` 后的默认形态）：challenge **3.6 秒**过期（移动端 PoW 常解不完）+ 校验缓存 **4 秒**
    ⇒ 只要请求间隔 > 4 秒就要重验，而 cap.js 的 token 已被单次消费 ⇒ **40117 风暴**（前端每次多打 2 个 CAP 请求）；
  - **空表/未种子部署**：cookie `maxAge` = **41.7 天**（远超 token 的 20 分钟），浏览器会长期携带一个必然无效的凭据。
- **修法**：把 `ttl` 的语义**钉成秒**并统一三处：`expiresMs: ttl*1000`、`maxAge: ttl*1000`（保持）、缓存 `ttl: ttl`；
  同步把种子与代码默认值都改成 `3600`；补一个单测同时断言三处换算（现有 `cap.guard.spec.ts` 不覆盖单位）。
  **工作量 S**（约 0.5 人日，含 1 条新单测）。

### CAP-2【P1】cap.js token 真实寿命 20 分钟（第三方硬编码），与配置/cookie/缓存都不一致

- **证据**：`node_modules/.pnpm/@cap.js+server@4.0.5/.../index.js:343` `const expires = Date.now() + 20 * 60 * 1000`
  （`redeemChallenge` 里，与传入的 `expiresMs` **无关** —— 后者只作用于 challenge 本身，见 `:279`）。
- **影响**：缓存 TTL（默认 1 小时）**长于** token 寿命 ⇒ 在 20~60 分钟这段区间里，**缓存命中即放行一个 cap.js 已判过期的 token**；
  安全窗口的实际长度由"Redis 缓存 TTL"决定，而不是由 token 决定。反过来，缓存一失效（逐出/重启）⇒ 20 分钟后的旧 token 必然验不过 ⇒ 40116/40117。
- **修法**：缓存 TTL 取 `min(config.ttl, 20*60)`（并把 20 分钟写成命名常量 + 注释指向 cap.js 源码行）；
  或在 redeem 时把 cap.js 返回的 `expires` 一并存进缓存值，读取时先比对。
  **工作量 S**。

### CAP-3【P1】token 存储是单机文件，多副本/只读 FS 必坏

- **证据**：`cap.service.ts:7-9` `new Cap({ tokens_store_path: '.data/tokensList.json' })`；
  cap.js `index.js:348-362`（无 `storage.tokens.store` 时写文件）、`:373-386`（`_getToken` 读文件）、
  `:387-401`（`_deleteToken` 写文件）；`.gitignore:51-53` 把这个目录忽略掉（说明现状就是本地文件）。
- **影响**：① 多副本部署：副本 A 签发的 token 在副本 B 的文件里不存在 ⇒ **校验必失败 ⇒ 40116/40117 风暴**（与 CAP-1 的种子问题叠加时更明显）；
  ② 容器根文件系统只读 / 无持久卷 ⇒ `redeemChallenge` 写文件抛错 ⇒ 用户永远拿不到 token；
  ③ 每次 redeem/validate 都是一次同步文件读写（`_lazyCleanup` 还会扫全表），高并发下是热点。
- **修法**：用 cap.js 的存储适配器把 token 存进 Redis（`storage: { tokens: { store, get, delete } }`
  本仓已有 `AppTechCacheService` 可直接实现），或**明确写死单实例**并在启动时加断言（`WORKER_STANDALONE` 类似开关）。
  **工作量 M**（接 Redis 约 0.5-1 人日；加断言 0.1 人日）。

### CAP-4【P2】伪造 `CAPJS_TOKEN=s:xxx` ⇒ 抛 TypeError ⇒ 500（50000），而非 40116/40117

- **证据**：
  - `cookie-parser@1.4.7/index.js:134-136`：值**不以 `s:` 开头** ⇒ 原样返回（不进 `signedCookies`，等于缺失）；
    而 `:150` 对**以 `s:` 开头但签名错**的值返回 **`false`**；
  - `libs/cookie/src/helpers.ts:8-15`：只 `return req.signedCookies[key]`，不做类型校验 ⇒ 拿到 `false`；
  - `cap.guard.ts:104` 只判 `isNil` ⇒ `false` 不算 nil ⇒ 继续；
  - `cache.cap.ts:28-30` `createHash('sha256').update(token,'utf8')` ⇒ 实测（`node -e `…``）
    `THREW ERR_INVALID_ARG_TYPE: The "data" argument must be of type string … Received type boolean`。
- **影响**：任意客户端只要发一条 `CAPJS_TOKEN=s:whatever` 就能让**该设备后续任一受保护请求**变成 500，
  污染监控告警、且与既有测试口径矛盾（`guard-matrix.api-spec.ts:223-238` 只测了"不带 `s:` 前缀"的伪造值）。
- **修法**：guard 里把"存在"判据改成 `typeof capToken === 'string' && capToken.length > 0`（一行）。
  **工作量 S**。

### CAP-5【P2】前端 40117 无重试上限 ⇒ 失败循环，终点是被限流踢到 /not-allowed

- **证据**：`interceptor.ts:56-59` 无条件 `return await AppAxios.request(res.config)`（无计数）；
  `comp-capjs.ts:56-59` refresh 失败 `return ''`（不抛，调用方无从知道失败）；
  `cap.controller.ts:73` + `throttler.guard.ts:34`（4 次/60s，按 `realIp`）⇒ 第 5 次 42900；
  `interceptor.ts:105-111` 把 42900 映射成 `not-allowed?type=tooManyRequests`。
- **影响**：CAP 服务不可用 / WASM 被 CSP 拦 / 种子配置导致缓存过短（CAP-1）时，每个请求都会触发 refresh→重放→再 40117 的循环；
  一次完整 CAP 流程 = challenge+redeem 2 个请求 ⇒ 约 3 次循环就撞限流，用户被**直接跳到错误页**（不是提示"稍后再试"）。
- **修法**：拦截器给每个原请求加 `_capRetried` 标记（最多 1 次），refresh 失败时 reject 并走可重试提示；
  42900 分流成"提示 + 稍后重试"而不是 not-allowed 页。**工作量 S**。

### CAP-6【P2】40111（判定为机器人）是死码 —— 后端永不发出，前端分支永不可达

- **证据**：`cap.guard.ts:214` `throw new WalnutAdminExceptionYouAreBot()` 在 `try` 内，
  `:223-226` 的 `catch` 把它吞掉并 `return false` ⇒ 调用处只能见到 40116/40117；
  单测自己钉死了这个现状：`cap.guard.spec.ts:100-109`（断言"不是 YouAreBot"）；
  文档亦登记为 P3-31：`apps/docs/src/zh-CN/content/backend/modules/security.md:238-239`。
  前端对应分支 `interceptor.ts:95`（`capjsTokenInvalid`）因此永不触发。
- **影响**：guard 头注释 `cap.guard.ts:37-40` 宣称"三种错误语义"，实际只有两种；"机器人判定"这个能力**不存在**；
  同时 `catch` 把基础设施异常也压成 false（见 §6），两层语义糊在一起。
- **修法**：二选一 —— (a) 让 `performCapVerification` 区分「cap.js 返回 success:false」（rethrow 40111）与「调用抛异常」（转 40116/40117 或 500）；
  (b) 承认只有两态：删 40111 常量、前端分支与文档措辞。**推荐 (a)**，因为"真验失败"与"设施故障"的客户端动作不同。
  **工作量 S/M**。

### CAP-7【P2】同一次请求可能连弹两次 CAP（pre + post 各一次）

- **证据**：`app.module.ts:99-103` 与 `:115-119` 同一类注册两次；`risk.config.service.ts:208-222` 两套 critical 集合互不重叠
  （pre：`DEVICE_NEW` / `DEVICE_RECENT` / `DEVICE_PRIVATE` / `LOCATION_*`；post：`USER_DEVICE_*`）。
- **影响**：新设备 + 未信任设备首次登录后的第一个请求：pre 通过（用户解完第一次）→ post 又判 `USER_DEVICE_UNTRUSTED` 未处理 ⇒ 再 40116 ⇒ 第二次弹窗。
  用户体感是"验证码弹两次"，且两次之间有完整网络往返。
- **修法**：认证后阶段复用 pre 的结果——若 post 的 critical 因子集合与 pre 相同（或该请求内已标记过），不再挑战；
  或前端把连续的 40116 合并成一次交互（弹窗保持打开直到两次都通过）。**工作量 M**。

### CAP-8【P3】每个请求都重写一次 challenge 状态（Redis 写放大）

- **证据**：`cap.guard.ts:139` 在**缓存命中**时也调用 `markCriticalFactorsAsHandled`；
  `challenge.service.ts:55-60` 每次都 `setEx`（TTL 24 小时）。
- **影响**：被挑战过的设备，其**每个请求**都产生 N 次 Redis 写（N = critical 因子数），只为把过期时间往后推 —— 语义上也不是"刷新"，是"重写"。
- **修法**：仅在"本次请求真正做了验证"（缓存未命中且 cap.js 通过）后标记；或先 `exists` 再决定是否写。**工作量 S**。

### CAP-9【P3】`deviceId` 缺失时缓存键退化为字符串 `undefined`

- **证据**：`cap.guard.ts:118-121` 取 `DEVICE_ID` 不判空；`cache.cap.ts:23` 直接拼进键 ⇒ `SECURITY_CAP_TOKEN:undefined:<fp>`。
- **影响**：理论上所有"无 deviceId 的客户端"共享同一个键前缀（仍按 token 指纹区分，不构成直接越权，但键空间语义已失真）；
  `markChallengeHandled` 也会带着 `undefined` 去拼 `risk:challenge:device:undefined`。
- **修法**：`deviceId` 为空时直接按"缺凭据"处理（40116/40117），不进缓存分支。**工作量 S**。

### CAP-10【P3】challenge / redeem 共用一个 4/60s 的 IP 桶；一次完整流程就吃掉 2 发

- **证据**：`cap.controller.ts:73`（**类级**装饰器，两个方法共享）+ `cap.service.ts:34-35` 的 `config.throttleLimit/throttleTtl`（默认 4 / 60s）
  + `throttler.guard.ts:34-36`（tracker = `realIp`）。
- **影响**：同一 NAT 后的多个用户共享 4 次/分钟额度；单用户每分钟最多约 2 次完整 CAP 尝试，重试即撞 42900（→ 见 CAP-5 的错误页）。
- **修法**：challenge/redeem 拆成两个桶，或把 tracker 换成 `deviceId`（challenge 阶段 deviceId 已存在）。**工作量 S**。

### CAP-11【P3】文档与实现不一致（`maxAge` 的单位）

- **证据**：`apps/docs/src/zh-CN/content/shared/capjs.md:164` 写 `设置 capToken 到 Cookie（maxAge: ttl）`，
  实现是 `maxAge: config.ttl * 1000`（`cap.service.ts:36`）。
- **修法**：随 CAP-1 一起改（把权威语义只写一处：`IWalnutAdminConstAppSettingCapJSKeys.ttl` 的注释）。**工作量 S**。

### CAP-12【P3】生产环境 CAP cookie 是 `__Secure-` + `SameSite=None`（会随跨站请求发出）

- **证据**：`libs/const/src/app/cookie.ts:5-15`（prod ⇒ `__Secure-`，dev ⇒ `__Host-`，stage ⇒ 无前缀）；
  `cookie.service.ts:25-35`（prod `sameSite:'none'` + `domain:.``）。
- **影响**：`__Host-` 比 `__Secure-` 更严（禁止 Domain），而 prod 用的是更宽松的那个 + `SameSite=None`；
  配合 CAP-2 的重放窗口，凭据暴露面比理论值大。（`Domain` 是 OAuth 回跳需要，属有意权衡，故只列 P3。）
- **修法**：若 OAuth 回跳不依赖该 cookie，prod 改回 `__Host-` + `SameSite=Lax`；否则在代码里写明"这条 cookie 必须放宽"的理由。**工作量 S**。

---

## 8. 需要 Lead 拍板

### Q-1 `ttl` 的权威单位定为「秒」还是「毫秒」？

背景：三种消费方现在各按各的理解（CAP-1），种子与代码默认值也差 1000 倍。无论选哪个，**都要改代码 + 种子 + 文档**。

| 选项 | 内容 | 优点 | 缺点 |
|------|------|------|------|
| (a) **秒** | `IWalnutAdminConstAppSettingCapJSKeys.ttl` 注释为秒；`expiresMs: ttl*1000`；缓存 `ttl: ttl`；种子保持 3600 | 与后台设置表单/运维直觉一致（"1 小时" = 3600）；种子不用改 | 要改两处代码 + 一个单测 |
| (b) 毫秒 | 保持现有代码的 ms 口径，种子改 `3600000` | 代码改动最小（只改种子 + 注释） | 运维在后台看到 "3600000" 需要换算；JSON 里 7 位数易写错 |

**推荐 (a)**：单位取"人写的那一侧"，代码里显式 `* 1000` 是自解释的；且种子是**已发布的运维事实**，改代码比改数据安全。

### Q-2 校验缓存窗口以谁为准：配置 ttl，还是 cap.js 的 20 分钟？

| 选项 | 内容 | 优点 | 缺点 |
|------|------|------|------|
| (a) **取两者较小值** | 缓存 TTL = `min(ttl, 20min)` | 缓存永远不超出 token 真实寿命（CAP-2 消解） | 用户 20 分钟后必然要重新验证（即便 ttl 配 1 小时） |
| (b) 以 ttl 为准（现状） | 缓存 1 小时 | 用户体验最好（1 小时一次） | **缓存期内放行 cap.js 已过期的 token**；安全语义由缓存决定 |
| (c) 换 token 存储并延长 | 不能改：20 分钟是第三方硬编码 | — | 不可行（除非 fork 或换库） |

**推荐 (a)**，并把"20 分钟"写成一个具名常量 + 注释（指向 cap.js 源码行），否则下一个人还会以为 ttl 就是 token 寿命。

### Q-3 多副本：现在接 Redis 存储，还是先承诺单实例？

| 选项 | 内容 | 优点 | 缺点 |
|------|------|------|------|
| (a) **先单实例 + 启动断言** | 检测到多副本/未配置持久卷时启动失败或告警 | 0.1 人日；把"静默 40116 风暴"变成"起不来" | 限制部署形态 |
| (b) 接 Redis（cap.js storage adapter） | token 存 `AppTechCacheService` | 真正可水平扩展 | 0.5-1 人日；Redis 挂时 redeem 也会挂（但那时全站都挂） |
| (c) 保持现状 + 文档声明 | 只写进文档 | 零成本 | 现状已经在 `ENDPOINTS.md` 之外没有任何提示 |

**推荐 (a) 先做**（本轮止血），(b) 排进"上多副本前必须完成"的前置清单。

### Q-4 40111「判定为机器人」这个语义要不要保留？

| 选项 | 内容 | 优点 | 缺点 |
|------|------|------|------|
| (a) **保留并修好** | 真验失败（cap.js `success:false`）→ 40111；设施异常 → 40117/500 | 客户端能区分"你像机器人"与"系统出问题" | 需要前端加 40111 的交互（现分支只是跳 not-allowed） |
| (b) 删掉 | 删码值 + 前端分支 + 文档三处 | 面更小、语义只有两态 | 将来想细分又要加回来 |

**推荐 (a)**，理由：运维排障时"bot 判定"和"设施故障"是完全不同的动作，混成 40117 会让监控失去信号。

---

## 9. 复跑与证据命令

| 目的 | 命令 |
|------|------|
| 四段 TTL 的真身 | `grep -n "expiresMs\|maxAge" apps/server/libs/security/src/cap/cap.service.ts`；`grep -n "Math.ceil" apps/server/libs/cache/src/service/cache.cap.ts` |
| cap.js token 20 分钟 | `grep -n "20 \* 60 \* 1000" node_modules/.pnpm/@cap.js+server@4.0.5/node_modules/@cap.js/server/index.js` |
| 种子 vs 默认 ttl | `grep -n '"ttl"' apps/server/db/seed/app_setting.json`；`sed -n '128,136p' apps/server/libs/cache/src/service/cache.appSettings.ts` |
| 两次注册 | `grep -n "WalnutAdminGuardCap" apps/server/apps/api/src/app/app.module.ts` |
| 畸形 cookie 会 500（我实测的那一步） | `node -e "const{createHash}=require('node:crypto');try{createHash('sha256').update(false,'utf8')}catch(e){console.log(e.code)}"` ⇒ `ERR_INVALID_ARG_TYPE` |
| cap.js 丢弃 token（一次性） | `sed -n '427,434p' node_modules/.pnpm/@cap.js+server@4.0.5/node_modules/@cap.js/server/index.js` |
| 现有测试口径（不含畸形 `s:` 值） | `sed -n '223,238p' apps/server/apps/api/test/api/guard-matrix.api-spec.ts` |
| 降级口径 | `sed -n '141,151p' apps/server/libs/guards/src/guards/risk.guard.ts`；`sed -n '197,200p' apps/server/libs/cache/src/cache.service.ts` |

**没有做的事（说明）**：没有起真实服务跑 HTTP 断言（本轮只读、且需要一个已种子化的 PG + Redis）；
本文所有"运行时会怎样"的判断都建立在**代码逐行 + 第三方库源码**之上，凡涉及运行时行为处都给了可复跑的证据行号。
CAP-1 的种子影响、CAP-4 的 500，建议由下一轮（有环境的）用一条 HTTP 用例钉死。
