# 批次 11 · B5 收尾 —— R2 实施轮报告

- 起点：`9a7f860d`（工作树 clean；唯一未跟踪物是 `reports/batch-11/`）
- 依据：`reports/batch-11/r1-migration.md`（**本轮未重做调研**，只按它的结论动手；与它有出入的地方逐条记在 §6）
- 性质：实施轮。**未 git commit**。
- 口径：HTTP 恒 200 看 `body.code`；dev 库 = `apps/server/env-local/.env.development` 的 `DATABASE_PG_*`；pnpm 一律 `cmd /c "pnpm ..."`。

---

## 0. 结论速览

| # | 做了什么 | 关键读数 |
|---|---|---|
| 1 | `WalnutAdminPipeDeviceId` 从 64-hex 改成用 `isValidDeviceId()`（谓词式） | `user-device.api-spec` 7/7 绿（改造前 5 failed，4 条是 `expected: 64-char hex string`） |
| 2 | 心跳 `visitorId` 校验从 `HMAC(指纹)===deviceId` 改成「与本设备已存行比」 | `monitor-user.api-spec` 12/12 绿（改造前 7 failed，全是 `visitorId does not belong to this device`） |
| 3 | 陈断言 `deviceName` 改成服务端生成形态 | 同文件断言 `/^desktop_[0-9a-f]{8}$/` |
| 4 | DDL **只一条**：`ck_device_device_id_form` CHECK（+ revert） | `migration:run` → 约束在 → `revert` → 约束没了 → 再 run：三轮实测见 §2.3 |
| 5 | 90 天留存清理：独立 cron 服务 + 同事务删 monitor 行（system 通道） | 新增 5 条集成用例全绿（含 banned/locked/活心跳/活 RT 不动、RLS 负对照） |
| 6 | P4：`deviceName` 从 Initial DTO 摘除，重导 openapi + api-types | `openapi.json` **-5 行**（纯 deviceName）；`schema.d.ts` 另有 380 行 40667 catch-up（预存在漂移，见 §4.3） |

门禁（全绿）：unit **101 文件 / 833 条**（HEAD 是 99/827）、`types:check` 15/15、`lint` 15/15（仅 3 条预存在 warning）、`boundaries` 4692 文件 15 包无问题、integration **分片合计 8 文件 / 69 条**（见 §5）。

---

## 1. 三处「运行时已坏 / 断言已陈」

### 1.1 管道：`WalnutAdminPipeDeviceId` 改谓词式（4 个路由从「恒 40099」恢复）

改动：

- **新增 `apps/server/libs/const/src/app/device.ts`**：`DEVICE_ID_PATTERN` / `WALNUT_DEVICE_ID_PREFIX` / `isValidDeviceId()` 搬到这里 —— 判据的**唯一真源**。
- `libs/pipes/src/base/format.pipe.ts`：基类第一个参数从 `RegExp` 放宽为 `{ test(value: string): boolean }`（`IWalnutAdminPipeValueMatcher`），`WalnutAdminPipeDeviceId` 传 `{ test: isValidDeviceId }`，**不再抄正则**。
- `libs/system/src/device/device-id.ts`：只留 `generateDeviceId()`，`isValidDeviceId` / 前缀从 const **再导出**（`@walnut-server/system` 的既有 import 面不变，`device-id.spec.ts` 一行没改）。

**为什么判据放 `libs/const` 而不是直接 `pipes → system`（与任务描述的 `@walnut-server/system` 有一处偏离）**：
`libs/decorators/src/params/uuid.ts` 依赖 `@walnut-server/pipes`，而 `libs/system` 的 DTO 依赖 `@walnut-server/decorators/field` ——
`decorators → pipes → system → decorators` 会成环（CJS 下今天能跑，但那是运气不是设计）。放最底层、零依赖的 `libs/const` 后箭头单向，
`@walnut-server/system` 仍然导出同名符号（消费者无感）。

负对照：`apps/api/src/common/pipes/pipes.spec.ts` 里断言**旧形态 64 位 hex → 40099**、`d1_` + 32 位小写 hex 放行；
把判据改回 64-hex，这两条会立刻红。实测（真实 HTTP，4 个 `:deviceId` 路由全走一遍）：
`user-device.api-spec` **7/7 绿**（改造前该文件 5 failed，其中 4 条 `_devMsg: "...expected: 64-char hex string (HMAC-SHA256 of device fingerprint)"`）。

### 1.2 心跳：`visitorId` 改成「与本设备已存行比」

`libs/app-domain/src/monitor/user/user.service.ts` 的 `updateState`：

