# 批次 2（门禁可信化）· R1 复核轮实测报告

> 任务：task-6 · 执行者 pkg-boundary · 只读复核，唯一写入本文件。
> 复核对象：D18①（frontend tag 规则缺失）、D18②（knip barrel 当 entry）、D19（madge 不在门禁）、D14（加 lib 的注册面）。
> 所有结论都来自**本轮实测**，命令与输出见正文；未改任何源码（探针已逐个还原）。

---

## 0. 环境与三条前置事实（先纠正，再看结论）

| 项 | 任务书 | 实测 | 影响 |
|----|--------|------|------|
| HEAD | `bb2ee648` | **`c8bea21a`** | 结论按 c8bea21a 的工作树成立；与该 commit 的差异需 Lead 确认 |
| 工作树 | clean | 起步 clean；**会话期间有并发同伴在改 `apps/**`**（`apps/admin/src/App/src/bootstrap.ts`、`apps/server/libs/{cache,rsa}/*.ts`、新增 `cache.rsa.spec.ts`，以及 `reports/review-*` 目录） | 我的探针全部用 `git checkout -- <path>` 还原；下文每张表都记录了「还原后 status」 |
| 包数 | — | **15 个 workspace 包**（`pnpm boundaries` 自报 `Checked ... in 15 packages`） | @walnut/ui 已被删除，与更新后的 AGENTS.md 一致 |
| 文件数 | — | boundaries 自报 4645 / 4646 / 4647 三个值 | 随同伴增删文件浮动，属正常 |

**命令通道**：本轮全部用 `cmd /c "..."`。另外发现：直接跑 `pnpm <script>` 时，pnpm 会在**检测到依赖图与 node_modules 不一致时自动 install 并改写 `pnpm-lock.yaml`**（我第一次跑 `pnpm boundaries` 就被改了，已 `git checkout` 还原）。**后续所有边界实验改用 `node_modules\.bin\turbo.cmd boundaries` 直调**，不再触发 install。这条值得写进 R2 的执行须知。

---

## 1. 负对照实测（3 组，全部实测并还原）

### 1.A 依赖方向：谁能被 `pnpm boundaries` 拦住

| # | 注入（探针） | 命令 | 实测输出 | 判定 |
|---|--------------|------|----------|------|
| A0 | 无（基线） | `turbo.cmd boundaries` | `Checked 4645 files in 15 packages, no issues found`，exit 0，**1.1s** | 基线绿 |
| A1 | `packages/platform-any/contract/package.json` 的 dependencies 加 `"@walnut/client": "workspace:*"`（platform-any → platform-web） | 同上 | **exit 1，5 issues**：4 条 `Package @walnut/client found with tag listed in denylist for @walnut/{utils,contract,server}` + 1 条 `Circular package dependency detected: @walnut/client -> @walnut/utils -> @walnut/contract -> @walnut/client` | ✅ **门禁有效**（既有规则确实会红，报错带文件:行号与 denylist 出处） |
| A2 | `apps/admin/package.json` 的 dependencies 加 `"@walnut/server": "workspace:*"`（frontend/platform-web → backend/platform-node） | 同上 | **exit 0，0 issues**（`Checked 4647 files ... no issues found`） | ❌ **D18① 缺口确认**：前端可以声明依赖一个 platform-node 包，boundaries 一声不响 |
| A3 | 保留 A2，并在根 `turbo.json` 加 `"frontend": { "dependencies": { "deny": ["platform-node"] } }` | 同上 | **exit 1，1 issue**：`Package @walnut/server found with tag listed in denylist for @walnut/admin: platform-node` | ✅ 新规则命中，消息精确 |
| A3' | 保留 A2，规则改成富列表 `["platform-node","backend","app"]` | 同上 | **exit 1，1 issue**，但报的是 **`app`**（deny 列表里第一个命中的 tag） | ⚠️ 能拦，但**信息量更差**：看到的是「app 被禁」，而不是「Node 包被禁」 |
| A3'' | **推荐变体**：不新增 tag 键，直接给已存在的 `platform-web` 加 `deny: ["platform-node"]` | 净树 + 注入各跑一次 | 净树：**exit 0**（4646 files, no issues）；注入后：**exit 1**，`found with tag listed in denylist for @walnut/admin: platform-node`；`walnut-check-turbo-cache` 同时绿（`91 个 task、15 个包，全部成立`） | ✅ **一个规则同时守住 admin + 3 个 web 包，且不需要新 tag 键** |

