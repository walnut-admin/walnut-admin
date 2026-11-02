# R3 后端独立复查 · 批次 1（P0 止血）

> 复查人：b1-r3-be（独立视角，未参与 R1 / R2）
> 基线：工作树（HEAD `190a4c5d` + 两批在途改动）。**只审 `apps/server/` 那一批**；`apps/admin` / `apps/docs` / `packages/*` 未触碰。
> 方式：**实测优先** —— 真 TypeORM QueryBuilder + 真 PG（PostgreSQL 18.6，本机 5432，与 R1 同一个库）跑矩阵；临时 spec 3 个（跑完已删除，见附录）；未改任何源码。

---

## 0. 结论（先看）

| 项 | 结果 |
|---|---|
| **能不能提交** | **可以**（0 个 P0 / 0 个 P1；5 个 P2 建议在批次 2 顺带修，不阻塞） |
| 偏离 A（query 不开嵌套校验） | **可接受**：P0 实测被兜住（22 格 0 泄漏到 PG），且我独立复现了「开了会 400」的 9 条现存请求 |
| 偏离 B（default.ts 实例化） | **安全**：影响面机械收敛到 `list.dto.ts` 5 个字段（全 req-only，响应侧不经过）；19 个 list DTO 实测不会凭空多出 WHERE |
| R2 自述的门禁 | 5 项**全部复现成功**（79 files / 665 tests、lint、types、boundaries、openapi 零 diff） |
| R2 报告的口径错误 | 3 处（默认排序漏报 1 个端点、「9/20」的失败清单已过期、分页常量并非单一真源）→ 见 §4 / §5 / §9 |
| 有没有让别的门禁/约定失效 | **没有**。但有两处**门禁看不见的退化**：注释与实现相反、单一真源只写在注释里（§10） |

---

## 1. 门禁复跑（与 R2 的自述逐项对账）

| 门禁 | R2 自述 | 我复跑的命令与结果 | 一致？ |
|---|---|---|---|
| 单测 | 79 files / 665 tests passed | `cmd /c "pnpm --filter @walnut/server test"` → **79 passed (79) / 665 passed (665)**，exit 0，52.8s | ✅ 逐字一致 |
| 类型 | exit 0 | `pnpm types:check`（cwd `apps/server`）→ `tsc --noEmit --pretty` 无输出，exit 0 | ✅ |
| Lint | 0 error / 0 warning | `pnpm lint` → exit 0（**第一次红是我自己的临时 spec 触发 `prefer-template`，删掉后复跑为绿** —— 记录在此以免误读） | ✅（清理后） |
| 边界 | 4645 files / 15 packages | `pnpm boundaries` → `Checked 4645 files in 15 packages, no issues found`，exit 0 | ✅（但见 §6：它不覆盖 server 内部 lib 层） |
| OpenAPI | 零 diff（220 schemas） | `pnpm --filter @walnut/server openapi:export` → `written openapi.json (openapi 3.0.0, 220 schemas)`；`git status` / `git diff --stat` 对 `openapi.json` 与 `api/schema.d.ts` **均为空** | ✅ 零 diff 复现 |

**没有一项「R2 说绿我复现不出来」。**

---

## 2. 偏离 A：`query` 槽位不开嵌套校验 —— P0 到底有没有被兜住

### 2.1 我用的验证方式比 R2 更硬：真 TypeORM QueryBuilder + 真 PG

R2 的矩阵只测 `resolvePgListCondition()`（纯函数）。我改成**全链路**：`ds.createQueryBuilder(SysDeviceEntity,'entity')` → `buildPgListQueryOptionsFromQb` → `applyPgListQuery` → `qb.getQueryAndParameters()` → **把这条真 SQL 发给真 PG 执行**。这样测的是「最终到数据库的那条语句」，而不是中间产物。

矩阵 36 格（R1 的 30 格 + 我补的 6 格 jsonb 对象 / text[] 数组等变体），实测输出（节选，完整 36 行在附录 B）：

~~~text
deviceName str      R1err=n warn=0 where="entity"."device_name" ILIKE $1        -> PG-OK
id         str      R1err=Y warn=1 where=(none)                                  -> no-where
active     str      R1err=Y warn=1 where=(none)                                  -> no-where
deviceInfo str      R1err=Y warn=1 where=(none)                                  -> no-where
createdAt  str      R1err=Y warn=0 where="entity"."created_at" = $1             -> PG-OK
riskScore  str      R1err=Y warn=1 where=(none)                                  -> no-where
createdAt  arr-date R1err=n warn=0 where="entity"."created_at" >= $1 AND ... < $2 -> PG-OK
riskScore  arr-num  R1err=Y warn=0 where="entity"."risk_score" IN ($1, $2)     -> PG-OK
...
LEAKED_TO_PG=0
~~~

