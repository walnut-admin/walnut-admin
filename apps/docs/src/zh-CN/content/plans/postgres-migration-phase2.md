# Phase 2：关系模型设计（MongoDB → PostgreSQL）

> **位置变更（2026-11-02）**：本文自仓库根 docs/plans/ 迁入 docs 站。状态：【已完结】，后续演进见 [ADR 0021](/content/adr/0021-postgresql-migration) 与 [数据库与初始化数据](/content/backend/postgresql)。

**Status:** 已完成（2026-10-25 全部拍板并定稿；实施已随 `refactor/postgres-migration` 落地，收尾摘要见 ADR 0021 的 Implementation 小节）
**Date:** 2026-10-25
**上游决策:** ADR-0021（TypeORM 1.x / UUID 主键 / 事务装饰器 API 不变 / 回收站完整保留 / 本地+seed 为数据基准 / PG 18-alpine）
**Phase 3 输入:** 本文的逐表映射与约束清单；**Phase 4 输入:** 第 7 节 ETL 接口约定。

## 评审记录

- **2026-10-25 初稿完成 review，修订完毕**：1 P0（sys_menu.pid 改可空）、2 P1（数组 `unique` 误声明勘误 + ETL 预检、总览 FK 口径对齐推荐）、3 P2（uuidv7 取舍记录、递归 CTE 环保护、role_name 收紧预检）、3 P3（locale 索引计数对齐、排序边界明示、递归 CTE 措辞勘正），全部已合入正文。
- **2026-10-25 全部拍板**：维护者对第 8 节 12 个开放问题逐条定案，结论已合入正文对应小节（含计数回调：log_operate / app_error 增 raw_* 旁路列、app_setting 增 created_by 列、auth_refresh_token.device_id 建 FK），第 8 节转为拍板结果存档形态。
- **当前状态：已完成**（原「已全部拍板，定稿待最终批准」的口径作废 —— 实施已落地）。

范围：24 个 Mongoose 集合 → PostgreSQL 表结构（列 / 类型 / NULL / 默认 / 唯一 / FK / 索引）。
非目标：TypeORM 实体代码（Phase 3）、ETL 实现（Phase 4）。

输入依据（均已逐个核对）：

- 24 个 schema：`apps/server/apps/api/src/modules/**/schema/*.schema.ts`
- 集合名 / virtual 名真源：`apps/server/libs/db/src/db.const.ts`
- 列表查询模式：Mongo 版 `listAggregate`（`$match` 字符串转 `$regex` 模糊、默认 `createdAt desc` 排序、`$facet` 分页 + count；该文件已随 B9 双轨退役，PG 版等价物 `apps/server/libs/repository/src/pg-list.builder.ts`）
- 代表性数据访问：`lang.repo.service.ts`（双 `$lookup` + `$arrayToObject`）、`area.service.ts`（按 `pcode` 查一层 + 应用层建树 + 缓存）、`deleted.service.ts` / `base.repository.ts`（快照软删：查原文档 → `JSON.stringify` 存 `sys_deleted` → 真删）
- seed 实际形态：`apps/server/db/seed/*.json`（Extended JSON，含 schema 未声明的字段，见开放问题 Q4）

---

## 1. 总览

MongoDB 侧 24 个集合全部 1:1 映射为表；数组字段（`sys_user.roles`、`sys_role.menus`）拆出 2 张关联表，共 **26 张表**。

计数口径：**列数含 `id` 与时间列**（逐表清单见第 4 节，此为唯一判据）；**索引数含 PK 与唯一索引**；FK 数含关联表上的外键。

| # | MongoDB 集合 | PG 表 | 列数 | jsonb 列数 | 索引 | FK |
|---|--------------|-------|-----:|-----:|-----:|-----:|
| 1 | sys_user | sys_user | 13 | 0 | 4 | 1 |
| 2 | sys_role | sys_role | 7 | 0 | 3 | 0 |
| 3 | sys_menu | sys_menu | 29 | 1 | 4 | 1 |
| 4 | sys_lang | sys_lang | 7 | 0 | 2 | 0 |
| 5 | sys_locale | sys_locale | 6 | 0 | 4 | 1 |
| 6 | sys_dict_type | sys_dict_type | 7 | 0 | 3 | 0 |
| 7 | sys_dict_data | sys_dict_data | 10 | 0 | 2 | 1 |
| 8 | sys_device | sys_device | 22 | 4 | 4 | 0 |
| 9 | sys_user_device | sys_user_device | 12 | 0 | 4 | 2 |
| 10 | sys_user_identity | sys_user_identity | 14 | 1 | 3 | 1 |
| 11 | sys_user_lock | sys_user_lock | 10 | 1 | 2 | 1 |
| 12 | sys_user_mfa | sys_user_mfa | 16 | 0 | 3 | 1 |
| 13 | sys_user_oauth | sys_user_oauth | 7 | 0 | 3 | 1 |
| 14 | sys_user_preference | sys_user_preference | 12 | 1 | 2 | 1 |
| 15 | sys_log_auth | sys_log_auth | 13 | 0 | 4 | 0 |
| 16 | sys_log_operate | sys_log_operate | 25 | 4 | 4 | 0 |
| 17 | sys_deleted | sys_deleted | 8 | 1 | 4 | 0 |
| 18 | shared_area | shared_area | 4 | 0 | 3 | 0 |
| 19 | app_setting | app_setting | 9 | 0 | 2 | 0 |
| 20 | app_demo | app_demo | 17 | 1 | 3 | 0 |
| 21 | app_monitor_user | app_monitor_user | 10 | 0 | 4 | 0 |
| 22 | app_error | app_error | 16 | 2 | 3 | 0 |
| 23 | app_key | app_key | 11 | 1 | 3 | 0 |
| 24 | auth_refresh_token | auth_refresh_token | 9 | 0 | 5 | 2 |
| — | （由数组字段拆出） | sys_user_role | 2 | 0 | 2 | 2 |
| — | （由数组字段拆出） | sys_role_menu | 2 | 0 | 2 | 2 |
| | **合计（26 表）** | | **298** | **17** | **82** | **17** |

> FK 合计口径（定案后）：shared_area.pcode 不建 FK（Q6 定案）；auth_refresh_token.device_id 建 FK（Q5 定案）。

---

## 2. 通用约定

### 2.1 命名

- 表名 = 原集合名（`sys_user` 等，已是 snake_case，不改名，保留与 `db.const.ts` 的对应关系）。
- 列名 snake_case；Mongo 驼峰字段 → snake_case（`userName` → `user_name`）。实体属性名到列名的映射由 Phase 3 实体承担，API 出参仍是驼峰，前端无感。
- **保留字改名**（PG 中作为列名需引号或易踩坑，一律改名并在此登记，Phase 3 实体属性名保持原样）：

| 原字段 | 出现于 | PG 列名 | 理由 |
|--------|--------|---------|------|
| `order` | sys_role / sys_menu / sys_lang / sys_dict_data | `sort_order` | `ORDER` 是 SQL 关键字 |
| `show` | sys_menu.meta | `is_show` | `SHOW` 是 SQL 关键字，且语义本就是布尔 |
| `left` | app_monitor_user | `is_left` | `LEFT` 是保留字，语义本就是布尔 |

### 2.2 类型映射规则

| Mongo 形态 | PG 类型 | 说明 |
|------------|---------|------|
| `_id: ObjectId` | `uuid` | 见第 3 节 |
| `Types.ObjectId`（引用） | `uuid`（+ FK）或 `uuid` 松引用 | FK 政策见 2.4 |
| `String` | `text` | PG 中 text 与 varchar 性能无差异；不无脑收窄。仅当存在**硬长度上限**时用 `varchar(n)` 形态校验：目前只有 `shared_area.code`（1/2/4/6/9 位，见 schema 注释） |
| `Number` + `validateOptions.int`（age/order/count 类） | `integer` | |
| 枚举数值（gender / fontSize / demoEnum） | `smallint` + CHECK | |
| `Number`（webauthn_counter） | `bigint` | WebAuthn 签名计数器语义上无上限 |
| `Boolean` | `boolean NOT NULL DEFAULT` | |
| `Date` | `timestamptz` | 一律带时区，理由见 5.4 |
| 字符串枚举 | `varchar` + CHECK | 不用 PG 原生 `ENUM` 类型：原生类型的取值变更要走 `ALTER TYPE`，跨表复用差、报错信息不友好；CHECK 约束随表走 migration，取值即文档 |
| `[String]`（纯字符串数组） | `text[]` | ip_history / webauthn_transports / backup_codes_ciphertext / demo 各数组列 |
| `[ObjectId]`（引用数组） | 关联表 | sys_user.roles、sys_role.menus |
| `Object` / `Recordable` / Mixed | `jsonb` | **逐列判断**，清单与理由见 5.5；不无脑 jsonb 化 |