**还原**：A1 后 `git checkout -- packages/platform-any/contract/package.json` + `git checkout -- pnpm-lock.yaml`；A2/A3 后 `git checkout -- apps/admin/package.json turbo.json`。还原后 `git status` 只剩同伴的改动，boundaries 回到 0 issues。

### 1.B knip：barrel 里的 0 引用导出能不能被发现

探针（同时挂 3 个，互相独立）：

| 编号 | 探针 | 位置性质 |
|------|------|----------|
| B1 | `export const __R1_DEAD_BARREL` 追加到 `packages/platform-any/contract/src/index.ts` | **barrel 本身**（knip.config.ts 里 `entry: ['src/index.ts']`） |
| B2 | `export const __R1_DEAD_DEEP` 追加到 `packages/platform-any/contract/src/role.ts` | 非 entry 的深层文件（未被 barrel 引出） |
| B3 | 新建整个文件 `packages/platform-any/contract/src/r1-unused-probe.ts`（全仓 0 引用） | 整个文件死 |
| B4 | `export const __R1_DEAD_NESTED` 追加到 `packages/platform-web/client/src/browser/window/base64.ts` | 另一个包的嵌套文件 |

| # | 配置变化 | `pnpm knip` 汇总 | 探针是否出现 | 判定 |
|---|----------|------------------|--------------|------|
| B0 | 现状（`entry: ['src/index.ts']`，无 `project`） | Unused files **15** / Unused exports **50** / Unused exported types 24 / Duplicate exports 1 / Unused devDeps 1 / Unlisted 1 / hints 90，exit 1 | **B1/B2/B3/B4 全部不出现** | ❌ D18② 成立，但**比描述的更严重**：不只是「barrel 死导出看不见」，而是**`packages/**` 整个不产出任何发现** |
| B5 | 给 contract 加 `project: ['src/**/*.ts']`（保留 entry） | 15 / **50** | 仍全部不出现 | ❌ `project` 不是主因 |
| B6 | 删掉 contract 的 `entry`（让 knip 从 package.json `exports` 推） | 15 / **50** | 仍全部不出现 | ❌ `entry` 也不是主因 |
| B7 | `project` + **`includeEntryExports: true`** | 15 / **52** | **B2 与 B3 出现**（各计为 unused export），**B1（barrel）仍不出现**，B4 未单测 | ✅ 这是唯一能「看见非 entry 死导出」的开关 |

**关键事实（决定了处方怎么写）**：

1. 基线 50 条 unused export **全部落在 `apps/**`**（admin 12 条 / docs 1 条 / server 其余），**`packages/**` 一条都没有**——打印全表逐条核对过。
2. knip 自己给出的 **Configuration hints 里就有 8 条 `Remove redundant entry pattern`**（contract / utils-core / types ×4 / client / http / docs），意思是：**入口本来就能从 `package.json exports` 推出来，显式 `entry` 是冗余的**。
   所以「把 barrel 从 knip 的 entry 摘出去」**不是一个可执行的动作**——摘了它也会从 `exports` 推回来（B6 实测：摘掉后仍 0 发现）。
3. `includeEntryExports: true` 能让**非 entry 文件**的死导出现身（B2/B3：50 → 52），但**barrel 级死导出（B1）依然查不出**——因为 `src/index.ts` 就是包入口，它的导出天然是「公共 API」。

**还原**：4 个探针文件全部 `git checkout`（B3 是新增文件，用 `Remove-Item` 删除）→ 重跑 knip 回到 **15 / 50 / 24**，boundaries 回到 0 issues。

### 1.C lib 向上层 import 能不能被发现

