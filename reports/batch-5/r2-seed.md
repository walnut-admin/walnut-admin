# R2 · 批次 5-B：seed 真源重建为 PG 行形态（D5=B）+ D16②

> 基线 HEAD `07dacfd6`；**未 commit**；工作树与他人并发共用（见 §7，读 diffstat 前先看那节）。
> 一手实测：本机 PG 18.6（`walnut_pg` 之外的临时库 `walnut_seed_a` / `walnut_seed_b`）、
> Windows/pwsh、所有 pnpm 调用一律 `cmd /c "pnpm …"`。

## 0. 结论速览

| # | 事项 | 结果 |
|---|------|------|
| 1 | seed 目录机械再生成（不手写一行） | ✅ 8 个 EJSON 文件 → **10 个 PG 行文件**（8 业务 + 2 junction）。`$oid` 4416 → **0**，`$date` 4444 → **0**（基线数字与 D5 决策里记的 4416/4444 逐一吻合） |
| 2 | 再生成通道 | ✅ `db:export:pg`（库→快照）+ `db:seed:reshape`（快照→行形态）两步，`git diff` 即「库与仓的差」 |
| 3 | `ejson.ts` 降级 | ✅ 只服务「历史导出」（`db:export:pg` 的产物 + reshape 的读取），不再是真源格式 |
| 4 | `seed-map.ts` 退役 | ✅ **938 行整文件删除**（+ 384 行用例删除）。播种器改成从 `information_schema` 读列/主键/外键/jsonb，装载序 = FK 拓扑序 |
| 5 | 验收：新旧 seed 各灌一个空库逐表 diff | ✅ **10/10 表全等**（全部列）+ **8/8 导出文件逐字节相同**，且**可复跑**（`pnpm db:seed:verify`，基线代码与数据从 git 取） |
| 6 | D16②：`/system/locale/list` 的 `id` → `groupKey` | ✅ 1 接口（repo service + DTO）+ 1 页面 + schema 再生成（`openapi.json` +5 行）+ 1 单测 |
| 7 | 判据 | `lint:seed` ✅ / server 单测 766 ✅ / `types:check` 15/15 ✅ / `lint` 15/15（0 error）✅ / `openapi:export` +5 行 ✅ |

## 1. 做了什么

### 1.1 seed 目录：从「Mongo 文档」到「PG 行」

| | 旧（`07dacfd6`） | 新 |
|---|---|---|
| 文件数 | 8 | 10（+ `sys_user_role.json` / `sys_role_menu.json`） |
| 体积 | 800.2 KB | 712.2 KB（单文件最大 `sys_locale` 496.7 KB，预算 1 MB） |
| 主键 | `_id: {"$oid": "<24 hex>"}` | `id: "<uuid>"`（uuid 本体，无派生步骤） |
| 时间 | `createdAt: {"$date": "…"}` | `created_at: "2026-…Z"`（ISO） |
| 列名 | 驼峰 + `meta` 嵌套 | PG 列名（snake_case，`meta` 已拍平） |
| junction | 父文档里的 `roles` / `menus` 数组 | 独立文件，复合主键两列 |
| `$oid` / `$date` 出现数 | 4416 / 4444 | **0 / 0** |

行数（新 seed，实测灌库回读）：`app_setting` 21、`sys_dict_data` 169、`sys_dict_type` 14、
`sys_lang` 2、`sys_locale` 1836、`sys_menu` 172、`sys_role` 6、`sys_role_menu` 15、
`sys_user` 2、`sys_user_role` 2。**条数与旧 seed 逐表相同**（README 里 1806/157 是旧数，已订正）。

### 1.2 再生成通道（两条命令，都不手写）

```bash
pnpm db:export:pg --out apps/server/.tmp/pg-export      # 库 → 快照（Extended JSON，uuid 本体）
pnpm db:seed:reshape --from apps/server/.tmp/pg-export  # 快照 → 行形态（默认写仓内 seed）
```

- `packages/tooling/scripts/src/db/seed-reshape.ts`（293 行）：`ROW_SPECS` 是「导出键 → 列名」的
  **唯一**映射表（`_id`→`id`、`userName`→`user_name`、`meta.order`→`sort_order` …）；
  junction 由 `JUNCTION_SPECS` 拆成独立行（复合主键去重、保持引用顺序）。
  **fail-closed 三条**：文档里有未消费的键 → 抛（漏一列是静默的，`seed-reshape.ts:186`）；
  缺键 → 抛；`id` / `*_id` 不是 uuid → 抛（钉住「导出通道输出的已是 uuid 本体」这条前提）。
