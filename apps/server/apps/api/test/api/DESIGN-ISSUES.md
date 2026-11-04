# API 设计问题清单（DESIGN-ISSUES）

> **唯一真源**：散落在 `ENDPOINTS.md` 各段「钉现状」与 F 段「安全矩阵发现」的行为缺陷/设计问题，
> 自 G+H 段（2026-10-26）起收编为本清单；此后新发现一律记这里，`ENDPOINTS.md` 各段只保留
> 历史叙述并指向本文件，不再双份维护。
>
> **本文件只保留开放条目**（未修复且未豁免）。已修复、已豁免与裁决确认的条目全文在
> [`DESIGN-ISSUES-ARCHIVE.md`](./DESIGN-ISSUES-ARCHIVE.md)：条目号永久保留，测试断言/提交信息中
> 对旧条目号的引用不受影响。部分修复但仍有残余面的条目（P2-18 / P3-14）继续留在本文件，
> 标题或正文注明剩余面。
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
> **统计：开放 17 条（P0 × 0 / P1 × 0 / P2 × 5 / P3 × 12）**。新条目编号顺延到已用最大号之后
> （当前最大 P3-38，下一个 P3-39），不复用归档里的编号。P2-28 已修复（批 W2-A），按本批要求
> 就地标注、待归档批次统一迁入归档。

---

## P0 安全

当前无开放条目：6 条全部已修复或已裁决，见归档 P0 节。

## P1 行为缺陷

当前无开放条目：20 条全部已修复，见归档 P1 节。

## P2 语义怪异

### P2-14 并发 login/finish 的 Duplicate Auth 判据是「读后写」

- **位置**：`libs/auth/src/modules/refresh/shared/refresh.shared.service.ts`
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
- 【部署口径 2026-10-28：单实例部署，本条降级为 backlog 观察】

### P2-18 软删恢复不恢复 junction —— 恢复菜单丢全部角色授权、恢复用户无法登录（B 段，新登记）—— 【部分修复 2026-10-28（用户外围联动；junction 部分维持登记）】

- **位置**：`libs/repository/src/pg-base.repository.ts`（`deleteSoftById`：
  只快照主行，随后硬删原行）+ `libs/system/src/deleted/deleted.service.ts`
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
  无独立软删通道」的结构性取舍；同族的 P2-22（账户外围，含 oauth）与 P2-23（locale 级联）
  已于 2026-10-29 修复，junction 快照方案仍留待统一处理。

### P2-21 device 锁/封的读改写与 guard 回填竞态 —— 状态位可丢更新、缓存可被旧快照覆盖（C 段，新登记）

- **位置**：`libs/system/src/device/device.service.ts`（`updateLockOrBanStatus`）+
  `device/repo/device.repo.service.ts`（`findDeviceByDeviceIdAndUpdate`：`findOne` →
  `Object.assign` → `save`）+ `libs/guards/src/guards/device.guard.ts`（缓存 miss 回源分支）。
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
- 【部署口径 2026-10-28：单实例部署，本条降级为 backlog 观察】

### P2-27 appSettings 进程内 memo 的失效覆盖面 —— 多实例与外部删键都失效不到（C 段，新登记）

- **位置**：`apps/server/libs/cache/src/service/appSettings.cache.ts`
  （`appSettingsMemo` / `settingMemo`）。
- **现象**：memo 只在本地 `setAppSettings` 时清空；多实例部署下其他实例写 setting 不会失效
  本进程 memo，本进程最长要等到下一次本地写才回正。绕过服务直删 Redis 键（非监控台删缓存
  端点）也不会失效；代码注释自述当前依赖单实例部署，但该边界没有进 DESIGN-ISSUES。
- **实测证据**：本次读码 + 源码注释；无多实例环境可实测。
- **建议**：扩多实例前补 Redis pub/sub 或 keyspace 通知失效；短期给 memo 加短 TTL 并在
  部署文档写明单实例前提。