| # | 注入 | 命令 | 实测输出 | 判定 |
|---|------|------|----------|------|
| C0 | — | `pnpm boundaries` | 0 issues | 基线（这类越界本来就不在 boundaries 的视野里：都在同一个 app 内） |
| C1 | `apps/server/libs/utils/src/general.ts`（**基建层**）加 `import { SysSystemModule } from '@walnut-server/system'`（**领域层**） | 单文件跑 `node_modules\.bin\eslint.cmd libs/utils/src/general.ts`（cwd `apps/server`） | **exit 1**，2 errors：① `'@walnut-server/system' import is restricted … lib 分层门禁：基建层 不能 import … 依赖方向见 ADR 0022。 no-restricted-imports`；② `perfectionist/sort-imports`（顺带） | ✅ **分层门禁有效，消息自带「为什么」** |

**还原**：`git checkout -- apps/server/libs/utils/src/general.ts`。

> 偏离说明：任务要求每组都跑 `pnpm lint` 与 `pnpm prepush`。实际做法是「用与门禁完全相同的配置、只跑相关段」：
> `prepush` 有 **24 段**（`PREPUSH_GATES`：boundaries，lint，lint-root，types，types-root，syncpack，workflows，workflows-shell，dynamic-imports，docs-refs，adr，doc-ts，doc-budget，emoji，seed，openapi，dts，turbo-cache，lockfile，nginx-headers，exports，secrets，pre-hooks，versioning），
> 全表跑一遍会与并发同伴的改动互相干扰、且远超单轮预算。逐条映射是确定的：
> A1 → 第 1 段 `boundaries`；A2 → **没有任何一段**（这也是本轮的结论）；C1 → 第 2 段 `lint`（同一份 `apps/server/eslint.config.ts`，单文件已实证）；
> **knip 与 madge 都不在这 24 段里**。

---

## 2. D14：加一个 lib 到底要改哪 9 个文件（实测清单）

以现存的 `scope-resolver` 为样本（34 个 lib 全部同形）：

| 面 | 文件 | 位置（实测行号） | 新增 1 个 lib 要写什么 | 增量行数 |
|----|------|------------------|------------------------|----------|
| ① tsconfig paths | `apps/server/tsconfig.json` | paths 块 @**24**；`@walnut-server/*` 键共 **34** 个 | 两个键：`"@walnut-server/<x>"` 与 `"<x>/*"`，各指向 `./libs/<x>/src` | **+6** |
| ② nest filenames | `infra/nest/dev.json` | `"filenames"` @**15** | 一行 `"libs/<x>/src",` | **+1** |
| ② nest filenames | `infra/nest/prod.json` | @**15** | 同上 | **+1** |
| ② nest filenames | `infra/nest/stage.json` | @**15** | 同上 | **+1** |
| ③ nest projects | `infra/nest/dev.json` | `"projects"` @**57**；lib 项目块 34 个 | 8 行块：`"<x>": { "type": "library", "root": "libs/<x>", "entryFile": "index", "sourceRoot": "libs/<x>/src", "compilerOptions": { "tsConfigPath": "libs/<x>/tsconfig.lib.json" } },` | **+8** |
| ③ nest projects | `infra/nest/prod.json` | @**57** | 同上 | **+8** |
| ③ nest projects | `infra/nest/stage.json` | @**57** | 同上 | **+8** |
| ④ swc paths | `infra/swc/dev.swcrc` | `"paths"` @**17** | 两行（根 + `/*`） | **+2** |
| ④ swc paths | `infra/swc/prod.swcrc` | @**16**（注意与另两份差 1 行，因 prod 多一段配置） | 同上 | **+2** |
| ④ swc paths | `infra/swc/stage.swcrc` | @**17** | 同上 | **+2** |
| ⑤ app include | `apps/server/apps/api/tsconfig.app.json` | `"include"` @**6**（35 条 libs 路径） | 一行 `"../../libs/<x>/src/**/*",` | **+1** |
| ⑥ eslint 分层名单 | `apps/server/eslint.config.ts` | 6 个数组分别 @**9/13/20/22/24/25**（INFRA / EXCEPTION / TECH_BASE / TECH_ASSEMBLE / DOMAIN / TOP） | 往对应层的数组里加一个字符串 | **+1** |
| ⑦ lib 自带文件 | `libs/<x>/tsconfig.lib.json` | **34/34 个 lib 都有**（样本 6 行） | 新文件（`extends ../../tsconfig.lib.base.json` + outDir） | **+6（新文件）** |

