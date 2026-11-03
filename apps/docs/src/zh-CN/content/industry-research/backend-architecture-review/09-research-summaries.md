# 09 · 六份调研报告浓缩重建

> ⚠️ **这不是原文。** 原始六份共约 400KB、每份 600–816 行，含逐符号 / 逐文件 / 逐行的 `path:line` 证据；
> 在被删除后无法恢复。本文按会话内留存的摘要与 Lead 复核结果重建，保留**结论与关键数字**，
> **不保留**逐条证据表。需要完整证据时，等并行线收工后按最终树重出。
> 所有计数都是 **2026-11-02 采集时点快照**（当时工作区已有 13→218 个文件在改）。

---

## 01 · platform-any 导出消费审计

**方法**：解析三个 barrel 得 109 个导出（contract 64 / utils 30 / types 15），再遍历 4086 个源文件、
解析 439 处 `@walnut/*` import，按区域分类、还原 23 处别名导入、标记 128 处纯类型导入（29.2%）。

| 包 | 双端 | 仅前端 | 仅后端 | 死导出 | 运行时值双端率 | 判定 |
|----|-----:|------:|------:|------:|------:|------|
| @walnut/contract | 34 (53.1%) | 5 | 22 | 3 | **25/32 = 78.1%** | 弱正资产 |
| @walnut/utils | 5 (16.7%) | 20 | 1 | 4 | **3/22 = 13.6%** | **负资产** |
| @walnut/types | 0 | 12 | 0 | 3 | —（后端 0 消费） | **负资产** |

关键结论：
- `@walnut/utils` 实质是**浏览器密码学工具包**：16/22 运行时值只有前端消费；后端只用 3 个源文件
  （sign-raw + object-paths），base64 全走 Node `Buffer`（11 处零复用）
- `@walnut/types` 后端 **0 文件**消费，description 却写「consumed by both frontend and backend」
- 死导出 10 个（建议删 8，保留 `SignRawParts` / `SortParam`）
- **门禁盲区**：knip 把三包 barrel 当 entry（`knip.config.ts:103-111`）⇒ 死导出永不可能被发现；
  `monorepo/knip.md:40` 的「零发现」不是健康信号；快照测试反而把死导出固化
- 三类「假共享」都有硬证据：7 个逐字纯 re-export 壳、128 处纯类型导入、3 处两端各写一份
- 路由 123 个 key：双端 10 / 前端 82 / 后端 48 / 0 引用 3 —— 属 ADR 0023 决策 4 的有意设计，不算负资产，
  但文档不能说「共享真源」

---

## 02 · mongo / mongoose 遗留审计

**先纠正前提**：任务清单里的「大量 `_id` 命中」是宽匹配假阳性（`_id\b` 会命中 `user_id` 这类**正确**的
snake_case 外键，3212 处 / 190 文件）。按 token 边界精确统计：
- apps/server 源码 **31 处 / 25 文件，全是注释**
- apps/admin **27 处 / 6 文件，26 处在 views/demo 假数据**
- apps/server 测试 **1 处**

**结论：Mongoose 可执行代码彻底清零** —— `.aggregate(` 0、`new Types.ObjectId` 可执行 0、
`.lean(` / `.populate(` 仅注释、`$match` / `$lookup` 31 处全在注释。
类型/索引/命名也干净：`simple-json` 0、裸 `timestamp` 0、jsonb 17 处全是真 schema-less 载荷、
unique 索引实体 25 = migration 25（**0 处只写 entity 不写 migration**）。查询层质量最高：
5 处 populate → 相关子查询/JOIN、`$group` → CTE 全部参数化，6 处手写 SQL 全 `query(sql, params)`，无注入面。

**但 list 入参仍是 Mongo `find(filter)` 的直系后代**：
1. **P1** 三槽位 `required: false` ⇒ 验证器只 push `Allow()`，不下钻
   （`object.validator.ts:26-28`）⇒ `sortOnlyIn` 白名单、`pageSize max:9999`、字段级 uuid/number 校验
   **全部只存在于 swagger**。`list.dto.ts:51-55` 自己写明了这个缺口
2. **P1** `pg-list.builder` 按 `typeof value` 选算子（`:87-113`）而非列类型：uuid(61 列) / timestamptz(58 列) /
   integer(26 列) 收到字符串就生成 ILIKE ⇒ PG 42883 ⇒ **500**。Lead 实测证实，且数字数组会被判成日期区间
3. seed 真源仍是 Mongo EJSON：`$oid` 4416 + `$date` 4444，`ejson.ts` 是 live 代码，
   中间 938 行 `seed-map.ts` 做 `_id → uuid5`；加列必须同步改映射，**没有门禁**
4. 两个命名刺眼点：`/system/locale/list` 的 `id` 是 locale key 不是 uuid（`$group._id` 直译）；
   `roles_list` / `roles_count` 是 mongoose virtual 键名原封不动（已进 openapi + schema.d.ts + 前端 6 处 + 测试 5 处）
