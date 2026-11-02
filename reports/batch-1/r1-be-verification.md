# R1 后端复核 · 批次 1（P0 止血）

> 复核范围：list 入参三处缺口（算子按值类型选 / 校验不下钻 / pageSize 无上限）。
> 基线：HEAD `190a4c5d`，工作树 clean。
> 方式：**实测优先**。用临时 spec 连真实 PG（`PostgreSQL 18.6`，本机 5432，库 `walnut-admin-nestjs`，
> 连接角色 `walnut`）跑完 6×5 矩阵 + page/sort/校验探测 + 错误码映射 + 列类型普查。
> 临时 spec 共 4 个，落在 `apps/server/libs/repository/src/__tmp_r1_*.spec.ts`，**跑完已删除**，
> `git status --porcelain` 已回到 clean（本机无 `trash` 命令，用 `Remove-Item` 清理自建临时文件）。
> 本轮**未修改任何源码/配置**。

---

## 0. 结论速览

| # | 事项 | 实测判定 |
|---|------|----------|
| 1 | 算子按 `typeof value` 选、不看列类型 | ✅ **真**，且比预想更广：不是只有 "字符串→ILIKE" 一条路，**任意非法组合都会炸**（42883 / 22P02 / 22007 / 22008 / 2201X / 2201W） |
| 2 | 三槽位 `ValidateNested` 从未生效 | ✅ **真**，`validate()` 恒返回 `[]`；`query` 里的**未声明键**也放行（实测 `totallyBogus` 通过） |
| 3 | `pageSize` 无上限 | ✅ **真**，`LIMIT 1000000000` 已实测发出并执行成功 |
| 4 | 「`page` 半传 ⇒ OFFSET NaN」 | ❌ **假**。`{page:{pageSize:20}}` 被嵌套默认值补成 `page=1`，实测 `skip=0 limit=20` 正常。真正的 NaN 入口是 **`page.page` 为非数字** |
| 5 | 观测「HTTP 结果」 | ⚠️ **口径要改**：全局过滤器**永远回 HTTP 200**，错误码在 body（`exception.filter.ts:93`）。上面所有崩溃实测是 **HTTP 200 + `code: 50000`**；校验拒绝是 **HTTP 200 + `code: 40099`** |
| 6 | 影响面 | 18 张 list 表共 **230 列**，其中 **139 列**（uuid 39 / timestamptz 37 / 布尔·数值 51 / jsonb 12）在"值形态与列类型不匹配"时会炸；`text`(71) 与 `varchar`(20) 安全 |
| 7 | 现有调用会不会被新校验 400 | 现有 20 处 list 的 api-spec 请求体 + 前端构造**全部合法**；唯一会踩的是 `sort[].order: false`（前端已在发出前过滤，但**契约与 DTO 类型仍允许 false**） |
| 8 | 改 builder 要不要连带改 data-scope | ❌ **不用**。data-scope 走固定 `= :userId` / `IN (:...deptIds)`，值与类型都已定型，不经过 `typeof` 分派 |

---

## 1. 矩阵实测（6 列类型 × 5 入参形态，真跑）

### 1.1 环境与载体

~~~text
PREFLIGHT {"u":"sys_user","d":"sys_device","who":"walnut",
           "v":"PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) ..."}
~~~

- 载体实体：`SysDeviceEntity`（`libs/system/src/device/entity/device.entity.ts`）+ `SysUserEntity`。
- 载体 DTO：`SysDeviceDTOListRequest`（`libs/system/src/device/dto/device.dto.ts:260`）与
  `SysUserDTOListRequest`（`apps/api/src/modules/system/user/dto/user.dto.ts:74`）——
  **走的就是 controller 那条链**：`plainToInstance(真实 ListRequest) → buildPgListQueryOptions → applyPgListQuery`。
- 列名取真实列：
  | 类型 | 属性 → 列 | 出处 |
  |------|-----------|------|
  | uuid | `id` → `sys_device.id` | `device.entity.ts:22`（`@PrimaryColumn({type:'uuid'})`） |
  | text | `deviceName` → `device_name` | `device.entity.ts:26` |
  | timestamptz | `createdAt` → `created_at` | `device.entity.ts:92` |
  | boolean | `active` → `active` | `device.entity.ts:69` |
  | 数值（smallint） | `riskScore` → `risk_score` | `device.entity.ts:89` |
  | jsonb | `deviceInfo` → `device_info` | `device.entity.ts:34` |

### 1.2 实测输出（原样，30 格）

算子列是 `buildPgListQueryOptions` 实际产出的 `op`，SQL 列是 `qb.getQuery()` 的 WHERE 段，
结果是**真实发到 PG 之后**的回执。

