# 数据权限遗留整改实施计划（批 4-7）

> **位置变更（2026-11-02）**：本文自仓库根 docs/plans/ 迁入 docs 站。状态：【已完结】，后续演进见 [Guard 链与安全](/content/backend/modules/security) 的「数据权限（行级 scope）」节与 `data-scope-design.md`。

> 状态：**批 4/5/6 已实施**（`9071cda`；`4f7baba`+`73e0d9c`+`38edbdb`；批 6 随本文档
> 同批提交），**批 7 已实施**（随收尾提交落地）。每批独立提交 + review + 全量回归四件套，见 §6。
> 前置均已落地：一期 c9b7694、二期批 1 afc8cde、批 2 f90bcd5、三期 RLS（含 F1-F5
> fail-closed 化）11df28d。本计划是 `data-scope-phase2-3-plan.md` 的续篇：只收口遗留
> 缺口，**不做架构重写**（理由见 §0）。

## 0. 背景与定位（为什么是整改而不是重写）

2026-10-30 做了一轮外部调研（若依源码级拆解 + 强化版框架 + PG/TypeORM 生态）并与本仓
实现逐条核对，结论：

- 本仓**只对齐了若依的档位语义**（六档，第 6 档本就吸收自 RuoYi-Vue-Plus）；
- 若依被社区诟病的实现机制在当前实现中**全部规避**：AOP 拼 SQL 文本 + Mapper XML 手写
  占位符 → 本仓是基类参数化 `andWhere`；`FIND_IN_SET(ancestors)` 无索引 → 递归 CTE +
  CYCLE 兜底、解析期展开；覆盖面靠「注解 + 占位符双全、漏一处即泄露」→ 注册表
  fail-closed + 越权一律 404 + 漂移守卫；多角色硬 OR → 沿用 roleMode（COMBINE/SWITCH）；
  角色范围缓存进登录态 → Redis 描述符 + 显式失效点。强化版框架（RuoYi-Vue-Plus /
  ruoyi-vue-pro 弃 AOP 改 MyBatis-Plus 拦截器 + JSqlParser 在 JDBC 层改写 SQL，覆盖
  SELECT/UPDATE/DELETE）的「规则接口 = 表名集合 → 过滤表达式」与本仓「实体注册表 +
  谓词纯函数」同构；RLS RESTRICTIVE 天花板更是超出两者。
- 因此遗留工作是**五个正确性/工程缺口 + 两个体验缺口**（下表），逐条核实过代码位置，
  非推测。

外部资料与结论出处见文末附录；若依局限的源码级拆解已在
`apps/docs/src/zh-CN/content/plans/data-scope-design.md` §2/§6/§7，不重复。

## 1. 遗留清单总表

| # | 等级 | 问题 | 证据 | 批次 |
|---|---|---|---|---|
| L1 | P0 | `deptColumn` 更新无应用层防护：基类 `getProtectedOwnerColumn` 只剔 owner 列；DEPT 档管理员可把可见行的 `dept_id` 改到自己天花板外（目前仅三期 RLS WITH CHECK 兜底，应用层自身不设防） | `apps/server/libs/repository/src/pg-base.repository.ts`（getProtectedOwnerColumn 与 update/updateByField 两处调用点） | 批 4 |
| L2 | P0 | P3-36 缓存残留：`app.functional.role` 设置变更不失效 `AUTH:DATA_SCOPE`，旧描述符最长残留一个 AT TTL（service 自登记「已知残余面」） | `apps/server/libs/system/src/data-scope/data-scope.service.ts` 头注释；`apps/server/apps/api/test/api/DESIGN-ISSUES.md` P3-36 | 批 4 |
| L3 | P1 | 六档常量三处硬编码：`@walnut/contract` 无 data-scope 常量（违反「跨端常量只改 contract」纪律）；admin 表单 options 是 1-6 字面量；ESLint 实体正则与注册表是两份人肉同步的清单 | `packages/platform-any/contract/src/`（无 data-scope）、`apps/admin/src/views/system/role/index.vue`、`packages/tooling/eslint-config/nest.ts` | 批 5 |
| L4 | P1 | 文档口径未收敛：phase2-3-plan 顶部仍「待维护者批准」、批 3 未标已实施；连接占用 spike 是计划自列的前置项，无实测记录 | `apps/docs/src/zh-CN/content/plans/data-scope-phase2-3-plan.md` 头部与 §2.1/§5 | 批 6 |
| L5 | P1 | RLS 引导密码无生产防呆：迁移内嵌 dev 引导密码（已存在则跳过是唯一防线）；F2 已让 `DATABASE_PG_APP_*` 启动必填，但未拦「dev 密码上生产」 | `apps/server/apps/api/migrations/1793360000000-DataScopePhase3Rls.ts` | 批 6 |
| L6 | P2 | CUSTOM 档防呆弱：`deptIds` 无数量上限（仅 uuid 校验）；「勾父部门 ≠ 含子部门（CUSTOM 不递归是刻意语义）」仅靠 helpMsg 文案 | `apps/server/libs/system/src/role/dto/role.dto.ts`；`apps/admin/src/views/system/role/index.vue` | 批 7 |
| L7 | P2 | P3-35 审计可见性。**维护者已拍板：不拦截**——dataScope 修改权跟随功能权限位，持 `system:role:update` 的管理员可改（root 天然全量）；本期只补操作日志 before→after 快照 | `apps/server/apps/api/src/modules/system/role/role.controller.ts`；DESIGN-ISSUES P3-35 | 批 7 |

