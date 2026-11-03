# B5 · 设备身份改为「服务端签发随机 deviceId」—— R1 方案设计

> 状态：R1（只读调研 + 方案）。本轮**未改任何源码**，未起服务（3000 端口未监听，见 §1.8 限制）。
> 基线：`d9f4233e`；本轮**开始时**工作树 clean（会话期间并行批次有其它文件改动，与本报告无关）。
> 前序定性见 [`reports/review-device/review.md`](../review-device/review.md) P0-2 / P1-1 / §8.2-8.4。

---

## 0. 结论摘要

**要做的**：把 `device_id` 从「客户端自报指纹的确定性函数」改成「服务端 `randomBytes(16)` 签发、带格式前缀的随机值」，指纹降级为 `fingerprint_hash` 风控特征；Guard 双读（legacy 64-hex / v2 `d1_` 前缀）、只写 v2；按需原地换发（`ON UPDATE CASCADE` 带走子表引用）。

**三条会改变范围的事实**（都已实测/读码确认，先说结论）：

| # | 事实 | 影响 |
|---|---|---|
| 1 | **B5 单独落地关不掉封禁绕过**。今天绕过 = 改指纹一个字符；改完后 = 清 cookie 匿名 `initial` 铸新随机 id，**成本几乎相同** | B5 真正买到的是「不能指定自己拿到**别人**的身份」（定向冒充 / OAuth SSE 劫持链断掉），不是「不能重新造一个身份」。要压封禁绕过**必须同批**上 `fingerprint_hash` 关联执法 |
| 2 | `uq_device_name` 唯一 + 前端 deviceName 由「设备类型_指纹前 6 位」拼成 | **B5 的必修连带改造**，否则同一浏览器清 localStorage 后第二次 initial 撞 23505 → 40000 → 该设备**永远注册不上**（生产事故级） |
| 3 | 签名握手的 RSA 公钥缓存以 `deviceId` 为键，且前端只在「本地没有密钥对」时才重新握手 | deviceId 轮换若不同步搬运缓存 ⇒ 客户端**永久 40012**，刷新治不好。这是本方案**最高技术风险** |

**工作量**：L1-L5 共 5 个可独立发布的步骤，≈4.5 人日（后端 3.5 / 前端 1），其中 L3 是唯一需要灰度与开关的一步。

---

## 1. 现状测绘

### 1.1 一条链（现状）

```
浏览器 FingerprintJS.hashComponents(组件)          admin/src/store/modules/app/app-fingerprint.ts:166-172
   ↓ localStorage APP_FINGERPRINT（持久化，纯客户端可改）    app-fingerprint.ts:130
请求头 X-Fingerprint                                admin/src/utils/axios/interceptors/request/interceptor.ts:21
   ↓
FingerprintMiddleware → req.fingerprint（原样，无校验）  apps/api/src/middleware/src/fingerprint.middleware.ts:10-11
   ↓
SysDeviceService.initial                            libs/system/src/device/device.service.ts:87
   ↓
SysDeviceRepositoryService.getDeviceIdByFingerprint libs/system/src/device/repo/device.repo.service.ts:41-43
   ↓
AppTechCryptoService.hashDeviceFingerprint          libs/crypto/src/crypto.service.ts:130-138
   = HMAC_SHA256(fingerprint, crypto.deviceIdKey)   libs/config/src/modules/crypto.config.ts:10 → DEVICE_ID_ENCRYPTION_KEY
   ↓
sys_device.device_id（64 hex, uq_device_id）+ 缓存 SYSTEM:DEVICE:<id>
   ↓
Set-Cookie DEVICE_ID=<deviceId>（signed, httpOnly, 30 天）  apps/api/src/modules/system/device/device.controller.ts:73-81
```

**这就是根因**：`deviceId` 的**唯一输入**是客户端可控的请求头，服务端没有任何独立熵参与（`crypto.service.ts:95-107` 的 `hash()` 只做 HMAC，无随机量）。

### 1.2 产生点（全仓仅 1 处生产调用）

| 位置 | 说明 |
|---|---|
| `libs/system/src/device/repo/device.repo.service.ts:41-43` | `getDeviceIdByFingerprint(visitorId)` → HMAC，**唯一派生入口** |
| `libs/crypto/src/crypto.service.ts:130-138` | `hashDeviceFingerprint`，salt = `crypto.deviceIdKey` |
| `libs/system/src/device/device.service.ts:87` | **唯一生产调用点**（`initial`） |
| 测试侧调用 | `apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts:120,171,245` |

### 1.3 存储点

**PG（实测列类型全为 `text`，无长度约束）**

| 表 | 列 | 引用强度 | 证据 |
|---|---|---|---|
| `sys_device` | `device_id` | 主业务键，`uq_device_id` UNIQUE | `entity/device.entity.ts:29-31`；InitSchema:213,237 |
| `sys_user_device` | `device_id` | **FK** → sys_device(device_id)，`ON DELETE CASCADE`；`uq_user_device(user_id,device_id)` | `identity/src/user_device/entity/user-device.entity.ts:23-25`；InitSchema:399,402 |
| `auth_refresh_token` | `device_id` | **FK** → sys_device(device_id)；另有部分唯一索引 `uq_rt_active_device_user(user_id,device_id) WHERE revoked=false` | `auth/src/modules/refresh/entity/refresh-token.entity.ts:8-19,32-34` |
| `sys_user_mfa` | `device_id` | **松引用**（无 FK，Q5 定案） | `identity/src/user_mfa/entity/user-mfa.entity.ts:6,27-29` |
| `app_monitor_user` | `device_id` | **松引用** | `app-domain/src/monitor/user/entity/monitor-user.entity.ts:9,28-30` |
| `log_auth` / `log_operate` | `device_id` | **松引用**（Q3：审计要比被引用对象活得久） | `system/src/logs/auth/entity/log-auth.entity.ts:8,56`；`.../operate/entity/log-operate.entity.ts:10,95` |

**Redis（按 deviceId 分键的族，实测存量见 §1.8）**