```ts
if (!isNil(visitorId)) {
  const boundRow = await this.appMonitorUserRepoService.findFirstByDeviceId(deviceId, em)
  if (boundRow !== null && boundRow.visitorId !== visitorId) {
    throw new WalnutAdminExceptionRequestDataError(...)   // 40099，且不写库
  }
}
```

即 R1 §3.4 的**方案 A**：行不存在（首写）以请求里的 `visitorId` 落库；行存在且不一致即 40099。
这也是 wire DTO 注释（`apps/api/src/modules/app/monitor/user/dto/user.dto.ts:105-106`）**本来就这么写**的口径 —— 之前实现与文档不一致。

为什么批次 8 担心的「抢注」在这里不成立（写进代码注释）：行键是**不可伪造的 `deviceId`**（服务端签发、随签名 cookie 携带），
攻击者抢得到的只是**自己那台设备**的首行，改不了受害者那一行 —— 那需要受害者的 deviceId。结构性残余（指纹与身份解耦后不再有任何跨设备判据）
在注释里明写为产品口径问题，不用代码假装能补。

负对照（`libs/app-domain/src/monitor/user/user.service.spec.ts`，5 → **7 条**）：

| 用例 | 钉住的行为 |
|---|---|
| filter 按入参 deviceId | 改回 `{ visitorId }` 即红（批次 8 的漏洞本体） |
| 首写（行不存在）放行且 `visitorId` 随首行落库 | 若「一律拒绝」即红 |
| 已存行指纹不同 ⇒ 40099 且**零写库** | 删掉这段校验即红 |
| 已存行指纹相同 ⇒ 正常 upsert | 若改成「只要行存在就拒」即红（真实客户端会被打死） |

实测：`monitor-user.api-spec` **12/12 绿**（改造前 7 failed，全部是 `monitor state visitorId does not belong to this device (expected d1_…, got <64hex>)`）。
同文件里那条「拿别人的指纹上报」的负对照**按新语义重写**：改成「**同一设备**第二次上报不同指纹 ⇒ 40099、已存行一个字段都不动」
（跨设备首写无法判定，是 B5 的结构性后果，硬造一条「攻击成功」的用例只会把弱点点成规格）。

### 1.3 陈断言

`apps/api/test/api/user-device.api-spec.ts:119-120`：`toContain('api-spec-')` → `toMatch(/^desktop_[0-9a-f]{8}$/)`
（B5 起 `deviceName` 由服务端生成，客户端载荷不参与）。同文件 143 行用例标题里「HMAC-SHA256 hex 64 位」也一并改成「服务端签发 d1_+32 hex」。

### 1.4 顺手修掉一处**预存在**的类型错（有 HEAD 复现证据）

`device.user-device.monitor.pg.int-spec.ts` 的 `makeFakeReq(...) as IWalnutAdminExpressRequest` 在 TS 6 下报 **TS2352**。
证据：把 HEAD 版本原样落到 `zzz-head-copy.int-spec.ts` 后再跑 `types:check`，两份文件**报同一条错**（`74,12` 与 `82,12`）⇒ 与本轮改动无关。
处置：改成 `as unknown as IWalnutAdminExpressRequest` 并写明理由（测试替身不该为骗过断言去补 30 个字段）。这是让 `types:check` 真正变绿的必要一步，未扩大改动面。

---

## 2. DDL：`ck_device_device_id_form`（本轮唯一一条）

### 2.1 migration

新文件 `apps/server/apps/api/migrations/1793390000000-DeviceIdFormCheck.ts`（照 `DeviceStaleFlag` 的 `UP_SQL` / `DOWN_SQL` 风格，type-only import）：

```sql
-- up
ALTER TABLE sys_device ADD CONSTRAINT ck_device_device_id_form CHECK (device_id ~ '^d1_[0-9a-f]{32}$')
-- down
ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS ck_device_device_id_form
```

- **不在 migration 里删数据**：清理是部署前 pre-step（§2.2），migration 保持 schema-only ⇒ `down` 真的能回到「没有这条约束」。
- 正则必然在 SQL 里复制一份（migration 经 Node 类型剥离加载，拿不到 `@walnut-server/*` 别名）；两边同形由**新增的 drift spec**
  `apps/api/src/common/monorepo/device-id-form.drift.spec.ts` 机械钉住：读 migration 源码，把它的正则与代码判据喂同一组样本
  （合法形态两边都过、64-hex 两边都拒），并把「up 有 ADD CONSTRAINT、down 有 DROP CONSTRAINT」也断言进去。