- **22 个 R1 报错格里 21 格 → 丢弃 + warn（`where=(none)`）**；1 格（timestamptz 收标量日期串）→ 被正确解释成 `= $1` 并 PG 接受。**0 格产生 PG 错误**。
- 兼容路径（不传 resolver，走旧 typeof 推断）我也跑了同一套 36 格：**LEAKED_TO_PG=0** —— `applyPgListQuery` 用 `condition.raw` 重裁决确实兜住了（`pg-list.builder.ts:224-231`）。
- 「丢弃 + warn」确实发生了：每格 `warn=1`（我用 `Logger.prototype.warn` 的 spy 计数，不是看日志文本）。

### 2.2 我独立复现了「开了嵌套校验会 400」这条前提（不靠 R2 的自述）

做法：不改源码，直接**只校验 `query` 子对象**（等价于给该槽位挂 `nestedWhenPresent`），把 `list-request-validation.spec.ts` 的 25 条真实请求体跑一遍：

~~~text
demo.list                     FAIL 1 demoString[isUppercase]
logger.list(fileMTime)        FAIL 1 logType[isEnum,isNotEmpty]
logger.list(query={})         FAIL 2 fileName[isString,isNotEmpty] logType[isEnum,isNotEmpty]
setting.list                  FAIL 1 settingType[isEnum,isNotEmpty,isArray]
monitor.user.list             FAIL 1 ip[isString,isNotEmpty]
monitor.user.list(query={})   FAIL 1 ip[isString,isNotEmpty]
dict.data.list                FAIL 1 tagType[isEnum,isNotEmpty,isArray]
log.auth.list                 FAIL 1 type[isEnum,isNotEmpty,isArray]
log.operate.list              FAIL 1 operatedAt[isNotEmpty,isDateString,isArray]
FAILED=9/25   （其余 16 条 PASS）
~~~

⇒ **R2 的核心前提成立**：query 的基座是「带必填字段 + 创建语义值域」的实体 DTO，直接下钻会把现存调用打 400。按请求体 **9 条**、按端点 **7 个**（`demo / logger / setting / monitor.user / dict.data / log.auth / log.operate`）。

**R2 那张表有两条已经过期**（它写的是加 `default.ts` 修复**之前**的状态）：`POST /system/deleted/list`（`deletedAt` range）与 `POST /system/dept/list`（`unknownValue`）现在都 PASS。所以「9/20」这个数字只对「请求体条数」成立，端点数是 7。

### 2.3 仍然可能有害的入参形态（逐条给证据 + 是否有放大）

| # | 形态 | 实测行为 | 有没有放大风险 |
|---|---|---|---|
| 1 | uuid 列收 `"abc"` | 丢弃 + warn → **返回全量而不是报错**（静默过度返回） | **无越权放大**：过滤条件是客户端自选的，数据权限（`applyDataScope`）与端点权限独立注入、不经过 `query`；用户不带该条件本来就能拿到同一批行。风险只在 UI 语义（「按 id 查」变成「返回全部」） |
| 2 | 布尔列收 `1` / `0` | **从「能过滤」退化成「丢弃」**（R1 矩阵里 `active num 1` 是 `eq` 且 PG 接受；现在 `resolvePgListCondition('boolean',1)` 返回 undefined） | 静默过度返回（同上，不跨权限边界）。当前 admin 与 api-spec 都发真布尔，属**潜在**而非现存 |
| 3 | 手写 `match` 无 `raw` | 只按 `op × kind` 放行，值本身不校验 ⇒ 例如 `{id:{op:'eq',value:'not-a-uuid'}}` 会生成 `uuid = $1` → 22P02 → 500 | **当前不可达**：`grep "match: {"` 在非 spec 代码里 **0 命中**，且 `extraMatch` 的 8 个调用点全给空表（7 个用 `buildPgListQueryOptionsFromQb(qb, params)` —— 第三参缺省 `{}`；1 个（locale）显式传 `{}`） |
| 4 | `page` 极大 | `normalizeListPage` 不设上界，但 DTO 的 number 校验默认 `max: Number.MAX_SAFE_INTEGER`（`number.validator.ts:24,63-65`）⇒ HTTP 上 page ≤ 9.007e15 → OFFSET ≤ 9.007e16，**PG 接受**（我实测 `OFFSET 90071992547409900` → PG-OK） | 只剩「大 OFFSET 全表扫」的慢查询面（P3）。**OFFSET 溢出不可达**：`page=9.3e17` 会 22003，但被 DTO `max` 先拦下 |
| 5 | 狂发非法过滤值 | 每个被丢弃条件 1 条 `warn`，且日志里带 `raw` 前 120 字符 | **日志放大**：客户端可每请求刷 N 条 warn（含查询原值）。见 P2-5 |