- 【部署口径 2026-10-28：单实例部署，本条降级为 backlog 观察】（memo 的进程内边界注释保持，
  扩多实例前仍需按上方建议处理）

### P2-28 定时任务没有分布式锁，且启动期同步跑全量任务（C 段，新登记）—— 【已修复（批 W2-A）】

- **位置**：`apps/api/src/modules/techniques/task/task.service.ts`（六个 `@Cron`）+
  `task.module.ts`（`onModuleInit` 依次调用六个任务）+
  `libs/auth/src/modules/refresh/repo/refresh.pg.purge.service.ts`（每小时 purge）。
- **现象**：`@Cron` 是进程内的，没有分布式锁或执行标记；多实例部署时每个实例都会各跑一遍
  全量配置/语言重算、RT 标记、key 轮换、设备清理与 MFA 重算。每次启动 `onModuleInit` 还会
  同步执行一遍（含 `rotateAppKey` 与设备清理），启动耗时与副作用随数据量增长。
  幂等性依赖各任务自身的 upsert/条件判断；`updateDeviceActiveStatusForCronJob` 在 dev 下
  直接返回全零，开发环境不会执行设备清理。
- **实测证据**：本次读码；无多实例环境可实测。
- **建议**：引入 Redis 分布式锁（`murlock` 或 `SET NX` + 过期）或 job 注册表；启动期只保留
  settings/locale 预热，把 rotate / 清理挪出同步执行路径。
- 【部署口径 2026-10-28：单实例部署，本条降级为 backlog 观察】
- **修法（批 W2-A，2026-11-01）**：① 七个 `@Cron` 入口（六个任务 + PG purge）统一经
  `AppTechCacheCronLockService`（`libs/cache/src/service/cache.cron-lock.ts`）做 Redis
  `SET NX EX` try-lock：拿不到锁的实例 warn 后跳过本次 tick、Redis 异常 fail-open 照常执行，
  `@Cron` 另加 `waitForCompletion: true` 防同实例自重叠；② bootstrap 六任务拆入
  `AppBootstrapTaskModule`（`AppTechTaskModule` 回归纯 cron 宿主），默认归 api、
  `WORKER_STANDALONE=true` 时归 worker（组合根单份，bootstrap 不占 cron 锁）；③
  `rotateForCronJob` 的过期判断移入事务内、`FOR UPDATE` 锁行后重判 —— 双进程交错时后进者
  等锁后看到先者的新 ACTIVE 行即跳过，不再连环作废新 key。
  **测试**：`cache.cron-lock.spec.ts` 7 例（W2-A 6 例 + 修复批抢锁超时 1 例）+
  `task.service.spec.ts` 8 例（单次执行守卫）+ `app.key.int-spec.ts` 并发 rotate 用例。

### P2-30 key 轮转没有重叠窗口 —— 旧公钥密文在 rotate 后不可解，且 current 不校验 validEnd（D 段，新登记）

- **位置**：`libs/app-domain/src/key/key.service.ts`（`rotate` / `rotateForCronJob`）+
  `libs/rsa/src/rsa.service.ts`（`getCurrentRsaPrivateKey`）+
  `libs/guards/src/interceptors/request/decrypt.interceptor.ts`。
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
- 【部署口径 2026-10-28：单实例部署，本条降级为 backlog 观察】

## P3 契约不一致

### P3-14 logger / monitor-cache 行无 `id`，两个 read 端点无 schema —— 【read schema 已补：2026-10-29】

> 收尾批已给 `GET /app/logger/:logType/:fileName` 补 `AppLoggerReadResponseDTO`
> （wire 零变化，admin 改用生成别名）；文档债批次又给 `GET /app/monitor/cache/{key}`
> 补 `AppMonitorCacheReadResponseDTO`（`{ value }`，value 为任意 JSON、缺失键 null）。
> **剩余观察**：两个 list 行的 `id` 虚构（等 server 决定是否给两表真实主键后再摘）。

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
- **修法（2026-10-29，文档债批次）**：cache read 改为显式 `@Get(':key')` +
  `@ApiWalnutOkResponse({ DTO: AppMonitorCacheReadResponseDTO })` + `@ApiParam`（同 logger
  read 手法，不再复用 CRUD read 的行 DTO）；`value` 用 `oneOf`（string/number/boolean/
  object/array + nullable）表达任意 JSON，生成 `value: string | number | boolean |
  { [key: string]: unknown } | unknown[] | null`。wire 零变化；admin 缓存详情抽屉仍按
  `{ value }` 消费。

