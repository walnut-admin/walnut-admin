# 批次 9-B · 契约与门禁小项（C3 / C5 / C6 / C7 / C8）

> 执行时间 2026-11-03 15:0x–15:2x ｜ 起点 HEAD `2d5ba70b`（**本轮零提交**，未执行 `git commit`）
> 观测口径：全局异常过滤器**恒回 HTTP 200**，真实结果看 `body.code`（20000 / 40099 / 50000）。
> 环境：Windows / pwsh，pnpm 全部走 `cmd /c "pnpm …"`；本机 PG / Redis 可用。

## 0. 结论速览

| 项 | 做了什么 | 判据 / 实测 |
|----|----------|-------------|
| **C3** | 删桶后重跑 knip，读数 + 归因写进 `knip.config.ts:43` 与 `monorepo/knip.md:103` | 噪音**确实随删桶塌掉**：可比三项 16/140/49 → **17/69/42**；`packages/**` 118 → **30**（逐条归因见 §2） |
| **C5** | `sort[].priority` 的 OpenAPI 诚实化（DTO 层一处，选装饰器而非塞 `required`） | `openapi.json` 里 `SortDTO.required` 只剩 `field`/`order`；`schema.d.ts` 变 `priority?: number`；admin 零影响（§3.4） |
| **C6** | 字典布尔值 `'true'/'false'` → 真布尔，**唯一转换点**在列类型裁决层 | 单测 3 条 + api-spec 3 条（真 PG）；`status like 'true'` 由 40099 → 20000 且只回启用行；`like 'yes'` 仍 40099 |
| **C7** | 旧 `query` 兼容路径的**删除判据**（不删） | 判据写进 `pg-list.builder.ts:62-83` TSDoc + `architecture-todo.md:90`（P3 一行） |
| **C8** | `db:export:pg` 两个行为写进 `postgresql.md:57-70` 与 `db/seed/README.md:18-27` | 实测 `--out apps/server/db/seed` → 退出码 **2** + 「前置条件未满足」 |

## 1. 先读这一节：工作树里**有第二个写入者**

开工时 `git status --porcelain` 是空的；到 15:07 之后冒出 **12+ 个不是我改的文件**（HEAD 仍是 `2d5ba70b`，未提交），
mtime 15:07–15:10，内容是**批次 8 的 B2/B3 + 批次 9 的 B5/B6**：

```text
apps/server/libs/guards/src/guards/{risk.guard,cap.guard}.ts + 新文件 risk.sensitivity.ts、guards/src/index.ts
apps/server/libs/guards/src/interceptors/response/success.interceptor.ts(+spec)
apps/server/libs/exceptions/src/base/406.ts、apps/server/libs/utils/src/response.ts、libs/types/.../express.d.ts
packages/platform-any/contract/src/response-code.ts、apps/api/src/i18n/{en_US,zh_CN}/response.json
apps/api/src/modules/security/sign/sign.controller.ts、.../identity/user_preference.controller.ts、.../locale/locale.controller.ts
apps/server/libs/app-domain/src/monitor/user/{dto/user.dto.ts,repo/user.repo.service.ts,user.service.ts}(+spec)
```

**后果（本报告的读法）**：

1. 我的门禁跑在这棵**混合树**上。`types:check` / `lint` / `pnpm test` 的红**全部**落在上述文件上，逐条已在 §8 标注归属。
2. 我 15:03 第一次 `openapi:export` 时 diff 只有我这一条；15:1x 再导时多出他们的一条（`AppMonitorUserDTOUpdateState` 少 `deviceId`）。
   `openapi.json` 与 `schema.d.ts` 现在**各含两个 hunk**（我一个、他们一个）—— 我把生成物重导到与当前代码一致，
   没有回退他们的 hunk（回退会让 `openapi:check` 与代码不一致）。
