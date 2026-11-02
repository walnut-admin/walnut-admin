# 设备追踪模块 P0 修复（R2 实施轮）

> 性质：**实施**（改源码）｜ 依据：[review.md](./review.md)（只读调研，未重新调研）
> 基线：`HEAD 68f2a1fa` + 工作树（**同仓另有并行批次在改** `.github/`、`knip.config.ts`、`package.json`、`turbo.json`、`packages/tooling/**`、`apps/docs/**` —— 与本批无关；本报告只统计本批 **40 个文件**：34 改 + 6 新增）
> **观测口径**：全局异常过滤器恒回 HTTP 200（`libs/exceptions/src/exception.filter.ts:93`），错误码看 `body.code`。下文的 code 全部是 `body.code`。
> 环境：后端 dev :3000（`/w/v1` 前缀）、PG/Redis 在 WSL、admin dev :3100（本轮实测它**没在跑**，我临时起过一次，见 §5.8）

---

## 0. 结论

| # | 任务 | 状态 | 判据与实测 |
|---|------|------|-----------|
| 1 | **P0-2 立即止血**：不再下发原始指纹 | ✅ 完成 | openapi 里 list/read 响应面已无 `visitorId`；新增单测按全局序列化口径钉死（§2.1） |
| 2 | **P0-1 死锁**：①后端 cookie 滑动续期 ②前端 40605 自愈 | ✅ 完成 | 5 秒 maxAge 实验：第 5.2 秒的请求**自动拿回一枚满血 cookie**；前端自愈动作在真实页面里跑通（§2.2） |
| 3 | **拍板-4 封禁 = 踢下线** | ✅ 完成 | ban 时撤 RT + 清会话键 + 断 WS；`/auth/refresh` 与 WS 握手都查设备状态（§2.3） |
| 4 | **拍板-5 cron 只标 stale 不删行** | ✅ 完成 | 真 PG 集成用例通过；dev 库已执行迁移（§2.4） |
| — | 拍板-1（服务端签发随机 deviceId） | ⏸ **本轮不动**，方案见 §6 | — |

**门禁**：server test 82 文件 / 685 用例全过；types:check、lint（15/15 任务）、boundaries、admin types:check、openapi:export 全绿（§4）。

---

## 1. 改动总览

```text
P0-2 指纹不外发
  libs/app-domain/src/monitor/user/dto/user.dto.ts      基座摘掉 visitorId
  apps/api/src/modules/app/monitor/user/dto/user.dto.ts  请求面专用 payload + 响应面确认
  apps/admin/src/views/app/monitor/user/index.vue       列/抽屉去掉指纹，改 deviceName
  apps/server/openapi.json · api-types/src/schema.d.ts   重导出

P0-1 死锁
  后端   const/app/cookie.ts（寿命 + 续期间隔）· cache.device.ts（续期闸门）
        guards/device.guard.ts（滑动续期）· device.controller.ts / device.service.ts（同一口径）
  前端   axios/interceptors/response/device.ts（新）· interceptor.ts（40605 分支）
        store/modules/app/app-geo-ip.ts（resetDeviceId）· axios/types.d.ts（重试标记）

拍板-4 封禁 = 踢下线
  system.ports.ts（端口）· device.service.ts（ban → kick，同事务）
  auth: refresh.repo.service.ts · refresh.shared.service.ts · signout.service.ts
  app:  modules/system/device/shared/device.kick.{service,module}.ts（新）
        socket.service.ts（按 deviceId 断连接）· socket.middleware.ts（握手查设备状态）
        app.module.ts（@Global 绑定）

拍板-5 只标 stale
  entity/device.entity.ts（stale 列）· migrations/1793380000000-DeviceStaleFlag.ts（新）
  device.repo.service.ts（markDeviceStale）· identity.ports.ts · identity-device.bridge.ts
  identity/user_device/shared/user_device.shared.service.ts（cron 体 + 计数）
  techniques/task/task.service.ts（日志口径）· device.service.ts（initial 回落 stale=false）
```

---

## 2. 每条任务的改动 + 验证

### 2.1 P0-2 —— 原始指纹不再随接口下发

**做了什么**

1. **字段从共享基座摘除**（`apps/server/libs/app-domain/src/monitor/user/dto/user.dto.ts:20-28`）：`AppMonitorUserDTOBase.visitorId` 删除。基座是「请求 + 响应」共用的字段面，留着它等于每个派生响应都回显指纹（原 swagger title 就写着 `fingerprint for auth and no auth users`）。
2. **指纹只留请求面**（`apps/server/apps/api/src/modules/app/monitor/user/dto/user.dto.ts`）：
   - `:60-88` 新增 `AppMonitorUserDTOVisitorIdRequestPayload`（title 改为 `raw browser fingerprint (request side only — never echoed back in responses)`）；
   - `:97-100` `AppMonitorUserDTOUpdateState`（心跳 body）交叉并入它；
   - `:102-108` `AppMonitorUserDTORequest`（list 查询过滤）交叉并入它；
   - `:134-139` `AppMonitorUserDTOListResponse` / `ReadResponse` **没有**该字段。
