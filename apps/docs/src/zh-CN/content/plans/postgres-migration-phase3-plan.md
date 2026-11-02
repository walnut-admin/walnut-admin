# Phase 3 逐模块迁移实施计划（B0-B10）

> **位置变更（2026-11-02）**：本文自仓库根 docs/plans/ 迁入 docs 站。状态：【已完结】，后续演进见 [ADR 0021](/content/adr/0021-postgresql-migration) 与 [数据库与初始化数据](/content/backend/postgresql)。

> 真源文档：`postgres-migration-phase2.md`（表结构）与 ADR 0021（决策）。
> 本文件是 Phase 3 的执行蓝图（2026-10-25 调研定稿），供各迁移批次 Agent 引用。
> B0 已交付（fc0d51c）；本文件随批次推进更新勾选状态。
>
> **状态：已完成（2026-10-25）。** B0-B9 逐批验收通过；B10（终批清理）与 Phase 5 合并执行完毕
> —— Mongo 依赖与双轨代码已全部摘除，收尾摘要在 ADR 0021 的 Implementation 小节。

## 0. 已锚定的机制（B0 交付，勿再发明）

- **事务上下文**：`WalnutTxContext = { em: EntityManager; dbSession?: ClientSession }`。
  `@WalnutDBSession()` 返回它；已迁模块取 `ctx.em`，未迁模块取 `ctx.dbSession`。
- **双引擎拦截器** `WalnutTxInterceptor`：PG QueryRunner 先 commit、Mongo session 后 commit；
  失败路径守卫含 `pgReleased/mongoEnded`；engine 元数据可收窄（`pg|mongo|both`，默认 both）。