- **合计**：**9 个既有文件** + **2 个新文件**（`tsconfig.lib.json`、`src/index.ts`）；**插入约 41 行**（其中 **24 行**是三份 nest `projects` 的重复块，占一半以上）。
- 与 D14 的「7 面 / 9 文件约 19 行」对账：**9 文件 ✅**；「19 行」低估了——按「每面各算一次」才是 7 行量级，按**实际要敲进去的行数**是 ≈41 行（nest projects 的 8 行块 ×3 是大头）。
- 附带发现：**只有 9/34 个 lib 有 README**（`libs/*/README.md`），所以 README 不算注册面。

### 2.1 drift spec 实测（谁在守、失败时说什么）

- 守门人：**`apps/server/apps/api/src/common/monorepo/lib-registration.drift.spec.ts`（581 行，9 个测试）**。
  覆盖：磁盘非空自检 → 每个 lib 有 `tsconfig.lib.json` → ① paths → ② nest filenames+projects → ③ swcrc → ④ app include → ⑤ eslint 名单并集/无重复 → ⑤ **接线对账**（`layer(...)` 调用数 = 10、lib 归属、banned 集合、files 派生式） → ⑤ **接线自测**（把 tech-base 的 banned 删一项必须报红）。
- 实测触发方式：从 `eslint.config.ts` 的 `TECH_ASSEMBLE_LIBS` 里删掉 `'scope-resolver'`（模拟「漏登记一个面」），跑：
  `cd apps/server && node_modules\.bin\vitest.cmd run --config ./apps/api/vitest.config.ts apps/api/src/common/monorepo/lib-registration.drift.spec.ts`
  → **2 failed / 7 passed，354ms（含启动 978ms）**，提示两条，形如：
  `layer tech-assemble 的 libs [repository, list, crud, token] ≠ 矩阵 [repository, list, crud, scope-resolver, token]`，
  `layer infra 的 banned [...] ≠ 矩阵推导 [...]`，另有「layer libs 并集 ≠ 矩阵」。
- 判定：**这一面是可信的**——它不只对账「名单」，还对账「接线」（删一个 banned 项也会红，且有自测证明对账不是空转）。

### 2.2 能不能用「单一真源 + 生成」替代

- **可行，但要分清两类文件**：
  - **可生成（纯数据）**：① paths、② filenames、③ projects、④ swcrc paths、⑤ tsconfig.app include —— 五处都是 JSON，且**键序无影响**（不影响 `openapi.json` 的字节序，因为那是 swagger 元数据顺序，不是构建配置顺序）。
  - **不宜生成（代码）**：⑥ `eslint.config.ts` 的 6 个数组 + `layer(...)` 接线。强行生成会让「配置读生成物、生成物读磁盘」形成两跳；建议只把 6 个数组抽成 `libs.layers.ts`（仍手写，但**一处**），config 从它派生。
- **代价**：codegen（脚本 + `--check` 模式 + 三份 nest json 的「只重写 filenames/projects 区段」+ 接进 prepush）≈ **M（2–4 人日）**，风险是「重写 JSON 时破坏 app 项目定义 / builder 配置」——三份 nest json 有 431/431/432 行，app 定义与 lib 定义混在一个文件里。
- **更便宜的替代（推荐先做）**：把动作包成脚手架 `pnpm new:lib <name> --layer=tech-base`（≈80 行 TS），一次改 9 个文件，**保留 drift spec 当裁判**。≈ **S（0.5–1 人日）**，收益是 41 行手工 → 1 条命令，且不需要动任何既有 JSON 的生成风险。

---

## 3. frontend 规则：建议片段与实测

三条候选（都在净树上跑过，也都用 A2 注入验过）：