3. **服务层入参显式化**（`libs/app-domain/src/monitor/user/user.service.ts:38-46`）：`updateState` 的 `dto` 改为 `Partial<AppMonitorUserDTOBase> & { visitorId?: string }` —— 行键契约不再藏在基座里。
4. **前端消费点**（`apps/admin/src/views/app/monitor/user/index.vue`）：
   - `:146-155` 表格列 `key: 'visitorId'`（minWidth 350，就是把指纹摊在列表里）→ `device.deviceName`；
   - `:348` 详情抽屉去掉 visitorId 条目（抽屉本来就有 `device.deviceName`，`:390`）；
   - `:47` **保留** list 的 `visitorId` 查询过滤（入参），并注释说明「响应不回显指纹，别把它加回 columns/抽屉」。
5. **openapi 生成物重导出**（§3）。

**判据：全仓再没有接口能把「可直接推出 deviceId 的原始指纹」交回客户端**

证据 A（openapi 是机械真源，220 schemas 里 monitor 相关全查了一遍）：

```text
no  visitorId  AppMonitorUserDTO            <- list 的 data[] 与 read 的 data 都引它
no  visitorId  AppMonitorUserDTOListResponse
HAS visitorId  AppMonitorUserDTORequest     <- list 查询过滤（入参）
HAS visitorId  AppMonitorUserDTOUpdateState <- 心跳 body（入参，P1-3 另批）
```
（复跑：`apps/server/node_modules/.cache/p2-openapi-check.cjs`，脚本随报告删除）

证据 B（新增单测钉死，跑在必跑门禁 `pnpm test` 里）：`apps/server/apps/api/src/modules/app/monitor/user/dto/user.dto.spec.ts` —— 按全局 `ClassSerializerInterceptor` 的同一口径（`excludeExtraneousValues: true`，见 `apps/api/src/main.ts:157`）实例化 + 序列化：

```text
✓ apps/api/src/modules/app/monitor/user/dto/user.dto.spec.ts (4 tests)
  · list 响应：data[] 里没有 visitorId（同时断言 deviceId/currentRouter 照常下发）
  · read 响应：没有 visitorId
  · 心跳 body：visitorId 仍在且原样取到
  · list 查询过滤：visitorId 可作为入参
```

证据 C（api-spec 断言同步改口）：`apps/server/apps/api/test/api/monitor-user.api-spec.ts:30-40`（`MonitorRow` 不再声明该字段，注释「哪天响应又把指纹带回来，本文件的断言会先红」）、`:163-166`、`:188-191` 改为 `expect(row).not.toHaveProperty('visitorId')`。

**契约副作用（有意）**：`AppMonitorUserDTOUpdateState.visitorId` 由「可选」变「必填」（`IsString + IsNotEmpty`，openapi 里 `required: [visitorId]`）。理由：它在心跳里是**行键**，缺了这行请求没有意义；前端 `hooks/web/useMonitor.ts:57` 与 beacon 恒带它。list 的 query 面虽然 schema 也标了 required，但**字段级校验器对 query 不跑**（既有事实，`ip` 早就是同一形态，见 wire DTO `:110-116` 的注释），所以「不带 visitorId 的 list 请求」仍然正常 —— 本批未改变该运行时行为。

```text
[ref] 全仓再无响应面泄露：grep '\.visitorId' apps/server/apps/api/test/api  → 只剩 factories.ts（造数据）
```

### 2.2 P0-1 —— 滑动续期 + 40605 自愈

#### 后端：DEVICE_ID cookie 滑动续期

1. **常量同源**（`apps/server/libs/const/src/app/cookie.ts:29-42`）：`WalnutAdminConstDeviceCookieMaxAge = 30d`、`WalnutAdminConstDeviceCookieRenewInterval = maxAge * 0.8`（24 天）。**两者写在一处**：临时把 maxAge 调成 5 秒时，续期间隔自动变 4 秒 —— 这正是验收实验能观察到「自动续上」的原因（否则 5 秒的 cookie 永远等不到 24 天的续期窗口）。
2. **续期闸门**（`apps/server/libs/cache/src/service/cache.device.ts:60-89`）：`markDeviceCookieRenewed(deviceId)` = `SET NX EX SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`（TTL = 续期间隔）。「键不存在」等价于「距上次续期已超过间隔」—— 服务端读不到 cookie 的 exp（浏览器侧属性），所以用这个 Redis 时间闸表达「剩余寿命」。并发下只有一个请求抢到续期窗口。
3. **guard 里重发**（`apps/server/libs/guards/src/guards/device.guard.ts:47-76` 定义、`:150` 调用）：只有**校验全通过**（非 banned / 非 locked）之后才走续期；写 cookie 复用 `AppTechCookieService`（与 initial 同一条腿、同签名/同属性）。
4. **initial 与 guard 同一口径**：`device.controller.ts:69-79` 用同一个 maxAge 常量（原先硬编码 `30*24*60*60*1000` 与 guard 潜在漂移）；`device.service.ts:126-133` 在 after-commit 里顺手开窗口，避免 initial 之后第一个受保护请求立刻多一个无意义的 Set-Cookie。