~~~text
deviceName   str       "iPhone"          op=ilike  | WHERE "entity"."device_name" ILIKE :...          | ok rows=0
id           str       "abc"             op=ilike  | WHERE "entity"."id" ILIKE :...                    | ERR 42883 | operator does not exist: uuid ~~* unknown
active       str       "abc"             op=ilike  | WHERE "entity"."active" ILIKE :...                | ERR 42883 | operator does not exist: boolean ~~* unknown
deviceInfo   str       "abc"             op=ilike  | WHERE "entity"."device_info" ILIKE :...           | ERR 42883 | operator does not exist: jsonb ~~* unknown
createdAt    str       "2024-01-01"      op=ilike  | WHERE "entity"."created_at" ILIKE :...            | ERR 42883 | operator does not exist: timestamp with time zone ~~* unknown
riskScore    str       "abc"             op=ilike  | WHERE "entity"."risk_score" ILIKE :...            | ERR 42883 | operator does not exist: smallint ~~* unknown

deviceName   uuidstr   "5fbd10a4-..."    op=eq     | WHERE "entity"."device_name" = :...               | ok rows=0
id           uuidstr   "5fbd10a4-..."    op=eq     | WHERE "entity"."id" = :...                        | ok rows=0
active       uuidstr   "5fbd10a4-..."    op=eq     | WHERE "entity"."active" = :...                    | ERR 22P02 | invalid input syntax for type boolean
deviceInfo   uuidstr   "5fbd10a4-..."    op=eq     | WHERE "entity"."device_info" = :...               | ERR 22P02 | invalid input syntax for type json
createdAt    uuidstr   "5fbd10a4-..."    op=eq     | WHERE "entity"."created_at" = :...                | ERR 22007 | invalid input syntax for type timestamp with time zone
riskScore    uuidstr   "5fbd10a4-..."    op=eq     | WHERE "entity"."risk_score" = :...                | ERR 22P02 | invalid input syntax for type smallint

deviceName   num       123               op=eq     | WHERE "entity"."device_name" = :...               | ok rows=0
id           num       123               op=eq     | WHERE "entity"."id" = :...                        | ERR 22P02 | invalid input syntax for type uuid: "123"
active       num       1                 op=eq     | WHERE "entity"."active" = :...                    | ok rows=0
deviceInfo   num       123               op=eq     | WHERE "entity"."device_info" = :...               | ok rows=0
createdAt    num       1700000000000     op=eq     | WHERE "entity"."created_at" = :...                | ERR 22008 | date/time field value out of range
riskScore    num       50                op=eq     | WHERE "entity"."risk_score" = :...                | ok rows=0

deviceName   bool      true              op=eq     | WHERE "entity"."device_name" = :...               | ok rows=0
id           bool      true              op=eq     | WHERE "entity"."id" = :...                        | ERR 22P02 | invalid input syntax for type uuid: "true"
active       bool      true              op=eq     | WHERE "entity"."active" = :...                    | ok rows=0
deviceInfo   bool      true              op=eq     | WHERE "entity"."device_info" = :...               | ok rows=0
createdAt    bool      true              op=eq     | WHERE "entity"."created_at" = :...                | ERR 22007 | invalid input syntax for type timestamp with time zone
riskScore    bool      true              op=eq     | WHERE "entity"."risk_score" = :...                | ERR 22P02 | invalid input syntax for type smallint

deviceName   arr-date  [d1,d2]            op=range  | WHERE device_name >= :... AND device_name < :...  | ok rows=0
id           arr-date  [d1,d2]            op=range  | WHERE id >= :... AND id < :...                    | ERR 22P02 | invalid input syntax for type uuid: "2024-01-01T08:00:00.000+08:00"
active       arr-date  [d1,d2]            op=range  | WHERE active >= :... AND active < :...            | ERR 22P02 | invalid input syntax for type boolean
deviceInfo   arr-date  [d1,d2]            op=range  | WHERE device_info >= :... AND device_info < :...  | ERR 22P02 | invalid input syntax for type json
createdAt    arr-date  [d1,d2]            op=range  | WHERE created_at >= :... AND created_at < :...    | ok rows=0
riskScore    arr-date  [d1,d2]            op=range  | WHERE risk_score >= :... AND risk_score < :...    | ERR 22P02 | invalid input syntax for type smallint

deviceName   arr-num   [1,2]             op=range  | WHERE device_name >= :... AND device_name < :...  | ok rows=0
id           arr-num   [1,2]             op=range  | WHERE id >= :... AND id < :...                    | ERR 22P02 | invalid input syntax for type uuid: "1970-01-01T08:00:00.001+08:00"
active       arr-num   [1,2]             op=range  | WHERE active >= :... AND active < :...            | ERR 22P02 | invalid input syntax for type boolean
deviceInfo   arr-num   [1,2]             op=range  | WHERE device_info >= :... AND device_info < :...  | ERR 22P02 | invalid input syntax for type json
createdAt    arr-num   [1,2]             op=range  | WHERE created_at >= :... AND created_at < :...    | ok rows=0
riskScore    arr-num   [1,2]             op=range  | WHERE risk_score >= :... AND risk_score < :...    | ERR 22P02 | invalid input syntax for type smallint
~~~

