# Phase 3 逐模块迁移实施计划（B0-B10）

> 真源文档：`postgres-migration-phase2.md`（表结构）与 ADR 0021（决策）。
> 本文件是 Phase 3 的执行蓝图（2026-10-25 调研定稿），供各迁移批次 Agent 引用。
> B0 已交付（fc0d51c）；本文件随批次推进更新勾选状态。

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
| B5 | sys_menu（meta 拍平组装出参）+ sys_role + sys_role_menu；产出 defaultRole uuid 订正脚本 | |
| B6 | sys_device + sys_user_device + app_monitor_user（双向环同批） | |
| B7 | SCC-A 账户团九表（user/identity/oauth/lock/mfa/preference/device/refresh + auth 全系 + security） | |
| B8 | sys_log_operate + sys_log_auth + techniques/event（fire-and-forget 旁路） | |
| B9 | sys_deleted 收尾：恢复注册表装配、recover/recoverMine PG 化、Mongo 侧下线 | |
| B10 | 终批清理（摘 MongooseModule、Mongo int-spec、双轨残留；与 Phase 5 合并执行） | |

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
- B9/B10：删 Mongo 段 global-setup 与 Mongo int-spec。

## 4. ID 使用点清查（改造归属）

| 位置 | 批 |
|---|---|
| mongoId pipe/validator/ParamMongoId（新增 uuid 版并存） | B0 ✅ |
| listAggregate.ts:70-71（ObjectId 转换分支） | B0 ✅（PG 版）|
| base.repository deletedBy / deleted.repo createSoftDelete | B0 ✅ |
| locale.pipe、lang.repo.service | B2 ✅（pipe 换 uuid 校验；lang.repo 两条聚合 SQL 重写） |
| role.repo.service `$in` | B5 |
| error.process.ts | B1 ✅（uuid 直传，删除 ObjectId 包装） |
| monitor/user.repo.service | B6 |
| user.crud / user.shared（defaultRole 消费点） | B7（前置：B5 订正脚本落地） |
| user_device/user_identity/user_lock/user_mfa/totp/webauthn/user_preference/refresh.repo | B7 |
| log.operate.decorator / log.auth.shared.service | B8 |
| deleted.service recover 链路 | B9 |

## 5. 残留窗口（如实写进风险评估）

1. **回收站双源**（B1~B9）：已迁模块软删写 PG `sys_deleted`，未迁写 Mongo；回收站列表/恢复
   在 B9 前是 Mongo 版，看不到 PG 侧删除。缓解：B0 注册表骨架 + 迁移期口径「回收站只管未迁
   模块」。B9 归一。
2. **setting_value 内嵌 id**（B4~B7）：`app.default.role` 值须在 B7 切换前重写为 role 的 v5 uuid；
   B5 产出订正脚本，B7 验收前置检查。
3. 审计旁路本就是 fire-and-forget 最终一致，不新增风险。

## 6. 岔路决策记录（自主执行期间按推荐项走）

- ID 生成：DB 端默认值（v5 只在 ETL/seed 通道），应用不生成。
- 载体退役优先于硬留（见 §3）。
- 特殊查询一律 QueryBuilder + `customize`，不写原生 SQL 字符串拼接。
- 每批一个提交，type feat/test 视内容，scope server。