5. 订正上一轮评审：`code-quality.md:216`「sortOnlyIn 各模块声明、未发现不一致」——
   把「声明」当成了「生效」

---

## 03 · packages 层边界与下沉（含 34 库归属）

- **口径纠正**：libs 实际 **34** 个（不是 35）；38854 行含 spec / 36533 行源码
- **32/34 个库 import `@nestjs/*`**；零 Nest 的只有 `const` 与 `list`（后者绑 class-validator）
- platform-any 必要：contract 被 **252 个源文件**消费（server 190 / admin 52）；utils 32（server 4）；
  types 100 行、server **0**（admin-only）
- platform-web 差异极大：client **84** / http **10** / api-types **79–80** / **ui 只有 2–3**
- `@walnut/ui` 是**半迁移残骸 + 活的现网缺陷**：`componentMap.ts:56` 仍从 admin 目录动态 import，
  3 个目录已不在 admin 下 ⇒ 3 个 `Base:` 表单类型运行时断裂。历史提案 C1(P0) 至今未修
- `pnpm boundaries` =「Checked 4600 files in 16 packages, no issues found」，但 4 条规则里 **2 条空转**；
  `platform-node` 规则的唯一 subject 是 `apps/server`（与 `backend` 等价）；
  **`frontend` 没有任何规则** ⇒ 将来建 Node 包时 admin 可偷 import 且不会红（修 3 行）
- 双模构建与文档不同：后端靠 `main`/`types` 顶层字段（node10），类型走 src、运行时走 dist；
  server 产物 **108** 个 js require `@walnut/contract`、3 个 require `@walnut/utils` ⇒ CJS 不能删；
  但 contract dist 61 文件里 **25 个是 10 字节 `export{}`** 死 d.ts，`easy-fns-ts` 11 处全是 import type（误标 runtime 依赖）
- 历史提案对账（`aa5670f2`）：13 候选里 **C2/C3/C4 全未做**，C5/C8 未做，C9–C13「不做」仍成立；
  `architecture.md` 两处过期（http→client 依赖其实不存在；两个 README 链接是死的）

> **本报告原推荐「不建 platform-node」已被决策推翻**（见 [07](./07-decisions.md) D4）：
> 用户指出该下沉的是"业务无关的后端基建"，且 D3=A 之后出现了真实的第二消费方（worker）。
> 保留本节是为了留下当时的证据与顾虑清单（4 个顾虑的处置见 07 的 D4）。

---

## 03b · platform-web 逐包消费审计

**度量口径**：**250 个导出 / 123 个被外部真实消费（49%）/ 20 仅包内 / 107 死**。

| 包 | 行数 | 消费率 | 判定 |
|----|-----:|------:|------|
| api-types | 15,912 | **81%** | 保留 —— 但它是 **codegen 产物**，不是「抽离」 |
| client | 2,051 | 44% | 保留并收缩（桶 54 条全死） |
| http | 725 | 23% | 保留并收口（机制层切得对） |
| ui | 88 | 25% | **删除 / 冻结**（决策取删除） |

- **三个桶入口消费量 = 0**：202 条导入里 78 条是 `@walnut/api-types` 裸包名，124 条全是深层子路径；
  `@walnut/client`(54) / `http`(15) / `ui`(6) 的裸包名导入**一条都没有** ⇒ 75 个桶导出全死。
  这否定了 ADR 0013「包入口用 barrel」在本仓的前提（其立论是"给外部消费者稳定路径"，本仓无外部消费者）
- **ui 抽包断裂（P0）**：见 03 的同一条
- **http 与 client 不是「两套并存」**：机制在包（725 行）/ 策略在 admin（559 行），全仓仅 1 个 `AppAxios`、
  0 处 `axios.create`。真正并存的是**类型层**：分页类型 8 个 admin 文件直连 contract、2 个仍走 `http/types.ts` 包装
- **client 消费率 44% 但耦合极少**：`@/` 别名 0 处、admin 类型引用 0 处、业务耦合只有 `mockListApi`(19 行)
  + `_v: version` 死字段（写进用户存储格式、包内无人读）
- **api-types 不是「抽离」是 codegen**：78 文件独占消费、81% 消费率、12 死导出。
  门禁硬发现：**CI 无 `ENV_KEYS` 时只打 notice 跳过**（`ci.yml:379-381`）⇒ fork PR 漂移可静默合入
- 边界做对的范例：deep-ref / object-key 纯类型原语在 any、Vue 依赖层在 web 且 web→any 导入；
  做错的只有 4 处「纯函数留在 web」（`getBoolean` 5 处消费等，约 40 行），非结构性

---

## 04 · server libs 与 apps 三包架构