## 2. 批 4：正确性与缓存（feat(server)）

### 2.1 L1：deptColumn 的 update 防护

**语义分型**（不能一刀切剔除——职工/用户调部门是合法业务流）：

| 实体形态 | update 策略 | 理由 |
|---|---|---|
| `fillDeptOnCreate` 实体（app_demo） | `strip`：deptColumn 从 update/updateByField 的 DTO 一律剔除（与 owner 列同通道） | 行级归属由创建者派生，创建后不可改；要移归属属新需求，另行立项 |
| 其余含 deptColumn 的注册实体（sys_user / sys_employee） | `validate`：DTO 显式给出 deptColumn 且值变化时，校验**新值 ∈ 操作者描述符 deptIds**（ALL 豁免；越界 → 40401 同口径，不泄露存在性） | 部门是业务字段；该规则与 walnut_app 通道的 RLS WITH CHECK 天花板完全对齐，无 RLS 的环境（如历史 dev 库）也有同语义 |

**注册表配置**：新增 `deptUpdatePolicy?: 'validate' | 'strip'`，**缺省 `validate`**
（fail-closed 取向：新实体漏配即按严格侧）；app_demo 显式 `'strip'`。校验逻辑做成
`data-scope.ts` 的纯函数（描述符 + 新值 → 通过/拒绝），与既有谓词构造同层可单测。

**与 RLS 的关系**：RLS 是 DB 侧兜底（WITH CHECK），本项是应用层同语义前置校验——失败
更快（404 而非 DB 异常）、语义不依赖连接通道，二者是纵深而非重复。

### 2.2 L2：AUTH:DATA_SCOPE 全局 epoch

- 缓存键从 `AUTH:DATA_SCOPE:<userId>` 变为 `AUTH:DATA_SCOPE:<epoch>:<userId>`；
  epoch 键 `AUTH:DATA_SCOPE:EPOCH` 缺省 0，`app.functional.role` 设置写路径调
  `dataScopeService.bumpEpoch()`（INCR）。
- 读路径 GET epoch 后拼键（每次多一跳 Redis 往返可接受；不引入本地缓存，避免新的一致性面）。
- **不采用** `invalidateAll` + SCAN：扫描成本与原子性都差，epoch 是 O(1) 且天然并发安全。
- 旧格式键无 epoch 前缀，读必不命中 → 自然 TTL 过期，**无需迁移**。
- DESIGN-ISSUES P3-36 随本项关闭归档；service 头注释的「已知残余面」段删除。

### 2.3 批 4 验证（四层）

1. **单元**：deptUpdatePolicy 两策略分支 + 校验纯函数（ALL 豁免/越界拒绝/值未变化跳过）；
   epoch 读写与 bump 后旧键不命中。
2. **接口**：`data-scope-matrix.api-spec.ts` 与 `data-scope.dept.api-spec.ts` 增负路径
   ——DEPT 档管理员把可见行 `dept_id` 改到天花板外 → 40401；改到天花板内 → 放行；
   app_demo 提交 deptId 被剔除（read 回显原值）。
