# R1 wire · 批次 4-A：list 契约换显式 `filters`（D2 段②）

> 基线：HEAD `e4e400c6`（比任务书写的 `efe65493` 前进了一批：批次 2/3 已落，含 worker 真接线、
> platform-node POC 否决、CAP P1 修复；`packages/platform-web/api-types` 已由并行批次挪到
> `packages/generated/api-types`）。工作树**非独占** —— 期间有并行的 TinyMCE 搬迁 / client 加密
> 重构 / api-types 挪位同批进行，所以本报告只登记**本批改动的那批文件**。
> 未 git commit。

---

## 0. 结论速览

| # | 判据 | 结果 |
|---|------|------|
| 1 | 契约里不再有 `query?: T`（ORM 实体形状） | ✅ `pagination.ts` 换成 `filters?: FilterParam[]` |
| 2 | op 显式、可用性由列类型决定 | ✅ 唯一裁决点 `resolvePgFilterCondition` |
| 3 | 非法 op/值 → **40099**，不是丢弃 | ✅ DTO 枚举 + 列类型裁决两层都抛 40099 |
| 4 | 丢弃逻辑保留为兼容兜底 | ✅ 旧 `query` 入参在 builder 里仍走「丢弃 + warn」 |
| 5 | 默认排序追加 `id` 兜底（D15） | ✅ `withPgListTiebreaker`，幂等 |
| 6 | R1 矩阵 22 个报错格永不 50000 | ✅ 22/22 变 40099（逐格表见 §4） |
| 7 | 20 个 list 端点各有一条 api-spec 覆盖新旧映射 | ✅ 新增 `list-filters.api-spec.ts`（76 条） |
| 8 | server test / types:check / lint / boundaries / admin build | ✅ 全绿（见 §7） |

---

## 1. 契约（`@walnut/contract`）

`packages/platform-any/contract/src/pagination.ts`

```ts
export const FilterOpValues = {
  EQ: 'eq', LIKE: 'like', IN: 'in', RANGE: 'range', IS_NULL: 'isNull',
} as const

export type FilterOp = typeof FilterOpValues[keyof typeof FilterOpValues]

export interface FilterParam {
  field: string
  op: FilterOp
  value?: unknown
}

export interface BaseListParams<T = any> {
  filters?: BaseFilterParams   // ← 取代原来的 query?: T
  sort?: BaseSortParams<T>
  page?: BasePageParams
}
```

- `query?: T` **删除**（breaking，用户已批准）：契约不再承载任何实体形状。
- `op` 是跨端共享的 wire 词汇（`eq|like|in|range|isNull`），由快照测试 `filter op values never change silently` 钉住（`src/index.test.ts:104`）。
- 同步面：`src/index.ts:25-35`（barrel，drift 门禁要求每个声明导出都进 barrel）、
  `packages/platform-web/http/src/types.ts:6` 与 `src/index.ts:13-23`（`@walnut/http` 的 re-export）。
- 快照 diff：`src/__snapshots__/index.test.ts.snap` 新增 `FilterOpValues` 一条 + `public API surface` 加一个键。

## 2. 后端实现

### 2.1 DTO 工厂：`query` 槽位 → `filters` 槽位

`apps/server/libs/list/src/list.dto.ts`

| 位置 | 内容 |
|------|------|
| `:121` | 新增 `class FilterDTO { field, op, value }`（`op` 用 `WalnutAdminDecoratorFieldEnum(FilterOpValues)`，`value` 用新装饰器 `WalnutAdminDecoratorFieldAny`） |
| `:151-171` | `filters` 槽位：`isArray: true` + `validateOptions: { required: false, nestedWhenPresent: true }` —— **可缺省 / 空数组都合法，给了就下钻** |
| 原 `query` 槽位 | **删除**。因此旧请求体里的 `query` 会被全局 `forbidNonWhitelisted` 直接拒成 **40099**（破坏性变更必须响亮） |

`field` 为什么不挂白名单：过滤面 ≠ 实体 DTO 属性面（`deleted` 的 `content` jsonb 旁路、`monitor/user` 的
JOIN 别名 `ip/os/browser/userName`、`device` 的 `location` 三字段 OR、`locale` 的 `value/langId` 文档级过滤
全都在实体 DTO 之外）。用 DTO 属性当白名单会把这几条端点直接 400 —— 理由写进 `:51-69` 的选项注释里。
列的可见面仍由 SQL 层（实体元数据）与各旁路的 MATCH 表收敛。

