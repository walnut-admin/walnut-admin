# 批次 13 · R1 深度调研：B5 之后的事实漂移 + 流水线口径三件

> 只读调研，未改任何源码/文档。工作树在 `534667e1` 上 clean。
> 取证方式：读代码与文档原文 + `git show e90cb37f` + 机械计数（枚举 `package.json` / `pnpm-workspace.yaml` / `prepush.ts`）+
> 实跑 `lint:doc-budget` / `lint:docs-refs` / `lint:doc-ts` / `lint:emoji`。

---

## 0. 结论摘要

| 块 | 一句话结论 |
|----|-----------|
| **A** | `shared/device.md` 是**整篇**按旧语义写的（不只是「身份来源」一段）：HMAC 派生、deviceName 入参、10 条 IP 历史、401/403 而不是 40605/40606/40607、MongoDB —— 而且它自己**内部自相矛盾**（:79 MongoDB vs :271 PostgreSQL）。另有 4 篇后端文档 + 3 处代码注释/Swagger 仍在讲 `device_id = hash(X-Fingerprint, crypto.deviceIdKey)` |
| **B** | 计数腐烂抓到 3 处真错：`README.md:22` 的**分组计数仍然加起来等于 15、但分组已经错了**（platform-web 3 实为 2、`generated` 整组漏登）；`release.md:13` 14→15；`reference-repo-comparison.md:210` 14→12。knip 有 1 处未标日期的旧读数（`82 条`）。CAP 那一条**已经写对了**（`security.md:227-232/237/244-246`）。风控分级（40667 / `meta.riskDegraded`）**没写，而且 `security.md:306-309` 现在写的是反的** |
| **C1** | 根 `AGENTS.md` = **8312 / 8700 = 96%**，只剩 388 字符。给了一套纯靠**删重复**释放约 900 字符的方案（不动任何规则） |
| **C2** | SKIP 在机器侧**长得和 PASS 一模一样**：`lint-workflows.ts:23-27` 探测不到就 `return`（exit 0），prepush 执行器只看退出码 ⇒ 打对勾、汇总「26 段全部通过」。文档侧已抓到 2 处把 SKIP 算进绿里（`review/backend/index.md:397`、`plans/libs-decoupling-residuals.md:71`，后者与同文件 :133 **自相矛盾**） |
| **C3** | `db:seed:verify` **两边都不在**，而且**当前文档已经写对了**（`postgresql.md:83-84`「它不进 prepush/CI」）。建议维持「不进」，不推荐塞 prepush（破坏性 + 每次 push）也不推荐塞 release 电池（它不是 CI 门禁，塞进去只是一条永久暂缓行） |

---

## 1. 基准事实：B5 之后代码的真源

改文档前先钉住「现在到底是怎么运作的」。以下都是代码，不是文档：

| 事实 | 真源 |
|------|------|
| 设备 id 形态 = `d1_` + 32 位小写 hex（16 字节随机） | `apps/server/libs/const/src/app/device.ts:16` `DEVICE_ID_PATTERN = /^d1_[0-9a-f]{32}$/`、`:19` `WALNUT_DEVICE_ID_PREFIX = 'd1_'` |
| 签发只用 `randomBytes`，**不碰任何密钥** | `apps/server/libs/system/src/device/device-id.ts:23-25` `generateDeviceId()` |
| 签发点只有两处（匿名 initial + 登录成功） | 同上 `:18-22` 的注释（「只在两处调用」） |
| initial 的**幂等键 = cookie** | `apps/server/libs/system/src/device/device.service.ts:107-108`：`isValidDeviceId(cookieDeviceId) ? cookieDeviceId : generateDeviceId()` |
| `deviceName` **服务端生成** `<设备类型>_<8hex>`，且从 Initial DTO **摘除** | `device.service.ts:94-96` `buildServerDeviceName`；`libs/system/src/device/dto/device.dto.ts:206-216`（`SysDeviceDTOInitialRequest` 只 Pick `sr/vp/hardwareInfo/deviceInfo/private`） |
| 带 `deviceName` 的 initial 请求 = **40099**（whitelist + forbidNonWhitelisted） | `device.dto.ts:206-210` 注释 + `device.dto.spec.ts`（B5 新增的 57 行） |
| DeviceGuard 只认 `d1_` 形态，其他一律 **40605** | `apps/server/libs/guards/src/guards/device.guard.ts:87-99` `isValidDeviceId(...)` 否则 `WalnutAdminExceptionDeviceNotAcceptable` |
| 设备 cookie：30 天 + **80% 窗口滑动续期** | `libs/const/src/app/cookie.ts:39` `30*24*60*60*1000`、`:42` `RenewInterval = maxAge * 0.8`；`device.guard.ts:53-71` |
| 心跳行键 = **deviceId**；`visitorId` 只作校验，判据是「与本设备**已存行**的 visitor_id 比」，不一致 40099 且**不写库**；首写放行 | `apps/server/libs/app-domain/src/monitor/user/user.service.ts:93-104` |
| 心跳 body 的 `deviceId` 已**从 wire 白名单摘除** | `apps/server/apps/api/src/modules/app/monitor/user/dto/user.dto.ts:98-102` |
| 90 天留存清理（`active=false AND updated_at<90d`，排除 banned/locked/活心跳/活 RT） | `libs/system/src/device/repo/device.repo.service.ts:91-148` `purgeInactiveDevicesBefore` |
| DB 侧硬约束 `ck_device_device_id_form` | `apps/server/apps/api/migrations/1793390000000-DeviceIdFormCheck.ts` |
| `DEVICE_ID_ENCRYPTION_KEY` 仍是「部署后不许改的 5 个」，但**不再参与身份派生**，只是历史数据解密根 | `libs/system/src/device/repo/device.repo.service.ts:38-47` 注释；`apps/server/AGENTS.md` 的环境变量段 |
| `ipHistory` / `locationHistory` 上限 = **5** | `device.dto.ts:60-70`（`maxSize: 5`）、`:93-105`（`maxSize: 5`）；`backend/modules/security.md:285` 也写 5 |

---

## 2. A 块：B5 之后的事实漂移清单（按文件分组）

### A1. `apps/docs/src/zh-CN/content/shared/device.md` —— **整篇重写**（29 处，不是只有一段）