3. **功能场景**：M 矩阵扩展两列断言（改归属越界/界内）；M10 时序增 functional.role
   分支——COMBINE↔SWITCH 切换后**下一请求**按新 roleMode 合并（combo 用户可见集变化）。
4. **全量回归**：§6 四件套。

## 3. 批 5：契约与机械守卫（feat(contract) + feat(server) + feat(admin) + feat(tooling)）

### 3.1 L3：六档常量进 `@walnut/contract`

- 新增 `packages/platform-any/contract/src/data-scope.ts`：数值常量（1-6）+ 档位 key
  联合类型；contract 快照测试同步（该包有快照守护，改动必触发 diff，属预期）。
- server `libs/const` 与 admin 角色表单 options 改为**消费 contract 常量**（server 侧
  已有从 contract 导入的先例：`Role.ROOT/VISITOR`）。
- openapi 重新生成（DTO enum 引用链变化）。
- i18n 文案不动（档位文案在语言包 seed，与数值解耦）。

### 3.2 L3b：ESLint 实体清单对账守卫

- 现状：`nest.ts` 的 `no-restricted-syntax` 实体名正则与 `WALNUT_DATA_SCOPE_ENTITIES`
  是两份清单，加实体要人肉同步。
- 守卫：server 侧新增漂移 spec，用 `import.meta.url` 相对定位仓库内 `nest.ts` 读文本，
  断言正则里的实体名集合 ≡ 注册表 `entity` 名集合（文本级单向对账，真源仍是注册表；
  不跨包 import，避免边界问题）。放进既有 `data-scope.spec.ts` 或并列新 spec 均可。

### 3.3 批 5 验证

1. **单元**：contract 快照 diff 审查；漂移 spec 本身（人为破坏 nest.ts 文本应红）。
2. **接口**：无行为变化——全量矩阵重跑即为回归（档位数值语义不变）。
3. **功能场景**：admin 角色表单六档 options 换源后 types:check + build:stage 全绿。
4. **全量回归**：§6 四件套（含 openapi 重新生成、admin build:stage）。

## 4. 批 6：运维与文档（feat(server) + docs(docs)，两个提交）

### 4.1 L5：引导密码生产防呆

- 数据源/配置装配处（`libs/config` 的 pg 配置或 `libs/db` 工厂）：非 dev 环境断言
  `DATABASE_PG_APP_PASS` ≠ 迁移引导常量 `walnut_app_dev_only`，命中即启动失败
  （响亮失败，与 F2「缺失必填」同一风格）。
- 迁移 DO 块保持不变（本地/集成库引导职责）；dev 引导常量收敛到单一导出点供两处引用，
  消除字符串漂移。
- **单元**：config 校验两分支（dev 放行 / 生产命中即抛）。

### 4.2 L4：连接占用 spike 实测（已实施，2026-10-31）

> 状态：**已实测，结论=维持现状（每 CRUD 隐式事务）**。
> 落地形态：并列新 spec `apps/server/apps/api/test/api/pool-occupancy.api-spec.ts`
> （计划允许「扩展 concurrency 或并列新 spec」二选一；选后者保持测量隔离）。
> 方法：集成库 in-process app，池上限读运行期 `pool.options.max`（=10，不硬编码）；
> 串行基线 12 发 → 2×池并发预热波（丢弃建连成本）→ 同并发对照波（`GET /`，无 PG
> 路径，作客户端+事件循环开销**下界**）→ 20 并发轰 `POST /app/demo/list`，
> 1ms 采样池指标 + `pool.connect` 仪表计取连接等待。

**实测记录**（2026-10-31，修复后两轮复测，数值稳定）：

| 项 | 轮 1 | 轮 2 |
|---|---|---|
| 池上限 / 并发 | 10 / 20（=2×max） | 同 |
| 基线（串行）p95 | 22.79ms | 21.7ms |
| 对照波 p95（无 PG 下界） | 50.93ms | 50.99ms |
| 并发端到端 p95 | 119.81ms | 114.44ms |
| 取连接次数 / 并发数 | 20 / 20（**每请求恰 1 条连接**） | 同 |
| **取连接等待 p95 / max** | **16.86 / 17.58ms** | **16.96 / 18.37ms** |
| 取连接有等待占比 | 50% | 50% |
| waitingCount 峰值（采样） | 10 | 10 |