### 2.2 新值装饰器

`apps/server/libs/decorators/src/field/any.decorator.ts`

- `WalnutAdminDecoratorFieldAny`：只 `Expose()` + `Allow()`，**不做类型校验**（形态由 `op` 决定，字段级表达不了这种分叉）；
- swagger 显式给 `oneOf` 五形态，避免插件按 `design:type` 猜成 `object`（猜成 object 会让生成物把 `value` 收窄成 `Record<string, unknown>`，`value: 'abc'` 直接类型错误）。
- 选项类型 `apps/server/libs/types/src/walnut-admin/decorators/any.d.ts`；barrel：`field/index.ts:1`。

### 2.3 纯形状工具：`apps/server/libs/list/src/list.filters.ts`

`getFilter` / `getFilterValue` / `omitFilters` / `pickFilters` —— 库内 5 处「某字段走旁路」的消费者用它摘字段
（`deleted` 的 content、`device` 的 location、`locale` 的 value/langId、`logger` 的 fileName/logType、
`monitor/user` 的 5 个 JOIN 别名键）。

### 2.4 裁决点：`apps/server/libs/repository/src/pg-column-op.ts`

| 函数 | 行 | 作用 |
|------|----|------|
| `WalnutPgFilterOp` | `:68` | wire 算子集（与 contract 的 `FilterOp` 同集） |
| `isWalnutPgFilterOp` | `:423` | 类型守卫（直接调用方没有 DTO 校验，必须自己拦） |
| `toPgListConditionOp` | `:428` | wire `like` → 内部 `ilike` |
| `resolvePgFilterCondition` | `:519` | **唯一裁决点**：`(op, 列类型, value)` → 条件 或 拒绝理由 |
| `withPgListTiebreaker` | `:602` | D15 主键兜底（幂等） |

裁决表（`ok` = 生成条件，`40099` = 拒绝）：

| op | text | uuid | datetime | boolean | number | json(b) | array |
|----|------|------|----------|---------|--------|---------|-------|
| `eq` | ok（标量） | ok（uuid 串，小写化） | ok（Date/可解析串） | ok（bool 或 "true"/"false"） | ok（有限数/数字串） | ok（对象/数/布尔） | 40099 |
| `like` | ok | 40099 | 40099 | 40099 | 40099 | 40099 | 40099 |
| `in` | ok | ok | ok | ok | ok | 40099（歧义） | 40099 |
| `range` | 40099 | 40099 | ok（长度 2、两端可解析） | 40099 | 40099 | 40099 | 40099 |
| `isNull` | ok | ok | ok | ok | ok | ok | ok |

`isNull` 的 `value`：缺省 / `null` / `true` ⇒ `IS NULL`，`false` ⇒ `IS NOT NULL`。

### 2.5 builder：`apps/server/libs/repository/src/pg-list.builder.ts`

| 位置 | 改动 |
|------|------|
| `:55-72` | `IListRequestParams` 增加 `filters?`；`query?` 标 `@deprecated` **仅作兼容兜底**（安全网在 SQL 层的 `condition.raw` 重裁决） |
| `:118-163` | filters 主路径：未知算子/裁决不过 → 收集理由，**一次性抛 `WalnutAdminExceptionRequestDataError`（40099）**；非实体列仍按 `columns.has()` 语义丢弃（过滤面含 JOIN 别名键） |
| `:165-190` | 旧 `query` 路径保留：值 → 旧 typeof 推断 + `raw`，解释不了就 `warnDroppedPgListCondition` 丢弃 |
| `:222-232` | 默认排序先过 `withPgListTiebreaker`（`buildPgListQueryOptions` 返回的 `sort` 本身就含主键） |
| `:286-303` | `applyPgListQuery` **权威裁决**：`condition.filterOp` 存在时按 `(op, 列类型)` 重裁决，不过就抛 40099（外部手塞的 match 也逃不掉） |
| `:305-308` | 新增 `IS NULL` / `IS NOT NULL` 生成 |
| `:352-372` | 排序两步定稿：先按列白名单收敛 → 再追加主键兜底（**未知 field 仍回落默认排序**，语义不变） |

### 2.6 D15 排序兜底

`createdAt` 只到毫秒，同毫秒行在 `ORDER BY created_at DESC` 下顺序不确定，配 `LIMIT/OFFSET` 就是翻页漏行/重行。
现在**任何**查询的最后都有一个主键排序键：