| 键形态 | 定义处 |
|---|---|
| `SYSTEM:DEVICE:<id>` | `cache/src/service/device.cache.ts:33` |
| `SYSTEM:DEVICE:COOKIE_RENEW:<id>` | `device.cache.ts:63-64` |
| `SECURITY:RSA:PUB_KEY:<id>` | `cache/src/service/cache.rsa.ts:15,46` |
| `SECURITY:SIGN:AES_KEY:<id>` | `cache/src/service/sign.cache.ts:28,33` |
| `SECURITY:SIGN:TICKET:<id>` | `sign.cache.ts:18,23` |
| `SECURITY:CAP_TOKEN:<id>:<tokenFp>` | `cache/src/service/cap.cache.ts:29` |
| `AUTH:SESSIONS:<userId>:<id>:<sid>` | `auth/src/modules/session/session.service.ts:83` |
| `AUTH:PERMISSIONS:<userId>:<id>` | `cache/src/service/permissions.cache.ts:17-18` |
| `AUTH:MFA:VERIFIED / :TOTP / :WEBAUTN :<userId>:<id>[:type]` | `cache/src/service/mfa.cache.ts:19,68,97` |
| `AUTH:OPAQUE_STATE:<userName>:<id>:<SERVER_STATE|SESSION_KEY>` | `cache/src/service/opaque.cache.ts:13,42` |
| `SECURITY:LOCK:<userId>:<id>` | `cache/src/service/cache.lock.ts:6-7` |
| `risk:device:<id>` / `risk:rate:device:<id>:<min>` / `risk:challenge:device:<id>:*` / `risk:user_device:<uid>:<id>` | `security/src/risk/modules/*.ts`（**注意：这族键不带 `WALNUT_CACHE_` 前缀**，实测） |

### 1.4 读取点（17 处，全部从同一枚 cookie 取）

| # | 位置 | 用途 |
|---|---|---|
| 1 | `guards/device.guard.ts:87` | 设备校验主体 |
| 2 | `guards/guards/auth.guard.ts:44` | 登录失败审计 |
| 3 | `guards/guards/risk.guard.ts:39` | 前/后置风控 |
| 4 | `guards/guards/cap.guard.ts:119` | CAP 缓存键 |
| 5 | `guards/guards/mfa.guard.ts:65` | MFA 临时验证缓存键 |
| 6 | `guards/guards/sign.guard.ts:186` | 签名链（RSA/AES/ticket） |
| 7 | `guards/guards/lock.guard.ts:67` | 用户锁（用 `getWalnutAdminCookieString`，把签名错的 `false` 归一成 undefined） |
| 8 | `guards/guards/sensitive.guard.ts:45` | 敏感操作授权键 |
| 9 | `guards/guards/permission.guard.ts:101` | 权限缓存键 |
| 10 | `guards/interceptors/response/encrypt.interceptor.ts:45` | 响应字段加密 |
| 11 | `guards/decorators/log.auth.decorator.ts:33` | 认证日志 |
| 12 | `guards/decorators/user.decorator.ts:20-24` | `@WalnutAdminDecoratorDeviceId()` 参数装饰器 |
| 13 | `auth/src/modules/jwt/jwt-access.strategy.ts:45-53` | **会话键** `(userId, deviceId, sid)`，miss ⇒ 40101 |
| 14 | `auth/src/modules/otp/otp.strategy.ts:55` | OTP |
| 15 | `auth/src/modules/oauth/{github,gitee}/{github,gitee}.strategy.ts:57` | OAuth state 绑定 |
| 16 | `crud/src/operate-log/operate-log.decorator.ts:118` | 操作日志 |
| 17 | `system/src/device/device.controller.ts:73` + `device.guard.ts:60-68` | 写 cookie（唯二写点） |

### 1.5 参与的计算（B5 会碰到的语义）

1. **会话绑定**：`AUTH:SESSIONS:<uid>:<deviceId>:<sid>` → AT 的 `sid` 与 cookie 的 deviceId 必须同源（`jwt-access.strategy.ts:45-53`）。**换 id = 会话失效**。
2. **签名链**：RSA 公钥 / AES key / sign ticket 三件套都以 deviceId 为键；`sign.guard.ts:103` 的 `getRsaPubKeyCache` 在 miss 时**抛 40012**（`cache.rsa.ts:18-30`）。
3. **限流与风控**：deviceId 是 `risk:rate:device:*` / `risk:device:*` 的键 ⇒ 换 id = 风控历史清零（这也正是「设备年龄」风控被绕的机制）。
4. **CAP**：`SECURITY:CAP_TOKEN:<deviceId>:<tokenFp>` ⇒ 跨设备移植 token 不命中（`cap.guard.ts:162`）。
5. **唯一性/幂等**：`uq_device_id` + `upsertByDeviceId`（`device.basic.repository.ts:39-53`）⇒ 同指纹重放 = 同一行。
6. **SSE 频道键**：OAuth SSE 用 deviceId 当频道键（review §8.4），`github.controller.ts:67-81`。
7. **管理端定位**：`sys_user_device` / 设备列表 / force-quit / lock / 改名的路由参数都是 deviceId，且被 `WalnutAdminPipeDeviceId` 以 `^[0-9a-f]{64}$` 强校验（`pipes/src/base/format.pipe.ts:43-51`）。

### 1.6 admin 侧指纹采集与存储

| 环节 | 位置 | 关键事实 |
|---|---|---|
| 采集 | `apps/admin/src/store/modules/app/app-fingerprint.ts:147-173` | FingerprintJS v3 组件哈希 + 3 个自定义组件（`storageSig` 含**会变的** `usage:<MB>`，:33） |
| 存储 | 同文件 `:130` `useAppStorageSync(APP_FINGERPRINT, '', enhancedBase64LocalStorage())` | 纯 localStorage（base64 混淆，非加密），清缓存即变 |
| 发送 | `utils/axios/interceptors/request/interceptor.ts:21` | 每请求都带 `X-Fingerprint` |
| deviceName 派生 | `app-fingerprint.ts:141-143` | 模板串「设备类型_指纹前 6 位」→ **把指纹前 6 hex 位写进一个 UNIQUE 列** |
| deviceId 缓存 | `store/modules/app/app-geo-ip.ts:11,41-47` | `GEO_IP_DEVICE_ID`；**有值就早退、永不 initial**（P0-1 的一半成因） |
| 自愈 | `utils/axios/interceptors/response/device.ts:20-25` + `app-geo-ip.ts:60-83` | 40605 → 清本地 → 重 initial（SingletonPromise 收敛） |
| socket | `socket/index.ts:63`、`apps/api/src/socket/socket.middleware.ts:73-75` | 握手也用指纹，**且缺指纹直接拒连** |