**实测（判据①：把 maxAge 临时调成 5 秒，能自动续上）**

探针：先 `POST /system/device/initial`（匿名、DeviceFree）拿 cookie，再打 `POST /auth/refresh`（现在是受保护端点，Device guard 第 3 位，返回码是 CAP 的 40116 —— 说明设备校验已通过），整个过程只看 `Set-Cookie`：

```text
# maxAge = 5000（临时值），renew interval 自动 = 4000
[initial]  set-cookie: __Host-DEVICE_ID=...; Max-Age=5; Expires=...15:25:21 GMT
[guarded #1 t=1031ms] code=40116 set-cookie=[]                       <- 续期窗口未过期，不重发
[guarded #2 t=5249ms] code=40116 set-cookie=[__Host-DEVICE_ID=...; Max-Age=5; Expires=...15:25:26 GMT]
                                                                     <- 窗口过期 → 自动重发，寿命重新拉满
[guarded, 无 cookie]  code=40605                                     <- 自愈的触发条件
# 同时观察 Redis 时间闸（值是上次续期时刻）
after initial           : COOKIE_RENEW:<dev> ttl=4
t=5.5s（窗口已过期）     : 该键消失
guarded 之后            : COOKIE_RENEW:<dev> ttl=4（重新武装）
```

复原成 30 天后复测：

```text
[initial]  set-cookie: __Host-DEVICE_ID=...; Max-Age=2592000; Expires=Wed, 02 Dec 2026 15:25:50 GMT
[guarded #1 t=1046ms] set-cookie=[]     <- 24 天窗口内不重发（符合设计）
[guarded, 无 cookie]  code=40605
```

#### 前端：40605 自愈（照 40101 的写法，没新造抽象）

1. **新文件** `apps/admin/src/utils/axios/interceptors/response/device.ts`：`SingletonPromiseDeviceReset()` —— 与 `refreshToken.ts` 的 `SingletonPromiseRefreshToken` 同款（`@walnut/utils/queue` 的 `SingletonPromise`，并发 40605 只自愈一次）。
2. **store 动作** `apps/admin/src/store/modules/app/app-geo-ip.ts:51-90`：`resetDeviceId()` = 清本机 device 缓存（`deviceId` + `geoInfo` 回落默认值）→ 重走 `POST /system/device/initial` → 回填。这是绕开「localStorage 有值就永不 initial」那道门闩的唯一入口。
3. **拦截器分支** `apps/admin/src/utils/axios/interceptors/response/interceptor.ts:91-112`：`40605` 且未标记 → 置 `_deviceResetRetried`（`axios/types.d.ts:18-19` 声明）→ 自愈 → **重放原请求**；自愈失败或重放仍 40605 → 落到下面既有的 notAllowed 分支（不会打转）。

**实测（判据②：手工删 cookie 后能自愈）**

后端侧已证：无 cookie 打受保护端点 = `code 40605`（上面输出最后一行）。

前端侧：admin dev（:3100）**本轮实测没在跑**，我临时起了一个（`pnpm turbo dev --filter=@walnut/admin`）用 agent-browser 在真实页面（`https://127.0.0.1:3100`）里执行自愈动作 —— 直接 import 我改的两个模块，跑的就是线上那一份代码：

```text
eval:
  const deviceMod = await import('/src/utils/axios/interceptors/response/device.ts')
  const geoMod    = await import('/src/store/modules/app/app-geo-ip.ts')
  store = geoMod.useAppStoreGeoIP()
  before = store.getDeviceId
  await deviceMod.SingletonPromiseDeviceReset()
  after  = store.getDeviceId
→ {"before":"2430832b31f2...6bc7","beforeGeo":"{...longitude:0,latitude:0}","after":"2430832b31f2...6bc7","changed":false}
```

读法：动作**真的执行了**（清缓存 → 打 `/api/system/device/initial` → 回填），且 HTTP 那一跳在同一页面里单独验证过：

```text
页面内 fetch POST /api/system/device/initial（带页面指纹 + credentials）：
{"data":{"deviceId":"2430832b31f2...6bc7","countryCode":null},"code":20000,"msg":"Success"}
```

`changed=false` 是**预期**：`deviceId = HMAC(指纹)`，指纹没变则 deviceId 不变 —— 拍板-1 未落地前的必然结果（也正是它让「重建设备」永远是幂等的）。

