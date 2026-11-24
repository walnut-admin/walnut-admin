# tooling 收束与根脚本改造：分阶段实施计划

> 状态：【本地已完成，待仓库所有者审阅与推送】2026-11-23 立项，2026-11-24 八个阶段在本地实施并验证完毕，**全程未提交**（改动都留在工作区）。唯一没有验证到的是阶段 8 在 GitHub runner 上的行为，要等下次推送。收尾时的处理与遗留见第 14 节。
> **定位**：把工具链收进仓库根的 tooling 目录，把根 `package.json` 里平铺的脚本收进一张命令表，以及沿途查实的几项收束与清理。本篇是执行蓝图。
> **读者**：执行各阶段的人与 agent；评审改动的人。
> **权威边界**：**为什么这么定**在 ADR 里（阶段 1、3、6 各出一篇）；**现在是什么样**在[架构地图](../monorepo/architecture.md)与各专题页。本篇只写**怎么做、怎么验**，与代码冲突时以代码为准。

## 0. 怎么用这份计划

- 阶段**串行**，顺序见第 2 节。每个阶段派一个实施 agent，给它「第 3 节通用纪律 + 该阶段的全部内容」。
- 一个阶段只有在该节「验证」里的命令**全部跑过**之后才算完成。汇报时把通过、失败、没验证到分开写。
- **全程不提交、不推送**，改动留在工作区由仓库所有者审阅。
- **路径写法**：tooling 各包的路径一律按**阶段 1 之后**的位置写（仓库根的 `tooling/` 下）。阶段 1 已完成，这些路径现在都真实存在。
- **尚不存在的目标路径不加反引号**：`pnpm lint:docs-refs` 会校验反引号里的仓库路径与 `@walnut/` 包名是否真实存在。所以尚未建成的包与文件在正文里用普通文字写。
- 每完成一个阶段：把第 2 节状态表里对应行改为「已完成」，把该阶段正文里因此失效的旧路径改成新路径，并在该阶段末尾追加「结果记录」。
- **复核纪律**：实施 agent 的汇报不等于结论。每个阶段结束后由编排者亲自复跑关键验证、看 diff；汇报里与事实不符的说法要记进结果记录。

## 1. 背景与已查实的事实

### 1.1 为什么要动

- 工具链六包（tsconfig、eslint-config、commitlint-config、vitest-config、scripts、release）此前住在 `packages/` 下的 tooling 组里，与业务共享包混在一棵树上。仓库所有者希望它像 apps、packages 一样是仓库根的一等目录。
- 根 `package.json` 的 scripts 把所有仓库级命令平铺出来（2026-11-23 口径：六十余条，几乎全是一行委托）。它难看、难维护，人与 agent 都要通读整张表才知道有什么能跑。目标是收成**一张命令表加一个入口**：人在终端里空格多选，agent 用参数直接执行。

### 1.2 调研依据

**成熟仓库怎么放 tooling**（2026-11-23 用 GitHub API 逐个核实根目录）：