### 1.7 DEVICE_ID_ENCRYPTION_KEY 链路

`apps/server/env-local/.env.development`（`DEVICE_ID_ENCRYPTION_KEY`）→ `libs/config/src/modules/crypto.config.ts:10` `crypto.deviceIdKey` → `crypto.service.ts:133` → `crypto.hash(fingerprint, salt)` → `crypto.service.ts:103-106` `createHmac('sha256', salt)`。

**实测确认**：salt 是 env 字符串的**原始 UTF-8 字节**，不是 base64 解码后的 32 字节（见 §1.8-②）。
它被 `apps/server/AGENTS.md`「部署后不许改的 5 个」列入不可变 —— B5 后它的语义从「身份派生盐」降级为「风控特征盐」，**变量名不要动**（改名 = 踩部署红线），只改注释与用途。

### 1.8 实测（本机 PG 5432 / Redis 6379；端口 3000 **未监听**，故本轮无 HTTP 探针）

**① sys_device 形态**

```
rows=11  stale_rows=0  device_id min_len=64  max_len=64  distinct=11
sample: 5f8590ec22cf2368...  device_name=fixp1x-1479395916  banned=f locked=f stale=f active=t
```

⇒ 现存 100% 是 64-hex（HMAC 形态），无 v2 行，无 fingerprint_hash / id_kind 列。

**② device_id == HMAC_SHA256(visitor_id, DEVICE_ID_ENCRYPTION_KEY) —— 用库里真实行复算**

| visitor_id（= app_monitor_user.visitor_id，32 hex 原生指纹） | 库里 sys_device.device_id | 原始字符串当 key | base64 解码当 key |
|---|---|---|---|
| 020ce1fb9ab27da269915faff17a6814 | b134ab6a6a04dcf3…（64） | ✅ **相等** | ❌ 不等（38141048268f2a80…） |
| 78bc2f0d018df735a121c3aa77d4887b | 2430832b31f270a5…（64） | ✅ **相等** | ❌ 不等（ac4a238446e1bb40…） |

⇒ 2/2 命中，「客户端自报值 → 设备身份」是**可复算的确定性函数**，review 的定性在数据上成立。

**③ 外键动作（决定能不能原地改键）**

```
conname=fk_rt_device            from=auth_refresh_token  confupdtype=a  confdeltype=c
conname=fk_user_device_device   from=sys_user_device     confupdtype=a  confdeltype=c
```

`confupdtype='a'` = **NO ACTION** ⇒ 现在做 `UPDATE sys_device SET device_id=…`，只要子表有引用行就报 23503。**原地换发必须先加 `ON UPDATE CASCADE`**（§2.8-M2）。
（本机 `sys_user_device` / `auth_refresh_token` / `sys_user_mfa` 各 0 行，**不能据此推断生产规模**。）

**④ Redis 存量（按 deviceId 分键的规模）**

```
keys_total=2427
 451  risk:challenge:device:<64hex>:DEVICE_NEW
 394  WALNUT_CACHE_SYSTEM:DEVICE:<64hex>
 339  WALNUT_CACHE_SECURITY:SIGN:NONCE:<32hex>
 191  WALNUT_CACHE_SECURITY:RSA:PUB_KEY:<64hex>
  46  risk:rate:device:<64hex>:<num>
  38  risk:device:<64hex>
  27  WALNUT_CACHE_SYSTEM:DEVICE:COOKIE_RENEW:<64hex>
```

⇒ 换发要搬的键族至少 4 族，且 `risk:*` 族**没有 `WALNUT_CACHE_` 前缀**（与 `SYSTEM:DEVICE` 不同）—— 搬运脚本按前缀硬编码必漏。

**⑤ 会被 B5 直接推翻的既有断言（改造清单）**

| 位置 | 现在钉的行为 |
|---|---|
| `apps/api/test/api/device.api-spec.ts:105-118` | 「initial 同指纹重放 → **幂等回同一 deviceId**」（`expect(data.deviceId).toBe(api.deviceId)`）—— 这条**就是漏洞的固化** |
| `apps/api/test/api/device.api-spec.ts:167-168` | 同指纹重放会覆盖 deviceName |
| `apps/api/test/api/concurrency.api-spec.ts:257` | 「同指纹 ⇒ 同 deviceId」并发前提 |
| `apps/api/test/api/user-device.api-spec.ts:142-147` | `:deviceId` 非 64-hex → 40099 |
| `apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts:120,171,245` | 用 `getDeviceIdByFingerprint(fp)` 预算期望值 |
| `apps/api/ENDPOINTS.md:162,282` | 文档面同样写着「同指纹幂等」 |

---

## 2. 迁移方案（双读一版）

### 2.1 目标不变量（可被机械检查）

1. **INV-1**：任何 `sys_device.device_id` 的**新值**只由服务端 `mintDeviceId()` 产生，其信息来源不含 `X-Fingerprint`、不含任何请求字段。
2. **INV-2**：v2 id 形态恒为 `^d1_[0-9a-f]{32}$`（128 bit 熵）；legacy 恒为 `^[0-9a-f]{64}$`。两者**零交集**。
3. **INV-3**：任一时刻一台设备**只有一行**（换发是原地改键，不是新行）。
4. **INV-4**：`fingerprint_hash` 只入不出（不随任何响应下发）。
5. **INV-5**：换发不改变 `banned` / `locked` / `created_at` / `risk_score`（**设备年龄与封禁状态跨换发连续**）。