### 2.3 公共列

除特别说明（shared_area 无时间列；日志 / refresh token / monitor user 是改名或单侧时间戳）外，每表含：

| 列 | 类型 | NULL | 默认 | 说明 |
|----|------|------|------|------|
| `id` | `uuid` | NO | `gen_random_uuid()`；sys_log_operate / sys_log_auth / sys_deleted / auth_refresh_token 四表为 `uuidv7()`（3.3 定案） | PK；ETL / seed 行显式给 v5 值，见第 3 节 |
| `created_at` | `timestamptz` | NO | `now()` | 原 `createdAt` |
| `updated_at` | `timestamptz` | NO | `now()` | 原 `updatedAt`；维护方式见 5.4 |

以下表的公共列有出入（与 schema 的 `timestamps` 配置逐一对过）：

- **shared_area**：`timestamps: false` → 无时间列。
- **sys_log_auth**：只有 `authenticated_at`（原 `createdAt` 改名），无 `updated_at`。
- **sys_log_operate**：只有 `operated_at`，无 `updated_at`。
- **auth_refresh_token**：`updatedAt: false` → 只有 `created_at`。
- **sys_deleted**：`createdAt` 改名 `deleted_at`，无 `updated_at`。
- **app_error**：只有 `created_at`，无 `updated_at`。
- **app_monitor_user**：时间戳改名为 `first_visit_at` / `last_active_at`，无 `created_at` / `updated_at`。

### 2.4 FK 政策（populate → 外键的总原则）

1. **业务从属表**（user_device / identity / lock / mfa / oauth / preference / locale / dict_data / refresh_token）→ 建FK，`ON DELETE CASCADE`。理由：Mongo 侧删除用户后这些从属行已无意义；PG 侧用数据库机制替代原先散在 service 里的级联删除。真正删除用户只发生在「回收站彻底删除」路径（快照仍在 `sys_deleted`），级联不会绕过回收站。
2. **可空引用**（sys_user.current_role）→ FK `ON DELETE SET NULL`。角色被删（快照可恢复）后用户回到无当前角色状态，与现业务语义一致。
3. **日志与审计表**（sys_log_auth / sys_log_operate / sys_deleted / app_error / app_monitor_user）→ **一律不建 FK，松引用**（保留 `user_id uuid` 列 + 索引 + 快照列 `user_name`）。理由：审计记录必须比被引用对象活得久；建 FK 会阻止「用户进回收站后彻底删除」这一既有路径，或在 CASCADE 下静默销毁审计记录——两者都不可接受。
4. **树/图自引用**：sys_menu.pid（自引用，可空——根节点 pid=NULL，见 4.3；ON DELETE **RESTRICT**，Q6 定案）、shared_area.pcode（**不建 FK**，Q6 定案，见 4.18）。

### 2.5 索引策略（来自 listAggregate 的推导）

列表查询的统一形态是：`WHERE 过滤 ORDER BY 排序 LIMIT/OFFSET` + total 计数；字符串过滤一律转 `$regex`（不锚定）→ **PG 侧对应 `ILIKE '%kw%'`**，B-tree 只能服务前缀，包含匹配需 trigram。据此：

- 每张有列表页的表：`(常用过滤列, created_at DESC)` 或单列 `created_at DESC` 索引（默认排序）。
- 前端会模糊搜索的字符串列：默认建 B-tree（服务前缀 + 唯一性）；**包含匹配**的 trigram GIN 索引**只建 `sys_locale.key`**（i18n key 搜索高频，Q9 定案；`CREATE EXTENSION pg_trgm`，PG 18 中为 trusted 扩展），其余模糊列一律不预铺，出现真实慢查询再补。
- **本仓没有行级软删标志**：`base.repository.deleteSoftById` 的实现是「快照进 `sys_deleted` → 真删」，因此**各表都不存在 `is_deleted` 过滤列**，不存在软删复合索引这一类；回收站自身的查询模式（按 modelName + 时间）在 `sys_deleted` 上建索引覆盖。
- virtual populate（`populated_*`）在 PG 侧改写为子查询 / JOIN，所需索引即各 FK 列索引（PG 的 FK 不自动建索引，逐表显式列出）。

**排序边界（明示）**：以上索引只覆盖各表登记的默认排序与常用过滤组合。listAggregate 允许前端对**任意字段**排序，PG 侧对非索引列的 `ORDER BY` 会走内存 Sort 节点——配置/字典类小表可接受；日志、shared_area 量级的表若出现此类排序，按需补索引或在前端限制可排序列，不在本文预铺。

---

## 3. ID 策略专节

### 3.1 两案对比

| 维度 | (a) uuid v5 确定性派生（namespace + 原 hex） | (b) 随机 v4 + `legacy_id text` 过渡列 |
|------|-------------------------------------------|--------------------------------------|
| **ETL 可重跑** | 天然幂等：同输入恒得同输出，重跑 / 断点续跑 / 双跑对拍都不产生新 id，无需 upsert 逻辑 | 本身不幂等：重跑会生成新 v4；要幂等必须依赖 `legacy_id` 唯一键做 upsert，即幂等性是**由过渡列间接实现**的 |
| **跨集合引用重写** | 引用列旧值（hex）可**直接函数求值**为新 uuid，无需查任何表；ETL 各表可并行互不依赖 | 必须先建全量映射表，所有引用列重写都 join 映射表；各表串行依赖映射表就绪，ETL 拓扑复杂一档 |
| **调试可追溯** | 单向：hex → uuid 可即时验算（排查「这条旧数据对应哪行」很容易）；**uuid → hex 不可逆**，反向追溯要靠映射表 | 双向：行上自带 `legacy_id`，双向即查；代价是 24 张表长期多一列 |
| **收尾负担** | 无过渡列残留；映射表降级为纯对账/排障表，可归档丢弃 | `legacy_id` 一旦进实体就容易长住（「反正查一下也方便」），需要明确的弃用里程碑 |

### 3.2 结论（推荐 (a)）

**推荐 uuid v5 确定性派生**：ETL 可重跑与引用重写两个维度都是结构性优势（不依赖纪律），且「调试可追溯」的短板可以用保留 `etl_id_map` 对账表补齐（见 7.1）——反向追溯是低频运维动作，为此在 24 张表上各加一列不值。落选 (b) 的根因：它的幂等性与可追溯性都押在过渡列上，而过渡列正是它自己制造的技术债。

派生规则：

- **一个全库统一 namespace**（UUID 常量）。不用每集合独立 namespace：ObjectId 本身全局唯一（时戳 + 随机），单一 namespace 无碰撞风险，还使「同一个 hex 在任何集合里都映射到同一个 uuid」，排查跨集合引用时不需要知道来源集合。
  **取值定稿（2026-10-25，B5）**：`WALNUT_ADMIN_ETL_NAMESPACE = 'c1882c14-e4d4-4f2b-b728-346db51c312e'`，
  常量的**唯一真源**是 `packages/tooling/scripts/src/db/uuid5.ts`（本文件只写引用，不写第二份字面值以外的语义；
  该文件同时是 v5 派生函数的唯一实现，ETL / seed / 订正脚本共用）。**永不可改**——改了等于全部存量 id 换世界。
- name = 原 24 位 hex 字符串本体。
- 实现放共享工具（`@walnut-server/utils` 或 ETL 模块内），seed 重建与 ETL 共用同一函数——保证「本地 / demo / CI 由 seed 重建出的 id 彼此一致」，demo 环境的 id 稳定可引用。
  （勘误 2026-10-25：实现最终落在工具链 `@walnut/scripts` 的 `src/db/uuid5.ts`——server 侧无需在运行时派生 id，
  B5 的 root 角色守卫已改用等价判据；ETL / seed 与订正脚本都在工具链侧消费同一实现。）

### 3.3 主键类型与默认值

