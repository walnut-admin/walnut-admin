# 数据库与初始化数据

## 跑起来需要什么

PostgreSQL 与 Redis 7+。**单节点 PG 即完整 ACID**，事务不再对部署拓扑有要求（MongoDB 时代必须是
副本集，这一维已随 ADR 0021 消失）。本地开发用
[`apps/server/docker/docker-compose.dev.yml`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/server/docker/docker-compose.dev.yml)
一条 `docker compose up -d` 起齐库与缓存。

连接参数由后端那份 env 决定（`apps/server/env-local/.env.${NODE_ENV ?? development}` 里的
`DATABASE_PG_*` 一组：host / port / user / pass / name），不是一条拼出来的 URI —— 这一点决定了
下面的工具都按**同一份 env** 连接。

表结构由 **TypeORM migration** 管理（迁移文件跟 api app 走，应用启动**不**自动跑迁移），
首次初始化在 `apps/server/` 下执行：

```bash
pnpm migration:run     # 结构演进只经显式命令；回滚对应 migration:revert
```

## 初始化数据（seed）

装好库、跑完 migration、再播一条命令，应用就能起来：界面有字、权限树完整、请求签名可用的密钥也就位了。

```bash
pnpm db:seed:pg                    # 幂等：按 id upsert，重复跑安全
pnpm db:seed:pg --dry-run          # 只看会写什么，不落库
pnpm db:seed:pg --only sys_role    # 只播某几个集合
```