### 2.2 pre-step（dev 库实测，含连带删 monitor 行）

跑之前先量：`legacyDevices=11`、`legacyBanned=0`（banned 或 locked）、`legacyMonitorRows=2`、`userDeviceRows=0`、`rtRows=0`、约束不存在 —— 与 R1 §1.1 完全一致。
然后一条事务内先删 monitor 行、再删设备行，**带 RETURNING 记账**：

```
deletedMonitor: 2 行
  5d9bf1b4… visitor_id=020ce1fb9ab27da269915faff17a6814 device_id=b134ab6a…
  c52be2b0… visitor_id=78bc2f0d018df735a121c3aa77d4887b device_id=2430832b…
deletedDevices: 11 行，全部 banned=false / locked=false / active=false
  DESKTOP_020CE1 · DESKTOP_78BC2F · PROBE_DBE14C · PROBE_DC7CB1 · PROBE2_DD2988
  PROBE_DD5FD1 · PROBE_DDE704 · fixp1-smoke · fixp1-806178586 · fixp1k-563750040 · fixp1x-1479395916
```

**为什么必须连带删 monitor 行**（R1 §1.3 的理由，本轮实测复现了这两行的指纹）：`app_monitor_user.visitor_id` 全局唯一、且与
`sys_device` 之间**没有 FK**。只删设备行会留下孤儿指纹 —— 同一浏览器回来是「新 deviceId + 老 visitor_id」⇒ 首行 insert 撞
`uq_monitor_visitor`（23505）⇒ 40000，那台设备心跳永久坏。

### 2.3 run → 断言 → revert → 断言 → 再 run（三轮实测）

**① `migration:run`**（dev 库）：

```
1 migrations are new migrations must be executed.
query: START TRANSACTION
query: ALTER TABLE sys_device ADD CONSTRAINT ck_device_device_id_form CHECK (device_id ~ '^d1_[0-9a-f]{32}$')
Migration DeviceIdFormCheck1793390000000 has been executed successfully.
query: COMMIT
```

**② 断言约束在 + 写旧形态被拒**：

```json
{
  "constraint": [{ "conname": "ck_device_device_id_form",
                   "def": "CHECK ((device_id ~ '^d1_[0-9a-f]{32}$'::text))" }],
  "legacyDevices": { "c": 0 },
  "legacyInsert": "23514",   // 事务内插 64-hex 设备行 → check_violation，已回滚
  "newInsert": "OK"          // 事务内插 d1_+32hex → 通过，已回滚
}
```

**③ `migration:revert`**：

```
query: ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS ck_device_device_id_form
Migration DeviceIdFormCheck1793390000000 has been reverted successfully.
```

**④ 断言约束没了（负对照）**：

```json
{ "constraint": [], "legacyInsert": "UNEXPECTED OK", "newInsert": "OK" }
```

`UNEXPECTED OK` 是**故意**的读数：约束真被删掉之后，同一段 64-hex 写入就成功了 —— 这样「23514」与「约束不存在」才可区分。

**⑤ 再 run 一次**（把 dev 库留在已迁移状态）：`Migration DeviceIdFormCheck1793390000000 has been executed successfully.`，
复查 `constraint` 回来、`legacyInsert` 又变回 `23514`。

另外：集成库每轮 `globalSetup` 都会 `runMigrations` → **`undoAllMigrations`（逐条 down）** → 重建 → 再 `runMigrations`，
所以本轮 3 个分片的绿同时也证明 `down` 可逆（每轮至少各跑一次 up/down）。

### 2.4 刻意没做的三件事（按 R1 结论）

| 不做 | 理由 |
|---|---|
| `fingerprint_hash` 列 | 全仓 0 消费者；指纹已在 `app_monitor_user.visitor_id`；加了会把「指纹合法漂移」变成没有自愈路径的永久 40099 |
| `ON UPDATE CASCADE`（两处 FK） | 全仓没有「把 device_id 改成另一个值」的路径；现状 FK 的 23503 是免费的最后防线，换 CASCADE 会把响亮的报错换成静默改写子表 |
| 在 migration 里删旧行 | 数据删除不可 revert；`down` 只能造出「约束没了、数据也回不来」的假可逆 |

### 2.5 连带影响：集成用例的 device_id 也必须合法

CHECK 一旦进 schema，**fixture 写旧形态同样 23514**。改了 5 个 int-spec 的设备键（各文件加一个确定性派生的小工具）：

```ts
function devId(label: string) {
  const digest = createHash('sha256').update(label).digest('hex').slice(0, 32)
  return `d1_${digest}`
}
```