- 方向：沿用最后一个已有排序键的方向（`createdAt DESC` ⇒ `id DESC`；`deviceName ASC` ⇒ `id ASC`）；
- 幂等：主键已在排序里就不动（`build` 与 `apply` 两处都调，不会重复追加）；
- 一个可排序列都没剩时：默认排序（`createdAt`/`deletedAt`/主键）**再追加**主键。

受影响端点（默认排序变了，但都是补齐全序）：除 `sys_deleted`（`deleted_at DESC, id DESC`）与
`app_monitor_user`（本来就是 `id DESC`，不变）外，其余 18 个 DB list 端点都是 `created_at DESC, id DESC`。
`locale`（手写聚合 SQL）另补 `key ASC` 作组内兜底（见 §2.7）。

### 2.7 手写旁路的同步改造

| 文件 | 改动 |
|------|------|
| `apps/server/libs/system/src/deleted/deleted.basic.repository.ts:64-75` | `content` 从 filters 里摘下（`omitFilters`），非字符串 → 40099；其余 filters 进 builder |
| `apps/server/libs/system/src/device/device.service.ts:175-192` | `location` 摘下（jsonb 三字段 OR 旁路），其余 filters 进 builder |
| `apps/server/libs/system/src/locale/locale.service.ts:114-133` | `value` / `langId` 是**文档级**过滤，摘下单独下传；其余进 aggregateList 的列白名单通道 |
| `apps/server/libs/system/src/locale/repo/locale.repo.service.ts:82-93` | 入参类型从 `IWalnutAdminRequestList` 放宽成 `Partial<IListRequestParams>`（它只读 filters/page/sort）；`orderSql` 兜底补 `key ASC` |
| `apps/server/libs/app-domain/src/monitor/user/user.basic.repository.ts:57-68` | 5 个 JOIN 别名键改成 `getFilterValue(params.filters, ...)` |
| `apps/server/libs/app-domain/src/logger/logger.service.ts:54-70` | `fileName` / `logType` 从 filters 取；**形态不对直接 40099**（本链路是文件系统，没有列类型权威） |
| `apps/server/libs/cache/src/cache-list.types.ts` + `cache.service.ts:73-119` | 内存列表面同样改成显式 op（eq/like/in/range/isNull 各自的 JS 语义），不再按 `typeof` 猜 |

### 2.8 新增：`WalnutAdminExceptionRequestDataError` 的两处抛出

- `pg-list.builder.ts:162`（构建期，聚合所有非法条件一次报）；
- `pg-list.builder.ts:298`（SQL 层权威裁决，防外部手塞）。

两者都经全局 handler 落到 `body.code = 40099`（`WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR`），
**HTTP 仍是 200** —— 这就是「永不 50000」的落点。

## 3. 前端实现

### 3.1 设计选择：`query` 留在**界面态**，只在 wire 前翻成 `filters`

任务书写「16 个 `.vue` 的 query 用法」需要逐个改。实测这 16 处全部是 **query 表单模型**的读写
（`queryFormData.value.query = Object.assign(...)`、`:model="apiListParams.query"`），**没有一处直接拼 wire**。
所以本批把 `query` 明确定义成**界面态**（`IWalnutTableListState.query`），只在发请求前经唯一转换函数翻成 `filters`：

```text
界面态 (query bag)  ──toWalnutListParams()──▶  wire (filters: [{field, op, value}])
```

好处是 16 处 `.vue` **零改动**（表单控件绑定面不变），风险集中在一个纯函数里、可单测。
唯一的语义修正见 §3.4。

### 3.2 唯一转换点：`apps/admin/src/utils/table/list-filters.ts`

| 行 | 导出 | 作用 |
|----|------|------|
| `:55` | `buildWalnutListFilter(field, value)` | 单字段 → `{ field, op, value }` |
| `:82` | `buildWalnutListFilters(query)` | 扁平 bag → filters 数组 |
| `:105` | `toWalnutListParams(state)` | `{ query, sort, page }` → contract 的 `BaseListParams`（**唯一 wire 构造点**） |

形态 → 算子（等价于旧后端按 `typeof` 的推断，只是现在显式写进 wire）：