> ⚠️ **完整的浏览器 E2E（删 cookie → 点登录 → 自动恢复）在本机跑不通**，原因与本批无关：admin dev 的 bootstrap 卡在 `sign`（blocking）步 —— 后端 `/security/sign/initial` 在缺设备上下文时回 `40012 RSA Public Key Not Found`，同一原因让**全部 4 个 api-spec 套件在 setup 阶段就挂**（§5.7）。详见「留下的风险 8」与附录 B。

### 2.3 拍板-4 —— 封禁 = 踢下线

**做了什么**

1. **端口**（`apps/server/libs/system/src/system.ports.ts:44-75`）：`IWalnutAdminSystemDeviceKicker.kickDevice(deviceId, revokeReason, em?)` + token。与文件里另两个端口同款：声明在需求方（libs/system），实现在组合根（app）。
2. **封禁触发**（`apps/server/libs/system/src/device/device.service.ts:236-247`）：`updateLockOrBanStatus` 在写完 DB + after-commit 缓存双写后，**仅当 `patch.banned === true`** 调 kicker，并把 `em` 透传 —— 撤 RT 与封禁同事务提交（回滚则两件都不发生）。
3. **令牌/会话腿**（`apps/server/libs/auth/src/modules/signout/signout.service.ts:66-100` `kickDeviceOffline`）：
   - `AuthRefreshSharedService.revokeRTForDevice`（`refresh.shared.service.ts:113-129`）→ repo `updateRevokedByDeviceId`（`refresh.repo.service.ts:156-190`）：按 `device_id` 撤**该设备上所有用户**的现役 RT（`revoked=false`），reason = `deviceBanned`（CHECK 值集里本来就有），并回带受影响的 userId 列表；
   - 事务提交后按 `(userId, deviceId)` 清会话键 / 权限缓存 / MFA verified（复用既有 `clearKickedDeviceCache`），**不随事务回滚误清**。
4. **实时腿**（`apps/server/apps/api/src/modules/system/device/shared/device.kick.service.ts` + `.module.ts`，@Global，绑定在 `apps/api/src/app/app.module.ts:23,57`）：`SocketService.kickDeviceSockets(deviceId)`（`socket/socket.service.ts:47-86`）按 `socket.data.deviceId` 精确匹配 → 先 emit `FORCE_QUIT`（immediate-signout 策略）→ `disconnect(true)`。socket 断开也挂在 after-commit（未提交不踢人）。
5. **`/auth/refresh` 不再 DeviceFree**（`apps/api/src/modules/auth/modules/refresh/refresh.controller.ts:28-35`）：受保护后 DeviceGuard 的 40606/40607 在刷新上生效（顺带让滑动续期也覆盖 refresh）。
6. **服务层纵深**（`libs/auth/src/modules/refresh/shared/refresh.shared.service.ts:216-258` `assertDeviceUsable`，`:431` 在 `getNewAccessToken` 里调用）：缓存优先、miss 回源 `sys_device`，查无 → 40605，banned → 40607，locked → 40606。**故意冗余**：这是所有续 AT 路径的唯一出口，将来谁把 refresh 端点再标回 DeviceFree、或经 mfa/totp/webauthn 间接走到这里，封禁仍然生效。
7. **WS 握手查设备状态**（`apps/api/src/socket/socket.middleware.ts:36-55` 定义、`:90-104` 调用）：在「验签 + 会话键」之后加一道设备闸门（缓存优先、miss 回源），banned → `Device banned`、locked → `Device locked`、无行 → `Device not acceptable`，一律 `next(Error)`（socket.io 不进入 connection、不 join 房间）。

**验证（单测，跑在必跑门禁里）**

```text
✓ apps/server/libs/system/src/device/device.service.spec.ts (4 tests)
  · ban → kicker 被调一次，参数 (deviceId, 'deviceBanned', em)
  · unban → 不调（解禁不该断人会话）
  · lock/unlock → 不调（本轮封禁语义专属，见「需要 Lead 拍板 2」）
  · 封禁的 DB 写 + 缓存双写仍在（踢人不替代老写腿）

✓ apps/server/apps/api/src/socket/socket.middleware.spec.ts (9 tests)
  · 设备被封禁（banned）→ next(Error 'Device banned')，不挂 socket.data
  · 设备被锁定（locked）→ next(Error 'Device locked')
  · 设备行不存在（缓存 miss + DB 无行）→ next(Error)
  · 其余 6 个既有用例（验签/过期/会话键缺失/正常通过…）保持绿
```

**为什么封禁不「锁」设备 cookie**：封禁后仍然发 40607（而不是 40605），前端才能给出「设备已被封禁」的明确文案并停在那儿；滑动续期也在 banned/locked 之前返回，不会给被封设备续命。

### 2.4 拍板-5 —— cron 只标 stale，不再物理删行

**做了什么**