| 文件 | 处数 |
|---|---|
| `auth.login-chain.pg.int-spec.ts` | 15 处 `unique('b7c-*-dev')` |
| `auth.refresh-token.pg.int-spec.ts` | 播种循环的 `device_id` + 12 处字面量设备键 |
| `user.lock.pg.int-spec.ts` | 13 处 `'device-x' / 'device-lock' / 'device-unlock'` |
| `device.user-device.monitor.pg.int-spec.ts` | 11 处 `unique('b6-*-device')` |
| `pg.purge.int-spec.ts` | 1 处 |

没有改动任何断言的**语义**（同一标签派生同一 id），只是把「任意可读串当设备键」这个**旧契约**从 fixture 里拿掉 ——
这正是 CHECK 的意图：连测试都不能再写旧形态。

---

## 3. 90 天留存清理

### 3.1 形状与落点

**新服务** `libs/system/src/device/repo/device.pg.purge.service.ts`（`SysDevicePgPurgeService`），照 `refresh.pg.purge.service.ts` 的形状：

- `@Cron(CronExpression.EVERY_DAY_AT_3AM, { name: SYS_DEVICE_RETENTION_PURGE, waitForCompletion: true })` —— 避开 00:00 校钥 / 01:00 MFA / 02:00 settings+locale；
- `cronLock.runExclusive('purgeInactiveDevices', 600, …)`，`undefined`（没拿到锁）→ 返回 **`null`**，不伪装成「删了 0 行」；
- **没有**挂进 `updateDeviceActiveStatus`（它整体被 `isDev` 门住 = dev 永远测不到、生产每 30 分钟删一次），也**没有**加进启动预热；
- 任务名进 `libs/const/src/app/task.ts`：`SYS_DEVICE_RETENTION_PURGE: 'SystemDeviceRetentionPurgeTask'`；
- 归属与其余 cron 一致（`WORKER_STANDALONE=true` 时由 worker 跑），**不动 worker 代码**。

为什么在 `libs/system` 而不是 `libs/app-domain`：删除动作属于设备域；跨域的那一步（删 monitor 行）走 **identity 端口**
新增的 `IIdentityMonitorRepository.deleteByDeviceIds(deviceIds, em?)`（实现落在 `libs/app-domain` 的监控仓库），
`libs/system` 因此不反向依赖 `libs/app-domain`（`@Global` 模块绑定，启动期不放宽依赖方向）。

### 3.2 判据（在 `SysDeviceRepositoryService.purgeInactiveDevicesBefore` 里，一条 DELETE）

```sql
DELETE FROM sys_device d
 WHERE d.active = false
   AND d.updated_at < $1::timestamptz          -- 锚点是 updated_at，不是 stale
   AND d.banned = false AND d.locked = false
   AND NOT EXISTS (SELECT 1 FROM app_monitor_user m
                    WHERE m.device_id = d.device_id
                      AND (m.last_active_at > $1 OR m.auth = true))
   AND NOT EXISTS (SELECT 1 FROM auth_refresh_token rt
                    WHERE rt.device_id = d.device_id AND rt.revoked = false AND rt.expired_at > now())
 RETURNING d.device_id
```

- **不能用 `stale` 单判**：`stale` 只在「active=true 但查不到 monitor 行」时打，「用过之后放弃」那群恒 `stale=false`，只按它会漏主群；
  `updated_at` 是 initial / 心跳翻 active / IP 变更 / markDeviceStale 都会推的列，是唯一在所有分支下都还在的活动痕迹。
- `banned` / `locked` **硬排除**：那一行是封禁/锁定决定的唯一持久记录，删掉 = 静默解封（guard 查不到行 → 40605 → 自愈 → 换新身份）。
- 活 RT **防御性排除**：`fk_rt_device` 是 ON DELETE CASCADE，删设备会连带删掉未过期会话（静默踢人）。
- 幂等性来自「全部谓词都是时间/状态判据」：第二次跑必然 0 行（用例钉住）。

### 3.3 同事务 + RLS（本节的坑）

`doPurgeInactiveDevices` 在 `runInWalnutSystemTransaction(dataSource, …)` 里做两步：① 删设备并拿回 `device_id[]`；
② 用**同一个 `manager`** 调端口 `deleteByDeviceIds` 删 monitor 行。每一步都实测过：

- **`app_monitor_user` 在 RLS 表清单里**（`FORCE ROW LEVEL SECURITY`）：cron 没有请求用户，走池级 manager 会被策略过滤成
  `affected=0`（**静默不删**）。用例的负对照就是这条：运行时连接（`walnut_app`）删**同一行** → `[[], 0]`；cron 的 system 事务 → 真删掉。
