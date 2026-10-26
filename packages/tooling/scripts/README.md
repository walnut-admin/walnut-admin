# `@walnut/scripts` —— 仓库级脚本的通用层

> **层判定问句**：这个模块认识「发版」吗？认识 → 它在 [`@walnut/release`](../release/)；不认识 → 它在这儿。
>
> 本包装**不认识业务的仓库基础设施**：纯逻辑工具（`lib/`）、仓库门禁（`ci/`）、env 加解密（`env/`）。
> 它自己也提供八个 bin，被根 `package.json` 直接调用。

## 入口（root scripts 经 bin 调用）

| bin | 根脚本 | 作用 |
|-----|--------|------|
| `walnut-lint-workflows` | `pnpm lint:workflows` | actionlint 校验 workflow（未安装时跳过，CI 强制） |
| `walnut-check-doc-refs` | `pnpm lint:docs-refs` | 校验**活文档正文**里引用的 workspace 包名与仓库路径是否真实存在 |
| `walnut-setup-env` | `pnpm setup-env` / `pnpm encrypt-env` | dotenvx 加解密 `env-encrypted/` ↔ `env-local/` |
| `walnut-check-git-hooks` | `pnpm hooks:check` | 断言 git 钩子由 lefthook 托管（防门禁静默消失） |
| `walnut-db-etl` | `pnpm db:etl` | Mongo→PG 存量搬迁（Mongo 只读；`--fresh` 全量，默认增量幂等） |
| `walnut-db-verify-etl` | `pnpm db:verify-etl` | ETL 三重对账（计数 / 抽样 / 聚合），有差异退出码非 0 |
| `walnut-db-seed-pg` | `pnpm db:seed:pg` | 仓内 seed JSON → PG（按 id upsert，幂等可重放；CI/部署通道） |
| `walnut-db-export-pg` | `pnpm db:export:pg` | PG → seed 形态 Extended JSON（uuid 口径，见下方「PG 导出口径」） |

发版编排的 bin（`walnut-release`）在 [`@walnut/release`](../release/)。

### 写用例时别只看本机（CI 跑 Linux）

本地是 Windows、CI 是 Linux，**平台假设**会让"本机全绿"变成"CI 三个用例红"（2026-09-29 实测：
`/usr/bin/google-chrome` 在 runner 上**真的存在**、`C:/tmp` 在 Linux 上**不是**绝对路径、
`path.relative` 对 `C:\repo` 的判定完全不同）。规矩：**被测函数把平台原语做成可注入参数**
（`exists` / `isAbsolute` / `relative` 之类，默认值仍是真实实现），用例注入两个方向各测一遍 ——
这样断言与宿主无关，也顺带把"另一种平台的语义"真的测到了。

`pnpm install` 会报 **"Already up to date" 并且不把新 bin 链接到 `node_modules/.bin/`** —— 于是
`pnpm <新脚本>` 报 "command not found"，看起来像脚本写错了。修法：跑一次
`pnpm install --force`（**加 bin、加 workspace 依赖之后都算**）。
判据：`Test-Path node_modules/.bin/<bin 名>`，或直接 `pnpm exec <bin 名> --help`。

### 新增一道门禁 = **五处**接线（2026-09-30 实测漏过三处）

加一个门禁 bin 不是"写完那个文件"就完了 —— 仓库有三条机械判据盯着"门禁必须真的被跑到"，漏一处就红：

