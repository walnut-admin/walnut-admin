# 批次 11 · B5 收尾 —— R3 独立复查（七项实测）

- 性质：**只读复查**（未改源码；两处负对照临时改回旧代码后按 sha256 逐字节还原，见 §1.3）
- 视角：全新复查 agent，R1/R2 都不是我做的；**下文所有读数都是我自己重跑出来的**，
  与 R1/R2 的读数没有引用关系（只有"他们说 X，我测到 Y"这种对照）
- 口径：HTTP 恒 200 看 `body.code`；dev 库 = `apps/server/env-local/.env.development` 的
  `DATABASE_PG_*`；integration 库 = `walnut-admin-integration`（globalSetup 每片 drop 重建）；
  pnpm 一律 `cmd /c`；临时探针在 `%TEMP%/r3probe/`（已删）
- 起点：工作树 = R2 未提交改动（25 M + 6 ??），与 R2 报告 §8.1 的文件清单逐条一致

---

## 0. 判定（一句话）

**不可提交。** 两处运行时修复、migration 可逆性、90 天清理、契约同步本身都成立，
但 R2 的 P4（从 initial DTO 摘 `deviceName`）打红了 **2 个它没跑过的 api-spec**
（throttle / api-rollback，HEAD 上本来绿），并让本来就红的 concurrency 换了失败点；
它自己写的新 CHECK 又打红了 **auth.login-chain**（漏改 2 处 fixture）——
整轮 integration 从 HEAD 的「1 条预存在红」变成 **5 条红 / 4 个文件**（65 文件 / 653 条：
647 passed · 5 failed · 1 skipped）。另有 R2 两处**自述与事实不符**（vue-tsc 守卫、
`DEVICE_ID_ENCRYPTION_KEY` 唯一引用点），见 §5.3 / §7.3。

---

## 1. 两处运行时修复（含负对照）

### 1.1 管道：`WalnutAdminPipeDeviceId` 已改谓词式

- `libs/pipes/src/base/format.pipe.ts:62`：`super({ test: isValidDeviceId }, ...)`（第二参是 expected 文案 `d1_` + <32 lowercase hex>）
  —— 64-hex 正则已不存在（`git diff` 确认那两行被删），判据唯一真源在
  `libs/const/src/app/device.ts:16-28`（`/^d1_[0-9a-f]{32}$/` + `isValidDeviceId`）。
- 四个 `:deviceId` 路由（改名 / lock / unlock / force-quit）**用真实 `d1_` id 打**：
  `user-device.api-spec` **7/7 绿**（我自己跑的，分片 1）。逐条对照该文件的用例：
  `update-name`（:126）、`lock/unlock`（:150）、`force-quit`（:211）都走的就是服务端签发的 id，
  另有一条 `update-name 非法 deviceId → 40099`（:143）钉形态。

### 1.2 心跳：已改成「与本设备已存行比」

- `libs/app-domain/src/monitor/user/user.service.ts:96-104`：
  `findFirstByDeviceId(deviceId, em)` → 行存在且 `row.visitorId !== visitorId` 才 40099。
- `monitor-user.api-spec` **12/12 绿**（分片 1），含三条我关心的：
  - `:140` 首次心跳 → 20000 且 upsert 落库（**首写能落库**成立）；
  - `:158` 同一设备第二次上报**不同指纹** ⇒ 40099 且已存行一个字段都不动（**换指纹被拒**成立）；
  - 全文件没有任何一条用例掉进「恒 40099」。
- 补一条正面确认（读码）：心跳端点是 `@WalnutAdminDecoratorDataScopeSystemChannel()`
  （`user.controller.ts:143`），所以 `em` 是 system 模式，`findFirstByDeviceId` 不会被 RLS 过滤成
  null —— 否则「行永远不存在 ⇒ 永远放行」，负对照会假绿。这一点是我额外验的，R2 没提。

### 1.3 负对照（两条都"改回旧代码就红"）

改法：把两处**临时**改回 HEAD 形态（管道 `/^[0-9a-f]{64}$/i`；心跳 `getDeviceIdByFingerprint(visitorId) !== deviceId`），
跑 `user-device.api-spec + monitor-user.api-spec`，然后从 `%TEMP%` 备份还原并比对 sha256。

