# `@walnut/scripts` —— 仓库级脚本的通用层

> **层判定问句**：这个模块认识「发版」吗？认识 → 它在 [`@walnut/release`](../release/)；不认识 → 它在这儿。
>
> 本包装**不认识业务的仓库基础设施**：纯逻辑工具与命令表（`lib/`）、统一入口（`run/`）、仓库门禁与本地 CI（`ci/`）、
> env 加解密（`env/`）、数据通道（`db/`）、脚手架（`scaffold/`）、产物冒烟（`smoke/`）、文档站维护（`src/docs/`）。
> 它自己也提供一批 bin（清单以本包 `package.json` 的 `bin` 字段为准），由**命令表**或保留的根脚本引用。

## 入口（命令表 / 根脚本经 bin 调用）

根 `package.json` 只留外部契约与日常主干的那几条；其余仓库级命令住**命令表**
（`src/lib/commands.ts`），经 `pnpm walnut <id>` 执行。

| bin | 入口 | 作用 |
|-----|------|------|
| `walnut-lint-workflows` | `pnpm walnut lint:workflows` | actionlint 校验 workflow（未安装时跳过，CI 强制） |
| `walnut-check-doc-refs` | `pnpm walnut lint:docs-refs` | 校验**活文档正文**里引用的 workspace 包名与仓库路径是否真实存在 |
| `walnut-setup-env` | `pnpm setup-env`（根脚本）/ `pnpm walnut encrypt-env` | dotenvx 加解密 `env-encrypted/` ↔ `env-local/` |
| `walnut-check-git-hooks` | `pnpm walnut hooks:check` | 断言 git 钩子由 lefthook 托管（防门禁静默消失） |
| `walnut-ci-local` | `pnpm walnut ci:local` | 本地复刻 CI 的构建类步骤（顺序执行，四态退出码） |
| `walnut-db-seed-pg` | `pnpm walnut db:seed:pg` | 仓内 seed **行数组** → PG（按主键 upsert，幂等可重放；CI/部署通道） |
| `walnut-db-export-pg` | `pnpm walnut db:export:pg` | PG → **历史导出**形态 Extended JSON（uuid 本体；消费方是 reshape / 人工 review） |
| `walnut-db-seed-reshape` | `pnpm walnut db:seed:reshape` | 历史导出 → **PG 行形态** seed 目录（`{ id, … }` + junction 独立文件） |
| `walnut-db-verify-seed` | `pnpm walnut db:seed:verify` | 双库对拍：旧 seed + 旧管线 与 新 seed 各灌一个空库，逐表逐列 + 导出文件比 |
| `walnut-docs-version` | `pnpm walnut docs:version` | 查**本仓** GitHub 最新发版，写回 `apps/docs/version.json`（没有 Release 时回退本机最新 tag） |

（其余门禁 bin 见本包 `package.json` 的 `bin` 字段；本表只列与数据 / 环境 / 本地 CI 相关的那批，
完整体由 `gate-wiring.test.ts` 的「没有孤儿 bin」核对。）

发版编排的 bin（`walnut-release`）在 [`@walnut/release`](../release/)。

### 统一入口的契约（`src/run/`）

`pnpm walnut <id> [<id>…]` 按**表里的顺序**执行，一条失败不中断其余。没有给 id 时：在终端里进多选
（上下键移动、空格勾选、回车执行）；不是终端就打印用法与清单，并以「前置条件未满足」退出 2 ——
非交互的调用方绝不停在界面上。

- 入口自己的选项（`--list` / `--json` / `--dry-run` / `--help`）**只认第一个命令 id 之前的**。id 之后的旗标
  属于那条命令：`pnpm walnut db:seed:pg --dry-run` 是种子工具自己的演练，不是入口的「只打印不执行」。
- 非旗标的词，只有命令在表里声明了 `positionalArgs` 才算它的位置参数（如 `scaffold:lib <name>`）；
  没声明的按未知 id 报错 —— 把拼错的 id 吞成参数，后果是只跑第一条还显示通过。别的命令传参数写在 `--` 之后。
- `--json` 是 agent 读表的入口：每条命令带 `argv`、`budgetMs`、`positionalArgs`。
- 入口脚本 `bin/run.ts` **不登记为 bin**，由根脚本直接 `node` 调用：命令表里有会删 `node_modules` 的
  `clean:all`，入口不能站在 `node_modules/.bin` 的垫片上；刚克隆、还没装依赖的仓库里 `--list` 也要能用。

细则与理由见 `src/run/args.ts` 与 `bin/run.ts` 的头注释。

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

### 新增一道门禁 = **六处**接线（2026-09-30 实测漏过三处，2026-11 加入命令表与入口形态）