数据本身在 [`apps/server/db/seed/`](https://github.com/walnut-admin/walnut-admin/tree/main/apps/server/db/seed)，
格式是**每个表一个 PG 行数组**：`{ "id": "<uuid>", "created_at": "2026-…", … }`（列名就是 PG 列名，
时间列是 ISO 字符串，jsonb 列是 JSON 值），junction 表（`sys_user_role` / `sys_role_menu`）各有独立文件。
**没有中间映射层**：文件里是什么列就写什么列，列/主键/外键/jsonb 的判据全部从 PG 元数据读
（播表顺序 = FK 拓扑序、自引用 FK 按深度排序、jsonb 绑参前 stringify）。

> 2026-11 批次 5-B 之前这里存的是 Mongo Extended JSON（`{"$oid": …}` / `{"$date": …}`），
> 靠 938 行 `seed-map.ts` 在运行期映射 —— 加一列要同步改映射且**没有门禁**。重建后
> `packages/tooling/scripts/src/db/ejson.ts` 只保留「导入历史导出」的能力，不再是真源格式
> （`pnpm lint:seed` 会把残留的 `$oid` / `$date` 判红）。

**仓库是这份数据的唯一真源**，而且 seed 是幂等可重放的（已存在的行整行刷新为仓内值，junction
只补缺不回收，密钥缺了才现造）：

```bash
pnpm lint:seed                                   # 形态门禁：必需/禁入表、体积、凭据形状、引用完整性、无 EJSON 残留
pnpm db:seed:pg --admin <账号> --password <口令>   # 在**本环境**给某账号建口令凭证并当场验证登录
```

**再生成真源是两步、不手写任何一行**：

```bash
pnpm db:export:pg --out apps/server/.tmp/pg-export      # ① 库 → 快照（Extended JSON，uuid 本体）
pnpm db:seed:reshape --from apps/server/.tmp/pg-export  # ② 快照 → 行形态（默认写仓内 seed）
```

### `db:export:pg` 的两个行为（批次 5-B，2026-11-03 起改的，别按旧习惯写命令）

1. **默认输出目录就是 `apps/server/.tmp/pg-export`**（`DEFAULT_EXPORT_OUT`）——上面第 ① 步的
   `--out` **可以整段省略**，省了不报错、也不落进仓里；显式写出来只是让命令自解释。
   默认值指向临时目录是**有意的**：快照是中间物（消费方是 `db:seed:reshape`），不是真源。
2. **`--out` 指到 `apps/server/db/seed` 会直接失败**：命令在连库**之前**就抛
   `PreconditionError` —— 终端上是「前置条件未满足：导出结果**不能**写进 seed 目录…」，
   **退出码 2**（`0 通过 / 1 查出违规 / 2 前置条件未满足`，口径在
   `packages/tooling/scripts/src/lib/cli.ts`），一个文件都不会写。
   理由：那里是**行形态真源**，把 Extended JSON 快照写进去等于把真源打回旧格式（`pnpm lint:seed`
   也会判红）。`--anonymize` 是另一条同样的红线（脱敏有损，永远不许覆盖真源）。

> ⚠️ 拦截判据是「`--out` **等于** seed 目录」，**不**包括它的子目录 —— 别把快照放进
> `apps/server/db/seed/` 下面的任何一层，那里除了行形态真源不该有别的东西。

两步之后 `git diff` 就是「库与仓的差」，逐行可审。`db:export:pg` 的产物仍按 `_id` 排序、套同一份
裁剪规则（`policy.ts`），所以快照 diff 与仓内文件 diff 同形。

改动 seed 形态 / 映射表 / 播种器之后，跑一次**双库对拍**（旧 seed + 旧管线 与 新 seed 各灌一个空库，
逐表逐列比 + 导出文件比）：

```bash
pnpm db:seed:verify                       # 对着 07dacfd6（批次 5-B 基线）
pnpm db:seed:verify --baseline-ref <sha>  # 换基线
```

它会 DROP/建 `walnut_seed_a` / `walnut_seed_b` 两个库（**不碰**现有库），基线代码与数据从 git 取
（`apps/server/.tmp/seed-verify/`，gitignored）。它**不进** prepush/CI：需要真实 PG 实例。

**口令为什么不随仓库发**：OPAQUE 的服务端 `serverSetup` 就是 `AUTH_OPAQUE_SECRET`，客户端的注册
记录由 OPRF 输出派生的密钥加密 ⇒ 换一个 secret 必然登不进去。所以 seed 只发无凭证的账号档案，
口令由 `--admin` 在目标环境现生成（走与线上完全相同的协议），并在写入后跑一遍完整登录握手验证。

## 哪些数据**刻意不在**仓里

| 不在仓里的 | 为什么 | 谁来补 |
|------------|--------|--------|
| 密钥表（`app_key`） | 里面是**真实密钥材料**（RSA 私钥 PEM、AES key）。提交进公开仓既是泄密，也会被本仓的凭据门禁判红 | `db:seed:pg` 现生成一套 ACTIVE 的 AES + RSA —— 每个安装各自一套，本来也更对 |
| 口令凭证（`sys_user_identity`） | OPAQUE 的注册记录**绑定服务端的 `AUTH_OPAQUE_SECRET`**（该 secret 就是 OPAQUE 的 `serverSetup`）⇒ 换环境必然登不进去，发布它等于发布一份在别人机器上无效的凭证 | 装好后**走应用的注册流程**建立第一个管理员；演示账号用 `--admin` 现建 |
| MFA 密文 / OAuth 绑定 | 密文用 env 密钥加密（跨环境解不开），且属用户隐私；OAuth 是运行时状态 | 各自在使用中产生 |
| 用户设备（`sys_device` / `sys_user_device`） | 设备信息、IP 与地理位置历史 —— 运行时状态 + 个人数据。**设备指纹不落库、不参与身份派生**：B5 起 `device_id` 由服务端随机签发，客户端自报的指纹只在请求面当风控特征 | 各自在使用中产生 |
| 行政区划（`shared_area`） | 数量巨大的参考数据，不是配置，刻意不进 git 也不进发版资产 | 本仓的历史数据由 ETL 一次性搬入（见下节归档说明）；跨环境搬运走 `pnpm db:export:pg --areas <文件>` 另存的资产 |

## 一次性历史任务：Mongo → PG 的 ETL（已归档）

本地存量数据从 MongoDB 搬进 PostgreSQL 走的是 ETL 通道（读本地 Mongo、映射写入 PG，id 由
ObjectId 经 uuid v5 派生，派生实现见 `packages/tooling/scripts/src/db/uuid5.ts`）。它是**一次性历史
任务**（ADR 0021 Decision 6：本地为准、线上不迁），Mongo 读取端、打包入口与运行期映射层
（`seed-map.ts`）已随 2026-11 批次 5-B 全部退役 —— 现在 id 只存在于数据里（seed 文件写 uuid 本体），
运行时不再有派生步骤。要复核迁移正确性时，判据是行级的：同 id 即同源，按表对行数与抽样字段。

## 注意：这不是"清库工具"

`db:seed:pg` 只做 upsert，**不删**库里多出来的行 —— 别指望它把开发数据扫干净。
要重建一个干净环境：清掉 schema（或换一个库名）→ `pnpm migration:run` → `pnpm db:seed:pg`。

## 环境之间的数据流动：三个通道（不做库对库的双向同步）

开发环境与线上环境之间总有数据要来回走，但**成熟做法不是把两个库同步起来**，而是按数据性质拆成三条
**单向**通道，中间用一个可审阅的边界连接。判据只有一句：**这条数据该不该进仓库？**

### 通道 1：参考数据（菜单 / 字典 / 语言包 / 应用设置）—— 仓 → 各环境，单向

这是"双向需求"的真实来源：你在开发库调菜单，线上运营也在后台改菜单。正确做法是给这条链加一段**回灌**，
而不是加一个同步：

1. 线上被人改过 → `pnpm db:export:pg` 拉回仓库形态 → 与仓内 seed 做行级对账（导出按 id 排序、
   套同一份裁剪规则，diff 可审）；
2. 差异进 **PR 审** —— 这一步才是关键：它把"谁改的、改了什么、要不要带走"变成可追溯的决策；
3. 合并后再随发版推到各个环境。

**往生产推**：部署工作流**每次部署都会跑** `db:seed:pg`（按 id upsert，库收敛到该 tag 的仓内形态，
见 [`deploy/README.md`](https://github.com/walnut-admin/walnut-admin/blob/main/deploy/README.md)）——
所以运维在后台改过的行**必须**走上面的回灌进仓，否则下次部署会被冲掉。这是相对 mongoimport 时代
"非空整集跳过"的**有意变更**：跳过语义有个结构性副作用（后续版本新增的行永远到不了已有数据的库），
收敛语义没有。手工侧就是同一条 `pnpm db:seed:pg`（幂等，重放收敛到仓）。

部署侧的操作步骤与复核命令见 [`deploy/README.md`](https://github.com/walnut-admin/walnut-admin/blob/main/deploy/README.md)
的「首次部署后注入参考数据」。

推送方向永远是**仓 → 环境**。环境上的运行时数据（用户、日志、设备、业务单据）不属于这条通道 ——
它们**不该被同步**，各环境各活各的。判断标准：它该进仓吗？不该进的数据，也不该被"同步"。

### 通道 2：线上 → 开发（排障、复现）—— 单向 + **必须脱敏**

```bash
# 从线上拉一份快照到本地（脱敏是有损的，所以必须换一个目录，别覆盖仓内 seed）
pnpm db:export:pg --anonymize --out apps/server/.tmp/prod-snapshot
```

- 导入前**必须过一遍脱敏**（邮箱、手机、设备指纹、IP 与地理位置历史、MFA 密文都属个人数据）。
- 脱敏规则在 `packages/tooling/scripts/src/db/anonymize.ts`：按**键名**判定（不按表路径 ——
  路径写法等于把 schema 抄一遍，字段一改规则就静默失效），掩码保留形状（邮箱 `a***@example.com`、
  手机 `138****1111`、IP `203.0.*.*`、密文 `<redacted:32>`、坐标降到城市级）。规则库无关，
  直接作用在反向映射后的文档上。
- 同一套规则也挂在 `pnpm lint:seed` 上：仓内 seed 里出现未脱敏的个人数据会被点名到字段路径。
- 反向（开发 → 线上）**不做**：把开发库的数据直接写进线上，主键冲突事小，同文档互相覆盖与
  "删除算谁的"事大。

### 通道 3：开发 → 线上的**业务数据** —— 不做同步，做成"版本化数据变更"

要往线上多几条字典/菜单/设置：把它写进仓（通道 1），随发版走。
PG 世界把"结构变更"制度化这件事，本仓就是 **TypeORM migration 本身**（`migration:run` 跑显式命令、
迁移文件进 PR 审，见上文）；真要迁一批业务数据（整理好的组织、用户等）：写成**一次性、有版本号、
可回滚的迁移脚本**（migration 或幂等 SQL），同样进 PR 审。

### 什么时候才该考虑"实时双向"

只有一条：**两个环境都要能写同一批数据，且必须秒级互相可见**。那是另一个量级的工程，
成熟选项只有三类：

- **逻辑复制**（PostgreSQL 内置 publication / subscription，或 pglogical 这类扩展）；
- **触发器队列 / CDC 自研消费者**（灵活，但槽位管理、目标端映射、消费监控全要自己管）；
- **云厂商 DTS**（开箱即用，但绑定云环境，私有化场景不可用）。

代价清单必须提前认下来：同表并发写的**冲突解决**、删除语义、复制槽与 WAL 容量窗口、断点续传、
一致性校验（行数 + 抽样哈希）、延迟告警，以及双向必须**防回环**。给一个中后台模板项目上这套，
维护成本远超收益 —— 真要做，务实做法是按表拆**单一写入方**（例如语言包只允许开发环境写、
用户数据只允许线上写），而不是全库双向。

参考：[PostgreSQL 逻辑复制官方文档](https://www.postgresql.org/docs/current/logical-replication.html)
（publication / subscription 模型与冲突语义）、
[生产数据脱敏克隆到本地这类工具的设计](https://laravel-news.com/clonio-cli-clone-production-databases-with-anonymized-data)。