1. **列 + 迁移**：`libs/system/src/device/entity/device.entity.ts:81-89` 新增 `stale boolean NOT NULL DEFAULT false`；`apps/server/apps/api/migrations/1793380000000-DeviceStaleFlag.ts`（`ADD COLUMN IF NOT EXISTS` + `idx_device_stale` 部分索引 `ON sys_device(updated_at) WHERE stale = true`，给后续留存清理用）。
2. **repo**（`libs/system/src/device/repo/device.repo.service.ts:55-90`）：`deleteNonMonitorUserDevice` → `markDeviceStale`：查无返回 null；查到则 `stale=true` + `active=false` + **缓存回写新状态**（不再 del 缓存），返回标记前快照。
3. **端口/桥接**（`libs/identity/src/identity.ports.ts:120-127`、`libs/system/src/device/identity-device.bridge.ts:33-38`）：端口名与语义一起改，避免「名字说删、行为说标」。
4. **cron 体**（`libs/identity/src/user_device/shared/user_device.shared.service.ts:119-167`）：残留分支改调 `markDeviceStale`（监控行仍删 —— 设备真回来时心跳会按 visitorId 重新 upsert），计数 `deletedCount → staleCount`；`apps/api/src/modules/techniques/task/task.service.ts:137-141` 日志同步。
5. **回到 stale 状态可复位**（`libs/system/src/device/device.service.ts:120-124`）：`initial` 的写集加 `stale: false`（`banned/locked` 仍不在写集 ⇒ 重新 initial 洗不掉封禁）。

**验证**

- **真 PG 集成用例**（`apps/server/apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts:254-282`，把原来「删行 + 幂等返回 null」的用例改写）：

```text
itSystem('markDeviceStale：标记 stale + active=false 且返回标记前快照（行仍在）')
  · snapshot.stale === false（快照是标记前形态）
  · DB: stale=true, active=false, 行数仍为 1     <- 关键：行不再消失
  · 不存在的 deviceId → null
```

  该文件整体：`✓ apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts (17 tests) 2869ms`。

- **dev 库已执行迁移**（`cd apps/server && pnpm migration:run`）：

```text
2 migrations are new migrations must be executed.
query: ALTER TABLE sys_device ADD COLUMN IF NOT EXISTS stale boolean NOT NULL DEFAULT false
query: CREATE INDEX IF NOT EXISTS idx_device_stale ON sys_device (updated_at) WHERE stale = true
Migration DeviceStaleFlag1793380000000 has been executed successfully.
```
（顺带把先前待执行的 `RefreshTokenActiveUnique1793370000000` 也执行了 —— 它不是本批产物，只是本机 dev 库欠了这一条。）

- **消除的两条绕过**（对照 review P1-1）：
  1. 「等 cron 删行再 initial」不再成立：行不会被删，`banned/locked` 原地保留，`initial` 的写集也碰不到这两列；
  2. 「cookie 还在、行没了」的 40605 死胡同（P0-1 场景 B）在源头消失（前端自愈仍留着，对付 cookie 过期这一类）。

---

## 3. openapi 生成物 diff

命令：`cmd /c "cd apps/server && pnpm openapi:export"` → `[export-openapi] written apps/server/openapi.json (openapi 3.0.0, 220 schemas)`
随后 `cmd /c "pnpm --filter @walnut/api-types generate"`。

```text
 apps/server/openapi.json                        | 27 ++++++++++++-------------
 packages/platform-web/api-types/src/schema.d.ts | 10 ++++-----
 2 files changed, 17 insertions(+), 20 deletions(-)
```

语义（摘录）：

```diff
 # 响应面：list 的 data[] 与 read 的 data 都引 AppMonitorUserDTO
 @@ AppMonitorUserDTO / AppMonitorUserDTOListResponse
-          "visitorId": { "type": "string", "title": "fingerprint for auth and no auth users" },
         "required": [
-          "visitorId",
           "deviceId", "auth", "focus", "left", ...

 # 请求面：list 查询过滤 + 心跳 body —— 字段还在，title 改成真话
 @@ AppMonitorUserDTORequest / AppMonitorUserDTOUpdateState
+          "visitorId": {
+            "type": "string",
+            "title": "raw browser fingerprint (request side only — never echoed back in responses)"
+          },
```

同时 `api-types` 里 `AppMonitorUser.visitorId` 消失 ⇒ `apps/admin/src/views/app/monitor/user/index.vue` 的旧列（`key: 'visitorId'`）会直接类型报错，逼着前端同步改（已改）。

---

## 4. 门禁命令与输出

