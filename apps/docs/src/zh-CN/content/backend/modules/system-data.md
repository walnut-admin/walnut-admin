# 数据域与 techniques（deleted / logs / cache / event / queue / task / health）

数据域覆盖三件事：**回收站**（`system/deleted`）、**双日志体系**（`system/logs/auth`、
`system/logs/operate`）与**基础设施服务**（`modules/techniques/` 的 cache / event / queue /
task / health）。前两者是业务表的旁路数据，后者是它们与整个后端的运行时底座。

本文写**当前实现**（PostgreSQL 迁移后）。软删与恢复的公共基类在
`apps/server/libs/repository/src/pg-base.repository.ts`；已知缺陷的登记与裁决见
`apps/server/apps/api/test/api/DESIGN-ISSUES.md`（下文以 `P?-?` 引用）。
表设计依据 `apps/docs/src/zh-CN/content/plans/postgres-migration-phase2.md` §4.15 ~ §4.17 与 §5.3。

源码入口：`apps/server/libs/system/src/deleted/`、`apps/server/libs/system/src/logs/`、
`apps/server/apps/api/src/modules/techniques/`（deleted / logs 的 controller 仍留 app 的
`apps/server/apps/api/src/modules/system/`）。
接口矩阵的原始测绘在 `apps/server/apps/api/test/api/ENDPOINTS.md` §5 与 §6。

## 1. 回收站（sys_deleted）

### 1.1 表与写入路径

`sys_deleted` 是追加型快照表：PK 默认 **uuidv7()**，`content` 是 jsonb，`model_name` 是
恢复路由键，`deleted_id` 是被删行的原 uuid，`deleted_by` / `log_operate_id` 是松引用
（不建 FK），`deleted_at` 是普通可空列（无 `updated_at`）。

软删的唯一入口是 `WalnutAdminCommonPgBaseRepository.deleteSoftById`：

1. `readById(id, em)` 读原行（**默认列集**，`select:false` 的密文列不会进快照）；
2. 取删除前的浅拷贝 `snapshot`（`remove()` 会就地清空生成列，不能直接交出去）；
3. `SysDeletedPgRepoService.createSoftDelete` 写一条快照：`content = snapshot`、
   `modelName = 实体注册的 WalnutModelName`、`collectionName = 表名`、
   `deletedId = snapshot.id`、`deletedBy = 当前用户 id`、`deletedAt = now()`；
4. `repository.remove(deleted)` 硬删原行。

上述写入在传入同一个 `em` 时同事务（controller 的 `@WalnutTx()` 提供），否则走连接级 manager
的独立语句。快照的 `content` 直接存对象，不再 `JSON.stringify`（phase2 §5.3）；
`deleted_at` 由软删路径显式赋值，不依赖列默认值。

配套方法：

| 方法 | 行为 |
|---|---|
| `deleteSoftById` | 单行快照 + 硬删 |
| `deleteSoftByIdMany` | 逐 id 串行执行（事务内不并发） |
| `deleteSoftManyByCondition` | 先 `find({ where })`，再逐行 `deleteSoftById`；命中 0 行回 `[]` |
| `deleteRealById` / `deleteRealByIdMany` | 只硬删，不写快照 |

### 1.2 恢复注册表（登记制）

PG 有强 schema，快照 jsonb 不能像 Mongo 一样 `db.model(modelName)` 动态恢复。恢复路由收口为
`apps/server/libs/repository/src/recoverable.registry.ts` 的 `WalnutAdminRecoverableRegistry`：
`modelName → 目标实体 + IWalnutAdminRecoverableRecoverer`，通用恢复器由
`createWalnutAdminSnapshotRecoverer(entityTarget)` 生成，实现就是
`em.getRepository(entityTarget).insert(content)`——按快照行原样插回，**含原 uuid 主键与
`created_at` / `updated_at` 时间戳**（`insert()` 对显式赋值的列原样落库，只有 `undefined`
才触发生成默认值）。

- **登记制（批 7）**：注册表不再有全域静态清单。实体在哪个 lib/域就由哪个域在自己的 Nest
  module 装配期登记（`registerXxxRecoverable` 薄 factory provider）——`libs/system` 的 12 个
  子模块、`libs/identity` 的 7 张身份表、app / auth / shared 各域分别登记。回收站（deleted）
  只消费 `WalnutAdminRecoverableRegistry`（@Global 提供），不再反向 import 任何域实体。