- `packages/tooling/scripts/bin/db-seed-reshape.ts` + 根脚本 `db:seed:reshape` + bin 注册
  （`packages/tooling/scripts/package.json`）。

### 1.3 播种器：删掉映射层，判据全部来自 PG

`packages/tooling/scripts/src/db/seed-pg.ts`（重写，505 行）：

- **没有字段映射**：文件里是什么列就写什么列（`resolveColumns` 校验逐行列集一致 / 列真实存在 /
  NOT NULL 列齐全，`seed-pg.ts:352`）；
- 列型、主键、外键、jsonb 全部读 `information_schema`（`readTableMeta`，`seed-pg.ts:60`）；
- **装载顺序 = FK 拓扑序**（`orderTablesByFk`，`seed-pg.ts:150`），成环抛；
- 自引用 FK（`sys_menu.pid`）按深度稳定排序（`sortRowsBySelfRefDepth`，`seed-pg.ts:196`）；
- jsonb 列绑参前 stringify（`prepareParam`，`seed-pg.ts:180`）；
- junction（主键里没有 `id`）走 `ON CONFLICT DO NOTHING`，业务表走 `ON CONFLICT (id) DO UPDATE`；
- `--only` 只筛业务表，**junction 自动跟随父表**（`planSeedTables`，`seed-pg.ts:295`）——
  集成测试只传 7 个参考集合，靠这条拿到授权行（实测见 §3.6）；
- 输出行格式保持 `   <table> 文档 N / upsert M`，集成层的计数解析（`seed-layer.ts:81`）零改动。

### 1.4 `ejson.ts` 降级为「仅导入历史导出」的兼容器

`packages/tooling/scripts/src/db/ejson.ts` 保留读写能力，但**消费点只剩两个**：`db:export:pg` 写快照、
`db:seed:reshape` 读快照。头注重写为「不再是 seed 真源格式」，并写明精度理由在 PG 之后已消失
（`ejson.ts:1`）。`lint:seed` 现在把 seed 目录里残留的 `$oid` / `$date` 直接判红
（`check-seed.ts` 的 `LEGACY_EJSON_MARKERS`）。

### 1.5 `seed-map.ts` 退役（本批最大收益）

- 删除 `packages/tooling/scripts/src/db/seed-map.ts`（**938 行**）与其用例
  `seed-map.test.ts`（384 行）。
- 仍然需要的三件搬进了 `seed-pg.ts` 并保持可测：`sortRowsBySelfRefDepth`（原
  `sortMenuRowsByDepth`，但按**自引用列**泛化）、`prepareParam`（原 `preparePgParam`）、
  UPSERT 语句构造（原 `buildUpsertSql`，拆成业务/junction 两个）。
- 随之消失的：`SEED_MAPPERS`（24 个集合的 mapper）、`SEED_COLLECTION_ORDER`、`JUNCTION_REFS`、
  `buildSeedContext`（role hex 白名单）、`mapSettingValue`（`app.default.role` 的 hex→uuid 专项重写）。
  **这些不再需要**：值已经是 uuid 本体，声明式默认值不再需要补（导出一定写全列）。

### 1.6 `export-pg`：默认输出不能是 seed 目录了

- 默认 `--out` 从 `apps/server/db/seed` 改为 `apps/server/.tmp/pg-export`
  （`export-pg.ts:43`）；`--out` 指向 seed 目录时**直接抛**并打印两步再生成命令
  （`export-pg.ts:245`）——否则一次误操作就把真源打回 Extended JSON。
- 导出面排除 junction 表（它们在导出形态里是父文档的数组，`export-pg.ts:232`）。

### 1.7 门禁 `lint:seed` 改造（`check-seed.ts`，308 行）

判据一条没少，全部改到行形态并**新增两条**：

| 判据 | 变化 |
|------|------|
| 必需表 8 + **必需 junction 2** | 新增（少了它登录后权限/侧边栏空掉且不报错） |
| 禁入集合 7 | 不变（`app_key` / `shared_area` / 凭据表…） |
| 凭据形状键 | 名单加上 snake_case 变体（`key_b64` / `value_hash` …）——两种入口都要拦 |
| **Extended JSON 残留** | **新增**：出现 `"$oid"` / `"$date"` 判红 |
| 行形态不变量 | **新增**：`id` 必须是 uuid、`created_at`/`updated_at` 是 ISO、列集逐行一致、junction 不许有 `id` |
| 引用完整性 | 改成查 junction 两端 + `current_role_id` + `pid` + `lang_id` + `type_id` + `app.default.role` |
| 裁剪生效（policy） | 不变；`policy.ts` 改成**两种形态都认**（`user_name` / `userName`） |
| 未脱敏个人数据 | 不变（`anonymize.ts` 按键名判定，对 snake_case 同样生效） |