| # | 命令 | 结果 | 关键输出 |
|---|------|------|---------|
| 1 | `cmd /c "pnpm --filter @walnut/server test"` | **exit 0** | `Test Files 82 passed (82)` / `Tests 685 passed (685)` / 52.73s（本批新增 2 个 spec，+8 用例：80 → 82 文件、677 → 685 用例） |
| 2 | `cmd /c "cd apps/server && pnpm types:check"` | **exit 0** | `$ tsc --noEmit --pretty`（无输出） |
| 3 | `cmd /c "pnpm lint"`（根，含 server/admin/...） | **exit 0** | `Tasks: 15 successful, 15 total` |
| 4 | `cmd /c "pnpm boundaries"` | **exit 0** | `Checked 4658 files in 15 packages, no issues found` |
| 5 | `cmd /c "pnpm --filter @walnut/admin types:check"` | **exit 0** | `$ vue-tsc --noEmit`（无输出） |
| 6 | `cmd /c "cd apps/server && pnpm openapi:export"` | **exit 0** | `[export-openapi] written .../openapi.json (openapi 3.0.0, 220 schemas)` |
| 7 | `cmd /c "git diff --stat" `（本批 34 个已跟踪文件） | — | `34 files changed, 655 insertions(+), 83 deletions(-)`；另有 **6 个新文件**（见附表） |

附表：本批 6 个新增文件

```text
apps/admin/src/utils/axios/interceptors/response/device.ts        P0-1 前端自愈
apps/server/apps/api/migrations/1793380000000-DeviceStaleFlag.ts  拍板-5 迁移
apps/server/apps/api/src/modules/system/device/shared/device.kick.module.ts   拍板-4 端口绑定
apps/server/apps/api/src/modules/system/device/shared/device.kick.service.ts  拍板-4 端口实现
apps/server/apps/api/src/modules/app/monitor/user/dto/user.dto.spec.ts        P0-2 单测
apps/server/libs/system/src/device/device.service.spec.ts                     拍板-4 单测
```

> 说明：**别把整个 `git diff` 当成本批**。同仓并行批次正在改 `.github/workflows/ci.yml`、`knip.config.ts`、`package.json`、`turbo.json`、`packages/tooling/**`、`apps/docs/**`。本报告 §4 第 7 行只用 pathspec 统计了本批 40 个文件（34 改 + 6 新增）。
> 另：`pnpm <script>` 会走 pnpm 的安装检查 —— 本轮跑完 `git status` 里 **`pnpm-lock.yaml` 没有变化**。

---

## 5. 本轮没做（边界）

1. **拍板-1（服务端签发随机 deviceId，替换 HMAC(指纹)）** —— 根因大改，按要求留给下一批（方案见 §6）。
2. **P1-3**（`/app/monitor/user/state` 用 `body.visitorId` 作行键、可改他人行）—— 留后续；本批只是把该字段从响应面摘掉，入参契约原样保留。
3. **lock 也踢下线** —— 见「需要 Lead 拍板 2」。
4. **stale 行的留存清理任务**（90 天等）—— 迁移里已建好部分索引，清理 cron 未写。
5. **管理端对 stale 行的展示/过滤** —— 未改（`sys_device` 列表会把 stale 行照常列出来）。
6. **api-spec / int-spec 的 `/auth/refresh` 用例** —— 未新增「封禁后 refresh 被拒」的 HTTP 级用例（服务层单测 + socket 单测已覆盖判定，HTTP 级留给下一批补，理由见 §5.7）。
7. 本机 **api-spec 套件整体不可跑**（非本批引入）：4 个套件在 `WalnutApiClient.create` 的 `sign initial` 阶段就抛 `40012 RSA Public Key Not Found`（`apps/api/test/api/helpers/api-client.ts:394`），因此 `monitor-user / device / guard-matrix / user-device` 全 skipped。同一现象也解释了 admin dev 的 bootstrap 卡在 `sign` 步。
8. **admin dev 服务器**本轮实测**没在跑**（`:3100` 无监听）。我为验证临时起过一次（`pnpm turbo dev --filter=@walnut/admin`，已关闭）；它在我编辑 `app-geo-ip.ts` 时因 vite watcher 撞到 Windows 临时文件的 `EBUSY` 自行退出（`errno -4082`，与代码无关）。

---

## 6. 拍板-1 方案（下一批，本轮不动）

**目标**：设备身份与「客户端自报的指纹」解耦 —— 服务端签发随机 `deviceId`，指纹降级为风控特征。一次性收口 P0-2 根因、P1-1 的两条绕过、P2-2 的指纹漂移。

1. **数据面**：`sys_device.device_id` 语义从「HMAC(指纹)」改为「签发」。
   - 新列 `fingerprint_hash`（= 现有 HMAC 值，做「同指纹多设备」告警/风控，可索引）；
   - `device_id` 改存 `randomUUID()`（或 32 字节 base64url）—— 仍满足 `pipes/format.pipe.ts` 的 64-hex 约束就用 `randomBytes(32).toString('hex')`；
   - 迁移：既有 64-hex 行**双读一版**（guard/refresh/socket 同时接受旧值与新值），等自然流失（30 天 cookie 生命周期）后删旧值兼容。