| 值形态 | op | 说明 |
|--------|----|------|
| `undefined` / `null` / `''` / `[]` | （不下发） | 空值不产生条件 |
| 长度 2 且两端都能解析成时间 | `range` | 日期区间控件（`valueFormat: 'yyyy-MM-dd'`）；两端转 ISO |
| 其余数组 | `in` | 多选（字典 / 枚举） |
| uuid 形态字符串 | `eq` | uuid 列只吃等值（`like` 必 40099） |
| 其余字符串 | `like` | 子串模糊（`%` `_` 由后端转义） |
| number / boolean | `eq` | |
| `Date` | `eq` | 转 ISO |
| 其它对象 | （不下发） | 表单不该产生；出现也不猜语义 |

### 3.3 表格参数构造点：`useTableAPIListParams.ts`

`apps/admin/src/components/UI/Table/src/hooks/useTableAPIListParams.ts`

- `:13` 新类型 `IWalnutTableListState<T> = { query: T, sort, page }`（query 是表单模型，**不是 wire**）；
- `:40` 新增 `apiListFilters = computed(() => toWalnutListParams(apiListParams.value))`；
- `:42` 返回 `{ apiListParams, apiListFilters, resetParams, commitParams }`。

调用方改造：

| 文件 | 改动 |
|------|------|
| `apps/admin/src/components/UI/Table/src/hooks/useTableAPI.ts:33,60` | `listApi(apiListParams.value)` → `listApi(apiListFilters.value)` |
| `apps/admin/src/components/UI/Table/src/types.ts:69-75,259` | `onGetApiListParams` / `Context.apiListParams` 的类型改成界面态 `IWalnutTableListState<T>` |
| `apps/admin/src/components/UI/Table/src/types.ts` `Hooks.ListState<T>` | 供 CRUD 层复用 |
| `apps/admin/src/components/Advanced/CRUD/types.ts:80` | `onGetApiListParams: () => Ref<WTable.Hooks.ListState<T>>` |
| `apps/admin/src/components/UI/Table/src/hooks/useTableColumns.tsx:25` | 入参类型跟着改（只读 sort/page） |
| `apps/admin/src/views/system/device/index.vue:42,100` | 自己的 `useState` 改界面态；调 `deviceAPI.list(toWalnutListParams(listParams.value))` |
| `apps/admin/src/components/Advanced/ApiSelect/index.vue:44,91` | 同上（搜索关键字仍在 `query` bag 里） |

### 3.4 顺带修掉的一处活缺陷（`log/auth` 日期过滤字段名写错）

`apps/admin/src/views/system/log/auth/index.vue:105-112`

旧代码把 daterange 的值写进 `query.authenticated`（**布尔列**），而表单路径是 `authenticatedAt`。
后果：日期区间打到布尔列。旧路径实测是 **50000**（R1 矩阵 `boolean ~~* unknown` 的同源格），
新路径会变成 40099 —— 顺手改成写 `authenticatedAt`，所以这格现在是**正确表达**（`range` 打时间列）。

### 3.5 全部 admin 查询表单的字段普查（改完后的 op）

| 页面 | query 表单字段 | 出 wire 的 op |
|------|----------------|---------------|
| `system/user` | userName, nickName | `like` ×2 |
| `system/role` | roleName | `like` |
| `system/dept` | deptCode | `like` |
| `system/post` | postCode | `like` |
| `system/dict`（type） | name, type, description | `like` ×3 |
| `system/dict/detail`（data） | typeId, value, description | `eq`（uuid）+ `like` ×2 |
| `system/lang` | lang | `like` |
| `system/locale` | langId, key, value | `eq`（uuid）+ `like` ×2 |
| `system/menu` | name | `like` |
| `system/employee` | employeeNo | `like` |
| `system/device` | deviceName, location | `like` ×2（location 走 jsonb 旁路） |
| `system/deleted` | content, modelName, collectionName, deletedAt | `like` ×3 + `range` |
| `system/log/auth` | userName, location, ip, authenticatedAt | `like` ×3 + `range` |
| `system/log/operate` | title, userName, ip, operatedAt | `like` ×3 + `range` |
| `app/logger` | fileName | `like` |
| `app/setting` | settingName, settingKey, settingValue | `like` ×3 |
| `app/monitor/cache` | key | `like` |
| `app/monitor/user` | visitorId, ip, country, browser, os, userName | `like` ×6（全走 JOIN 别名旁路） |

结论：**没有一处**会把 `like` 打到 uuid/布尔/时间列（uuid 输入、日期区间、开关都已按上表选对算子）。
唯一例外见 §9 的「status 列筛选」。