### 1.8 D16②：`/system/locale/list` 的 `id` → `groupKey`

- 接口：`locale.repo.service.ts` 的 `ISysLocaleListGroupRow.id` → `groupKey`，行加工抽成纯函数
  `toLocaleListGroupRow`（`locale.repo.service.ts:39`）；`SysLocaleDTO` 新增 `groupKey` 字段
  （`locale.dto.ts`，紧挨着同类的 `process`），list 响应 `RealPickType` 由 `id` 改为 `groupKey`。
- 页面：`apps/admin/src/views/system/locale/index.vue` 的 `keyField = 'groupKey'`（rowKey 与
  read/delete 的路径参数都用它；locale 的 CRUD 本来就按 key 操作，语义没变，只是名字不再骗人）。
- schema 再生成：`openapi.json` **+5 行**（`SysLocaleDTO.groupKey`），`packages/generated/api-types/src/schema.d.ts` **+5 行**；
  `SystemLocale` 类型改为 `& { groupKey: string }`（`packages/generated/api-types/src/index.ts:124`）。
- 测试：`apps/server/libs/system/src/locale/locale.list-row.spec.ts`（3 条，进 `pnpm --filter @walnut/server test`）。

## 2. 验收：新旧 seed 各灌一个空库，逐表 diff **全等**（可复跑）

### 2.1 方法（`pnpm db:seed:verify`，`seed-verify.ts` 226 行）

1. 从 git 取基线 `07dacfd6` 的**旧 seed 文件 + 旧映射管线代码**到 `apps/server/.tmp/seed-verify/<ref>/`
   （旧管线已删，只能从 git 取；这样**不需要在仓里再放一份数据快照**）；
2. `DROP/CREATE` 两个空库 `walnut_seed_a` / `walnut_seed_b`（`WITH (FORCE)`），各跑一次
   `pnpm migration:run`（8 条 migration，**不碰**现有库）；
3. A 库 = 旧 seed + 旧管线（`node <baseline>/packages/tooling/scripts/bin/db-seed-pg.ts`）；
   B 库 = 仓内 seed + 现管线；
4. **逐表比全部列**：`SELECT t::text FROM <table> t ORDER BY t::text`（`t::text` 把 jsonb 归一、
   timestamptz 打 PG 规范文本，等价于逐列逐字节比），行数+行内容双向比（不是只看计数）；
5. 各跑一次 `db:export:pg`，比**导出文件内容**（8 个文件）；
6. 任一不等 → 退出码 1 并打印首个差异。

### 2.2 结果（原始输出）

```text
双库对拍：基线 07dacfd6（旧 seed + 旧管线） vs 仓内 seed（行形态 + 现管线）
  库：walnut_seed_a / walnut_seed_b（都会先 DROP，**不碰**现有库）
  比对面：10 个表（全部列）+ 各导出一次 db:export:pg 的文件内容
[1/5] 从 git 取基线到 apps/server/.tmp/seed-verify/07dacfd6
[2/5] 建两个空库并跑 migration
[3/5] 播种：A = 基线管线 + 基线 seed；B = 现管线 + 仓内 seed
  A: 11 行输出；B: 13 行输出
[4/5] 逐表比全部列
  ✅ app_setting      A=    21 B=    21
  ✅ sys_dict_data    A=   169 B=   169
  ✅ sys_dict_type    A=    14 B=    14
  ✅ sys_lang         A=     2 B=     2
  ✅ sys_locale       A=  1836 B=  1836
  ✅ sys_menu         A=   172 B=   172
  ✅ sys_role         A=     6 B=     6
  ✅ sys_role_menu    A=    15 B=    15
  ✅ sys_user         A=     2 B=     2
  ✅ sys_user_role    A=     2 B=     2
[5/5] 各导出一次 db:export:pg 并比文件内容
  ✅ app_setting.json      11019 字符
  ✅ sys_dict_data.json    66564 字符
  ✅ sys_dict_type.json     4825 字符
  ✅ sys_lang.json            564 字符
  ✅ sys_locale.json      577751 字符
  ✅ sys_menu.json        154180 字符
  ✅ sys_role.json          2701 字符
  ✅ sys_user.json          1047 字符
✅ 对拍全等：10 个表（全部列）+ 8 个导出文件，两库逐行逐字节相同
```