### 2.2 新 deviceId 规范

| 项 | 取值 | 理由 |
|---|---|---|
| 形态 | `d1_` + `randomBytes(16).toString('hex')` = 35 字符 | 前缀给**零歧义**判别：legacy 也是 64-hex，任何「按长度/字符集」的判别都会把新旧混在一起 |
| 熵 | 128 bit | 在线暴力不可行；DB `uq_device_id` 兜底，插入撞 23505 时重试一次 |
| 签发点 | **只有** `SysDeviceService.initial`（新设备）与换发路径，共用同一个纯函数 | INV-1 的落点 |
| 幂等语义变更 | 从「同指纹 → 同 id」改为「**同 cookie → 同 id**」：请求已带**有效 v2 cookie 且该行存在**时，`initial` 回显既有 id（不新铸） | 多 tab / 刷新重放不再产生孤儿行；同时**不再**让指纹参与 |
| 与指纹的关系 | 完全无关（不读 `req.fingerprint`）；指纹只写 `fingerprint_hash` | B5 本体 |

### 2.3 双读分派

新增纯函数模块 `apps/server/libs/system/src/device/device-id.ts`（新文件）：

```ts
// 伪代码（不落地，仅表达契约）
type DeviceIdKind = 'v2' | 'legacy' | 'invalid'
function classifyDeviceId(v: unknown): DeviceIdKind
function mintDeviceId(): string                  // 'd1_' + randomBytes(16).hex
function fingerprintHashOf(fp: string): string    // 复用 crypto.hash，salt 来源同 §1.7
```

三个消费点（**这是「双读一版」的全部改动面**）：

1. `DeviceGuard`：`classify` 为 `invalid`（含签名错的 `false`）→ 40605（行为不变）；`legacy` / `v2` 都继续走「缓存 → DB 回源」。
2. `WalnutAdminPipeDeviceId`（`pipes/src/base/format.pipe.ts:43-51`）：正则改 `^(?:[0-9a-f]{64}|d1_[0-9a-f]{32})$`，错误文案同步（窗口结束后收窄回 v2）。
3. `initial` / 换发：v2 则回显，legacy 则按 §2.4 换发，invalid/缺失则新铸。

### 2.4 平滑换发（rotation）

**只在两个点换发**（其余一律不动）：

| 触发 | 条件 | 为什么在这里 |
|---|---|---|
| **R1 匿名换发** | DeviceGuard 校验**全通过**后，cookie 是 legacy 且 `req.user == null` | 匿名设备没有会话/绑定可丢；且这正是「封禁绕过 + 铸别人 cookie」的攻击面所在 |
| **R2 登录换发** | 登录成功、写会话**之前**，cookie 是 legacy | 新会话本来就要创建，换 id 不额外踢人；RT 行由 `ON UPDATE CASCADE` 跟随 |

**刻意不在 `initial` 里换发**：`initial` 是 `@WalnutAdminGuardDeviceFree()`（`device.controller.ts:57`），拿不到可信的既有 cookie 语义；且前端 localStorage 有值时**根本不调它**（`app-geo-ip.ts:41-47`）—— 把换发塞进 initial 等于「换发时机由前端缓存决定」，不可控。

**换发算法（一个事务内，顺序即正确性）**

```
1. new = mintDeviceId()
2. UPDATE sys_device
     SET device_id = new,
         legacy_device_id = COALESCE(legacy_device_id, old),   -- §2.8 M1 的可选列
         fingerprint_hash = COALESCE(fingerprint_hash, :fpHash),
         id_kind = 'random',
         updated_at = now()
   WHERE device_id = old
   -- 子表 sys_user_device / auth_refresh_token 由 ON UPDATE CASCADE 自动跟随（M2）
3. UPDATE sys_user_mfa      SET device_id = new WHERE device_id = old   -- 松引用，必须手写
4. UPDATE app_monitor_user  SET device_id = new WHERE device_id = old   -- 松引用，必须手写
5. 日志表 log_auth / log_operate **不回填**（审计留存当时事实，Q3 定案）
6. after-commit:
     del  SYSTEM:DEVICE:<old>          ; set SYSTEM:DEVICE:<new> = 第 2 步返回行
     del  SYSTEM:DEVICE:COOKIE_RENEW:<old>
     RENAME SECURITY:RSA:PUB_KEY:<old>  → :<new>   ← **不能丢**（丢了 = 永久 40012）
     RENAME SECURITY:SIGN:AES_KEY:<old> → :<new>
     del  SECURITY:SIGN:TICKET:<old>                （会话绑定物，换发后应重签）
     del  AUTH:SESSIONS:<uid>:<old>:*               （仅 R2 可能命中）
     del  SECURITY:CAP_TOKEN:<old>:*                （可选；不删也能自然过期）
     （PERMISSIONS / MFA / LOCK / OPAQUE / risk:* 一律不动 —— miss 语义都是回源或 fail-closed）
7. Set-Cookie DEVICE_ID=<new>（maxAge 拉满）+ 顺手 markDeviceCookieRenewed(new) 开续期窗口
```

**第 7 步的「顺手开窗」不能漏**：否则换发后的**第一个**受保护请求会立刻再重发一次 Set-Cookie（`device.guard.ts:53-58` 的时间闸语义；`initial` 已有同款处理在 `device.service.ts:136-139`）。

**ban/lock 继承**：第 2 步只改键，`banned` / `locked` 原地保留 ⇒ INV-5 自动成立。这条必须有专项用例（§4-B5），因为 `initial` 是 Device-Free，被封设备照样能进来。

### 2.5 sys_device 行怎么处理

| 方案 | 评价 |
|---|---|
| A. 插新行 + 搬引用 + 删旧行 | ❌ 要跨 4 张表搬；且 `uq_device_name` 会让同名两行撞 23505（§5 风险 2） |
| **B. 原地改键（推荐）** | ✅ 一台设备恒一行（INV-3）；FK `ON UPDATE CASCADE` 自动带走 sys_user_device / auth_refresh_token；松引用手写 2 条 UPDATE；banned / locked / created_at / risk_score 天然连续 |
| C. 加 `device_id_v2` 列长期并存 | ❌ 所有 `WHERE device_id=` 都要双写，最贵且会长期不收敛 |