- 列类型：**原生 `uuid`**（16 字节，比 text 省 60%+ 且有等值比较加速），不用 `text` 装 uuid。
- 默认值：**`DEFAULT gen_random_uuid()`**（PG 13+ 内置，PG 18 无需扩展）。新行由数据库兜底生成 v4。
- 应用层**不**强制生成 id：TypeORM 插入时不传 id 即走 DB 默认。理由：单一生成点；v5 只出现在 ETL 与 seed 两条显式通道，正常业务路径永远拿 v4，两世界不混淆。
- DTO 校验器从 `Types.ObjectId.isValid` 换成 uuid 语法校验（ADR-0021 Decision 2 的连带清单，Phase 3 落地）。

**uuid v7 定案（原 Q10-d，2026-10-25）**：PG 18 已内置 `uuidv7()`（时间有序）。v4 的随机性在追加型大表上意味着每个新行都插到 B-tree 随机位置——写放大与页分裂随表增长恶化；v7 前缀时间有序，新行恒落索引右端，与日志表「只追加」的形态吻合，还利于按时间范围扫描。**定案：追加型大表 sys_log_operate / sys_log_auth / sys_deleted / auth_refresh_token 的 PK 默认值用 `uuidv7()`**，其余表维持 `gen_random_uuid()`。迁移后的 ID 三通道如下，互不混淆：

| 通道 | 覆盖 | 生成方式 |
|------|------|----------|
| v5 存量 | ETL / seed 重建的全部存量行 | `deriveUuid(hex)`（统一 namespace，幂等可重跑） |
| v7 新增 | 上述四张追加型表的新行 | 列默认 `uuidv7()` |
| v4 新增 | 其余 22 张表的新行 | 列默认 `gen_random_uuid()` |

id 泄漏创建时间的代价结论（维持初评）：v7 的 id 会粗略暴露行创建时间——四张表均为日志/回收站/会话性质，无保密诉求，代价可忽略；业务表不采用 v7，不存在对外暴露实体创建时间的问题。

---

## 4. 逐表映射

约定：第 4 节各表**省略公共列**（`id` / `created_at` / `updated_at`，形态见 2.3，列数已计入总览）；「NULL 性」未标注 NOT NULL 的列即可 NULL。CHECK 枚举值均核对自 `libs/const` / `@walnut/contract` / schema 内 const。

### 4.1 sys_user（13 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| userName | user_name | text | YES | NULL | 原 partial unique（`$type: string` 过滤）→ `CREATE UNIQUE INDEX ... WHERE user_name IS NOT NULL`，语义等价 |
| nickName | nick_name | text | YES | NULL | |
| age | age | integer | YES | NULL | CHECK (age > 0)（schema 校验 int+positive） |
| gender | gender | smallint | NO | 9 | CHECK (gender IN (0,1,2,9))（GB 标准，schema const） |
| avatar | avatar | text | YES | NULL | |
| description | description | text | YES | NULL | |
| status | status | boolean | NO | true | |
| roles | → **sys_user_role** 关联表 | — | — | — | 原 ObjectId[]；FK 双向 CASCADE |
| roleMode | role_mode | varchar(16) | NO | 'switchable' | CHECK (IN ('switchable','combinable')) |
| currentRole | current_role_id | uuid | YES | NULL | FK → sys_role(id) ON DELETE SET NULL |
| mfaSetup | mfa_setup | boolean | NO | false | |

索引：PK；`uq_user_name`（partial WHERE NOT NULL）；`idx_user_created_at (created_at DESC)`（列表默认排序）；`idx_user_current_role (current_role_id)`。
关联表 **sys_user_role(user_id, role_id)**：PK(user_id, role_id)；`idx_role_id`（role 的 `populated_usersCount` 反查）；FK user_id CASCADE、role_id CASCADE。

> 勘误记录：`user.schema.ts:144-150` 在 `roles` **数组路径**上声明了 `unique: true`——Mongoose 的语义是 multikey 唯一，展开即「同一个 role 全库只能赋给一个用户」，与业务事实（多用户共享角色）直接矛盾，几乎必然是误声明（本意应是数组内去重，而那是插入行为，无需索引）。关联表 PK `(user_id, role_id)` **不保留**该 multikey 语义；误声明与否由 7.3 预检两条核对坐实（旧库索引真实存在性 + 跨用户重复赋值检测）。

### 4.2 sys_role（7 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| roleName | role_name | text | NO | — | UNIQUE（schema `unique: true`）；NOT NULL 属**收紧**而非对齐，旧库 null 行检测见 7.3 |
| description | description | text | YES | NULL | |
| order | sort_order | integer | YES | NULL | 保留字改名（2.1） |
| status | status | boolean | NO | true | |
| menus | → **sys_role_menu** 关联表 | — | — | — | FK 双向 CASCADE |

索引：PK；`uq_role_name`；`idx_role_created_at`。
关联表 **sys_role_menu(role_id, menu_id)**：PK(role_id, menu_id)；`idx_menu_id`；FK role_id CASCADE、menu_id CASCADE。

> 勘误记录：`role.schema.ts:74-80` 对 `menus` 数组的 `unique: true` 同 4.1 勘误——multikey 展开即「一个 menu 只能属于一个 role」，与多角色共享菜单的授权模型冲突，确定不迁移；7.3 预检做跨角色重复菜单授权检测坐实。

virtual `populated_usersCount` / `populated_menusList`（含 `meta.status` 过滤）→ Phase 3 用 EXISTS 子查询 / JOIN 改写，索引已覆盖（idx_role_id、idx_menu_id、4.3 的 status 索引）。

### 4.3 sys_menu（29 列，meta 拍平）

`meta` 是字段固定、带默认值的既有类（19 个字段，Swagger 全量文档化），**已定案拍平为独立列**（Q1，2026-10-25；status / order 是查询与排序键），Phase 3 实体组装回 meta 对象出参，前端无感。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| pid | pid | uuid | YES | NULL | **根节点 pid=NULL**（已查实：seed 157 个 `_id`、仅 156 个 `pid`——根节点文档完全没有 pid 键，schema 的 `required` 对 mongoimport 直插不生效）。FK → sys_menu(id) 自引用（FK 允许 NULL）；ON DELETE **RESTRICT**（Q6 定案：防误删静默扩面，子树处理在应用层） |
| type | type | varchar(8) | NO | 'catalog' | CHECK (IN ('catalog','menu','element')) |
| path | path | text | YES | NULL | |
| name | name | text | YES | NULL | partial unique（原 `$type: string` 过滤）→ `WHERE name IS NOT NULL` |
| component | component | text | YES | NULL | |
| title | title | text | YES | NULL | i18n key 形态 |
| icon | icon | text | YES | NULL | |
| meta.order | sort_order | integer | YES | NULL | |
| meta.ternal | ternal | varchar(8) | NO | 'none' | CHECK (IN ('none','internal','external')) |
| meta.url | url | text | YES | NULL | |
| meta.show | is_show | boolean | NO | true | 保留字改名 |
| meta.cache | cache | boolean | NO | false | |
| meta.status | status | boolean | NO | true | role.virtual 的 match 字段，进索引 |
| meta.affix | affix | boolean | NO | false | |
| meta.permission | permission | text | YES | NULL | `*:*:*` 形态 |
| meta.menuActiveName | menu_active_name | text | YES | NULL | |
| meta.menuActiveSameTab | menu_active_same_tab | boolean | NO | false | |
| meta.badge | badge | text | YES | NULL | |
| meta.activeIcon | active_icon | text | YES | NULL | |
| meta.position | position | boolean | NO | false | |
| meta.leaveTip | leave_tip | boolean | NO | false | |
| meta.maskUrl | mask_url | boolean | NO | false | |
| meta.hijackRefresh | hijack_refresh | boolean | NO | false | |
| meta.watermark | watermark | jsonb | YES | NULL | 自由配置对象，jsonb 合理（5.5） |
| meta.transition | transition | varchar(32) | NO | 'fade' | |
| meta.cacheKeyStrategy | cache_key_strategy | varchar(8) | YES | NULL | CHECK (IN ('name','path')) |

索引：PK；`uq_menu_name`（partial）；`idx_menu_pid (pid) WHERE pid IS NOT NULL`（partial——根节点 pid 为 NULL，全量索引无意义）；`idx_menu_status_sort_order (status, sort_order)`（菜单树检索固定按 status=true + order 排序）。

### 4.4 sys_lang（7 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| lang | lang | varchar(16) | NO | — | 取值域 = `@walnut/contract` Locale（seed 含 en_US / zh_CN）；**补 UNIQUE**（Q2 定案：Mongo 未声明但业务唯一） |
| description | description | text | YES | NULL | |
| order | sort_order | integer | YES | NULL | |
| status | status | boolean | NO | true | |