- `dto-entity.drift.spec` 在纯注册表实例上重放各域的登记函数（与 Nest 装配同一份逻辑），
  继续对账 `modelName → 实体` —— 漏登记即红。
- 没有软删写路径的表（lock / mfa / preference / user_device / refresh_token 等）也一并
  登记（注册无害，兜住任何来源的历史快照）。
- **组合恢复器**（关联快照一并重放，best-effort + savepoint 隔离）：
  `sys_user`（libs/identity：P2-18/P2-22 按 `content->>'userId'` 重放 identity / preference /
  user_device / mfa / lock / oauth 快照）、`sys_menu`（P2-23：按 `title` 重放 locale）、
  `sys_dict_data`（P2-23：按 `label` 重放 locale）、`sys_dict_type`（P2-8/P2-23：按
  `typeId` 重放 dictData，再按各自 `label` 重放 locale）。关联行插入失败只告警并保留其
  快照，不阻断主行恢复。
- **junction 表不注册**：`sys_role_menu` / `sys_user_role` 随主行 FK CASCADE 生灭，
  不进回收站（P2-18）。
- 未注册的 `modelName` 在恢复时抛受控 40000 `recoverFail`（替代 Mongo 版动态模型的
  未受控 MissingSchemaError）。重复注册是装配期错误，直接抛。
- 恢复器 insert 撞唯一键 / FK 未满足等异常被包装成 40000 `recoverFail`；`sys_deleted`
  行的删除失败原样上抛。两步写同一 `em`，由 `@WalnutTx()` 统一 commit/rollback。

### 1.3 recover 与 recoverMine 的差异

| 维度 | `POST /system/deleted/recover` | `POST /system/deleted/me/recover` |
|---|---|---|
| 权限点 | `system:deleted:recover` | `system:deleted:recover:mine`（2026-10-28 接线，P3-21） |
| 角色 | `@HasRole([root, developer, admin], OR)` | 无 |
| 定位 | 按 `id` 读快照，再比对 `deletedId`；不匹配 → 40000 `recoverFail` | 按 `(id, deletedId)` 双键 `findOne`；命中不了 → 40401 |
| 属主 | 不校验 | `deleted.deletedBy !== userId` → 40000 |
| 操作日志 | 挂 `@WalnutAdminDecoratorOperateLog`（DELETED_RECOVER） | 不挂 |

两者最终都调 `recoverSnapshot`：注册表路由 → 原表 insert → 删除 `sys_deleted` 行。
管理端恢复日志与 `sys_deleted` 行的 `log_operate_id` 回填是两条独立旁路（§2.1）。

### 1.4 级联语义

| 删除动作 | 同事务内的附加动作 | 恢复时的行为 |
|---|---|---|
| `DELETE /system/menu/:id?_cascade=1` | `title` 非空时按 `title` 作为 locale `key` 软删该菜单的全部翻译行（`SysLocaleService.deleteByKey`）；子菜单不删（`pid` FK RESTRICT，撞 23503 → 40000） | 恢复菜单行时按同 `title` 重放 locale 快照（P2-23，2026-10-29）；角色授权仍不恢复（P2-18） |
| `DELETE /system/dict/type/:id` | 先按 `type_id` 逐行软删 dictData（各落一条 `SYS_DICT_DATA` 快照），再快照 + 硬删 type 行（P2-8 已修） | 恢复 type 行时按 `typeId` 联动重放 data 快照，再按各自 `label` 重放 locale（P2-23）；不必手工逐条恢复 data |
| `DELETE /system/dict/data/:id` / `deleteMany` | 按 `label` 作为 locale `key` 软删翻译行，并触发 locale 缓存全量刷新 | 恢复 data 行时按同 `label` 重放 locale 快照（P2-23） |
| `DELETE /system/user/:id` | 主行删除前先给 identity / preference / user_device / mfa / lock / oauth 六表逐行落快照（P2-18/P2-22）；`sys_user_role` 不落快照，其余外围行随后由 FK CASCADE 硬删 | 主行 + 六表外围快照联动恢复；`roles_list` 仍为空（P2-18 junction 面维持登记） |
| 设备行删除（`deleteNonMonitorUserDevice`，cron 路径） | `sys_user_device` 由 device_id FK CASCADE；设备行是硬删、不写快照 | 不走回收站 |