**为什么这个证法比"导出文件 diff"更强**：导出只覆盖反向映射里的列（例如 `sys_user.dept_id`
不在其中），而第 4 步比的是 `SELECT *` 的完整行 —— 任何一列不一致都会红。
两种口径都跑，是因为「导出可往返」本身也是约定。对拍器自身的判据也有用例
（`seed-verify.test.ts`：相等 / 只在 A / 只在 B / 同数不同值 —— 防"把不等判成等"）。

## 3. 判据实测

| 判据 | 命令 | 结果 |
|------|------|------|
| seed 形态门禁 | `cmd /c "pnpm lint:seed"` | ✅ `10 个表文件（必需 8 + junction 2 / 禁入 7）`，0 findings |
| 后端单测 | `cmd /c "pnpm --filter @walnut/server test"` | ✅ **90 files / 766 tests** 全过（含新增 `locale.list-row.spec.ts`） |
| 类型 | `cmd /c "pnpm types:check"` | ✅ **15/15** tasks |
| Lint | `cmd /c "pnpm lint"` | ✅ **15/15** tasks，0 error（server 2 条既有 warning） |
| OpenAPI | `cd apps/server && cmd /c "pnpm openapi:export"` | ✅ `openapi.json` +5 行（`SysLocaleDTO.groupKey`），api-types `schema.d.ts` +5 行 |
| 工具链单测 | `cd packages/tooling/scripts && pnpm test` | ✅ **33 files / 526 tests**（新增 `seed-reshape` / `seed-pg` / `seed-verify` 三个 spec） |
| 文档门禁 | `pnpm lint:docs-refs` / `lint:doc-ts` | ✅ 334 篇 / 124 ts 块 |
| 双库对拍 | `pnpm db:seed:verify` | ✅ 见 §2（**两次**跑，其中一次在 lint autofix 之后） |
| 集成/API 全链 | `cd apps/server && pnpm test:integration` | ⚠️ 639 tests：**627 过 / 11 挂**（1 挂是我的 D16② 遗漏，已修并单跑转绿；其余 10 挂在并发那条线的 guard/device 重构上，见 §3.1） |

`git diff --stat`（**只列我改的路径**；全仓 diffstat 会混进别人的改动，见 §7）：

```text
 apps/admin/src/views/system/locale/index.vue       |     4 +-
 apps/docs/.../backend/postgresql.md                |    53 +-
 apps/docs/.../plans/modernization-roadmap.md       |     8 +-
 apps/server/apps/api/test/integration/helpers/seed-layer.ts | 10 +-
 apps/server/apps/api/test/integration/lang.locale.i18n.int-spec.ts |  6 +-
 apps/server/db/seed/README.md                      |    33 +-
 apps/server/db/seed/app_setting.json               |   489 +-
 apps/server/db/seed/sys_dict_data.json             |  5006 +--
 apps/server/db/seed/sys_dict_type.json             |   248 +-
 apps/server/db/seed/sys_lang.json                  |    36 +-
 apps/server/db/seed/sys_locale.json                | 43848 ++++++-------------
 apps/server/db/seed/sys_menu.json                  |  9783 +++--
 apps/server/db/seed/sys_role.json                  |   167 +-
 apps/server/db/seed/sys_user.json                  |    64 +-
 apps/server/libs/system/src/locale/dto/locale.dto.ts | 15 +-
 apps/server/libs/system/src/locale/repo/locale.repo.service.ts | 35 +-
 apps/server/openapi.json                           |     5 +
 package.json                                       |     4 +-
 packages/generated/api-types/src/index.ts          |     3 +-
 packages/generated/api-types/src/schema.d.ts       |     5 +
 packages/tooling/scripts/README.md                 |    39 +-
 packages/tooling/scripts/package.json              |     2 +
 packages/tooling/scripts/src/ci/__tests__/check-seed.test.ts | 154 +-
 packages/tooling/scripts/src/ci/check-seed.ts      |   261 +-
 packages/tooling/scripts/src/db/__tests__/seed.test.ts | 20 +-
 packages/tooling/scripts/src/db/ejson.ts           |    27 +-
 packages/tooling/scripts/src/db/export-pg.ts       |    53 +-
 packages/tooling/scripts/src/db/policy.ts          |    23 +-
 packages/tooling/scripts/src/db/seed-pg.ts         |   463 +-
 28 files changed, 22781 insertions(+), 38077 deletions(-)
```