### 2.4 结论 + 批次 4 收口判据（可机械验收）

**这个偏离可接受。** 理由不是「相信 R2」，而是三条实测：① 22 格 0 泄漏（含兼容路径）；② 开校验会 400 掉 9 条现存请求；③ 丢弃只发生在「值无法按列类型解释」时，而数据权限不经过 `query`，所以不跨权限边界。

批次 4 收口时按这 5 条验收（每条都能机械判绿）：

1. **8 个 query 基座 DTO 改全可选**（`RealPartialType` 或专用 filter DTO），然后给 `query` 槽位挂 `nestedWhenPresent: true`；
2. `apps/api/src/common/list-request-validation.spec.ts` 里那 9 条从 FAIL 转 PASS（用例名我已在上表列出）；
3. `sort[].priority` 的必填口径二选一并写进契约：保留必填（openapi 已 `required`）或在 `SortDTO` 上给 `default: 1`（后者会改 openapi）；
4. `warnDroppedPgListCondition` 换成「采样 + 计数指标」或降到 debug（现在 warn 级 + 带原值）；
5. `applyPgListQuery` 的无 `raw` 兼容分支要么补「调用方必须提供 raw」的运行时断言，要么直接删（当前零调用方）。

---
## 3. 偏离 B：`default.ts` 全局实例化 —— 回归面到底多大

### 3.1 影响面先机械收敛：全仓只有 1 个文件开过 `defaultTransform`

`grep defaultTransform`（非 spec，全 `apps/server`）命中的**生产者**只有 `libs/list/src/list.dto.ts` 5 处（`:25 :39 :117 :148 :165`），其余命中是类型声明、工具函数本体与注释（`menu.dto.ts:190`）。

- `object.transformer.ts:34-35` 的 `defaultReqOpt()` / `defaultResOpt()` **都不设** `defaultTransform` ⇒ 不显式传就没有 Transform，`key.dto.ts:134` 的 `meta: AppKeyMetaType, default: {}`、`user_preference.dto.ts:81` 的 `layout: Object, default: {}` 都**不受影响**（后者 `obj === Object` 本来就不会实例化）。
- list 的 5 处全是 **req-only**（`transformOptions: { req: { defaultTransform: true } }`），`res` 未设 ⇒ `toPlainOnly: false` ⇒ **响应侧（classToPlain）根本不执行这个回调**。所以「响应侧被改坏」这条我判定为**不成立**，且是机械理由，不是抽样推断。

### 3.2 19 个 list DTO 的实测：空 body 时 `query` 不含任何非 nil 值（不会凭空多出 WHERE）

风险点本来在这里：`query` 的默认值 `{}` 被实例化成 DTO 后，`Object.keys(query)` 从 0 变成「实体 DTO 的全部字段」；如果某些字段的默认值**不是 null/undefined**，`buildPgListQueryOptions` 的 `isNil` 就跳过不了 → 每个请求都多几个 WHERE。实测：

~~~text
AppDemoDTOListRequest          q.keys= 18 q.nonNil= 0 page={"page":1,"pageSize":10} sort=[]
AppLoggerDTOListRequest        q.keys=  2 q.nonNil= 0 page={"page":1,"pageSize":10} sort=[]
AppMonitorCacheDTOListRequest  q.keys=  6 q.nonNil= 0 page={"page":1,"pageSize":10} sort=[]
AppSettingDTOListRequest       q.keys=  8 q.nonNil= 0 ...
SysDeviceDTOListRequest        q.keys= 20 q.nonNil= 0 ...
SysLogOperateDTOListRequest    q.keys= 23 q.nonNil= 0 ...
...（19 个全部同型）
NON_NIL_OFFENDERS=0
~~~

再把这 19 个实例丢进真 QueryBuilder：`matchKeys=0 / wheres=0`（`{}` 与 `{query:{}}` 两种入参都一样）。**客户端给的值也不丢**（`query.deviceName="iPhone"` 保留）。

⇒ 偏离 B 的**运行时语义**是安全的：`query` 变成「全 nil 键的 DTO 实例」，而 builder 的第一步就是 `isNil` 跳过（`pg-list.builder.ts:105-107`）。

### 3.3 真正变了的三处（都无害，但要知道）

| 变化 | 证据 | 影响 |
|---|---|---|
| `query` 从 `cloneDeep({})`（空 plain object）变成 DTO 实例（20 键全 null） | 上面实测 | `SysDeletedBasicRepository` 先 `{...params.query}` 再 `delete query.content`（`deleted.basic.repository.ts:64-66`）→ 作用在副本上，不污染实例；`logger.service`/`cache.service` 对 null 都是 falsy/`isNil` 分支 → 无影响（`logger.service.ts:61`、`cache.service.ts:43-48`） |
| `page` 缺省值变成 `WalnutAdminRequestListPageDTO` 实例 | 实测 `ctor=WalnutAdminRequestListPageDTO` | 这是**修复的前提**：不实例化，`ValidateNested` 会对「什么都没传」报 `unknownValue` |
| `sort` 缺省仍是 `[]`（不是实例） | 实测 `sort=[]` | `default.ts` 的 `isArray` 分支在 `isNil` 时直接返回 `[]`，没有走实例化 |