### P3-17 ENDPOINTS.md 的 sensitive verify 请求形态与 DTO 不符（文档大轮次 A 段，新登记）

- **位置**：`apps/api/test/api/ENDPOINTS.md` §3 `security/sensitive` 行 vs
  `libs/security/src/sensitive/sensitive.dto.ts`
  （`SecuritySensitiveVerifyRequestDTO`）。
- **现象**：ENDPOINTS 把 verify 请求登记为 `{basic,action,type,code}`，实际 DTO 是
  `{level, operationType?, method, credential}`（`security.api-spec.ts` 用例也按后者发）。
  另外 check 用 query `type`、verify 用 body `operationType`，同一概念两个名字。
- **实测证据**：本次文档复审读码 + `security.api-spec.ts` 的 verify 用例字段。
- **建议**：修正 ENDPOINTS 行；若允许破坏性改动，统一 check/verify 的参数命名。

### P3-19 ENDPOINTS.md 把 me/profile 的权限点登记为 `me:profile:update`，代码是 `system:user:updateProfile`（B 段，新登记）

- **位置**：`apps/api/test/api/ENDPOINTS.md` §5 user/me 行 vs
  `apps/api/src/modules/system/identity/user.me.controller.ts` 的
  `Permissions.UPDATE_PROFILE = 'system:user:updateProfile'`。
- **现象**：文档与代码的权限串不一致；`user-me.api-spec.ts` 用 root 调用（权限守卫 root
  短路），差异不会暴露。若前端菜单 seed 按文档串配置，非 root 用户改资料会 40105。
- **实测证据**：本次读码 + 全仓 grep：`me:profile:update` 只出现在 ENDPOINTS.md。
- **建议**：修正 ENDPOINTS 行；若确定统一到 `me:` 前缀，则同步改 controller 与菜单 seed。

### P3-27 JWT_AT / JWT_RT 没有生产写入点 —— DTO 声称的「启动自举」不存在（D 段，新登记）

- **位置**：`libs/app-domain/src/key/dto/key.dto.ts`（`AppKeyInitTypeNotSystemManagedConstraint`
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

- **位置**：`libs/app-domain/src/shared/area/area.basic.repository.ts` 的
  `findSubtreeByCode` / `assembleSubtree`。
- **现象**：整子树 / 限深查询（递归 CTE + `CYCLE` 环保护）已实现，但 `SharedAreaService` 与
  controller 都没有调用；对外只有 children（单层）与 feedback（向上收集同级）两个端点。
  phase2 §5.1 设计的「整树一次性拉取」在 HTTP 面不可达，属预留能力或死代码。
- **实测证据**：本次读码 + 全仓 grep：两个方法只在本文件与 service 头注出现。
- **建议**：补一个子树端点（可带 maxDepth），或明确标注「预留，未接线」并在 knip/清理批次
  决定去留；不要让读者以为线上有整树能力。

### P3-29 monitor/server 八个端点各自执行宿主机探测 —— 无缓存 / 无合并 / 无限流（D 段，新登记）

- **位置**：`libs/app-domain/src/monitor/server/server.controller.ts` +
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

### P3-31 cap.guard 的 40111 YouAreBot 是死分支 —— 自抛自吞 —— 【已修复 2026-11-03】