未跟踪的新文件（9 个）：`apps/server/db/seed/sys_role_menu.json`、`apps/server/db/seed/sys_user_role.json`、
`apps/server/libs/system/src/locale/locale.list-row.spec.ts`、
`packages/tooling/scripts/{bin/db-seed-reshape.ts,bin/db-verify-seed.ts,src/db/seed-reshape.ts,src/db/seed-verify.ts}`、
`packages/tooling/scripts/src/db/__tests__/{seed-pg,seed-reshape,seed-verify}.test.ts`。
已删除（`git rm`）：`packages/tooling/scripts/src/db/seed-map.ts`（938 行）、`.../__tests__/seed-map.test.ts`（384 行）。

### 3.1 集成套件的 11 挂怎么归属

`pnpm test:integration` 覆盖 `test/integration/**` + `test/api/**`（639 条，串行，跑一轮 ~20min）：

| 挂的 | 判定 | 证据 |
|------|------|------|
| `lang.locale.i18n.int-spec.ts` 1 条 | **我的遗漏**：它断言 locale list 行的 `id === key`（D16② 的旧名） | 已改为断言 `groupKey`（`lang.locale.i18n.int-spec.ts:224`）；**单跑 11/11 绿** |
| `device.api-spec.ts` 2 条 + `guard-matrix.api-spec.ts` 8 条 | **不是我的**：全部是 `body={"code":40101,"msg":"Access Token Expired"}` 形态的**处理器之前**拒绝 | 并发那条线同一时段提交了 `refactor(server): 锁端口化…`（`3e16a11c`），改动正是 `guards/{device,lock,sign,cap}.guard.ts` + `libs/lock/*` + `libs/cache` 改名；且我的两项改动（seed 数据 逐字节相同 / locale list 字段名）都不在认证链上 |

集成层**种子成功**的正面证据（同一轮 globalSetup 的输出）：

```text
[integration][seed] 灌入 7 个参考数据集合（app_setting 按设计排除）
[integration][seed] 首轮完成 852ms：sys_dict_type=14 sys_dict_data=169 sys_lang=2 sys_locale=1836 sys_menu=172
                                 sys_role=6 sys_role_menu=15 sys_user=2 sys_user_role=2
[integration][seed] 幂等重放通过 638ms（逐集合 upsert 计数一致）
```

注意：集成层只传 `--only` 7 个**业务**集合，`sys_role_menu` / `sys_user_role` 是现管线**自动带上**的
（旧管线从父文档数组里拆，不表现在 `--only` 上）—— 这条正好证明 `planSeedTables` 的 junction 跟随逻辑。

## 4. 已知限制 / 口径（别当成漏了）

1. **seed 行只含导出映射覆盖的列**：`sys_user.dept_id` 在导出映射里没有（历史遗留），所以 seed 里也没有，
   灌库后是 NULL —— 与旧通道**完全一致**（旧 `mapSysUser` 同样不写 `dept_id`），对拍也证明了这一点。
   哪天它变 NOT NULL，播种会**响亮失败**（`NOT NULL 列` 校验），不会静默灌空。
2. **单测不覆盖真实 PG 元数据读取**（那是一层薄 SQL）；真实链路由双库对拍兜。这是刻意的：
   把 PG 塞进单测等于让 `pnpm test` 依赖环境。
3. `db:seed:verify` **不进** prepush / CI：它要真实 PG 实例 + 会 DROP 两个固定库名。
4. `app_key` 与口令凭证仍然**现生成**（不变）：seed 里没有密钥材料（`lint:seed` 也拦）。
5. 开发库 `walnut_pg` **未被触碰**；两个临时库用后可随时 `DROP DATABASE`。

## 5. 回滚方式（本批无 commit，按需逐条）

1. 恢复旧 seed 与旧管线 —— **从 `07dacfd6` 取**（HEAD 里已经没有 `seed-map.ts`，见 §7.1）：
   `git restore --source 07dacfd6 --staged --worktree -- apps/server/db/seed packages/tooling/scripts/src/db/seed-map.ts packages/tooling/scripts/src/db/__tests__/seed-map.test.ts`