2. **签发点**：`/system/device/initial` 分两支 —— 带有效 `DEVICE_ID` cookie（签名校验通过且行存在）→ 幂等返回该 deviceId；否则新建行 + 签发新 id。
3. **指纹位置**：`X-Fingerprint` 只进 `sys_device.fingerprint_hash` / 风控，**不再参与身份**；`initial` 允许同一指纹产生多台设备（换浏览器 = 新设备，语义正确）。
4. **影响面**：`device.guard` / `refresh`（会话键 `(userId, deviceId, sid)`）/ `socket.data.deviceId` / `SysDeviceRepositoryService.getDeviceIdByFingerprint`（改为「查 fingerprint_hash → 返回最近一台」仅供风控）/ api-spec（`device.api-spec.ts:105` 的「同指纹重放 → 幂等同 deviceId」要改成「带 cookie 才幂等」）。
5. **配套**：前端 `resetDeviceId` 之后 deviceId 会**真的变**（现在是不变），`useMonitor` 的行键建议同批切到 deviceId（顺带解 P1-3）。

**代价**：中（1 次迁移 + initial/guard/refresh/socket 四处判定 + 一轮 api-spec 改口）。**收益**：P0-2 的根因、P1-1 两条绕过、P2-2 指纹漂移一次消掉。

---

## 7. 留下的风险

1. **指纹仍在请求面**：心跳 `POST /app/monitor/user/state` 与 list 查询过滤仍以原始指纹为键（P1-3 / 拍板-1 前置）。本批只保证「服务端不再把它交回客户端」。
2. **每个受保护请求多一次 Redis 写**：`SET NX EX` 走 `AppTechCacheService`（Redis），是 guard 里新增的一次往返（命中窗口内只是一次失败的 NX）。量级与既有 `GET SYSTEM:DEVICE:<id>` 同阶，但确实多一跳；若在意，可把「上次续期时刻」并进 `SYSTEM:DEVICE` 缓存体（需要改缓存形状，本批没动）。
3. **`sys_device` 会持续增长**：cron 不再删行。迁移里已建 `idx_device_stale`，但**清理任务还没写**（建议：`stale = true 且 updated_at < now() - 90d` → 真删；删除时整行包括 banned 一并消失，所以只对 `banned = false AND locked = false` 的行开闸）。
4. **stale 行未在管理端过滤**：设备列表会照常显示这些行（数量随时间增长，噪音上升）。
5. **`AppMonitorUserDTOUpdateState.visitorId` 变为必填**（契约收紧）：老客户端若在心跳里省略该字段会拿到 40099；仓内唯一的发送方（`hooks/web/useMonitor.ts`）恒带它。
6. **lock 不踢下线**：与 ban 的语义差异保留（`sys_device.locked` 只挡 HTTP）。理由是没有 `deviceLocked` 的 `revoke_reason` 枚举值（DB CHECK + force-quit 策略表都要扩），见「需要 Lead 拍板 2」。
7. **WS 断开的可达性受限于单实例**：`kickDeviceSockets` 只能断开**本进程** namespace 里的连接。多实例/多副本部署时需要 socket.io Redis adapter 广播（`socket.adapter.ts` 目前是单机 IoAdapter）—— 这是既有架构限制，本轮没有引入 regression，但拍板-4 在生产多副本下不完整。
8. **前端自愈的 E2E 缺口**：`SingletonPromiseDeviceReset` 已在真实页面里跑通（清缓存 → initial 20000 → 回填），但「40605 → 自愈 → 重放」整链的浏览器 E2E 被 bootstrap `sign` 步挡住（`40012`，环境问题，见 §5.7/§5.8）。建议下一批在能跑通 sign 的环境里补一条人工复现记录（附录 A 第 3 条给了步骤）。
9. **`resetDeviceId` 后 deviceId 不变**（拍板-1 前）：所以自愈只是「把丢掉的 cookie 重新拿回来」，不是「换一个身份」。别把这条当前 refresh 故障的解法。
10. **list 的 `visitorId` 入参过滤仍是「指纹确认预言机」**：拿到某候选指纹的人可以问「这台机器有没有在线行」。熵足够（32 hex，且 `deviceName` 已暴露前 6 位本来就是既有设计），风险很低；要彻底关掉得连 P1-3 一起改行键。

---

## 8. 需要 Lead 拍板