```
改回旧代码后：Test Files 2 failed (2) | Tests 11 failed（失败标记 [1/11]…[11/11]：monitor-user 7 条 + user-device 4 条）
  monitor-user ×7   body={"code":40099,"_devMsg":"monitor state visitorId does not belong to this device …"}
  user-device  ×4   _devMsg:"type: param; field: deviceId; expected: 64-char hex string (HMAC-SHA256 …)"
                    （update-name / lock-unlock / force-quit / force-quit 无 monitor 行）
还原后 sha256（与改前逐字节相同）：
  format.pipe.ts   EC0E0D53E0C9E256900DCB03D560E2A4FCD7AFE568A8B7F2C323AA7DEF0C2F09
  user.service.ts  E65AB5406C4E6F009F0BD2DB1DE07B5C5BCE1D1E32E75E6A8BB633D997E16ADE
```

即：**两处修复都真的在起作用**（不是"改没改都一样"），且负对照的失败原因就是两条 P0 的原症状。

### 1.4 残余风险（不是本轮 bug，但必须记）

「指纹必须等于本设备首见值」是**硬校验**，而指纹的持久化在 localStorage
（`app-fingerprint.ts:130` `useAppStorageSync(FINGERPRINT)`，`setupFingerprint:148` 有值就 return）。
于是「cookie 还在、localStorage 里的指纹变了」（清站点数据时只清了一半 / persistent migrate 改 key /
换浏览器 profile 继承签名 cookie）⇒ 该设备**每次心跳 40099，且没有自愈路径**：心跳失败 ⇒
`updateDeviceActive` 不执行 ⇒ `updated_at` 不再推进 ⇒ 90 天清理也救不回来（`active` 可能还是 true）。
客户端对 40099 无处理（`grep 40099 apps/admin/src/utils/axios` = 0 命中；心跳是裸 `fetch` 且失败静默）。
这正是 R1 §1.2 警告过的形态，只是触发概率低（指纹持久化）。**建议**：给「同设备换指纹」留一条
受控的更新路径（例如 `auth=false` 且 `left=true` 的空闲行允许覆盖 visitorId），否则这是一颗静默地雷。

---

## 2. 补跑：46 api-spec + 19 int-spec **全跑**（分片 7 片，无遗漏）

跑前确认无人并发：`Get-CimInstance Win32_Process | ? CommandLine -match 'vitest|test:integration'`
→ **只有我自己的 PowerShell**；每片 globalSetup 都打印
`[integration globalSetup] 已拿到排他锁（key=730942001，等待 0s）` ⇒ 无争用。

| 片 | 文件（数量） | 读数 |
|---|---|---|
| 1 | device / user-device / monitor-user / monitor / guard-matrix / permission-chain（6 api） | **6 passed / 99** |
| 2 | throttle / concurrency / api-rollback / list-filters / error / health / key / security（8 api） | **3 failed · 5 passed / 116（112 passed, 4 failed）** |
| 3 | area / cap-throttle / opaque-admin / otp / shared-ali / user-lock / user-me / user-mfa / user-preference / user-identity / external-oauth / auth-session（12 api） | **12 passed / 90** |
| 4 | data-scope-matrix / data-scope / data-scope.dept / deleted / demo / dept / dict / employee / lang / locale / log-auth / log-operate（12 api） | **12 passed / 99** |
| 5 | logger / menu / pool-occupancy / post / real-data / role / setting / user（8 api） | **8 passed / 55（54 passed, 1 skipped）** |
| 6 | app.key / area.tree / data-scope.rls / log.bypass.pg / pg.transaction / user-preference.upsert / app.setting（7 int） | **7 passed / 50** |
| 7 | user.mfa.pg / deleted.recycle.pg / menu.role.pg / pg.base-repository / user.identity.oauth.pg / lang.locale.i18n / device.user-device.monitor.pg / device.purge.pg / pg.purge / user.lock.pg / auth.refresh-token.pg / auth.login-chain.pg（12 int） | **1 failed · 11 passed / 144（143 passed, 1 failed）** |

**分片合计：65 文件 / 653 条 = 647 passed · 5 failed · 1 skipped；红 4 个文件。**
**没跑的片：无**（46 api + 19 int 全跑；唯一 skip 是 `real-data.api-spec` 内部 `TEST_DATA=real` 专用用例，
非我跳过）。