| 面 | 在哪 | 漏了会怎样 |
|---|---|---|
| 门禁本体 + bin 登记 | `src/ci/check-*.ts` + `bin/*.ts` + 本包 `package.json` 的 `bin` 映射 | `pnpm <脚本>` 报 command not found |
| 根脚本 | 仓库根 `package.json` 的 `lint:*` | 同上 |
| 推送前门禁表 | `src/ci/prepush.ts` 的段 | `prepush.test.ts` 的整表快照红 |
| 发版电池 | `packages/tooling/release/src/release/steps.ts` | `gate-wiring.test.ts`「发版电池是 prepush 的超集」红 |
| CI 触发面 | `.github/workflows/*.yml` 里真跑一步 | `gate-wiring.test.ts`「没有『只有本地守』的门禁」红 |
| 文档 | `apps/docs/.../monorepo/release.md` 的电池表 | `steps.test.ts`「电池表与 RELEASE_BATTERY 逐字对账」红 |

**这五条判据本身就是那道闸**：漏了不用等人发现，`pnpm test` 直接点名 ✓。另外两条来自同一轮的教训：

- **`actionlint` 与 shell 门禁互补**：它用 Go 的 YAML 解析器，比 `yaml`（npm）宽松 —— 2026-09-30 我把
  `run: |` 与下一行拼成一行，**`actionlint` 判绿**而 shell 门禁报出精确行列号。两个都要留。
- **别用 `pwsh`/`Set-Content` 改仓库里的中文文本**：编码与 BOM 会毁掉注释（本仓实测多次）；用编辑工具。

## 对外接口：只有 `lib/*`

```jsonc
// package.json
"exports": { "./lib/*": "./src/lib/*.ts" }
```

`@walnut/release` 就是这样复用本包的通用能力（`import { REPO_ROOT } from '@walnut/scripts/lib/repo-root'`）。
**收窄到 `lib/*` 是刻意的**：`ci/` 与 `env/` 是给本包自己的 bin 用的实现，不是给别的包 import 的 API ——
把它们也导出去，等于承诺两个没人调用、却必须保持兼容的入口。

## 模块地图

### `src/lib/` —— 通用能力（不认识任何业务）

| 模块 | 职责 |
|------|------|
| `repo-root.ts` | 从 `import.meta.dirname` 向上找 `pnpm-workspace.yaml` + `.git` 定位仓库根 |
| `git.ts` | **只读** git 查询：一条命令行一个具名函数，argv 直传、cwd 固定仓库根、读不到返回 null/空集 |
| `child-run.ts` | 子进程执行：实况转播 + 心跳 + 预算 + 失败尾部缓冲；`sanitizeEnv` 剥凭据 |
| `child-tree.ts` | 进程树收尾（Windows 走 `taskkill /T /F`）—— 防「父进程退了、子进程还在改工作区」 |
| `child-output.ts` | 输出尾部缓冲（失败时重播最后 N 行） |
| `pnpm-launcher.ts` | 定位真实的 pnpm 可执行文件；**拒绝 `shell: true`**（`cmd.exe` 会展开 `%VAR%` 泄凭据） |
| `prompt.ts` | 终端交互：非 TTY 一律立即返回空串，绝不挂住 |
| `log.ts` | `writeOut`（TTY 走 stream / 管道走 `fs.writeSync`，Windows 代码页正确）+ `frame` 横幅 |
| `errors.ts` | `PreconditionError`（退出码 2 语义） |
| `ref-guard.ts` | ref 白名单：挡住选项形态（`-` 开头）与穿越形态（`..`）的注入 |
| `json-file.ts` | 读写 JSON（读不到返回 null，不抛） |

### `src/ci/` —— 仓库门禁

| 模块 | 职责 |
|------|------|
| `lint-workflows.ts` | actionlint（缺二进制时跳过并告警；CI 的 workflow-lint.yml 才是权威闸门） |
| `check-doc-refs.ts` | 活文档里的包名 / 仓库路径引用校验。**判据宁可漏报不可误报**：路径只在 markdown 反引号里查、必须顶层目录开头、允许语境解析（仓库根 / 文档目录 / `apps/server/`）；ADR 与待办文档因「合法引用历史路径」被排除；`ALLOWED_*` 豁免清单每条都要写理由 |
| `check-git-hooks.ts` | 断言三个钩子文件存在且含 lefthook 托管标记 |

