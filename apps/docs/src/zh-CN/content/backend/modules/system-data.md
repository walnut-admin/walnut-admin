# 数据域与 techniques（deleted / logs / cache / event / queue / task / health）

数据域覆盖三件事：**回收站**（`system/deleted`）、**双日志体系**（`system/logs/auth`、
`system/logs/operate`）与**基础设施服务**（`modules/techniques/` 的 cache / event / queue /
task / health）。前两者是业务表的旁路数据，后者是它们与整个后端的运行时底座。

本文写**当前实现**（PostgreSQL 迁移后）。软删与恢复的公共基类在
`apps/server/apps/api/src/common/repository/pg-base.repository.ts`；已知缺陷的登记与裁决见
`apps/server/apps/api/test/api/DESIGN-ISSUES.md`（下文以 `P?-?` 引用）。
表设计依据 `docs/plans/postgres-migration-phase2.md` §4.15 ~ §4.17 与 §5.3。

源码入口：`apps/server/apps/api/src/modules/system/deleted/`、
`apps/server/apps/api/src/modules/system/logs/`、`apps/server/apps/api/src/modules/techniques/`。
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

### 1.2 恢复注册表

PG 有强 schema，快照 jsonb 不能像 Mongo 一样 `db.model(modelName)` 动态恢复。恢复路由收口为
`apps/server/apps/api/src/modules/system/deleted/repo/recover-registry.ts` 的显式注册表：
`modelName → IWalnutPgSnapshotRecoverer`，恢复器由
`createWalnutPgSnapshotRecoverer(entityTarget)` 生成，实现就是
`em.getRepository(entityTarget).insert(content)`——按快照行原样插回，**含原 uuid 主键与
`created_at` / `updated_at` 时间戳**（`insert()` 对显式赋值的列原样落库，只有 `undefined`
才触发生成默认值）。

- 注册清单 `WALNUT_PG_RECOVERABLE_COLLECTIONS` 覆盖已迁业务表；lock / mfa / preference /
  user_device / refresh_token 等**没有软删写路径**的表也一并注册（注册无害，兜住任何来源的
  历史快照）。
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
| `DELETE /system/menu/:id?_cascade=1` | `title` 非空时按 `title` 作为 locale `key` 软删该菜单的全部翻译行（`SysLocaleService.deleteByKey`）；子菜单不删（`pid` FK RESTRICT，撞 23503 → 40000） | 只恢复菜单行；locale 翻译行仍留在回收站（P2-23） |
| `DELETE /system/dict/type/:id` | 先按 `type_id` 逐行软删 dictData（各落一条 `SYS_DICT_DATA` 快照），再快照 + 硬删 type 行（P2-8 已修） | 只恢复 type 行；data 行需手工先恢复（data 有 `type_id` FK，顺序不能反） |
| `DELETE /system/dict/data/:id` / `deleteMany` | 按 `label` 作为 locale `key` 软删翻译行，并触发 locale 缓存全量刷新 | 只恢复 data 行；locale 行仍留在回收站（P2-23） |
| `DELETE /system/user/:id` | 无附加软删；`sys_user_role` / `sys_user_identity` / `sys_user_device` / `sys_user_lock` / `sys_user_mfa` / `sys_user_preference` / `sys_user_oauth` 由 FK CASCADE 硬删且不进快照 | 只恢复用户主行；`roles_list` 为空（P2-18），账户外围全部缺失（P2-22） |
| 设备行删除（`deleteNonMonitorUserDevice`，cron 路径） | `sys_user_device` 由 device_id FK CASCADE；设备行是硬删、不写快照 | 不走回收站 |

结论：**回收站只保证主行可回，级联软删的行与 FK CASCADE 的行都要单独处理**。P2-8 解决的是
「dictData 被 DB CASCADE 静默清掉」；恢复侧的联动仍是空白（P2-23）。

### 1.5 并发实测（G5）

`concurrency.api-spec.ts` G5 对同一条 `sys_deleted` 行并发 `recover`：原表 insert 在主键上
串行化，事务拦截器对败者回滚，结果**恰一路成功、另一路受控失败（40000 / 40401）**，
`sys_deleted` 快照不会复活、原表只有一行。`api-rollback.api-spec.ts` 另验证「恢复撞唯一键 →
40000 `recoverFail` + 快照行完好」的回滚传播。

## 2. 日志双系

### 2.1 log_operate（操作日志）

写入由 `WalnutAdminInterceptorRequestOperateLog`（`decorators/walnut/log.operate.decorator.ts`）
承担，只挂在带 `@WalnutAdminDecoratorOperateLog` 的 handler 上（CRUD 工厂会默认挂）。