R2 那 8 个文件（device 11 / user-device 7 / monitor-user 12 / device.user-device.monitor 17 /
device.purge 5 / pg.purge 2 / user.lock 6 / auth.refresh-token 9 = **69 条**）我**逐条复现一致，全绿** ——
分歧**只**在它没跑的那 57 个文件里。

### 2.1 四个红文件（5 条红用例）的归因 —— 每条都有证据

```
[P4 引入 · HEAD 绿] throttle.api-spec ×2
  Error: [api-client] initial #2 failed: HTTP 200 body={"code":40099,…,
         "_devMsg":"property deviceName should not exist"}
  ×  第 2-4 次连发 → 20000            ×  第 5 次 → 42900（实得 40099）
  载荷出处 throttle.api-spec.ts:34  deviceName: throttle-spec-<fingerprint>

[P4 引入 · HEAD 绿] api-rollback.api-spec ×1
  AssertionError: expected 40099 to be 20000      （:291）
  载荷出处 api-rollback.api-spec.ts:284  deviceName: rb-hook-<seed8>

[P4 让失败点前移 · 该用例在 HEAD 也红] concurrency.api-spec ×1
  AssertionError: expected [ 40099, 40099, 40099 ] to include 20000
  载荷出处 concurrency.api-spec.ts:249  deviceName
  ── 读码判定（未在 HEAD 实跑）：HEAD 的 device.service.ts 已经把 deviceName 改成
     deviceName: this.buildServerDeviceName(deviceType)（无条件覆盖），而该用例 :283-287
     断言 count(*) WHERE device_name = 'conc-dev-<seed>' 恰 1 行 ⇒ HEAD 上必然 0 行。
     即这条是 B5 第 2 步留下的**预存在红**，与本轮无关；本轮只是换了个失败点。

[R2 引入] auth.login-chain.pg.int-spec ×1
  QueryFailedError: new row for relation "sys_device" violates check constraint
  "ck_device_device_id_form"        ← seedRT → seedDevice（:587 → :139）
  漏改处：:632 const jti1 = await seedRT(unique('b7c-policy-dev1'))
          :633 const jti2 = await seedRT(unique('b7c-policy-dev2'))
  即 R2 说的「auth.login-chain 15 处」实际有 17 处 device 键，漏了 2 处；
  这条**只有补跑才会发现**，因为该文件 R2 改过但没跑。
```

**结论：R2 的「分片合计 8 文件 / 69 条全绿」是真的，但它被当成「收尾完成」的依据 —— 这就是本轮的
硬伤。** `vitest.config.integration.ts:11-13` 写明 integration 不进 CI/turbo/prepush，所以
`types:check` / `lint` / `boundaries` / 单测都不会替你发现这 5 条。

---

## 3. migration 可逆性（dev 库，我自己跑的两个完整 down/up 循环）

```
STEP 1  migration:revert
          query: ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS ck_device_device_id_form
          Migration DeviceIdFormCheck1793390000000 has been reverted successfully.
        {"constraint":[], "totalDevices":0, "legacyInsert":"OK(accepted)", "newInsert":"OK(accepted)"}
        ← 负对照：约束真没了之后同一条 64-hex 写入就成功了（可区分「23514」与「没约束」）
STEP 2  migration:run
          query: ALTER TABLE sys_device ADD CONSTRAINT ck_device_device_id_form
                 CHECK (device_id ~ '^d1_[0-9a-f]{32}$')
          … has been executed successfully.
        {"constraint":["ck_device_device_id_form"], "legacyInsert":"23514", "newInsert":"OK(accepted)"}
STEP 3  migration:revert  → 与 STEP 1 同（"legacyInsert":"OK(accepted)"）
STEP 4  migration:run     → 与 STEP 2 同（"legacyInsert":"23514"）；dev 库留在已迁移状态
```

- **migration 里没有删数据**：`1793390000000-DeviceIdFormCheck.ts:48-56` 的 `UP_SQL`/`DOWN_SQL`
  各只有一条 `ALTER TABLE`；文件里出现的 `DELETE FROM app_monitor_user` 全在**注释**（pre-step 说明）。
  实测佐证：整个 §3 期间 `sys_device` 行数恒为 0，没有被 migration 动过。