| 变体 | 片段 | 净树 | 注入 A2 后 | tags 不变量 | 评价 |
|------|------|------|-----------|-------------|------|
| ① 新键 `frontend`（最小） | `"frontend": { "dependencies": { "deny": ["platform-node"] } }` | 绿 | 红（报 platform-node） | 绿 | 可行；但引入了「只有一个包声明」的新 tag 键（未来第二个前端 app 才算有用） |
| ② 新键 `frontend`（富列表） | `deny: ["platform-node","backend","app"]` | 绿 | 红，但**报 `app`** | 绿 | 能拦，消息不如最小列表精确（deny 按顺序命中） |
| **③ 复用 `platform-web`（推荐）** | `"platform-web": { "dependencies": { "deny": ["platform-node"] } }` | **绿** | **红（报 platform-node）** | **绿** | **不加新键**；`apps/admin` 与 `client/http`（将来还有 ui）都带这个 tag ⇒ 一条规则同时守住「前端 app」与「前端库」 |

**推荐片段（变体 ③，与现有 4 条规则同形，插在 `turbo.json` 的 `boundaries.tags` 里）**：

```json
      "platform-web": {
        "dependencies": {
          "deny": ["platform-node"]
        }
      }
```

**理由（每条都有实测支撑）**：
1. **净树立刻变红的包数 = 0**（实测 `Checked 4646 files in 15 packages, no issues found`）——加规则不存在「上线即红」的风险；
2. 它补的是**今天完全不存在的方向**：现有 4 条规则里没有任何一条约束「前端不得消费 Node 包」；
3. 不用新 tag 键，就绕开了 `check-turbo-cache` 那条「`boundaries.tags` 每个 key 必须有包声明」的反向断言（虽然新键也能过，但多一个只服务一个包的键，语义上是负担）；
4. 若将来真建 `packages/platform-node/*`，这条规则**自动覆盖**新包（它只认 tag，不认目录）。

---

## 4. knip barrel 处置：具体改法与前后对比

**改法（推荐，最小可验证）**：给 5 个共享包各补两行——`project` 与 `includeEntryExports`，**不要**删 `entry`（删了也白删，见 §1.B 的 B6，而且它已经在 hints 里提示是冗余的）：

```ts
    'packages/platform-any/contract': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],        // 让非 entry 文件进入分析面
      includeEntryExports: true,       // 让非 entry 文件的导出也能被判死
    },
```

**实测影响（只对 contract 做，其余 4 包未改）**：

| | Unused files | Unused exports | Unused types | 探针 B1（barrel） | 探针 B2/B3（非 entry） |
|---|---|---|---|---|---|
| 改前（现状） | 15 | **50** | 24 | ❌ 不报 | ❌ 不报 |
| 只加 `project` | 15 | 50 | 24 | ❌ | ❌ |
| 去掉 `entry` | 15 | 50 | 24 | ❌ | ❌ |
| **`project` + `includeEntryExports`** | 15 | **52** | 24 | ❌ **仍不报** | ✅ 都报出来了 |

**结论（三句话）**：
1. **D18② 的方向对，但处方要改**：不是「barrel 被当成 entry」这一件事，而是「**`packages/**` 整块不产出发现**」——50 条 unused export 全在 `apps/**`，一个共享包都没有；
2. **`includeEntryExports: true` 是唯一有效开关**（+2 条真发现，零误报——因为只影响非 entry 文件）；`project`/`entry` 都不是主因；
3. **barrel 自身的死导出，靠 knip 配置解决不了**（B1 在最优配置下仍不报）。要查它只能另找办法：一个「barrel 符号 0 引用」专用脚本（读 `src/index.ts` 的具名导出 → 全仓 grep 消费），或接受这一面的盲区并写进文档。

---

## 5. madge 进 prepush 的成本