## 4. R1 矩阵 22 个报错格的对账

R1（`reports/batch-1/r1-be-verification.md` §1.2）的 30 格里 22 格会生成 PG 错误。逐格对账：

| 行（入参形态） | R1 报错格 | 旧 PG 码 | 新：显式 op 下会发生什么 | 等价且正确的写法 |
|----------------|-----------|----------|---------------------------|------------------|
| 普通字符串 × 非文本列 | id / active / deviceInfo / createdAt / riskScore（5） | 42883 | `{op:'like'}` 打 uuid/boolean/jsonb/timestamptz/smallint ⇒ **40099** | 该列用 `eq`（uuid/布尔/数值/jsonb）或 `range`（时间） |
| uuid 串 × 非 uuid 列 | active / deviceInfo / createdAt / riskScore（4） | 22P02 / 22007 | `{op:'eq', value:'<uuid>'}` 打 boolean/jsonb/tstz/smallint ⇒ **40099** | 布尔用 `eq: true`、时间用 `range`、数值用 `eq: 数值` |
| 数值 × 非数值列 | id / createdAt（2） | 22P02 / 22008 | `eq` 数值打 uuid / tstz ⇒ **40099** | uuid 用 `eq: '<uuid>'`；时间用 `range: ['…','…']` |
| 布尔 × 非布尔列 | id / createdAt / riskScore（3） | 22P02 / 22007 | `eq` 布尔打 uuid / tstz / smallint ⇒ **40099** | 同上 |
| 日期数组 × 非时间列 | id / active / deviceInfo / riskScore（4） | 22P02 | `{op:'range'}` 打非 datetime ⇒ **40099** | 数值多值用 `in`；uuid 多值用 `in` |
| 数值数组 × 非数值列 | id / active / deviceInfo / riskScore（4） | 22P02 | 旧版把 `[1,2]` 误判成日期区间；现在 `range` 打非 datetime ⇒ **40099**，`range: [1,2]` 打时间列也 **40099**（端点必须 Date/可解析串） | 数值用 `in: [1,2]`；时间用 `range: ['2024-01-01','2024-12-31']` |
| **合计** | **22** | | **22/22 全部 40099** | 每格都有显式 op 的合法表达 |

这些组合在单测里逐条钉住：`apps/server/libs/repository/src/pg-list.builder.spec.ts` 的 `REJECTED_FILTERS`
（24 条，覆盖上表全部组合 + `isNull`/`in`/`eq` 的形态边界），断言
`toThrowError(objectContaining({ response: { errCode: 40099 } }))` **且一条 SQL 都不发**（`fake.where` 长度为 0）。

## 5. 逐端点验证结果（`apps/server/apps/api/test/api/list-filters.api-spec.ts`，76 条）

四个轴：**A** 显式 filters 合法 ⇒ 20000；**B** 未知算子 `gt` ⇒ 40099；**C** `like` 打 uuid 主键 ⇒ 40099；
**D** 旧 `query` 对象 ⇒ 40099。

| # | 端点 | A | B | C | D |
|---|------|---|---|---|---|
| 1 | `POST /app/demo/list` | ✅ | ✅ | ✅ | ✅ |
| 2 | `POST /app/logger/list` | ✅ | ✅ | n/a（文件系统，无列类型） | ✅ |
| 3 | `POST /app/monitor/cache/list` | ✅ | ✅ | n/a（Redis 内存列表） | ✅ |
| 4 | `POST /app/monitor/user/list` | ✅ | ✅ | ✅ | ✅ |
| 5 | `POST /app/setting/list` | ✅ | ✅ | ✅ | ✅ |
| 6 | `POST /system/user/list` | ✅ | ✅ | ✅ | ✅ |
| 7 | `POST /system/role/list` | ✅ | ✅ | ✅ | ✅ |
| 8 | `POST /system/dept/list` | ✅ | ✅ | ✅ | ✅ |
| 9 | `POST /system/post/list` | ✅ | ✅ | ✅ | ✅ |
| 10 | `POST /system/dict/type/list` | ✅ | ✅ | ✅ | ✅ |
| 11 | `POST /system/dict/data/list` | ✅ | ✅ | ✅ | ✅ |
| 12 | `POST /system/employee/list` | ✅ | ✅ | ✅ | ✅ |
| 13 | `POST /system/lang/list` | ✅ | ✅ | ✅ | ✅ |
| 14 | `POST /system/locale/list` | ✅ | ✅ | ✅ | ✅ |
| 15 | `POST /system/menu/list` | ✅ | ✅ | ✅ | ✅ |
| 16 | `POST /system/device/list` | ✅ | ✅ | ✅ | ✅ |
| 17 | `POST /system/deleted/list` | ✅（content 旁路） | ✅ | ✅ | ✅ |
| 18 | `POST /system/log/auth/list` | ✅ | ✅ | ✅ | ✅ |
| 19 | `POST /system/log/operate/list` | ✅ | ✅ | ✅ | ✅ |