### 3.4 缺口：这个改动**没有直接单测**

`default.ts` 目前只被 `list-request-validation.spec.ts:212-217` 间接覆盖（`{}` / `{sort:[]}` / `{query:{}}` / `{page:{}}` 四种不 400）。一旦有人再动 `default.ts`（例如给对象默认值加 key 过滤），**没有任何用例会红**。建议补 1 个 `libs/decorators/.../default.spec.ts`：① 缺省对象 → `instanceof` 目标类；② `isArray` + 缺省 → `[]`；③ `obj === Object` 不实例化；④ 已有值不被覆盖。

---

## 4. 默认排序变化：R2 只报了 1 处，实测是 **2 处**

旧实现把默认排序**硬编码**成 `{ createdAt: 'DESC' }`（`git show HEAD:.../pg-list.builder.ts` 的 `defaults.sort`），再由 `applyPgListQuery` 的 `columns.has()` 过滤 —— 实体没有 `createdAt` 列时**一个 ORDER BY 都不生成**。新实现走 `defaultPgListSort`（`pg-column-op.ts:187-205`）：`createdAt` → `deletedAt` → 主键。

| 端点 | 实体 | 有 createdAt？ | 旧 ORDER BY | 新 ORDER BY | R2 登记？ |
|---|---|---|---|---|---|
| `POST /system/deleted/list` | `SysDeletedEntity` | ❌（只有 `deletedAt`，`entities/deleted.entity.ts:46-47`） | 无 | `deleted_at DESC` | ✅ 已登记 |
| `POST /app/monitor/user/list` | `AppMonitorUserEntity` | ❌（`firstVisitAt` / `lastActiveAt`，`monitor-user.entity.ts:44-48`） | 无 | **`entity."id" DESC`** | ❌ **漏报** |
| 其余 15 个 DB list（user/device/role/dept/post/menu/employee/lang/locale/dictType/dictData/logAuth/logOperate/demo/setting） | 各有 `createdAt`（role 的实体在 `libs/identity/src/shared/sys-role.entity.ts:36`，是 re-export） | ✅ | `created_at DESC` | `created_at DESC`（不变） | — |
| `POST /app/logger/list` / `POST /app/monitor/cache/list` | 非 DB（内存 slice） | — | 各自实现 | 只改了分页正规化，排序未动 | — |

另外两类**输入相关**的变化（不是固定端点）：

1. **未知 / 不可排序的 sort 字段**：旧行为是「把默认排序整体清空 ⇒ SQL 无 ORDER BY」；新行为是「丢弃该项并回落默认排序」（`pg-list.builder.ts:151-154, 162-164`）。修复了 R1 §4 的翻页重复隐患。
2. **`order: 'ASC'`（大写）/ `'asc'`**：旧行为静默当 DESC，新行为正确 ASC（`normalizeSortOrder`）。

### 4.1 `data[0]` 断言逐个核对：**没有一条会因顺序变化而变脆**

`grep "data\[0\]" apps/server/apps/api/test` → **48 处**。落在两个「顺序变了」的端点上的只有 2 处，且都先断言了唯一性：

~~~text
deleted.api-spec.ts:180-187      query {content: "<group>-R1"} → expect(list.total).toBe(1) → data[0].deletedId
monitor-user.api-spec.ts:180-189 query {visitorId: visitorB} + sort firstVisitAt → expect(list.total).toBe(1) → data[0].visitorId
~~~

另：`deleted.api-spec.ts:145-153` 的第一个 list 调用用 `.find(...)` 而非 `data[0]`，且新排序（最新删除在前）反而让它更容易落在第一页。

其余 46 处的归类：① 过滤到唯一行（按 id / userName / deptCode / deviceId / postCode 等）；② 显式给了 `sort`（`pg.base-repository.int-spec.ts:209`）；③ 走内存列表（logger / cache，排序不经过 builder）；④ 断言的是行内字段而非行序（如 `roles_count`）。**没有一处依赖未声明的行序。**

### 4.2 我**没有**跑 api-spec / int-spec（说明理由）

`vitest.config.integration.ts` 的 global-setup 会 **drop 并重建**本地库（R2 §4 也提到）。本轮是只读复查，我不愿在你的开发库上做破坏性操作，所以采用「静态核对 48 处断言 + 真 PG 上按新 SQL 形态执行」的方式。**这两条端点的真实 HTTP 行为仍建议在 CI 的 integration 阶段兜一次**。