| 维度 | 实测 |
|---|---|
| 库数 | **34**（任务书 35 是错的） |
| 分层 | ADR 0022 六层 ≡ `eslint.config.ts:9-18` ≡ 磁盘；1481 条 import **0 条向上层边**；唯一跨层例外 `exceptions→blpath` 是 ADR 明文放行 |
| 循环 | madge 实跑 **1008 文件 0 环**（18 skipped 全是 `@walnut/contract|utils` 外部子路径）；但 madge **不在 prepush 门禁里** |

**P0 = 0 条**（架构线的三维都健康）。5 条 P1：
1. **注册面成本**：加 1 个 lib 要手工改 **7 个面 / 9 个文件约 19 行**（tsconfig paths、3×nest filenames/projects、
   3×swcrc、3×tsconfig.app include、eslint 名单），靠 712 行 drift spec 兜底；三份 nest 配置 431/431/432 行只差 20 行
2. `libs/cache` 住了 **8 个领域形状缓存**（cap/mfa/opaque/sign/verifyCode/device/permissions/appSettings）
   = 技术层知道上层领域；cache 被 **10 个库**依赖（全 libs 最高）
3. **分布式锁两套**（自研 `cache.cron-lock` 174 行 vs murlock），且 **10 处直接 import MurLockService**
   绕过 `libs/lock`（换实现要改 10 文件）
4. `libs/delay` 是**死库**（唯一引用 `shared.module.ts:5`，服务零注入）
5. **worker 无生产部署面**（Dockerfile 只 api CMD；`deploy/` 与 CI grep worker = 0 命中）；
   cli 则被 CI 真用（`ci.yml:372` migration、`:300/355` openapi）
   > 这条被用户纠正过表述：worker **本地能跑**，缺的是生产编排。见 [06](./06-cross-check.md) §二

其他：libs **23/34 零测试**（libs 24 spec / 2999 行 vs api/test 63 spec / 20028 行 = 6.2%）；
8 个单文件级库共 395 行 / 25 文件（delay 死、context+als 两套 ALS、blpath 30 行 Set、scope-resolver 单消费者）；
9/34 有 README 且 2 篇过期；`libs/types` 全仓 10 处引用**全是注释**、3 处指向不存在的文件；
`apps/api/src/public/` = 132 文件 **5.32MB**（tinymce 125 文件 4.08MB）进 git 与镜像。

---

## 05 · 联网调研（8 主题 / 30 个一手来源）

- **最硬的「文档已过期」**：`adr/zod-evaluation.md:14` 称「Zod 需自定义 Pipe」——但本地实测
  `@nestjs/common@12.3.2` **自带** `pipes/standard-schema-validation.pipe.d.ts`，官方 validation 章明确
  两个 pipe 可共存、可增量采纳；`:17` 的「zod 0 使用」也不成立（`apps/admin` 已用 zod 4 做 env 校验）。
  `architecture-todo.md:78` 已改口但 ADR 未回写 ⇒ 文档内部不一致
- **列表 API 是 Mongo 语义遗留**：操作符由「值的类型」隐式决定（`pg-list.builder.ts:87-113`）；
  契约里没有 `!=` / `>=` / `IS NULL` / `OR` 可用；sort 白名单默认 = DTO 全部字段且嵌套校验没开。
  改造面意外地小：19–21 个 list 端点 + 前端 1 个构造点（`useTableAPIListParams.ts`）+ 16 个 `.vue`
- **排序不稳定**：默认只有 `createdAt DESC`，offset 分页下同毫秒行顺序不定 = 翻页漏/重行。
  业界最小修法是加 `id` tiebreaker（AIP-158）
- **边界姿态是 deny-list**（turbo 4 条 deny + ESLint 按层 deny + 未登记 fail-closed），Nx 官方是 allow-list；
  同层互引无判据；本仓无 dependency-cruiser / eslint-plugin-boundaries（只有 knip + madge）
- **契约包职责外溢**：`@walnut/contract`（21 文件 856 行）里有 `BaseListParams<T>.query?: T`，
  把 ORM 实体形状抬进跨端契约；响应类型同时存在「手写」与「openapi.json → api-types 生成」两个真源
- **「Repository 三模式」是本仓发明**（业界是 Repository / Query Object / Unit of Work 三**职责**，不是三类）；
  TypeORM 官方：大应用用 Data Mapper、事务内必须 `manager.withRepository`（与本仓 `em` 透传等价）
- **发包判据**：内部包 vs 可发布包是成本阶梯；`workspace:*` 在 publish 时被改写成真实版本
  ⇒ 34 个 server lib 保持不发包是对的，但「仓外消费者出现才评估」应写成 ADR 判据

---

## 丢失的原始证据（待重出时补齐）

- 01 的「109 个导出逐个核验表」与 key 级下钻
- 02 的「全量 list 接口清单表」与「mongo 残留模式清单（全量）」
- 03 的「34 库归属评分表」与 13 候选逐条对账
- 03b 的「107 个死导出分布」与「两套并存清单（5 条）」
- 04 的「34 库全量体检表」与 15 项删除合并候选
- 六份各自的可复跑命令附录