**旧行保留多久**：B 方案下不存在「新旧两行」，所以问题变成「**legacy 行什么时候必须被换掉**」：
- 主动回来的（cookie 还在）→ R1/R2 当场换；
- 不回来的（cookie 已死）→ 窗口内保持 legacy 可用，窗口结束（建议 **60 天 = 2 个 cookie 寿命**）由一次性 job 批量换发，然后收口（§2.8-M3 的 CHECK 能加上 = legacy 清零）。

### 2.6 引用怎么跟着走

| 引用 | 跟随方式 |
|---|---|
| `sys_user_device.device_id`（FK） | `ON UPDATE CASCADE`（M2），零应用代码 |
| `auth_refresh_token.device_id`（FK + 部分唯一索引） | 同上；唯一索引 `uq_rt_active_device_user` 随值更新，不会与新行冲突（一台设备只有一条 active RT） |
| `sys_user_mfa.device_id`（松引用） | 第 3 步显式 UPDATE（**不搬 = 该设备的 TOTP/WebAuthn 凭据失联 ⇒ 用户要重新注册 MFA**，最容易漏的 UX 事故） |
| `app_monitor_user.device_id`（松引用） | 第 4 步显式 UPDATE（不搬 = 在线列表悬空） |
| `log_auth` / `log_operate` | **不回填**（Q3：审计要比被引用对象活得久） |
| Redis 各族 | 见 §2.4 第 6 步 |
| 前端 `GEO_IP_DEVICE_ID` | 降级为显示缓存：判据从「localStorage 有值」改为「cookie 在」；Set-Cookie 后由响应回填 |

### 2.7 回滚

- **DDL 回滚**：M1/M2 全部配 `down`（DROP COLUMN / 还原 FK 为 NO ACTION）。
- **应用回滚**：开关 `DEVICE_ID_V2_ENABLED`（默认关 → 灰度 → 全量）。关闭后：`initial` 回 legacy 派生、Guard 只认 legacy。
- **关键诚实点**：已经换发出去的 v2 行**不会自己变回来**。老代码把 v2 cookie 当垃圾值 ⇒ 40605 ⇒ 前端自愈 ⇒ 拿回 legacy 派生 id ⇒ **新行**（绑定的 trust / MFA / 设备名丢一次）。⇒ **回滚 = 一次设备身份重置**，不是无损。
- 若要**无损回滚**：M1 保留 `legacy_device_id text NULL`（+ 部分唯一索引），换发时写入原值，老代码按它回查。代价：多一列一个索引，窗口结束 drop。**建议采纳**（见 §7-拍板 4）。

### 2.8 DDL 草案与幂等性论证

三段独立 migration，可与代码步骤解耦发布。

**M1（L1，纯加法，行为零变化）**

```sql
ALTER TABLE sys_device ADD COLUMN IF NOT EXISTS fingerprint_hash text;
ALTER TABLE sys_device ADD COLUMN IF NOT EXISTS id_kind varchar(8) NOT NULL DEFAULT 'legacy';
ALTER TABLE sys_device ADD COLUMN IF NOT EXISTS legacy_device_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_device_id_kind') THEN
    ALTER TABLE sys_device
      ADD CONSTRAINT ck_device_id_kind CHECK (id_kind IN ('legacy', 'random')) NOT VALID;
  END IF;
  ALTER TABLE sys_device VALIDATE CONSTRAINT ck_device_id_kind;
END $$;

CREATE INDEX IF NOT EXISTS idx_device_fp_hash
  ON sys_device (fingerprint_hash) WHERE fingerprint_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_legacy_id
  ON sys_device (legacy_device_id) WHERE legacy_device_id IS NOT NULL;
```

*幂等论证*
- `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`：重复执行是 no-op（PG 9.6+）。
- 约束：PG 的 `ADD CONSTRAINT` **没有** `IF NOT EXISTS`，所以用 `pg_constraint` 按固定名查重；`NOT VALID` 建约束只取 `ACCESS EXCLUSIVE` 极短一瞬、不扫表；随后 `VALIDATE CONSTRAINT` 只取 `SHARE UPDATE EXCLUSIVE`（允许读写），且**第二次执行是 no-op**（已验证态再 VALIDATE 不报错）。
- `DEFAULT 'legacy'` 让存量行在**不回填**的情况下语义正确（旧行就是 legacy），避免回填时全表重写。
- `legacy_device_id` 的唯一索引带 `WHERE ... IS NOT NULL`：v2 行不必占位，且天然支持「一旧 id 只能映射一次」。

**M2（L3 的硬前置，FK 加 ON UPDATE CASCADE）**

```sql
ALTER TABLE sys_user_device DROP CONSTRAINT IF EXISTS fk_user_device_device;
ALTER TABLE sys_user_device
  ADD CONSTRAINT fk_user_device_device FOREIGN KEY (device_id)
  REFERENCES sys_device (device_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE auth_refresh_token DROP CONSTRAINT IF EXISTS fk_rt_device;
ALTER TABLE auth_refresh_token
  ADD CONSTRAINT fk_rt_device FOREIGN KEY (device_id)
  REFERENCES sys_device (device_id) ON UPDATE CASCADE ON DELETE CASCADE;
```

*幂等论证*：`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`（固定名）重复执行结果相同；无随机名、无 DO 块。
*锁与规模*：`ADD FOREIGN KEY` 会全表校验子表。本机两表各 0 行；**生产若 auth_refresh_token 量大**，改成 `NOT VALID` + 独立 `VALIDATE CONSTRAINT` 两步（同样幂等），避免长事务。
*顺序红线*：**必须先 M2 后开换发**。实测两处 FK 的 `confupdtype='a'`（§1.8-③），漏了 M2 的每一次换发都会 23503。

**M3（L5 收口，可选）**