结论：**回收站对主行 + 已落快照的关联行负责**。P2-8 解决「dictData 被 DB CASCADE 静默
清掉」，P2-22/P2-23 补齐恢复侧联动（用户外围六表、menu/dictData/dictType 的 locale 与
dictData 快照）；junction（`sys_user_role` / `sys_role_menu`）与设备行仍是明确取舍 —— 不
进回收站，恢复主行后需重新授权/绑定。

### 1.5 并发实测（G5）

`concurrency.api-spec.ts` G5 对同一条 `sys_deleted` 行并发 `recover`：原表 insert 在主键上
串行化，事务拦截器对败者回滚，结果**恰一路成功、另一路受控失败（40000 / 40401）**，
`sys_deleted` 快照不会复活、原表只有一行。`api-rollback.api-spec.ts` 另验证「恢复撞唯一键 →
40000 `recoverFail` + 快照行完好」的回滚传播。

## 2. 日志双系

### 2.1 log_operate（操作日志）

写入由 `WalnutAdminInterceptorRequestOperateLog`（`libs/crud/src/operate-log/operate-log.decorator.ts`）
承担，只挂在带 `@WalnutAdminDecoratorOperateLog` 的 handler 上（CRUD 工厂会默认挂）。

- 拦截器在 `next.handle().pipe(tap({ next, error }))` 里发起 `void insertToLogOperate(...)`：
  **fire-and-forget**，不阻塞响应，异常只 `logger.error`，不会影响业务结果。
- 成功行：`statusCode` 取响应状态，`responseData` 是统一响应壳 + 翻译后的 `msg`；
  失败行：`success=false`，`responseData` 是 `WalnutAdminExceptionHandler` 的受控异常壳。
- `requestData` / `responseData` 经 `toWalnutPgJsonbPayload`（`@walnut-server/utils` 的 `pg-jsonb.ts`）处理：
  stringify → parse 往返成功则写 jsonb 列；序列化失败（循环引用 / BigInt）则 jsonb 列置 NULL、
  原文尽力文本化写入 `raw_request_data` / `raw_response_data` text 旁路列（零丢失语义）。
- `snapshotBefore` / `snapshotAfter` 来自 ALS（`ALSRequestService`）。目前只有
  `pg-base.repository.ts` 的 `update` 会写这两个键（`updateByField` 不写）；写库前用
  `maskSensitiveFields` 脱敏。因此 create / delete / updateByField 的日志快照列通常为空。
- `userId` / `deviceId` 是松引用；匿名请求 `userId=null`。`userName` 是快照列。
- `operation` 列只由显式 `@WalnutAdminDecoratorOperateLog({ operateType })` 写入；
  CRUD 装饰器只传 `title` / `action`，所以 CRUD 行的 `operation` 恒 NULL（ENDPOINTS §5 钉现状）。
- `title` 在 PG 收紧为 NOT NULL（Q10-a），`action_type` 的 CHECK 含 **10 个值**
  `OTHER/CREATE/UPDATE/DELETE/DELETE_MANY/IMPORT/EXPORT/CLEAR/REFRESH/AUTH`
  （与 `WalnutAdminConstDecoratorLogOperateAction` 一致；D 段复核 2026-10-28 修正，
  原「只含 8 值、另有 REFRESH/AUTH 待定夺」的记述已过时，见 P3-24/P3-25）。
- `logOperateId` 回填：DELETE / DELETE_MANY 成功后经 `runAfterCommit` 在业务事务**提交后**
  `eventEmitter.emit(LOG_OPERATE_DELETE...)`（P2-29，2026-10-29；无事务上下文时内联执行），
  `AppTechEventService` 异步监听，按 `deletedId` 更新 `sys_deleted.log_operate_id`。
  该更新走连接级 manager（刻意不收事务句柄），条件是
  `deleted_id = ? AND log_operate_id IS NULL` —— 重复软删留下的历史快照已关联的日志不再
  被新日志覆盖（P2-29 第二面）。

读面（`SysLogOperateService`）：`read` / `list` 用 `SysLogOperateDTOSafe` 剔除
`snapshotBefore` / `snapshotAfter`；`GET :id/snapshot` 单独返回这两列；
`GET :id/device` 用松引用 `deviceId` 反查 `sys_device`，找不到回 `null`（不 500）。
日志行本身**没有删除端点**，是只追加数据。