- **pre-step 可复跑**：pre-step 的两条 DELETE 都是「按形态谓词 `device_id !~ '^d1_…'` 选行」，
  重复执行天然 0 目标（当前 dev 库 `legacyDevices=0`）；顺序仍是「先 monitor 后 device」。
- 一个**流程注意**：`migration:run` 在存量旧行 >0 时会 23514 直接红（`ADD CONSTRAINT` 会校验存量）。
  这不是缺陷（R1 §1.3 就是这么建议的），但**部署手册必须写清 pre-step 先于 migration**，
  否则上线第一步就红。

---

## 4. 90 天清理

### 4.1 cron 真的注册了（不是只有装饰器）

- `device.pg.purge.service.ts:59` `@Cron(EVERY_DAY_AT_3AM, { name: SYS_DEVICE_RETENTION_PURGE, waitForCompletion: true })`；
- provider 在 `device.repo.module.ts:18`（`SysDeviceRepositoryModule`），该模块被
  `device.module.ts:21` 与 `shared/device.shared.module.ts:14` 导入 ⇒ 在 `AppModule`/`AppCoreModule` 图里；
- **实测**：`device.purge.pg.int-spec.ts:125-128` 用**真实 AppModule** 装配后
  `SchedulerRegistry.doesExist('cron','SystemDeviceRetentionPurgeTask')` → 通过（我跑的 5/5 绿里含这条）。

### 4.2 抢不到锁时的行为：返回 **null**，任务体不执行（实测，R2 没测这条）

用 `nest build cli` 产出的 dist 直接实例化两个类（无 DB、无 Redis）：

```
[Nest] WARN [AppTechCacheCronLockService] "purgeInactiveDevices" is already running on another instance, skip this tick
{
 "lockOccupied_runExclusive": "undefined(as expected)",
 "taskBodyExecutedWhenOccupied": false,      ← dataSource / repo 桩都未被调用（桩会抛错）
 "cronReturnWhenOccupied": null,
 "lockFree_taskBodyExecuted": true,
 "cronReturnWhenFree": 0                     ← 0 ≠ null： 「删了 0 行」与「没跑」可区分
}
```

即 `purged ?? null`（`device.pg.purge.service.ts:61-65`）成立，且形状与既有的
`refresh.pg.purge.service.ts:45-50` 逐行同款。**注意**：这条**没有任何测试**守着
（device.purge 的 5 条用例与 pg.purge 都不测 lock-skip），属既有空白，不是本轮回归。

### 4.3 判据

`device.repo.service.ts:117-136` 的一条 DELETE：`active=false` ∧ `updated_at < $1` ∧
`banned=false` ∧ `locked=false` ∧ `NOT EXISTS(monitor: last_active_at > $1 OR auth=true)` ∧
`NOT EXISTS(rt: revoked=false AND expired_at > now())` —— 与我逐条读的判据一致，
且我的 `device.purge.pg.int-spec` 实跑 5/5 绿（用例 2 一条里同时钉：过期行恰 2 台被删；
banned / locked / active / 新鲜 / 有活心跳 / 有活 RT 六台一个不动；abandoned 的 monitor 行一起没；
同 visitor_id 可重新登记）。幂等用例第二次返回 0。

### 4.4 RLS 通道：**是 system 通道，但「非 system 就静默 0 行」这句话只对一半**

- 代码：`runInWalnutSystemTransaction`（`data-scope-rls.ts:95-123`，`set_config('app.data_scope.mode','system')`）；
  monitor 删除经 `deleteByDeviceIds(ids, manager)` → `withWalnutSystemManager(em, …)` 在**同一 em** 上
  （`data-scope-rls.ts:133-142`：有 em 就直接用）⇒ 同事务、同连接、system 模式。✓
- **我自己连库实测**（dev 库，`walnut_app` 角色，全程事务 + 回滚）：

```
{"appRole":"walnut_app","defaultMode":"anonymous",
 "nonSystem_delete_anonymousRow_rowCount":1,      ← user_id IS NULL 的匿名行：非 system 通道**删得掉**
 "nonSystem_delete_boundRow_rowCount":0,          ← 绑了用户的：非 system 通道静默 0 行 ✓
 "systemMode_delete_boundRow_rowCount_rolledBack":1}
```