- **`app_monitor_user` 没有 FK 到 `sys_device`（松引用）+ `visitor_id` 全局唯一** ⇒ 不显式删就是孤儿；留成孤儿后
  「同指纹回访」撞 `uq_monitor_visitor`（23505）⇒ 40000。用例里清完之后**用同一个 `visitor_id` 重新登记**，成功。
- **实测抓到的一个真实缺陷（已修）**：TypeORM 的 Postgres 驱动对**非 SELECT** 语句返回 `[rows, rowCount]` **二元组**
  （0 行时是 `[[], 0]`），不是行数组。首版直接 `raw.map(r => r.device_id)` ⇒ 拿到 `[undefined, undefined]` ⇒
  「设备删掉了、monitor 行一个没删」，而且 `deviceIds.length` 恒等于 2（元组长度）让计数断言也跟着骗人。
  修法：按两种形状归一（`Array.isArray(raw[0]) ? raw[0] : raw`），并在两处（仓库 + 用例的负对照）都写明这个返回形状。
  ——**这条是首轮分片跑出来的红**，不是读码想出来的，所以它也进了报告（见 §5 分片 1）。

### 3.4 测试（`apps/api/test/integration/device.purge.pg.int-spec.ts`，5 条全绿）

| # | 用例 | 断言要点 |
|---|---|---|
| 1 | `@Cron` 已挂到 ScheduleModule | `SchedulerRegistry.doesExist('cron', SYS_DEVICE_RETENTION_PURGE)` |
| 2 | 过期行被清 / 未过期一个不动 | 恰好 2 台被删；`banned` `locked` `active` 新鲜 有活心跳 有活 RT **全部还在**；删掉的那台设备其旧 monitor 行一起没了；同一 `visitor_id` 可重新登记 |
| 3 | 幂等 | 第二次跑返回 **0** |
| 4 | FK CASCADE | 设备行删除连带清 `sys_user_device` 与已过期 RT 行（显式断言，不靠「静默级联」） |
| 5 | RLS 负对照 | 运行时连接删 monitor 行 → 0 行；cron system 事务 → 真删掉（正面对照证明上一段不是「本来就空」） |

用例自清：`afterAll` 删掉本轮播种的设备（连带 CASCADE）与残留 monitor 行 —— 因为 `pg.purge.int-spec.ts` 对
「过期 RT 行数」有**精确**断言（`toBe(2)`），不清就会被本文件的 fixture 污染。分片 2 把两个文件放一起跑，两者都绿（见 §5）。

---

## 4. P4：`deviceName` 从 Initial 契约摘除

### 4.1 服务端

`SysDeviceDTOInitialRequest` 的 pick 列表去掉 `deviceName`（`['sr','vp','hardwareInfo','deviceInfo','private']`），并在类上写明理由
（服务端生成 + `uq_device_name` 全局唯一 ⇒ 名字的唯一性只能由签发方保证；留一个「可传但无效」的字段等于让契约撒谎）。

守卫：新增 `libs/system/src/device/dto/device.dto.spec.ts`（2 条）—— 用**与全局 ValidationPipe 同口径**的校验
（`whitelist + forbidNonWhitelisted + forbidUnknownValues`）断言：真实载荷零错误、带 `deviceName` 必然产出 `whitelistValidation`。
为什么不塞进 api-spec：`initial` 有 4 次/60s 限流，`device.api-spec` 的调用数已经压在上限，再加一条 HTTP 用例会把整文件推到限流边缘。

### 4.2 前端（检查过「有没有在发这个字段」）

- `apps/admin/src/api/system/device.ts`：删掉 `deviceName: appStoreFingerprint.getDeviceNameFromFingerprint`（连带删掉不再使用的 `useAppStoreFingerprint` import）；
- `apps/admin/src/api/request.d.ts`：`Initial = Omit<SystemDevice, 'id' | 'deviceName'>` —— 让 **vue-tsc 成为「前端别再发这个字段」的机械守卫**；
- 全仓其他 `deviceName` 命中都是**响应面展示 / 改名 / WebAuthn 设备名**，与 initial 载荷无关（`grep deviceName apps/admin/src` 已逐条看过）。

服务端测试侧同步：`apps/api/test/api/helpers/api-client.ts` 的引导载荷、`device.api-spec.ts` 的 3 处 initial 载荷都不再带 `deviceName`（否则 40099）。

### 4.3 重导 openapi + api-types（一次导完）