### 2.2 log_auth（认证日志）

三条触发链，全部 fire-and-forget：

1. `@WalnutAdminDecoratorAuthLog(type)` → `WalnutAdminInterceptorRequestAuthLog`：
   `tap next` 记成功、`tap error` 记失败；`identifier` 取 `req.identifier`（由策略 /
   中间件写入），`deviceId` 取 `DEVICE_ID` cookie。
2. `WalnutAdminGuardAuth(strategy)`（passport 混入工厂）的 `handleRequest` 失败分支：
   在抛出 passport 错误前 `void recordAuth({ success: false, errI18nMsg })`，并 `.catch` 记日志。
3. `POST /auth/opaque/user/login/client-error` 在 controller 里**显式 await** `recordAuth`
   （这是唯一同步等待审计落库的认证路径），随后恒抛 40103。

`SysLogAuthSharedService.recordAuth`：

- 成功行 `msg` 是 `response.20000` 的 i18n 文案；失败行取 `errI18nMsg`，缺省
  `response.40103`。
- OTP 的 `type` 从 `request.body.type` 动态映射为 `otp_email` / `otp_phone`。
- `userId` / `userName` 取 `request.user`；登录失败 / 匿名时为 `null`（PG 迁移后不再生成
  随机 ObjectId 脏值）。`identifier` / `deviceId` / `ip` / `location`（百度地理 API）/
  `os` / `browser` 一并快照。
- 失败时调 `SecurityRiskFailedLoginService.collect` 计失败登录风险（Redis Hash 计数，
  达到 5 次临时封 IP 30 分钟，见 [安全与 guard 链](./security.md) §4.3）。
- 写库走 `SysLogAuthRepoService.create`，**刻意不收事务句柄**：连接级 manager 的独立隐式
  事务即旁路语义，不参与业务请求的主事务。

读面只有 delete / deleteMany / list（没有 create / read 端点），controller 类上另挂了
`@UseGuards(JwtAccessGuard)`（与全局 JWT 守卫重复，属历史写法）。delete / deleteMany 走
软删，快照 `modelName = SYS_LOG_AUTH`。

## 3. techniques

### 3.1 cache 三通道

物理层只有一个：`AppTechRedisService`（node-redis 客户端）与 `AppTechCacheService`。
`AppTechCacheService` 把业务键统一加前缀 **`WALNUT_CACHE_`**，值统一包成
`{ v, ttl, start, t }`（`t` 是 `WalnutAdminConstAppCacheType`：`built-in` / `auth` /
`controller` / `shared` / `system`）。ttl > 0 走 `SETEX`（秒），ttl 缺省/0 走 `SET`（永不过期）。
文档与代码里写 `AUTH:PERMISSIONS` 等是**逻辑键**，Redis 里实际是
`WALNUT_CACHE_AUTH:PERMISSIONS:...`。

| 通道 | 入口 | 键形态 | 失效方式 |
|---|---|---|---|
| 装饰器响应缓存 | `@WalnutAdminDecoratorCache({ key, ttl? })` + `WalnutAdminDecoratorCacheInterceptor` | 逻辑键即 `WalnutAdminConstAppCacheKeys` 的值；`t` 固定 `controller`；默认 TTL 3600 秒 | 手动删除/覆盖写。当前**唯一消费方**是 `GET /system/lang/list/public`（`SYS_LANG_LIST_PUBLIC`）；lang create/update 经 `runAfterCommit` 删键（P2-5 已修） |
| 领域缓存服务 | `AppTechCacheDeviceService` / `AppTechCachePermissionsService` / `AppTechCacheMfaService` / `AppTechCacheLockService` / `AppTechCacheSignService` / `AppTechCacheRsaService` / `AppTechCacheCapService` / `AppTechCacheVerifyCodeService` 等 | 均基于 `AppTechCacheService`，键为 `WalnutAdminConstAppCacheKeys` 值 + 业务后缀 | 各业务写路径显式 `set` / `del` / `delByPattern`；`delByPattern` 用 SCAN 分批 + `unlink`（P1-2 已修） |
| appSettings 整对象 + 进程内 memo | `AppTechCacheAppSettingsService` | Redis 键 `APP:SETTING`，值是 `{ settingKey → settingValue }` 原始映射；另有进程内 `appSettingsMemo` 与每 key 解析后的 `settingMemo` | `setAppSettings` 写后统一清 memo；监控台按 key 删缓存时调 `invalidateMemoForExternalCacheRemoval` |