（`transformed=` 一列省略了：**DTO 层没有把任何值改成"安全形态"**，唯一例外是布尔列的
`boolean.transformer.ts:39-48` 把字符串 `'true'`/`'false'` 转成布尔——所以 `active:"abc"` 仍是字符串。）

### 1.3 这张表说明了什么

**结论：真正生效的"类型契约"只有一条 —— `typeof value`。它与列类型完全解耦，所以任何
"值的 JS 类型 → 列类型" 的不匹配都会在 PG 侧炸。** 一共有三条不同的爆炸路径：

| 路径 | 触发 | PG 错误码 | 计数（本矩阵 30 格） |
|------|------|-----------|---------------------|
| A. `ILIKE` 打到非文本列 | 值是**普通字符串**（非 uuid 形态）且列不是 text/varchar | **42883** | 5 / 6（该行只有 text 列安全） |
| B. `=` 的参数**输入语法**与该列类型不符 | 值是 uuid 串 / 数字 / 布尔，列是 uuid、timestamptz、boolean、smallint、jsonb 之一 | 22P02 / 22007 / 22008 | **9 / 18**（另 9 格恰好合法） |
| C. `range` 打到非时间列 | 数组被 `isDateRange` 判成日期区间（`[1,2]` 也算——`new Date(1)` 合法） | 22P02 | **8 / 12**（只有 timestamptz 列 2 格成功） |

**只有 text 与 varchar 列全形态安全**（`text = <任意参数>` 能靠 PG 的 unknown 字面量推断吃下所有值）。
这也解释了为什么"平时看着没事"：admin 的查询面几乎全是文本模糊搜索。

**为什么 `eq` 也会炸**：node-postgres 把参数按 `unknown` 文本下发，PG 按列类型做**输入语法解析**。
uuid 列收到 `"123"` ⇒ 22P02；timestamptz 列收到 `1700000000000` ⇒ 22008；boolean 列收到 uuid 串 ⇒ 22P02。
所以"只要不是字符串就走等值"这条设计，等价于"把类型校验外包给 PG 的文本解析器"。

### 1.4 与 Lead 给的两条样例对账

| Lead 的实测 | 我这一轮 | 一致？ |
|-------------|---------|--------|
| `{"query":{"id":"abc"}}` ⇒ `id ILIKE '%abc%'` ⇒ 42883 | 第一行第 2 格：`op=ilike` + `uuid ~~* unknown` | ✅ |
| `{"query":{"order":[1,2]}}` 被判成日期区间的 500 | `arr-num` 整行：`op=range`，`[1,2]` → `1970-01-01T08:00:00.001+08:00`/…`002` | ✅（并补齐：uuid/jsonb/boolean/smallint 全 22P02；**只有 timestamptz 列**恰好成功） |

---

## 2. page 正规化：**推翻一条旧结论**

~~~text
PAGE_START
no page                  | page={"page":1,"pageSize":10}      skip=0    limit=10          vWarn=0 | LIMIT 10 OFFSET 0   | ok rows=1
full page 2/20           | page={"page":2,"pageSize":20}      skip=20   limit=20          vWarn=0 | LIMIT 20 OFFSET 20  | ok rows=0
{page:{pageSize:20}}     | page={"page":1,"pageSize":20}      skip=0    limit=20          vWarn=0 | LIMIT 20 OFFSET 0   | ok rows=1   ← 旧结论说这里 NaN，实测正常
{page:{page:3}}          | page={"page":3,"pageSize":10}      skip=20   limit=10          vWarn=0 | LIMIT 10 OFFSET 20  | ok rows=0
{page:{}}                | page={"page":1,"pageSize":10}      skip=0    limit=10          vWarn=0 | LIMIT 10 OFFSET 0   | ok rows=1
{page:null}              | page={"page":1,"pageSize":10}      skip=0    limit=10          vWarn=0 | LIMIT 10 OFFSET 0   | ok rows=1
page.page="abc"          | page={"page":"abc","pageSize":10}  skip=NaN  limit=10          vWarn=0 | (无 SQL)            | THROW TypeORMError | Provided "offset" value is not a number
pageSize=1e9             | page={... "pageSize":1000000000}   skip=0    limit=1000000000  vWarn=0 | LIMIT 1000000000    | ok rows=1   ← 无 clamp，已实测发出
page=-1                  | page={"page":-1,"pageSize":10}     skip=-20  limit=10          vWarn=0 | LIMIT 10 OFFSET -20 | ERR 2201X | OFFSET must not be negative
pageSize=0               | page={"page":1,"pageSize":0}       skip=0    limit=0           vWarn=0 | LIMIT 0 OFFSET 0    | ok rows=0   ← 静默空页
pageSize="20"            | page={"page":1,"pageSize":"20"}    skip=0    limit=20          vWarn=0 | LIMIT 20 OFFSET 0   | ok rows=1
pageSize=-5              | page={"page":1,"pageSize":-5}      skip=0    limit=-5          vWarn=0 | LIMIT -5 OFFSET 0   | ERR 2201W | LIMIT must not be negative
PAGE_END
~~~