3. 收官时（15:3x）他们的足迹还在扩大：`reports/batch-8/` 成了未跟踪目录，`apps/server/libs/guards/src/guards/risk.sensitivity{,.spec}.ts`、`success.interceptor.spec.ts`、`app-domain/monitor/user/user.service.spec.ts` 都是新文件 ⇒ **那是批次 8 的 agent**。所以 §8 的读数只能按「我这一部分的文件」归属，不能当全仓结论。
4. 建议：**同一 worktree 同时只留一个写者**，或让他们先提交，否则任何「diff 只含预期变化」的验收都无法机械判定。

## 2. C3 · knip 残余重跑：噪音塌了，塌的是「一桶 N 行」

### 2.1 跑法与读数

```powershell
cmd /c "pnpm knip"                       # 人读，exit 1（预期）
cmd /c "pnpm exec knip --reporter json"  # 要精确路径：文本报告按终端宽度截断长路径（本次 27+1 条被截成 …s/server/…）
```

| | Unused files | Unused exports | Unused exported types | 合计（三项） | `packages/**` | 其余（apps + reports） |
|---|---|---|---|---|---|---|
| 批次 2（2026-11-02，`reports/batch-2/r3-review.md` §2.1） | 16 | 140（knip.md 记 139，口径差 1） | 49 | **205** | **118** | 87 |
| 批次 9（2026-11-03，本次实测） | 17 | **69** | **42** | **128** | **30** | 81 |
| 差 | +1 | **-71** | **-7** | **-77** | **-88** | -6 |

另有本次新增/既有的四类：`Duplicate exports 1`（`packages/tooling/vitest-config/index.ts`）、
`Unused devDependencies 1`（`ts-json-schema-generator`）、`Unlisted dependencies 1`（`rxjs`）、`Unlisted binaries 1`（`madge`）。

### 2.2 塌掉的是哪一块（逐桶归因）

| 桶 | 批次 2 | 现在 | 发生了什么 |
|---|---|---|---|
| `packages/platform-web/client/src/index.ts` | 54 | **0** | 桶已删（`c7dcdaf1`，批次 4 · D8）。<br>注：`knip.md` 那张 2026-11-02 表记的是 53 / 22 / 7（=82），与 `r3-review` §2.2 的 54 / 30 / 15（=99）口径不同（统计时机不同）；本表统一用 `r3-review` §2.2 的数 |
| `packages/platform-web/http/src/index.ts` | 15 | **0** | 桶已删（同上） |
| `packages/platform-any/utils-core/src/index.ts` | 30 | **8** | 桶**收缩**（D7）：只留 `object-paths` + `sign-raw` 两个模块，其余下沉 `@walnut/client` |
| `http/src/types.ts`（深层） | 5 | **8** | 桶删后类型在原地报出（净 +3） |
| `client` 深层（cookie / shared / crypto / download / useDraggableElement / store） | 9 | **10** | 少 `utils-core/src/crypto/const.ts` 的 1 条、多 `client/browser/crypto/const.ts` 的 1 条 |
| `packages/tooling/eslint-config` | 4 | **4** | 改前就有，与本轮无关 |
| `packages/tooling/vitest-config` | 0 | **1**（duplicate） | `defineWalnutVitestConfig` 的 `default` 与具名导出重复 |

**结论：噪音确实随删桶塌掉，而且塌掉的正是「barrel 把 N 个符号各报一行」那一类。**
配置（`project` + `includeEntryExports`）只负责把这类东西**变可见**，删桶才把它**变不见**。

### 2.3 剩下的 30 条 `packages/**` 怎么读（判据，不是背书）

按「入口有没有消费」二分（这也是写进两个文件的那套判据）：

- **「入口没人走」（16 条，不是死代码）**：`utils-core/src/index.ts` 8（5 导出 + 3 类型）+
  `http/src/types.ts` 8（类型）。`@walnut/utils` / `@walnut/http` 的**入口说明符全仓 0 处消费**，
  消费方走深路径（批次 2 §2.3 已实测：入口 0 处、深路径 115 处）。
- **真死候选（10 条，client 深层）**：`Cookie` / `removeCookie`（`browser/cookie.ts`）、`getFunctionBoolean` +
  2 类型（`browser/shared.ts`）、`createWalnutStore`、`importKeyFromPEM`、`downloadByOnlineUrl`、
  `useDraggableElement`、`CryptoResult`。这批要删得逐条 grep 消费方（含 `.vue` / 文档），本轮**没删**。