另附一条 P3 提示：`sys_deleted.deleted_at` 在迁移里是 `NULL`-able（`InitSchema.ts:601`），当前写入路径恒赋值（`deleted.repo.pg.service.ts:56` `deletedAt: new Date()`），但若有历史/ETL 行是 NULL，PG 的 `DESC` 默认 `NULLS FIRST` 会把它们排到**最前**。要不要改成 `NULLS LAST` 属产品口味，本轮不改。

---
## 5. 「单一真源」是否真的单一

### 5.1 ILIKE 字面量转义：**是**（唯一实现，零重复）

全仓 `replace(...ILIKE_ESCAPE_REGEX...)` 只剩 `pg-column-op.ts:106` 一处；`grep ILIKE_ESCAPE_REGEX` 的非 spec 命中是「定义 1 + re-export 2」（`pg-list.builder.ts:45`、`repository/src/index.ts:8`），**没有任何消费者自己再转一遍**。R2 说的「顺带收掉 device.service 的内联转义」也核实了（`device.service.ts:171-181` 改走 `escapeLikePattern`）。

### 5.2 算子分派：**主线单源；另有 4 处「非实体列表达式」的必要旁路**

| 位置 | 性质 | 判定 |
|---|---|---|
| `pg-column-op.ts:269-364` | 唯一的 `kind × value → op` 分派 | 真源 ✅ |
| `pg-list.builder.ts:233-257` | 按 `op` 渲染 SQL（不判类） | 渲染层 ✅ |
| `locale.repo.service.ts:108-141` | `match` 由 `buildPgListQueryOptions(...)` 产出，再用 `isPgListOpAllowed` 兜一层，然后按 `op` 渲染 | ✅ 不构成第二处判类；列名走 `MATCH_COLUMN_MAP` 白名单（`:109-112`）→ 无注入面 |
| `deleted.basic.repository.ts:73-76` | `content::text ILIKE` —— jsonb 转文本后的**表达式**，实体列类型是 `json`，判类器本来就不会产出 ilike | ✅ 必要旁路 |
| `device.service.ts:171-181` | `location_info->>'country'` 三个 jsonb 提取表达式 | ✅ 必要旁路（同上） |
| `monitor/user/user.basic.repository.ts:58-68` | `device.ip` / `monitor_user.user_name` 等 **JOIN 别名**（不是主别名实体列） | ✅ 必要旁路（判类器看不到别名） |

⇒ 「除了 `pg-column-op` 之外没有第二处在分派算子」**成立**；那 4 处旁路是「表达式不是实体列」的必要出口，且都复用同一条转义。**3 个消费者都真的走了它**：`pg-list.builder`（6 个调用点 + 1 个 locale 显式 resolver）、`locale.repo.service`、`deleted.basic.repository`（+ `device.service` 的转义收编）。

### 5.3 但「分页常量单一真源」只是注释，不是构造 —— 两处 `9999`

~~~text
libs/list/src/list.dto.ts:36      validateOptions: { int: true, min: 1, max: 9999, positive: true }
libs/utils/src/list-page.ts:33    export const WALNUT_LIST_PAGE_SIZE_MAX = 9999   // 注释写「与 list.dto.ts:36 同源」
~~~

两份字面量、零机械同步。`libs/list`（tech-assemble）**可以** import `@walnut-server/utils/list-page`（infra，方向合法），改掉它 openapi 也不变（值仍是 9999）—— 也就是说这个「同源」本来就能做成真的，只是没做。见 P2-3。

### 5.4 同一符号两条导入路径（P3）

`normalizeListPage` 既从 `@walnut-server/utils/list-page` 导入（`cache.service.ts:5`、`logger.service.ts:9`），也从 `@walnut-server/repository` 导入（`locale.repo.service.ts:8`，因为 `repository/src/index.ts:47-53` 做了 re-export）。方向合法（向下 re-export），但「同一个东西两个入口」会在 grep 时漏掉一半调用方。

---

## 6. 分层：合法，且门禁实测通过

- 现状 `eslint.config.ts:20-22` 已把技术层拆成 **tech-base**（als/blpath/cookie/crypto/delay/lock/queue/sse/cache/throttle/mailer/sms/rsa/ip）与 **tech-assemble**（repository/list/crud/scope-resolver/token），`:120-121` 两条 `layer()` 分别禁上层。
- `libs/utils/src/list-page.ts` 落在 `INFRA_LIBS`（`utils`）→ `cache`（tech-base）/`repository`（tech-assemble）/`app-domain`（top）引它**全部向下**，无反向依赖。
- `pnpm lint`（含 `local/no-cross-lib-relative-import` + 分层 `no-restricted-imports`）**exit 0** → 分层门禁对这批改动是绿的（我第一次的红是我自己临时文件造成的，见 §1）。
- `pnpm boundaries` exit 0，但注意它是 **turbo 的 workspace 包边界**（`Checked 4645 files in 15 packages`），**看不到 server 内部 34 个 lib 的层** —— lib 层由 eslint 守。别把 boundaries 的绿当成 lib 分层的证据（这条建议写进 AGENTS 或报告模板）。