**三条修正/新增结论**：

1. **"半传 page ⇒ OFFSET NaN" 不成立**。`WalnutAdminDecoratorTransformerObject` 的 `@Type(() => WalnutAdminRequestListPageDTO)`
   （`libs/decorators/src/transformer/base/object.transformer.ts:30-32`）会在嵌套实例化时**逐字段**跑
   `WalnutAdminDecoratorTransformDefault`（`libs/list/src/list.dto.ts:17-28,31-42` 各字段都带
   `transformOptions.req.defaultTransform: true`），所以缺的字段被补成 1 / 10。
   上一轮我把它判成"整体替换不 merge"，是**只看装饰器默认值、没跑嵌套 transform** 的误判。
2. **真正的 NaN 入口是 `page.page` 非数字**（`"abc"`）。而且它**不在 PG 炸**，是在
   `qb.offset()` 里被 TypeORM 的 `validateNumericInput` 拦下（`pg-list.builder.ts:187`）——
   抛 `TypeORMError`，经 handler 兜底仍是 `code 50000`。
3. **负值/零值不报 400，直接进 SQL**：`page=-1` ⇒ PG `2201X`；`pageSize=-5` ⇒ PG `2201W`；
   `pageSize=0` ⇒ `LIMIT 0` 静默空页（用户看到"没数据"而不是报错）。

> 注：`libs/list/src/list.dto.ts:36` 本来就声明了 `max: 9999`、`:22` 声明了 `min: 1, positive: true`，
> 但因为第 3 节的校验不下钻，这些约束**一格都没生效**（`vWarn` 全是 0）。

---

## 3. 校验不下钻：实测确认，并多一条"未声明键也放行"

~~~text
PROBE_START   （如果以后开 ValidateNested，单个 sort 项会被怎么判）
order:false            -> FAIL: isEnum        ← 前端类型允许 false，但枚举里没有
order:ascend           -> PASS
order:"ASC"            -> FAIL: isEnum
field 白名单内          -> PASS
field 白名单外 ip       -> FAIL: isIn
field 非实体列          -> FAIL: isIn
缺 order               -> FAIL: isEnum
PROBE_END

TOPLEVEL_EXTRA_IN_QUERY warnings= 0  query keys= ["deviceName","totallyBogus","location","id","deviceId",
   "deviceInfo","hardwareInfo","locationInfo","locationHistory","sr","vp","ip","ipHistory","active","locked",
   "banned","private","geoLocation","riskScore","createdAt","updatedAt"]
TOPLEVEL_BOGUS_SLOT     warnings= 1  props= totallyBogus
~~~

- `vWarn=0` 在**所有** page/sort/矩阵用例里成立 ⇒ `query`/`sort`/`page` 三个槽位对
  `validate()` 完全透明，与 Lead 的实测一致。
- **新发现**：连 `forbidNonWhitelisted: true` 都管不到 `query` 内部 —— 塞一个
  `totallyBogus` 进去，`warnings` 仍是 0（对比：**顶层**裸字段 `totallyBogus` 立刻 1 条 warning）。
  也就是说 `main.ts:110-125` 的 `whitelist/forbidNonWhitelisted` 只作用于**最外层**键。
- `plainToInstance` 后 `query` 会带上**该实体 DTO 的全部字段**（含 default 的 null/[]），
  不只是客户端传的那几个 —— 这解释了为什么 `buildPgListQueryOptions` 里 `isNil` 跳过是必需的，
  也说明"未传字段"与"传了 null"在 builder 眼里等价。

---

## 4. sort 的额外发现（不在 Lead 清单里，但同源）

~~~text
SORT_START
order:false                    vWarn=0 | ORDER BY "entity"."created_at" DESC                | ok    ← false 被剔除→回落默认
order:ascend                   vWarn=0 | ORDER BY "entity"."created_at" ASC                 | ok
order:"ASC"                    vWarn=0 | ORDER BY "entity"."created_at" DESC                | ok    ← 大写被当 DESC！
field=ip (非白名单但实体列)      vWarn=0 | ORDER BY "entity"."ip" ASC                         | ok    ← 白名单未生效，真按 ip 排了
field=notAColumn               vWarn=0 | (SQL 里没有 ORDER BY)                              | ok    ← 默认排序被静默取消
field=注入串 "id; DROP TABLE…"  vWarn=0 | (SQL 里没有 ORDER BY)                              | ok    ← 拼接安全（被 columns 白名单丢弃）
field=deviceInfo (jsonb 列)     vWarn=0 | ORDER BY "entity"."device_info" ASC                | ok
SORT_END
~~~

三条要带进修复的：