R1（批次 11 `reports/batch-11/r1-migration.md:325`）点名的是 `:23,46,110,258` 的「身份来源」段；实际读下来**远超这 4 行**。

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `device.md:9` | 「实现了一套基于浏览器**指纹**和服务端**哈希**的设备标识系统」 | 两个关键词全错 | 「……基于服务端**随机签发**的设备标识系统；浏览器指纹降级为风控特征」 |
| `device.md:14` | 「**服务端哈希生成**：将指纹 ID 通过 HMAC-SHA256 哈希生成唯一的 Device ID，防止客户端伪造」 | 核心错误 | 「**服务端随机签发**：`d1_` + 32 位小写 hex（`randomBytes(16)`），指纹不参与身份派生」 |
| `device.md:15` | 「Cookie + LocalStorage 双重存储」 | 缺「cookie 80% 窗口滑动续期」——「30 天过期」的整条叙述都建立在没有续期上 | 补「DeviceGuard 校验通过后按 80% 窗口重发 cookie，剩余寿命恒大于 20%」 |
| `device.md:23` | 「Device ID 的生成依赖服务端密钥（`DEVICE_ID_ENCRYPTION_KEY`），确保客户端无法伪造」 | **已不依赖**：签发只调 `randomBytes` | 「该 key 不再参与身份派生，只是历史数据的解密根，仍属『部署后不许改的 5 个』」 |
| `device.md:24` | 「30 天过期策略平衡了安全性和用户体验」 | 已加滑动续期 ⇒ 不再是「30 天到期」 | 改「cookie 30 天 + 滑动续期；设备行另有 90 天留存清理」 |
| `device.md:34-40` | 「Visitor ID（浏览器指纹）……**作为生成 Device ID 的原始输入**」（`:39`） | 直接错误 | 「只作风控特征与心跳归属校验（与本设备已存行比），**不参与** device_id 派生」 |
| `device.md:42-49` | 「### 2. Device ID（设备标识）……生成算法：`HMAC-SHA256(visitorId, DEVICE_ID_ENCRYPTION_KEY)`」（`:46`）；「有效期：30 天（与 RSA 密钥对保持一致）」（`:48`） | **这就是「身份来源」段，整段重写** | 「服务端随机签发：`d1_` + 32 位小写 hex；initial 的幂等键是**已有合法 cookie**（有则复用、无则新签）；旧 64-hex 与伪造值一律 40605，客户端据此自愈重新 initial；DB 有 CHECK `ck_device_device_id_form` 兜底」 |
| `device.md:59` | 「IP 历史记录：最多保留 **10** 条」 | 实际 **5** | 5 条（`device.dto.ts` `maxSize: 5`） |
| `device.md:79` | mermaid `participant DB as MongoDB<br/>(数据库)` | B6 已迁 PostgreSQL；而且**同一篇** `:271` 的存储表写的是 PostgreSQL —— 内部自相矛盾，说明没人重读过 | PostgreSQL |
| `device.md:100` | 「采集额外信息：- 设备名称 (**从指纹库**)」 | 名字服务端生成 | 「设备名不再由客户端提供（服务端生成 `<类型>_<8hex>`）」 |
| `device.md:103` | `POST /system/device/initial { visitorId, deviceName, isPrivate, ... }` | `deviceName` **已从 DTO 摘除**，带上即 40099；`visitorId` 也不在 Initial DTO 里（Payload 只有 `sr/vp/hardwareInfo/deviceInfo/private`） | 载荷改成 `{ sr, vp, hardwareInfo, deviceInfo, private }` |
| `device.md:108-111` | `Server->>Crypto: hashDeviceFingerprint(visitorId)` / `HMAC-SHA256(data: visitorId, key: DEVICE_ID_ENCRYPTION_KEY)` | 整段图形错 | `Server->>Server: 读 DEVICE_ID cookie；形态合法则复用，否则 randomBytes(16) 新签` |
| `device.md:119-127` | `findOneAndUpdate({deviceId}, {$set}, {upsert:true})`、「更新 deviceName」 | Mongo 语义（PG 侧是「按业务键查到即整体覆盖、否则插入」）；且名字**不再更新**（服务端签发、`uq_device_name` 全局唯一） | 改成 PG 语义；名字只在插入时生成 |
| `device.md:139` | `Server-->>Client: 返回 { success: true } + Set-Cookie` | wire 事实是 `{ deviceId, locationInfo }`（`device.dto.ts:225-260` 的 `SysDeviceDTOInitialResponse`） | `{ deviceId, locationInfo }`（+ `longitude/latitude/countryCode` 可选） |
| `device.md:182-184` | 「Device ID 不存在 → 错误码 `DEVICE_ID_REQUIRED` → 返回 **401**」 | 错误码与 HTTP 码都不对：实际是 `WalnutAdminExceptionDeviceNotAcceptable` = **40605**（统一响应壳 HTTP 200 + body.code）；且**形态不合法**（旧 64-hex / 伪造）走同一条 | 「cookie 缺失**或形态不是** `d1_`+32hex → **40605**，客户端据此自愈重新 initial」 |
| `device.md:194-201` | `DEVICE_LOCKED` → 403、`DEVICE_BANNED` → 403、`DEVICE_INACTIVE` → 403 | 实际 **40607 banned / 40606 locked**（且**先判 banned**）；**没有** `DEVICE_INACTIVE` 分支（`device.guard.ts:150-158` 只有 banned / locked） | 40607 / 40606，删 inactive 分支 |
| `device.md:257` | 「**服务端哈希生成** - Device ID 由服务端通过 HMAC-SHA256 生成」 | 同 `:14` | 「服务端随机签发 - 客户端无签发权即无法伪造」 |
| `device.md:258` | 「**密钥隔离** - 使用 `DEVICE_ID_ENCRYPTION_KEY` 作为 HMAC 密钥」 | 该 key 已不参与 | 删掉这条，改「形态判据唯一（`const/app/device.ts`）+ DB CHECK 双保险」 |
| `device.md:271` | 存储表「PostgreSQL \| 设备详细记录 \| **永久**」 | 90 天留存清理已上线 | 「永久，但 `active=false` 且 90 天无写活动的行会被清理（banned/locked **永久保留**）」 |
| `device.md:279` | 「**IP 历史限制** - ipHistory 最多保留 **10** 条」 | 实际 5 | 5 |
| `device.md:284` | 局限性「**浏览器指纹不稳定** …… 触发重新初始化」 | 前提消失：身份与指纹已解耦，指纹漂移不再触发重新初始化（反而会 40099 —— 那是**本设备被登记成另一个指纹**，见 `user.service.ts:56-64`） | 重写：改成「同一物理设备的不同浏览器 = 不同设备（指纹不再提供跨设备关联）」+「指纹漂移的症状是 40099，不是重新 initial」 |
| `device.md:286` | 局限性「**30 天过期** - 过期后需要重新初始化」 | 有滑动续期 | 改「cookie 被清 / 换浏览器 / 换了隐私窗口才会重新 initial」 |
| **缺**（无行号） | 全文没有 | ① `d1_`+32hex 形态；② 90 天留存；③ 滑动续期；④ 40605 自愈链路；⑤ `deviceName` 服务端生成 + 带上即 40099；⑥ DB CHECK | 新增小节「身份形态与自愈」+「留存与续期」 |

> 判据：`apps/docs/AGENTS.md` 的重要约定 8 说的「别写会腐烂的计数」在这里也适用 —— `:59`/`:279` 的「10 条」正是那种数字，改写时**写「上限由 `device.dto.ts` 的 `maxSize` 决定」**比写 5 更耐久。

### A2. `apps/docs/src/zh-CN/content/shared/sign.md`

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `sign.md:41` | 「由服务端通过 HMAC-SHA256 **哈希浏览器指纹**生成，确保客户端无法伪造」 | 同 A1 核心错误 | 「服务端随机签发（`d1_`+32hex）；不可伪造的来源是**签发权在服务端**，不是哈希」 |
| `sign.md:285` | 局限性「**设备指纹简单** - 仅使用 Device ID，未结合浏览器指纹、Canvas 指纹等」 | 现在正好**反过来**：指纹已与身份完全解耦，这条局限性的描述前提不存在了 | 改「设备身份与浏览器指纹已解耦 ⇒ 同一指纹的多台设备之间**没有任何关联判据**（这是有意的产品口径，不是缺口）」 |