索引：PK；`uq_lang`。表体量个位数，不建 created_at 索引。
virtual 两个 locale 计数 → 子查询改写，见 5.2。

### 4.5 sys_locale（6 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| langId | lang_id | uuid | NO | — | FK → sys_lang(id) ON DELETE CASCADE |
| key | key | text | NO | — | i18n key |
| value | value | text | YES | NULL | NULL = 未翻译 |

索引（4 个，与总览对齐）：PK；`uq_locale_lang_key (lang_id, key)`（**Q2/Q11 定案补 UNIQUE**：一语言一键一行，不允许重复；ETL 预检保留作装载拦截）；`idx_locale_key (key)`（key 前缀搜索）；`idx_locale_key_trgm`（GIN，`key gin_trgm_ops`——Q9 定案：全库唯一一处 trgm，pg_trgm）。

### 4.6 sys_dict_type（7 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| name | name | text | NO | — | 实为 i18n key（seed `dict.name.status`） |
| type | type | text | NO | — | UNIQUE（schema 声明） |
| status | status | boolean | NO | true | |
| description | description | text | YES | NULL | |

索引：PK；`uq_dict_type`；`idx_dict_type_created_at`。

### 4.7 sys_dict_data（10 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| typeId | type_id | uuid | NO | — | FK → sys_dict_type(id) ON DELETE CASCADE |
| label | label | text | NO | — | i18n key 形态 |
| value | value | text | NO | — | |
| order | sort_order | integer | NO | 0 | |
| status | status | boolean | NO | true | |
| tagType | tag_type | varchar(8) | NO | 'primary' | CHECK (IN ('primary','info','success','warning','error')) |
| description | description | text | YES | NULL | |

索引：PK；`idx_dict_data_type_order (type_id, sort_order)`（按类型取数即排好序）。

### 4.8 sys_device（22 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| deviceName | device_name | text | NO | — | UNIQUE |
| deviceId | device_id | text | NO | — | UNIQUE（客户端指纹，作为被引用业务键，见 Q5） |
| deviceInfo | device_info | jsonb | NO | — | UA 结构化对象（browser/engine/os/cpu/device 子对象），整体读写、无字段级查询 → jsonb 合理 |
| hardwareInfo | hardware_info | jsonb | YES | NULL | 同上 |
| locationInfo | location_info | jsonb | YES | NULL | 国家/省/市结构体，`getLocationString()` 整体取用；Q8 定案维持 jsonb 整存（无字段级查询需求） |
| locationHistory | location_history | jsonb | NO | '[]' | 上限 5 条的 IP-定位历史，整体覆盖写 → jsonb 合理 |
| sr.height / sr.width | sr_height / sr_width | integer | YES | NULL | 拍平：数值列可能进统计 |
| vp.height / vp.width | vp_height / vp_width | integer | YES | NULL | 同上 |
| ip | ip | text | YES | NULL | 保持 text（Q8 定案：本期不收窄，日志侧存在占位串兼容诉求） |
| ipHistory | ip_history | text[] | NO | — | 纯字符串数组 |
| active | active | boolean | NO | false | |
| locked | locked | boolean | NO | false | |
| banned | banned | boolean | NO | false | |
| private | private | boolean | NO | false | PG 非保留字，可原名 |
| geoLocation | geo_longitude / geo_latitude | double precision ×2 | YES | NULL | 拍平：可索引可计算；Q8 定案维持 double precision，本期不上 PostGIS |
| riskScore | risk_score | smallint | NO | 0 | CHECK (risk_score BETWEEN 0 AND 100)（schema min/max） |

索引：PK；`uq_device_name`；`uq_device_id`；`idx_device_created_at`。

### 4.9 sys_user_device（12 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| deviceName | device_name | text | YES | NULL | 用户可改的显示名 |
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE |
| deviceId | device_id | text | NO | — | **按业务键 FK** → sys_device(device_id)（该列已 UNIQUE，FK 合法）CASCADE；理由见 Q5 |
| link | link | boolean | NO | false | |
| linkType | link_type | varchar(8) | NO | 'system' | CHECK (IN ('user','admin','system')) |
| locked | locked | boolean | NO | false | |
| lastActiveAt | last_active_at | timestamptz | YES | NULL | |
| trusted | trusted | boolean | NO | false | |
| trustedExpiredAt | trusted_expired_at | timestamptz | YES | NULL | |

索引：PK；`uq_user_device (user_id, device_id)`（**Q2 定案补 UNIQUE**，Mongo 未声明）；`idx_user_device_device (device_id)`（device → users 反查，兼服务 FK）；`idx_user_device_created_at`。

### 4.10 sys_user_identity（14 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE |
| type | type | varchar(16) | NO | — | CHECK (IN ('phoneNumber','emailAddress','idCard','password')) |
| purpose | purpose | varchar(8) | NO | — | CHECK (IN ('login','security')) |
| value | value | text | NO | — | AES-256-GCM 密文（schema `select: false`，Phase 3 实体同样处理） |
| valueHash | value_hash | text | NO | — | HMAC-SHA256，查找键 |
| maskedValue | masked_value | text | NO | — | 展示用掩码 |
| verified | verified | boolean | NO | false | |
| verifiedAt | verified_at | timestamptz | YES | NULL | |
| isPrimary | is_primary | boolean | NO | true | |
| status | status | boolean | NO | true | |
| metadata | metadata | jsonb | NO | '{}' | schema 注释明说「为未来预留的自由 JSON」→ jsonb 合理 |

索引：PK；`uq_identity (user_id, type, purpose)`（schema.index 声明）；`idx_identity_type_hash (type, value_hash)`（schema.index 声明；登录查找路径）。

### 4.11 sys_user_lock（10 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE；**补 UNIQUE**（Q2 定案：一用户一锁配置） |
| lockRoute | lock_route | jsonb | NO | '{}' | `{name?, query?, params?}`，query/params 任意对象 → jsonb 合理 |
| lockPwdHash | lock_pwd_hash | text | YES | NULL | bcrypt hash（pre-save 逻辑迁到 service，Phase 3 事项） |
| lockMode | lock_mode | varchar(8) | NO | 'default' | CHECK (IN ('default','idle','security')) |
| lockIdleSec | lock_idle_sec | integer | NO | 600 | |
| lockSecuritySec | lock_security_sec | integer | NO | 60 | |
| lockCrossDevice | lock_cross_device | boolean | NO | true | |

索引：PK；`uq_user_lock_user (user_id)`。

### 4.12 sys_user_mfa（16 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE |
| type | type | varchar(8) | NO | — | CHECK (IN ('totp','webauthn')) |
| deviceId | device_id | text | NO | — | 松引用 sys_device.device_id（**不建 FK**：MFA 凭据不应随设备行删除而级联消失，Q5） |
| name | name | text | NO | — | |
| totpSecretCiphertext | totp_secret_ciphertext | text | YES | NULL | `select: false` |
| webauthnCredentialId | webauthn_credential_id | text | YES | NULL | **补 UNIQUE（partial WHERE NOT NULL）**（Q2 定案：凭据 id 全局唯一） |
| webauthnPublicKey | webauthn_public_key | text | YES | NULL | `select: false` |
| webauthnCounter | webauthn_counter | bigint | NO | 0 | |
| webauthnTransports | webauthn_transports | text[] | NO | '{}' | CHECK 约束可选（IN usb/ble/nfc/internal/hybrid），数组元素 CHECK 见 migration 实现 |
| phoneNumberCiphertext | phone_number_ciphertext | text | YES | NULL | `select: false` |
| backupCodesCiphertext | backup_codes_ciphertext | text[] | NO | '{}' | `select: false` |
| status | status | boolean | NO | true | |
| lastUsedAt | last_used_at | timestamptz | YES | NULL | |

索引：PK；`idx_user_mfa_user (user_id)`；`uq_user_mfa_credential (webauthn_credential_id) WHERE webauthn_credential_id IS NOT NULL`。

### 4.13 sys_user_oauth（7 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE |
| provider | provider | varchar(16) | NO | — | CHECK (IN ('google-one-tap','gitee','github')) |
| providerId | provider_id | text | NO | — | |
| status | status | boolean | NO | true | |