1. **`field` 白名单真没生效**：`ip` 不在 `SysDeviceDTOListRequest` 的 `sortOnlyIn`（只有
   active/locked/banned/createdAt/updatedAt，`device.dto.ts:262`）里，但实测照样
   `ORDER BY ip ASC`。唯一还拦着的是 `pg-list.builder.ts:142,182` 的 `columns.has()`（只保证"是实体列"）。
2. **未知 `field` ⇒ 默认排序被清空**：`buildPgListQueryOptions` 只要 `sortEntries.length > 0` 就
   **整体覆盖** `defaults.sort`（`pg-list.builder.ts:115-125`），随后 `columns.has` 把它丢掉 ⇒
   SQL **没有 ORDER BY**。配合 `LIMIT/OFFSET` 就是**翻页可能重复/丢行**。
   目前 admin 没有踩到（`views/system/user/index.vue:184-187` 的 `roles_count` 列没有 sorter；
   带 sorter 的是 status/createdAt/updatedAt，都是真实列）。
3. **`order` 只认小写 `'ascend'`**：`s.order === 'ascend' ? 'ASC' : 'DESC'`（`pg-list.builder.ts:120`），
   传 `"ASC"` 会**静默降序**。当前前端只发小写，属潜伏。

---

## 5. 错误码映射（实测，不是推断）

用矩阵里**真实捕获**的异常灌进全局 handler（`libs/exceptions/src/handler.ts`）测出来的：

~~~text
MAP_START
id="abc" (ILike on uuid)                 -> errName=QueryFailedError  driverCode=42883  => body.code=50000
page.page="abc" (TypeORMError)           -> errName=TypeORMError      driverCode=-      => body.code=50000
page=-1 (2201X)                          -> errName=QueryFailedError  driverCode=2201X  => body.code=50000
pageSize=-5 (2201W)                      -> errName=QueryFailedError  driverCode=2201W  => body.code=50000
active="abc" (ILike on boolean)          -> errName=QueryFailedError  driverCode=42883  => body.code=50000
createdAt="2024-01-01" (ILike on tstz)   -> errName=QueryFailedError  driverCode=42883  => body.code=50000
riskScore="abc" (ILike on smallint)      -> errName=QueryFailedError  driverCode=42883  => body.code=50000
ValidationPipe rejection (400 branch)    -> errName=WalnutAdminExceptionRequestDataError => body.code=40099
MAP_END
~~~

**为什么"HTTP 500"是错的口径**：

~~~text
libs/exceptions/src/exception.filter.ts:93   response.status(HttpStatus.OK).json(responseData)
libs/exceptions/src/handler.ts:79-103        只有 23514 / 23505 / 23503 才映射成 40000
libs/exceptions/src/handler.ts:117-123       其余（含 42883/22P02/22007/22008/2201X/2201W、TypeORMError）→ 兜底 INTERNAL_SERVER_ERROR
packages/platform-any/contract/src/response-code.ts:17,135   BAD_REQUEST=40000 · INTERNAL_SERVER_ERROR=50000
~~~

⇒ 观测到的现象是 **HTTP 200 + `{"code":50000,...}`**。这对验收很关键：
写回归用例时断言的应是 `body.code`，不是 HTTP status。
校验拒绝一侧是 **HTTP 200 + `40099`**（`main.ts:120-123` → `WalnutAdminExceptionRequestDataError`
→ `libs/exceptions/src/base/400.ts:20-23` 的 `BAD_REQUEST_DATA_ERROR`）。

---

## 6. 打开 ValidateNested 的副作用评估（防回归）

### 6.1 查了哪些地方

| 类别 | 覆盖 |
|------|------|
| 后端 api-spec 的 20 处 list 调用 | `apps/server/apps/api/test/api` 下 20 个文件（`user/dept/role/menu/post/dict×2/employee/lang/locale/device/deleted/demo/setting/logger/monitor/monitor-user/log-auth/log-operate/real-data/permission-chain/data-scope×3/pool-occupancy`），逐条读请求体 |
| 前端构造 | `apps/admin/src/components/UI/Table/src/hooks/useTableAPIListParams.ts:9-16`（初值）· `useTableAPI.ts:50-57,148,201`（`onBeforeRequest` / 查询表单 / 列过滤并入 `query`）· `utils/index.ts:31-51`（`generateSortParams`） |
| 日期筛选 | `views/system/log/operate/index.vue:166-181` · `views/system/log/auth/index.vue` · `views/system/deleted/index.vue:137-152`（三处 `Base:DatePicker`） |

### 6.2 结论：**现有合法请求一个都不会变 400**

现有 20 处 list 请求体的取值集合（全量枚举）：

~~~text
query:  demoString / employeeNo / content / deptCode / deviceId / type:['opaque'] / typeId /
        lang / key / visitorId / settingKey / postCode / roleName / userName / fileName / logType / {} 
sort:   [] 或 [{field, order: 'ascend'|'descend', priority: 1}]
page:   {page:1, pageSize: 1|2|10|50|100}
~~~