- **tooling（4 条）**：`comment-rules` 3 + `script-rules` 1 —— 改前就有，与本轮无关。另有 1 条 `Duplicate exports`（`packages/tooling/vitest-config`）属**另一个 section**，不计入上面这 30 条。

`apps/**`（81 条）与桶无关，仍是**有意维持**那一类：`libs/decorators` 12 条是模板装饰器 API 面；
`Unused files 17` 里 8 个是 migration（`apps/server/apps/api/migrations/*`）、2 个是 cli 入口
（`data-source.cli.ts` / `export-openapi.ts`）、1 个是 `apps/worker/src/main.ts`、3 个是 `libs/const/src/app/*`，
另有 1 个**应该是垃圾**：`reports/batch-7/probe/probe.js`（批次 7 的探针残留）。

### 2.4 落到哪两个文件

- `knip.config.ts:43-63`：新增「删桶之后的复测」小节 —— 只写判据与「怎么看」（三步读法 + 别用 `ignoreIssues` 抹绿），
  **不写计数**（该文件顶部本来就有「这里不写命中计数」的纪律）。
- `apps/docs/src/zh-CN/content/monorepo/knip.md:103-122`：新增同名小节（表格式判据），并改掉「预期结果」表里
  `pnpm knip` 那一行的解释（`knip.md:41`）。**明写**上一节的 2026-11-02 数字是**历史快照**、别再当现状引用。
- 附带修掉一处**已经烂掉的计数**：`architecture-todo.md` 的「搁置」knip 行原文写「7 未用文件 / 40 未用导出 / 3 未用类型」，
  实测是 17 / 69 / 42（且本轮之前就已过期）。该行属 `PATH_CHECK_EXCLUDED`，改动不触发文档门禁。

## 3. C5 · `sort[].priority` 的 OpenAPI 诚实化

### 3.1 改法（一处，且只有一处真源）

`validateOptions.optional` 本来只影响运行时校验（`IsOptional` 短路），schema 侧一直标 `required`。
现在把「可选」这一个开关同时翻到 swagger：

- `apps/server/libs/decorators/src/field/number.decorator.ts:18-40`：`optional === true` 时选
  `ApiPropertyOptional`（它等价于 `ApiProperty({ ...options, required: false })`），否则仍是 `ApiProperty`。
- 同步三处注释/类型（否则下一个人会以为 `optional` 不进 swagger）：
  `libs/types/src/walnut-admin/decorators/number.d.ts:11-21`、
  `libs/decorators/src/validator/base/number.validator.ts:39-40`、`libs/list/src/list.dto.ts:99-103`。

**为什么不在字面量里直接写 `required: false`**（第一版就是这么写，被 `types:check` 拦下）：
`swaggerOptions` 的类型是 `ApiPropertyOptions`（联合类型），同一对象字面量里再 spread 它，
`required` 的联合（`boolean | string[]`）会被摊平，TS 转去匹配 `{ type: 'object'; required?: string[] }` 那一支，
报 `Type 'NumberConstructor' is not assignable to '"object"'`。改成「在外面选装饰器」后两个签名都不受影响。

### 3.2 生成物实测

```text
# apps/server/openapi.json（只列我的 hunk；另有 1 个 hunk 属并行写入者，见 §1）
@@ SortDTO
         "required": [
           "field",
-          "order",
-          "priority"
+          "order"
         ]

# packages/generated/api-types/src/schema.d.ts
-            priority: number;
+            priority?: number;
```

重导前后各跑一次 `cmd /c "pnpm --filter @walnut/server openapi:export"`，我这一条 hunk **逐字节稳定**（`ApiPropertyOptional` 与手写 `required:false` 等价）。

### 3.3 与实现是否真的对齐

- 运行时：`validateOptions: { int: true, min: 0, optional: true }` ⇒ 缺省跳过校验；缺省时 builder 用 `priority ?? 0`
  （`libs/repository/src/pg-list.builder.ts` 的 sort 归一）。