`pnpm openapi:export` → `written apps/server/openapi.json (openapi 3.0.0, 202 schemas)`；`pnpm openapi:generate` → `openapi-typescript 7.13.0`。

```
 apps/server/openapi.json                     |   5 -      ← 纯 deviceName（4 行属性 + 1 行 required 项）
 packages/generated/api-types/src/schema.d.ts | 382 +++---
```

`schema.d.ts` 的 382 行**不是 5 行改动的放大**，而是两类变化：

| 行数 | 内容 | 归属 |
|---|---|---|
| 2 | `deviceName` 从 `SysDeviceDTOInitialRequest` 消失 | 本轮 P4（预期） |
| 380 | 响应码联合类型里多出 **`40667`** | **预存在漂移**：`537b080c` 重导过 `openapi.json`（带 40667），但 `schema.d.ts` 没跟着重生成 |

也就是说：`openapi.json` 早就和 `schema.d.ts` 不一致了。本轮的 `pnpm openapi:check` 若不重生成会红在 40667 上，而不是红在 deviceName 上。
把两者一次导齐是**必要**的（否则「重导」只是把漂移留在原地）—— 记在这里，避免被误读成本轮引入了 380 行契约变更。

---

## 5. 门禁与测试读数（全部实测）

### 5.1 单测：`cmd /c "pnpm --filter @walnut/server test"`

```
 Test Files  101 passed (101)
      Tests  833 passed (833)
   Duration  74.28s
```

HEAD 口径是 **99 文件 / 827 条**（`git ls-tree` 数出 99 个 spec）；本轮 **+2 文件 / +6 条**：
`device.dto.spec.ts`（2）+ `device-id-form.drift.spec.ts`（2）+ `user.service.spec.ts` 由 5 条补到 7 条。
（任务书写的「98 文件 / 827 条」，文件数在 HEAD 上实测是 99 —— 差的那一个是 `9a7f860d` 带进来的，不是本轮增删。）

### 5.2 集成：**分片跑**（整轮会被宿主 kill），报「分片合计」

读表口径：标「改造前 / 修复前」的失败读数引自 R1 §3.1 的实测（那两个 spec `12 failed | 7 passed (19)`）；
**其余所有读数都是本轮实测**。

跑前确认无人并发：`Get-CimInstance Win32_Process | ? CommandLine -match 'vitest|test:integration'` → **无进程**；
globalSetup 自己也会抢 PG advisory lock（实测 `已拿到排他锁（key=730942001，等待 0s）`）。

| 分片 | 文件 | 读数 |
|---|---|---|
| 1（首轮，**修复前**） | device / user-device / monitor-user / device.user-device.monitor / **device.purge** | 4 文件全绿；`device.purge` **4 failed** ⇒ 暴露 §3.3 的 TypeORM 返回值缺陷 |
| 2（修复后） | **device.purge** / pg.purge / auth.refresh-token / user.lock | `Test Files 4 passed (4)` · `Tests 22 passed (22)` |
| 3（最终代码态复跑 4 个必测文件） | device.api-spec / user-device.api-spec / monitor-user.api-spec / device.user-device.monitor.pg.int-spec | `Test Files 4 passed (4)` · `Tests 47 passed (47)` |
| 4（收尾确认，最终代码态） | device.purge / pg.purge（两文件同片，验 fixture 不串污染） | `Test Files 2 passed (2)` · `Tests 7 passed (7)` |

**分片合计（最终代码态）：8 个文件 / 69 条，全绿。**
（分片 4 是最后那笔**只加类型标注**的改动之后的确认跑：结果与分片 2 一致，说明标注没有改变行为。）

逐文件（分片 3 + 分片 2）：

```
✓ apps/api/test/api/monitor-user.api-spec.ts                      (12 tests)
✓ apps/api/test/api/user-device.api-spec.ts                      ( 7 tests)
✓ apps/api/test/api/device.api-spec.ts                           (11 tests)
✓ apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts (17 tests)
✓ apps/api/test/integration/device.purge.pg.int-spec.ts          ( 5 tests)
✓ apps/api/test/integration/user.lock.pg.int-spec.ts             ( 6 tests)
✓ apps/api/test/integration/auth.refresh-token.pg.int-spec.ts    ( 9 tests)
✓ apps/api/test/integration/pg.purge.int-spec.ts                 ( 2 tests)
```