E 段（user）：`filters: []` 与完全不带 `filters` 的 `total` 相等；F 段（user，D15）：`createdAt DESC` 下
逐页 pageSize=1 拼回的前缀与一次取全**逐项相等**（有全序才可能成立）。

> `logger` / `cache` 两条端点不走 QueryBuilder，**没有列类型裁决面**（不存在 50000 那条路）；
> 非法输入由 DTO 枚举（B）与各自的形态判断（`logger` 的 `toFileNameFilter`/`toLogTypeFilter`）拦住。

另有 24 个既有 api-spec + 7 个 int-spec 的请求体按「旧语义 → 显式 op」机械改写（`query: {x:'s'}` ⇒
`filters: [{field:'x', op:'like', value:'s'}]`；uuid 字段 `eq`；枚举数组 `in`；日期区间 `range`），
继续以真实业务流覆盖各端点的 filters 路径。

## 6. openapi / api-types

- `pnpm --filter @walnut/server openapi:export` → `apps/server/openapi.json`（openapi 3.0.0 / 202 schemas）；
- `pnpm --filter @walnut/api-types generate` → `packages/generated/api-types/src/schema.d.ts`
  （注：该包在本轮被并行批次从 `packages/platform-web/api-types` 挪到 `packages/generated/`，script 里的相对路径仍然正确）；
- diff 规模：`openapi.json` **+533 / -1821**，`schema.d.ts` **+341 / -1147** —— 净减少，因为每个 list 请求体
  里那一大棵**实体形状的属性树**（userName/nickName/age/gender/…）被**一处** `filters: FilterDTO[]` 取代了；
- 可读性：diff 就是「删掉 N 个 DTO 的 query 子树 + 新增一个共享 `FilterDTO` schema」，生成的 list 请求体现在是
  `filters: components["schemas"]["FilterDTO"][]`；
- `FilterDTO` 的 swagger 形态：`field: string`（带 example）、`op` 五值枚举、`value` 用 `oneOf` 五形态 + `nullable`
  （生成物 `(string | number | boolean | unknown[] | { [k: string]: unknown }) | null`，可读可用）。

## 7. 门禁实测

| 命令 | 结果 |
|------|------|
| `cmd /c "pnpm --filter @walnut/server test"` | ✅ **86 文件 / 753 条全绿**（71s） |
| `cmd /c "pnpm --filter @walnut/contract test"` | ✅ 27 条（含新快照 `FilterOpValues`） |
| `cmd /c "pnpm types:check"` | ✅ 15/15（admin `vue-tsc` 过） |
| `cmd /c "pnpm lint"` | ✅ 15/15（0 error；本批文件 2 条既有风格的 warning） |
| `cmd /c "pnpm boundaries"` | ✅ 15 包 / 4646 文件，0 issue |
| `cmd /c "pnpm --filter @walnut/admin build"` | ✅ built in 3m 14s（exit 0） |
| `vitest --config vitest.config.integration.ts apps/api/test/api/list-filters.api-spec.ts` | ✅ 76 条（34s，真实 PG + Redis） |

## 8. 改动清单（`git status` 摘录，未 commit）