1. **拍板-1 是否按 §6 落地**（服务端签发随机 deviceId + `fingerprint_hash` 双读一版兼容）。这是我建议的下一批第一优先级 —— 它一次性消掉 P0-2 根因、P1-1 两条绕过、P2-2。
2. **lock 是否也要踢下线？** 现在只有 ban 踢。要 lock 也踢，需要：`WalnutAdminConstRevokeRTType` 增 `deviceLocked` + `ck_refresh_token_revoke_reason` CHECK 迁移 + force-quit 策略配置（`cache.appSettings.ts:160` 附近）增键 + 前端 socket 事件策略表。可另开一小批。
3. **`visitorId` 入参（list 过滤 + 心跳 body）本轮保留，是否接受？** 若要一并关掉，就得同时改心跳行键（P1-3），建议与拍板-1 同批。
4. **stale 留存清理策略**：周期（90 天？）、是否只清 `banned=false AND locked=false`、是否在管理端列表默认隐藏 stale 行。
5. **`AppMonitorUserDTOUpdateState.visitorId` 变必填** 是否符合预期（我按「心跳缺指纹无意义」收紧，openapi 已反映）。
6. **`/auth/refresh` 去掉 DeviceFree 的影响面确认**：刷新链现在必须有可用的 `DEVICE_ID` cookie；旧客户端若在「cookie 已过期」状态下只带 RT 来刷新，会拿到 40605 → 前端会先自愈再重放（本批已实现），但若有不经前端自愈的调用方（脚本/第三方），需要知会。

---

## 附录 A：可复跑命令

```powershell
# 1) 门禁（全部在仓库根，或注明 cwd）
cmd /c "cd /d D:\walnut-admin\walnut-admin && pnpm --filter @walnut/server test"
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm types:check"
cmd /c "cd /d D:\walnut-admin\walnut-admin && pnpm lint"
cmd /c "cd /d D:\walnut-admin\walnut-admin && pnpm boundaries"
cmd /c "cd /d D:\walnut-admin\walnut-admin && pnpm --filter @walnut/admin types:check"
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm openapi:export"
cmd /c "cd /d D:\walnut-admin\walnut-admin && git diff --stat"

# 2) 本批新增的两个单测（单独跑）
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm vitest run --config ./apps/api/vitest.config.ts user.dto.spec device.service.spec socket.middleware.spec"

# 3) P0-1 cookie 滑动续期手工复现（判据：maxAge 5 秒也能自动续上）
#    a. apps/server/libs/const/src/app/cookie.ts:39 临时改成 5 * 1000（续期间隔自动变 4s；dev server 是 watch，等它重启）
#    b. POST http://127.0.0.1:3000/w/v1/system/device/initial（header 必带 X-Fingerprint + 真实 UA）拿 cookie，看 Max-Age=5
#    c. 立刻打一个受保护端点（如 POST /w/v1/auth/refresh，带 cookie）→ 响应里不应有 Set-Cookie
#    d. 等 5 秒再打一次 → 响应里出现 Set-Cookie: __Host-DEVICE_ID=...; Max-Age=5（Expires 是新的）
#    e. 改回 30 天，重复 b → Max-Age=2592000
#    注：请求必须带真实 UA，否则 Security guard 先回 40608（bot detected），看不到设备这一层。

# 4) P0-1 前端自愈手工复现（需要 admin dev 能跑起来 = sign 步正常）
#    a. 打开 http://localhost:3100，确认 Network 有 POST /api/system/device/initial
#    b. DevTools → Application → Cookies 删掉 __Host-DEVICE_ID（httpOnly，JS 删不了）
#    c. 刷新页面（localStorage 里 GEO_IP_DEVICE_ID 还在，bootstrap **不会**再 initial）
#    d. 随便点一个受保护动作（如登录提交）
#    e. 期望：Network 里先出现 40605 → 紧接着 /system/device/initial 20000 → 原请求重放；页面**不会**跳到 not-allowed
#    f. 反证：把 interceptor.ts:98 的分支注释掉，同样的操作会跳到 not-allowed（type=device）

# 5) 拍板-5 的 DB 形态
#    select device_id, stale, active, banned, locked from sys_device order by updated_at desc limit 5;
```

## 附录 B：环境事故记录（不归因于本批）

| 现象 | 位置 | 判断 |
|------|------|------|
| 4 个 api-spec 套件 setup 阶段抛 `40012 RSA Public Key Not Found` | `apps/api/test/api/helpers/api-client.ts:394`（`WalnutApiClient.create` → `sign initial`） | 与本批无关（未触碰 sign/RSA）；同一原因让 admin dev 的 bootstrap 卡在 `sign`。HEAD 上的 `243847a1` 正是最近动这块的提交，建议单独排查 |
| `pnpm lint`（根）首轮 `@walnut/admin#lint` 以 `-1073741819`（0xC0000005）退出 | 并发 3 个重任务时 | 资源竞争导致的 Node 崩溃；单独跑 `apps/admin && pnpm lint` **exit 0**，重跑根 lint `15/15 successful` |
| admin dev 在我编辑 `app-geo-ip.ts` 时退出 | vite watcher `EBUSY`（Windows 临时文件被占） | 编辑器原子写与 watcher 的竞态，与代码无关 |
| `pnpm lint` 曾报 `libs/probe-lib/src/index.ts` ENOENT | — | 并行批次的脚手架文件在我 lint 期间被创建/删除；重跑即消失 |