- 现在 schema 也说「可以不传」⇒ 文档与实现一致；**契约收紧方向没有变**：显式给值时仍要 `int ≥ 0`。

### 3.4 admin 侧影响面：零

- admin 的 list 入参类型来自 `@walnut/contract` 的 `BaseSortParams`（`priority: number` 必填，**未动**），
  不是 api-types 的 `SortDTO`。
- 全仓 `SortDTO` 只出现在生成物里（`schema.d.ts` 的 `components`、以及若干 `sort: SortDTO[]` 的 path 定义）；
  admin 从 `@walnut/api-types` 只取**响应**别名（`SystemUser` / `SystemRole` / …），没有一处取 `SortDTO`。
- admin 侧唯一的 `priority` 用法是 `views/system/device/index.vue:45`（字面量对象，`contract` 类型），
  与生成物无关。`pnpm --filter @walnut/admin types:check` 在全仓 `types:check` 里已通过（§8）。

## 4. C6 · `status` 列的字典布尔值筛选（40099 → 可用）

### 4.1 根因链（三条都实测过）

1. 字典 `sys_shared_status` 的两行值在 seed 里是**字符串**：`{"label":"dict.status.true","value":"true"}`、
   `{"label":"dict.status.false","value":"false"}`（`apps/server/db/seed/sys_dict_data.json`，type_id 指向 `sys_dict_type` 的 `sys_shared_status`）。
2. 前端只有「值形态」没有「列类型」：`apps/admin/src/utils/table/list-filters.ts:70-72` 的口径是「字符串 → `like`」，
   于是表头筛选必然发出 `{ field: 'status', op: 'like', value: 'true' }`。
3. `status` 是**布尔列**（`libs/identity/src/user/entity/user.entity.ts:46`、`sys-role.entity.ts:26`、`user-oauth.entity.ts:28`），
   `like` 打非文本列被 `resolvePgFilterCondition` 拒成 40099（批次 4 之前是 `boolean ~~* unknown` ⇒ 50000）。

### 4.2 改造点：只在列类型裁决层（后端一处）

`apps/server/libs/repository/src/pg-column-op.ts:541-566`：`like` + **布尔列** 且值可解释为布尔字面量
（`true` / `false` / `"true"` / `"false"`）⇒ 裁决成 `eq`（`filterOp` 保留 `like`，SQL 层二次裁决走同一条路，结果一致）；
值解释不了布尔（`"yes"` / `1` / 数组）**仍然 40099**。函数头注释同步登记这处例外（`pg-column-op.ts:519-523`）。

**为什么不在前端转**：前端要做这件事就得维护「字段 → 列类型」的镜像表 —— 那是第二个真源，
而列类型的权威本来就在后端实体元数据里（本函数手里）。所以前端**零行为改动**，只补了一段注释
（`apps/admin/src/utils/table/list-filters.ts:28-36`）说明「这里下发 like 是有意的、别加镜像表」。

### 4.3 测试与实测

- **单测**（零 DB，fake qb）：`apps/server/libs/repository/src/pg-list.builder.spec.ts:377-392`
  —— `like 'true'` → `{ op:'eq', value:true }`、`like 'false'` → `false`、`like 'yes'` → 抛 40099 且 **0 条 SQL**。
- **api-spec**（真 PG，全链）：`apps/server/apps/api/test/api/list-filters.api-spec.ts:184-215` 新增 G 段 3 条：
  `status like 'true'` ⇒ 20000 且 `total > 0`、返回行**全部** `status === true`；
  `status like 'false'` ⇒ 20000 且返回行全为 `false`（可能 0 行）；`status like 'yes'` ⇒ 40099。
- **实测**（`reports/batch-9/logs/itest-g-section.log`）：`Tests 3 passed | 76 skipped (79)`；
  整文件 `reports/batch-9/logs/itest-list-filters.log`：`Test Files 1 passed`、`Tests 79 passed`。
- 负对照：既有 `REJECTED_FILTERS` 里那条「like 打 boolean 列 + `'abc'` ⇒ 40099」**仍然绿**，
  说明放宽只吃那两颗字典值，不是整体放弃裁决（`pg-list.builder.spec.ts:421-457` 的矩阵未改）。