```text
契约：  packages/platform-any/contract/src/{pagination,index,index.test}.ts + __snapshots__/index.test.ts.snap
        packages/platform-web/http/src/{types,index}.ts
后端：  libs/list/src/{list.dto,list.filters,index}.ts · libs/decorators/src/field/{any.decorator,index}.ts
        libs/types/src/walnut-admin/decorators/any.d.ts
        libs/repository/src/{pg-column-op,pg-list.builder,index}.ts (+ pg-list.builder.spec.ts)
        libs/system/src/{deleted/deleted.basic.repository,device/device.service,locale/locale.service,locale/repo/locale.repo.service}.ts
        libs/app-domain/src/{logger/logger.service,monitor/user/user.basic.repository}.ts
        libs/cache/src/{cache-list.types,cache.service,cache.service.spec}.ts
        apps/api/src/common/list-request-validation.spec.ts
生成物：apps/server/openapi.json · packages/generated/api-types/src/schema.d.ts
测试：  apps/api/test/api/*.api-spec.ts（24 个改写 + 新增 list-filters.api-spec.ts）
        apps/api/test/integration/*.int-spec.ts（7 个改写）
前端：  src/utils/table/list-filters.ts（新）
        src/components/UI/Table/src/hooks/{useTableAPIListParams,useTableAPI,useTableColumns}.*
        src/components/UI/Table/src/types.ts · src/components/Advanced/{CRUD/types.ts,ApiSelect/index.vue}
        src/views/system/{device/index.vue,log/auth/index.vue}
```

## 9. 已知限制 / 不做的事

### 9.1 全量 api-spec 套件的 10 条既有红（与本批无关）

`vitest --config vitest.config.integration.ts apps/api/test/api` 的结果：**44 个文件 / 439 条通过**，
**2 个文件 / 10 条失败** —— 全部是 `40101 Access Token Expired`，且集中在
`device.api-spec`（unban、read 边界）与 `guard-matrix.api-spec`（ban/unban 闭环、MFA verified 缓存、
lock/unlock 闭环、IP 变化回写、opaque 子开关）。

**判定：不是本批引入。** 依据：
1. 这 10 条全部落在 JWT / MFA / Lock / Device 链，本批**没有触及**任何 auth guard、token、session 代码；
2. 单独只跑这两个文件（66s，token 不可能过期）同样 10 条失败 ⇒ 与「跑太久 token 过期」无关；
3. `reports/review-guards/review.md:231` 已记录：`jwt-access.guard.ts:70-72` 把**所有**失败都翻成 `40101`，
   所以 `40101` 在这里不代表过期，只代表「会话查不到」（服务器日志同时打出
   `Sign guard: session not found for authenticated request, rejecting`）；
4. 同套件里 **20 个 list 端点全部通过**（含新增的 76 条）。

复现命令：

```powershell
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm exec vitest run --config ./apps/api/vitest.config.integration.ts apps/api/test/api/device.api-spec.ts apps/api/test/api/guard-matrix.api-spec.ts"
```

### 9.2 status 列筛选（字典值 `'true'`/`'false'`）会走 `like` 打布尔列

`WTablePresetStatusColumn`（`apps/admin/src/components/UI/Table/src/utils/presetColumns.ts:8-15`）的
`filter: true` 产出的值是字典 `sys_shared_status` 的**字符串** `'true'`/`'false'`（`db/seed/sys_dict_data.json`），
而 `status` 是**布尔列** —— 前端现在会发 `{ op: 'like', value: 'true' }` ⇒ **40099**。

这是**既有缺陷的换码**：同一请求在批次 4-A 之前是 `boolean ~~* unknown` ⇒ **50000**（R1 矩阵第一行同源格）。
本批把它从 50000 变成 40099（符合「永不 50000」），但没有修复可用性。
正确修法要给列/字典声明值的**类型**（status 字典的 `true`/`false` 应发布尔），属产品/契约面，留给 Lead 定；
见 §10 第 2 条。

### 9.3 `field` 没有白名单

`filters[].field` 只校验「非空字符串」，**不校验是不是实体列**：非实体列（JOIN 别名 / 拼错的字段名）
仍按 `columns.has()` 语义**静默丢弃**。理由见 §2.1（过滤面 ≠ 实体 DTO 属性面）。
代价：字段名拼错不会报错，只会「条件不生效」。若要求严格，需要给每个 DTO 补 `filterOnlyIn`
（21 个 DTO + 5 条旁路的字段清单），属下一批。

### 9.4 swagger 里 `value` 是 required

`FilterDTO.value` 在 openapi 里是 `required`（`@ApiProperty` 有 example 就必填），但 `isNull` 语义上不带值。
运行时不受影响（DTO 不校验该字段），只影响生成的类型签名（`api-types` 目前只消费响应别名，暂无人踩）。

### 9.5 明确不做（按任务书）

- 不做 cursor 分页；
- 不动 `sort[].priority` 的 swagger `required`（P2-B）；
- 不碰 packages 的 barrel 与 utils 收缩（并行批次在做）；
- `deleted` / `locale` / `monitor-user` / `device` 的旁路 SQL 语义原样保留（只换过滤条件的入参形态）。