索引：PK；`uq_oauth (provider, provider_id)`（schema.index 声明）；`idx_oauth_user (user_id)`。
勘误记录：schema.index 里的 `{ userId: 1, enabled: 1 }` 引用了不存在的 `enabled` 字段（实际字段是 `status`），是 Mongo 侧的死索引，**不迁移**，Phase 3 顺手在旧库摘除。

### 4.14 sys_user_preference（12 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE；**补 UNIQUE**（Q2 定案：一用户一份偏好） |
| fontSize | font_size | smallint | NO | 14 | CHECK (IN (10,12,14,16,20)) |
| dark | dark | boolean | NO | false | |
| reducedMotion | reduced_motion | boolean | NO | false | |
| colorMode | color_mode | varchar(20) | NO | 'default' | CHECK (IN ('default','cafe','contrast','grayscale','grayscale-inverted','inverted')) |
| CVD | cvd | varchar(20) | YES | NULL | CHECK (IN ('default','protanopia','deuteranopia','tritanopia','achromatopsia')) |
| locale | locale | varchar(16) | NO | 'zh_CN' | 取值域 = Locale |
| layoutMode | layout_mode | varchar(16) | NO | 'left-menu' | CHECK (IN ('left-menu','top-menu')) |
| layout | layout | jsonb | NO | '{}' | 前端布局的自由状态袋 → jsonb 合理 |

索引：PK；`uq_user_preference_user (user_id)`。

### 4.15 sys_log_auth（13 列）

公共列只有 `id`（**PK 默认 `uuidv7()`**，3.3 定案）；时间列 `authenticated_at timestamptz NOT NULL DEFAULT now()`（原 createdAt 改名，schema `updatedAt: false`）。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| ip | ip | text | YES | NULL | 保持 text（Q8 定案：不收窄） |
| location | location | text | YES | NULL | |
| os | os | text | YES | NULL | |
| browser | browser | text | YES | NULL | |
| userId | user_id | uuid | YES | NULL | **松引用**（2.4-3），登录失败时为 NULL |
| userName | user_name | text | YES | NULL | 快照列，用户删除后日志仍可读 |
| identifier | identifier | text | YES | NULL | 登录标识（email/phone） |
| success | success | boolean | NO | false | |
| msg | msg | text | YES | NULL | |
| type | type | varchar(16) | NO | — | CHECK (IN ('opaque','qrcode','otp','emailAddress','phoneNumber','github','gitee','googleFedCM')) |
| deviceId | device_id | text | YES | NULL | 松引用 |

索引：PK；`idx_log_auth_at (authenticated_at DESC)`（列表默认排序）；`idx_log_auth_user (user_id)`；`idx_log_auth_device (device_id)`（virtual populate_device 反查）。

### 4.16 sys_log_operate（23 列）

公共列只有 `id`（**PK 默认 `uuidv7()`**，3.3 定案）；时间列 `operated_at timestamptz NOT NULL DEFAULT now()`。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| title | title | text | NO | — | 业务标注；Q10-a 定案随迁移收紧 NOT NULL（旧库空值预检见 7.3） |
| actionType | action_type | varchar(16) | NO | — | CHECK (IN ('OTHER','CREATE','UPDATE','DELETE','DELETE_MANY','IMPORT','EXPORT','CLEAR')) |
| operation | operation | varchar(16) | NO | — | 取值 = `WalnutAdminConstDecoratorLogOperateType`（读写类枚举，migration 时以 const 为准生成） |
| method | method | varchar(8) | YES | NULL | CHECK (IN ('GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD')) |
| url | url | text | YES | NULL | |
| httpVersion | http_version | text | YES | NULL | |
| location | location | text | YES | NULL | |
| os | os | text | YES | NULL | |
| browser | browser | text | YES | NULL | |
| statusCode | status_code | integer | YES | NULL | |
| requestData | request_data | jsonb | YES | NULL | Mongo 存 stringify 字符串；**Q7 定案**：ETL parse 入 jsonb，失败时本列 NULL、原文入 `raw_request_data`；应用新增直接写 jsonb |
| responseData | response_data | jsonb | YES | NULL | 同上（旁路 `raw_response_data`） |
| （Q7 定案新增） | raw_request_data | text | YES | NULL | ETL parse 失败时的原文旁路，零丢失 |
| （Q7 定案新增） | raw_response_data | text | YES | NULL | 同上 |
| correspondingMS | corresponding_ms | integer | YES | NULL | |
| userId | user_id | uuid | YES | NULL | 松引用 |
| userName | user_name | text | YES | NULL | 快照列 |
| deviceId | device_id | text | YES | NULL | 松引用 |
| ip | ip | text | YES | NULL | |
| invokingMethod | invoking_method | text | YES | NULL | service.method |
| success | success | boolean | YES | NULL | schema 允许 null，保持 |
| snapshotBefore | snapshot_before | jsonb | YES | NULL | 脱敏前照（decorator 已 maskSensitive） |
| snapshotAfter | snapshot_after | jsonb | YES | NULL | 脱敏后照 |

索引：PK；`idx_log_operate_at (operated_at DESC)`；`idx_log_operate_user (user_id)`；`idx_log_operate_device (device_id)`。

### 4.17 sys_deleted（8 列）

公共列只有 `id`（**PK 默认 `uuidv7()`**，3.3 定案）；时间列 `deleted_at timestamptz`（原 createdAt 改名；保持可 NULL 以对齐 schema，未发现必须 NOT NULL 的证据）。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| content | content | jsonb | NO | — | 原 text（JSON.stringify 产物）→ jsonb；理由见 5.3 |
| modelName | model_name | text | NO | — | 恢复路由键 |
| collectionName | collection_name | text | NO | — | 纯记录字段，保留 |
| deletedId | deleted_id | uuid | NO | — | 被删文档原 id |
| deletedBy | deleted_by | uuid | NO | — | 松引用 sys_user（Q3 定案：删除者自己也可能被删，建 FK 会自锁） |
| logOperateId | log_operate_id | uuid | YES | NULL | 松引用 |

索引：PK；`idx_deleted_model_at (model_name, deleted_at DESC)`（回收站按类型 + 时间列表）；`idx_deleted_id (deleted_id)`（恢复入口查找）；`idx_deleted_by (deleted_by)`（recoverMine「我的回收站」）。

### 4.18 shared_area（4 列，66.3 万行）

`timestamps: false` → 无时间列（是否补审计列见 Q12）。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| code | code | varchar(12) | NO | — | UNIQUE（唯一索引即原 schema 声明）；位数分布见下方勘误 |
| name | name | text | NO | — | |
| pcode | pcode | varchar(12) | NO | — | **不建 FK**（Q6 定案，总览 area FK=0 按此计）；父子完整性由应用层删除校验 + 7.3 孤儿/环检测兜底 |

索引：PK；`uq_area_code`；`idx_area_pcode (pcode)`（树查询主力索引）。