**覆盖边界（别把它读成「整轮通过」）**：本仓 integration 配置收了 30+ 个 spec，本轮只跑了上表 8 个；
`auth.login-chain` / `data-scope.rls` / `menu.role` 等**未跑**（只保证 `types:check` 覆盖了它们的类型面）。
`device.purge.int-spec` 与 `pg.purge.int-spec` 同片跑过（前者清场后后者仍 `toBe(2)`），说明 fixture 没有串污染。

### 5.3 其余门禁

| 门禁 | 读数 |
|---|---|
| `pnpm types:check`（根，15 包） | `Tasks: 15 successful, 15 total`（含 admin 的 `vue-tsc`） |
| `pnpm lint`（根，15 包） | `Tasks: 15 successful`；仅 `libs/repository/src/pg-list.builder.spec.ts` 3 条**预存在** warning（本轮没碰该文件） |
| `pnpm boundaries` | `Checked 4692 files in 15 packages, no issues found` |
| `pnpm openapi:export` | `written apps/server/openapi.json (openapi 3.0.0, 202 schemas)`；diff 只含 deviceName 的 5 行 |
| `pnpm openapi:generate` | `openapi-typescript 7.13.0` → `schema.d.ts`（变化见 §4.3） |

---

## 6. 与 R1 结论的差异 / 补充（逐条）

| R1 说法 | 本轮实际做法 | 原因 |
|---|---|---|
| §6-2「形态判据搬到 `libs/const`，管道改谓词式」 | **照做**（判据 + 前缀都在 `libs/const/src/app/device.ts`），`@walnut-server/system` 再导出 | 任务书写的是「用 `@walnut-server/system` 的 `isValidDeviceId()`」；直接 `pipes → system` 会成环，故取符号同名但落点中立 |
| §2.1「cron 放 `libs/system/src/device/repo/`」 | **照做** | 跨域那一步用新增的 identity 端口方法，避免 `system → app-domain` 反向依赖 |
| §2.1「不要加 bootstrap 入口」 | **照做** | — |
| §2.5 幂等 SQL 的 ①（DELETE…RETURNING）+ ②（按数组删 monitor） | **照做**，但 ① 的返回值必须按 `[rows, rowCount]` 二元组归一 | R1 的 SQL 是对的；**TypeORM 的返回值形状**是它没覆盖到的坑（§3.3） |
| §2.6 测试方案 11 条 | 落成 **5 条**（把 1/2/4/5/6/7 合并成一条多断言用例；11（RLS 守卫）单列；补第 9 的 CASCADE 与第 10 的幂等） | 5 条覆盖全部 11 个判据，跑起来更短；没砍判据 |
| §3.2「删 `getDeviceIdByFingerprint` / `hashDeviceFingerprint`」 | **保留**，只改注释标「身份路径 0 调用」 | 删它会顺手让 `DEVICE_ID_ENCRYPTION_KEY`（`apps/server/AGENTS.md` 列的「部署后不许改」的 5 个 key 之一）失去唯一引用点 = 改部署契约，该单独一批裁定。已写进 §7 |
| §3.3 文档同步（8 个文件） | **未做** | 不在本轮的验收清单内；`device.md` 的 mermaid 时序图需要整段重写，属独立一批。已写进 §7 |
| §4.2（A）握手自愈三跳用例 | **未做** | 同上（不在本轮清单）；R1 自己也标了「建议手工实测一次再收尾」 |

---

## 7. 本轮未做 / 建议后续

1. **文档 §3.3 全表**（`shared/device.md` 的「身份来源」段 + 3 处 backend 文档 + 4 处 key 说明 + 两个 OAuth controller 注释）：`device_id` 早就不再由 HMAC 派生，这些段落现在是错的。
   `reports/` 下的 md 不受文档站死链门禁约束，但 `docs/` 下的要过 `lint:docs-refs` / `build:docs`，建议单独一批。
2. **删死载荷**：`SysDeviceRepositoryService.getDeviceIdByFingerprint` + `AppTechCryptoService.hashDeviceFingerprint` 已 0 消费者；
   删之前要先裁定 `DEVICE_ID_ENCRYPTION_KEY` 的处置（历史数据根 vs 退役），别顺手改部署契约。
3. **握手自愈三跳的自动化用例**（R1 §4.2-A 的 7 步 + 3 条判据）：本轮没做，`40012 → 40113` 两跳仍然只有读码结论。
4. **`initial` 限流 4 次/60s** 已经卡住 api-spec 加用例的空间（本轮 P4 的负对照因此放在单测里）。若后续还要给 initial 加 HTTP 用例，先调限流或用独立 IP。
5. **扫描类收尾**：`stores/batch-*` 里对 `getDeviceIdByFingerprint` / `HMAC(指纹)` 的引用（历史报告）不必改，但读的人容易当现状 —— 若有索引页可加一句「已被 B5 作废」。