### 4.4 副作用与边界（说清，别当成已解决）

- 任何客户端（含旧 admin 构建缓存）发 `status like 'true'` 都会变成等值筛选 —— 语义从「子串」变成「等值」，
  对布尔列这是**唯一有意义**的解释，不存在第二种语义被覆盖。
- `status` 以外的布尔列（`active` / `locked` / `banned` / `mfaSetup` …）走同一条路，同样只接受布尔字面量。
- **没做**：批次 1 台账里的 P3-B3（布尔列收到 `1`/`0` 静默丢弃）仍在，本轮不放行数字字面量 —— 那会变成猜。

## 5. C7 · 旧 `query` 兼容路径的删除判据（本轮不删）

判据写进两处，内容一致：

- 代码：`apps/server/libs/repository/src/pg-list.builder.ts:62-83`（`IListRequestParams.query` 的 TSDoc），
  另在两处分支加了「过渡态，判据见 TSDoc」的指针（`pg-list.builder.ts:184`、`:309`）。
- 计划文档：`apps/docs/src/zh-CN/content/monorepo/architecture-todo.md:90`（P3 表新增一行）。

**判据（两条全满足才删）**：

1. **静态 0 调用点**：`git grep -n "query:" -- apps/server/libs apps/server/apps` 里构造该槽位的地方为 0。
   今天实测：只有 `pg-list.builder.ts` 自身与 `pg-list.builder.spec.ts` 命中（`locale.repo.service.ts` 虽收
   `IListRequestParams`，但只读 `filters/sort/page`）。
2. **运行面连续 30 天无触达**（一个完整发版周期，与设备 cookie 双读窗口同量级）。

**第 2 条的坑（写进文档了）**：这条路径**解释成功时完全静默**（只有丢弃才 `debug` + 每 100 次一条 `warn`），
所以「没看到 warn」≠「没被走到」。真要走第 2 条，得先给它补一条触达计数；否则只能按「第 1 条 + 一个发版周期」判。

**删除时要四处一起**（漏一处 = 半删）：① `IListRequestParams.query`；② `buildPgListQueryOptions` 的
`// ---- query：…` 分支；③ `legacyConditionFromValue()`；④ `applyPgListQuery` 里 `condition.raw` 的两个分支
与 `IWalnutPgListCondition.raw` 字段。

**为什么现在不删**：删它零收益（没有调用点要清理），留着有回滚价值 —— 旧客户端 / 未迁完的旁路最坏是
「条件不生效 + 一条 warn」，而不是 40099。这属 Lead 已裁定的「过渡态保留」，本轮只补判据。

## 6. C8 · `db:export:pg` 的两个行为写进文档

行为本身是批次 5-B（`75a308f6`，2026-11-03）落的，但文档只写了「两步命令」，没写**默认值**与**报错**：

- `apps/docs/src/zh-CN/content/backend/postgresql.md:57-70`：新增「`db:export:pg` 的两个行为」小节 ——
  ① 默认 `--out` 就是 `apps/server/.tmp/pg-export`（`DEFAULT_EXPORT_OUT`，可整段省略，快照是中间物）；
  ② `--out` 指到 `apps/server/db/seed` 会在**连库之前**抛 `PreconditionError`、退出码 **2**、一个文件都不写；
  另加一行「拦截判据是**等于** seed 目录，**不含子目录**」。
- `apps/server/db/seed/README.md:18-27`：显眼位置（紧跟两步命令之后的引用块）写同两条，并补
  「`--anonymize` 同一条红线（脱敏有损）」与「子目录不在拦截范围」。

**实测**（`reports/batch-9/logs/` 之外，命令与输出见下，未连库、无副作用）：

```powershell
cmd /c "pnpm db:export:pg --out apps/server/db/seed"
# ✖ 前置条件未满足：导出结果**不能**写进 seed 目录：那里是 PG 行形态真源，本命令产出的是 Extended JSON 快照。…
# [ELIFECYCLE] Command failed with exit code 2.
```