> **勘误（2026-10-25，Phase 4 ETL 实测）**：本表 code/pcode 原判 varchar(9)（「位数 1/2/4/6/9」）。存量 66.3 万行的实测分布是 code 2/4/6/9/**12**（12 位村/居委会级 61.8 万行、占 93%），varchar(9) 装不下 ⇒ 放宽为 varchar(12)，migration / 实体同批修正；位数分布对账以 ETL 实测为准，不再按 9 位上限判形。
>
> **pcode FK 的形态说明（Q6 定案）**：顶层省份的 `pcode='0'` 是约定根值而非行引用（Mongo 侧本就无约束）。定案采 (i) 不建 FK——仅保留唯一约束 + pcode 索引，与现状语义完全一致；不为约束而篡改数据集（伪根行方案需 ETL 凭空造一行，弃用）。完整性由应用层删除校验（「有子节点不许删」现状已存在）+ 7.3 孤儿/环检测兜底。

### 4.19 app_setting（8 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| settingName | setting_name | text | NO | — | |
| settingKey | setting_key | text | NO | — | UNIQUE |
| settingValue | setting_value | text | NO | — | **注意**：seed 里此列存过角色 id（`app.default.role`）；Q4 定案：保持 text，由 ETL 专项重写内嵌 ObjectId（7.3），不引入 typed 引用列 |
| settingType | setting_type | varchar(16) | NO | — | CHECK (IN ('auth','global','functional')) |
| remark | remark | text | YES | NULL | |
| （Q4 定案新增） | created_by | uuid | YES | NULL | seed 实存 schema 未声明的字段，补列存证；松引用 sys_user（创建者可能被回收，Q3 同口径），不建 FK、不建索引 |

索引：PK；`uq_setting_key`。
seed 中存在 schema 未声明的 `createdBy` 字段（直接 mongoimport 产物）→ 是否补 `created_by uuid` 列，见 Q4。

### 4.20 app_demo（17 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| demoString | demo_string | text | YES | NULL | UNIQUE（schema 声明） |
| demoPhoneNumber | demo_phone_number | text | YES | NULL | UNIQUE（schema 声明） |
| demoStringArray | demo_string_array | text[] | NO | — | |
| demoNumber | demo_number | integer | YES | NULL | |
| demoNumberArray | demo_number_array | integer[] | NO | — | |
| demoBoolean | demo_boolean | boolean | NO | false | |
| demoBooleanArray | demo_boolean_array | boolean[] | NO | — | |
| demoDate | demo_date | timestamptz | YES | NULL | |
| demoDateArray | demo_date_array | timestamptz[] | NO | — | |
| demoEnum | demo_enum | smallint | NO | 1 | CHECK (IN (1,2,3,4)) |
| demoEnumArray | demo_enum_array | smallint[] | NO | — | |
| demoMongoId | demo_uuid | uuid | YES | NULL | 演示用引用形态 |
| demoMongoIdArray | demo_uuid_array | uuid[] | NO | — | |
| demoObject | demo_object | jsonb | YES | NULL | `{o1,o2,o3}` 演示 Mixed → jsonb（演示表的职责本身就是展示任意对象形态） |

索引：PK；`uq_demo_string`；`uq_demo_phone_number`。

### 4.21 app_monitor_user（10 列）

时间列 `first_visit_at` / `last_active_at`（timestamps 改名，无 created/updated）。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| visitorId | visitor_id | text | NO | — | **补 UNIQUE**（Q2 定案：一访客一行） |
| userId | user_id | uuid | YES | NULL | 松引用（访客监测独立于用户生命周期） |
| deviceId | device_id | text | YES | NULL | 松引用 |
| auth | auth | boolean | NO | false | |
| focus | focus | boolean | NO | false | |
| left | is_left | boolean | NO | false | 保留字改名 |
| currentRouter | current_router | text | YES | NULL | |

索引：PK；`uq_monitor_visitor (visitor_id)`；`idx_monitor_device (device_id)`；`idx_monitor_user (user_id)`。

### 4.22 app_error（15 列）

公共列只有 `id` + `created_at`（schema `updatedAt: false`）。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| message | message | text | YES | NULL | |
| stack | stack | text | YES | NULL | |
| statusCode | status_code | integer | YES | NULL | |
| path | path | text | YES | NULL | |
| method | method | varchar(8) | YES | NULL | 同 4.16 CHECK |
| headers | headers | jsonb | NO | '{}' | 任意请求头 → jsonb |
| payload | payload | jsonb | YES | NULL | `{body,params,query}`，各成员为 stringify 字符串；Q7 定案：ETL parse 入 jsonb，失败入旁路 `raw_payload` |
| （Q7 定案新增） | raw_payload | text | YES | NULL | ETL parse 失败时的原文旁路，零丢失 |
| errorType | error_type | text | YES | NULL | |
| userId | user_id | uuid | YES | NULL | 松引用 |
| responseCode | response_code | varchar(16) | YES | NULL | 取值 = AppResponseCode const |
| responseMsg | response_msg | text | YES | NULL | |
| ip | ip | text | YES | NULL | |
| env | env | varchar(16) | YES | NULL | CHECK (IN ('development','stage','production')) |

索引：PK；`idx_error_created_at (created_at DESC)`；`idx_error_user (user_id)`。

### 4.23 app_key（11 列）

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| key | key | text | NO | — | UNIQUE |
| type | type | varchar(16) | NO | — | CHECK (IN ('RSA_PAIR','AES_KEY_URL','JWT_AT','JWT_RT')) |
| version | version | integer | NO | — | |
| status | status | varchar(16) | NO | 'ACTIVE' | CHECK (IN ('ACTIVE','DEPRECATED','DISABLED')) |
| validStart | valid_start | timestamptz | NO | — | |
| validEnd | valid_end | timestamptz | YES | NULL | |
| rotateAfter | rotate_after | timestamptz | YES | NULL | |
| meta | meta | jsonb | YES | NULL | **必须 jsonb**：不同 type 的 key 形态完全不同（RSA 存 PEM 对、AES 存 keyB64+ivB64、JWT 存 secret、另有 bits/cipher），一列多型是 jsonb 的教科书场景 |

索引：PK；`uq_key`；`idx_app_key_status (status)`（取当前可用 key）。

### 4.24 auth_refresh_token（9 列）

公共列只有 `id`（**PK 默认 `uuidv7()`**，3.3 定案）+ `created_at`（`updatedAt: false`）。

| 字段 | 列 | 类型 | NULL | 默认 | 说明 |
|------|----|------|------|------|------|
| jti | jti | text | NO | — | UNIQUE（schema 声明） |
| userId | user_id | uuid | NO | — | FK → sys_user(id) CASCADE（用户彻底删除则其会话令牌随之失效，正确语义） |
| deviceId | device_id | text | NO | — | **FK → sys_device(device_id) ON DELETE CASCADE**（Q5 定案：按业务键建 FK；设备被删则会话令牌随之清理） |
| encryptedToken | encrypted_token | text | NO | — | |
| expiredAt | expired_at | timestamptz | NO | — | |
| revoked | revoked | boolean | NO | false | |
| revokeReason | revoke_reason | varchar(24) | YES | NULL | 取值 = `WalnutAdminConstRevokeRTType`（12 个值：updatePass / resetPass / updateEmail / updatePhoneNumber / forceQuitOnline / forceQuitOffline / currentRoleBanned / currentUserBanned / deviceBanned / deviceHighRisk / versionUpgrade / userKickOther），migration 以 const 为准 |

索引：PK；`uq_jti`；`idx_rt_user (user_id)`（踢人下线按用户批量 revoke 的路径）；`idx_rt_device (device_id)`（兼服务 FK）；`idx_rt_expired (expired_at)`（purge job 判据——Q10-b 定案纳入 Phase 3，见第 6 节）。

---

## 5. 专项设计

### 5.1 shared_area 树：邻接表 + 递归 CTE

现状（`area.service.ts`）：按 `pcode` 查**一层**子节点（Redis 缓存按 pcode 粒度）+ 应用层 `arrToTree` 建树 + 向上逐级收集兄弟节点。虚拟字段 `children` / `parent` 只是 populate 形态，实际查询全部走 `pcode` 单层。

PG 侧两层能力：

**日常路径保持单层查询**（缓存策略不变，`idx_area_pcode` 服务）：

```sql
SELECT code, name, pcode FROM shared_area WHERE pcode = $1 ORDER BY code;
```

**整树 / 子树一次性拉取**（替代 MongoDB 侧无法高效表达的 `$graphLookup` 场景，66 万行下应用层递归循环查询不可接受）：

```sql
-- 以 $1 为根的整个子树（含深度）
WITH RECURSIVE subtree AS (
  SELECT id, code, name, pcode, 0 AS depth
  FROM shared_area
  WHERE code = $1
  UNION ALL
  SELECT a.id, a.code, a.name, a.pcode, s.depth + 1
  FROM shared_area a
  JOIN subtree s ON a.pcode = s.code
) CYCLE code SET is_cycle USING path  -- PG 14+ 环保护（兜底，见下方说明）
SELECT code, name, pcode, depth, is_cycle FROM subtree;
```

- 反向（parent / 祖先链）同一结构，递归项换成 `JOIN subtree s ON s.pcode = a.code`。
- 性能判据：递归 CTE 按**工作表（work table）机制**逐层展开——每轮把上一轮产出读入工作表再驱动下一轮，每层是一次 `idx_area_pcode` 索引扫描（PG 12+ 起递归项不走 `MATERIALIZED` 语义，该修饰只作用于非递归 CTE）；省级行数（34）毫秒级；全量 66 万行一次拉回是网络问题不是索引问题——按需限制 depth（`WHERE depth < $2`）。
- **环保护（两层）**：`UNION ALL` 形态在 pcode 数据成环时会无限递归。第一层防线是数据质量——ETL 合法性自检含环检测（7.3，应返回 0 行）；第二层是 SQL 兜底——上图已并入 PG 14+ 的 `CYCLE code SET is_cycle USING path` 子句，成环时自动标记 `is_cycle` 并终止，不依赖数据先验干净。
- ETL 装载完成后的合法性自检（5 分钟内可跑）：`SELECT count(*) FROM shared_area c LEFT JOIN shared_area p ON c.pcode = p.code WHERE c.pcode <> '0' AND p.code IS NULL;` 应为 0（孤儿检测）。

### 5.2 sys_lang / sys_locale：lang.repo.service 最复杂聚合的 SQL 重写

**原聚合 1（findByIdWithLocaleCounts）**：`$lookup` 两次拉全量数组只为 `$size` 计数。SQL 版用子查询计数，不再物化明细：

```sql
SELECT l.id, l.lang, l.description, l.sort_order, l.status,
       (SELECT count(*) FROM sys_locale t WHERE t.lang_id = l.id) AS populated_locales_total_count,
       (SELECT count(*) FROM sys_locale t
         WHERE t.lang_id = l.id AND t.value IS NOT NULL) AS populated_locales_finished_count
FROM sys_lang l
WHERE l.id = $1;
```

**原聚合 2（findMessagesByLang）**：`$let` + `$toObjectId` + `$arrayToObject` 把某语言全部 locale 折叠成 `{key: value}` 动态 map。其中 `$toObjectId` 是为了绕「langId 历史上存过字符串」的坑——**PG 侧 langId 是 uuid FK 强类型，这一整类坑不复存在**：

```sql
SELECT COALESCE(jsonb_object_agg(t.key, t.value), '{}'::jsonb) AS data
FROM sys_locale t
JOIN sys_lang l ON l.id = t.lang_id
WHERE l.lang = $1;
```

语义对账点（Phase 4 对账清单用）：

- Mongo `$arrayToObject` 对 `value: null` 的条目产出 `"key": null`；`jsonb_object_agg` 同样保留 JSON null——缺翻译键行为一致。
- Mongo 版返回形如 `{ data: {...} }` 的单文档（无匹配语言时为 `undefined`→上层兜底）；SQL 版无匹配时返回单行单列 NULL，外层 `COALESCE('{}')` 已兜底，Phase 3 组装响应时保持既有 `{ data }` 包裹即可。

### 5.3 sys_deleted：jsonb 快照 + 按 modelName 路由恢复

**content 列选 jsonb（原为 stringify text）的理由**：快照本身就是合法 JSON；jsonb 让「回收站预览 / 按条件检索被删内容」成为普通 SQL 而无需应用层 parse；恢复时取回即对象。ETL 侧旧数据本就是 JSON 文本，一次 parse 即完成转换，无信息损失。

**恢复路径在 PG 的形态**（替换 `deleted.service.ts` 现有的 `db.model(modelName)` 动态模型 + 直接 `create`）：

1. 路由：维护一张显式注册表 `Record<modelName, TypeORM Repository>`（Nest 模块初始化时装配），替代 Mongo 的运行时动态模型——PG 有强 schema，不允许「来什么存什么」。
2. 还原：快照 jsonb → 实体。列级映射是显式的（Phase 3 各表恢复器实现），不再依赖 Mongo 的 Mixed 宽容。快照内引用列已是 uuid（v5 派生规则保证）；若快照内出现 24 位 hex（理论上仅「迁移前归档的旧快照」），按 v5 规则重算——但 sys_deleted 当前 **0 条**，此分支只是防御性代码。
3. 事务：现状 recover 已在 `@WalnutDBTransaction()` 内执行「目标集合 insert + sys_deleted delete」；PG 版不变（同一本地事务，反而比 Mongo 副本集事务更稳）。
4. 软删写入侧：`base.repository.deleteSoftById` 的 `JSON.stringify(toObject())` 改为直接写实体/JSON 对象进 content jsonb；`deletedId` 存被删行 uuid。virtual（populated_user / populated_log_operate）→ JOIN 改写。

### 5.4 时间戳：TypeORM 列管理，**不用触发器**

二选一结论：**TypeORM `CreateDateColumn` / `UpdateDateColumn`（timestamptz）+ 列级 `DEFAULT now()`，不部署 `updated_at` 触发器**。理由：

1. **单写者**：数据只经应用（TypeORM）写入，没有绕过 ORM 的 SQL 客户端；触发器防的是不存在的威胁。
2. **ETL 成本**：66 万行 shared_area 走 COPY，触发器是纯开销，还必须显式 `ALTER TABLE DISABLE TRIGGER` 绕过——为「防漏」引入的机制反成 ETL 的坑。
3. **显式性**：本仓纪律是行为显式可见（禁隐式全局同理）；触发器是数据库里的隐式写路径，排查数据变更时多一处不看代码看不到的魔法。
4. `DEFAULT now()` 仍保留：对 raw SQL / psql 手工插入兜底。

配套约束（Phase 3 写进约定）：`updated_at` 由 `UpdateDateColumn` 维护；**任何 raw SQL UPDATE 必须显式 `SET updated_at = now()`**（PG 无 MySQL 式 `ON UPDATE`，这正是触发器方案唯一的论据，用一条编码约定换掉一个隐式机制）。

### 5.5 jsonb 列判断清单（17 列，逐列理由）

| 表.列 | 理由（为什么这列必须/适合 jsonb） |
|-------|--------------------------------|
| sys_menu.watermark | schema 类型即 `Recordable`（任意配置对象），前端透传 |
| sys_device.device_info / hardware_info / location_info / location_history | 客户端上报的结构化画像，字段随 UA/硬件演化，只整体读写、无字段级查询条件；拍平收益为负（20+ 低价值列）。sr/vp/geo **已拆出** jsonb——数值形态有统计/计算价值 |
| sys_user_identity.metadata | schema 注释明说「未来预留自由 JSON」 |
| sys_user_lock.lock_route | query/params 是任意路由参数对象 |
| sys_user_preference.layout | 前端布局自由状态袋 |
| sys_log_operate.request_data / response_data / snapshot_before / snapshot_after | 请求/响应与脱敏前后照，形态随接口演化；审计数据要求「原样保真」，不拍平 |
| sys_deleted.content | 整文档快照，见 5.3 |
| app_demo.demo_object | 演示 Mixed 的表，职责如此 |
| app_error.headers / payload | 任意请求头与请求载荷，审计保真 |
| app_key.meta | 一列多型（RSA/AES/JWT 各自的密钥材料），jsonb 教科书场景 |

**明确拒绝 jsonb 化的**：sys_menu.meta 主体（19 个固定字段拍平成列——Q1 已定案——理由：字段稳定、`meta.status` 是 role populate 的过滤条件、`meta.order` 是排序键，jsonb 需要表达式索引且失去默认值与 NOT NULL 表达力）；sys_device 的 sr/vp/geo（数值列）；各字符串数组（text[] 而非 jsonb 数组：元素类型 homogeneous，可建 GIN，取值语义更准）。

---

## 6. Migration 策略（TypeORM）

- **`synchronize: false`** 从第一天锁死（TypeORMModule 配置处硬编码，不给环境变量开口子）。
- migration 文件位置：`apps/server/apps/api/migrations/`（跟 api app 走，不进 libs/db——migration 属于应用部署物而非共享库）。文件名 `1719xxxxxxxx-InitSchema.ts` 式 Timestamp 前缀，TypeORM 约定命名。
- **初始 migration 的生成方式**：Phase 3 实体完成后 `typeorm migration:generate` 产出骨架，但**以本文档为准人工复核修正**——以下几类 generate 不可靠，必须手写确认：partial unique index（WHERE 子句）、CHECK 约束、pg_trgm GIN、FK 的 on delete 行为、关联表的复合 PK。修正完成的初始 migration 即本设计的可执行形态，评审冲突以此对账。
- migration 运行：`migrationsRun: false`，经 package.json script 显式执行（dev / 部署各一条命令），CI 里跑 `migration:run` + `migration:revert` 双向验证可回滚。
- 扩展依赖：初始 migration 首段 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`（PG 18 trusted extension，无需超级用户）。
- seed / 事务基线（Phase 0 的对账测试）不进 migration——migration 只管结构，数据一律走 Phase 4 ETL 通道，保持「结构」与「数据」两条通道正交。
- **过期 refresh token 清理（Q10-b 定案，Phase 3 交付物）**：Nest schedule（`@nestjs/schedule`）定时任务按 `expired_at < now()` 批量 DELETE（走 `idx_rt_expired`），作为迁移交付物之一列入 Phase 3 实施清单。

---

## 7. ETL 接口约定（Phase 4 的输入，定方向不写实现）

### 7.1 ObjectId → uuid 映射的落地

- 派生函数：`deriveUuid(hex: string): uuid`（v5，统一 namespace），**ETL 与 seed 共用**（放在共享工具包，两通道 import 同一份实现）。
- 映射表 `etl_id_map(source_collection text, source_oid text, target_uuid uuid, migrated_at timestamptz)`，PK `(source_collection, source_oid)`，**PG 目标库之外**（独立 etl schema 或独立库，不进 24 表清单）。v5 方案下它不是重写的必需品（引用可直接算），保留的唯一价值是**对账与排障**——迁移验收期用它双向抽查，验收后归档删除，避免 (b) 方案的「过渡列长住」问题在这里重演。

### 7.2 shared_area 66.3 万条的批量通道

- **COPY**（PG 二进制或 text 格式），不经单条 INSERT；分批 5–10 万行/事务。
- 装载顺序：先 `CREATE TABLE`（无 FK）→ COPY 装载 → `CREATE INDEX`（索引后建比先建快）→ `ALTER TABLE ADD CONSTRAINT fk_pcode`（若 Q6 采纳 FK 方案）→ `ANALYZE shared_area`。
- 其余 23 表行数小（个位～万级），同一 COPY 通道复用，无需专门优化。

### 7.3 对账口径建议

1. **计数**：每表 `count(*)` vs Mongo `estimatedDocumentCount`，逐表登记；`sys_deleted` 按 model_name 分组对。
2. **id 抽查**：每表随机 N 行（建议 100），`etl_id_map` 反查 source_oid 存在且派生函数验算一致。
3. **字段级 diff**：抽样行按 uuid join，逐列比对（timestamptz 注意毫秒精度：Mongo ms 精度，PG 微秒，应无损）。
4. **专项**：
   - `shared_area` 孤儿检测（5.1 的 SQL 应为 0 行）+ code 位数分布对账（1/2/4/6/9）。
   - `shared_area` **环检测**（沿 pcode 向上走回到自身即成环，应返回 0 行）——环存在时 5.1 的 `UNION ALL` 递归会死循环，必须在装载后拦截；SQL 层的 `CYCLE` 子句只是兜底，不是数据脏的借口：

     ```sql
     WITH RECURSIVE up AS (
       SELECT code AS origin, pcode, false AS hit FROM shared_area WHERE pcode <> '0'
       UNION ALL
       SELECT u.origin, n.pcode, n.code = u.origin
       FROM up u JOIN shared_area n ON n.code = u.pcode
       WHERE NOT u.hit
     )
     SELECT DISTINCT origin FROM up WHERE hit;
     ```
   - **multikey unique 误声明两条**（4.1 / 4.2 勘误的坐实核对）：(a) 旧库确认 `sys_user.roles`、`sys_role.menus` 的 multikey 唯一索引是否真实存在（autoIndex 关闭时从未建过，不存在则连误伤都谈不上）；(b) 跨用户重复角色赋值检测（`sys_user_role` 按 `role_id` GROUP BY HAVING count(*) > 1）与跨角色重复菜单授权检测（`sys_role_menu` 按 `menu_id` 同法）——检出即证明该唯一从未被业务遵守。
   - `sys_role.role_name` **NULL 行检测**——4.2 将其收紧为 NOT NULL，属收紧而非对齐，装载前先验证旧库无 null 行。
   - `sys_log_operate.title` **NULL 行检测**——Q10-a 定案随迁移收紧 NOT NULL，装载前先验证旧库无空 title 行。
   - `sys_locale` 按 (lang, key) 去重预检——Q2/Q11 定案：不允许重复，约束照建；预检保留作装载拦截，检出重复先出报告。
   - `app_setting.setting_value` 中的 id 引用改写核对（Q4 定案：保持 text + ETL 重写；`app.default.role` 等 key 清单需从种子数据枚举）。
   - 日志/错误表 stringify 列（`request_data` / `response_data` / `payload`）**parse 成功率摸底**（Q7 定案）：失败行原文落 `raw_*` 旁路列，成功率作为 ETL 验收指标。
5. **幂等性验收**：ETL 整体重跑一遍，所有表 count 与 checksum 不变（v5 方案的结构性验证）。

---

## 8. 拍板结果（原开放问题 · 已全部定案）

维护者于 2026-10-25 对全部 12 个开放问题逐条拍板，正文已按定案修订完毕。本节为存档形态：结论 + 一句理由 + 拍板日期。

| # | 定案结论 | 理由（一句） | 拍板日期 |
|---|----------|--------------|----------|
| Q1 | sys_menu.meta 的 19 个字段全部拍平为独立列；Phase 3 实体组装回 meta 对象出参，前端无感 | status / order 是查询与排序键，拍平才能落约束与索引 | 2026-10-25 |
| Q2 | 7 处 Mongo 未声明但业务唯一的约束全部补 UNIQUE（lang、locale(lang_id,key)、preference.user_id、lock.user_id、user_device(user_id,device_id)、monitor.visitor_id、mfa.webauthn_credential_id）；7.3 预检全数保留（multikey 索引存在性、跨用户重复角色赋值、roleName null 检测等） | 业务唯一性落为数据库约束，脏数据靠预检前置拦截 | 2026-10-25 |
| Q3 | 日志/审计/回收站表松引用：user_id / device_id 一律不建 FK，保留 uuid 列 + 索引 | 审计必须比被引用对象活得久，FK 会阻碍用户彻底删除路径 | 2026-10-25 |
| Q4 | app_setting 补 `created_by` 列（松引用）；setting_value 保持 text，由 ETL 专项重写内嵌 ObjectId | created_by 有审计价值；typed 引用列无现实需求 | 2026-10-25 |
| Q5 | 设备引用按业务键 device_id 建 FK：user_device、auth_refresh_token（CASCADE）；sys_user_mfa 明确不建 | MFA 凭据不随设备删除级联消失；会话令牌随设备清理才是正确语义 | 2026-10-25 |
| Q6 | shared_area 不建 FK（总览口径定案）；menu pid 自引用 ON DELETE 用 **RESTRICT**，子树处理在应用层——reviewer 背书升级定案，如有异议可后续单独翻案 | 防误删静默扩面；不为约束篡改数据集 | 2026-10-25 |
| Q7 | log_operate / app_error 的 stringify 列收 jsonb + 同表 `raw_*` text 旁路列；ETL 前 parse 成功率摸底 | 保查询能力的同时原文零丢失 | 2026-10-25 |
| Q8 | IP 保持 text、坐标保持 double precision，本期不收窄（location_info 维持 jsonb 整存） | 收窄丢非严格值兼容，PostGIS 无现实需求 | 2026-10-25 |
| Q9 | 模糊索引只建 sys_locale.key 的 pg_trgm | 其余列无实证高频包含匹配，避免写放大 | 2026-10-25 |
| Q10 | (a) log_operate.title 随迁移收紧 NOT NULL、(c) 本期不分区——按本文倾向归档（拍板未单独触及，视为无异议）；(b) **purge job 纳入 Phase 3 交付物**（Nest schedule 清理过期 refresh token，见第 6 节）；(d) **uuidv7() 用于四张追加型表 PK 默认值**（3.3 三通道定稿） | (b)(d) 显式定案；(a)(c) 未被否决即按倾向落 | 2026-10-25 |
| Q11 | sys_locale 不允许 (lang_id, key) 重复，随 Q2 补 UNIQUE；去重预检保留作装载拦截 | 一语言一键一行是 i18n 语义本体 | 2026-10-25 |
| Q12 | shared_area 不补审计列 | 补了全是 ETL 当刻时间，无信息量 | 2026-10-25 |

---

## 附：与上游 ADR-0021 连带清单的对应

| ADR Decision | 本文落点 |
|--------------|----------|
| Decision 2（UUID、不做 24-hex 伪装） | 第 3 节：uuid 列型 + v5 派生 + gen_random_uuid() 默认 |
| Decision 3（事务 API 不变） | 5.3-3：recover 事务路径语义保持 |
| Decision 5（回收站完整保留） | 4.17 + 5.3：jsonb 快照 + modelName 路由恢复器 |
| Decision 6（本地 + seed 通道） | 3.2（seed 与 ETL 共用派生函数）+ 第 7 节 |
| Consequences-5（seed/工具链重建） | 7.1–7.3 通道约定，Phase 4 范围 |