---

## 7. 测试是否真在测（有没有同义反复）

### 7.1 贴 3 段关键用例原文

**(a) 矩阵用例 —— 真断言，不是同义反复**（`pg-column-op.spec.ts:100-112`）：

~~~ts
it.each(rows)('$kind / $form → $expectedOp?', ({ kind, raw, expectCondition, expectedOp }) => {
  const condition = resolvePgListCondition(kind, raw)
  if (!expectCondition) { expect(condition).toBeUndefined(); return }
  expect(condition).toBeDefined()
  expect(condition!.op).toBe(expectedOp)                       // 具体算子
  expect(isPgListOpAllowed(condition!.op, kind)).toBe(true)     // 兼容性不变式
})
~~~

**(b) 「永不抛」不变式 —— 半句弱、半句真**（`pg-column-op.spec.ts:143-151`）：

~~~ts
for (const kind of kinds) {
  for (const raw of values) {
    expect(() => resolvePgListCondition(kind, raw)).not.toThrow()   // ← 这半句近乎永真
    const condition = resolvePgListCondition(kind, raw)
    if (condition !== undefined) {
      expect(isPgListOpAllowed(condition.op, kind)).toBe(true)      // ← 真断言，但用实现验证实现
    }
  }
}
~~~

判定：**不是同义反复，但是自证** —— `isPgListOpAllowed` 同时是 SQL 层的闸，闸写错了两边一起错。我用「真 PG 执行」补上了这个盲区（§2.1，结果一致）。

**(c) 这条是纯同义反复**（`pg-column-op.spec.ts:260-265`）：

~~~ts
it('warnDroppedPgListCondition 只记 warn，不抛', () => {
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  expect(() => warnDroppedPgListCondition('id', 'uuid', 'abc', '值无法按列类型解释')).not.toThrow()
  spy.mockRestore()
})
~~~

三个问题：① 一个 `logger.warn` 调用**不可能**抛，`not.toThrow()` 恒真；② spy 打在 `process.stderr.write`，而 Nest `Logger` 走 `console`/`process.stdout` —— 这个 spy 大概率连一次都没被调用；③ 从不 `expect(spy).toHaveBeenCalled()`。**这条用例零信息量**（P3-11）。

### 7.2 覆盖面缺口（比同义反复更值得在意）

1. **没有一条用例断言「丢弃时确实 warn 了」** —— 「丢弃 + warn」是这次的对外口径，却只有丢弃被断言。我实测每格 `warn=1` 成立，但仓库里没有门禁守它。
2. **没有一条用例测「真 SQL 能跑」** —— 全部停在 fake qb / 纯函数层。也就是说：如果 `applyPgListQuery` 拼错列名、或类型兼容但 PG 不认，单测全绿（我的 real-qb 矩阵发现这条盲区在本轮**恰好没踩到**）。建议把「真 QB + `getQueryAndParameters()`（不执行）」的 3-5 条用例固化进 `pg-list.builder.spec.ts` —— 零 DB 依赖，能挡住列名/占位符类回归。
3. `list-request-validation.spec.ts` 覆盖了 23 条真实请求体（很好），但**没覆盖**：`sort` 项缺 `priority`、`query` 塞未声明键、`sort: {}`（对象而非数组）。前两条正是本轮新出现的 400 面（见 P2-4）。

---

## 8. openapi 零 diff（实测）

~~~text
$ cmd /c "pnpm --filter @walnut/server openapi:export"
[export-openapi] written ...\apps\server\openapi.json (openapi 3.0.0, 220 schemas)
$ git status --porcelain -- apps/server/openapi.json packages/platform-web/api-types/src/schema.d.ts
（空）
$ git diff --stat -- 同上
（空）
~~~

改动确实只落在**入参校验**与**查询层**，没碰 swagger 面。注：`SortDTO.priority` 在 openapi 里**本来就是 `required`**（`openapi.json` 的 `SortDTO.required = ["field","order","priority"]`），所以 §P2-4 的「变成必填」与既有契约一致，不是新造的不一致。

---
## 9. 发现清单

### P0（0 条）

无。P0 目标（list 入参把 500 打出来）实测已封：22 格 0 泄漏（§2.1），且分页 4 种脏形态全部收口（`list-page.spec.ts` + 我的 real-qb 复跑一致）。

### P1（0 条）