逐条对过嵌套校验的三类约束：

1. `field` 的 `IsIn(sortOnlyIn)`：上述 sort 用到的 field 是
   `createdAt`(demo/dept?/user/role/menu/dict×2/employee/lang/setting/monitor?) ·
   `authenticatedAt` · `operatedAt` · `firstVisitAt` · `key`(cache) · `fileMTime`(logger) ——
   **每一个都在各自 DTO 的 `sortOnlyIn` 里**（`log.auth.dto.ts:181`、`log.operate.dto.ts:302`、
   `monitor user.dto.ts:83`、`cache.dto.ts:63`、`lang.dto.ts:125`、`setting.dto.ts:95`、`dept.dto.ts:123` 等）。
   **唯一例外**：`logger.api-spec.ts:95` 用 `fileMTime`，而 `AppLoggerDTOListRequest`
   **没有传 `sortOnlyIn`**（`logger.dto.ts:59`）⇒ 回退成"DTO 全部属性"当白名单（`list.dto.ts:65-66`）。
   `fileMTime` 是否在 `AppLoggerDTO` 里需要确认，**否则这一条会 400**。见 §10 待确认项。
2. `order` 的 `IsEnum(SortOrderValues)`：**只有 `false` 会被拒**（实测 `isEnum`），
   `'ascend'`/`'descend'` 通过。现有 spec 全部发 `'ascend'`/`'descend'` ⇒ 不会被拒。
3. `page` 的 `IsInt/IsPositive/Min(1)/Max(9999)`：现有取值 1/2/10/50/100 全在范围内 ⇒ 不会被拒。
   ⚠️ 但**别顺手加 `IsNotEmptyObject`**：`query: {}` 与 `sort: []` 是现有合法调用
   （`logger.api-spec.ts:182-184`、`monitor-user.api-spec.ts:292-294`、`real-data.api-spec.ts:251-253`），
   加上就会被拒。

### 6.3 `sort[].order: false` 要不要特判 —— **要，两个理由**

~~~text
libs/list/src/list.dto.ts:77-80     order: typeof SortOrderValues[keyof typeof SortOrderValues] | false
packages/platform-any/contract/src/pagination.ts:8,19   SortOrder = 'ascend' | 'descend' | false
libs/repository/src/pg-list.builder.ts:117-120          .filter(s => s.order !== false)   ← builder 明确支持 false 语义
apps/admin/src/components/UI/Table/src/utils/index.ts:39-47
   if (sort.some(i => i.order === false)) return sort.filter(i => i.order !== false).map(getBase)
   if (sort.order === false) return []
~~~

- **契约层面 `false` 是合法值**（contract + DTO 类型 + builder 三处都显式支持），
  但 `IsEnum(SortOrderValues)` 的枚举里只有 `ascend`/`descend` ⇒ 一开嵌套校验，
  `order: false` 立刻 400。这是**"契约说允许、校验说不允许"**，必须在改的时候一起处理。
- **当前没有活调用方**：前端 `generateSortParams` 在**发出前**就把 `order === false` 的项过滤掉了
  （`utils/index.ts:39-41,46-47`），api-spec 也不发 `false`。所以是"潜伏的契约不一致"，不是"现存 400"。

**推荐改法**（三选一，推荐第 1 个）：

1. 把 `order` 的校验从 `IsEnum(SortOrderValues)` 改成 `IsIn(['ascend', 'descend', false])`，
   保住"false = 不排序"的既有语义，契约零改动；
2. 或保留 `IsEnum`，但在 `SortDTO` 上用 `ValidateIf(o => o.order !== false)` 跳过 `false`；
3. 或彻底删掉 `false` 支持（contract + DTO 类型 + builder 三处一起删）——这要动 `@walnut/contract`
   快照，**不建议在本轮做**。

---

## 7. clamp 取值与落点

### 7.1 取值：**9999 保持不变**

| 判据 | 证据 |
|------|------|
| DTO 已声明 `max: 9999` | `libs/list/src/list.dto.ts:36` |
| 前端表格默认 10 | `useTableAPIListParams.ts:12-15`（`{page:1,pageSize:10}`） |
| 所有调用方的最大取值 = **100** | `real-data.api-spec.ts:253` `pageSize: 100`；其余 ≤ 50 |
| 全仓无 `pageSize >= 1000` 的调用 | `git grep -E 'pageSize: *[0-9]{4,}' -- apps/server packages apps/admin` → **0 命中** |
| 有没有导出/批量接口复用同一 DTO | **没有**。`git grep -iE "'export'\|/export\|download"` 在 modules/libs 只命中 `log-operate.entity.ts:29` 的枚举字符串 |

⇒ 取 9999 是**零回归**的（比现状严格，比任何现有调用宽松）。不建议顺手降到 100/500：
`real-data.api-spec.ts` 已经用到 100，压到 100 就没余量了。