覆盖面要点：

- 设备缓存 `SYSTEM:DEVICE:<deviceId>`（常量 `SYS_DEVICE`）与锁缓存
  `SECURITY:LOCK:<userId>:global|deviceId`（常量 `SECURITY_LOCK`）**没有 TTL**，
  只能被业务写路径覆盖/删除；`cache.clear()` 也不会清它们（`built-in` / `auth` / `system`
  三类受保护）。
- 权限缓存 TTL 被写成 `AT 秒数 × 1000`（P1-15），实际驻留时间放大约 1000 倍；
  `AUTH:MFA:VERIFIED` 用 RT 秒数，单位正确。
- appSettings 的 memo 是**进程内**的：多实例部署下，其他实例写 setting 不会失效本进程 memo，
  本进程最长要等到下一次本地 `setAppSettings` 才回正；绕过服务直删 Redis 键也不会失效
  （只有监控台的删缓存端点接了防御性失效）。当前部署形态是单实例，这条边界登记为 P2-27。
- `AppTechCacheService.clear()` 按每条的 `t` 过滤，`controller` / `shared` 会被清，
  `built-in` / `auth` / `system` 保留；未知 `t` 视为可清。

### 3.2 event 总线

`@nestjs/event-emitter` 的 `EventEmitter2`，`AppTechEventService` 订阅两个事件：

- `LOG_OPERATE_DELETE`：`{ logOperateId, deletedId }` → `updateDeletedWithLogOperateId`；
- `LOG_OPERATE_DELETE_MANY`：`{ logOperateId, deletedIds }` → 按分隔符拆分后逐条更新。

监听器都是 `{ async: true }` 的 fire-and-forget，失败不会回到请求事务。用途仅限
`sys_deleted.log_operate_id` 回填（§2.1）。

### 3.3 queue（Bull）与 task 定时

**queue**：`AppTechQueueModule` 只提供 `BullModule.forRootAsync`，Redis 连接与主缓存同源，
前缀 `WALNUT_CACHE_BULL`（因此监控台列缓存时刻意跳过含 `BULL` 的键）。队列由消费模块各自
`BullModule.registerQueue`：

| 队列 | 注册方 | 用途 |
|---|---|---|
| `ERROR` | `libs/app-domain/src/error` | 错误上报异步落库 |
| `EMAIL` | `@walnut-server/mailer` | 验证码邮件、欢迎邮件 |
| `PHONE` | `@walnut-server/sms` | 验证码短信（阿里云） |

OTP 发送侧对队列调用是 `void this.mailerService.sendVerifyCodeEmail(...)` /
`void this.smsService.sendVerifyCodeTextMessage(...)`：**不 await**，响应先返回，码同时写
`AUTH:VERIFY_CODE` 缓存。测试环境不真发邮件/短信，用例从缓存读回真码。

**task**：`AppTechTasksService`（`modules/techniques/task/task.service.ts`）注册六个
`@Cron`：

| 任务 | 频率 | 内容 |
|---|---|---|
| `APP_INIT_SETTINGS` | 每天 02:00 | `extractAppSettingIntoCache` 全量重写 `APP:SETTING` |
| `SYS_INIT_LOCALE_MESSAGES` | 每天 02:00 | 全量重算 `SYS_LANG_ID_LIST` + 每种语言的 `SYS_LOCALE_MESSAGES` |
| `AUTH_DELETE_REFRESH` | 每 2 小时 | 标记过期 RT 为 revoked + 同步 monitor user 的 auth 状态 |
| `APP_ROTATE_KEY` | 每天 00:00 | `rotateForCronJob(RSA_PAIR / AES_KEY_URL)` |
| `SYS_UPDATE_DEVICE_ACTIVE_STATUS` | 每 30 分钟 | 超过 5 分钟无活动的活跃设备置 `active=false`；无 monitor 记录的设备行硬删 |
| `AUTH_MFA_SETUP` | 每天 01:00 | 按 `methodsRequiredCount` 全量重算 `sys_user.mfa_setup` |