---

## 8. 附录：本轮命令与原始输出（节选）

```
# 单测
cmd /c "pnpm --filter @walnut/server test"
  → Test Files 101 passed (101) | Tests 833 passed (833) | Duration 74.28s

# 集成（分片，均 cmd /c 前缀）
pnpm vitest run --config ./apps/api/vitest.config.integration.ts \
  apps/api/test/api/device.api-spec.ts apps/api/test/api/user-device.api-spec.ts \
  apps/api/test/api/monitor-user.api-spec.ts \
  apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts
  → Test Files 4 passed (4) | Tests 47 passed (47)

pnpm vitest run --config ./apps/api/vitest.config.integration.ts \
  apps/api/test/integration/device.purge.pg.int-spec.ts \
  apps/api/test/integration/pg.purge.int-spec.ts \
  apps/api/test/integration/auth.refresh-token.pg.int-spec.ts \
  apps/api/test/integration/user.lock.pg.int-spec.ts
  → Test Files 4 passed (4) | Tests 22 passed (22)

# 收尾确认（最终代码态）
pnpm vitest run --config ./apps/api/vitest.config.integration.ts \
  apps/api/test/integration/device.purge.pg.int-spec.ts \
  apps/api/test/integration/pg.purge.int-spec.ts
  → Test Files 2 passed (2) | Tests 7 passed (7)

# migration（dev 库，三轮）
cmd /c "pnpm migration:run"    → DeviceIdFormCheck1793390000000 has been executed successfully.
cmd /c "pnpm migration:revert" → DeviceIdFormCheck1793390000000 has been reverted successfully.
cmd /c "pnpm migration:run"    → 再执行成功（留在已迁移状态）

# 门禁
cmd /c "pnpm types:check"  → Tasks: 15 successful, 15 total
cmd /c "pnpm lint"         → 0 error（3 条预存在 warning）
cmd /c "pnpm boundaries"   → Checked 4692 files in 15 packages, no issues found
cmd /c "pnpm openapi:export" → written openapi.json (202 schemas)
cmd /c "pnpm openapi:generate" → openapi-typescript 7.13.0 → schema.d.ts
```

### 8.1 改了哪些文件

```
M  apps/admin/src/api/request.d.ts                                   P4：Initial 类型 omit deviceName
M  apps/admin/src/api/system/device.ts                              P4：不再发 deviceName
M  apps/server/libs/const/src/app/task.ts                           新增 SYS_DEVICE_RETENTION_PURGE
M  apps/server/libs/pipes/src/base/format.pipe.ts                   设备 id 管道改谓词式
M  apps/server/libs/system/src/device/device-id.ts                  判据移出 + 再导出
M  apps/server/libs/system/src/device/dto/device.dto.ts             P4：摘 deviceName
M  apps/server/libs/system/src/device/repo/device.repo.service.ts   留存清理 SQL + 注释
M  apps/server/libs/system/src/device/repo/device.repo.module.ts    注册 cron provider
M  apps/server/libs/system/src/device/repo/index.ts                 export cron 服务
M  apps/server/libs/identity/src/identity.ports.ts                  端口新增 deleteByDeviceIds
M  apps/server/libs/app-domain/src/monitor/user/user.service.ts     心跳校验改口径
M  apps/server/libs/app-domain/src/monitor/user/repo/user.repo.service.ts  批量删 monitor 行
M  apps/server/apps/api/src/common/pipes/pipes.spec.ts              设备 id 管道断言
M  apps/server/apps/api/test/api/{device,user-device,monitor-user}.api-spec.ts
M  apps/server/apps/api/test/api/helpers/api-client.ts              initial 载荷去 deviceName
M  apps/server/apps/api/test/integration/{auth.login-chain,auth.refresh-token,user.lock,pg.purge,device.user-device.monitor}.pg.int-spec.ts
M  apps/server/openapi.json                                         重导（-5 行）
M  packages/generated/api-types/src/schema.d.ts                     重生成
A  apps/server/apps/api/migrations/1793390000000-DeviceIdFormCheck.ts
A  apps/server/apps/api/src/common/monorepo/device-id-form.drift.spec.ts
A  apps/server/apps/api/test/integration/device.purge.pg.int-spec.ts
A  apps/server/libs/const/src/app/device.ts
A  apps/server/libs/system/src/device/dto/device.dto.spec.ts
A  apps/server/libs/system/src/device/repo/device.pg.purge.service.ts
```

未 commit（按要求）。