- **位置**：`libs/guards/src/guards/cap.guard.ts` 的 `performCapVerification`。
- **现象**：`AppCapJS.validateToken` 返回 `success=false` 时函数内抛
  `WalnutAdminExceptionYouAreBot`（40111），但同一 `try` 的 `catch` 把所有异常吞掉并
  `return false` —— 调用方（`canActivate`）随后按 `shouldChallenge` 改抛 40116/40117。
  **40111 永远到不了客户端**（error.controller 的 ErrorMap 还给它挂了异常类）。
- **实测证据**：`cap.guard.spec.ts` G9 —— mock `success=false` 后只能观察到 40116/40117，
  专门断言「不是 YouAreBot」；HTTP 级 guard-matrix CAP 组也只见过 40116/40117。
- **建议（裁决项，需契约确认）**：二选一 —— ① `catch` 对自身业务异常 rethrow（40111 真正
  可达，前端已有 40111 文案）；② 删除 40111 分支与 `error.controller` 映射，把「验证失败
  统一走刷新/交互」写进契约。**本轮不修**：改错误面属于客户端契约变更，须与前端共同拍板。
- **修复（2026-11-03）**：取 ① 的**窄口径** —— `performCapVerification`
  先按形态判「这根本不是我方签发的 cap.js token」（失败在**本地**即可证），该分支的 40111 挪到
  `try` 之外抛出（不再被自己的 `catch` 吞掉）；而 `validateToken` 抛异常与 `success:false`
  （一次性 token 已消费/过期）仍返回 false 走 40116/40117 —— 后者是**唯一**能被正常用户命中的
  路径，若也抛 40111，前端跳 /not-allowed，等于缓存窗口一到就把全部用户踢一次。
  钉子见 `libs/guards/src/guards/cap.guard.spec.ts`（用例 3/4 断言 40111，用例 7/8 断言可自愈）。

### P3-33 permission.guard 数组权限缺 mode 时静默放行（guard 分支覆盖补齐批，新登记）

- **位置**：`libs/guards/src/guards/permission.guard.ts`（数组分支只处理 `AND`/`OR` 两个
  枚举值，二者都不是时 `canNext` 保持 true）。
- **现象**：若通过 `SetMetadata` 直接写数组权限、又不写 `PERMISSION_MODE`，守卫会把
  「没有模式」当放行 —— 与 roles.guard 已修的同类陷阱同构。当前无触发面：全仓数组
  调用方（`device.controller` 6 处、`log.operate.controller` 2 处）全部显式传 `'and'`；
  `key.controller` 的 `app:key:read` 是**字符串**（`AppKeyCurrentGuard` 复用同一守卫）。
- **实测证据**：本次全仓 grep（数组调用点均带显式 mode）+ 读码；无 HTTP 可达路径。
- **建议**：与 P3-32 同口径 —— 数组分支遇到未知/缺失 mode 直接抛 40105（或默认按 `and`
  判定），不保留「未判定即放行」。本轮**纯登记**（无调用方受影响，避免无谓行为变更）。

### P3-34 device.guard 的 `active` 字段从未参与判定（guard 分支覆盖补齐批，观察项登记）

- **位置**：`libs/guards/src/guards/device.guard.ts`（缓存/DB 两条腿都读 `active`，但只用
  `banned` / `locked` 判定）+ `cache.device.ts` 的 `DeviceCache.active`。
- **现象**：`sys_device.active` 只被设备初始化的 `active=true`、cron 清理
  （`updateDeviceActiveStatusForCronJob`）与读接口消费，**准入链不检查它** —— 停用设备
  仍可通过 guard（除非同时 locked/banned），字段语义与「设备准入」脱钩。
- **实测证据**：本次读码；guard-matrix 的 Device 组只覆盖 banned/locked/缺失/篡改。
- **建议**：确认产品口径 —— 要么 guard 对 `active=false` 返回 40605/40606 族受控拒绝，
  要么在实体/文档注明「active 只用于统计与清理，不是准入位」。本轮仅登记。

### P3-37 `app.functional.role` 变更未失效 `AUTH:PERMISSIONS`（数据权限复审，缓存残留）