- Turborepo 官方口径是 `apps/` 放应用、`packages/` 放其余一切（含库和 tooling），见 [Structuring a repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)。也就是本仓此前的形态。
- 但「tooling 独占顶层目录」很普遍：Nx、NestJS、Deno、Angular、ESLint、typescript-eslint、TypeScript、Expo、AFFiNE 都有顶层 `tools/`；Element Plus 用顶层 `internal/`，里面正是 eslint-config 与 build，且是[刻意迁过去的](https://github.com/element-plus/element-plus/pull/6553)；Vue core 用 `packages-private/`；dify 用 `dev/`。
- 这些仓库的**根目录**同样留着各工具约定位置的入口文件（根 eslint 配置、knip 配置等）。成熟做法是「根留薄入口、逻辑进 tooling 包」，而不是把根清空。
- 命名上 `tools`、`internal` 比 `tooling` 更常见。本仓沿用 `tooling`：它已经是目录组名，文档、tag、commit scope 都在用。

**交互选择器**：

- [`@clack/prompts`](https://www.npmjs.com/package/@clack/prompts) 的 `multiselect` 就是「上下键移动、空格勾选、回车确认」，只用保守的 ANSI 序列，依赖很轻（[文档](https://bomb.sh/docs/clack/packages/prompts)）。
- 「一个入口加交互选择」有先例：[`just --choose`](https://github.com/casey/just)（[介绍](https://www.romainlespinasse.dev/posts/interactive-just-recipes)、[LWN](https://lwn.net/Articles/1047715)）。
- 没有找到同时覆盖「人用交互、agent 用参数」的现成方案，这部分要自己设计。

**pnpm 发版台账**：从本机 pnpm 原生二进制里枚举出 `versioning` 功能的全部错误码与报错文案，没有「台账条目的目录与现有目录对不上」这一类；`dir` 的唯一语义是给「同名多项目」的条目消歧。所以历史条目里的旧目录无害，台账不需要动。

**pnpm 怎么转发脚本参数**（2026-11-23 在仓库外的临时目录用 pnpm 12 实测）：位置参数、布尔旗标、等号旗标、`--` 分隔符、甚至 pnpm 自己的 `--filter=`，全部**原样**传给脚本。入口的参数解析不能指望 pnpm 帮忙拦截任何东西。

### 1.3 已查实的陷阱（按阶段索引）

| 陷阱 | 影响阶段 |
|------|----------|
| `@walnut/scripts` 与 `@walnut/release` 各有一份硬编码的「包目录形态正则」，只认 `apps/<x>` 与 `packages/<组>/<x>`，不匹配的目录**静默跳过** | 1 |
| 五处测试用固定六层向上找仓库根；目录搬高一层后会越过仓库根，且不报错 | 1 |
| `seed-verify.ts` 有两行读的是**历史基线提交**那棵树，那里的路径就是旧的，不能改 | 1 |
| `attribution.test.ts` 有一行用真实包表；路径对不上后会走 scope 兜底、恰好也通过，属于**误绿** | 1 |
| 文档门禁的顶层目录白名单里原本没有 `tooling`，不加的话新路径无人校验 | 1 |
| 根 `knip:packages` 的通配符原本没加引号，在 POSIX shell 上只分析了第一个包 | 1 |
| server 的三份 vitest 配置都不收集 `test/` 下的 `*.spec.ts`，drift spec 搬过去会**静默不跑** | 7 |
| `scaffold:lib` 会**读写** `lib-registration.drift.spec.ts`，路径写死在常量里 | 7 |
| `check-turbo-cache` 的缓存污染守卫原本不认入口形态的命令，改调入口前要先教它 | 3、8 |
| 根脚本形态门禁有一条「扫描面必须大于若干条」的下限断言，脚本收少了会红 | 3 |
| `pnpm ci` 是 pnpm 的内置命令，入口不能叫 `ci` | 3 |
| `module-graph.ts` 不是 spec，被编进了生产产物 | 7 |

## 2. 阶段总览

| 阶段 | 内容 | 依赖 | 本地能否完整验证 | 状态 |
|------|------|------|------------------|------|
| 1 | tooling 迁移到仓库根 | 无 | 能 | 已完成（2026-11-23） |
| 2 | 死代码清理 | 1 | 能 | 已完成（2026-11-23） |
| 3 | 根脚本收束：命令表加统一入口 | 1 | 能 | 已完成（2026-11-23） |
| 4 | post-verify 接成门禁 | 3 | 能 | 已完成（2026-11-24） |
| 5 | 文档站：fetch-version 重写、补两个包的 README | 3 | 能（刷新版本号需联网） | 已完成（2026-11-24） |
| 6 | 抽出 vite-config 包 | 1、3 | 能 | 已完成（2026-11-24） |
| 7 | drift spec 搬出产品源码 | 1 | 能 | 已完成（2026-11-24） |
| 8 | CI 去重 | 3 | **不能**，真正生效要等下次推送 | 本地部分已完成（2026-11-24）；CI 上的行为待下次推送确认 |

阶段 3 排在新门禁、新脚本之前，这样它们只需接一次线。

## 3. 通用纪律（每个实施 agent 必读）

1. 动手前先读根 `AGENTS.md` 与所在目录的 `AGENTS.md`。它们是本仓规则的唯一真源。
2. **不提交、不推送、不改 git 配置。** 需要移动文件用 `git mv`，需要删除用 `git rm`。
3. 只用 pnpm。新依赖一律走 `catalog:`（写在 `pnpm-workspace.yaml`）。不许新建 `.mjs`、`.cjs`。
4. 不许隐式全局：该 import 的一律显式 import。
5. 新增纯函数或工具必须补测试，写法参照同目录已有的测试。
6. 改持久化结构、改门禁、改文档，都要过对应的机械门禁。**一个开始误报的门禁等于没有门禁**：宁可漏报，不可误报。
7. 新写的注释与文档里不要用 emoji。文档里不要写会腐烂的计数，要写判据。
8. 文档里不要出现原始的双花括号 GitHub 表达式，围栏语言要标对（JSON 标成 `json` 或 `jsonc`，不标 `ts`）。
9. **遇到与本计划不符的事实，先停下并在汇报里说明，不要自行扩大范围。** 尤其是计划说「无引用」而实际有引用的情况。
10. 收尾时把该阶段的验证命令逐条跑一遍，汇报里贴**真实输出摘要**。没跑的、失败的、跳过的都要写明，不许把没验证说成通过。
11. **汇报里的事实要能被复核**：说某个目录或文件不存在之前先实际查一次；说某段失败是「环境原因」要给出证据（端口、报错原文）。

---

## 4. 阶段 1：tooling 迁移到仓库根

### 目标

六个工具链包从 `packages/` 下的 tooling 组搬到仓库根的 `tooling/`，与 `apps/`、`packages/` 同级。包名、版本、turbo tags、fixed 组成员全部不变，因此**没有任何 import 需要改**（跨包的 tsconfig extends 与 import 全部走包名，已核实）。

### 改动清单

1. **搬目录**：`git mv packages/tooling tooling`。
2. **`pnpm-workspace.yaml`**：
   - `packages` 里的 `'packages/tooling/*'` 改为 `'tooling/*'`，照 `packages/generated/*` 那条的写法补一段注释说明判据。
   - versioning 段上方注释里那句「发版编排见 …」的路径早已过时，改成 `tooling/release/src/release/`。
3. **`pnpm install`**：重建 lockfile 的 importers 与全部 workspace 链接。Windows 上这些链接是绝对路径的 junction，搬完必然失效，根目录的 `walnut-*` bin 也会断。若 bin 没有重新链接，按架构地图的记载改用 `pnpm install --force`。
4. **包目录形态收敛为单一真源**：
   - `tooling/scripts/src/lib/workspace.ts`：把形态正则改为三种并导出 `isWorkspacePackageDir(dir: string): boolean`，覆盖 `apps/<x>`、`tooling/<x>`、`packages/<组>/<x>`，根目录不算包。`workspacePackages()` 改用它。注释里写明它与 `pnpm-workspace.yaml` 的 `packages` 字段逐条对应。
   - `tooling/release/src/release/attribution.ts`：删掉自己的 `WORKSPACE_DIR_SHAPE`，改 import 上面的函数。该包已经依赖 `@walnut/scripts`，它的 `exports` 里有 `./lib/*`。
   - 新增 `tooling/scripts/src/lib/__tests__/workspace.test.ts`：读 `pnpm-workspace.yaml` 的 `packages` glob，把每个 `*` 代成占位段后必须被谓词认下；`.`、`packages`、`packages/platform-any`、`tooling`、`apps`、`apps/server/apps/api` 必须被拒。以后再调目录组而忘了改正则，这条测试直接红。
5. **固定层数改锚点**：五处把「固定六层向上」换成从 `lib/repo-root.ts` 导入的 `REPO_ROOT`。
   - `tooling/scripts/src/ci/__tests__/check-emoji.test.ts`
   - `tooling/scripts/src/ci/__tests__/check-seed.test.ts`
   - `tooling/scripts/src/db/__tests__/seed-reshape.test.ts`
   - `tooling/scripts/src/db/__tests__/seed.test.ts`（两处）

   退路：`check-turbo-cache.test.ts` 的头注释提醒过「vitest 转换管线下模块级 `REPO_ROOT` 与 Node 直跑不一致」。若实测以「找不到仓库根」响亮失败，就退回只把六层改成五层，并在汇报里说明。
6. **`turbo.json`**：`globalDependencies` 里两行 tooling 路径改掉；`tooling/scripts/src/ci/__tests__/check-turbo-cache.test.ts` 的断言同步。
7. **文档门禁**：`tooling/scripts/src/ci/check-doc-refs.ts` 的 `TOP_LEVEL_DIRS` 加 `'tooling'`（否则新路径无人校验）；`ALLOWED_MISSING_PATHS` 里 `scripts/` 那条的理由文字同步；`check-doc-refs.test.ts` 补一条用 `tooling/` 路径的用例。
8. **行为相关的路径字面量——要改的**：
   - `tooling/scripts/src/ci/check-seed.ts` 的 `SEED_INPUT_PATTERNS`，与 `check-seed.test.ts` 的用例同步（含「无关路径不命中」那组的负例）。
   - `tooling/scripts/src/db/seed-verify.ts` 读当前工作区的两处。
   - `apps/server/apps/api/src/common/repository/__tests__/eslint-data-scope-entities.drift.spec.ts` 的 `NEST_TS_PATH`。
   - `apps/server/apps/api/test/integration/helpers/seed-layer.ts` 里的 bin 路径。
   - `knip.config.ts` 全局 ignore 里 tsconfig 预设那一条，以及三处注释。
   - `.github/workflows/deploy.yml` 里打包 seed-tooling 的那行 `cp`。
9. **行为相关的路径字面量——不改的**：`tooling/scripts/src/db/seed-verify.ts` 里 `git archive` 基线树的那一行与它下面取基线 bin 路径的那一行。它们读的是历史基线提交那棵树，那里路径就是旧的。在这两处上方加注释：路径跟着 `DEFAULT_BASELINE_REF` 走；基线若挪到这次迁移之后，必须一并改。
10. **读真实文件的测试**：
    - `tooling/scripts/src/ci/__tests__/gate-wiring.test.ts`
    - `tooling/scripts/src/ci/__tests__/check-turbo-cache.test.ts`
    - `tooling/scripts/src/ci/__tests__/check-seed.test.ts`
    - `tooling/release/src/release/__tests__/attribution.test.ts` 里用真实包表的两行
    - release 的 `changelog.test.ts`、`intents.test.ts`：夹具字符串一并保持一致
11. **根 `package.json`**：
    - `clean:all` 补 `tooling/*/node_modules`。
    - `knip:packages` 改为带双引号的 `--workspace "./packages/*/*" --workspace "./tooling/*"`；`knip:apps` 的 glob 同样加双引号。双引号是 cmd 与 sh 都认的写法。
12. **提示文案与注释**：给用户看的路径在 `prepush.ts`、`local-ci.ts`、`check-doc-budgets.ts`、`check-pre-hooks.ts`、`steps.ts` 里；其余注释分布在 `lefthook.yml`、`cliff.toml`、`knip.config.ts`、`apps/admin/tsconfig.dts.json`、eslint-config 的 `comment-rules.ts`、`@walnut/scripts` 的若干 lib 头注释、server 两处业务代码注释。另含两条早已过期的裸路径：`.github/workflows/ci.yml` 里的 `src/ci/__tests__/…`、`lefthook.yml` 里的 `ci/__tests__/…`。
13. **文档**：所有活文档里的旧路径，**逐处判断，不盲替换**。
    - 不改：对比页里参照仓 Z 的路径；ADR 正文（路径检查本就对 ADR 豁免）；冻结语料；各处作为 commit scope 的 tooling 字样；`CONTEXT.md` 与 eslint-config `base.ts` 里只是叙事的句子。
    - 要改的额外几处：
      - 两条从 `packages/platform-any` 指向 tooling 的相对链接（在 `packages/platform-any/types/README.md` 与 `packages/platform-any/utils-core/README.md`），迁移后要多退一层。
      - 根 `README.md` 的目录树与 `prepush` 那行注释。
      - `architecture-todo.md` 里四处「现在在哪」的指针。它被门禁豁免，但它是活文档。
      - `architecture.md` 的结构树、外层 glob 那句、逐包入口的 GitHub 链接。
      - ADR 0020 里一条迁移后会 404 的 GitHub 链接：只改 URL，不动论述。
    - 顺带把两处早已失真的计数改成判据写法：scripts 包 README 的 bin 数、`.changeset/README.md` 的包数。
14. **ADR 0028「tooling 提升为顶层目录组」**：
    - 形状照 `apps/docs/src/zh-CN/content/adr/index.md` 的约定：标题、日期、状态、Context、Decision、Alternatives considered（恰好一节，带列表项）、Consequences、Related。
    - 把 1.2 的调研依据与否决项写进去。否决项至少包括：保持原位、改名 `tools` 或 `internal`、把根级工具配置一并挪进 tooling。
    - 登记进索引表（索引里两处 ADR 总数同步）与 `.vitepress/config/zh.ts` 的侧边栏。
    - [ADR 0017](../adr/0017-package-reorganization.md) 加一条带日期的更新注记，指向 0028。沿用该文件已有的先例。
15. 本计划文件若因上述改动出现失效路径，一并修正。

### 必须同步的测试与门禁

- 测试：新增的 `workspace.test.ts`；第 10 条列出的全部测试；`prepush.test.ts` 与 release 的 `steps.test.ts` 不受影响但都要跑。
- 门禁：`lint:docs-refs`（白名单与新路径）、`lint:turbo-cache`（globalDependencies）、`lint:exports`、`lint:pre-hooks`、`lint:workflows`、`lint:workflows-shell`。

### 验证

```bash
pnpm install
pnpm types:check
pnpm types:check:root
pnpm lint
pnpm lint:root
pnpm test
pnpm boundaries
pnpm lint:turbo-cache
pnpm lint:docs-refs
pnpm lint:adr
pnpm lint:doc-ts
pnpm lint:doc-budget
pnpm lint:exports
pnpm lint:pre-hooks
pnpm lint:lockfile
pnpm lint:seed
pnpm lint:workflows
pnpm lint:workflows-shell
pnpm hooks:check
pnpm change check
pnpm build:docs
pnpm prepush
git grep -n "packages/tooling"
```

**不跑** `pnpm db:seed:verify`：它会在本机 PG 上 DROP 并重建两个库，仓里也没有自动门禁跑它。那一处靠类型检查与逐行阅读保证。

### 完成判据

- `git status` 里六个包显示为重命名，没有内容丢失。
- `pnpm-lock.yaml` 的 diff 只有 importer 路径改名。
- 最后那条 `git grep` 的剩余命中**只有**：ADR、冻结语料、参照仓那一条、`seed-verify.ts` 两处基线路径、`.changeset/ledger.yaml`。
- 验证命令全部跑过，结果如实汇报。

### 结果记录（2026-11-23）

- 整表门禁 26 段全部通过（其中 `OpenAPI 一致性` 一段需要本机 PG 与 Redis 在线，第一次复验时它们没在运行，启动后重跑通过）；`build:docs` 通过；lint、类型检查、测试由实施 agent 真跑过，编排者复跑时命中 turbo 缓存。
- 与计划的三处出入，都已核实不影响结果：
  - 整组 `git mv` 被 Windows 文件占用挡住，改为逐包 `git mv`。git 仍把全部文件识别为重命名，没有删除。
  - lockfile 除 importer 路径改名外，另有 5 行与路径无关：两个传递依赖的补丁版本（`ansis`、`picomatch`）与一行弃用元数据。这是 pnpm 重新解析 importer 时，在 lockfile 里已有的版本中选了更新的那个。`pnpm install --frozen-lockfile` 通过。**仓库所有者已决定保留**；手改 lockfile 压回去的风险更大。
  - `cliff.toml` 首行注释本来就是过时的（它指向的 changelog 写入者早已搬进 release 包），实施时被机械替换、只换了前缀。复核时已纠正。
- 复核纠正了实施汇报里的一处不实：它称本机的 server env 目录不存在，实际存在；那段门禁当时失败的真实原因是数据库没在运行。

---

## 5. 阶段 2：死代码清理

### 目标

删掉已逐项核实、全仓无引用的东西。

### 改动清单

1. `git rm .dockerignore`。根目录早已不是任何构建上下文：bake 的三个 context 要么是 `deploy/nginx`（自带 `.dockerignore`），要么是 build image 的 staging 目录。`.vscode/settings.json` 里对 `.dockerignore` 的提及只是通用的文件嵌套规则，不是引用。
2. 移除 server 的两个未用开发依赖 `concurrently`、`nodemon`：
   - `apps/server/package.json` 的 devDependencies。
   - `pnpm-workspace.yaml` 的 catalog（全仓没有第二个消费者）。
   - `knip.config.ts` 的 `ignoreDependencies`。
3. `pnpm install` 更新 lockfile。

admin 侧的构建残留并入阶段 6，因为那里本来就要动同一个目录。

### 验证

```bash
pnpm install
pnpm lint:lockfile
pnpm lint
pnpm types:check
pnpm test
git grep -n -E "concurrently|nodemon" -- . ":!pnpm-lock.yaml" ":!*.md"
```

### 完成判据

- lockfile 的 diff 里消失的只有这两个包，以及**仅它们可达**的传递依赖；不得出现版本替换或新增包。
- 最后那条 `git grep` 的剩余命中只有 `.vscode/settings.json` 的文件嵌套规则。
- **不删 `BuildUtilsReadFile`**：子代理曾报它无调用，实际有调用方。

### 结果记录（2026-11-23）

- 整表门禁 26 段全部通过；`pnpm install --frozen-lockfile` 通过。
- lockfile 的变化：两个包本身，加 8 个仅它们可达的传递依赖被剪掉，加 4 行把失去非可选消费者的包标成可选。全部可归因，没有版本替换或新增包。
- 实施前的背景事实有两处不够精确，被实施 agent 当场指出并核实后继续：`docker-bake.hcl` 里还有一条注释提到 `.dockerignore`，但指的是 `deploy/nginx` 自己的文件；`.vscode/settings.json` 的文件嵌套规则里有 `nodemon` 字样。两处都不构成引用，删除结论不变。
- 原「完成判据」写的是「只有这两个包消失」，过死，已按实际改写。
- 注意 `pnpm lint:lockfile` 按设计只比较 HEAD 里那一对 catalog 与 lockfile，**不校验工作区**；工作区的锁步要以 `pnpm install --frozen-lockfile` 为准。
- 首次 `pnpm lint` 时 admin 包的 eslint 进程以访问冲突退出（Windows 0xC0000005），单独跑与重跑都通过。判断是并行进程的资源竞争，未改配置。

---

## 6. 阶段 3：根脚本收束——命令表加统一入口

### 已拍板（仓库所有者，2026-11-23）

- 入口叫 `walnut`。
- 根 `package.json` 的 scripts 保留十条：`dev`、`build`、`lint`、`lint:fix`、`types:check`、`test`、`prepush`、`setup-env`、`release`、`walnut`。
- **实施时的修正（2026-11-23）**：实际保留**十一条**，多出的那条是 `lint:root`。turbo 的根任务 `//#lint:root` 要跑的就是根 `package.json` 里的同名脚本；删掉之后 `turbo run lint:root` 会静默跑 0 个任务并退出码 0，prepush 门禁表与发版电池里的 `lint-root` 段就变成空转。所以它留在根，命令表里写成 `run lint:root`，并由一条回归守卫钉住「根脚本在、turbo 根任务的 command 不是 `<NONEXISTENT>`」。保留的判据因此是两类：外部按名字调用的契约，以及被 turbo 根任务按名字引用的脚本。
- CI 里每条门禁仍是一步，改调 `pnpm walnut <id>`。
- 多选界面用 `@clack/prompts`。

### 目标

- 根 `package.json` 的 scripts 缩到上面那几条（十条加实施时补上的 `lint:root`），只留外部会按名字调用的入口、被 turbo 根任务按名字引用的脚本，以及人和 agent 都默认存在的命令。
- 其余仓库级命令住进**一张命令表**：每项有稳定 id、分组、一句话说明、凭什么存在、怎么执行。
- 一个统一入口：
  - **人在终端里、不带参数**：出现列表，上下键移动、空格勾选、回车执行选中的项。
  - **带参数**：直接执行指定的项，全程不提问。

### 设计依据（已查实）

- **外部按名字调用的根脚本只有三个**：`prepush`（lefthook 的 pre-push）、`setup-env`（`.github/actions/decrypt-env/action.yml`）、`build`（`apps/docs/netlify.toml` 写的是 `pnpm run build --filter …`）。其余调用全在仓库内部：`ci.yml` 里二十余步、`release.yml` 里数步、`workflow-lint.yml` 里一步。
- **pnpm 原样转发脚本之后的全部参数**，所以入口要自己认真解析，见 1.2。
- **`@walnut/scripts` 里可复用的件**：
  - `tooling/scripts/src/lib/prompt.ts`：一问一答与不回显输入。它有一条硬契约——非终端一律立即返回空串，绝不等待。
  - `tooling/scripts/src/lib/child-run.ts`：带预算与超时的子进程执行。
  - `tooling/scripts/src/ci/prepush.ts` 的 `runGates`、`formatLine`、`summarizeRun`。
  - `tooling/scripts/src/ci/local-ci.ts` 的 `selectSteps`：按表顺序挑选，未知 id 报错并列出真实 id。
  - 仓里**没有任何**方向键菜单的代码。
- **三张表**（prepush 门禁表、本地 CI 步骤表、发版电池）里的命令名是稳定的，且各自带不同的理由字段与预算。它们**保留原样**，不改成从命令表派生。

### 设计

**命令表**：放在 scripts 包的 lib 层（新建 commands 模块；放 lib 层是为了让 release 包也能 import）。

- 每项至少包含：id、分组、label、why、run、可选的预算。
- id **沿用现在的脚本名**，例如 `lint:adr`、`db:seed:pg`、`build:docs`。这样文档里早已在用的名字一个都不用换。
- run 两种：经 pnpm 执行的 argv；自定义执行函数。
- 原来委托给 bin 的，argv 写成 `exec` 加 bin 名，例如 `exec walnut-check-adr`。
- `ci:local` 作为自定义项：参数透传给 `local-ci` 的 main。
- `clean:all` 也是自定义项：在入口进程里直接删，不经 rimraf。rimraf 在 Windows 上既不展开通配符，又会删掉自己所在的目录。删除面是确定的规则：`apps/*`、`packages/<组>/*`、`tooling/*` 下的 `node_modules`，外加镜像 staging 与仓库根，根排在最后；删不掉的逐个报出并以非零收场。
- **翻译一条带通配符的命令前，先查工具是否真的展开通配符**：argv 不经 shell，通配符是字面量交给工具的。eslint 与 knip 会展开，rimraf 默认不会。

**按名解析**：在命令表模块导出一个纯函数，把「首词是命令表 id」的 argv 解析成真正要跑的 argv；首词是 pnpm 子命令（`exec`、`change`）或保留的根脚本名的，原样返回。三处执行器各加一行解析：

- `tooling/scripts/src/ci/prepush.ts` 的 `createPnpmGateExecutor`。
- `tooling/scripts/src/ci/local-ci.ts` 的 `runPnpmStep`。
- `tooling/release/src/release/release.ts` 的 `runPnpmStep`。

这样三张表的 argv 字面量一个都不用改，逐字钉着它们的测试也不用改。

**入口**：根脚本 `"walnut": "node tooling/scripts/bin/run.ts"`，由 node 直接启动入口脚本，**不登记为 bin**。理由：一个可能删掉 `node_modules` 的入口，自己不能靠 `node_modules` 里的垫片启动——Windows 上 cmd 是逐行读批处理垫片的，入口删完目录退出之后垫片已经不在，命令会以退出码 1 收场。顺带的收益：刚克隆、还没安装依赖时 `pnpm walnut --list` 就能用。这要求入口的运行期依赖只有 `node:*` 内置模块（界面库惰性加载）。命令行契约：

- `pnpm walnut`：终端里进多选；不是终端则打印用法与清单，以「前置条件未满足」退出。
- `pnpm walnut <id> [<id>…]`：按**表里的顺序**顺序执行，不看命令行给的顺序。
- `--` 之后的参数透传给命令，且只允许选中一个 id。
- `--list`：每行一条「id、分组、说明」，纯文本，顺序稳定。
- `--json`：整张表的机器可读形态。
- `--dry-run`：只打印将要执行的命令。
- id 拼错直接报错并列出真实 id。
- 入口自身的旗标必须写在透传起点之前：一旦进入透传，后面的参数全部原样交给命令。所以是 `pnpm walnut --dry-run build:docs --cache-dir=…`，反过来写不会触发 dry-run。
- 收尾复用 `formatLine` 与 `summarizeRun`。有失败时按 `ci:local` 同一套口径收场：普通失败抛 1，命令以前置条件未满足（子进程退出 2）或超时收场的抛 2。无失败但有跳过抛 3；跳过不等于通过。
- 常驻或交互式的命令（开发服务、预览、发版、可视化界面、交互式升级）预算写 0，即不设上限。否则它们会在默认预算处被收掉。

**多选**：`@clack/prompts` 的 `groupMultiselect`，按分组展示。取消（Ctrl+C）按「什么都没跑」正常退出。依赖走 catalog。

**根脚本瘦身**：`package.json` 的 scripts 删到只剩保留的那几条（见上方「已拍板」里的修正）。

**接线迁移**：

- `ci.yml`：以 `pnpm <脚本名>` 调用根脚本的步骤，改成 `pnpm walnut <id>`。`build:docs` 那步的 `--cache-dir=…` 留在原位——缓存污染守卫按它是否出现在 `--` 之前来判定。
- `release.yml`：`boundaries`、`syncpack:lint` 两步改调入口。`lint`、`types:check`、`test` 是保留的根脚本，不动。
- `workflow-lint.yml`：`lint:workflows-shell` 改调入口。
- 根脚本 `ci:local` 删除，由 `pnpm walnut ci:local` 取代。

**守卫要改的**：

- `tooling/scripts/src/ci/__tests__/gate-wiring.test.ts`（整篇以「根脚本」为枢纽）：
  - workflow 引用、门禁覆盖、电池首词三处，合法性改成「保留的根脚本、命令表 id、或 pnpm 子命令」；workflow 文本里的 `pnpm walnut <id>` 也算覆盖。
  - bin 对账的两条（每个 bin 被引用、没有孤儿 bin）把命令表的 argv 也算进引用面。
  - 根脚本形态门禁改成对「保留的根脚本 + 命令表 id」生效；「扫描面大于 30 条」的下限断言改到命令表上。
- `tooling/scripts/src/ci/__tests__/prepush.test.ts`、`tooling/scripts/src/ci/__tests__/local-ci.test.ts`：argv 首词的合法性同上；`madge:check` 那条改为从命令表取 argv。
- `tooling/scripts/src/ci/__tests__/lefthook-config.test.ts`：`prepush` 的断言不变；`hooks:check` 的断言改为「经命令表解析后是 `walnut-check-git-hooks`」。
- `tooling/scripts/src/ci/__tests__/ci-workflow.test.ts`：`pnpm smoke:dist` 改为入口形态。
- `tooling/scripts/src/ci/check-turbo-cache.ts`：`lint-root-inputs` 不变量改为从命令表取 `lint:root` 的 argv；`runsBuildProductTask` 学会认 `pnpm walnut <id>` 并解析到命令表。

**文档**：

- 根 `AGENTS.md` 的常用命令块缩成保留的那几条，加一句「其余命令用 `pnpm walnut` 或 `pnpm walnut --list` 查」。注意字数预算**有下限**，缩太多也会红。
- `README.md` 快速上手、`apps/docs/src/zh-CN/content/monorepo/package-scripts.md`（「根 scripts 只做委托」一节改写）、`apps/docs/src/zh-CN/content/monorepo/ci-cd.md`、架构地图里的五步接线清单（bin 登记改为命令表登记，CI 步骤写入口形态）、scripts 包 README 的接线点。

**ADR**：出一篇「命令表与统一入口」，编号取创建时的下一个空号。否决项至少写：让 CI 整体改调本地入口；CI 不经过入口直接调命令；把三张表并进命令表。

### 分三个子阶段派发

- **3.1 命令表与非交互入口**：命令表、按名解析、入口的 list / json / dry-run 与直接执行、对应测试、根脚本 `walnut`。此子阶段**不删任何现有根脚本**，两条路并存，可以安全落地。
- **3.2 交互多选**。
- **3.3 瘦身与接线迁移**：删根脚本、改 workflow、三处执行器加解析、改守卫、改文档、写 ADR。

### 验证

```bash
pnpm walnut --list
pnpm walnut --json
pnpm walnut --dry-run lint:adr
pnpm walnut lint:adr
pnpm walnut --dry-run build:docs --cache-dir=.turbo/cache-docs
pnpm walnut --dry-run scaffold:lib foo --layer=infra
pnpm walnut ci:local --only=actionlint
pnpm --filter @walnut/scripts test
pnpm --filter @walnut/release test
pnpm test
pnpm lint:turbo-cache
pnpm lint:workflows
pnpm lint:workflows-shell
pnpm lint:doc-budget
pnpm lint:docs-refs
pnpm lint:adr
pnpm build:docs
pnpm prepush
```

**逐条执行验证**（仓库所有者 2026-11-23 定的口径，取代原先「多选界面需人工确认」那条）：交互界面本身不要求人工确认；改为**通过入口带参数，把命令表里每一条命令单独跑一遍**，确认它们经入口执行没有问题。会改动本机环境的命令按下面的口径处理：

- **数据库类**：只跑不伤数据的——`migration:run`、`db:export:pg`（导出到 gitignore 的临时目录）、`db:seed:pg` 带 `--dry-run`、`db:seed:verify`（只在两个专用临时库上对拍）。跳过 `migration:revert` 与 `db:seed:reshape`，只核对 argv。
- **删文件或改写文件的**：`clean`、`lint:fix`、`lint:root:fix`、`syncpack:fix`、`clean:all` 真跑（`clean:all` 跑完重新安装）。跳过 `encrypt-env`。`knip:fix` **不跑**：本仓的 knip 是有意维持的红，自动修复会按「未使用」删掉留给模板使用者的代码。
- **常驻与交互式**：各给 30 秒预算起一下，看到就绪输出后由预算收掉。`preview` 先构建再验。
- **发版**：只跑只读的 `--help` 与 `--status`。
- **本机跑不了的如实标为未验证**。

### 完成判据

- `package.json` 的 scripts 恰好是保留的那几条（集合等于入口加保留集合，由测试机械核对）。
- `pnpm walnut --list` 能列出全部被移走的命令，且每一条都能直接执行。
- 三张表的 argv 字面量未改。
- 守卫测试全绿；workflow 的两道门禁全绿。
- `AGENTS.md` 仍在字数预算区间内。

### 子阶段结果记录

**3.1 命令表与非交互入口（2026-11-23，已完成）**

- 命令表收录全部现有根脚本（入口自身除外），分八组。九条将保留的根脚本在表里写成 `run <id>`，仍由根脚本执行；其余写成真正要跑的 argv。
- 入口逻辑分四层：参数解析、清单渲染、执行、拼装。纯逻辑与副作用分开，判定口径直接复用 `ci:local` 与 prepush 的函数。
- 实测：未知 id 与非终端无参数都以退出码 2 结束并给出清单；`--list`、`--json`、`--dry-run`、参数透传都符合契约；`pnpm walnut lint:root` 与 `pnpm lint:root` 结果一致；`pnpm walnut ci:local --only=…` 与根脚本行为一致。整表门禁 26 段通过。
- 复核时补了一处：实施汇报指出常驻命令没写预算、会在默认的 15 分钟处被收掉。属实，编排者已给开发服务、预览、发版、可视化界面、交互式升级补上「不设上限」，并把 admin 两个构建的预算对齐 `ci:local` 实测的 20 分钟。
- 新增 bin 之后普通 `pnpm install` 不会重新链接 bin，需要 `pnpm install --force`（lockfile 逐字节不变）。以后每个新增 bin 的阶段都适用。
- 复核时遇到一次冷缓存假红：turbo 缓存全部失效，lint 与类型检查冷跑数百秒并与测试段并行，测试段里三个扫真实仓库的用例在 5 秒超时处超时、一个按毫秒计的断言差了 0.3 秒。缓存热了之后重跑 26 段全过。属于既有测试对负载敏感，不是本阶段引入。

**3.2 交互多选（2026-11-23，已完成）**

- 引入 `@clack/prompts`（走 catalog）。纯逻辑（分组、四种结局）与界面库分开：界面库只在一个模块里惰性加载，`--list` 与带参数直接执行的路径一次都不会加载它。
- 非终端的判定发生在进界面之前；取消与空选都是「什么都没跑」、退出码 0；选中的命令按表里的顺序执行。
- 复验：scripts 包的测试全过；非终端无参数与未知 id 仍以退出码 2 结束且不等待；lockfile 与 frozen 安装一致。界面本身按仓库所有者的口径不要求人工确认。
- 实施时纠正了编排者的一处错误说法：界面库自带的 `cancel()` 并不会结束进程，它只打一行字。结论不变（仍然不用它），注释里写的是实测事实。

**逐条执行验证（2026-11-23，已完成）**

- 命令表里的命令经入口**逐条单独**跑过：58 条真跑并通过，8 条按约定不执行。
  - 不执行的 8 条：`migration:revert`、`db:seed:reshape`（会动本机开发库或覆盖已跟踪文件）；`encrypt-env`（改写密文文件）；`setup-env`（会覆盖本机的 env 文件，且它是保留在根的脚本，映射与改造前完全相同）；`knip:fix`（有意不跑）；`images:build`、`images:push`、`images:print`（本机没有 Docker，无法验证）。
  - `knip`、`knip:packages`、`knip:apps` 以退出码 1 结束是本仓有意维持的状态，日志里是正常的未使用项报告。
  - 常驻类各给 30 秒预算：`dev`、`dev:server`、`dev:docs`、`preview`、`inspect:node-modules` 都确实起来了，被预算收掉后没有残留进程。
  - 每条命令跑前跑后比对工作区指纹：三个自动修复与 `syncpack:fix` 都是零改动，符合「全仓 lint 本来就是绿的」。
- 验证查出四处问题，都不是入口造成的，但都已处理：
  1. **`db:seed:verify` 在 Git Bash 环境下第一步就失败**：脚本把带盘符的绝对路径交给了 tar，而 Git 自带的 GNU tar 把盘符当成远程主机名。这条命令在本机的这个环境下此前从未跑通过。改成在目标目录里用相对路径解包，两种 tar 都兼容。修后通过。
  2. **`db:seed:verify` 跑完遗留工作目录**：基线树留在 `apps/server/.tmp/` 下，`turbo boundaries` 会把这些旧代码当成 `@walnut/server` 的源码扫进去，架构边界门禁随即假红。改成跑完就收走（成功与失败都收）。上一条修好后这个问题才第一次暴露。
  3. **`clean:all` 从来没有工作过**，坏在三层：rimraf 默认不展开通配符；加上 `--glob` 后它会删掉自己所在的目录，命令干完活却以退出码 1 结束（仓库外的空包里同样复现）；改成入口进程内删除后，入口自己成功了，但根脚本当时是通过 `node_modules/.bin` 里的垫片启动入口的，垫片被删后 cmd 读不下去，最外层仍是退出码 1。最终改法：`clean:all` 在入口进程里删除（带测试），入口改为由 node 直接启动、不登记为 bin。修后退出码 0。
  4. **admin 的构建与 eslint 偶发原生崩溃**（退出码 `-1073741819`，即 Windows 的访问冲突）：`build:admin` 与 `build:stage` 第一次冷构建时在 rolldown 的 `transforming` 阶段崩溃，之后经入口与经原根脚本重跑全部成功，经入口的冷构建也成功。同一种退出码在入口之外的 eslint 进程里也出现过一次。**成因没有查明**，只能确认与入口无关。
- 方法上的一个更正：本机上用 `netstat` 判断端口是否在监听不可靠，`dev:docs` 实际起来了但探测没抓到。之后改用直接连端口的方式。
- 逐条验证的价值就在这里：上面四处里有三处是读代码发现不了的。

**3.3 瘦身与接线迁移（2026-11-23，已完成）**

- 根脚本从 68 条降到 11 条。多保留的一条是 `lint:root`，理由见上方「已拍板」里的修正——这是计划初稿的疏漏，由实施 agent 发现。
- 按名解析接进了三处执行器（prepush 门禁执行器、本地 CI 的步骤执行器、发版流程的同步与异步两处）。三张表的 argv 字面量一个没改。
- `ci:local` 从自定义项改成 argv 形态（`exec walnut-ci-local`），bin 文件改为转发 argv。命令表里的自定义项只剩 `clean:all`。
- 三个 workflow 共 25 步改成 `pnpm walnut <id>`，`build:docs` 那步的 `--cache-dir` 紧跟在 id 后面。没有遗留对已移走脚本的旧式调用。
- `check-turbo-cache` 学会了认入口形态：缓存污染守卫与 `lint-root-inputs` 不变量都改成经命令表解析。
- 以「根脚本」为枢纽的守卫测试整篇重写为以「可执行的名字」为枢纽（保留的根脚本、命令表 id、pnpm 子命令），bin 的引用面扩成「根脚本值加命令表 argv」。
- 27 个活文档里从仓库根调用根脚本的写法改成了入口形态；判断为包内脚本的没有改；ADR、归档与过程记录没有动。
- ADR 0029「命令表与统一入口」已登记。根 `AGENTS.md` 的常用命令块缩成保留的脚本加一行入口说明。
- 复验：整表门禁经入口通过，文档站构建通过，scripts 包与 release 包的测试全过。
- **复核时改掉了入口契约里的两处设计缺陷（2026-11-24）**，都是「看起来跑成功了，实际跑的不是你以为的那个」：
  1. 入口自己的旗标原先在命令后面也认。可是命令自己也有叫 `--dry-run` 的旗标（`db:seed:pg --dry-run`、`release --dry-run`、`scaffold:lib --dry-run` 都是文档里写着的用法），于是 `pnpm walnut db:seed:pg --dry-run` 被入口「只打印不执行」地吞掉。逐条验证里这一条显示「通过」，正是这个原因 —— 入口打印了计划就退出 0。现在入口的选项只认第一个命令 id 之前的，id 之后的旗标属于那条命令（与 git、pnpm 自己的惯例一致）。改完实跑：种子工具真的执行了自己的演练。
  2. 选中一条命令之后，任何非旗标的词原先都被当成它的参数。于是 `pnpm walnut lint:turbo-cache types:chekc`（第二个 id 拼错）只跑第一条、还显示通过。现在位置参数要命令在表里声明过才算（`positionalArgs`，目前只有 `scaffold:lib <name>`），没声明的按未知 id 报错；`--` 之后照旧什么都能传。

---

## 7. 阶段 4：post-verify 接成门禁

### 目标

`deploy/post-verify.test.sh` 覆盖了部署后验证脚本的各条失败分支，但现在只能手工跑，任何 workflow 与 prepush 都不执行它。把它接成自动门禁。

### 改动清单

1. **先在本机实跑** `bash deploy/post-verify.test.sh`，它在 Windows 的 Git Bash 下能否通过目前未知。把真实结果记进汇报。
2. 新增门禁模块与 bin（在 scripts 包的 ci 层与 bin 目录下）：
   - 先探测 bash。探测不到就抛 `SkippedError`（退出码 3，表示未验证），先例是同目录的 `check-workflow-shell.ts`。
   - 跑测试脚本，解析末尾的「通过 N，失败 M」作为结论行；非 0 退出抛 `ViolationError` 并带输出。
   - 若本机因环境原因跑不通，则 Windows 上一律报跳过，以 CI 的 ubuntu 为权威。
3. **接线**（阶段 3 之后的形态）：
   - 命令表登记一项，id 为 `lint:post-verify`，执行 `walnut-check-post-verify`。
   - prepush 门禁表加一项，id 为 `post-verify`，argv 为 `lint:post-verify`，`why` 写清「凭什么它在推送前必须跑」。`prepush.test.ts` 里那份逐字钉死的 id 清单同步。
   - `ci.yml` 的 quality job 加一步，调用 `pnpm walnut lint:post-verify`。
   - 发版电池加一行；release 的 `steps.test.ts` 的逐字 argv 清单与 `release.md` 的电池表同步。
4. 补测试：退出码到结论的映射是纯函数，按同目录测试的写法覆盖。
5. 文档：`apps/docs/src/zh-CN/content/monorepo/ci-cd.md` 与 `deploy/README.md` 里的检查表（这两张表没有测试守，手工同步）。

### 验证

```bash
bash deploy/post-verify.test.sh
pnpm walnut lint:post-verify
pnpm test
pnpm walnut lint:workflows
pnpm walnut lint:workflows-shell
pnpm prepush
```

### 完成判据

- 新门禁在本机实跑，结果如实记录（通过，或明确标注为跳过）。
- 三份接线测试全绿。

### 结果记录（2026-11-23 至 24，已完成）

- 行为测试在本机（Git Bash）真跑通过：15 个场景全过。门禁接进了命令表、prepush 门禁表、CI 的 quality job 与发版电池，三份接线测试全绿。
- 复核时改了两处设计，都是实测之后才看得出来的：
  1. **给它加了适用范围。** 这套测试在 Windows 上经门禁跑一次要一到三分钟（每个假进程的启动开销）。每次推送都为一个这次没改的部署脚本付这笔时间，是纯成本。现在本地先看改动面：相对上游没改 `post-verify.sh`、它的行为测试或入口 nginx 配置，就打一行「不适用」正常返回；改了、判不出改动面、或在 CI 上，照常真跑。这是「不适用」（这一段没有要验的东西），不是「跳过」（该验而没验，退出码 3）。判不出改动面时一律倒向真跑。
  2. **入口改成实时转播子命令的输出。** 原先成功时缓冲并丢弃，CI 日志里只剩一行「通过」，门禁自己打的证据（扫描面、通过数、工具版本）都看不到了。入口是顺序执行的，不存在输出交织的问题，没有理由缓冲。这是阶段 3.1 的设计缺陷，在本阶段暴露。
- 顺带修了一个反复干扰验证的问题：`@walnut/scripts` 的测试在 prepush 冷跑时会假红（一天四次）。原因是 lint 与类型检查冷跑几百秒并与测试段并行抢 CPU，连只读一个 tsconfig 的断言都会在 5 秒处超时。现在这个包的用例超时放宽到 60 秒，那条按毫秒计的预算断言把余量从 4.5 秒拉到 18.5 秒（子进程自身的耗时从 6 秒改成 20 秒，预算生效时的测试耗时不变）。
- **冷缓存假红的根因治理（2026-11-24，复核阶段 4 时追到底）**。放宽超时只是止痛，同一种假红又以另一种形态出现了一次：`@walnut/client` 的 6 个 vitest 工作进程 60 秒内一个都没启动完，`test` 段红。查实 vitest 等工作进程启动的 `START_TIMEOUT` 是写死的常量，不读配置，配置层面调不掉。根因是门禁表的并发上限只数「段」、数不到段里面的扇出：`lint` / `types` / `test` 三段都经 turbo 各展开 4 路包级任务，三段同时跑把 12 核抢满。做法是给门禁加**重道**（`PrepushGate.lane`）：同名的段互斥，其余段照常并行。实测（缓存目录指向空目录 = 全冷）：三段依次跑 169s / 36s / 96s，整表 301s，全表通过；互斥之前三段并行时单段各自要 230s / 90～200s / 150～210s，整表 264～450s，而且那几次全冷里有两次 `test` 段被抢红。全冷多花不到一分钟，换来结论可复现。用例按「argv 是 `exec turbo run <包级任务>` 就必须在重道里」这条判据机械核对，漏填会红。
- **入口级预算的两层上限**。三段互斥之后暴露出一个阶段 3.1 留下的设计隐患：入口对每条命令有缺省的 15 分钟上限，而 `prepush` 的段表、`ci:local` 的步骤表里每一步本来就各有 5～20 分钟的预算。顺序执行时合法耗时加起来会超过外层上限，被入口判成卡死。同理 `images:build` / `images:push`：`docker-bake.hcl` 头注释自己就写着构建「实测在 15m49s ~ 77m53s 之间抖动」，缺省上限连最快的那次都拦（逐条验证时本机没有 Docker，这一条没被实跑发现）。四条命令改成显式不设上限，用例钉住。

---

## 8. 阶段 5：文档站三件

### 目标

- 把文档站的取版本号脚本重写成 scripts 包里的 TS bin，改查本仓最新发版。
- 补写两个包的 README，修掉架构地图里两条死链。

### 改动清单

1. **GitHub 工具函数下沉**：把 release 包里 `github.ts` 的四个纯函数（`parseGithubRemote`、`maskToken`、`apiBase`、`webReleaseUrl`）移到 scripts 包的 lib 层（新建 github 模块），release 包改为从 `@walnut/scripts` 导入，对应测试随迁。这样两个包共用一份 remote 解析，不再各写一个正则。
2. **新增 bin**（名字含 docs-version）与逻辑模块：
   - 用 `gitRemoteUrl()` 取 origin，解析出仓库坐标。
   - 请求 releases/latest，取 tag 写入 `apps/docs/version.json`，格式与现状一致（两空格缩进、带 `v` 前缀）。
   - 支持 `GITHUB_API_URL` 覆盖与可选的 `GITHUB_TOKEN`。
   - 网络失败、返回非 200、remote 解析不出，都抛前置条件错误。
3. **入口**：命令表登记一项，id 为 `docs:version`。
4. 删除旧的 JS 脚本（`apps/docs/` 下原来的 `scripts/` 目录，连同空目录；该目录已随本阶段删除）。同步改 `apps/docs/AGENTS.md` 里描述它的那句话。注意该文件有字数预算，改后不得超限、也不得用不到一半。
5. 实跑一次刷新 `apps/docs/version.json`。它现在停在旧仓库时代的版本号。需要能访问 GitHub API，失败则如实报告并保留原值。
6. **补写 README**：给 tooling 下的 eslint-config 与 commitlint-config 两个包各写一份（目前都只有 CHANGELOG、没有 README）。内容取自各包的 `package.json` 描述、源码头注释与对应的 ADR。写清契约与扩展点，不写会腐烂的计数。写完 `architecture.md` 里两条死链即修复。
7. 补测试：remote 解析与 API 地址的测试随迁后保持有效；写文件的格式加一条用例。

### 验证

```bash
pnpm --filter @walnut/scripts test
pnpm --filter @walnut/release test
pnpm walnut docs:version
pnpm walnut lint:docs-refs
pnpm walnut lint:emoji
pnpm walnut lint:doc-budget
pnpm walnut build:docs
```

并查看 `apps/docs/version.json` 的 diff。

### 结果记录（2026-11-24，已完成）

- 三件都落地：`walnut-docs-version`（命令 `docs:version`）取代了旧的 JS 脚本；`version.json` 实跑刷新为 `v0.1.24`（来源：本仓的 GitHub 最新 Release；此前停在旧仓库时代的 `v1.10.0`），再跑一次幂等。`@walnut/eslint-config` 与 `@walnut/commitlint-config` 各补了一份 README，架构地图里那两条死链修复。
- 复验：scripts 包 744 个用例、release 包 201 个用例全过，两个包的 lint 与类型检查全绿，文档站构建通过（无死链）。
- 比计划多做的一件事：**把「从环境变量读 GitHub token」收拢成一处**（`lib/github.ts` 的 `tokenFromEnv`，`GITHUB_TOKEN` 优先、`GH_TOKEN` 回退）。起因是计划第 14 节记的那条不一致：根 `turbo.json` 的注释说 `GH_TOKEN` 是回退来源，代码却只读前者。现在发版编排与文档站的取版本命令共用这一个函数，注释与代码一致。
- 计划里一处事实是错的，实施时被纠正：`version.json` 原本就带结尾换行，用 `writeJson` 写出来与现状逐字节一致，不存在格式变化。
- 「重新导出四个函数」与 knip 冲突（knip 把 release 里没人消费的重新导出报成未使用导出）。改成只重新导出 release 真正消费的三个名字；`webReleaseUrl` 在 release 里本来就没有消费者，不再从那里导出。
- 新模块放在 scripts 包的 `src/docs/`：它认识 `apps/docs/version.json` 这个业务路径，既不是门禁也不是通用能力，按该包 README「一个职责一个目录」的约定单开一层。
- 留痕：`lint:emoji` 只扫被跟踪的文件，尚未 `git add` 的新文件不在它的扫描面内（推送前文件必然已提交，所以对推送流程没有缺口；本次新增文件另行手工核对过）。

---

## 9. 阶段 6：抽出 vite-config 包

### 目标

把 admin 的 **Vite 配置层**抽成 tooling 下的第七个包（包名取 walnut scope 加 vite-config），让 `apps/admin` 里只剩 app 代码与 app 专属脚本。

**范围与最初设想不同**：admin 的 build 目录里混着两类东西。插件封装、proxy、env 的 zod schema 是真正的 Vite 配置层，该进 tooling。而 codegen 读的是 admin 自己的 store 类型文件、写的是仓库根的编辑器 schema，只有 admin 用，搬进共享包只能硬造参数，也与 `packages/platform-any/contract` 把构建脚本留在包内的做法不一致。所以 **codegen 与类型检查日志脚本留在 admin**，build 目录缩小而不消失。

### 改动清单

**搬走**（源都在 `apps/admin/build/` 下，目标都在新包里）：

| 源 | 目标 | 备注 |
|----|------|------|
| `vite/plugin/` 下全部插件封装与 `custom/iconify/` | 新包的 plugins 目录 | 含被注释掉的两个封装，原样搬，不删 |
| `vite/proxy.ts` | 新包的 proxy 模块 | |
| `vite/config/` 下四个 zod schema 文件 | 新包的 env 目录 | |
| `utils/log.ts`、`utils/fs.ts` | 新包的 utils 目录 | 被插件用到；从包导出，供 admin 留下的脚本使用 |
| `types/vite-env.d.ts` 里的全局接口 `IViteEnv` | 新包的类型模块 | 改为显式导出 |
| `vite.config.ts` 里的 `useBuildEnv` 映射 | 新包的 env 目录 | schema 与映射放一起 |

**留在 admin**：`vite.config.ts`（变薄）、codegen 两个文件、`build/types.ts`、`build/utils/paths.ts`、`build/constant.ts`。

**去掉对新包外部的静态依赖**：

- 四处静态 import admin 的 `package.json`（日志横幅、banner、obfuscator、turbo-console）改为经 options 传入 `pkg`；日志前缀改成包自己的名字。
- admin 专属的自定义元素标签与组件目录约定，改为经 options 传入。
- 包内相对 import **一律带 `.ts` 扩展名**，与 scripts、release 两个包一致。

**新包登记**：

- `package.json`：`exports` 只暴露根与 utils 子路径；`vite` 作为 peerDependency；其余 vite 插件作为依赖从 admin 迁入。按各插件自己的 peer 归位，例如图片优化插件的 `sharp`。
- `@iconify/vue` 留在 admin：它是被拼进虚拟模块的 import，要从 app 解析。
- `turbo.json` 的 tags 与其它 tooling 包一致；tsconfig 走 Node 原生执行那一档预设。
- `pnpm-workspace.yaml` 的 `versioning.fixed` 加成员（否则 `pnpm change check` 与 `versioning-config.test.ts` 都会拦）。
- commitlint 的 scope 白名单加这一项。
- 写 README。
- 各处「工具链有几包」的文档同步。按约定写判据，不写数字。

**admin 侧**：

- `vite.config.ts` 变薄，只留 app 的构建策略。
- `types/vite-env.d.ts` 改为从新包导入类型。
- 留下的脚本从新包导入日志与读写工具。
- 清理 admin 的 `package.json`：迁走的依赖删除。

**删除已确认无引用的**：

- admin build 目录下的 `_generated/paths.ts`：无 import、无写入方，内容还是 monorepo 之前的绝对路径。
- `build/utils/paths.ts` 里的 `generatedPathsFilePath`。
- `BuildUtilsExec`、`BuildUtilsWarn`。
- 根 `.gitignore` 里三条只为此而设的 `build/_generated/*` 规则。
- **不删 `BuildUtilsReadFile`**：iconify 插件在用。

**只报告、不改**（属于行为，需单独决定）：

- 两个被注释掉的插件封装（csp、legacy），以及只有前者消费的 `VITE_DEV_CSP`。
- 插件表里 `env.build.sentry &&` 恒为真，`VITE_BUILD_SENTRY` 实际只控制 sourcemap。
- `build/types.ts` 里调用的是 `npm run`。

**同步写死旧位置的地方**：

- `tooling/scripts/src/ci/check-pre-hooks.ts` 不受影响：它的判据是 admin 的 codegen 目录，而 codegen 没动。
- 根 `turbo.json` 里提到 `apps/admin/build/constant.ts` 的注释：该文件留在 admin，不用改。
- 文档：`apps/admin/AGENTS.md` 里描述 build 目录的几条；`apps/docs/src/zh-CN/content/frontend/base/plugin.md` 的链接；`monorepo` 专题页里 env-management、knip、turbo-cache-boundary、package-scripts 的相关句子；根 `TODO.md` 一处；`apps/server/libs/config/src/modules/middleware.config.ts` 一处注释。

**ADR**：出一篇「admin 构建配置抽出为 tooling 包」，写清单消费者的取舍与否决项（留在 admin、整体搬走含 codegen）。

### 验证

```bash
pnpm install
pnpm --filter @walnut/admin types:check
pnpm --filter @walnut/admin lint
pnpm exec turbo run build --filter=@walnut/admin --force
pnpm --filter @walnut/admin build:stage
pnpm walnut smoke:dist
pnpm walnut lint:dist
pnpm walnut ci:local --skip=migration-run,worker-smoke
pnpm walnut lint:exports
pnpm walnut boundaries
pnpm walnut lint:pre-hooks
pnpm change check
pnpm walnut lint:docs-refs
pnpm test
pnpm prepush
```

另加一次 dev server 启动冒烟：起 dev，等到就绪，再停掉。

### 完成判据

- admin 的生产构建、stage 构建都成功，产物冒烟与去密体检跑过。
- dev server 能起来。
- `lint:exports`、`boundaries`、`change check` 全绿。

### 结果记录（2026-11-24，已完成）

- 分两段派发：先「建包与搬迁、行为不变」，编排者复验后再「登记、清理、文档、ADR」。36 个文件经 `git mv` 进了 `tooling/vite-config`（git 全部识别为重命名），admin 的 `build/` 目录只剩 codegen、类型检查日志脚本、常量与路径。
- 「行为不变」的证据：搬迁前后各做一次冷构建，产物都是 1738 个文件；把文件名里的哈希段剥掉后两份清单**逐名相等**；被跟踪的 `apps/admin/types/generated/components.d.ts` 与 HEAD 逐字节一致。dev server 启动冒烟通过（TCP 探测 3100 就绪、页面 200、进程树停干净）。
- **dev server 冒烟抓住了一个真回归**，生产构建是绿的、只有 dev 会炸：dev 模式下 iconify 的虚拟模块会生成对 `@iconify/json/json/<set>.json` 的 import，那是从 app 解析的。依赖只在包里时页面直接 500。同类还有 `unplugin-info` 与 `unplugin-turbo-console`（admin 的 `types/vite-refs.d.ts` 用三斜线指令引用它们的 client 类型），由 `lint:dts` 抓到。三者都同时留在 admin。
- 另一个只有对比产物才看得出的坑：`unplugin-vue-components` 的 `dtsTsx` 默认值是从 cwd 的包清单里猜的，插件依赖搬走后猜成 false，第一次构建把被跟踪的 `components.d.ts` 里 169 行 TSX 声明删掉了。现在显式写 `dtsTsx: true`。
- 包不 import 任何 app 文件：调用方的包信息与 app 专属约定（Vue 自定义元素、组件目录与 resolver、iconify 扫描范围）全部经 `createVitePlugins` 的 options 传入。日志前缀因此做成模块级配置，取舍写在 ADR 0030 里。
- 登记：`versioning.fixed` 加了新包；`vue` 同时写进 peer 与 devDependencies（同级包的惯例）；commit scope 按 commitlint 自己的口径走 `tooling`，不单列；根 `turbo.json` 不用登记（实测改一行包内源码，admin 的 build 哈希随之变化）。
- 清理（逐项全仓搜索确认无引用后才删）：`build/_generated/paths.ts`、`generatedPathsFilePath`、`BuildUtilsExec`、`BuildUtilsWarn`、根 `.gitignore` 三条 `build/_generated/*` 规则。
- 复验：vite-config 10 个用例、scripts 747 个、release 201 个全过；`change check`、`boundaries`、`lint:turbo-cache`、`lint:exports`、`lint:dts` 与全部文档门禁全绿。
- 按计划只报告、没有改的三条行为问题：被注释掉的两个插件封装与 `VITE_DEV_CSP`；插件表里 `env.build.sentry &&` 对对象恒为真；`build/types.ts` 跑的是 `npm run types:check`。

---

## 10. 阶段 7：drift spec 搬出产品源码

### 目标

server 的架构 drift spec 与它们的工具住在产品源码里（apps/api 的 src 目录下 common 里的 monorepo 目录）。其中 `module-graph.ts` 不是 spec，**确实被编进了生产产物**。把它们搬到测试目录。

### 改动清单

1. **目的地**：apps/api 的 test 目录下新建 architecture 目录，与现有的 api、integration、e2e 三个并列。沿用 server 唯一的测试根，不新造第二个。
2. **搬**：九个 spec 文件加 `module-graph.ts`，用 `git mv`。
3. **必做——防止静默不收集**：`apps/server/apps/api/vitest.config.ts` 的 `include` 加一条，覆盖新目录下的 `*.spec.ts`。不加的话这九个守卫会悄悄不再运行，且不报错。
4. **修相对 import**：
   - 四个 spec 里指向 `module-graph` 的相对 import 要从 `'../module-graph'` 改成 `'./module-graph'`：spec 原来在 `__tests__` 子目录里、比 `module-graph.ts` 深一层，搬进同一目录后变成同级。（计划初稿写的是「不用动、深度不变」，实施时被纠正。）
   - `verify-build-assets.spec.ts` 里六层向上的相对 import 改成四层。（计划初稿写的是「两层」，按目录算不对，实施时被纠正。）
   - 其余 spec 都用 `process.cwd()` 定位，不受自身深度影响。
5. **同步写死旧路径的地方**：
   - `tooling/scripts/src/scaffold/lib-registration.ts`：导出的 `DRIFT_SPEC` 常量，以及文件里另两处内嵌路径。`scaffold:lib` 会**读写**这个文件，改错就是 ENOENT。
   - `tooling/scripts/src/scaffold/scaffold-lib.ts` 里打印的提示。
   - `.github/workflows/ci.yml` 里一处注释。
   - 源码注释：`apps/server/AGENTS.md` 两处；`core.module.ts`、`tech-core.module.ts`、`worker.module.ts`、DeviceIdFormCheck 迁移文件、`verify-build-assets.ts`、guards 的一个 spec、几个 repo module 里提到 repo-global 的注释。
   - `apps/server/apps/worker/README.md` 三处。
   - 文档站：`architecture-todo.md` 三处；`content/backend/architecture.md` 一处；`content/reports/batches.md` 一处；计划与评审页里的若干处。
   - `packages/platform-any/contract/README.md` 若写的是全路径则一并改。
6. **文档**：
   - `architecture-todo.md` 的「测试目录约定」补一类：架构 drift spec 住 test 下的 architecture 目录，并写清判据（被测对象是整个 server 的结构，而不是某个模块）。
   - `apps/server/AGENTS.md` 的测试目录那句同步。
   - [ADR 0022](../adr/0022-backend-lib-layering-and-composition-roots.md) 加一条带日期的更新注记。
7. `module-graph.ts` 搬走后，`orphan-module` 与 `repo-global` 两个守卫的扫描面不受影响：前者只扫源码目录，后者按「路径含 test 或 `__tests__` 段」排除测试文件。动手时读一遍确认。

### 验证

```bash
pnpm -C apps/server exec vitest run --config ./apps/api/vitest.config.ts --reporter=verbose
pnpm -C apps/server lint
pnpm -C apps/server types:check
pnpm -C apps/server test
pnpm -C apps/server build
pnpm --filter @walnut/scripts test
pnpm walnut lint:docs-refs
```

- **搬迁前**先跑一次同样的 vitest 命令，记下「收集到的文件数」；**搬迁后**再跑，两个数必须相等。
- 另外显式只跑新目录，确认九个文件都被收集并通过。
- `build` 之后确认 `apps/server` 的构建产物里不再有 module-graph 的编译结果（搬迁前它在产物里，是磁盘上确认过的事实）。

### 完成判据

- 收集到的文件数搬迁前后相等；九个守卫都在跑。
- `dist` 里不再有 `module-graph.js`。
- server 的 lint、类型检查、测试全绿；scripts 包的测试（含 scaffold）全绿。

### 结果记录（2026-11-24，已完成）

- 9 个 spec 加 `module-graph.ts` 经 `git mv` 进了 `apps/server/apps/api/test/architecture/`。搬迁前后全量测试都是 111 个文件、953 个用例；新目录单跑 9 个文件、56 个用例全过（`include` 没覆盖的话会是 102 个文件、897 个用例——这正是「静默不收集」的形态）。`build` 之后产物里不再有 `module-graph.js`（搬迁前在 `dist/apps/api/src/common/monorepo/` 下）。
- **计划初稿有两处写错，实施时被纠正**：一是 `'../module-graph'` 并非「深度不变」——spec 原来在 `__tests__` 子目录里、比 `module-graph.ts` 深一层，搬进同一目录后要改成 `'./module-graph'`（第一次跑新目录时 4 个文件直接报找不到模块）；二是 `verify-build-assets.spec.ts` 的相对 import 是改成四层，不是两层。两处都已订正。
- vitest 的 `include` 加的是只点新目录的一条 glob，没有放宽成整个 `test/**`：`test/` 下另有 api / integration / e2e 三套各自的配置与后缀，默认套件不该把它们吞进来。
- 两个守卫的扫描面读代码确认过不受影响：`orphan-module` 只扫源码目录且跳过 spec，`module-graph.ts` 里一个 class 都没有；`repo-global` 按路径里的 `test` 段排除测试文件。
- 写死旧路径的地方全部同步（`scaffold:lib` 读写的 `DRIFT_SPEC`、脚手架打印的命令、源码注释、worker README、文档与 ADR）；全仓搜索旧路径零命中。ADR 0023 里对它的引用按本仓惯例处理：原文不动，加带日期的更新注记。
- 复验：server 111 个文件 953 个用例、scripts 747 个用例全过；lint、类型检查、全部文档门禁与文档站构建通过。

---

## 11. 阶段 8：CI 去重

### 目标

构建类步骤在 `ci.yml` 与 `local-ci.ts` 里各写了一份。真正有两套**逻辑**的只有 worker 冒烟：前者是 50 行内联 bash，后者是 TS 实现，两者的超时与指纹算法都不同。让 TS 版成为唯一实现；其余一行命令的镜像保留，但由测试钉住。

**不选「CI 整体改调本地入口」**：会丢步骤级条件、解密前置与 `--cache-dir`，还会让 `check-turbo-cache` 的缓存污染守卫看不见步骤内部。

### 改动清单

1. `.github/workflows/ci.yml` 的 openapi job：把内联 bash 的 worker 冒烟换成两步——先 `pnpm build`（`working-directory: apps/server`），再 `pnpm walnut ci:local --only=worker-smoke`。
2. 扩展 `tooling/scripts/src/ci/__tests__/ci-workflow.test.ts`：
   - 逐条断言 `ci.yml` 里对应步骤的命令与 `LOCAL_CI_STEPS` 的 argv 一致（阶段 3 之后 `ci.yml` 是入口形态，断言要按入口形态写）。
   - 两处**有意差异**写进断言：docs 构建的 `--cache-dir`，migration 的 `working-directory`。
   - 断言内联的 bash 版本不得回潮（例如断言文件里不再出现那条 cron 正则的 grep）。
3. `tooling/scripts/src/ci/local-ci.ts`：头注释里「CI 是权威、本表复刻」的表述按新关系改写；各步 `why` 里按**行号**引用 `ci.yml` 的地方改成引用步骤名。
4. 文档：`apps/docs/src/zh-CN/content/monorepo/ci-cd.md` 里对 worker 冒烟的描述。

### 验证

```bash
pnpm walnut lint:workflows
pnpm walnut lint:workflows-shell
pnpm test
pnpm walnut lint:turbo-cache
pnpm walnut ci:local --only=worker-smoke
```

最后一条需要本机有已迁移的库与构建好的 server。跑不了就如实标为未验证。

### 完成判据

- workflow 语法与 shell 语法门禁全绿；三份相关测试全绿。
- **真正的 CI 行为只能在下次推送后确认。** 汇报里必须写明这一点。

### 结果记录（2026-11-24，本地部分已完成）

- `ci.yml` 的 openapi job 里那段内联 bash 换成了两步：先在 `apps/server` 下 `pnpm build` 产出 dist，再 `pnpm walnut ci:local --only=worker-smoke`。TS 实现成为 worker 冒烟的唯一实现。
- 换之前核对过内联版本有**两条**判据（cron 计数不小于 1；worker 启停前后 CAP token 存储逐字节不变），TS 实现两条都有，还多了本机 `.data` 的备份恢复 —— 没有丢守卫。两边的差异只有轮询上限（内联版 40 秒，TS 版 180 秒、可用环境变量调）。
- `ci-workflow.test.ts` 从两条约束扩成一组：镜像步骤逐条核对「workflow 里执行的 argv = 步骤表那一步解析后的 argv」；两处有意差异明示（docs 构建多一个 `--cache-dir`，迁移在 `apps/server` 下直接跑包脚本）；worker 冒烟必须经入口调步骤表里自带 `run` 的那一步；构建与冒烟的条件必须一致、构建在前；内联 bash 版不许回潮。负对照做过：把 `--only=` 的参数改坏，对应用例当场红。
- 「不许回潮」那条的判据改过一次：起初断言「文件里不出现 `tokensList.json`」，结果误伤了自己写的注释（注释里提它是为了说明判据）。改成盯**实际起 worker、断言日志**的命令。
- `local-ci.ts` 里十几处按**行号**引用 `ci.yml` 的地方（改 workflow 之前就已经全部对不上）改成引用步骤名；头注释补了「与 CI 的关系」一节。
- 本地验证：经入口真跑 `pnpm walnut ci:local --only=worker-smoke` 通过（注册了 8 个 cron，CAP token 存储未被触碰，本机 `.data` 原样恢复）；actionlint、逐块 `bash -n`、turbo 缓存边界三道门禁与 scripts 包的 CI 用例全绿。
- **没有验证到的**：GitHub runner 上的真实行为。那里没有本机这样的 `.data`、ubuntu 上起 worker 与停 worker 的路径也只在 TS 实现里跑过本机这一种，要等下次推送看 openapi job 的这两步。

---

## 12. 贯穿全程的风险与验证盲区

| 项 | 结论 |
|----|------|
| Windows 文件占用 | 编辑器或 dev server 占着文件时整组 `git mv` 会失败（阶段 1 实测遇到）。退路是逐个包移动；阶段 6、7 逐个文件移动，全部成功。 |
| pnpm 台账 | 历史条目记着旧目录。已从二进制报错文案取证：不校验。台账一个字没动 |
| lockfile | 改依赖的阶段（1、2、3、5、6 与收尾时的 `rimraf` 归位）都已连同 `pnpm-lock.yaml` 更新；`pnpm install --frozen-lockfile` 通过 |
| post-verify 测试脚本 | 在 Windows 的 Git Bash 下实测通过（15 个场景全过），接成了门禁 |
| 刷新版本号 | 实测能访问 GitHub API，`version.json` 已刷新为 `v0.1.24` |
| 阶段 8 的 CI 行为 | **本地验证不了**。本地经入口真跑 worker 冒烟通过，GitHub runner 上的行为要等下次推送 |
| 本机数据库 | `ci:local` 的 migration 与 worker 冒烟、prepush 的 OpenAPI 一段，都需要本机 PG 与 Redis 在线（本次全程在线） |
| 本机与别的会话共享 | 这台机器同时跑着其它会话的其它仓库的重任务，各轮耗时测量的基线在漂 |

## 13. 未核实 / 存疑

- ~~Vite 8 加载 workspace 里的 TS 包时，是内联进配置包还是外置后由 Node 直接加载，没有实测。~~ 阶段 6 实测：外置后由 Node 原生加载（`exports` 指向 `./src/**` 的 `.ts`），tsconfig 走 `ts.json`。
- `scaffold:lib` 的测试在 PR 的 CI 上是否会因只改 server 而被 affected 图选中，没有核实。
- admin 的 eslint 与 vite 构建在本机会以访问冲突原生崩溃：与机器负载相关，成因没有查明（排查记录见第 14 节）。

## 14. 顺带发现：哪些处理了，哪些留给了仓库所有者

**已经处理的：**

- 根 `turbo.json` 的注释说 `GH_TOKEN` 是发版凭据的回退来源，代码只读 `GITHUB_TOKEN`。读取口径收拢到 `tooling/scripts/src/lib/github.ts` 的 `tokenFromEnv`，代码实现了注释所说的回退（阶段 5）。
- `prepush.ts` 的头注释说发版流程会剥掉 `LEFTHOOK*` 环境变量。核实后改正：实际剥的是两个凭据变量，发版时钩子照常跑是有意设计。
- `apps/admin/AGENTS.md` 说组件的 dts 已被 gitignore、由 pre 钩子生成。实际它被跟踪、由插件在真实 dev / build 期间写出。指引与 `build/utils/paths.ts` 的头注释都已改正。
- 多处文档提到并不存在的 `build/_generated/svg.json`：那段「具体流程」整体是插件化之前的旧实现。图标页的「老文档」一节加了说明，admin 的 `.svg/README.md` 里让人去跑一个不存在的脚本那条也改了。
- 根 `AGENTS.md` 写「admin/docs 用 vue-tsc」，而 docs 的 `types:check` 是 `echo skipped`。说法已按事实改。
- 根 `.gitignore` 里两条已匹配不到任何文件的规则（husky 时代的 `config/husky/*`、不存在的 `apps/docs/nginx/*`）已删。
- ADR 0009 里写死的「五段」门禁与缺失的发版电池：加了一条带日期的修订，表里改成指向门禁表，并补上发版电池一行。
- 入口契约的两处设计缺陷（命令后面的 `--dry-run` 被入口吞掉；拼错的第二个 id 被吞成参数）：见阶段 3 的结果记录。
- 入口对编排型命令多套了一层全局上限（prepush / ci:local / images:*）：见阶段 4 的结果记录。
- `rimraf`：admin 的脚本用了它却没声明，靠的是根的那条。现在 admin 自己声明，根上那条删掉。
- `tooling/scripts/README.md` 的模块地图漏了统一入口与命令表：已补。
- **2026-11-24 收尾落实的五项**（原先列在下面「只报告、没有改」里）：
  - admin 的 `rollup` devDependency 删除。`unplugin-info` / `unplugin-turbo-console` 只把它声明为
    可选 peer，`pnpm install` 后 `pnpm peers check` 没有新增与 rollup 相关的条目。
  - `types:check:log` 脚本与实现文件（admin 的 `build/types.ts`）删除；只被它使用的
    `writeIntoLog` / `typesCheckLogPath`、`report/` 的 gitignore 规则与各处文档提及一并清掉。
  - Sentry 开关：插件表改读 `env.build.sentry.enabled`，`VITE_BUILD_SENTRY` 不再对对象恒为真。
  - 两个被注释掉的插件：CSP 与 legacy 接回插件表，改成 `VITE_BUILD_CSP` / `VITE_BUILD_LEGACY`
    可选键（不配即关），dev 侧由 `VITE_DEV_CSP` 单独控制。CSP 的 dev 与生产构建实测生效；
    legacy 打开后生产构建因顶层 `await` 与 plugin-legacy 的目标环境不兼容而失败，现象记在包 README。
  - taze 与 npm-check-updates 并存：server 的 `check:update` 改成 `taze -I`，npm-check-updates 依赖删除，
    taze 按 `catalog:` 声明（与根、docs 一致）。

**只报告、没有改的（要仓库所有者决定）：**

- server 的 `jsc.paths` 别名表手抄在三份 swcrc 与 tsconfig 里。
- knip 对 admin 的 `build/**` 是有意忽略的，于是只被这些脚本用到的依赖会被报成未使用（例如 `ts-json-schema-generator`）。knip 本身也是有意维持红、没有门禁看着它。
- `apps/docs/src/{zh-CN,en-US}/guide/` 是旧仓库时代整体搬来的文档树，里面几十处链接指向旧仓库（包括本仓没有的文件）。把那棵树迁移到本仓路径是一项单独的工作，**明确保留为后续事项**，不在这次收尾里做。
- prepush 的 `post-verify` 一段在这台 Windows 机器上真跑要一到三分钟，所以本地先看改动面：没改部署脚本相关文件就判「不适用」。

**仍然成立的注意事项：**

- `turbo boundaries` 会把 workspace 包目录下**被 gitignore 的临时目录**也扫进去。任何往包目录里写文件的工具都必须自己收尾，否则留下的是一条假红的门禁。
- `lint:emoji` 只扫被跟踪的文件。推送前文件必然已提交，所以对推送流程没有缺口；但刚新建、还没 `git add` 的文件不在它的扫描面内。
- 冷态复现的办法：把 `TURBO_CACHE_DIR` 指向一个空目录再跑，turbo 会把它当缓存目录，所有任务都是 cache miss。不用破坏现有缓存。

**admin 的原生崩溃，排查记录：**

- 现象：admin 的 eslint 与 vite 构建会以访问冲突（`0xC0000005`）退出，重跑即过。逐条验证时冷构建 5 次里遇到 2 次，阶段 2 的实施 agent 在入口之外遇到 1 次，冷跑 prepush 与实施阶段 6 时又各遇到过。
- **「提交内存耗尽」这个假设已被测量排除。** 起因是量到本机空闲时提交用量已有 45GB（上限 68GB，页面文件只有 4GB），而单跑 `lint` 一段峰值就要 11～15GB，看起来很像。但按崩溃那一轮的并行组合受控复现没有崩，峰值 58.3GB，离上限还差 9.6GB；后来更是在水位只高出基线 4GB 的一次运行里当场复现了崩溃；崩溃时间窗口内系统日志里没有任何资源耗尽或页面文件扩张的事件。
- **已缩小到的范围：与机器负载相关，与这些因素无关。** 不经 turbo、在 admin 目录里原样跑包脚本的 lint：机器安静时连跑十次零复现，别的重任务并行时约三次里有一次。逐项排除：worker 线程并发（关掉 eslint 并发照崩）、堆上限配置（8GB 确实生效）、turbo 包装（不经 turbo 照崩）。
- 崩溃是静默的：没有任何 stderr 输出，Windows 应用日志里也没有 node 的记录。网上只有「Node 24 + worker_threads 在 Windows 上偶发 3221225477」这类零散报告，没有定论性的 issue。
- 顺带量到的各段内存峰值（高于基线）：`lint` 11～15GB（admin 的 eslint 开 4 个 worker、各带一份完整 TS 程序），`test` 4.1GB，`openapi` 2.9GB，`dts` 2.7GB，`types` 2.4GB。内存紧的机器上第一个出问题的是 `lint`。
- 仓库侧能做的只有一件事，已做：prepush 回放失败输出时认得这个退出码（`nativeCrashNote`），在明细后面加一行提示。它**不改判决**，正反两面的样本都有用例。
- 再遇到时的下一步：用 WER 的 LocalDumps 抓一份 node 的崩溃转储看出错模块。这要改注册表（本机没有调试器），留给仓库所有者决定。

## 15. 最终验证（2026-11-24）

全部改动就位之后，在不再改工作区的前提下整体验了一遍：

- **冷缓存的全表 prepush：27 段全部真跑通过，没有跳过**（把 `TURBO_CACHE_DIR` 指向空目录造冷态，总 399 秒；慢于先前几轮是因为机器此刻负载更高）。
- **全量本地 CI（`pnpm walnut ci:local`）：8 步全部真跑通过**（总 336 秒）：server 构建、admin 强制重建、真实浏览器打开产物的冒烟、产物去密体检、文档站构建（含死链校验）、对本地库跑迁移、worker 冒烟、actionlint。**第一次在 admin 构建上撞到那个已知的原生崩溃而失败，原样重跑通过** —— 就是第 14 节记的那个现象。
- 各包测试：scripts 747 个用例、release 201 个、server 953 个、vite-config 10 个，全过；全部文档门禁通过。
- 经入口抽样的命令：`docs:version`（幂等）、`db:seed:pg --dry-run`（种子工具自己的演练，此前被入口吞掉）、`ci:local --only=worker-smoke`、`--list` / `--json` / `--dry-run` / 非交互无参数。
- **没有验证到的**：GitHub runner 上的真实行为（阶段 8 改动的两步、以及整套 workflow 在 CI 上的运行），要等下次推送。

### 2026-11-24 收尾（本轮）

上面这条验证之后，又落实了五项决定：admin 的 `rollup` 依赖删除；`types:check:log` 及其死代码
（admin 的 `build/types.ts` / `writeIntoLog` / `typesCheckLogPath` / `report/` 忽略规则）删除；
Sentry 开关改读 `enabled`；CSP 与 legacy 接回插件表并改成默认关闭的环境变量开关；server 的依赖检查
从 npm-check-updates 统一到 taze。验证由本轮的实施 agent 执行：`@walnut/vite-config` 的
lint / types:check / test，admin 与 server 的 lint，`syncpack:lint`、文档四道门禁、`knip`（只看不修）、
`pnpm install --frozen-lockfile`，以及冷缓存的全量 prepush。实测细节（CSP 在 dev / 构建下的表现、
legacy 构建失败、admin 原生崩溃的原样重跑）写在当轮汇报里，没有回填到这份计划。旧文档树 `guide/`
仍按上一节的口径保留为后续事项。

### 2026-11-24 推送门禁：drift spec 的超时

推送这批提交时，pre-push 的 test 段连续两次被架构 drift spec 的 5 秒缺省超时打断
（`core-module-scope.drift.spec.ts` 一次、`murlock-isolation.drift.spec.ts` 一次）：两次都只红这一条、
其余 952 条全过，单独复跑都在 2 秒内通过。原因是这类 spec 要全仓扫描几千个文件，本机同时跑着别的
会话的重任务时会被 CPU 争抢推过 5 秒。处置：沿用 `tooling/scripts/vitest.config.ts` 的同一先例，把
`apps/server/apps/api/vitest.config.ts` 的 `testTimeout` 放宽到 60 秒（超时只决定「卡死的用例多久被判死」，
真卡住的用例 60 秒后照样红）。验证由实施 agent 执行：server 全量测试（111 文件 / 953 用例）、
scripts 全量测试（753 用例，确认先例包不受影响）、以及 `lint:doc-budget` / `lint:doc-ts` / `lint:docs-refs`
三道文档门禁，全过。

## 相关文档

- [架构地图](../monorepo/architecture.md) —— 「我要加 X，该放哪」
- [ADR 索引](../adr/index.md) —— 形态约定与全部决策
- [文档规范](../monorepo/doc-conventions.md) —— 写完必须过的门禁
- [Package Scripts](../monorepo/package-scripts.md) —— 根脚本的现状
- [CI 与部署](../monorepo/ci-cd.md) —— 门禁在 CI 里的接线