**判据口径声明（写死，防事后找补）**：

- 原判定「请求等待连接占比 > 5% **或** p95 等待 > 50ms」中，占比腿在 2× 池上限并发
  探针下**结构性必 ≥ 50%**（10 条连接服务 20 个请求），不具区分度——数字已原样记录
  （50%/100%），**不参与判定**；
- **操作判据 = 取连接等待的 p95/max < 50ms**：实测 16.86–18.37ms，远低于阈值；
- spec 的主 `verdict` 已按此口径计算并输出「维持现状」；e2e 口径输出改名 `verdictE2E`，
  标注「含测试客户端开销，仅诊断，不用于阈值判定」。

**结论与外推范围**：**维持现状（每 CRUD 隐式事务），不立项「同请求多 repo 合流共享
事务」**。证据：① `acquireCount == 并发数`，本端点每请求恰取 1 条连接，不存在放大；
② 取连接等待 p95 16.9–17.6ms、max 17.6–18.4ms；③ 端到端 burst p95 超出对照波约
63–69ms，主要是 PG 往返本身而非连接排队。**外推限制**：本 spike 覆盖「单端点、单
repo 调用/请求」（ALL 档同样走 RLS 隐式事务路径，连接形态与非 ALL 相同）；「请求内
并行多 repo 调用」的端点形态未覆盖——若未来出现此类端点，预案（ALS 级 tx 合流）
在立项时须先按同口径补测。

### 4.3 L4b：文档口径收敛（docs(docs) 提交）

- `data-scope-phase2-3-plan.md`：状态头改「已批准、批 1-3 已实施」；§2 补一段三期
  实施摘要（F1-F5：anonymous 缺省、九类显式 system 通道、WITH CHECK 部门腿 + user_dept_id
  GUC、recoverSnapshot 断言、部署注意），并记录「RESTRICTIVE 不能单独授予访问、必须配
  PERMISSIVE 基线」这条实测坑。
- `DESIGN-ISSUES.md`：P3-35 处置更新为维护者口径（不拦截 + 批 7 审计快照，引用本计划）；
  P3-36 若批 4 已先行合入则归档，否则登记「批 4 关闭」。

### 4.4 批 6 验证

1. **单元**：4.1 的 config 两分支。
2. **接口/集成**：RLS 专项 9 例重跑（密码断言不破坏既有迁移行为）；concurrency 采集跑通。
3. **功能场景**：无（运维批次）。
4. **全量回归**：§6 四件套 + 文档门禁（`pnpm lint:docs-refs`、`pnpm lint:doc-ts`、
   `pnpm build:docs` 死链）。

## 5. 批 7：体验与审计（feat(server) + feat(admin)）

### 5.1 L6：CUSTOM 清单上限与防呆（已实施，2026-10-31）

- `role.dto.ts`：`deptIds` 加 `maxSize 200 + unique`（复用 `WalnutAdminDecoratorValidatorUuid`
  的 arrayOptions 通道），`@ApiProperty` 显式 `maxItems: 200`（本仓无 Swagger CLI
  plugin，ArrayMaxSize 不自动进 openapi）。**超限落地为 40099**（本仓无 422 语义：
  全局 ValidationPipe 抛 `WalnutAdminExceptionRequestDataError`，异常过滤器恒 HTTP
  200 + body.code；校验消息无 i18n 先例，未为新文案发明机制）。
- **menus 评估结论：不设限**——菜单授权是「全量勾选」常态（seed 已 172 条，200 只剩
  余量会从拦脏数据变成业务限制），且 menu_id 有 FK 兜底；结论已固化进 DTO 注释与单测
  （menus 201 放行）。
- admin 角色表单：CUSTOM 提交时若清单含**非叶子部门**，弹确认框明示「不含子部门，仅勾选
  的部门本身」（不递归语义不变，只防误解）；叶子判定用前端 dept tree 的 children 聚合；
  经由新增的通用 CRUD 提交前钩子 `onBeforeFormSubmit`（返回 false 中止且抽屉不关）。
- i18n：确认文案 `table.role.deptIds.nonLeafConfirm` 补 `sys_locale` seed（zh-CN/en
  双份，`{count}` 插值，经既有下发通道）。
- **单元**：DTO 校验分支；**接口**：超限 40099、200 恰好放行；**功能**：表单交互走
  types:check + 手动验收清单（写入 PR 描述）。