原因是策略本身：`DataScopePhase3Rls.ts:128` 的 `using` 是
`allow_all() OR user_id = user_id() OR user_id IS NULL` —— 匿名行对 anonymous 模式**可见**（那是
`allowAnonymous` 的设计）。所以「非 system 通道会静默 0 行」只在**绑了用户的**行上成立；
R2 的负对照用例（`device.purge.pg.int-spec.ts:200-201`）正是因此特意绑了 userId，注释也写对了，
但报告里把这条说成无条件成立是**不准确**的 —— 真实后果是：**如果哪天这条清理退回池级 manager，
它会「删掉设备 + 删掉匿名 monitor 行、只把登录用户的 monitor 行留成孤儿」**，失败是**部分的**，
比全静默更难发现。

### 4.5 TypeORM 非 SELECT 的返回形状：两种形状都归一了（我自己复现了那个坑）

用真 TypeORM DataSource 在 dev 库跑（事务内 + 回滚）：

```
DELETE … RETURNING（0 行）: "[[],0]"                       firstIsArray=true
DELETE … RETURNING（1 行）: "[[{"device_id":"d1_cc…"}],1]"  firstIsArray=true
SELECT 对照                : "[{"x":1}]"                   firstIsArray=false
归一后: 0 行 → []，1 行 → [{"device_id":"d1_cc…"}]
```

`device.repo.service.ts:138` `const rows = (Array.isArray(raw[0]) ? raw[0] : raw)` 对两种形状都成立
（二元组取第一项、行数组原样用），不是只适配一种。R2 这条自述**成立**。

---

## 5. `deviceName` 摘除的连带面

### 5.1 服务端 / 前端该摘的都摘了

- `device.dto.ts:211`：`RealPickType(SysDeviceDTOSafe, ['sr','vp','hardwareInfo','deviceInfo','private'])`
  —— `deviceName` 已不在白名单；
- `apps/admin/src/api/system/device.ts:69-91`：载荷不再有 `deviceName`（连 `useAppStoreFingerprint` import 一起删了）；
- **全仓还有没有别处在发**：`grep hardwareInfo apps/admin` 只有 1 处构造点（`device.ts:81`）；
  `initialDeviceAPI` 只有 `app-geo-ip.ts:45/66` 两个调用者；无 mock / demo 页构造 initial 载荷。
  其余 `deviceName` 命中有 31 处，逐类看都是**响应面展示 / 改名接口 / WebAuthn 设备名**，与 initial 无关。✓

### 5.2 契约面确实变了（这是本轮最贵的一处）

`openapi.json` 侧 `SysDeviceDTOInitialRequest` 少了 `deviceName` 属性与 required 项 ⇒ 带该字段的请求
从「静默忽略」变成 **40099**（`_devMsg: "property deviceName should not exist"`，见 §2.1）。
这是**破坏性 wire 变更**，而 R2 只把它同步进了自己跑过的 3 个文件。

### 5.3 「vue-tsc 机械守卫」不成立（R2 自述与事实不符）

`request.d.ts:161` 的 `Omit<SystemDevice,'id'|'deviceName'>` 摆在唯一调用点
`system/device.ts:91` 的 `as IRequestPayload.System.Deivce.Initial` 后面 —— **`as` 断言不做多余属性检查**。
我把两种形态喂给 tsc（`%TEMP%` 探针，与调用点同形）：

```
const viaAssertion = { private:false, sr:{width:1}, deviceName:'x' } as Initial   ← 零报错
const viaAssign: Initial = { private:false, sr:{width:1}, deviceName:'x' }       ← TS2353 ✓ 只有这种会红
```

即：**谁把 `deviceName` 加回那个对象字面量，vue-tsc 一声不响**。要让这条守卫是真的，得把
`as` 换成「函数参数类型 / `satisfies`」之一。（当前 `pnpm --filter @walnut/admin types:check` 我重跑
= **exit 0**，但那是"没在发"而不是"发不出去"。）

---

## 6. `schema.d.ts` 的 380 行漂移

### 6.1 现在两者是同步的（重生成 = 零改动，sha256 逐字节）