无。下列 P2 都不构成「不能提交」。

### P2（5 条）

**P2-1 `POST /app/monitor/user/list` 的默认排序变了，但报告只登记了 deleted**

- **证据**：`AppMonitorUserEntity` 无 `createdAt`/`deletedAt`（`monitor-user.entity.ts:44-48` 是 `firstVisitAt`/`lastActiveAt`）⇒ `defaultPgListSort` 退到主键 ⇒ `applyPgListQuery:260-273` 落 `addOrderBy(entity.id, DESC)`。旧实现默认 `{createdAt:'DESC'}` 被 `columns.has()` 过滤 ⇒ **无 ORDER BY**。
- **影响**：可见顺序由「不确定」变成「id DESC（uuid 随机但稳定）」。测试不脆（该端点仅 1 处 `data[0]`，先断言 `total===1`）。
- **建议**：在批次 2 的交付说明里补一行；若要「业务上有意义」的默认序，应显式给 `firstVisitAt DESC`（需产品确认）。**S**

**P2-2 R2 §3 的「9/20」失败清单已过期**

- **证据**：我的等价复跑显示失败 **9 条请求体 / 7 个端点**；R2 表里的 `deleted.list`（`deletedAt` range）与 `dept.list`（`unknownValue`）现在 **PASS**（前者本来就没传区间、后者已被 `default.ts` 修复）。
- **影响**：批次 4 排期时会高估两个端点的改造量；也容易让人以为 `default.ts` 没生效。
- **建议**：报告表更新为实测清单（我可以提供逐条输出）。**S**

**P2-3 分页上限 `9999` 有两份字面量，「单一真源」只写在注释里**

- **证据**：`libs/list/src/list.dto.ts:36` 的 `max: 9999` 与 `libs/utils/src/list-page.ts:33` 的 `WALNUT_LIST_PAGE_SIZE_MAX = 9999`；后者注释写「同源」，但无 import、无 drift spec。`WALNUT_LIST_PAGE_DEFAULT`/`_SIZE_DEFAULT` 同样只有 list-page 自己用。
- **影响**：改一处漏一处时，DTO 校验与 builder clamp 会分叉（例如 DTO 放到 20000 而 clamp 仍 9999 → 静默截断）。
- **建议**：`list.dto.ts` 改引 `@walnut-server/utils/list-page` 的常量（方向合法、openapi 值不变）。**S**

**P2-4 `sort[].priority` 从「可选且被忽略」变成「必填」**

- **证据**：`list.dto.ts:85-89` 的 `priority` 一直声明 `int: true, positive: true`（无 default）；`sort` 槽位一挂 `nestedWhenPresent`（`:145`），它就真的生效了。实测：`sort:[{field:'createdAt',order:'ascend'}]` → 400 `priority[isNumber,isNotEmpty,isPositive,isInt]`；`priority: 0` → 400 `isPositive`。
- **影响**：与 openapi 的 `required` 一致（不是契约漂移），admin 侧恒发（`Table/src/utils/index.ts:35` `multiple ?? 1`，全仓 `multiple:` 取值 1–6 均 ≥1）⇒ **现存 UI 不会 400**；但任何第三方脚本/老客户端按「priority 可选」写的请求会开始 400。`args.priority` 在 builder 里一直有 `?? 0` 兜底，说明历史上是允许缺省的。
- **建议**：二选一并写进口径 —— (a) 认了（契约即真相，openapi 早已 required）；(b) 给 `SortDTO.priority` 补 `default: 1`（注意会改 openapi，需重导出）。**S**

**P2-5 丢弃条件时每条 warn 都带原值 ⇒ 可被客户端拿来做日志放大**

- **证据**：`pg-column-op.ts:384-394` 的 `warnDroppedPgListCondition` 用 `logger.warn`，并把 `raw` 截 120 字符打进日志；调用点 3 处（`pg-list.builder.ts:128`、`:229`、locale 由前者覆盖）。一次请求带 N 个非法过滤值 = N 条 warn。
- **影响**：① 日志文件（`logs/`）可被刷；② 过滤值进日志（可能是手机号/邮箱等查询词）。这不是安全漏洞，但与本仓「日志脱敏」的既有口径（`maskSensitiveFields`、上一轮 F-06）不一致。
- **建议**：改成「每请求最多 1 条汇总 + 计数」，或降到 `debug` 并把 `raw` 只留类型与长度。**S**

### P3（6 条）

**P3-6 `ILIKE_ESCAPE_REGEX` 成了死 API**

`pg-column-op.ts:103` 定义、`pg-list.builder.ts:45` 与 `repository/src/index.ts:8` re-export，但**非 spec 消费者 0**（全部改用 `escapeLikePattern`）。保留只为「旧 import 面兼容」，建议下一轮删（或标注 deprecated）。