## 7. 变更清单（path:line）

```text
C3  knip.config.ts:43-63                                      新增「删桶之后的复测」小节（判据 + 三步读法）
    apps/docs/.../monorepo/knip.md:41                          预期结果表：pnpm knip 那一行改成分类读法
    apps/docs/.../monorepo/knip.md:103-122                     新增同名小节（明写上一节数字是历史快照）
    apps/docs/.../monorepo/architecture-todo.md                搁置行里那处已腐烂的计数改成判据
C5  apps/server/libs/decorators/src/field/number.decorator.ts:18-40    optional ⇒ ApiPropertyOptional
    apps/server/libs/types/.../decorators/number.d.ts:11-21            注释：optional 现在也进 swagger
    apps/server/libs/decorators/src/validator/base/number.validator.ts:39-40
    apps/server/libs/list/src/list.dto.ts:99-103
    apps/server/openapi.json（生成物）                          SortDTO.required 去掉 priority
    packages/generated/api-types/src/schema.d.ts（生成物）       priority?: number
C6  apps/server/libs/repository/src/pg-column-op.ts:519-523,541-566    布尔列 + like ⇒ eq（唯一转换点）
    apps/server/libs/repository/src/pg-list.builder.spec.ts:377-392    单测 3 条
    apps/server/apps/api/test/api/list-filters.api-spec.ts:184-215     api-spec G 段 3 条
    apps/admin/src/utils/table/list-filters.ts:28-36                    仅注释（前端零行为改动）
C7  apps/server/libs/repository/src/pg-list.builder.ts:62-83,184,309  删除判据 + 两处指针
    apps/docs/.../monorepo/architecture-todo.md:90                      P3 新增一行（含判据）
C8  apps/docs/.../backend/postgresql.md:57-70                    两个行为（默认值 / 退出码 2 / 子目录不在拦截面）
    apps/server/db/seed/README.md:18-27                          同两条，显眼位置
```

**证据日志**（均在 `reports/batch-9/logs/`）：`knip-after-utf8.txt`（人读全表）、`knip-after.json`（精确路径）、
`server-test.log` / `server-test2.log`、`itest-list-filters.log` / `itest-g-section.log`、
`openapi-export{,2,3}.log`、`lint.log` / `server-lint2.log`、`types-check.log`、`root-test.log`。

## 8. 门禁实测（含归属）