另有 `AuthRefreshTokenPgPurgeService` 的 `@Cron(EVERY_HOUR)`：`DELETE FROM auth_refresh_token
WHERE expired_at < now()`（物理回收，与上面「标记 revoked」的任务语义不同，走 `idx_rt_expired`）。

运行特征（W2-A 起）：

- **bootstrap 归属**：启动期上述六个任务各执行一次（不含 purge job）的逻辑已从
  `AppTechTaskModule` 拆到 `AppBootstrapTaskModule.onModuleInit`。默认归 api
  （`AppModule` 加载）；`WORKER_STANDALONE=true` 时 api 让出、`WorkerModule` 恒加载 ——
  与 `AppScheduleModule` 的 cron 归属同一判据。「`WORKER_STANDALONE=true` 但只起 api
  不起 worker」时 bootstrap 不执行，属部署契约；bootstrap 调用不占 cron 锁。
- **cron 单实例锁**：七个 `@Cron`（六个任务 + purge job）的入口都经
  `AppTechCacheCronLockService` 用 Redis `SET NX EX` 抢锁（键
  `WALNUT_CACHE_CRON_LOCK:<方法名>`，TTL 300–900s，最长的是 `deleteExpiredRefreshToken`
  的 900s）；拿不到锁的实例记 warn 后跳过本次 tick。Redis 异常时 **fail-open** 照常执行
  （任务自身幂等，锁只是减少重复）。`@Cron` 另配 `waitForCompletion: true` 防同实例
  上一次未跑完时自重叠。key 轮换的过期判断在**事务内** `FOR UPDATE` 锁行后重判，
  双进程交错时后者等锁后看到先者的新 ACTIVE 行即跳过，不会连环作废新 key。
- **单份执行的边界**：bootstrap / cron 的「单份执行」只限于 api↔worker 的**组合根归属**；
  多副本 api / worker 各自会跑一份（cron 由 Redis 锁互斥、bootstrap 无锁 by design）。
- `updateDeviceActiveStatusForCronJob` 在 `isDev` 下直接返回全零，开发环境不清理设备；
  生产环境该任务会硬删「无 monitor 记录」的设备行及其缓存。

### 3.4 health 五端点

`AppTechHealthController`（`/app/health`）类级 `@HasRole([root, developer], OR)`，每个端点
各自一个权限点：

| 端点 | 权限点 | 实现 |
|---|---|---|
| `GET /app/health/network` | `app:health:network` | `HttpHealthIndicator.pingCheck('baidu', https://www.baidu.com)`（外网依赖） |
| `GET /app/health/postgres` | `app:health:postgres` | `TypeOrmHealthIndicator.pingCheck`，连接名 `WalnutPGConnectionName` |
| `GET /app/health/memory-heap` | `app:health:memory-heap` | `MemoryHealthIndicator.checkHeap`，阈值 200 MB |
| `GET /app/health/memory-rss` | `app:health:memory-rss` | `checkRSS`，阈值 200 MB |
| `GET /app/health/disk` | `app:health:disk` | `DiskHealthIndicator.checkStorage`，阈值 75%，路径硬编码 `C:/` |

- 响应是 terminus 的 indicator 对象（B 段实测只有 indicator 键，没有额外的
  `{ status, info, details, error }` 外壳）。
- 本仓库的 terminus 配置**不抛 503**：异常时由全局异常过滤器兜底为 HTTP 200 +
  `body.code = 50000`，健康时 `body.code = 20000`。
- `disk` 的 `C:/` 是 Windows 路径，非 Windows 部署会失败（P3-22）。

### 3.5 探针端点（W2-B 起）

编排层用的两个探针**不是**上面这个控制器，而是
`apps/server/apps/api/src/app/probes.composition.ts` 挂的 raw Express 路由
（`main.ts` 在 `NestFactory.create` 之后、`listen()` 之前调用 `mountProbeRoutes`）：

| 端点 | 语义 | 响应 |
|---|---|---|
| `GET /health/live` | liveness：进程存活即 200，不探依赖（依赖故障不该让编排层重启健康进程） | `{ status: 'ok' }`，同步返回 |
| `GET /health/ready` | readiness：并发探 PG（`SELECT 1`）与 Redis（`PING`），各自 1.5s 超时 | 全过 200，任一失败/超时 503 |