- **位置**：`libs/system/src/role/shared/role.shared.service.ts`
  （`getCoreMenus` 用 `app.functional.role` 经 `SharedScopeResolverService.resolve`
  决定 effective roleMode）+ `apps/server/libs/cache/src/service/permissions.cache.ts`
  （`AUTH:PERMISSIONS:<userId>:<deviceId>` 缓存键没有版本号维度）。
- **现象**：`app.functional.role` 从 COMBINE 切到 SWITCH（或反向）时，数据权限描述符已由
  批 4 的全局 epoch 失效，但 `AUTH:PERMISSIONS` 仍按旧 roleMode 计算，残留最长一个 AT TTL
  —— 同一用户的菜单/权限串与数据可见面会短暂不一致。该面是既有行为，超出批 4 范围。
- **实测证据**：`permission-chain.api-spec.ts` 的 SWITCH/COMBINE 对照用 `overrideAppSettings`
  直接改 APP:SETTING 缓存并**重新登录/重拉权限**，未覆盖「设置变更后不重登的权限缓存残留」；
  `data-scope-matrix.api-spec.ts` M10b 只断言数据面。
- **建议**：与 P3-36 同方案 —— 设置写入口 bump 一个权限缓存世代（键纳入
  `AUTH:PERMISSIONS:<epoch>:...`），或设置写路径按权限维度显式清全量
  `AUTH:PERMISSIONS:*`；两条写通道（setting create/update 与 `updateAppSettingByKey`）
  都要覆盖。本轮仅登记。

### P3-38 guard-matrix「非黑名单伪造 IP 直通 → 20000」用例全量连跑时间歇失败（全量集成观察，新登记）

> **状态（2026-11-01，已确定性化）**：spec 的 beforeAll 预写 `risk:location:<ip>` 的 LOW
> 结果覆盖全部 TEST-NET-3 探针 IP（afterAll 清理），根因是 api.ip.sb 对保留 IP 段返回
> HTTP 400 → 50302；键构造与服务端同走 normalizeIp。连跑两轮整轮集成均稳定。

- **位置**：`apps/api/test/api/platform/guard-matrix.api-spec.ts`（IP guard 组的
  「【安全矩阵发现】非黑名单伪造 IP 直通 → 20000」用例）→
  `libs/security/src/risk/modules/location.service.ts`
  （`evaluateLocationRisk` / `performLocationEvaluation`）→
  `libs/ip/src/ip.service.ts`
  （`getLocationInfoFromFreeAPI` 对外网 `api.ip.sb` 的请求失败即抛 50302
  DependencyDown）。
- **现象**：该用例预期待测请求直通（业务码 20000），在**全量集成连跑**中偶发拿到
  HTTP 200 + 业务码 **50302**（Dependency Service Down）；单跑该文件 44/44 稳定通过。
  链路：伪造 IP 是 TEST-NET-3 段（非本地地址）→ risk guard 的 location 评估走
  `getLocationInfoFromFreeAPI` 真打外部 geoip API；风险结果按 IP 缓存在 Redis，
  缓存命中时不触外网（所以单跑文件常绿），缓存未命中/被前序用例清掉时暴露对外网的依赖，
  外网失败被 risk guard 按 HttpException 原样上抛（P1-13 的口径），请求拿到 50302。
- **实测证据**：2026-10-31 凌晨全量集成 4 轮中出现 2 次，失败响应形如
  `{"code":50302,"msg":"Dependency Service Down"}`；同文件单跑 44/44 通过。
- **建议**：先排查该断言依赖的下游（IP guard / 限流 tracker 的 Redis 依赖、location
  风险缓存）是**测试间状态污染**还是**真外网抖动**；无论哪种，都把用例做成确定性的 ——
  预置该 IP 的 location 风险缓存，或 stub `SharedIpService.getLocationInfoFromFreeAPI`，
  把「非黑名单 IP 直通」断言与被测的 IP 黑名单判定隔离开；不要让基础设施依赖失败让
  钉现状用例抖动。