| 命令 | 结果 | 读数 / 归属 |
|------|------|-------------|
| `cmd /c "pnpm --filter @walnut/server test"` | **绿** | `Test Files 98 passed`、`Tests 822 passed`（改完后重跑；首轮 95/793 是改前） |
| `cmd /c "pnpm --filter @walnut/scripts test"` | **绿** | `Test Files 33 passed`、`Tests 528 passed` |
| `cmd /c "pnpm test"`（turbo 全仓） | **红** | 两次跑都是同一处：`@walnut/contract#test` 的 `response codes never change silently` 快照 —— **并行写入者**在 `contract/src/response-code.ts` 加了码但没更新快照（`reports/batch-9/logs/root-test{,2}.log`）；turbo 随即中止其余任务，故 server / scripts 两项我另跑（都绿） |
| `cmd /c "pnpm types:check"` | **绿**（复跑） | 首轮：13 task 绿、仅 `@walnut/server` 红，2 条错误**全在** `apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts:365,378`（`visitorId` 已从 `app-domain/monitor/user` 的入参类型移除，spec 未跟）——**并行写入者的**，他们随后自行修好；我自己的 2 条（`number.decorator` 里 `required` 的联合被摊平）先修掉。**复跑 15/15 task 全绿** |
| `cmd /c "pnpm lint"` | **红** | 两次跑都是 19 条 error，**全在**并行写入者的文件：`guards/{cap,risk}.guard(.spec).ts`（sort-imports / no-duplicates / promise-function-async）、`risk.sensitivity.ts`（operator-linebreak）、`monitor/user.service.spec.ts`（prefer-lowercase-title / no-unnecessary-type-assertion）、`success.interceptor.spec.ts`。**我的文件零 error**：`pg-list.builder.spec.ts` 只剩 3 条 `ts/no-unsafe-assignment` **warning**，与批次 4 原有写法同款（`expect.objectContaining(...)`；其中 2 条是原有行号平移）；`number.decorator.ts` 那条 `any` warning 已随重构消失；`pg-list.builder.ts` 里的 ⚠️ 触发 `walnut-comment/no-emoji`，已改成「注意：」`；
| `cmd /c "pnpm boundaries"` | **绿** | `Checked 4681 files in 15 packages, no issues found` |
| `cmd /c "pnpm --filter @walnut/server openapi:export"` | **绿**，diff 2 hunk | hunk①`SortDTO.required` 去 `priority`（**我的**）；hunk②`AppMonitorUserDTOUpdateState` 去 `deviceId`（**并行写入者的**，见 §1）。重导 3 次，我的 hunk 稳定 |
| `cmd /c "pnpm lint:docs-refs"` | **绿** | `343 篇活文档；包名豁免 17 条、路径豁免 8 条`（含本报告） |
| `cmd /c "pnpm lint:doc-ts"` | **绿** | `230 篇活文档里的 124 个 ts 块 + 3 个 json 块` |
| `cmd /c "pnpm lint:emoji"` | **绿** | 1215 个文本文件（常驻文档 6 个严格档） |
| `cmd /c "pnpm lint:doc-budget"` / `lint:adr` | **绿** | 6 个常驻文件均 87–97%（新增内容全在文档站，未碰常驻档）；27 篇 ADR 形态通过 |
| `cmd /c "pnpm build:docs"`（死链门禁） | **绿** | `build complete in 99.05s`（我改的三篇文档没有新增 markdown 链接，死链白名单未动） |
| `test:integration`（单跑 `list-filters.api-spec.ts`） | **绿** | 先确认无并发 vitest（`Get-CimInstance` 过滤 `CommandLine -match "vitest"` 为空）；globalSetup 实测拿到排他锁（`key=730942001，等待 0s`）；79 条全绿 |

## 9. 需要 Lead 拍板

1. **同一 worktree 的写者冲突**（最紧急）：并行写入者让「`openapi:export` 后 diff 只含预期变化」这条验收
   变成**不可机械判定**（现在 `openapi.json` / `schema.d.ts` 各含两个来源的 hunk）。请定顺序：
   (a) 让他们先提交、我再重跑 `openapi:export` + `openapi:check`；(b) 或接受「我的 hunk 已登记、其余 hunk 归他们」。
   无论哪种，`types:check` / `lint` / `pnpm test` 现在都是**混合树读数**，我这边的三项红已逐条归到对方文件。
2. **C5 的取舍要不要再收紧一格**：现在只把 `priority` 移出 `required`，schema 里仍没有 `default`。
   要不要顺手发布 `default: 0`（= 与 builder 的 `priority ?? 0` 对齐）？我倾向**不加** ——
   `default` 会让「不传」变成「按 0 算」，与「可选、跳过校验」的语义不同源。请确认保持现状。
3. **C6 的放宽面要不要写进对外契约文档**：现在「布尔列 + `like` + 布尔字面量 ⇒ 等值」只写在代码注释与
   api-spec 里，文档站没有对应条目（`backend/` 下没有 list 过滤契约页）。要不要单开一小节写进
   `backend/` ？（我倾向：等 C7 的 `query` 退役、filters 契约定型后再一次性写，避免又写一份会腐烂的表。）
4. **顺带发现的两个「垃圾文件」**：`reports/batch-7/probe/probe.js`（批次 7 探针残留，knip `Unused files` 里能看见）
   与 `reports/batch-9/logs/*`（本轮证据日志）。要不要按批次清理进 `.gitignore`？我未动它们（删文件需你确认）。
5. **`db:export:pg` 子目录漏洞**：拦截判据是「`--out` **等于** seed 目录」，`--out apps/server/db/seed/snapshot`
   不会被拦。我按现状写进文档（没有扩大拦截范围，避免越界改工具链）。要不要把判据改成「seed 目录及其子目录」？