```sql
-- ① legacy 残余批量换发由应用侧 job 完成（HMAC 不在 SQL 里算），此处只断言结果
-- ② 形态闸：能 VALIDATE 成功本身就是「legacy 已清零」的机械证明
ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS ck_device_id_shape;
ALTER TABLE sys_device
  ADD CONSTRAINT ck_device_id_shape CHECK (device_id ~ '^d1_[0-9a-f]{32}$') NOT VALID;
ALTER TABLE sys_device VALIDATE CONSTRAINT ck_device_id_shape;

-- ③ 收口后摘掉回滚列
DROP INDEX IF EXISTS uq_device_legacy_id;
ALTER TABLE sys_device DROP COLUMN IF EXISTS legacy_device_id;
```

*幂等论证*：同 M1 的查重/IF EXISTS 组合；`VALIDATE` 可重复。
*注意*：③ 一旦执行，§2.7 的「无损回滚」窗口关闭 —— 必须等窗口结束（≥60 天）再跑。

---

## 3. 与已落地改动的关系（批次 1-6 逐条）

基线：`97012f3b`（设备追踪 P0）+ `6dd7c784`（admin 自愈）+ `1793380000000-DeviceStaleFlag`。

| # | 已落地改动 | 位置 | B5 后 |
|---|---|---|---|
| 1 | **cookie 滑动续期** | `const/src/app/cookie.ts:39-42`、`guards/device.guard.ts:53-71`、`cache/src/service/device.cache.ts:76-89` | **必须保留，且地位升级**：cookie 现在是**唯一身份载体**，丢 cookie 不再只是 40605，而是「换一个新身份、丢 trust/MFA/设备名」。代码本身**不需要改**，但换发路径必须复用同一个时间闸（§2.4 第 7 步）。可简化点：`initial` 里那句「顺手开窗」（`device.service.ts:136-139`）可抽成共用函数，避免第三处再抄一遍 |
| 2 | **封禁 = 踢下线** | `apps/api/src/modules/system/device/shared/device.kick.service.ts`、`device.service.ts:243-249` | **必须保留，且从「补丁」升级为「主要执法」**：既然身份可再生，封禁的即时效果只能靠「撤 RT + 清会话键 + 断 WS」。逻辑不改 |
| 3 | **cron 只标 stale、不删行** | `repo/device.repo.service.ts:64-83`、`identity/src/user_device/shared/user_device.shared.service.ts:123-167`、migration `1793380000000` | **保留机制，但理由换了、并要补留存策略**：原理由「等 cron 删行 = 封禁清零」在 B5 后变成「清 cookie 重铸 = 封禁清零」，所以 stale 仍是「cookie 死锁」的解药；但**设备行数会明显上一档**（每个清过 cookie 的浏览器留一行）。必须补：`WHERE stale AND NOT banned AND NOT locked AND updated_at < now() - 90d` 的清理 job（现成的 `idx_device_stale` 正好是它的部分索引） |
| 4 | **visitorId 从响应面移除** | `app-domain/src/monitor/user/dto/user.dto.ts:21-27`、`apps/api/src/modules/app/monitor/user/dto/user.dto.ts:60-89` | **保留**，且 B5 是把它从**请求面**也摘掉的时机（原 P1-3）：`/app/monitor/user/state` 虽 Device-Free，但**能读 cookie**（`@WalnutAdminDecoratorDeviceId` 就是读 cookie，`decorators/user.decorator.ts:20-24`），所以心跳行键可从 `body.visitorId` 换成 cookie 的 deviceId + `fingerprint_hash` 特征列 ⇒ `app_monitor_user.visitor_id`（UNIQUE）可退役（它现在同时是「行键」与「**明文指纹存储**」） |
| 5 | **前端 40605 自愈** | `admin/src/utils/axios/interceptors/response/device.ts:20-25`、`app-geo-ip.ts:60-83` | **保留但降级为最后手段**：B5 后一次自愈 = 换一个新身份（丢 trust/MFA/设备名），不能再像今天这样随手自愈。两处必改：① `setupDeviceId` 早退条件从「localStorage 有值」改为「cookie 在」；② 自愈加节流（同一会话最多 N 次），避免换发失败时打转 |
| 6 | **initial 幂等（同指纹回同 id）** | `device.basic.repository.ts:39-53` + `device.api-spec.ts:105` | **必须反转**：幂等键从指纹换成 cookie（§2.2）。`upsertByDeviceId` 保留（它仍要处理「同 id 覆盖」），但调用方不再用指纹算 id |

**可以删掉的东西**（B5 完成后）：`crypto.hashDeviceFingerprint` 在身份路径的唯一调用（`device.service.ts:87`）、`DEVICE_ID_PATTERN` 的 64-hex 单形态、`app_monitor_user.visitor_id` 列（L4 后）、`concurrency.api-spec.ts:257` 的「同指纹 ⇒ 同 deviceId」前提。

---

## 4. 验收判据（可机械验证）

> 口径：HTTP 恒 200，断言看 `body.code`；DB 断言走 `pgDataSource.query`；Redis 断言走 `cacheService`。

### A. 身份不可指定（核心，直接否证漏洞）

| ID | 断言 | 落点 |
|---|---|---|
| **A1** | **同一指纹连续两次 initial（均不带 cookie）→ 两个不同 deviceId**，且都匹配 `^d1_[0-9a-f]{32}$` | 反转 `device.api-spec.ts:105-118` |
| A2 | 用受害者指纹发 initial：返回 deviceId 的 `sys_device.id` **≠** 受害者行的 `id`；受害行 `updated_at` 不变（未被覆盖） | 新用例；对抗 review §8.2 |
| A3 | 同指纹 N=1000 次 initial → 1000 个 distinct deviceId，且**没有一个等于** `HMAC(fp,key)` | 属性测试（把旧函数当反例源） |
| A4 | 伪造的 legacy cookie（用错 secret 签名）→ `body.code = 40605`，且响应**无** `Set-Cookie: DEVICE_ID` | guard 现有语义 + 显式断言 |
| A5 | **只写一处**（静态）：`device_id` 的写点集合 ⊆ {initial 的 upsert、换发的 UPDATE}；`hashDeviceFingerprint` 在 identity 路径 **0 调用** | 可做成单测或 lint 脚本 |
| A6 | 跨设备重放：A 的 cookie + B 的 AT → `40101`（现有 `guard-matrix.api-spec.ts:499` 保持绿） | 回归 |
| A7 | 旧派生值在**窗口结束后**不再被当身份：构造合法签名的 `HMAC(fp,key)` cookie → `40605` | 收口验证 |
| A8 | 窗口**内**同一枚 legacy cookie：第一次请求 `code=0` + 响应带新 DEVICE_ID；第二次请求（模拟 cookie 未更新）→ 旧 id 已不存在 → `40605`（**单一活跃身份**，不允许双身份并存） | 新用例 |