### A3. `apps/docs/src/zh-CN/content/backend/modules/security.md`（§4.1 / §4.2）

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `security.md:268` | 小节标题「### 4.1 设备注册与**指纹**」 | 注册已不涉及指纹 | 「设备注册与身份签发」 |
| `security.md:272-273` | 「`device_id = hash(X-Fingerprint, crypto.deviceIdKey)`；指纹是**客户端自报**的请求头，设备身份因此是「自证 + 服务端加盐哈希」，不是硬件证明」 | 整句失效 | 「`device_id` 由服务端随机签发（`d1_`+32hex，`generateDeviceId`）；指纹不再参与身份派生 —— 客户端自报值无法影响自己的身份」 |
| `security.md:274` | 「同 `device_id` 再注册是整体覆盖（设备名、屏幕、硬件信息、IP/位置历史等）」 | 幂等键是 **cookie** 不是「同 device_id」；且**设备名不再被覆盖**（服务端生成、`uq_device_name` 唯一，撞了 23505→40000） | 「带着**合法 `d1_` cookie** 再注册 = 复用该 id 并整体覆盖（屏幕/硬件/IP/位置历史）；无 cookie 或形态非法 = 新签一个。设备名不入覆盖集」 |
| `security.md:281` | §4.2 第 1 步「取签名 `DEVICE_ID` cookie；缺失 → 40605」 | 漏了形态校验（这正是批次 11 的 P0 根因所在的那一处） | 「缺失**或形态不是 `d1_`+32hex**（旧 64-hex / 伪造 / 空）→ **40605**。判据唯一真源：`libs/const/src/app/device.ts`；DB 侧同形态 CHECK」 |
| `security.md:288-289` | §4.2 第 5 步「设备锁定/封禁的写入口是 `PATCH /system/device/:id/{lock,unlock,ban,unban}`」 | 仍对，但**缺**：封禁 = 踢下线（撤 RT + 清会话键 + 断 WS，拍板-4） | 补一句 |
| **缺** | §4.2 没有第 6 步 | 校验通过后按 80% 窗口**滑动续期** cookie（`device.guard.ts:53-71`）没写 | 补第 6 步 |

### A4. `apps/docs/src/zh-CN/content/backend/modules/system-account.md`

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `system-account.md:57` | 「`sys_device.device_id` 是客户端**指纹的服务端加盐哈希**」 | 错 | 「是**服务端随机签发**的 `d1_`+32hex，也是被引用的业务键（`uq_device_id` + CHECK `ck_device_device_id_form`）」 |
| `system-account.md:72` | 小节标题「### 2.1 initial 注册：**指纹派生业务键**」 | 错 | 「服务端签发业务键（幂等键是 cookie）」 |
| `system-account.md:78-81` | 「`device_id = hash(X-Fingerprint, crypto.deviceIdKey)`，由 `SysDeviceRepositoryService.getDeviceIdByFingerprint` → `AppTechCryptoService.hashDeviceFingerprint` 计算（HMAC 形态的带盐哈希）。指纹是客户端自报的请求头……」 | 整段失效，而且**点名的两个函数现在身份路径 0 调用**（`device.repo.service.ts:38-47` 注释自己写了） | 删掉这两个函数名，改「`generateDeviceId()`（`device-id.ts`）；幂等键 = 已有的合法 `d1_` cookie」 |
| `system-account.md:84` | 「覆盖集包含 **`deviceName`** / `deviceInfo`（与 `req.os`/`req.browser` 合并、UA 推导 `deviceType`）/ …」 | `deviceName` **不在覆盖集**，且不由客户端提供 | 从覆盖集删 `deviceName`，另起一句「名字服务端生成 `<类型>_<8hex>`，只在插入时写入」 |
| `system-account.md:87` | 「并发**同指纹**由 `uq_device_id` 决出唯一胜者，败者受控 40605（G3 实测）」 | 「同指纹」不再是并发单位（身份由 cookie 承载）；且 B5 的 R3 已按新语义重写 G3（同 cookie 三路并发 ⇒ 恰一行，且断言「至少一条成功」——限流 42900 也算受控拒绝，所以「败者 40605」的承诺已被撤掉） | 「并发同 cookie，`uq_device_id` 决出唯一胜者；失败侧是受控拒绝（40605 或 42900 限流），语义见 `concurrency.api-spec.ts` 的 G3」 |
| `system-account.md:403` | 端点表「POST `/system/device/initial` …… `{ **deviceName**, sr, vp, hardwareInfo, deviceInfo, private }` → `{ deviceId, latitude, longitude, countryCode }`」 | 载荷多了 `deviceName`（带上即 40099） | 删掉 `deviceName` |

### A5. `apps/docs/src/zh-CN/content/backend/modules/auth.md`

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `auth.md:46-48` | 「`device_id = hash(X-Fingerprint, crypto.deviceIdKey)`（`SysDeviceRepositoryService.getDeviceIdByFingerprint`），即设备主键由客户端自报的指纹派生。按 `device_id` 查到即整体覆盖、否则插入；`device_name` 有唯一约束」 | 派生关系与函数名都失效；「按 device_id 查到」也反了因果（查的是 cookie 里的 id） | 「`device_id` 服务端随机签发；**幂等键是已有的合法 `d1_` cookie**（有则复用、无则新签）；`device_name` 服务端生成且唯一」 |

> 注意 `auth.md:85` **已经正确**写了「批次 8 / B2 起属于风控 fail-close 清单：风控不可用 / 无 deviceId 时直接 40667」。它和 `security.md:306` 直接矛盾 —— 见 B4。

### A6. `apps/server/libs/system/src/device/dto/device.dto.ts`（Swagger description，会进 openapi + api-types）

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `device.dto.ts:33` 与 `:232` | `title: 'device id, also maybe known as fingerprint for client'` | 两处。B5 的全部意义就是「device_id 不是指纹」；而且这句**已经进了生成物**：`apps/server/openapi.json:23554 / 26678 / 29078` 三处 | `'device id, server-issued: d1_ + 32 lowercase hex (never derived from a client fingerprint)'` |
| `device.dto.ts:27` | `title: 'device name, normally cannot change'` | 语义变了：名字由**签发方**生成、`uq_device_name` 全局唯一；「不能改」的原因从「客户端决定」变成「服务端保证唯一」 | `'device name, server-generated as <deviceType>_<8hex> (globally unique, uq_device_name)'` |

> 改这两行会**必然**触发 `pnpm openapi:check` 的 diff（`openapi.json` 3 处 + `@walnut/api-types` 的 `schema.d.ts` 重生成）—— 见第 5 节的批次划分。

### A7. 两个 OAuth controller 的注释（双重过期）

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `apps/server/apps/api/src/modules/auth/modules/oauth/gitee/gitee.controller.ts:69` | 「deviceId 是服务端对指纹做 **HMAC** 得到的 **64 位 hex**（`getDeviceIdByFingerprint`），无密钥不可预测」 | **两个事实同时过期**（HMAC + 64-hex）。而且这里是**安全论证的注释**（为什么要用 deviceId 当 SSE 频道键）—— 论证不成立会误导下一个人 | 「deviceId 是服务端**随机签发**的 `d1_`+32hex（`generateDeviceId`）；32 位 hex = 128 bit 熵，客户端不可预测；cookie 带签名不可自造」 |
| 同上 `github/github.controller.ts:69` | 逐字相同 | 同上 | 同上 |