**P3-7 无 `raw` 的手写 `match` 通道仍在**

`pg-list.builder.ts:224-226`：没有 `raw` 时只按 `op × kind` 放行，值不校验。当前**零生产调用点**（`match: {` 非 spec 命中 0、`extraMatch` 8 个调用点全给空表），但它是公开 API 面 → 未来手写 `match` 会绕过本轮的兜底。建议加运行时断言或删（§2.4 判据 5）。

**P3-8 布尔列收到 `1`/`0` 从「能过滤」变成「静默丢弃」**

`resolvePgListCondition('boolean', 1)` → undefined（`pg-column-op.ts:317-325` 只认 `boolean` / `'true'` / `'false'`）；R1 矩阵里该格是 `eq` 且 PG 接受。⇒ 传 1/0 的客户端会「过滤失效、拿到全量」。当前 admin 与 api-spec 都发真布尔，属潜在。可选修法：`raw === 1 / 0` 视作 `true/false`（一行）。

**P3-9 通过 HTTP 可达的最大 OFFSET 仍很大（慢查询面）**

`page` 无业务上界，DTO 的 number 默认 `max = MAX_SAFE_INTEGER` 兜住溢出但拦不住「9e15 页」→ OFFSET 9e16 让 PG 扫全表。实测 PG 接受（不报错）。若要收，建议在 `normalizeListPage` 里给 `page` 一个业务上限（例如 1e6）——**不要**改 DTO 的 `max`（那会改 openapi）。

**P3-10 同一符号两条导入路径** —— 见 §5.4。

**P3-11 测试缺口三处** —— `warn` 用例零信息量；无「真 QB 渲染」用例；`list-request-validation.spec.ts` 未覆盖 `priority` 缺失 / `query` 未知键 / `sort: {}`（§7.2）。另：`default.ts` 无直接单测（§3.4）。

---

## 10. 一句话回答：这次改造有没有让别的门禁/约定失效？

**没有。** 五道门禁（单测 / 类型 / lint(含 lib 分层) / boundaries / openapi）我全部亲手复跑为绿，且都能复现 R2 的数字。

但有两处**退化是门禁看不见的**，所以只能靠人看：

1. **注释与实现相反**：`libs/app-domain/src/logger/dto/logger.dto.ts:21-24` 写着「list 的 query 槽位**已开** `nestedWhenPresent`（list.dto.ts）」——而 `list.dto.ts:106-114` 明写「**刻意不挂**」；同一段还写「靠 `RealPartialType` 的 partial 语义放行」，而该 list DTO 的基座是 `RealPickType`（`:69-73`）。这条注释正是批次 4 收口时最该读的那段，**方向反了**。
2. **「单一真源」写在注释里**：分页 `9999` 两处（P2-3）。这类「靠注释宣称同源」的地方，恰好是 `lint:docs-refs` / `doc-budget` 这类文档门禁都管不到的。

---

## 附录 A：复跑命令

~~~powershell
# 门禁（cwd = apps/server 除 boundaries）
cmd /c "cd /d D:\walnut-admin\walnut-admin && pnpm --filter @walnut/server test"     # 79 files / 665 tests
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm types:check"          # exit 0
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm lint"                 # exit 0
cmd /c "cd /d D:\walnut-admin\walnut-admin && pnpm boundaries"                        # 4645 files / 15 packages
cmd /c "cd /d D:\walnut-admin\walnut-admin\apps\server && pnpm openapi:export"      # 220 schemas
git status --porcelain -- apps/server/openapi.json packages/platform-web/api-types/src/schema.d.ts   # 空
~~~

## 附录 B：我这轮做了什么（临时产物已全部删除）

| 临时 spec | 作用 | 结果 |
|---|---|---|
| `libs/repository/src/__r3_probe.spec.ts` | A/B/C/D/E 五组：36 格矩阵（真 QB + 真 PG）、兼容路径、page 放大、default.ts 形态、校验层 | 全绿；矩阵 `LEAKED_TO_PG=0`（两条路径） |
| `apps/api/src/common/__r3_probe2.spec.ts` | 19 个 list DTO 的 `query` 缺省形态 | `NON_NIL_OFFENDERS=0` |
| `apps/api/src/common/__r3_probe3.spec.ts` | 「query 开嵌套校验」的反事实量化 | `FAILED=9/25` |

三个文件**均已删除**；`git status --porcelain -- apps/server` 现在只剩 R2 自己的 22 改 + 6 增，与复查前一致。本机没有 `trash` 命令（`Get-Command trash` 为空），按 R1 同样口径用 `Remove-Item` 清理**自建临时文件**。

未做的事：**没有跑 `test:integration` / `test:e2e` / api-spec**（会 drop 重建本地库，只读复查不碰）；**没有改任何源码或配置**。