加一个门禁 bin 不是"写完那个文件"就完了 —— 仓库有多条机械判据盯着"门禁必须真的被跑到"，漏一处就红：

| 面 | 在哪 | 漏了会怎样 |
|---|---|---|
| 门禁本体 + bin 登记 | `src/ci/check-*.ts` + `bin/*.ts` + 本包 `package.json` 的 `bin` 映射 | `pnpm walnut <id>` 报 command not found |
| **命令表** | `src/lib/commands.ts` 的一项（id / 分组 / label / why / `['exec', 'walnut-*']`） | `pnpm walnut <id>` 不存在；`gate-wiring.test.ts` 会把它报成孤儿 bin |
| 推送前门禁表 | `src/ci/prepush.ts` 的段（首词写命令表 id） | `prepush.test.ts` 的整表断言红 |
| 发版电池 | `tooling/release/src/release/steps.ts` | `gate-wiring.test.ts`「发版电池是 prepush 的超集」红 |
| CI 触发面 | `.github/workflows/*.yml` 里真跑一步（**入口形态**：`run: pnpm walnut <id>`） | `gate-wiring.test.ts`「没有『只有本地守』的门禁」红 |
| 文档 | `apps/docs/.../monorepo/release.md` 的电池表 | `steps.test.ts`「电池表与 RELEASE_BATTERY 逐字对账」红 |

**这些判据本身就是那道闸**：漏了不用等人发现，`pnpm test` 直接点名 ✓。另外两条来自同一轮的教训：

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
| `github.ts` | GitHub 纯判定面：remote 解析 / token 掩码 / API 地址 / 网页 Release 链接 / 凭据读取口径（`GITHUB_TOKEN` > `GH_TOKEN`）。发版编排与 `docs:version` 共用 |
| `commands.ts` | **命令表**：仓库级命令的唯一真源（id / 分组 / 说明 / 凭什么 / argv 或自定义执行 / 预算 / 位置参数）。`resolveCommandArgv` 把表里的名字解析成真正要跑的 argv，推送前门禁表、本地 CI 步骤表、发版电池都靠它 |
| `workspace.ts` | workspace 包的枚举，与「包目录形态」判据（`apps/<x>` / `tooling/<x>` / `packages/<组>/<x>`）。形态与 `pnpm-workspace.yaml` 的 glob 逐条对应，由用例核对 |
| `clean-all.ts` | `clean:all` 的纯逻辑：列出要删的 `node_modules`（各包的在前、根的在后）并删除，返回删掉的与删不掉的 |
| `cli.ts` | `runCli`：四态退出码的唯一出口（0 通过 / 1 查出违规 / 2 前置条件未满足 / 3 未验证）。本包的 bin 都是薄入口 |
| `emoji.ts` / `emoji-ranges.ts` | 「注释与常驻文档里不许有 emoji」的扫描与字符区段。同一份区段也用在 `@walnut/eslint-config` 的本地规则里，改一边要改另一边 |

### `src/run/` —— 统一入口

| 模块 | 职责 |
|------|------|
| `args.ts` | 参数解析（纯函数）：选中的 id、透传的参数、入口自身的选项；契约见上面「统一入口的契约」 |
| `select.ts` / `clack.ts` | 没给 id 时的多选：分组与选项是纯函数，`@clack/prompts` 惰性 import（不进多选就不需要它） |
| `execute.ts` | 按表顺序执行：cwd 恒为仓库根、逐条预算、子进程输出实时转播、三态不折叠 |
| `render.ts` | `--list` / `--json` / `--dry-run` 的输出形状（由用例钉住，agent 依赖它） |

### `src/scaffold/` —— 脚手架

| 模块 | 职责 |
|------|------|
| `lib-registration.ts` / `scaffold-lib.ts` | `scaffold:lib <name>`：新增一个后端 lib 要登记的每一处（分层、组合根、drift spec 的矩阵）由它一次改完；先出计划、`--dry-run` 只演练 |

### `src/ci/` —— 仓库门禁

| 模块 | 职责 |
|------|------|
| `lint-workflows.ts` | actionlint（缺二进制时跳过并告警；CI 的 workflow-lint.yml 才是权威闸门） |
| `check-doc-refs.ts` | 活文档里的包名 / 仓库路径引用校验。**判据宁可漏报不可误报**：路径只在 markdown 反引号里查、必须顶层目录开头、允许语境解析（仓库根 / 文档目录 / `apps/server/`）；ADR 与待办文档因「合法引用历史路径」被排除；`ALLOWED_*` 豁免清单每条都要写理由 |
| `check-git-hooks.ts` | 断言三个钩子文件存在且含 lefthook 托管标记 |
| `prepush.ts` | **推送前门禁表**（`PREPUSH_GATES`）与并行执行器：每一段有自己的预算与「凭什么」；经 turbo 扇出的几段进同一条重道互斥（并发上限数得到「段」、数不到段里面的扇出）；三态结局不折叠，失败输出里认得出 Node 进程的原生崩溃 |
| `local-ci.ts` | 本地复刻 CI 的构建类步骤（`LOCAL_CI_STEPS`），顺序执行、第一个失败即止。worker 冒烟的**唯一实现**在这里，CI 经入口调用 |