### 5.2 L7：role:update 审计前后值（P3-35 的落点）

- 维护者口径（已拍板）：**不加拦截**。dataScope 是授权面的一部分，与菜单授权同级——
  把 `system:role:update` 授予谁，等于信任谁行使行级范围授予权；该信任语义写进
  DESIGN-ISSUES P3-35 处置记录收口。
- 实施：先核实 operate log 现有记录面（WalnutCrudDecorators 的 title/payload 通道），
  补「敏感字段 before→after 快照」（至少 dataScope / deptIds / menus / status），不做
  全字段 diff；单测 + 接口断言日志内容含变更前后值。

### 5.3 批 7 验证

1. **单元**：DTO 上限分支、审计快照组装。
2. **接口**：422 负路径；role:update 后日志断言。
3. **功能场景**：CUSTOM 大清单场景（199/200/201 边界）。
4. **全量回归**：§6 四件套（动 DTO → openapi 重新生成；动前端 → admin types:check +
   build:stage）。

## 6. 四层验证与全量回归口径（每批收尾，固定执行）

| 层 | 载体 | 各批增量 |
|---|---|---|
| 1 接口测试 | `apps/server/apps/api/test/api/*.api-spec.ts`（真实 HTTP 全链） | 批 4 越权改归属 + epoch 时序；批 7 422 + 日志断言 |
| 2 单元测试 | `apps/server/apps/api/src/**/*.spec.ts` 等 | 批 4 两策略 + epoch；批 5 快照/漂移；批 6 config；批 7 DTO/审计 |
| 3 功能测试 | `data-scope-matrix.api-spec.ts` 的「用户×角色×可见集」场景风格，断言业务结果而非实现细节 | 批 4 M 矩阵扩列 + M10 扩 functional.role；批 7 大清单边界 |
| 4 全量回归 | 四件套：① vitest 全量（单测+接口+集成）**连续 2 轮稳定**（基线以实施时点输出为准，勿引用本文档数字）② `pnpm prepush`（23 段门禁表）③ `pnpm types:check` ④ 批次附加：动 DTO → openapi 重新生成；动前端 → admin `types:check` + `build:stage` | 每批全跑 |

## 7. 批次与提交规划

| 批 | 内容 | 提交 |
|---|---|---|
| 批 4 | L1 deptColumn 防护 + L2 epoch 失效 + 矩阵扩列 | feat(server) |
| 批 5 | L3 contract 常量 + ESLint 对账守卫 | feat(contract) / feat(server) / feat(admin) / feat(tooling)（按包拆分或合为多包单提交，遵循 scope=包名纪律） |
| 批 6 | L5 密码防呆 + L4 spike 实测 + 文档收敛 | feat(server) + docs(docs) |
| 批 7 | L6 上限防呆 + L7 审计快照 | feat(server) / feat(admin) |

顺序即依赖序：批 4 的 deptUpdatePolicy 依赖注册表形态（不受批 5 影响，可先行）；批 5
改档位常量引用面，先于批 7 的 DTO/表单改动可减少 rebase 面；批 6 独立可插队。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| deptUpdatePolicy 误伤合法调部门流 | sys_user/sys_employee 走 validate 不剔除；越界才拒；M 矩阵界内放行用例先行 |
| epoch 引入每请求多一跳 Redis | 读路径本来就查描述符，多一次 GET 体量小；如实测显著，再议 pipeline 合并（不做本地缓存） |
| contract 常量换源触发快照/引用连锁 | 快照 diff 属预期；admin/server 同批换源，types:check 全绿才算过 |
| spike 阈值触发预案导致范围膨胀 | 预案只立项不进本计划批次；实测数值回填后即收口 |
| 审计快照泄露敏感字段到日志 | 只记允许列（dataScope/deptIds/menus/status）；完整数组不截断（deptIds 已限 200、menus 当前约 172 条规模可控；截断会让被截变更不可见，与审计目标冲突，见 role.audit.ts 注释） |

## 9. 明确不做（有据，防范围蠕变）

- **角色删除通道**：端点未立项；新增时必须先按 roleId 反查成员失效缓存（义务已写在
  data-scope.service 头注释）。