### B. 平滑（换发不炸现场）

| ID | 断言 |
|---|---|
| B1 | 匿名 legacy cookie 首次受保护请求：`body.code=0` **且**本次业务数据正常返回（换发不阻断本次请求） |
| B2 | 换发后连续 3 个请求（带新 cookie）全 `code=0`，**签名不报 40012**（证明 RSA/AES 键已搬运） |
| B3 | 换发后 `sys_user_device` / `auth_refresh_token` / `sys_user_mfa` / `app_monitor_user` 中 `device_id = <old>` 的行数全部为 0 |
| B4 | 已登录用户的 R2 换发后，`/auth/refresh` 仍成功（不是 40101 循环） |
| B5 | **banned 继承**：对 banned 的 legacy 设备发 initial（Device-Free）→ 换发后新行 `banned=true`，随后受保护请求仍 `40607`（INV-5） |
| B6 | 双标签页并发 initial（都带同一 legacy cookie）：库中该设备**恰一行**、deviceId 恰一个；两请求 code ∈ {0, 40605}，**不出现 50000** |
| B7 | 换发后 `SYSTEM:DEVICE:COOKIE_RENEW:<new>` 存在（时间闸已开）⇒ 紧随的请求**不产生**多余的 Set-Cookie |

### C. 特征面（指纹降级）

| ID | 断言 |
|---|---|
| C1 | `fingerprint_hash` **永不出响应**：对 `/system/device/{list,read}`、`/system/user/device/list`、`/app/monitor/user/{list,read}` 逐字段断言 `not.toHaveProperty('fingerprintHash')`（同 P0-2 对 visitorId 的做法） |
| C2 | `fingerprint_hash` 是 fp 的确定性函数（同 fp 两行同值），且不可逆推（长度/熵断言 + 无反向端点） |
| C3 | `openapi.json` 重导出后无 `fingerprintHash` 字段；`api-types` 同步 |

### D. 收口

| ID | 断言 |
|---|---|
| D1 | M3 的 `ck_device_id_shape` **能 VALIDATE 成功** = legacy 清零的机械证明 |
| D2 | `SELECT count(*) FROM sys_device WHERE id_kind='random' AND device_id !~ '^d1_[0-9a-f]{32}$'` = 0 |
| D3 | `SELECT count(*) FROM sys_device WHERE id_kind='legacy'` 在窗口结束后 = 0 |

---

## 5. 工作量（L 拆分，每步可独立发布）

| 步 | 内容 | 人日 | 可独立发布？ | 观测点 |
|---|---|---|---|---|
| **L1** | M1 迁移 + 实体三列 + `mintDeviceId`/`classifyDeviceId` 纯函数与单测 + `initial` 写入 `fingerprint_hash`（行为零变化，灰度前先在生产观察「fp 覆盖率」） | 0.5 | ✅ 纯加法 | `count(*) WHERE fingerprint_hash IS NOT NULL` 增长 |
| **L2** | 新签发改 v2（无 cookie 的新设备）+ **deviceName 改服务端生成** + `uq_device_name` 决策落地 + pipe 双形态 + openapi/api-types 重导出 + 反转 `device.api-spec.ts:105` | 1.0 | ✅（legacy 老用户不受影响） | `id_kind='random'` 行占比；23505 计数应为 0 |
| **L3** | **M2 迁移** + R1/R2 换发 + Redis 四键搬运 + 三张子表跟随 + 前端 localStorage 降级 + 自愈节流 + 开关 `DEVICE_ID_V2_ENABLED` | 1.5 | ✅（**最需要灰度**） | 40012 计数（必须 0）、40101 计数、40605 计数、`id_kind='legacy'` 行数下降曲线 |
| **L4** | `fingerprint_hash` 关联执法（initial 时按 fp 命中 banned/locked 行 → 拒绝或 challenge）+ 心跳行键从 visitorId 改 deviceId + `app_monitor_user.visitor_id` 退役评估 | 1.0 | ✅ | 封禁绕过成本（人工对抗演练）；visitor_id 列读写归零 |
| **L5** | 窗口收口：批量换发残余 + M3 约束 + 删 `hashDeviceFingerprint` / 64-hex 单形态 / 回滚列 + 文档与 AGENTS 环境变量说明更新 | 0.5 | ✅（最后一次） | D1-D3 全绿 |
| | **合计** | **4.5** | | |

### 最可能翻车的点（按 概率 × 影响 排序）

1. **签名握手 40012 永久死**（概率中 / 影响灾难）
   `sign.guard.ts:103` 每次请求 `getRsaPubKeyCache(deviceId)`，miss 即抛；而前端 `setupSign` **只在本地没有密钥对时**才重新握手（`admin/src/store/modules/app/app-security.ts:114-122`）。⇒ 换发漏搬 `SECURITY:RSA:PUB_KEY` 会让该浏览器**永久** 40012，刷新治不好（兜底只有错误屏上的「重置本机密钥并重试」，`bootstrap.ts:209-229`）。
   **缓解**：换发事务内 RENAME 该键 + 单测「换发后 `getRsaPubKeyCache(new)` 命中」。