| 项 | 实测 |
|----|------|
| 命令 | `cd apps/server && node_modules\.bin\madge.cmd --circular --ts-config tsconfig.json apps/api/src libs --extensions js,ts,tsx`（= `apps/server/package.json` 的 `madge` 脚本参数） |
| 耗时 | **10273 ms**（约 10.3s） |
| 规模 | `Processed 1050 files (9.6s) (18 warnings)` |
| 结果 | `√ No circular dependency found!`，exit 0 |
| 定位 | 该脚本**只存在于 `apps/server/package.json`**；根 `package.json` 无 madge 脚本；**prepush 24 段里没有它**（D19 成立） |
| 对照耗时 | `turbo boundaries` **1.1s**；`knip`（全量）**8.3s** |

**判断**：**可以进 prepush**。prepush 是 24 段并行 4 路（`DEFAULT_CONCURRENCY = 4`），最慢的段通常是 `lint` / `types`；10s 与 knip 同量级，落在「与现有段相当」的区间，不会把总时长顶上去。**唯一要补的是接线**（新增一段 + 一个根脚本 + 让 bin 走 `runCli`），按仓库既有「五步接线清单」做。
备选：若不想加段，就**删掉那条 madge 脚本**——留着一条「没人跑的命令」比没有更糟（它现在是「0 环」这个结论的唯一来源，却不在任何闸上）。

---

## 6. 本轮该做什么 / 不该做什么

**该做（按性价比排序）**：
1. **加 `platform-web: deny platform-node` 一条规则**（变体 ③）：净树零变红，1 行配置 + 1 段注释，补上今天完全不存在的方向。**P0/5 分钟**。
2. **给 5 个共享包补 `project` + `includeEntryExports: true`**：实测让「非 entry 的死导出」从 0 可见变成可见（+2 条），零误报。**P1/S**。
3. **D14 先做脚手架 `new:lib`**（≈80 行），保留 drift spec 当裁判；codegen 留到下一轮。**P1/S**。
4. **madge 要么进 prepush、要么删脚本**（10.3s，可接受）。**P1/S**。
5. 文档口径修正：knip 的「零发现」不是健康信号（本轮实测：共享包整块不在分析面）；prepush 段数/内容以 `PREPUSH_GATES` 为准。

**不该做**：
- **不要**「把 barrel 从 knip entry 摘出」——实测摘掉后 knip 会从 `package.json exports` 推回来，0 效果（hints 里那 8 条 `Remove redundant entry pattern` 说的就是这件事）；
- **不要**给 `frontend` 新建 tag 键（除非要为第二个前端 app 预留）：`platform-web` 变体已覆盖 admin + 3 个 web 包，且不增加「只有一个包声明」的键；
- **不要**在 R1 就动 knip 的 50 条存量（模板仓「未用导出 ≠ 死代码」的既定判断仍成立，且其中 24 条是「留给模板使用者」的装饰器 API）；
- **不要**用 pnpm 跑脚本做负对照实验（会自动 install 并改写 lockfile）；用 `node_modules\.bin\*.cmd` 直调。

---

## 需要 Lead 拍板

1. **frontend 缺口用哪种写法**：(a) 复用 `platform-web` 键（推荐，实测零变红）；(b) 新键 `frontend` + `deny: ["platform-node"]`；(c) 两者都加（`frontend` 为未来第二个前端 app 预留）。
2. **knip 的处置路线**：(a) 只补 `project` + `includeEntryExports`（让非 entry 可见，barrel 盲区写进文档）；(b) 再加一个「barrel 符号 0 引用」专用脚本；(c) 维持现状，只改 `knip.md` 的口径。我倾向 (a) 现在做、(b) 下一轮评估。
3. **madge**：进 prepush（+10.3s/段），还是删掉 `apps/server` 的那条脚本？我倾向进 prepush（它是唯一看「跨 lib 环」的工具，ESLint 只看方向）。
4. **D14**：先做脚手架（S，0.5–1 人日，保留 drift spec），还是直接上 codegen（M，2–4 人日，风险在三份 431 行的 nest json 里混着 app 定义）？我倾向脚手架。
5. **环境口径**：任务书写 HEAD=bb2ee648，实测 **c8bea21a**；且本轮会话中有并发同伴在改 `apps/**`（我已全部还原自己的探针，但「净树」这个前提在 R2 需要重新约定——建议给每个做负对照的 agent 分配互不重叠的探针文件路径，或串行化负对照）。