### 7.2 落点：**DTO + builder 双保险，理由不是"稳妥"而是"覆盖面"**

`pageSize` 的消费点一共 **3 条链**，只有第 1 条经过 builder：

~~~text
1) DB 列表（20 个 /list 中的 18 个）  → pg-list.builder.ts:127-128 → LIMIT/OFFSET
2) 日志文件列表（/app/logger/list）  → libs/app-domain/src/logger/logger.service.ts:53,97-100
                                        pageSize 直接进 slice(start, start + pageSize)
3) Redis 缓存列表（/app/monitor/cache/list） → libs/cache/src/cache.service.ts:30-32,549
                                        pageSize 直接进 slice
~~~

**只改 builder ⇒ logger 与 cache 两个 list 仍然无上限**（它们根本不碰 QueryBuilder）。
所以：

- **DTO 侧（必须）**：`WalnutAdminRequestListPageDTO.pageSize` 的 `max: 9999` 保留不动；
  真正要做的是**让它生效**（即 §6 的 `ValidateNested`）。这是三个 list 共同的上限闸。
- **builder 侧（必须，第二道）**：`buildPgListQueryOptions` 里对 `page`/`pageSize` 做**数值正规化**，
  不依赖上层是否校验过。要处理的是**4 个具体形态**（实测各对应一种故障）：

~~~text
page 非数字（"abc"）      → Number.isFinite 失败 → 回落 1    解 TypeORMError(50000)
page < 1 / skip < 0      → clamp 到 1 / 0                  解 2201X
pageSize < 1             → clamp 到 1                      解 2201W（当前 pageSize=0 还会静默空页）
pageSize > 9999          → clamp 到 9999                   解 LIMIT 1e9
~~~

- 另外建议**同一个 helper 也给 logger / cache 两条链复用**（它们各自有 `page`/`pageSize`
  的解构点，见上），否则下限（0、负数）在非 DB list 上仍是"静默空数组"——不炸但错。

---

## 8. 顺带确认：data-scope 是否共用同一套算子推断

**不共用。改 builder 不需要动 data-scope。** 两个文件的分工：

| 文件 | 角色 | 算子 | 值来源 |
|------|------|------|--------|
| `apps/server/apps/api/src/common/repository/data-scope.ts` | **实体注册表 + 豁免清单 + 查表**，并 re-export 谓词（`:29-38` 明说"纯谓词函数已随 data-scope 模块下沉 `@walnut-server/system`"） | 无（不含 SQL 拼接） | — |
| `apps/server/libs/system/src/data-scope/data-scope.predicates.ts` | **纯谓词构造**（QueryBuilder / FindOptionsWhere 两形态） | 固定 `scopeColumn = :userId`（`:119` 一带）、`deptColumn IN (:...deptIds)`（`:95,138`） | 解析器已展开的 uuid 串 / uuid 数组，类型定型 |

- 两边的 `:54-57` / `:36-39` 是同一段执行语义注释（app 侧是 re-export 说明，libs 侧是本体），
  **不是两份实现**。
- 它们**没有** `typeof value` 分派、没有 `ilike`、没有 `isUuidString` —— 实测
  `git grep -E 'ilike|isUuidString|op ===' ` 在这两个文件里只命中注释。
- 所以本轮的算子分派改造**边界清晰**：改 `pg-list.builder.ts` 即可，
  但注意 `locale.repo.service.ts` 与 `deleted.basic.repository.ts` 各自**复制了**一套分派逻辑，见 §9。

---

## 9. 修的时候最容易踩的 5 个坑

1. **只改 `pg-list.builder` 会漏两个手写者**。`buildPgListQueryOptions` 的输出被三处消费，
   其中两处**自己重新按 `op` 拼了 SQL**：
   - `libs/system/src/locale/repo/locale.repo.service.ts:79,94-117`（`MATCH_COLUMN_MAP` 只收 id/key/createdAt/updatedAt，
     已有列收敛 → 相对安全，但它**自己**又写了一遍 `ilike/eq/range` 分支）
   - `libs/system/src/deleted/deleted.basic.repository.ts:63-75`（`content` 单独走 `::text ILIKE`）
   ⇒ 改 builder 的算子决策时，这两处要么共用新逻辑，要么显式声明"不在范围内"。
2. **`eq` 不等于安全**。把"非字符串一律 eq"当成修法仍然会 500（§1.3 路径 B 的 18 格全是 eq）。
   正确做法是**按列类型决定算子 + 按列类型决定是否放行该值**（uuid 列只接受合法 uuid、时间列只接受
   可解析时间/区间、布尔列只接受布尔、数值列只接受有限数），不合法就**丢弃该条件**（对齐现在
   "未知键静默丢弃"的既有语义）而不是抛。
3. **`range` 的判定不能只看"能不能被 `new Date` 解析**。`[1,2]` 会被判成日期区间（`new Date(1)` 合法）。
   修法应是"**列是时间类型 且** 长度 2 且都能解析"，两个条件同时成立。