```
BEFORE openapi.json  32B3C0AB…305B4D      BEFORE schema.d.ts  20B43958…6E49FF
cmd /c "pnpm openapi:export"   → [export-openapi] written … openapi.json (openapi 3.0.0, 202 schemas)
cmd /c "pnpm openapi:generate" → openapi-typescript 7.13.0 → schema.d.ts [433.9ms]
AFTER  openapi.json  32B3C0AB…305B4D      AFTER  schema.d.ts  20B43958…6E49FF   ← 完全没变
git diff --stat（vs HEAD）：openapi.json 5 - ｜ schema.d.ts 382 ++++----
```

即：把 `openapi:export` + `openapi:generate` 各跑一遍，两个产物**一个字节都没变** ⇒
「`openapi.json` 是代码真实产物」「`schema.d.ts` 是 `openapi.json` 的真实产物」两条同时成立。

> 注意口径：`pnpm openapi:check` 的实现是 `git diff --exit-code`（对 HEAD），在「工作树本来就有
> P4 改动」的前提下**必然红**，它不能用来证明"零 diff"。能证明的是上面这条"重生成是 no-op"。

### 6.2 380 行漂移有没有掩盖别的契约变化：**没有**

逐一拆过（`git diff` 的行级统计 + HEAD 侧 grep）：

```
schema.d.ts 新增 190 行：**全部**含 40667（190/190），没有一行例外
schema.d.ts 删除 192 行：190 行是"不含 40667 的 code 联合"，另 2 行是 deviceName（属性 + 类型）
HEAD openapi.json   里 40667 出现 190 次  ← 早就有了
HEAD schema.d.ts    里 40667 出现 0 次    ← 这就是 537b080c 只重导 openapi、没重生成 schema 的漂移
现在：openapi.json 190 次 / schema.d.ts 190 次（对齐）
```

⇒ 漂移 = **纯 40667 的 190 处补登记**，除此之外只有 P4 的 2 行。R2 对这段的归因**成立**，
且**没有掩盖其它契约变化**（否则 `diff` 里会出现第三类行）。

---

## 7. 死代码：`getDeviceIdByFingerprint` / `hashDeviceFingerprint`

### 7.1 消费者

```
git grep getDeviceIdByFingerprint  → 定义 device.repo.service.ts:47；调用点 0
                                     （其余命中全是注释/文档/历史报告：oauth 两个 controller 注释、
                                      docs 3 篇、reports/batch-*）
git grep hashDeviceFingerprint     → 定义 crypto.service.ts:130；唯一调用 = getDeviceIdByFingerprint
```

⇒ **两个都是真死代码**（0 运行时消费者）。R2 的「0 消费者」判断成立。

### 7.2 删它会不会让 `DEVICE_ID_ENCRYPTION_KEY` 失去唯一引用点：**不会**

```
libs/config/src/validation.ts:209-211   @IsString() @MinLength(32) DEVICE_ID_ENCRYPTION_KEY: string
libs/config/src/modules/crypto.config.ts:10   deviceIdKey: process.env.DEVICE_ID_ENCRYPTION_KEY
libs/config/src/validation.spec.ts:125        'DEVICE_ID_ENCRYPTION_KEY'（F-42 密钥长度门禁）
libs/types/src/process.d.ts:60                DEVICE_ID_ENCRYPTION_KEY: string
```

四个引用点都不经过那两个函数 ⇒ **删掉它们，env 仍然是启动期必填（@MinLength 32）的部署契约**，
不变；真正会变成"无消费者"的只有配置属性 `crypto.deviceIdKey`（唯一消费者就是 `hashDeviceFingerprint:133`）。

### 7.3 结论

- **先别删**这个决定可以接受，但 R2 给的理由（"删了就改部署契约"）**是错的**；
- 正确的说法是：删函数**不改**部署契约，只是把 `crypto.deviceIdKey` 变成悬空配置（knip 候选）；
  真正会改契约的是**下一步**（删 `crypto.deviceIdKey` → 进而想删 `EnvironmentVariables` 的必填项 +
  `AGENTS.md` 的"5 个不许改的 key"清单）。两件事必须分开做，且第二步要先裁定历史数据处置；
- 建议把这段注释（`device.repo.service.ts:39-45`）里的因果改准，别把"配置属性悬空"写成"部署契约变更"。

---

## 8. 我在本轮**没有**重跑的东西（别读成"全绿"）