- 拦截器在 `next.handle().pipe(tap({ next, error }))` 里发起 `void insertToLogOperate(...)`：
  **fire-and-forget**，不阻塞响应，异常只 `logger.error`，不会影响业务结果。
- 成功行：`statusCode` 取响应状态，`responseData` 是统一响应壳 + 翻译后的 `msg`；
  失败行：`success=false`，`responseData` 是 `WalnutAdminExceptionHandler` 的受控异常壳。
- `requestData` / `responseData` 经 `toWalnutPgJsonbPayload`（`log.operate.jsonb.ts`）处理：
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
- `logOperateId` 回填：DELETE / DELETE_MANY 成功后 `eventEmitter.emit(LOG_OPERATE_DELETE...)`，
  `AppTechEventService` 异步监听，按 `deletedId` 更新 `sys_deleted.log_operate_id`。
  该更新走连接级 manager（刻意不收事务句柄）。已知两个边界：事件发出与业务事务提交的
  先后不保证（早到则更新 0 行、只记日志），以及按 `deletedId` 会命中同一行的历史快照
  （重复软删时旧快照的关联被覆盖）——P2-29。

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

- 设备缓存 `SYS_DEVICE:<deviceId>` 与锁缓存 `SECURITY_LOCK:<userId>:global|deviceId` **没有 TTL**，
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
| `ERROR` | `modules/app/error` | 错误上报异步落库 |
| `EMAIL` | `modules/shared/mailer` | 验证码邮件、欢迎邮件 |
| `PHONE` | `modules/shared/sms` | 验证码短信（阿里云） |

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

两个运行特征：

- `AppTechTaskModule.onModuleInit` 会**同步执行**上述六个任务各一次（不含 purge job），
  即每次启动都会触发全量配置/语言重算、RT 标记、key 轮换、设备清理与 MFA 重算。
- 任务没有分布式锁或「上次执行时间」标记；多实例部署时每个实例都会各跑一遍。
  幂等性依赖各任务自身的 upsert / 条件判断（P2-28）。
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

cache / event / queue / task 没有 HTTP 端点；cache 的只读/删除面在 `modules/app/monitor/cache`
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
- **P2-17**：lang 与 locale 的缓存刷新不对称（`SYS_LANG_ID_LIST` 只在 locale 变更触发的
  全量刷新里写入）。
- **P2-18**：软删恢复不恢复 junction；恢复菜单丢全部角色授权、恢复用户无法登录。
- **P2-22（C 段新登记）**：恢复用户不恢复账户外围（identity / oauth / device / lock /
  mfa / preference 由 FK CASCADE 清空且不进快照）。
- **P2-23（C 段新登记）**：恢复不联动级联软删的 locale 行。menu `_cascade=1` 与 dictData
  删除都会把翻译行软删进回收站，但恢复主行不会恢复它们。
- **P2-27（C 段新登记）**：appSettings 的进程内 memo 失效覆盖面只到本进程：多实例部署下
  其他实例写 setting 不会失效本进程 memo；绕过服务直删 Redis 键也不会（只有监控台删缓存
  端点接了防御性失效）。
- **P2-28（C 段新登记）**：六个 `@Cron` 任务没有分布式锁，多实例会各跑一遍；
  `onModuleInit` 还会在每次启动时同步跑一遍（含 key 轮换与设备清理）。幂等性依赖任务自身
  的 upsert / 条件判断，`updateDeviceActiveStatusForCronJob` 在 dev 下直接 no-op。
- **P2-29（C 段新登记）**：`logOperateId` 回填是异步旁路。事件发出与业务事务提交的先后
  不保证，早到会更新 0 行且只记日志；按 `deletedId` 更新会命中同一行的历史快照，
  重复软删同一行时旧快照的 `log_operate_id` 被覆盖。
- **P3-21（C 段新登记）—— 已修复 2026-10-28**：`system:deleted:recover:mine` 已接线，
  `POST me/recover` 不再复用管理端 `system:deleted:recover`；seed 菜单行本就带该 element，
  按角色勾选即可授权（seed 内无角色持有旧管理权限点，接线不破坏既有恢复能力）。
- **P3-22（C 段新登记）—— 已修复 2026-10-28**：`GET /app/health/disk` 的检查路径改按
  `process.platform` 取根（Windows `C:/`、类 Unix `/`），非 Windows 部署不再恒失败。
- **P3-24（C 段新登记）—— 前提不成立 / 已收口**：`log_operate.action_type` 的 DB CHECK
  在 D 段复核时已含 **10 个值**（`...CLEAR/REFRESH/AUTH`，与 const 一致）；本轮只同步了
  实体注释与本节值域说明，不再有「撞 23514」缺口。