- **PG 基类仓库** `WalnutAdminCommonPgBaseRepository`：create/readById/update/updateByField/
  deleteSoftById/deleteRealById/*_Many/deleteSoftManyByCondition/list，事务句柄一律 `em?`；
  软删快照 jsonb 直存对象（不再 stringify），返回删除前浅拷贝（TypeORM remove() 会就地清空实体）。
- **PG 列表构建器** `pg-list.builder.ts`：ILIKE 转义（\%_ 前置反斜杠）、排序/过滤 key 过实体列白名单、
  `COUNT(*) OVER()` 单趟；出参 `{ data, total }`。
- **uuid 三件套**：`WalnutAdminPipeUuid` / `WalnutAdminDecoratorValidatorUuid` / uuid 参数装饰器。
- **回收站 PG 通道**：`SysDeletedPgRepoService.createSoftDelete` + `recover-registry.ts`
  （modelName → 恢复器注册表，B9 装配实现）。
- **purge job**：refresh 过期行清理已上线（pg.purge.int-spec 守护）。

## 1. 迁移批次与验收

每批验收（机械，全绿才准提交）：`pnpm lint` / `pnpm types:check` / `pnpm test` /
`pnpm test:integration` / `pnpm prepush` / `pnpm boundaries` + 该批 int-spec 改写后通过。

| 批 | 范围 | 状态 |
|---|---|---|
| B0 | 公共骨架（上表全部）+ 初始 migration + data-source.cli | ✅ fc0d51c |
| B1 | app/demo + app/error（叶子试点，确立三层改造模板） | ✅ |
| B2 | sys_lang + sys_locale（FK 同批；i18n 聚合 SQL 重写） | ✅ |
| B3 | dictType + dictData（FK 同批） | ✅ |
| B4 | app_setting + app_key + shared_area（递归 CTE + CYCLE 兜底） | ✅ |
| B5 | sys_menu（meta 拍平组装出参）+ sys_role + sys_role_menu；产出 defaultRole uuid 订正脚本 | ✅ |
| B6 | sys_device + sys_user_device + app_monitor_user（双向环同批） | ✅ |
| B7 | SCC-A 账户团九表（user/identity/oauth/lock/mfa/preference/device/refresh + auth 全系 + security） | ◐ **B7a ✅ B7b ✅ B7c ✅**（7a=user/identity/oauth + auth 系签名适配 + review 挂单三项；7b=lock/mfa/preference/refresh 全 PG + 消费方单 em 归一；7c=auth 全链 + security 收口 + 登录全链 int-spec，SCC-A 九表全部 PG） |
| B8 | sys_log_operate + sys_log_auth + techniques/event（fire-and-forget 旁路） | ✅ |
| B9 | sys_deleted 收尾：恢复注册表装配、recover/recoverMine PG 化、Mongo 侧下线 | ✅ |
| B10 | 终批清理（摘 MongooseModule、Mongo int-spec、双轨残留；与 Phase 5 合并执行） | ✅（与 Phase 5 合并执行完毕） |

## 2. 三层改造模板（B1 确立，后续批次照抄）

- controller：`@WalnutDBSession() ctx: WalnutTxContext` → service 调用传 `ctx.em`；
  路由参数 ParamMongoId → uuid 参数装饰器；DTO 校验 IsMongoId → IsUUID；`.toObject()` 移除
  （实体即 POJO），DTO 组装统一 `plainToInstance(DTO, entity)`（B1 定案：实体字段可空性比
  DTO 宽，直配构造器过不了 TS，plainToInstance 免转型，后续一致）。
- service：方法签名 `dbSession?: ClientSession` → `em?: EntityManager`，纯透传。
- repo：`XxxBasicRepository extends WalnutAdminCommonPgBaseRepository<XxxEntity>`，类名与
  文件名保持不变（DI token 不动）；特殊查询用 QueryBuilder / `customize` 钩子，不用原生 SQL
  拼接。原先无 repo 的模块（如 error 直持 model）随迁移补一个同模板 repo。
- 模块接线形态（B1 定案）：直接在既有 module 的 imports 数组加
  `TypeOrmModule.forFeature([XxxEntity], WalnutPGConnectionName)`（autoLoadEntities 装载），
  **不新建 xxx.pg.module 文件**；该模块的 Mongo forFeature 随迁移摘除，未迁模块原样保留。
- DTO 形态（B1 定案）：DTO 链继续以既有 schema 类为元数据基座（schema 文件保留，模型注册
  摘除后仅承载校验/swagger/Expose）；uuid 化字段在 DTO 子类**重声明**，用
  `WalnutAdminDecoratorValidatorUuid` 整体替换继承的 IsMongoId 约束（class-validator 按
  propertyName+type 去重，实测子类重声明即替换），schema 侧属性 TS 类型注解随列型放开为
  string；DTO 头部补 `id`（Expose + IsOptional + uuid 校验，供响应序列化与 list 键枚举），
  Safe 层剔除 Mongo `_id`。

## 3. 测试演进规则

- 每批只改写该批模块涉及的 int-spec；fixture 从 Mongo model 直建改为 PG repo/em 直建；
  ObjectId 形态断言换 uuid 形态。
- **载体退役**：Mongo 版基线测试若以已迁模块为载体（如 demo），随批退役——其行为基准已在
  git 历史存档（Phase 0 提交），PG 侧对应用例接管。retire 而非硬留。
  B1 已退役：repository.base / recycle.recover / virtual.populate / transaction 四个
  int-spec。B2/B3 交付 `lang.locale.i18n.int-spec`（i18n 聚合 SQL 重写的对账基准）。
- **pg.transaction 的 Mongo 写腿永久解耦**（B2/B3 定案）：B1 曾改用「任选一个未迁模块的
  已注册 mongoose 模型（sys_dict_type）直写」，随 B3 迁走 dict_type 即失效——按模块追着换
  载体不可持续。改为在命名连接上注册一次性 scratch 模型
  （`new Schema({}, { strict: false })`，集合 `int_spec_scratch`），用它的
  `create(..., { session })` 做事务性 Mongo 写。载体与迁移顺序无关，B10 随 Mongo 一起清理。
- 并存冒烟：B7 增「同 ctx 双写、PG rollback 连带 Mongo abort」用例（B0 已有基础用例可扩展）。
- B6 交付 `device.user-device.monitor.pg.int-spec`（设备三角对账基准：业务键 FK / CASCADE /
  ipHistory 追加截断 / visitorId upsert / forceQuit 链路 / JOIN 版列表）。
- B7a 交付 `user.identity.oauth.pg.int-spec`（junction 组装 / defaultRole v5 uuid 链路 /
  identity 复合唯一 23505 + value select:false 通道 / oauth bind upsert + 外部账号唯一）。
- B9 交付 `deleted.recycle.pg.int-spec`（回收站全链对账基准：3 集合软删同通道 → 列表
  populated_user / content jsonb ::text 模糊 → read → recover 跨 3 集合注册表路由
  （原行回来且 uuid / 时间戳形态正确）→ recoverMine 属主语义 + 双键定位 → 全量回滚
  无残留（第一步成功第二步唯一约束冲突 force-rollback）→ 未注册 modelName 受控错误 →
  彻底删除）；`log.bypass.pg.int-spec` 的 logOperateId 现状钉解锁为真实事件链路断言
  （DELETE / DELETE_MANY 回填 + 未命中不抛错）。注意 deleteSoftById 的返回值是业务行
  快照（id 即 deletedId），回收站定位键是 sys_deleted 行自身的 id。
- B7b 交付 `user.lock.pg.int-spec`（hash 写入路径首插/更新全覆盖 + upsert 缺省列 +
  shared lock 联动 user_device）、`user.mfa.pg.int-spec`（uq_user_mfa_credential partial
  23505 + 密文列 select:false 通道 + bigint counter transformer + backup_codes 并入 totp 行
  + 聚合 GROUP BY + CASCADE）、`auth.refresh-token.pg.int-spec`（索引对齐 / 轮换事务原子性
  [revoke+rotate 同回滚] / generateRefreshToken uuidv7 + DuplicateSignIn / 设备业务键 FK
  CASCADE）；`user-preference.upsert.int-spec` 改写 PG（upsert 幂等三态 + jsonb orUpdate +
  bind 幂等）。B6 的 forceQuit 跨引擎用例段（refresh 写腿走 Mongo 的现状断言）随本批改写为
  同库 revoked 断言。
- B7c 交付 `auth.login-chain.pg.int-spec`（登录全链对账基准：opaque 注册/登录真实
  crypto 栈 + 注册/登录事务原子性 force-rollback / otp 三态与验证码消费 / oauth
  identity 建立链 / signout 三触发 / MFA verify 双通道 / sensitive 授权生命周期
  与钉现状 / risk 四条评估写腿）。
- B9/B10：删 Mongo 段 global-setup 与 Mongo int-spec。

## 4. ID 使用点清查（改造归属）

| 位置 | 批 |
|---|---|
| mongoId pipe/validator/ParamMongoId（新增 uuid 版并存） | B0 ✅ |
| listAggregate.ts:70-71（ObjectId 转换分支） | B0 ✅（PG 版）|
| base.repository deletedBy / deleted.repo createSoftDelete | B0 ✅ |
| locale.pipe、lang.repo.service | B2 ✅（pipe 换 uuid 校验；lang.repo 两条聚合 SQL 重写） |
| role.repo.service `$in` | B5 ✅（`In(uuid[])`；junction populate 同批） |
| error.process.ts | B1 ✅（uuid 直传，删除 ObjectId 包装） |
| monitor/user.repo.service | B6 ✅（`new ObjectId` → uuid 直传；user_device.repo 同批完成） |
| user.crud / user.shared（defaultRole 消费点） | B7a ✅（uuid 直用；safe id 常量补 v5 双形态） |
| user_identity（B7a ✅）/ user_oauth（B7a ✅）/ user_lock（B7b ✅）/ user_mfa（B7b ✅，totp+webauthn+backup_codes 并行）/ user_preference（B7b ✅）/ refresh.repo（B7b ✅） | B7a ✅（identity/oauth）；B7b ✅（lock/mfa/preference/refresh） |
| log.operate.decorator / log.auth.shared.service | B8 ✅（:104 / :109 的 `new ObjectId` 摘除，uuid 直传；匿名/登录失败为 NULL） |
| deleted.service recover 链路 | B9 ✅（`restoreSnapshotContent` 随 jsonb 快照形态退役；恢复走注册表，uuid 直存直取） |

## 5. 残留窗口（如实写进风险评估）

1. **回收站双源**（B1~B9）：已迁模块软删写 PG `sys_deleted`，未迁写 Mongo；回收站列表/恢复
   在 B9 前是 Mongo 版，看不到 PG 侧删除。缓解：B0 注册表骨架 + 迁移期口径「回收站只管未迁
   模块」。**B9 已归一**：recover/recoverMine 走恢复注册表 + PG 事务，列表/读取 populate
   deletedBy 查 PG 同源表（B7a 过渡态的 hex→null 分支摘除）；Mongo 版删除链路
   （deleted 的 Mongo forFeature、SysDeletedRepoService、Mongo 基类仓库、listAggregate
   聚合）随批删除 —— 全仓业务表零 Mongo 写腿。
2. **setting_value 内嵌 id**（B4~B7）：`app.default.role` 值须在 B7 切换前重写为 role 的 v5 uuid。
   B5 产出的订正脚本（bin `walnut-fix-setting-default-role`，根目录 `pnpm db:fix-default-role`；
   `--dry-run` 只看不写，`--env-file / --pg-db / --db / --uri / --key` 可覆盖默认连接口径）
   幂等：值已是 uuid → no-op；hex → 校验其在 Mongo `sys_role` 存量 `_id` 中存在后重写为
   v5（namespace 见 `packages/tooling/scripts/src/db/uuid5.ts`，phase2 §3.3 回写引用）；
   脏值拒绝改写。**运行时机：B7 开工前对目标库跑一次并核对。**
   B7a 后消费侧已全量 uuid 语义（crud/shared 直用 + cache.appSettings 兜底常量改 v5 uuid，
   见 §6）—— 对目标库跑订正脚本是**运行时前置**，代码侧不再有 hex 分支。
   **Phase 5a 已退役**：hex 白名单依赖 Mongo 存量读取，MongoDB 摘除后失去数据源；
   存量订正已随 ETL 完成（脚本退役，其 E2E int-spec 一并删除）。
3. **权限链路跨引擎**（B5~B7a）：menu/role 已迁 PG，user 在 B7a 前仍在 Mongo —— token 里的
   roleIds/currentRole 是 ObjectId hex，`In(uuid[])` 查不到行（ETL 前的 PG 侧 sys_role
   本就为空），故 B5~B7a 期间登录后的权限/路由生成走 PG 空数据，`getCorePermissions` 的
   root 分支需要 PG 里存在根菜单。集成测试以 PG fixture 直建覆盖该链路；运行时行为在
   B7a（user 迁移 + 订正脚本落地）后归一。**token 里 roleIds/currentRole 现为 uuid**
   （B7a 起 getJwtAccessTokenPayload 吃 PG 实体 + junction 组装）。B7b 后登录态两条腿
   （user/role 查询、refresh 表）同为 PG；**B7c 后 auth 策略内部与 security 全部收口，
   登录链路（opaque/otp/gitee/github + refresh 轮换 + device 绑定）单引擎单事务，
   本窗口已归一（B7c）**。
4. **设备三角跨引擎 user 引用**（B6~B7）：`sys_user_device.user_id`（FK → sys_user）与
   `app_monitor_user.user_id`（松引用）是 uuid 列，B7a 前 token 里的 userId 是
   ObjectId hex —— 登录绑设备（bindDeviceForUser）、auth 访客的 monitor state（DTO 已换
   IsUUID，hex 请求 400）、user 维度的锁定 / forceQuit 读写会以 22P02 / FK 拒绝呈现；
   device.initial 与匿名 monitor state（无 userId）不受影响。B7a 后 token userId 即
   PG uuid；**B7b 后 refresh 读写走 PG** —— Mongo 侧存量 refresh 行
   不再被读到（userId 仍是 hex 的旧行留在 Mongo，随 Phase 4 ETL 评估是否搬移），
   已登录会话首次刷新令牌时 `findByJti` 落空 → RefreshTokenExpired（用户重新登录自愈，
   与 B7a 前提的旧行 hex 落空路径同一自愈形态）。populate user 读腿查 PG
   sys_user 同源表（role B5 的 usersCount 同款手法）。**B7c 后登录绑设备
   （bindDeviceForUser）与 MFA trusted 写腿也收进登录/verify 的同一 PG 事务，
   该窗口已归一（B7c）**。
5. 审计旁路本就是 fire-and-forget 最终一致，不新增风险。

## 6. 岔路决策记录（自主执行期间按推荐项走）

- ID 生成：DB 端默认值（v5 只在 ETL/seed 通道），应用不生成。
- 载体退役优先于硬留（见 §3）。
- 特殊查询一律 QueryBuilder + `customize`，不写原生 SQL 字符串拼接。
- 每批一个提交，type feat/test 视内容，scope server。

### B7a 追加

- **guard 阶段发起的 auth 流程自管 PG 事务**：gitee/github/otp 的 validateIdentity 从
  passport strategy（guard 阶段）发起，早于拦截器 —— `request.txContext` 尚不存在，
  传不了 `ctx.em`。沿用 Mongo 版「自管事务」的形态换成 QueryRunner（签名不变、strategy
  零改动、三条 PG 写腿保持原子）；handler 阶段的 generateAuthTokens / verifyIdentity
  照常走 ctx（双引擎）。
- **auth 双句柄并传**（finishChangePassword / verifyMfaStatus / getNewAccessToken /
  totp·webauthn verify）：PG 腿收 `em`（ctx.em），仍迁 Mongo 的腿收 `dbSession`
  （ctx.dbSession），7b/7c 归一时摘。
- **safe id 常量双形态**：`WalnutAdminConstSafeRoleId/UserId` 同时持有原 hex 与 v5 派生
  uuid（派生规则 uuid5.ts 同源）—— user.crud 的 safe 拦截在双引擎窗口两边都拦得住，
  B10 摘 hex。
- **defaultRole 兜底常量改 v5 uuid**：cache.appSettings 的 `defaultRole` 兜底值由 hex
  改为其 v5 派生 uuid（注释留派生来源）—— setting 缺失时 PG 侧 current_role_id /
  junction 写入不再炸 22P02。
- **opaque finishRegister 接线 ctx.em**：该端点本就挂 `@WalnutDBTransaction`，接线后
  注册两腿（createForAuthUser + createIdentity）获得事务原子性（Mongo 版没传 session，
  本是两笔隐式事务）。
- **user_device upsertDevice 幂等化**：check-then-insert 改
  `ON CONFLICT (user_id, device_id) DO UPDATE SET device_name`；行回读用复查点查承接
  （raw 列名是 snake_case，不经实体映射，不直接 RETURNING 进调用方），并发首绑不再撞
  uq_user_device。
- **deleted.service read populate 摘除**：SYS_USER 的 Mongo 模型注册随 user 迁移摘除，
  deletedBy populate 改查 PG sys_user 同源表；Mongo 窗口内 hex deletedBy → null（§5.1）。
- **identity value 的 select:false**：实体列 `select: false` 对齐 schema；取密文走
  repo 的 `getValueByUserIdTypeAndPurpose` 显式 addSelect 通道（登录/敏感校验路径）。

### B7b 追加

- **backup_codes 并入 totp 行**：Mongo 侧备用码是独立 `type: 'backup_codes'` 行，PG 的
  CHECK（type IN totp/webauthn，varchar(8)）容不下该值 —— 按 phase2 4.12 的 16 列设计合并：
  bindTotp 把 hash 后的备用码写进 totp 行 `backup_codes_ciphertext`，verifyBackupCode /
  unbindTotp 按 totp 行读写（备用码与 totp 凭据同生灭）。附带如实记录：上游 bindTotp 存的
  是 `cryptoService.hash`（无 salt → 每次随机盐）产物，verifyBackupCode 的 indexOf 恒 miss
  （TODO: use backup code to recover 未实现）—— 行为原样迁移不修，int-spec 钉现状。
- **schema pre('save') hash 迁 repo 写入路径**：lockPwdHash 的 bcrypt 加盐移到
  `SysUserLockRepositoryService.insertOrUpdateUserLockPre`（本仓库唯一写路径，写入全覆盖；
  不带密码的写入不动既有 hash），schema 钩子摘除。
- **B0 过渡文件 refresh.pg.module 摘除**：实体注册 + purge job 并入 AuthRefreshModule
  （B1 接线形态），task.module 不再单引。
- **mfa 密文列 select:false 补齐 + counter transformer**：B0 实体骨架漏了 select:false，
  接线时补上（totpSecret/webauthnPublicKey/phoneNumber/backupCodes 四列，identity 同口径）；
  webauthn_counter 挂 int8→number transformer（驱动默认返 string，webauthn 校验库要 number）。
- **verify 双句柄收单 em**：mfa/totp/webauthn verify、refresh 轮换（getNewAccessToken）、
  signout 链（auth.service/opaque/google/otp 等仅签名适配）、generateAuthTokens、
  user_device forceQuit/lock/unlock 全部单 `em`；7c 只剩 auth 策略内部与 security 的收口。

### B7c 追加

- **auth 策略内部现状**：7a 已把 gitee/github/otp 的 validateIdentity 换成自管 PG
  QueryRunner（strategy 零改动），7b 已把 refresh 轮换/signout 链收单 em —— 7c 复核
  全链无 Mongo 写腿残留后**零策略改动**；google.service 摘除残留的
  `@WalnutDBInjectConnection() dbConnection`（B7a 起无消费方的死 Mongo 连接注入）。
- **登录/注册事务最后一腿**：`generateAuthTokens` 的 `bindDeviceForUser` 与
  `mfa.post` 的 `updateTrustedStatusForUserDevice` 此前调用漏传 em（写腿落在连接级
  manager，事务外提交）—— 7c 传 em 收进同一 PG 事务，登录（refresh + device）与
  MFA verify（trusted + 轮换）自此原子；`auth.login-chain.pg.int-spec` 以
  force-rollback 断言两腿同清。
- **security/sensitive 签名迁 PG**：`verifyAndGrantPermission` 形参
  `dbSession?: ClientSession` → `em?: EntityManager`，controller 传 `ctx.em`；
  risk 系（user/device/ip/failedLogin）在 7a/7b 已随 PG 仓库服务直读 PG，murlock
  分布式锁（Redis 域）不动。
- **上游缺陷原样迁移登记（不修，int-spec 钉现状）**：
  1. sensitive `verifyPassword` 读 `identity.value`，而 identity value 列
     `select: false`（Mongo/PG 两代同款）—— 默认查询不出该列，decrypt 恒抛错被
     catch 吞掉，password 通道恒 false（正确明文也过不了）；取值本应走
     `getValueByUserIdTypeAndPurpose` 显式通道。B10/Mongo 下线后一并评估修复。
  2. sensitive `verifyAndGrantPermission` 的事务句柄形参上游即未接线（`_` 前缀、
     identity 读腿走连接级 manager）—— 7c 按签名迁移原样保留（`_em`），不在本批
     顺手接线。
  3. risk `evaluateIP` 判据 `if (cached.permanent)` 直接吃 Redis hGetAll 的字符串值
     —— 临时黑名单写的 `permanent: 0` 回来是 `'0'`（真值），黑名单 IP 恒报
     `IP_BLACKLIST_PERMANENT` 因子（与写入侧的临时/永久语义脱节）。int-spec 钉现状。
  4. `AppTechCacheService.delByPattern` 对 scanIterator 的空页产出处理错误：v5 驱动
     逐页 yield `reply.keys`（数组），最后一页常为 `[]`，`Array.isArray(key) ? key[0] : key`
     把空数组取成 `undefined` 塞进 `del` 批次 —— 共享 Redis 多页扫描时 signout 的
     缓存清理（revokeSession 等）抛 TypeError。int-spec 钩子容错执行钉现状。
  5. sensitive `getUserAvailableMethods` 对缺失的 phone/email security identity 走
     `getIdentityOrThrow`（缺失即抛 DataNotFound）而非跳过该方式 —— 无手机绑定的用户
     列举可用验证方式直接 404。int-spec 钉现状（可用方式列举用例造齐三通道，
     缺失通道单独用例断言抛错）。
- **登录全链 int-spec**（`auth.login-chain.pg.int-spec.ts`，service 级 + 完整
  AppModule 装配）：opaque 注册/登录真实 crypto 栈（客户端 fixture 走
  @serenity-kit/opaque client 流程，identifiers 双端一致）+ 注册两腿 force-rollback
  原子性；generateAuthTokens 的 refresh+device 回滚/提交双路径；otp validateIdentity
  三态 + verifyCode 缓存通道 + authWithOtp 验证码消费；gitee 全链（新用户/email
  占用/再登录/注册关闭）+ github 冒烟；signout 三触发 revoke_reason 落库；
  MFA verify 双通道（totp/webauthn，mfaSetup + trusted 写腿断言）；sensitive 授权
  生命周期与钉现状；risk user/device/ip/failedLogin 四条评估写腿（真实 Redis，
  键带 uuid 前缀 afterAll 清理）。controller 层取舍：auth 端点挂 sign guard（HMAC
  握手）+ passport strategy + functional guard 三层，service 级替代（B7a/B7b
  int-spec 同口径），拦截器事务形态由 pg.transaction.int-spec 覆盖。
- **双引擎窗口收尾后的 dbSession 残留面**：仅剩 B8（log.operate/log.auth）、
  B9（sys_deleted recover 链）与 B0 的 tx-context/tx.interceptor 类型定义；
  auth 链与 security 内零残留。

### B8 追加

- **operation 列 NOT NULL 勘误（蓝图与现实冲突的裁定）**：phase2 4.16 写 NOT NULL，但
  `WalnutCrudDecorators`（create/update/delete 全量写面，15 个 controller）从不传
  operateType，运行时 operation 恒 undefined —— Mongo 侧 schema `default: null` 本就
  容 null，NOT NULL 会让 fire-and-forget 把大多数日志行静默丢掉。InitSchema 收
  `operation varchar(32) NULL`（PG CHECK 对 NULL 放行，显式写入值仍受 CHECK 约束），
  entity/DTO 同步；int-spec 钉 NULL 现状。
- **旁路形态原样保留**：两个 repo service 刻意**不收事务句柄**（em/session 都不收，
  B7b refresh.repo 同款 @Global 形态），连接级 manager 的独立隐式事务即旁路语义；
  decorator tap 的吞错（catch + logger.error）与 `void` 发射原样保留。log_auth 的
  delete/deleteMany 是管理端事务端点，照模板走 `ctx.em`（非旁路）。
- **jsonb + raw_* 旁路**：request/response 数据直写 jsonb（`toWalnutPgJsonbPayload`
  做 stringify → parse 往返校验），序列化失败（循环引用 / BigInt）jsonb 列置空、
  原文尽力文本化落 `raw_request_data` / `raw_response_data`；纯函数带单元 spec，
  int-spec 走真实拦截器覆盖端到端。
- **字段名钉相**：实体属性保持 Mongo 字段名 `correspondingMS`（列仍 corresponding_ms）
  —— plainToInstance 按源属性名拷贝，属性名错位会让出参丢字段；schema 侧
  requestData/responseData 的 TS 注解随列型放开为 `Recordable | null`。
- **匿名请求的 userId**：Mongo 时代 `new Types.ObjectId(undefined)` 会生成随机
  ObjectId（脏数据），PG 侧不复刻 —— userId 直传 token uuid、匿名/登录失败为 NULL。
- **techniques/event 零代码改动（B9 边界登记，B9 已收口）**：event.service 只转发
  SysDeletedRepoService，本批（B8）不动；logOperateId 自本批起为 uuid，
  Mongo 版 `updateDeletedWithLogOperateId` 的 ObjectId 包装遇 uuid 必炸 —— B9 已把
  监听侧切到 `SysDeletedPgRepoService`（uuid 直等更新）并解锁 int-spec 现状钉。
- **int-spec**：`log.bypass.pg.int-spec.ts` —— 真实拦截器/guard + 假 ExecutionContext
  驱动（pg.transaction 同口径）；tap 异步写最终一致断言用 `vi.waitFor` 轮询（不 sleep
  硬等）；guard 失败链路连带 failedLogin risk 收集（真实 Redis，键 afterAll 精确清理）；
  i18n 用 `I18nContext.createAsync` 包真上下文。注意：metadata 载体是方法函数本身，
  测试提取时不能 `.bind()`（会产生新函数丢 reflect metadata）。
- **parse 摸底（只读探针）**：对本地 `walnut-admin-nestjs.sys_log_operate` 跑过 ——
  0 行（开发库无存量），成功率 N/A（0/0）；ETL 侧照 Q7 口径执行（parse 入 jsonb、
  失败原文入 raw_*）即可，无存量风险。
- **dbSession 残留面更新**：仅剩 B0 的 tx-context / tx.interceptor 类型定义
  （B9 已收掉 sys_deleted recover 链的最后一处业务消费；B8 的日志旁路本就不收事务句柄）。