- readiness 响应体：`{ status: 'ok' | 'error', checks: { pg: 'up' | 'down', redis: 'up' | 'down' } }`
  （`|` 表示二选一，不是字面量）；**不带**版本号、主机名、连接串与耗时。
- **为什么绕过 Nest**：挂载早于 `app.init()`（由 `listen()` 触发）—— 此时 Nest router、全局中间件、
  整条 `APP_GUARD` 链、全局响应包装与异常过滤器都还没注册，请求先被 raw route 接住。必须如此：
  全局异常过滤器把错误兜成 HTTP 200（`body.code = 50000`），readiness 永远 200 就失去意义；
  guard 链的设备 / JWT / 签名握手也不是容器 healthcheck 能完成的。
- **安全边界**：响应体只有二值状态，`Cache-Control: no-store`。公网由 nginx 挡死
  （`deploy/nginx/conf.d/api.conf` 的 `location ^~ /health/` + 大小写不敏感正则双保险，均为 404），
  探针只挂在编排内网。
- **draining**：`main.ts` 的 SIGTERM 监听把 readiness 置为 503 `{ status: 'draining' }`，
  与 `enableShutdownHooks` 的优雅关闭并行 —— 先停止导流，再按 Nest 生命周期关连接。
- **compose 用法**：`deploy/docker-compose.yml` 的 backend healthcheck 用 `node -e` fetch
  `/health/ready` 并断言 `r.ok`；`depends_on` 要求 postgres / redis 先 `service_healthy`；
  redis 自身也带带密码 PING 的 healthcheck。两个探针没有 Nest 装饰器，**不会进 openapi.json**
  （`pnpm openapi:export` 零 diff 是断言项）。

## 4. 接口表

统一响应壳 HTTP 200 + `body.code`（成功 20000）。「守卫链」只写与默认全链不同的部分。

### 4.1 deleted

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/system/deleted/:id` | 全链 | `system:deleted:read` | 行 uuid → 快照行 + `user: { id, userName }`（含 `content`） |
| POST `/system/deleted/list` | 全链 | `system:deleted:list` | list DTO（`content` 走 `content::text` ILIKE）→ 行 + `user`（不含 `content`） |
| DELETE `/system/deleted/deleteMany/:ids` | 全链 + `@HasRole([root, developer, admin], OR)` | `system:deleted:deleteMany` | 逗号分隔 uuid → 硬删的 `sys_deleted` 行数组 |
| POST `/system/deleted/me/recover` | 全链 + `@WalnutTx()` | `system:deleted:recover:mine` | `{ id, deletedId }` → `true`；属主不符 40000 |
| POST `/system/deleted/recover` | 全链 + `@HasRole([root, developer, admin], OR)` + `@WalnutTx()` + 操作日志 | `system:deleted:recover` | `{ id, deletedId }` → `true`；`deletedId` 不匹配 40000 `recoverFail` |

`deleted` 没有单行 delete、create、update 端点。list 的 `sortOnlyIn` 为
`modelName / collectionName / deletedAt`；`content` 不在响应 DTO 里（避免列表带大对象），
但 `read` 返回完整快照。

### 4.2 logs

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/log/auth/list` | 全链（类上另挂 `@UseGuards(JwtAccessGuard)`） | `system:log:auth:list` | list DTO（`deviceId` / `type[]` / `authenticatedAt[]`）→ 行 |
| DELETE `/system/log/auth/:id` | 同上 + `@WalnutTx()` | `system:log:auth:delete` | 行 uuid → 软删快照行 |
| DELETE `/system/log/auth/deleteMany/:ids` | 同上 + `@WalnutTx()` | `system:log:auth:deleteMany` | 逗号分隔 uuid → 快照行数组 |
| GET `/system/log/operate/:id` | 全链（类上同样另挂 `JwtAccessGuard`） | `system:log:operate:read` | 行 uuid → 行（Safe，无快照列） |
| POST `/system/log/operate/list` | 全链 | `system:log:operate:list` | list DTO → 裁剪行 |
| GET `/system/log/operate/:id/snapshot` | 全链 | `[system:log:operate:read, system:log:operate:getSnapshot]` AND | 行 uuid → `{ snapshotBefore, snapshotAfter }` |
| GET `/system/log/operate/:id/device` | 全链 | `[read, system:log:operate:getDevice]` AND | 行 uuid → 设备行（嵌套形态）或 `null` |