4. **别顺手加 `IsNotEmptyObject`**。`query: {}` / `sort: []` 是现存合法调用（§6.2 第 3 条）。
   开 `ValidateNested` 时槽位本身要保持"缺省 / 空对象 / 空数组都合法"。
5. **`total` 语义别被顺手改坏**。`executePgListQuery` 用 `COUNT(*) OVER()`（`pg-list.builder.ts:196-204`），
   4 个覆写里有 2 个带 JOIN（deleted、monitor/user）。若在修算子时改写了 WHERE 的注入方式
   （例如改成子查询），要确认 `total` 仍是"过滤后行数"。这块目前**没有**"JOIN 侧 0 行/2 行时 total 不变"的用例。

---

## 10. 待确认项（我查不清 / 需要别人拍）

| # | 事项 | 为什么需要确认 | 建议 |
|---|------|---------------|------|
| 1 | `AppLoggerDTOListRequest` 的 `sortOnlyIn` 回退白名单是否包含 `fileMTime` | 它没传 `sortOnlyIn`（`logger.dto.ts:59`），回退成 `Object.keys(plainToInstance(dto, {}))`；若 `fileMTime` 不在 `AppLoggerDTO` 上，开嵌套校验后 `logger.api-spec.ts:95` 会 400 | 开校验前先跑一次 logger 用例，或给该 DTO 补 `sortOnlyIn: ['fileName','logType','fileMTime',...]` |
| 2 | 目标语义：非法值该"丢弃条件"还是"400 拒绝"？ | 现状是**丢弃**（未知键/未知 sort 字段都静默丢），而"拒绝"更符合"契约即真相"。影响改造范围（前者只动 builder，后者要动校验层） | 倾向**丢弃**（对齐既有语义、零回归），并对"明显非法"（如 uuid 列收到非 uuid）记 warn 日志 |
| 3 | 是否本轮就把 `total` 的 JOIN 放大测试补上 | 与 P0 止血不直接相关，但同属 list 查询层 | 建议单独排 P2 |

---

## 11. 前置结论（给 Lead 决策用）

1. **P0 是真的，而且比报告里写的更宽**：不是"字符串打到非文本列"一条路径，而是
   **"值的 JS 类型与列类型不匹配"全谱**——实测 30 格里 **23 格**产生 PG 错误
   （42883 / 22P02 / 22007 / 22008 四种码，合计 **22 / 30 格**），只有 text 与 varchar 列全形态安全。
2. **观测口径必须改成 `body.code`**：全局过滤器永远 `HTTP 200`（`exception.filter.ts:93`），
   崩溃表现为 `code:50000`，校验拒绝表现为 `code:40099`。写验收用例断 HTTP status 会永远"通过"。
3. **影响面量化**：18 张 list 表 **230 列 / 139 个非文本列**（uuid 39、timestamptz 37、布尔·数值 51、jsonb 12）
   都在这条路上；而 `text`(71)+`varchar`(20) 安全 —— 这也是"平时没人发现"的原因：admin 的查询面以文本模糊为主。
4. **上一轮的一条 P1 判断要撤**：「`page` 半传 ⇒ OFFSET NaN」**不成立**（嵌套 transform 会逐字段补默认值）。
   真正的 NaN 入口是 `page.page` 非数字；其次是负值（2201X / 2201W）与 `pageSize=0` 静默空页。
   ⇒ 修 page 时**不要**去动 `@Type`/`default` 那套（它是对的），只需在 builder 里做数值正规化。
5. **开 `ValidateNested` 的回归面很小但不为零**：现有 20 处 list 请求体全合法，唯一雷是
   `sort[].order: false`（契约与 DTO 类型允许，`IsEnum` 不认）和 **`AppLoggerDTOListRequest` 缺 `sortOnlyIn`**。
   另有一个反向陷阱：**别顺手加 `IsNotEmptyObject`**，`query:{}`/`sort:[]` 是现存的合法调用。
6. **clamp 必须双落点**：`pageSize` 有 3 条消费链，只有 1 条经过 builder（logger 与 cache 直接在内存里 slice）。
   只改 builder ⇒ 两个 list 仍无上限。DTO 开校验 + builder 正规化缺一不可；上限保持 **9999**（零回归，最大实际调用是 100）。
7. **改造别漏两个手写 SQL 者**：`locale.repo.service.ts` 与 `deleted.basic.repository.ts` 各自复制了一套
   `ilike/eq/range` 分派 —— 只改 builder 会让它们与主线语义分叉。
8. **"把非字符串一律改成 `eq`"是错的修法**：实测 `eq` 这一路 18 格里仍有 **9 格** 500
   （uuid 列收到 `"123"` ⇒ 22P02、timestamptz 收到 `true` ⇒ 22007、smallint 收到 `"123"` ⇒ 22P02）。
   正确修法是**按列类型决定算子 + 按列类型校验值**，单换算子不够。