### 9.6 三个代表性表格页的**接口级**回归（用户 / 角色 / 日志）

浏览器回归没有跑（环境里没有可用的 admin 账号，且本批不动 UI 结构）；按任务书允许的「账号未知就用接口级验证」口径，
把三个页面**真实会发出的 wire** 在真实 PG 上打了一遍（`list-filters.api-spec.ts` A 段 + 各页自己的 api-spec）。

| 页面 | 页面实际发出的 filters | 覆写用例 | 结果 |
|------|------------------------|----------|------|
| 用户 `views/system/user` | `[{field:'userName',op:'like',value:'root'}]` + `sort:[createdAt DESC]` + `page` | `list-filters` A/6、`user.api-spec`（`filters: [{userName, like}]`） | ✅ 20000，命中行 `userName` 含 `root` |
| 角色 `views/system/role` | `[{field:'roleName',op:'like',value:'root'}]` + `sort:[createdAt DESC]` | `list-filters` A/7、`role.api-spec:263` | ✅ 20000，命中 root 角色 |
| 日志-鉴权 `views/system/log/auth` | `[{userName,like},{location,like},{ip,like},{authenticatedAt,range:[起,止]}]` | `list-filters` A/18、`log-auth.api-spec:112,159`（`deviceId like` + `type in`） | ✅ 20000；`authenticatedAt` 的 `range` 走时间列，不再打布尔列 |
| 日志-操作 `views/system/log/operate` | `[{title,like},{userName,like},{ip,like},{operatedAt,range:[起,止]}]` | `list-filters` A/19、`log-operate.api-spec:103,202` | ✅ 20000 |

另外三个页面（`system/deleted`、`system/locale`、`app/monitor/user`）因为各有旁路 SQL，单独确认：

| 页面 | wire | 旁路 | 结果 |
|------|------|------|------|
| `system/deleted` | `content like` + `deletedAt range` | content 从 filters 摘出走 `content::text ILIKE` | ✅ `list-filters` A/17 + `deleted.api-spec:147,181` |
| `system/locale` | `langId eq`（uuid）+ `key like` + `value like` | `value`/`langId` 是文档级过滤 | ✅ `list-filters` A/14 + `locale.api-spec:221` |
| `app/monitor/user` | `visitorId/ip/country/browser/os/userName` 全 `like` | 6 个 JOIN 别名键 | ✅ `list-filters` A/4 + `monitor-user.api-spec:183` |

## 10. 需要 Lead 拍板

1. **前端 16 处 `.vue` 的 `query` 我按「界面态」保留了**（不逐个改成 filters）。
   理由：这 16 处全是表单模型读写，没有一处直接拼 wire；保留后改动面从 16 个文件缩到 1 个纯函数。
   **但这与任务书「再逐个修 16 个 `.vue`」的字面要求不同** —— 如果你要的是「`.vue` 里不再出现 `query` 这个词」，
   那就是另一套改法（把表单模型也改叫 filters/conditions，并改 `WForm` 的绑定），成本约 1-2 天，且有 UI 回归风险。
   请拍板：**A. 保持现状（推荐）** / B. 连表单模型一起改名。

2. **status 列（及所有布尔字典列）的筛选现在报 40099**（§9.2）。三条路：
   a. 给字典补「值类型」（`sys_dict_data` 加 `valueType`），前端按类型发布尔 —— 最正，但要动 seed/DTO（推荐）；
   b. 前端对 `sys_shared_status` 做特判，把 `'true'/'false'` 转布尔 —— 1 行，但特判会扩散；
   c. 维持 40099，等下一批。请拍板。

3. **`withPgListTiebreaker` 的方向规则**：我用「沿用最后一个排序键的方向」(`createdAt DESC ⇒ id DESC`)；
   另一条可选规则是「恒定 `id DESC`」。请确认要不要换成恒定方向（会影响 `deviceName ASC` 这类排序的组内顺序）。

4. **全量 api-spec 套件里 10 条既有红**（§9.1）：要不要另开一条 P? 去查 `guard-matrix` / `device` 的会话失效
   （当前 `40101` 把「会话查不到」也说成「过期」，误导性很强）。本批未修。

5. **`filters[].field` 要不要白名单**（§9.3）：现在拼错字段名是静默不生效。要做就得给 21 个 DTO 补
   `filterOnlyIn`（并想清楚 5 条旁路的虚拟字段怎么登记）。