- `pnpm lint` / `pnpm boundaries` / `pnpm lint:docs-refs` 等未重跑（不在七项清单内，且与改动面无交集）；
  已重跑并确认的门禁：**单元 101 文件 / 833 条全绿（exit 0）**、**admin `types:check`（vue-tsc）exit 0**、
  §6 的两个生成物重生成 **no-op**；
- 握手自愈三跳（40012 → 40113）仍未实测（R1/R2 都列为未做，本轮不扩大范围）。

---

## 9. 一句话判定：这次收尾有没有让别的门禁/约定失效？

**有。** 它让「integration 全量」这条（虽不进 CI、但被当作本轮验收）从 HEAD 的 1 条预存在红
（`concurrency` G3）变成 **5 条红 / 4 个文件**，其中 `throttle`（2）与 `api-rollback`（1）是 P4 直接
打红的、`auth.login-chain`（1）是新 CHECK + 漏改 fixture 打红的；同时它让「initial 请求面」
这条 wire 约定变成"带 `deviceName` 即 40099"，而配套的前端类型守卫（`Omit` + `as`）是**假的**。

**要变成可提交，最小修复是 4 处**：
1. `throttle.api-spec.ts:34` / `concurrency.api-spec.ts:249` / `api-rollback.api-spec.ts:284` 三处载荷去掉 `deviceName`；
2. `concurrency.api-spec.ts:283-287` 那条"按客户端名字计数"的预存在陈断言改掉（B5 起名字由服务端生成）；
3. `auth.login-chain.pg.int-spec.ts:632-633` 两处 `unique('b7c-policy-devN')` → `devId('b7c-policy-devN')`；
4. （建议）把 `system/device.ts:91` 的 `as` 换成 `satisfies`/参数类型，让 §5.3 的守卫是真的。
改完必须**整轮** `test:integration` 重跑（分片跑也行，但要报"分片合计 + 未跑片 = 无"）。

---

## 10. 附注：复查期间工作树被改动（时间戳很重要）

我的读数时间：integration 分片 **19:51–20:08**，门禁（单测 / admin types:check / openapi 重生成）
**20:10–20:14**。全部对应「R2 未提交的那棵树」。

**20:20 之后我收到的最新 `git status` 里多出 3 个我复查时未被修改的文件** —— 说明另一个 agent 正在
按本报告 §9 的清单动手（不是我改的；我本轮只编辑过两处源码后又按 sha256 还原，以及本报告）：

```
M apps/server/apps/api/test/api/throttle.api-spec.ts        deviceName 行已删（§9-1 生效）
M apps/server/apps/api/test/api/api-rollback.api-spec.ts    deviceName 行已删（§9-1 生效）
M apps/server/apps/api/test/api/concurrency.api-spec.ts     G3 重写：cookie 承载身份、计数改 device_id（§9-1/2 生效）
```

**仍未修**（截至我最后一次查看）：
```
auth.login-chain.pg.int-spec.ts:632  seedRT(unique('b7c-policy-dev1'))   ← 仍会 23514
auth.login-chain.pg.int-spec.ts:633  seedRT(unique('b7c-policy-dev2'))
```

因此 §2 的「4 红文件 / 5 红用例」是**时点快照**，不是"现在还是这样"。要 certify 这批，
必须等这些编辑停手后**整轮重跑**（分片跑也行，但要报「分片合计 + 未跑片 = 无」）。

### 10.1 对新版 concurrency G3 的一条复查意见（下一轮请一起处理）

重写后的断言放宽成：`codes` 里「至少 1 条 20000」+「没有 5xxxx」+「每条 ∈ {20000, 40000, 42900}」。
问题：`initial` 的限流是 4 次/60s，而该用例连打 1+3 次正好压在线上；一旦三路都被限流成 42900，
只要**首条**成功，用例仍然绿 —— 于是 `it` 标题里的「**冲突侧受控 40000**」不再被任何断言钉住
（它现在只证明"没炸 5xxxx"）。建议二选一：
① 断言 `codes.filter(c => c === 40000).length >= 1`（真钉 23505 → 40000 的单列映射）；
② 去掉 42900 容忍，改用独立 IP / 先清 throttle 存储让三路都进得到冲突分支。
否则这条用例从「钉并发语义」退化成「钉没崩」。