### A8. `apps/server/libs/crypto/src/crypto.service.ts`

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `crypto.service.ts:90` | 「生成 HMAC 哈希（用于不可逆数据，如 **deviceId**、fingerprint）」 | deviceId 不再是 HMAC 产物 | 把 deviceId 从例子里删掉 |
| `crypto.service.ts:128-131` | `hashDeviceFingerprint` 的 `@param fingerprint 设备指纹（如硬件序列号、MAC地址等拼接后的字符串）` | 方法本身仍在（**刻意保留**：它是 `DEVICE_ID_ENCRYPTION_KEY` 的派生入口），但读注释的人会以为它在身份路径上 | 补「**历史工具，身份路径 0 调用**（B5 起 device_id 服务端随机签发）；保留理由见 `device.repo.service.ts` 的 `getDeviceIdByFingerprint` 注释」 |

### A9. `apps/server/apps/api/src/modules/app/monitor/user/dto/user.dto.ts`（文件内自相矛盾）

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `user.dto.ts:66` | 「`deviceId = HMAC(指纹, 服务端 key)`（实测 MATCH）」 | 在「P0-2 之前」的历史段里，但没标作废；同一文件 `:98-102` 讲的是新语义 | 加括号「（B5 起不再成立：device_id 改为服务端随机签发）」 |
| `user.dto.ts:80-82` | `@WalnutAdminDecoratorFieldString` 的注释「心跳 body 里它是**行键**，带上才有意义」 | **与同文件 `:72-73` 直接冲突**（那里写「行键是服务端从 Cookie 解析的 deviceId，body 的 visitorId 与已存行不一致即 40099」）。批次 8 / B6 起行键早已是 deviceId | 「它只作**校验字段**；行键是服务端从签名 cookie 解析的 deviceId」 |

### A10. `apps/docs/src/zh-CN/content/plans/postgres-migration-phase2.md`（活文档，不在冻结名单）

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `postgres-migration-phase2.md:314` | 「\| deviceId \| device_id \| text \| NO \| — \| UNIQUE（**客户端指纹**，作为被引用业务键，见 Q5）\|」 | 列含义过期 | 「UNIQUE（服务端签发的 `d1_`+32hex；另有 CHECK `ck_device_device_id_form`），作为被引用业务键」 |
| `postgres-migration-phase2.md:336` | `sys_user_device.deviceName`「**用户可改的显示名**」 | 这句话本身对（`PUT /system/user/device/update-name/:deviceId`），但它与 `sys_device.device_name`（服务端生成）在邻近行容易混 | 在表头加一句「`sys_device.device_name` 服务端生成且全局唯一；`sys_user_device.device_name` 才是用户可改的显示名」 |

### A11. 低优先 / 不改但要登记