`log/auth` 没有 create / read 端点；`log/operate` 没有 delete 端点。两系都没有
`DELETE_MANY` 之外的批量写。

### 4.3 techniques

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/app/health/network` | 全链 + 类级 `@HasRole([root, developer], OR)` | `app:health:network` | — → indicator（外网） |
| GET `/app/health/postgres` | 同上 | `app:health:postgres` | — → indicator |
| GET `/app/health/memory-heap` | 同上 | `app:health:memory-heap` | — → indicator |
| GET `/app/health/memory-rss` | 同上 | `app:health:memory-rss` | — → indicator |
| GET `/app/health/disk` | 同上 | `app:health:disk` | — → indicator |

cache / event / queue / task 没有 HTTP 端点；cache 的只读/删除面在 `libs/app-domain/src/monitor/cache`
（不在本篇范围）。

## 5. 已知行为注记

以下均已在 `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 登记，这里只写现状与指向：

- **P2-4（已修复）**：monitor/cache 的 read 补 `await`；delete 保留 fire-and-forget 并写进契约。
- **P2-8（已修复）**：dictType 删除改为同事务逐行软删 dictData；DB CASCADE 无行可清，
  回收站可先恢复 type 再恢复 data。
- **P2-5（已修复）**：lang CRUD 经 after-commit 失效 `SYS_LANG_LIST_PUBLIC`。
- **P1-12（已修复）**：dictData 的 deleteMany 装饰器已接线。
- **P1-2（已修复）**：`delByPattern` 改为 SCAN 分批 + `unlink`，node-redis v5 的批次数组
  不再丢键。
- **P1-15**：`AUTH:PERMISSIONS` 的 TTL 是 AT 秒数 × 1000，权限变更后旧权限串长期驻留。
- **P2-17（已修复，2026-10-29）**：lang create/update 与 locale 共用刷新通道（重算
  `SYS_LANG_ID_LIST` / `SYS_LOCALE_MESSAGES`）。
- **P2-18**：软删恢复不恢复 junction；恢复菜单丢全部角色授权、恢复用户无法登录。
- **P2-22（已修复，2026-10-29）**：用户外围六表（identity / oauth / device / lock / mfa /
  preference）都进删除前快照与恢复重放。
- **P2-23（已修复，2026-10-29）**：menu / dictData / dictType 的组合恢复器会重放级联
  软删的 locale 行（dictType 连同 dictData 快照）。
- **P2-27（C 段新登记）**：appSettings 的进程内 memo 失效覆盖面只到本进程：多实例部署下
  其他实例写 setting 不会失效本进程 memo；绕过服务直删 Redis 键也不会（只有监控台删缓存
  端点接了防御性失效）。
- **P2-28（已修复，批 W2-A 2026-11-01）**：七个 `@Cron` 入口加 Redis 单实例 try-lock
  （`AppTechCacheCronLockService`，`SET NX EX` + fail-open + `waitForCompletion`）；
  bootstrap 六任务拆入 `AppBootstrapTaskModule`，按 `WORKER_STANDALONE` 归 api 或 worker
  单份执行；key 轮换的过期判断移入事务内并 `FOR UPDATE` 重判。
- **P2-29（已修复，2026-10-29）**：`logOperateId` 回填事件改走 `runAfterCommit`（提交后
  才发），更新条件补 `log_operate_id IS NULL` —— 不再早到丢关联、不再覆盖历史快照。
- **P3-21（C 段新登记）—— 已修复 2026-10-28**：`system:deleted:recover:mine` 已接线，
  `POST me/recover` 不再复用管理端 `system:deleted:recover`；seed 菜单行本就带该 element，
  按角色勾选即可授权（seed 内无角色持有旧管理权限点，接线不破坏既有恢复能力）。
- **P3-22（C 段新登记）—— 已修复 2026-10-28**：`GET /app/health/disk` 的检查路径改按
  `process.platform` 取根（Windows `C:/`、类 Unix `/`），非 Windows 部署不再恒失败。
- **P3-24（C 段新登记）—— 前提不成立 / 已收口**：`log_operate.action_type` 的 DB CHECK
  在 D 段复核时已含 **10 个值**（`...CLEAR/REFRESH/AUTH`，与 const 一致）；本轮只同步了
  实体注释与本节值域说明，不再有「撞 23514」缺口。