- **sys_device 设备维度 scope**：无 user_id 列、归属在关联表，豁免在案；等设备管理立项。
- **matchBy: 'ownerDeptExists'（EXISTS 回退）**：计划提过、注册表未实现；当前无无冗余列
  的注册实体，无消费方。
- **ltree / closure table**：部门树当前量级下递归 CTE（解析期展开 + 描述符缓存）足够；
  社区共识也是大规模读密集才值得引入。
- **Casbin / OpenFGA / OPA 等策略引擎**：为六档 scope 引入 PDP 属过度设计（design.md §7
  已论证）；「残余过滤条件」思想已以纯函数形态吸收。
- **TypeORM 全局查询过滤器**：生态不存在（核心 issue 多年未实现），基类收口是既定路线。

## 10. 待确认（已按推荐执行，除非维护者否决）

1. L1 采用 `deptUpdatePolicy` 配置（缺省 validate，app_demo 显式 strip），而非一刀切剔除。
2. L2 采用全局 epoch，而非 SCAN 式全量失效。
3. L6 上限值 200（部门树量级内足够；仅拦脏数据不做业务限制）。
4. L7 按「不拦截 + 审计快照」收口 P3-35。

## 附录：调研参考资料（2026-10-30）

**若依机制与批评**
- [若依数据权限设计与实现深度剖析（知乎）](https://zhuanlan.zhihu.com/p/711964058)
- [深入分析若依数据权限 @DataScope（博客园）](https://www.cnblogs.com/kisshappyboy/p/17980084)
- [@DataScope 使用问题排查（阿里云开发者社区）](https://developer.aliyun.com/article/1410226)
- [若依后台手册·数据权限](https://doc.ruoyi.vip/ruoyi/document/htsc.html)
- [RuoYi-Vue 多角色数据权限 issue（Gitee I4BMD3）](https://gitee.com/y_project/RuoYi-Vue/issues/I4BMD3)
- RuoYi 4.8.2 authDataScope/authUser 越权报告与 CVE-2025-4537（GitHub/Gitee issue，文本提及不附链）

**强化版框架**
- [RuoYi-Vue-Plus（dromara）](https://github.com/dromara/RuoYi-Vue-Plus)：MyBatis-Plus InnerInterceptor + JSqlParser 无感改写
- [ruoyi-vue-pro（芋道）数据权限官方文档](https://doc.iocoder.cn/data-permission)：DataPermissionRule 接口（表名集合 → 表达式）、executeIgnore
- [数据权限调用流程分析（CSDN）](https://blog.csdn.net/Michelle_Zhong/article/details/122447887)
- [若依 @DataPermission 源码解析（掘金）](https://juejin.cn/post/7537687336327331866)
- [JeecgBoot 数据规则](https://help.jeecg.com)：可配置规则路线，本仓不采
- [buqiyuan/nest-admin](https://github.com/buqiyuan/nest-admin)：Node 生态仿若依参照

**PostgreSQL RLS 工程**
- [RLS 局限与替代（Bytebase）](https://www.bytebase.com/blog/postgres-row-level-security-limitations-and-alternatives)
- [RLS Footguns（Bytebase）](https://www.bytebase.com/blog/postgres-rls-footguns/)
- [RLS sounds great until it isn't（PlanetScale）](https://planetscale.com/blog/rls-sounds-great-until-it-isnt)：策略逐行执行
- [AWS SaaS 多租户 RLS 规范指引](https://docs.aws.amazon.com/zh_cn/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/rls.html)
- [PostgreSQL 官方文档·Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase 讨论：SECURITY DEFINER 辅助函数避免策略内递归](https://github.com/orgs/supabase/discussions/14576)
- [行级安全深度实践与多租户数据隔离（博客园）](https://www.cnblogs.com/kingster/p/19921212)
- [Mastering PostgreSQL RLS](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy)：SET LOCAL 模式

**树形结构与 Node 生态**
- [Hierarchical data: recursive query vs closure tables（Stack Overflow）](https://stackoverflow.com/questions/7497812/)
- [使用 ltree 实现组织架构（scanbuf）](https://scanbuf.net)
- [TypeORM issue #1601 global filters（多年未实现，应用层注入是既定路线）](https://github.com/typeorm/typeorm/issues/1601)
- [Casbin 与 OpenFGA 对比（官方）](https://casbin.apache.org/zh/docs/casbin-vs-openfga)：策略引擎不引入的依据
