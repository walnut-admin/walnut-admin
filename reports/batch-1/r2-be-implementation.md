# R2 后端实施 · 批次 1（P0 止血）

> 基线：HEAD `190a4c5d`。本轮的改动**只在 `apps/server/` 内**，未触碰前端 / docs / 根配置。
> **未 git commit**（按 Lead 要求）。依据 R1 实测报告 `reports/batch-1/r1-be-verification.md`。
>
> ⚠️ 工作树里还有**其他成员/其他批次**的改动（`apps/admin`、`apps/docs`、`packages/*`、
> 根 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`，以及 `packages/platform-web/ui/*` 的删除）。
> 那些**不是本轮产物**，我没有触碰它们；Lead 提交时请按路径分割。

---

## 0. 交付摘要 + 门禁

| 门禁 | 命令 | 结果 |
|------|------|------|
| 单测 | `pnpm --filter @walnut/server test` | ✅ **79 files / 665 tests passed**（exit 0） |
| 类型 | `pnpm types:check`（cwd `apps/server`） | ✅ exit 0（`tsc --noEmit` 无输出） |
| Lint | `pnpm lint`（cwd `apps/server`） | ✅ exit 0（0 error / 0 warning） |
| OpenAPI | `pnpm --filter @walnut/server openapi:export` → `git diff --stat apps/server/openapi.json` | ✅ **零 diff**（220 schemas，`schema.d.ts` 同样零 diff） |
| 边界 | `pnpm boundaries` | ✅ `Checked 4645 files in 15 packages, no issues found` |

改动量：`apps/server` 内 **22 个文件**（21 改 1 增）+ 4 个新 spec + 2 个新模块文件，`402 insertions / 137 deletions` 之外主要为新文件。

---

## 1. 改动清单

### 1.1 新增：单一真源

| 文件 | 作用 |
|------|------|
| `libs/repository/src/pg-column-op.ts`（新） | **列类型 → 算子集合 + 值解释**的唯一实现：`classifyPgColumn` / `resolvePgListCondition` / `isPgListOpAllowed` / `createPgColumnKindResolver` / `defaultPgListSort` / `normalizeSortOrder` / `escapeLikePattern` / `warnDroppedPgListCondition` |
| `libs/utils/src/list-page.ts`（新） | **分页正规化**的唯一实现：`normalizeListPage` + `WALNUT_LIST_PAGE_SIZE_MAX/DEFAULT`、`WALNUT_LIST_PAGE_DEFAULT` |

**为什么分页不放进 `repository`**（分层硬约束，改前必读）：分页上限被三条链路消费，而它们在不同层 ——
`repository`（tech-assemble，DB 列表）· `app-domain/logger`（最高层，内存 slice）·
`cache`（**tech-base**，Redis key 内存 slice）。ADR 0022 的分层是"上层 import 下层"，
tech-base 反向依赖 tech-assemble 即违规，所以常量必须落在两者共同的下层 →
`@walnut-server/utils/list-page`（基建层）。`repository` 再把它 re-export 出去，业务侧仍只认一个导入点。

### 1.2 改写：builder

| 文件 | 改动 |
|------|------|
| `libs/repository/src/pg-list.builder.ts` | `buildPgListQueryOptions` 增加 `resolveKind` + `metadata` 参数（缺省仍走旧 typeof 路径以兼容，但**带上 `raw` 供 SQL 层重裁决**）；新增 `buildPgListQueryOptionsFromQb`（库内标准写法）；`applyPgListQuery` 变成**权威裁决点**（按列元数据 + `raw` 重新解释，不兼容就不生成 SQL）；sort 白名单收敛 + 方向归一 + 兜底排序；page 走 `normalizeListPage` |
| `libs/repository/src/index.ts` | 导出面：新增 `pg-column-op` 全套 + `normalizeListPage` / `buildPgListQueryOptionsFromQb` / `IWalnutPgListQueryContext` |

### 1.3 三个消费者接同一实现（任务 1）

| 消费者 | 改法 |
|--------|------|
| `pg-list.builder`（主线） | 见 1.2；且 6 个 `applyPgListQuery(qb, …)` 调用点全部换成 `buildPgListQueryOptionsFromQb(qb, params)`（`pg-base.repository.ts:548`、`identity/user/user.basic.repository.ts:106`、`app-domain/monitor/user/user.basic.repository.ts:50`、`system/role/role.basic.repository.ts:90`、`system/lang/lang.basic.repository.ts:51`、`system/dict/dictType/dictType.basic.repository.ts:44`） | 
| `system/src/locale/repo/locale.repo.service.ts` | 删掉自写的 `op === 'ilike' / 'eq' / 'range'` 分派（原 :93-117），改由 `buildPgListQueryOptions(params, {}, resolver, metadata)` 产出**已裁决**的 `match`，再按 `MATCH_COLUMN_MAP` 落 SQL；`IN` 分支补上（旧实现漏了）；`LIMIT/OFFSET` 改用 `normalizeListPage`（不再裸插 `Number()`）；sort 保留自家 `SORT_ALIAS_MAP`（`process` 是聚合别名，不是实体列）但方向归一与 builder 共用 |
| `system/src/deleted/deleted.basic.repository.ts` | 主线换 `buildPgListQueryOptionsFromQb`；`content` 的 `::text ILIKE` 旁路保留（jsonb 转文本后 ILIKE 合法），但转义改走 `escapeLikePattern` |

顺带：`app-domain/monitor/user` 的 populate 字段 ILIKE、以及**第 4 处**内联转义
`system/src/device/device.service.ts:174`（`location_info->>'country/region/city'`）也改走
`escapeLikePattern` —— 现在全仓只有 `pg-column-op.ts` 一处定义 ILIKE 字面量转义。

### 1.4 sort 的两个同源缺陷（任务 2）

| 缺陷（R1 §4 实测） | 修法 |
|-------------------|------|
| 未知 `field` ⇒ 默认排序被**整体清空** ⇒ SQL 无 ORDER BY ⇒ 翻页重复/丢行 | `build` 侧：sort 项先过 `isPgSortableColumnKind` 过滤，**一件都不剩时回落 `defaultPgListSort(metadata)`**（`createdAt` → `deletedAt` → 主键）。`apply` 侧再兜一层：一个 `addOrderBy` 都没落下时补默认排序 |
| `order: "ASC"` 被静默当 DESC | `normalizeSortOrder`：`ascend/asc/ASC/Asc` → ASC，`descend/desc/DESC` → DESC，`false` → 不排序，其它 → 丢弃 |

> **默认排序变了 2 处**（R3 P2-1 更正：初版只登记了 deleted）：
> - `SysDeletedEntity` 没有 `createdAt`（只有 `deletedAt`）→ `deleted_at DESC`；
> - `AppMonitorUserEntity` 没有 `createdAt`（只有 `firstVisitAt`/`lastActiveAt`）→ **`id DESC`**（uuid，稳定但业务无意义）。
>
> 其余 15 个 DB list 端点都有 `createdAt`，排序不变。两处现已在代码里显式登记
> （`libs/repository/src/pg-column-op.ts` 的 `defaultPgListSort` 注释有对照表）。

### 1.5 page 双落点（任务 3）

| 落点 | 改动 |
|------|------|
| builder | `buildPgListQueryOptions` 里 `normalizeListPage(page)` → `skip/limit` 直接取正规化结果；`options.pageAdjusted` 暴露"是否被改写" |
| `app-domain/logger/logger.service.ts:53` | `const { page, pageSize } = normalizeListPage(params.page)`（本链路不走 SQL，pageSize 直接进内存 slice） |
| `cache/src/cache.service.ts:30-32,507,549` | `myPaginate` 内 `normalizeListPage({page,pageSize})` 后再 slice；list 日志也打印正规化后的值 |

**没有动** `@Type` / `default` 那套分页装饰器（R1 已证明它是对的：半传 page 会被逐字段补默认值）。

### 1.6 校验层（任务 4）

| 文件 | 改动 |
|------|------|
| `libs/types/.../decorators/object.d.ts` | `IWalnutAdminDecoratorValidatorObjectOptions` 新增 `nestedWhenPresent?: boolean` |
| `libs/types/.../decorators/enum.d.ts` | `IWalnutAdminDecoratorValidatorEnumOptions` 新增 `allowFalseValue?: boolean` |
| `libs/decorators/src/validator/base/object.validator.ts` | `required:false` + `nestedWhenPresent` ⇒ 追加 `IsOptional + IsObject + ValidateNested`（**不加 `IsNotEmptyObject`**，`query:{}`/`sort:[]` 是合法调用） |
| `libs/decorators/src/validator/base/enum.validator.ts` | `allowFalseValue` ⇒ `ValidateIf((_o,v) => v !== false)` 放行 `false`，其余值仍走枚举 |
| `libs/decorators/src/transformer/common/default.ts` | 新增可选 `obj` 参数：默认值若是**裸对象**就实例化成 DTO。**这是必须的**——否则缺省时 `page` 停在 plain object，`ValidateNested` 只会报 `unknownValue`（`forbidUnknownValues`），"什么都没传"反而 400 |
| `libs/list/src/list.dto.ts` | `sort` / `page` 两槽位挂 `nestedWhenPresent: true`；`order` 挂 `allowFalseValue: true`。**`query` 槽位刻意不挂**（见 §3） |
| `libs/app-domain/logger/dto/logger.dto.ts` | 补 `sortOnlyIn: ['fileName','logType','fileMTime']`（原来缺省回退成 `RealPickType(AppLoggerDTO,['fileName','logType'])` 的键集，打开校验后 `fileMTime` 排序会 400 —— api-spec 正在用） |

---

## 2. 矩阵用例结果：R1 的 22 个报错格是否全绿

用例在 `libs/repository/src/pg-column-op.spec.ts`（71 tests）。断言的不是"某格产出什么算子"，
而是**不变式**：要么返回与列类型兼容的条件，要么返回 undefined（丢弃），**永不抛**。

| R1 的 30 格（6 列类型 × 5 形态） | R2 后的落点 |
|--------------------------------|------------|
| 8 格原本就成功（text 全形态 + uuid/boolean/jsonb/数值 的部分合法组合） | 仍成功 |
| **22 格报错** | **21 格 → 丢弃 + warn**；**1 格 → 正确解释**（timestamptz 收到标量日期字符串 `"2024-01-01"`，旧实现 42883，现在生成 `created_at = $1`） |

用例矩阵比 R1 更大：**39 格**（补了 jsonb 对象值、`text[]` 数组列两类），其中
**24 格断言"必须丢弃"、15 格断言"必须产出兼容条件"**，全部通过。另有三条专门的不变式用例：

~~~text
✓ 不变式：任意 kind × 任意值都不抛，且返回的条件恒与列类型兼容（7 kinds × 24 值 = 168 组合）
✓ datetime 只认 Date / 可解析字符串 —— 数字必须拒（R1 坑 3：[1,2] 不再变 1970 区间）
✓ text 的 ilike 只对字符串生成；数字/布尔走等值
~~~

`libs/repository/src/pg-list.builder.spec.ts`（33 tests）用**结构化 fake qb**（零 DB）覆盖：
值→条件、sort 默认排序保留、`order:false`、大写/别名方向、`pageAdjusted`、
apply 的权威裁决（旧 typeof 路径产出的 `ilike` 打 uuid 列会被 SQL 层丢掉）、
注入串（`id; DROP TABLE sys_user` / `devicename) OR 1=1--`）不生成任何 SQL。

---

## 3. 校验层的关键取舍：`query` **没有**开嵌套校验（有实测证据）

任务 4 要求"打开三槽位校验"。我把三槽位都打开后跑了
`apps/api/src/common/list-request-validation.spec.ts`（把 R1 从 20 个 api-spec 抄出来的
**真实请求体**逐条过一遍 ValidationPipe 等价校验 `whitelist + forbidNonWhitelisted`）——
**9 条请求体变 400，分布在 7 个端点上**（R3 复核口径：按请求体 9 条、按端点 7 个）：

> **R3 更正（2026-11-02）**：本节初版写「20 个里 9 个变 400」，并列出 9 个端点 ——
> 那个表有两行**已经过期**（它是 `default.ts` 实例化修复**之前**的状态）：
> `POST /system/deleted/list`（原报 `deletedAt` range）与 `POST /system/dept/list`（原报 `unknownValue`）
> 修复后**都已 PASS**。`/app/logger/list` 与 `/app/monitor/user/list` 各有 2 条请求体失败，
> 所以是 **9 条请求体 / 7 个端点**。R3 已独立复现（`FAILED=9/25`）。下表为更正后的实测清单。

| 端点（失败请求体条数） | 失败的约束 | 原因 |
|------|-----------|------|
| `POST /app/logger/list`（2 条） | `fileName` `isString/isNotEmpty`、`logType` `isEnum/isNotEmpty` | query 基座是 `RealPickType(AppLoggerDTO,…)`（**不是** RealPartialType），字段是必填 |
| `POST /app/monitor/user/list`（2 条：带 visitorId / 空 query） | `ip` `isString/isNotEmpty` | 同上（必填） |
| `POST /app/setting/list`（1 条） | `settingType` `isEnum/isNotEmpty/isArray` | `AppSettingDTOSafeRequest` 的数组字段必填 |
| `POST /system/dict/data/list`（1 条） | `tagType` `isEnum/isNotEmpty/isArray` | 同上 |
| `POST /system/log/auth/list`（1 条） | `type` `isEnum/isNotEmpty/isArray` | `type: string[]` 必填 |
| `POST /system/log/operate/list`（1 条） | `operatedAt` `isDateString/isNotEmpty/isArray` | 时间区间字段必填 |
| `POST /app/demo/list`（1 条） | `demoString` `isUppercase`（值域约束） | 过滤值本不该被"创建语义"的值域约束管 |
| ~~`POST /system/deleted/list`~~ | ~~`deletedAt` range~~ | **R3 更正：现在 PASS**（该请求体本就没传区间；且 `default.ts` 已修掉裸对象问题） |
| ~~`POST /system/dept/list`~~ | ~~`unknownValue`~~ | **R3 更正：现在 PASS**（`default.ts` 实例化修复后不再报裸对象） |

**结论**：query 的基座是"实体 DTO 的 partial 派生"，它同时带着**必填**字段与**创建语义的值域**约束，
而过滤条件天然逐字段可缺省 —— 两者冲突。要开就得先重写约 8 个 query 基座 DTO（并会改 openapi 的
`required` → 违 "openapi 零 diff"），属于**批次 4「显式 filters 契约」**的范围；
Lead 拍板的 Q1 也正是"严格 400 留到批次 4"。

**所以本批的实际口径**：
- `sort` / `page` 两槽位 **已开**嵌套校验（这两个槽位的形状完全由我们控制，且现有调用全绿）；
- `query` 仍只 `Allow()`（`list.dto.ts` 里留了**长注释**说明原因 + 指向本报告与证据 spec）；
- query 的 P0（500）由 `pg-column-op` 的列类型分派兜住 —— **这条不依赖 DTO 校验**，且已实测覆盖 R1 全部 22 格。

**同时生效的新校验（R1 里"只进 swagger"的三条现在真的拦得住）**：

~~~text
✓ page 越界/非整数会被 pageSize 的 max:int 拦住（用例：pageSize=99999 → 报 pageSize）
✓ sort.field 白名单真正生效（用例：field='ip' → 报 field/isIn）
✓ sort[].order = false 仍被接受（allowFalseValue 生效；用法与 contract/pagination.ts:8 一致）
✓ page 缺省 / 空 sort / query:{} / page:{} 仍合法（default 裸对象已实例化，不会 unknownValue）
~~~

---

## 4. 没做的与原因

| 项 | 为什么没做 |
|----|-----------|
| **query 槽位的严格 400 校验** | §3：**9 条请求体 / 7 个端点**会 400（R3 更正口径）；需先重写 8 个 query 基座 DTO + 会改 openapi `required`。归批次 4 |
| **Q3：JOIN 放大导致 total 不准** | Lead 拍板记 P2，本轮不做。`deleted` / `monitor/user` 的 1:1 假设仍只有注释，没有"JOIN 侧 0/2 行时 total 不变"的用例 |
| `AppLoggerService.list` 忽略 `sort`（恒按 fileMTime desc） | 既有行为，不属 P0；只补了 `sortOnlyIn` 让契约不 400。改排序语义需产品确认 |
| `locale` 的 `id` = 分组 key（非 uuid） | R1 §3.3 的建议（改 `groupKey`）是契约变更，需拍板；本轮只保证它不 500 |
| 全链路 HTTP 级回归（api-spec / int-spec） | 需要 integration 库 + Redis（`vitest.config.integration.ts` 会 drop 重建库）。本轮用 **DTO 级回归 spec**（20 个真实请求体）替代；真实 HTTP 全链留给 R3 / CI |

---

## 5. 一个非显然的连带修复（R3 必看）

`libs/decorators/src/transformer/common/default.ts` 现在会把**对象型字段的默认值实例化成 DTO**。

- 触发条件：`obj !== Object` 且 `defaultTransform` 为真（list 的 `page` / `query` 都是）。
- 为什么必须：缺省时 `@Type()` 不实例化（只在"值存在"时跑），字段停在 `cloneDeep(default)` 的
  **裸对象**上；一旦挂 `ValidateNested`，class-validator 对非实例对象只报 `unknownValue`。
- 踩过的坑：一开始我外挂了一个 `@Transform` 做实例化，**没生效** —— class-transformer 对同一属性上
  多个 `@Transform` 的实际执行序与注册序**相反**，外挂那个在默认值填充之前就跑完了（拿到 undefined）。
  最终把实例化做进默认值填充函数内部（`default.ts` 注释里记了这件事）。
- 影响面：所有"对象型 + 有默认值 + 开 defaultTransform"的字段（不止 list）。语义上是**更正确**的
  （字段的静态类型就是那个 DTO），但 R3 值得确认没有别处依赖"默认值是裸对象"。

---

## 6. R3 应重点复查的 3 件事

1. **`applyPgListQuery` 的权威裁决边界**。它用 `condition.raw` 重裁决；**没有 `raw` 的外部 match**
   （手写构造）只按 `op × kind` 判兼容性，值本身仍由调用方负责。要复查：① 除了 6 个已知调用点，
   有没有新代码直接构造 `IWalnutPgListQueryOptions.match`；② `locale` 那条手写 SQL 是否真的
   只消费裁决后的 `match`（它现在仍自己 `bind`，所以"值"的安全由 `resolvePgListCondition` 保证）。
2. **默认排序的变化会不会改变可见顺序**。`deleted`（无 `createdAt`）从"无 ORDER BY"变成
   `deleted_at DESC`；`defaultPgListSort` 对每个实体都可能退到主键。要复查：
   `apps/api/test/api/*.api-spec.ts` 里断言 `data[0]` 的用例（尤其 `deleted` / `log-operate`）
   在真实数据顺序下是否仍成立 —— 这是本轮**唯一**可能改变响应顺序的改动。
3. **`query` 未开嵌套的取舍要随批次 4 收口**。`list.dto.ts` 里的注释是唯一的"为什么不开"；
   批次 4 做显式 filters 契约时，应该把这 8 个 query 基座 DTO 改成全可选（`RealPartialType`
   或专用 filter DTO），再开 `nestedWhenPresent`，并同步更新
   `apps/api/src/common/list-request-validation.spec.ts`（它现在是"开之前必须先绿"的闸）。
   另外复查 `object.validator.ts` 的新选项默认值是 `false`（`required:false` 仍是只 `Allow()`），
   别处没有误用。

---

## 附：复跑命令

~~~powershell
# 单测（本轮新增 4 个 spec：pg-column-op / pg-list.builder / list-page / list-request-validation）
cmd /c "pnpm --filter @walnut/server test"

# 只跑新增
cd apps/server
cmd /c "pnpm vitest run --config ./apps/api/vitest.config.ts libs/repository libs/utils/src/list-page.spec.ts apps/api/src/common/list-request-validation.spec.ts"

# 类型 / lint / 边界
cmd /c "pnpm types:check"
cmd /c "pnpm lint"
cd ../.. && cmd /c "pnpm boundaries"

# openapi 零 diff 校验
cmd /c "pnpm --filter @walnut/server openapi:export"
git diff --stat -- apps/server/openapi.json packages/platform-web/api-types/src/schema.d.ts
~~~