2. 删除新增文件（9 个，见上；建议 `trash` 而非 `rm`）。
3. 其余被改文件逐个 `git restore -- <path>`。
4. 数据库侧无需回滚：现有库没动；临时库 `DROP DATABASE IF EXISTS walnut_seed_a|walnut_seed_b WITH (FORCE)`。

## 6. 与 `db:export:pg` 旧口径的**行为变更**（部署侧要看）

- 默认 `--out` 从 seed 目录改为 `apps/server/.tmp/pg-export`；写进 seed 目录会**报错**。
- 部署工作流只跑 `db:seed:pg`（不受影响）。文档 `backend/postgresql.md` / `db/seed/README.md` /
  `packages/tooling/scripts/README.md` 已同步这两条。

## 7. 并发事实（读 diffstat / 门禁结果前必看）

**这个工作树不是独占的**：我开始后另一条任务线在同一工作树里做了 `libs/cache/src/service/cache.*.ts →
*.cache.ts` 重命名、`libs/lock` 端口化、`repo-global.drift.spec.ts` 等改动，并**中途提交了两个 commit**：

```text
b663d9c6 fix(deploy): 部署验证覆盖 worker 容器，带 RUN_WORKER 开关
3e16a11c refactor(server): 锁端口化、域缓存显式化、Repository 收敛为两模式
07dacfd6 feat(contract): filters wire 的联动收尾…        ← 本批基线
```

### 7.1 ⚠️ HEAD 现在是**坏的**（需要 Lead 处理）

我收尾时用 `git rm` 删了 `seed-map.ts` + 它的用例（这两个删除是**已暂存**状态）。另一条线提交
`3e16a11c` 时把暂存区一起带走了 —— 于是：

- `git ls-tree HEAD packages/tooling/scripts/src/db/` 里**没有** `seed-map.ts`；
- 但 HEAD 的 `seed-pg.ts` 仍写着 `import { … } from './seed-map.ts'`（我的重写还没提交）。

⇒ **HEAD（`b663d9c6`）单独检出时 `@walnut/scripts` 跑不起来**（类型检查/任何 seed 命令都会挂在
找不到 `./seed-map.ts`）。本批的文件必须**整体一起提交**（我的工作树里它们已经自洽：`pnpm lint` /
`types:check` / `lint:seed` 全绿）。若 Lead 要先"修好 HEAD"，最快的做法是先把本批一起提交，
而不是把 `seed-map.ts` 加回去。

影响：

- 上面所有 `pnpm test` / `lint` / `types:check` 结果都**包含**他们的改动；
- 中途曾出现 `check-doc-refs` 红（他们的重命名没同步 `DESIGN-ISSUES-ARCHIVE.md`），随后他们自己修好，现为绿；
- `git diff --stat` 的**全仓**数字包含他们的改动，所以我上面只列**我的**路径；
- 我**没有**修改任何不属于本批的文件（唯一交集文件 `locale.repo.module.ts` 是他们的改动，我没碰）。

## 8. 需要 Lead 拍板

1. **HEAD 已不一致，怎么提交**（最急，见 §7.1）：`3e16a11c` 把我在暂存区的 `seed-map.ts` 删除带走了，
   而我的 `seed-pg.ts` 重写还没提交 ⇒ HEAD 单独检出时 `@walnut/scripts` 跑不起来。建议**本批整体提交**
   （我的工作树自洽、五道判据全绿），而不是把 `seed-map.ts` 补回 HEAD。我不能 commit，需要你决定。
2. **`db:export:pg` 默认 `--out` 改到 `.tmp/`、写 seed 目录直接报错** —— 可见的行为变更
   （老习惯 `pnpm db:export:pg` 后 `git diff` 现在会写到临时目录）。要不要保留这个硬拦截？
3. **`db:seed:verify` 是否进 prepush**（我建议**不**进：需要真实 PG + 会 DROP 两个固定库名；
   改 seed 形态时手动跑）。`db:seed:reshape` 同理不进。
4. **`sys_user.dept_id` 不进 seed** 的口径是否接受（与旧通道一致，但数据权限三期之后它可能有业务含义）。
5. **新 bin 需要 `pnpm install --force` 才会链到 `node_modules/.bin/`**（本包 README 的既有坑）：
   提交后第一次用 `pnpm db:seed:verify` / `db:seed:reshape` 的人要先跑一次；我已实测用
   `node packages/tooling/scripts/bin/<bin>.ts` 直跑等价。