（其余 `check-*.ts` 是各道门禁的本体；每道门禁怎么调用、凭什么存在，见命令表 `src/lib/commands.ts` 与推送前门禁表。）

### `src/smoke/` —— 产物冒烟

| 模块 | 职责 |
|------|------|
| `dist.ts` | `smoke:dist`：用真实浏览器打开构建产物，断言启动画面消失、页面有结论（没有浏览器时按「未验证」退出） |

### `src/env/` —— 环境文件

| 模块 | 职责 |
|------|------|
| `setup-env.ts` | dotenvx 加解密；纯变换（`rebuildKeysFile` / `stripPublicKeyHeaderContent`）已导出以便单测 |

### `src/docs/` —— 文档站维护

| 模块 | 职责 |
|------|------|
| `docs-version.ts` | `docs:version`：`origin` → GitHub `releases/latest` → 写 `apps/docs/version.json`。判定（404 回退本机 tag、空 `tag_name` 不算有效版本、错误体截断）是纯函数，网络与文件 IO 在薄边缘 |

### `src/db/` —— 数据通道（seed / 导出 / ETL / 对账）

| 模块 | 职责 |
|------|------|
| `seed.ts` | seed 目录 / env 文件 / 路径解析的共享纯助手 |
| `seed-pg.ts` | `db:seed:pg`：行数组 → PG。列/主键/外键/jsonb 判据全部从 `information_schema` 读（**没有映射层**），播表顺序 = FK 拓扑序 |
| `seed-reshape.ts` | `db:seed:reshape`：历史导出（EJSON）→ 行形态。`ROW_SPECS` 是「导出键 → 列名」的唯一映射表，未消费的键一律抛（漏一列是静默的） |
| `export-pg.ts` | `db:export:pg`：PG → 历史导出形态（uuid 本体 + `$date` 包装）；默认 `--out` 是临时目录，写进 seed 目录会被拦截 |
| `seed-verify.ts` | `db:seed:verify`：双库对拍（基线从 git 取：旧 seed + 旧管线代码），逐表逐列 + 导出文件比 |
| `ejson.ts` | Extended JSON 读写**兼容器**：只服务「历史导出」通道（不再是 seed 真源格式） |
| `policy.ts` / `anonymize.ts` | 裁剪（哪些数据进仓）与脱敏（个人数据掩码），导出与门禁共用 |
| `uuid5.ts` | ObjectId hex → uuid v5 派生的**唯一真源**（namespace 常量也在这里，永不可改；运行时已不再派生——id 直接写在 seed 里） |
| `pg-conn.ts` | 连接解析（`DATABASE_PG_*`，与后端同一组 env 变量） |

**PG 导出口径（`db:export:pg`）**：主键是 uuid，**反解回 24 位 ObjectId hex 不可逆**。导出的
`_id` / 引用字段写 PG uuid 本体，`$date` 仍是 Extended JSON 包装 —— 这是**历史导出形态**，
消费方只有两个：`db:seed:reshape`（拍平成仓内真源）与人工 review。

**仓内 seed 的真源形态是 PG 行数组**（`{ id, created_at, … }` + junction 独立文件），再生成是
固定的两步（`db:export:pg --out <临时目录>` → `db:seed:reshape --from <临时目录>`）。旧那套
「Mongo 文档 + `etl-map.ts` 运行期映射」已于 2026-11 批次 5-B 退役，映射表只剩 `seed-reshape.ts`
的 `ROW_SPECS`（导出键 → 列名），且**未消费的键会抛**——加列必须同步它，不再有静默漏列。

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
| 门禁像是没跑 | `pnpm walnut hooks:check`；再看 `pnpm-workspace.yaml` 的 `allowBuilds` 有没有 `lefthook: true` |
| `pnpm setup-env` 报找不到 dotenvx | 本包的 `node_modules/@dotenvx/dotenvx` 是否装上（`pnpm install`） |
| 单测报 `Cannot find module 'yaml'` | `yaml` 是本包的 devDependency（只有 lefthook 配置的审计用例需要它） |