### `src/env/` —— 环境文件

| 模块 | 职责 |
|------|------|
| `setup-env.ts` | dotenvx 加解密；纯变换（`rebuildKeysFile` / `stripPublicKeyHeaderContent`）已导出以便单测 |

### `src/db/` —— 数据通道（seed / 导出 / ETL / 对账）

| 模块 | 职责 |
|------|------|
| `seed.ts` | `db:seed`（Mongo 播种）/ `db:export`（反向导出）的参数、连接、写入计划 |
| `export-pg.ts` / `seed-pg.ts` | PG 版同两条通道（`db:export:pg` / `db:seed:pg`）；导出口径见下 |
| `etl-map.ts` | **唯一映射层**：Mongo 文档 → PG 行（`$date`→timestamptz、`$oid`→uuid v5、menu.meta 拍平、junction 拆分、Q7 parse、Q4 setting_value 重写）。`db:etl` / `db:seed:pg` / `db:verify-etl` 三条通道共用 —— 对账成立的前提就是「同一份映射」 |
| `etl-mongo-to-pg.ts` | `db:etl`（Mongo→PG 存量搬迁；Mongo **只读**）：增量幂等（v5 + `ON CONFLICT DO NOTHING`）/ `--fresh` 全量；shared_area 66 万行分批多行 INSERT（每批一个事务，~1.4 万行/秒） |
| `verify-etl.ts` | `db:verify-etl` 三重对账（计数 / 抽样逐列 / 聚合）；任何差异 → 退出码 1 |
| `uuid5.ts` | ObjectId hex → uuid v5 派生的**唯一真源**（namespace 常量也在这里，永不可改） |
| `mongo-conn.ts` / `pg-conn.ts` | 连接解析（`DATABASE_*` / `DATABASE_PG_*`，与后端同一组 env 变量） |

**PG 导出口径（`db:export:pg`）**：PG 主键是 uuid v5，**反解回 24 位 ObjectId hex 不可逆**。
导出的 `_id` / 引用字段写 PG uuid 本体，`$date` 仍是 Extended JSON 包装 —— 该格式是
「PG 生态回灌」用的快照（可被 `db:seed:pg --seed-dir <导出目录>` 原样吃回），
**不追求与仓内 Mongo seed 文件逐字节一致**；仓内 seed 的唯一真源仍是
`apps/server/db/seed/` + `db:export`（Mongo 版）。

## 两条硬约束

1. **本包源码由 Node 原生执行**（全部 bin + 被 `@walnut/release` 的 bin 间接拉起）。
   因此它继承 `@walnut/tsconfig/ts.json`，受 **`erasableSyntaxOnly`** 约束：
   不许 `enum`、不许非 ambient `namespace`、不许构造函数参数属性。
   违反会在 `pnpm types:check` 当场报错，而不是等到运行时才炸。

2. **`@dotenvx/dotenvx` 是本包自己的依赖**，`setup-env` 从它的 `package.json#bin` 解析出 CLI 入口、
   用 `process.execPath` 以 argv 拉起 —— **不再用 `npx dotenvx`**。
   原来的 `npx` 形态依赖「cwd 的 node_modules 里能找到 dotenvx」，依赖一下沉就会静默退化成联网下载；
   而且它经 shell，在 Windows 上还要额外处理 `.cmd`。

## 排查

| 现象 | 先看哪里 |
|------|----------|
| 门禁像是没跑 | `pnpm hooks:check`；再看 `pnpm-workspace.yaml` 的 `allowBuilds` 有没有 `lefthook: true` |
| `pnpm setup-env` 报找不到 dotenvx | 本包的 `node_modules/@dotenvx/dotenvx` 是否装上（`pnpm install`） |
| 单测报 `Cannot find module 'yaml'` | `yaml` 是本包的 devDependency（只有 lefthook 配置的审计用例需要它） |