| 位置 | 情况 | 处置建议 |
|---|---|---|
| `apps/docs/src/zh-CN/content/backend/postgresql.md:97` | 「**设备指纹** / 用户设备 \| 设备信息、IP 与地理位置历史」 | `sys_device` 里存的是设备行，不是指纹。改「设备 / 用户设备」（optional） |
| `apps/docs/src/zh-CN/content/industry-research/backend-architecture-review/` 多处（`:382` 封禁绕过、`:390-393` 前端 deviceName = 类型_指纹前6位、`:413`、`:419`） | 多处旧语义 | **冻结语料，不改**（`check-doc-refs.ts:36` 的 `FROZEN` 正则 + VitePress `ignoreDeadLinks` 白名单都排除它）。可选：在 `index.md` 加一句「B5 已落地，设备身份口径以 `shared/device.md` 为准」 |
| `apps/docs/src/zh-CN/content/frontend/features/fingerprint.md` | 全文只有一行标题 | 空壳页，不是漂移。侧边栏已标「待写」 |
| `apps/docs/src/zh-CN/content/frontend/base/hooks.md:160` | 「`useFingerprint.ts` 生成用户设备指纹，持久化存储，**初始化设备信息**」 | 仍基本对；可在批次 A 里顺手加一句「指纹只作风控特征」 |
| `apps/docs/src/zh-CN/content.md:63` | 「`fingerprint` 指纹挂载到req上」 | 中间件行为仍对（`X-Fingerprint` → `req.fingerprint`）。**但这篇是否还可达需另查**（不在 `content/` 目录下） |
| `reports/**`（batch-8/9/11、review-device、NEEDS-CONFIRMATION） | 大量旧语义 | **冻结历史，不改**。但 `reports/NEEDS-CONFIRMATION.md:27` 的「C2 · 删不删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint`」**是待办**，B5 已给出答案（保留，理由见 `device.repo.service.ts:38-47`）—— 建议**结案**，别让它悬着 |

---

## 3. B 块：本轮其它批次的文档漂移

### B1. 计数腐烂（3 处真错 + 1 处"看起来对"的陷阱）

机械核对方式：枚举 `apps/*` + `packages/*/*` 下的 `package.json`（排除 `node_modules` 与 `apps/docs/.vitepress/cache`），读 `pnpm-workspace.yaml` 的 `packages` 与 `versioning.fixed`。

**实测事实**：workspace 包 = **15**，分组 = **3 apps + 3 platform-any + 2 platform-web + 1 generated + 6 tooling**；`versioning.fixed` 组 = **15** 个成员；有 `walnut` 字段的包 = **12**（`packages/**` 全部，3 个 app 没有）；有 `test` 脚本的包 = **7**。

| path:line | 现在写的 | 实测 | 判定 | 该改成 |
|---|---|---|---|---|
| `README.md:22` | 「**15 个 workspace 包**（3 app + 3 platform-any + **3 platform-web** + 6 tooling）」 | 3+3+**2**+**1**+6 = 15 | **总数对、分组错** —— 而且 3+3+3+6 **恰好也等于 15**，所以任何"加起来验一下"的人都会放过它。`@walnut/ui` 已于 2026-11 批次 1 撤除（platform-web 3→2），`packages/generated/api-types` 整组没登记 | **优先删掉分组数字**，改成「15 个 workspace 包，按目录组分为 apps / platform-any / platform-web / generated / tooling（包数以 `pnpm-workspace.yaml` 的 `packages` 字段为判据）」—— 与根 `AGENTS.md:42-45` 的写法对齐 |
| `apps/docs/src/zh-CN/content/monorepo/release.md:13` | 发版产出「**14 个包**的版本号」 | **15** | 腐烂 | 15（或改判据式：「全部有 version 的 workspace 包」） |
| `apps/docs/src/zh-CN/content/monorepo/reference-repo-comparison.md:210` | 「`walnut` 自定义字段（**14 个包**在写，全仓无读取方）」 | **12** | 腐烂 | 12，或改判据式（「`packages/**` 下的包都在写」） |
| `AGENTS.md:78` | 「`pnpm types:check` 全仓类型检查（admin/docs/**ui** 用 vue-tsc，其余 tsc，server strict）」 | `apps/ui` / `@walnut/ui` **已不存在** | **幽灵包名**，而且**门禁抓不到它**：`check-doc-refs.ts` 的包名正则是 `@walnut/<slug>`（这里是裸 `ui`），路径正则要求以顶层目录开头（`admin/docs/ui` 不是）；`@walnut/ui` 本身还挂在 `ALLOWED_MISSING_PACKAGES`（`check-doc-refs.ts:113`）里 | 「admin/docs 用 vue-tsc」 |
| `README.md:81` | 「`pnpm test`（当前 **7 个包**有 test 任务）」 | **7**（server / contract / utils-core / client / eslint-config / release / scripts） | **正确**，但同样是会腐烂的计数 | 改判据式「清单以各包 `package.json` 为准」（这半句已经有了，只差删数字） |
| `apps/docs/src/zh-CN/content/monorepo/architecture.md:49` | 「已在册的 **6 个包**之一」（tooling） | **6** | 正确，不动 | — |
| `apps/docs/src/zh-CN/content/adr/0019-tsconfig-presets-and-no-mjs.md:122` | 「`versioning.fixed` 单组从 12 个包涨到 **14** 个」 | 现为 15 | **ADR 历史陈述，不改**（它记的是当时的决策） | — |

### B2. knip 读数残留

前提确认：批次 9-B 已在 `knip.md:113` 与 `:117-118` 明确写了「上一节那张表是 2026-11-02 的快照，桶一删就必然过期 —— 别当现状引用」。**那两处不用动。**

| path:line | 现在写的 | 问题 | 该改成 |
|---|---|---|---|
| `apps/docs/src/zh-CN/content/monorepo/knip.md:199-201` | 「`includeEntryExports` 让一部分 barrel 的死导出现身（`platform-web/client` / `utils-core` / `platform-web/http` 三处 barrel 一次报出 **82 条**）」 | **未标日期的旧读数**（82 来自同一张 2026-11-02 快照）；而且 `platform-web/http` 的 barrel **已于批次 4 删除**（同文件 `:95`、`:105-106` 自己写了这件事）—— 这一节却被漏在"历史快照"标注之外 | 「三处 barrel 曾一次报出 82 条（2026-11-02 快照；`platform-web/{client,http}` 的入口**已删**、`utils-core` 已收缩）。**别引用这个数**，判据见上一节」 |
| `apps/docs/src/zh-CN/content/monorepo/knip.md:226-236` | `text` 输出示例：「Unused exports (**40+**)」「Configuration hints (**69**)」，脚注「以上为全仓实测数字（2026-08-08）」 | 那个 `40+` 与 2026-11-02 的 **139** 差一个量级。代码块长得像"现在的输出"，读者不会去看脚注 | 在代码块第一行加 `# 2026-08-08 快照，仅示输出形态`，或把数字替换成 `(N)` |
| `knip.md:74-81` 的表 | 2026-11-02 的 50/24/139/49 | **已被 `:113` 正确标为历史快照** | 不动 |

### B3. CAP 的 ttl 单位与 `min(ttl, 20min)` 窗口 —— **已经写对了**

| 位置 | 内容 | 判定 |
|---|---|---|
| `apps/docs/src/zh-CN/content/backend/modules/security.md:227` | 「**`ttl` 的权威单位是「秒」**（与 `apps/server/db/seed/app_setting.json` 的 `"ttl":3600` 一致）」 | 对 |
| `security.md:228-230` | 三个消费方只允许走 `libs/const/src/app/cap.ts` 的 `resolve*`：`expiresMs = ttl*1000` / cookie `maxAge = ttl*1000` / **校验缓存 `ttl = min(ttl, 20min)`** | 对，且与 `const/app/cap.ts:76-90` 逐字一致 |
| `security.md:237-238` | 「cap.js token **本体寿命是 20 分钟**，第三方硬编码，**与 `ttl` 无关**」 | 对 |
| `security.md:244-246` | 缓存键 + 「TTL = **`min(ttl, 20min)` 秒** —— 缓存不得长于 token 本体寿命」 | 对 |
| **缺口** | `apps/docs/src/zh-CN/content/shared/capjs.md` 只在 mermaid 里写 `expiresMs = ttl(秒) × 1000`（`:149`）与 `maxAge = ttl(秒) × 1000`（`:164`）；正文**没有**「配置单位是秒」「缓存窗口 = min(ttl, 20min)」「token 本体 20 分钟」这三句 | 这是**面向使用者的那篇**。建议补 3 行 + 一句「换算公式的唯一真源是 `libs/const/src/app/cap.ts` 与 `backend/modules/security.md` 第 3 节，本篇不复制」 |

> **结论**：这一条**不需要重写**，只需在 `shared/capjs.md` 补可发现性（3 行），并**明确拒绝**在第二处复制换算公式（本仓已经吃过"同一配置被三种单位读"的亏）。

### B4. 风控分级（敏感端点 fail-close + 40667 + `meta.riskDegraded`）—— **没写进文档，且现有句子是反的**

代码事实：`apps/server/libs/guards/src/guards/risk.guard.ts:28-41,57-70`（`degradeOrReject`）、`cap.guard.ts:93-104`、`risk.sensitivity.ts`（清单唯一真源）、`libs/utils/src/response.ts` + `libs/types/src/walnut-admin/express.d.ts`（`request.riskDegraded`）、`interceptors/response/success.interceptor.ts`（透出成 `meta.riskDegraded`）、`contract/src/response-code.ts:116`（`NOT_ACCEPTABLE_RISK_UNAVAILABLE: 40667`）。

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `backend/modules/security.md:306-309` | 「**口径（P1-13，已修复，2026-10-28）：风险只触发 CAP 升级，不做阻塞**。`recommendation` 不再含 `shouldBlock`……risk.guard 只写 `request.risk` 供 CAP guard 消费；**其 catch 只吞未知异常**，受控 `HttpException`（如 40666 RiskTooHigh）原样放行到全局异常过滤器」 | **两处失效**：① 敏感端点现在**会**拦（**40667**）；② catch 不再是「只吞未知异常」，而是 `degradeOrReject()` 分级 | 保留「不因**风险分**阻塞」，另加一句「因**风控不可用**而阻塞仅限凭据面清单（唯一真源 `libs/guards/src/guards/risk.sensitivity.ts`）→ **40667**；其余端点 fail-open 并把原因写进响应壳 `meta.riskDegraded`」 |
| `backend/modules/security.md:241-243` | 「全局 CAP Guard 的触发条件：`recommendation` **存在**。不存在（Risk 未运行/无 deviceId/评估异常）→ **放行**」 | 现在分级：**敏感端点 → 40667**，其余放行且 `request.riskDegraded ??= 'risk-recommendation-missing'`（`cap.guard.ts:93-104`） | 补这一句（这是"守卫链第三腿"的纵深：即使 Risk guard 被挪走，凭据面也不裸奔） |
| **全站** | `meta.riskDegraded` 在 `apps/docs/**` 里 **0 处**（只有 `reports/` 的日志里有） | 这是**响应壳新增的对外字段**，属 wire 契约 | 写进 `security.md` 第 4.3 节（或 `dto.md` 的响应壳段）：「非敏感端点降级时响应壳带 `meta.riskDegraded = '<reason>'`（`no-device-id` / `risk-evaluation-failed` / `risk-recommendation-missing`）；缺省不传 ⇒ 既有响应零 diff」 |
| `backend/modules/auth.md:85` | 「批次 8 / B2 起属于**风控 fail-close** 清单：风控不可用 / 无 deviceId 时直接 40667」 | **这句是对的** | 不动，但要与 `security.md:306` 收敛：两篇只能有一处讲"口径"，另一处指向它（现在两篇**直接矛盾**） |

### B5. 心跳行键改成 deviceId（批次 8 / B6）—— 文档没同步

| path:line | 现在写的 | 错在哪 | 该改成 |
|---|---|---|---|
| `backend/modules/app-shared.md:214` | `POST /app/monitor/user/state`「匿名上报：**按 `visitor_id` upsert**，联动 `sys_user_device.last_active_at` 与设备 active 状态」 | 行键自批次 8 / B6 起是 **deviceId**；`visitorId` 已降为**校验字段**（与本设备已存行比，不一致 40099 且不写库；首写放行登记） | 「匿名上报：**行键 = 服务端从签名 cookie 解析的 deviceId**；body 的 `visitorId` 只作归属校验（与本设备已存行比，不一致 40099 且不写库，首写登记）；联动 `sys_user_device.last_active_at` 与设备 active」 |
| `backend/modules/app-shared.md:404` | 端点表请求体「`{ visitorId, **deviceId**, userId?, auth, focus, left, currentRouter? }`」 | `deviceId` 已**从 wire 白名单摘除**，带上即 40099（`user.dto.ts:98-102`） | 删 `deviceId`；并在 note 里写「body 带 `deviceId` ⇒ 40099」 |
| `backend/modules/app-shared.md:206` | 「`app_monitor_user` 10 列：`visitor_id`（**唯一**）、`user_id` / `device_id`（松引用、无 FK）……」 | 单看不错（`uq_monitor_visitor` 还在），但与 `:214` 连读会被理解成「visitor_id 是行键」 | 在列清单后补一句「**行键是 `device_id`**（`idx_monitor_device`）；`visitor_id` 的唯一约束只保证『一个指纹只落一行』」 |
| `review/backend/api-catalog.md:181` | 「body `AppMonitorUserDTOUpdateState`」 | 没列字段，**不算漂移** | 不动 |

### B6. 同批视野内的其它腐烂（附带发现，建议一并收）

| path:line | 现在写的 | 实测 | 该改成 |
|---|---|---|---|
| `apps/docs/src/zh-CN/content/review/backend/index.md:397` | 「**pnpm prepush：23 段全部通过**（总 153.1s），含架构边界、syncpack、**actionlint**、ADR 形态……」 | prepush 现 **26 段**；actionlint 本机是 **SKIP** | 见 C2 的统一口径：段数改判据式，actionlint 从"通过"里摘出来 |
| `apps/docs/src/zh-CN/content/plans/libs-decoupling-residuals.md:71` | 「### 9. actionlint **本机已装**（W4 起 workflow-lint 真跑……）」 | 与本文件 `:133`「`pnpm prepush`：23 段全绿（**actionlint 段本机 SKIP**，见 P3）」**自相矛盾**；本机实测 = SKIP | 两处改成同一句 |
| `apps/docs/src/zh-CN/content/plans/libs-decoupling-residuals.md:133` | 「23 段全绿」 | 26 段 | 判据式 |
| `packages/tooling/release/src/release/steps.ts:405` | push 的 `hint`：「（`pnpm --silent prepush`：src/ci/prepush.ts 那张表，**11 段并行**、每段报耗时）」 | **26 段** | 这条会**打到用户屏幕上**（发版时），比文档更显眼 —— 建议改成「一张门禁表（并行、每段报耗时；段数以表为准）」 |
| `apps/docs/src/zh-CN/content/adr/0009-ci-quality-gates.md:27` | 「Pre-push …… `pnpm --silent prepush` — **five sections**: boundaries → types:check → syncpack:lint → lint:workflows → change check」 | 26 段 | ADR **决策正文不改**；在当前状态那行加一句「（当前段数以 `packages/tooling/scripts/src/ci/prepush.ts` 的表为准）」 |
| `apps/docs/src/zh-CN/content/adr/0018-git-hooks-lefthook.md:19` | 「**pre-push 是四条命令的 shell 串**（`pnpm boundaries && pnpm types:check && pnpm syncpack:lint && pnpm lint:workflows`）」 | 同上 | 同上 |

### B7. 本批实跑读数（供批次 13 之后的对照）

```text
pnpm lint:doc-budget     exit 0   6 个常驻文件；最高 AGENTS.md 96%（8312/8700）
pnpm lint:docs-refs      exit 0   351 篇活文档；包名豁免 17 条、路径豁免 8 条
pnpm lint:doc-ts         exit 0   230 篇活文档里的 124 个 ts 块 + 3 个 json 块
pnpm lint:emoji          exit 0   1218 个被跟踪文本文件（6 个常驻文档走严格档）
```

---

## 4. C 块：流水线口径三件

### C1. 根 `AGENTS.md` 字数预算：**96%，只剩 388 字符**

实测（`pnpm lint:doc-budget`，exit 0）：

| 文件 | 占用 | 余量 |
|---|---|---|
| **`AGENTS.md`（根）** | **96%　8312 / 8700** | **388 字符** |
| `apps/server/AGENTS.md` | 97%　6687 / 6900 | 213 字符 |
| `CLAUDE.md` | 89%　1250 / 1400 | 150 字符 |
| `apps/docs/src/zh-CN/content/monorepo/index.md` | 89%　1789 / 2000 | 211 字符 |
| `apps/admin/AGENTS.md` | 88%　2189 / 2500 | 311 字符 |
| `apps/docs/AGENTS.md` | 87%　4024 / 4600 | 576 字符 |

> 门禁的规矩是「超上限红，**用不到一半也红**」⇒ 87-97% 是健康区间的**上沿**。根 AGENTS.md 只要再加两条就会撞线。

**能压缩哪几段（全部是纯重复，删了不丢任何信息）**：

| # | 压哪几段 | 为什么可以删 | 省多少 |
|---|---|---|---|
| 1 | **第「各 app 专属指引」整节（`AGENTS.md:121-125`）** | 与第「包级指引」表（`:59-63`）是**同三个文件、同三条描述**，逐字级重复。删整节，在包级指引表后加半句「各目录规则见对应 `AGENTS.md`，本文件不重复」 | **约 380 字符** |
| 2 | **「仓库结构」代码块里的 apps 三行（`:27-29`）** | 与「技术栈与版本」表（`:16-20`）**同一个包名 + 同一串技术栈 + 同一个端口**，纯重复。代码块只留 `packages/**` 四组（那四行有 `←` 注解、信息量最高） | **约 250 字符** |
| 3 | **`:98-101` 的 `ENV_KEYS` 段** | 「`secrets` 上下文不能出现在 step/job 的 `if` 里」这条已**另有**两处：`.github/workflows/workflow-lint.yml` 头部注释、`apps/docs` 的 CI 文档。根指引只需留下「CI 用 `ENV_KEYS` 解密启用 admin 构建；限制细节见 docs」 | **约 150 字符** |
| 4 | `:9-12` 头部 blockquote 的后两行 | 「包级指引见下表」「架构决策在 docs」这两句是**下一节标题的重复**。注意：`:6-7` 那两行（Claude Code 只读 CLAUDE.md）**必须保留** —— 否则有人会删掉 `CLAUDE.md` 的导入行 | **约 120 字符** |
| — | 合计 | | **约 900 字符 ⇒ 8312 → 约 7400（96% → 85%）** |

**不要做的两件事**：① 调高 `8700` 上限（那是把门禁变成装饰，且这条门禁自己的注释就写着「用不到一半也算失败」的对称理由）；② 把文档站的参考内容搬进来（`apps/docs/AGENTS.md` 重要约定 10 已经明写该问的那句话）。

### C2. actionlint 缺失 = **SKIP 不是 PASS**：机器侧已经"把 SKIP 说成绿"

**机制（读代码确认，不是推测）**：

1. `packages/tooling/scripts/src/ci/lint-workflows.ts:21-27` —— 探测不到 actionlint 时打一行 `warning: 未检测到 actionlint，跳过 workflow 校验（CI 中会强制执行）` 然后 **`return`**；退出码 **0**。
2. `packages/tooling/scripts/src/ci/prepush.ts:284-314` 的执行器**只看退出码**（`ok = true` 除非抛错）；`:324-328` `formatLine()` 对 `ok` 打绿色对勾。
3. `:339-341` 的汇总行：「N 段全部通过（总 Xs）」。
4. 结论：**`pnpm prepush` 的输出里，SKIP 与 PASS 长得一模一样**，汇总行连"有 N 段是跳过"都不提。这正是"把 SKIP 说成绿"的机器侧根因 —— 人看到的是一个绿色对勾 + 「26 段全部通过」。

**文档/报告侧已经说过头的**：

| path:line | 写的 | 判定 |
|---|---|---|
| `apps/docs/src/zh-CN/content/review/backend/index.md:397` | 「prepush：23 段**全部通过**……含……**actionlint**……」 | **把 SKIP 算进绿里**（且段数是旧值） |
| `apps/docs/src/zh-CN/content/plans/libs-decoupling-residuals.md:71` | 「actionlint **本机已装**」 | **与本文件 `:133` 自相矛盾**；本机实测 = SKIP |
| `apps/docs/src/zh-CN/content/plans/libs-decoupling-residuals.md:133` | 「23 段全绿（actionlint 段本机 SKIP，见 P3）」 | 「全绿」+「SKIP」并置，措辞上仍会被读成绿 |

**已经写对的（样板，不动）**：`monorepo/release.md:165`、`monorepo/ci-cd.md:184`、`monorepo/reference-repo-comparison.md:38`、`packages/tooling/scripts/README.md:12` 与 `:88`。

**建议的统一口径（一句话，全仓照抄）**：

> `pnpm lint:workflows` 在**没有 actionlint 的机器上是 SKIP（退出码 0，但一行 workflow 都没校验）**。权威闸门是 `.github/workflows/workflow-lint.yml`（它自己下载二进制并执行 `./actionlint -color`）。所以报告与文档里**必须**写「**本机跳过，CI 侧由 workflow-lint.yml 跑**」，**不许**把它计入「全绿 / 全部通过 / N 段无失败」。
> 同理 `pnpm lint:workflows-shell` 在没有 bash 的机器上也是 SKIP（`check-workflow-shell.ts:136`）；它守的是 actionlint **看不见**的那一面（字符串里的 shell 语法），两者互补、都不能省。

**机器侧的一个最小改进（属独立批，不进本批文档批）**：把 `prepush.ts:340` 的「N 段全部通过」改成「N 段未报错（环境缺失导致的 SKIP 见上）」，或让执行器支持三态（`lint-workflows` 用约定的退出码把 SKIP 报给执行器）。**不要**把 SKIP 改成 exit 1 —— 那会让没装 actionlint 的机器推不了代码，而 CI 侧本来就有权威闸门。

### C3. `db:seed:verify` 该进哪个门禁：**建议两边都不进**（维持现状 + 把触发条件做成可核对）

**事实（实测）**：

| 事项 | 实测 |
|---|---|
| 在 release 电池里吗 | **不在**。`packages/tooling/release/src/release/steps.ts:57-139` 的 `RELEASE_BATTERY` 共 29 条（2 条 `skip`），没有它。电池里那条 `seed` 是 `lint:seed` = **纯静态形态检查**（必需/禁入集合、体积、凭据形状、引用完整性），**不连库** |
| 在 prepush 表里吗 | **不在**。`prepush.ts` 26 段，没有它 |
| 它自己怎么说 | `packages/tooling/scripts/src/db/seed-verify.ts:20-21`：「**不进** prepush / CI：它要一个真实 PG 实例，且会 DROP 两个（本机开发才敢这么干）库名」 |
| 文档怎么说 | `backend/postgresql.md:75-84` **已经写对了**：「改动 seed 形态 / 映射表 / 播种器之后，跑一次双库对拍……它会 DROP/建 `walnut_seed_a` / `walnut_seed_b` 两个库（**不碰**现有库），基线代码与数据从 git 取……**它不进 prepush/CI**：需要真实 PG 实例」 |
| 代价 1：破坏性 | `seed-verify.ts:124-125`：`DROP DATABASE IF EXISTS "<db>" WITH (FORCE)` + `CREATE DATABASE`。`WITH (FORCE)` 会**踢掉该库上所有连接**；库名**固定**（`walnut_seed_a` / `walnut_seed_b`，`:52`） |
| 代价 2：前置数据 | 它自己跑 `pnpm migration:run` 给两个库建表（`:12`），所以要 migration 通道可用 + PG 权限够（建库权限） |
| 代价 3：依赖 git 历史 | 基线默认 `07dacfd6`（`:40`），要能把该 ref 的旧 seed + 旧管线代码取到 `apps/server/.tmp/seed-verify/` ⇒ **`actions/checkout` 的默认 `fetch-depth: 1` 直接跑不了** |
| 代价 4：耗时 | 建两库 + 两次 migration + 两次播种 + 逐表全列比对 + 两次导出比对 ⇒ 分钟级 |

**两个门的判据对照**：

- **release 电池**的判据写在 `steps.ts:44`：「`pnpm release` 是净覆盖最广的面，所以 **CI 里的质量门禁**在这里都要跑一遍」。`db:seed:verify` **不是** CI 门禁（CI 没有 PG 服务），所以它**不满足入电池的判据**。硬塞进去只有两个可能：要么默认 `skip`（与 `build` / `dist-secrets` 同形 —— 每次发版多一行"跳过"噪音，收益近零），要么真跑（把发版机的库清两次，且发版前本来就忙）。
- **prepush 表**的判据写在 `prepush.ts:63-66`：「绝大多数段是**只读**检查；两个例外：`openapi` 段会重写生成物……」。`db:seed:verify` 三条都反着来（**破坏性** + **分钟级** + **需真实库**），而且 pre-push 是**每次 push 都跑**的路径 —— 把「DROP 两个固定库名」放进去，在两个开发者 / 两个并发 push 共用一台库时会**互删**。

**建议（三选一，推荐 A）**：

| 方案 | 做法 | 代价 | 评价 |
|---|---|---|---|
| **A（推荐）** | **两边都不进**，维持 `postgresql.md:83-84` 的现状；把 `seed-verify.ts:20-21` 那句「改了就手动跑一次」**升级成可核对的判据**：在已有的只读门禁 `packages/tooling/scripts/src/ci/check-seed.ts` 里加一条**提示式**断言 —— 当 diff 触到 `apps/server/db/seed/**` 或 `src/db/{seed-reshape,seed-pg}.ts` 时打印「本批改了 seed 通道，请补 `pnpm db:seed:verify` 的读数（不进自动门禁，理由见 `seed-verify.ts` 头部）」 | 小（只加提示，不改门禁语义） | 守住"改了忘验"这个真实风险，又不把破坏性命令塞进自动路径。**与现有文档零冲突** |
| B | 进 release 电池但带 `skip`（与 `build` / `dist-secrets` 同形） | 小改动，但 `release.md:185-188` 的电池表要同步（那张表**靠人工同步**），且每版多一行"跳过" | 只买到"登记可见性"。若目标是"让人知道它存在"，A 的提示行更有效 |
| C | 进 CI 的可选 job（`workflow_dispatch` 或 `paths: apps/server/db/seed/**`），自建 PG service | **中-大**：① `fetch-depth: 0`（要取 `07dacfd6` 的旧代码）；② 多一个 PG service 容器；③ 分钟级 | **唯一能真正自动跑的位置**（runner 的库是干净的，`WITH (FORCE)` 不伤人）。若将来 seed 通道变更频繁，这是正解 |
| 不推荐 | 进 `prepush` | — | 破坏性 + 每次 push + 共享库互删，三条都不可接受 |
| 不推荐 | 塞进 `lint:seed` | — | 那条的价值恰恰是「无库也能跑」，合并会毁掉它 |

---

## 5. 建议的改动批次划分

### 一批做完（同一事实，分开做会留下"半新半旧"的中间态）

| 批次 | 内容 | 为什么能合 |
|---|---|---|
| **13-A 设备身份文档（必做，先做）** | A1 `shared/device.md` 整篇重写（含「身份来源」段 + 2 张 mermaid）+ A2 `shared/sign.md` 2 处 + A3 `backend/modules/security.md` 第 4.1/4.2 节 5 处 + A4 `backend/modules/system-account.md` 6 处 + A5 `backend/modules/auth.md` 1 处 | 5 篇讲**同一件事**（B5 身份签发）。改完跑 `lint:doc-ts`（mermaid 块不受影响）+ `pnpm build:docs`（死链）即可验收 |
| **13-B 计数与旧读数** | B1（`README.md:22/81`、`release.md:13`、`reference-repo-comparison.md:210`、`AGENTS.md:78` 的 `ui`）+ B2（`knip.md` 2 处）+ B6（`review/backend/index.md:397`、`libs-decoupling-residuals.md:71/133`） | 全是"数字与快照"，改完立刻能用 `lint:doc-budget` / `lint:docs-refs` 验；顺带把 `check-doc-refs.ts:113` 的 `@walnut/ui` 豁免**评估**是否该摘（它是幽灵包名长期存活的机制） |
| **13-C 流水线口径** | C2 的统一口径写进 `monorepo/ci-cd.md`（+ `release.md` prepush 段加一句「SKIP 不是 PASS」）+ `steps.ts:405` 的「11 段」改判据式 + ADR 0009/0018 各加一句指向 `prepush.ts` + **C1 的压缩方案**（删 AGENTS.md 两节重复，腾出约 900 字符） | C1 与 C2 都要动常驻/文档面，合批只需跑一次 `lint:doc-budget` |
| **13-D 风控 + 心跳行键（可合）** | B4（`security.md:306-309` 重写、`security.md:241-243` 补分级、`meta.riskDegraded` 首次入文档、与 `auth.md:85` 收敛）+ B5（`app-shared.md:206/214/404`） | 都落在 `backend/modules/` 的两篇里，改动面重叠、可一次验完 |

### 必须单独一批

| 批次 | 内容 | 为什么不能混 |
|---|---|---|
| **13-E Swagger / 代码注释** | A6 `device.dto.ts` 3 处 swagger title + A7 两个 OAuth controller + A8 `crypto.service.ts` 2 处 + A9 `user.dto.ts` 2 处 | 改 `device.dto.ts` 的 swagger ⇒ **必然触发 `pnpm openapi:check` 的 diff**（`openapi.json` 3 处 + `@walnut/api-types` 的 `schema.d.ts` 重生成）。这是"生成物锁步"的独立动作，且 `api-types` 是 workspace 包、会进 `lint:exports` / `knip` 的面。**不要和文档批混**（否则文档的 review 会被生成物的几百行 diff 淹没） |
| **13-F `db:seed:verify` 的门禁归属** | C3 的方案 A/B/C | 无论选哪个都涉及 `steps.ts` 或 workflow 的**执行语义**改动 + `release.md` 电池表同步 —— 属"改门禁"，不是"改文档" |
| **13-G prepush 的 SKIP 三态** | C2 的机器侧修复（`prepush.ts:340` 的措辞，或执行器支持三态） | 改执行器契约，会影响所有 26 段；且要定"SKIP 该不该让 push 失败"这个产品决定 |
| **13-H `reports/NEEDS-CONFIRMATION.md:27` 结案** | 「C2 · 删不删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint`」 | 属**决策归档**（B5 已答：保留，理由是它仍是 `DEVICE_ID_ENCRYPTION_KEY` 的派生入口），不是文档漂移。别混进漂移批 |

### 不建议做的

- **不改** `apps/docs/src/zh-CN/content/industry-research/**` 与 `archive/**`：冻结语料（`check-doc-refs.ts:36` 的 `FROZEN` 正则 + VitePress `ignoreDeadLinks` 白名单）。最多在 `backend-architecture-review/index.md` 加一句指向现状。
- **不改** `reports/batch-{3,4,5,8,9,11}/**`、`reports/review-device/**`：冻结历史。它们写的是"当时的事实"，改了反而破坏证据链。
- **不改** ADR 0009 / 0011 / 0017 / 0019 里的历史计数（`12 个包` / `14 个包`）：ADR 记的是**当时的决策**。只在描述**当前机制**的地方加指向真源的半句。

---

## 6. 边界与未做

- **没跑**：`pnpm test` / `pnpm lint` / `pnpm types:check` / `pnpm prepush`（全量）—— 本批只读调研，且并发的其它批次可能正在改 `apps/**`，跑出来的红无法归因。
- **没跑**：`pnpm build:docs`（VitePress 全量构建是分钟级；本次只改了报告，不动文档站）。
- **没验证**：`shared/device.md` 两张 mermaid 图在亮/暗主题下的渲染（本报告只列"图里写错了什么"，重画后要按 `apps/docs/AGENTS.md` 重要约定 2 实测两个主题）。
- **没查**：`apps/docs/src/zh-CN/content.md`（`:63` 提到 `fingerprint` 中间件）是否还在侧边栏可达 —— 它不在 `content/` 目录下，疑似历史页。若确认是死页，应删而不是改（但那属"文档结构"批次，不属本批）。
- **只统计了 1 台机器**：`actionlint` / `bash` 的存在性都是本机事实；其它机器的 SKIP 组合可能不同（这正是 C2 要统一口径的原因）。