2. **uq_device_name 23505 → 40000 → 设备永久注册不上**（概率高 / 影响高）
   deviceName 由「设备类型_指纹前 6 位」拼成（`app-fingerprint.ts:141-143`）+ `uq_device_name`（InitSchema:236）+ 23505 → 受控 40000（`device.service.ts:151-155`）。今天撞不到**只因为**同指纹恒 upsert 同一行。改成随机 id 后，同一浏览器第二次 initial 必然撞。
   **缓解**：L2 同批把 deviceName 改成服务端生成（如 `device-<8hex>`），或放开唯一约束（用户改名语义挪到 `sys_user_device.device_name`，那里本来就有）。
3. **FK 忘了 M2 ⇒ 每次换发 23503**（概率中 / 影响高，实测 `confupdtype='a'`）。**M2 是 L3 的硬前置**。
4. **会话键 `AUTH:SESSIONS:<uid>:<deviceId>:<sid>`**（`session.service.ts:83`）在 R1 之外被换发 ⇒ 在线用户被踢。**约束**：R1 必须严格 `req.user == null`。
5. **Redis 搬运漏族**：`risk:*` 族**无 `WALNUT_CACHE_` 前缀**（实测 451+46+38 个键），按前缀硬编码的搬运脚本必漏 ⇒ 风控/限流历史断代（可接受）或断言失败（不可接受）。
6. **多 tab 并发 initial**：两个随机 id，最后一个 Set-Cookie 赢，另一 tab 的 in-flight 请求 40605 → 自愈风暴。**缓解**：initial 幂等键改 cookie（§2.2）+ 前端保留 SingletonPromise。
7. **设备行膨胀**：每个清 cookie 的浏览器一行 ⇒ 管理端「设备列表」变脏、`idx_device_stale` 清理压力。**缓解**：L5 的留存 job + 管理端默认过滤 stale。
8. **回滚非无损**（§2.7）：没有 `legacy_device_id` 时，回滚 = 一次设备身份重置。
9. **DEVICE_ID_ENCRYPTION_KEY 语义漂移**：从「身份派生盐」变「风控特征盐」。**不要改名**（`apps/server/AGENTS.md` 的 5 个不可变项）；若新增 `FINGERPRINT_HASH_SALT`，必须 `?? DEVICE_ID_ENCRYPTION_KEY` 兜底，否则老数据全部对不上。

---

## 6. 与 review P0-2 / P1-1 的对照（这轮到底修了什么）

| review 结论 | B5 后 |
|---|---|
| §8.2「`device_id == HMAC(fp)` ⇒ 知道指纹就能拿到该设备合法 cookie」 | ✅ **修掉**：initial 与指纹解耦，铸出来的是无关新身份 |
| §8.3「指纹随 monitor 列表下发」 | ✅ 已由前批修（响应面摘除）；B5 再把请求面也摘（L4） |
| §8.4「订阅他人 OAuth 结果流」 | ✅ 攻击链断（拿不到别人 deviceId）；但 **SSE 频道键仍是稳定 deviceId**，管理端一泄漏就复用 ⇒ 一次性 ticket 方案仍未做，**不在 B5 范围** |
| P1-1「封禁未闭环」 | ⚠️ **部分**：①「改指纹」这条路被堵（指纹不再影响身份）；②「等 cron 删行」早由拍板-5 堵；③ **新增一条**「清 cookie 重铸」。③ 只能靠 L4 的 fp 关联执法**提高成本**，而设备指纹本身客户端可造 ⇒ 结论仍应是「**封禁是降噪，不是安全控制**」 |

---

## 需要 Lead 拍板

1. **B5 的目标到底是哪个？** 「客户端不能**指定**自己拿到谁的身份」（B5 达成）vs「客户端不能**再生**身份」（B5 达不成，需要 fp 关联执法且仍可伪造）。建议把目标写成前者 + 封禁定位回「降噪/提高成本」，否则验收会被「清 cookie 就绕过」一句话推翻。
2. **deviceName 归属**：服务端生成（`device-<8hex>`，保留 `uq_device_name`）还是放开唯一约束、把用户改名语义挪到 `sys_user_device.device_name`？我推荐前者 —— 它同时消掉「指纹前 6 位进 UNIQUE 列」这个泄漏面。
3. **换发触发点**：只做 R1（匿名）+ R2（登录），还是也在 initial 里做？我推荐**不做 initial**（理由见 §2.4：initial 是 Device-Free，且前端 localStorage 有值时不调它）。
4. **是否需要「无损回滚」**？→ 决定 M1 要不要 `legacy_device_id` 列（+ 部分唯一索引）。我推荐要：60 天窗口内的回滚安全，代价极小。
5. **窗口长度**：60 天（= 2 个 cookie 寿命）够不够？以及**要不要一次性强制全量换发**（会造成所有在线用户掉线一次，但能提前收口）。
6. **L4 是否在 B5 同批**？fp 关联执法 + 心跳行键改 deviceId + `visitor_id` 退役，三者互相咬合；拆开做会出现「指纹两套存储」的中间态。我推荐同批。
7. **是否接受设备行膨胀**（清 cookie 即一行）？替代方案是给 initial 加更严的限流（现在是 `@WalnutAdminDecoratorThrottle(SysDeviceSettingService)`），但那会连带影响正常首次访问。
8. **DEVICE_ID_ENCRYPTION_KEY 的处置**：维持变量名 + 改注释（推荐），还是引入 `FINGERPRINT_HASH_SALT`（带 fallback）？

---

### 附：本轮执行的环境事实

- 基线 `d9f4233e`，本轮**未改任何源码**（只新增本文件）；临时探针脚本用后即删（会话期间并行批次对工作树的其它改动与本报告无关）。
- PG 5432 / Redis 6379 连通；**3000 端口未监听** ⇒ 本轮无 HTTP 探针，§1.8 的实测全部来自「读码 + 直连 PG/Redis 复算」，非 wire 观测。
- 本机 DB 是开发库（`sys_device` 11 行，`sys_user_device` / `auth_refresh_token` / `sys_user_mfa` 各 0 行），**规模不能外推到生产**；FK 动作（`confupdtype`）与索引形态才是可外推的事实。
